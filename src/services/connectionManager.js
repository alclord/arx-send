
/**
 * @fileoverview connectionManager — ciclo de vida da conexão WhatsApp.
 *
 * Responsabilidade única: connectPhone, disconnectPhone, watchdog e eventos
 * de ciclo de vida do whatsapp-web.js (qr, authenticated, ready, disconnected, auth_failure).
 *
 * INVARIANTE CRÍTICA: destroyAllSessions usa APENAS client.destroy() — NUNCA client.logout().
 * logout() apaga os dados LocalAuth em disco. destroy() apenas encerra o Puppeteer.
 * Ver: src/services/phoneStore.js#deletePhoneData para limpeza completa (só no removePhone).
 */

const path = require('path');
const fs = require('fs');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const config = require('../app/config');
const logger = require('../utils/logger');
const { sleep } = require('../utils/helpers');
const { getChromiumPath } = require('../utils/chromium');
const { makePhone } = require('./phoneStore');
const { EVENTS } = require('../socket/events');

/**
 * @param {string} sessionId
 * @param {import('socket.io').Server} io
 * @param {string} event
 * @param {*} data
 */
function emitToSession(sessionId, io, event, data) {
  io.to(`s:${sessionId}`).emit(event, data);
}

// R2: delays progressivos do watchdog (180s → 5min → 10min)
const WATCHDOG_DELAYS = [
  config.WATCHDOG_TIMEOUT_MS,
  300000,
  600000,
];

// Fixa a versão do WhatsApp Web na última que carregou contatos com sucesso,
// evitando quebras quando o WhatsApp publica uma versão nova incompatível
// com o whatsapp-web.js (ex: getChats falhando com ReferenceError minificada).
const WA_VERSION_CACHE_DIR = path.join(config.cacheDir, 'wa-version');
const WA_VERSION_PIN_FILE = path.join(WA_VERSION_CACHE_DIR, 'pinned-version.txt');

function readPinnedWaVersion() {
  try {
    return fs.readFileSync(WA_VERSION_PIN_FILE, 'utf-8').trim() || undefined;
  } catch {
    return undefined;
  }
}

function writePinnedWaVersion(version) {
  try {
    fs.mkdirSync(WA_VERSION_CACHE_DIR, { recursive: true });
    fs.writeFileSync(WA_VERSION_PIN_FILE, version);
  } catch (err) {
    logger.warn(`Falha ao gravar versão pinada do WhatsApp Web: ${err.message}`);
  }
}

/**
 * Encerra o client e aguarda o processo do Chromium morrer de fato antes de
 * seguir. Sem isso, no Windows o processo pode ainda estar segurando os
 * arquivos do perfil (LocalAuth) quando o código tenta apagá-los em seguida,
 * fazendo o rm() falhar silenciosamente e a sessão "quebrada" sobreviver.
 * @param {import('../types').Phone} phone
 */
async function destroyClientAndWait(phone) {
  if (!phone.client) return;
  const browserProcess = phone.client.pupBrowser?.process();
  try { await Promise.race([phone.client.destroy(), sleep(5000)]); } catch {}
  if (browserProcess && !browserProcess.killed) {
    try { browserProcess.kill('SIGKILL'); } catch {}
  }
  phone.client = null;
  await sleep(1000);
}

/**
 * Remove o diretório do LocalAuth com retry, já que logo após destroyClientAndWait
 * o Windows pode levar mais alguns instantes para soltar handles de arquivos
 * (ex: SQLite/LevelDB do perfil Chromium).
 * @param {string} authDir
 * @param {string} sessionId
 * @param {string} phoneId
 * @returns {Promise<boolean>} true se o diretório foi de fato removido
 */
async function removeAuthDir(authDir, sessionId, phoneId) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await fs.promises.rm(authDir, { recursive: true, force: true });
      return true;
    } catch (err) {
      if (attempt === 5) {
        logger.warn(`[${sessionId}:${phoneId}] Não foi possível remover LocalAuth (${err.message}) — sessão pode persistir quebrada`);
        return false;
      }
      await sleep(500);
    }
  }
  return false;
}

/**
 * Inicia watchdog com backoff progressivo (R1+R2+R3).
 * Após WATCHDOG_DELAYS[watchdogCount] ms sem atingir ready:
 *   - Tentativas 1-2: reconecta com feedback de retry na UI
 *   - Tentativa 3: limpa LocalAuth, exibe erro e notifica (R1+R5)
 *
 * @param {import('../types').Session} sess
 * @param {string} phoneId
 * @param {import('socket.io').Server} io
 */
function setPhoneWatchdog(sess, phoneId, io) {
  const phone = sess.phones[phoneId];
  if (!phone) return;
  clearTimeout(phone.watchdog);

  const count = phone.watchdogCount;
  const ms = WATCHDOG_DELAYS[Math.min(count, WATCHDOG_DELAYS.length - 1)];

  phone.watchdog = setTimeout(async () => {
    if (phone.status !== 'connecting') return;

    phone.watchdogCount++;

    if (phone.watchdogCount >= WATCHDOG_DELAYS.length) {
      // R1: esgotou tentativas — limpa LocalAuth e exige novo QR
      logger.warn(`[${sess.id}:${phoneId}] Watchdog: ${WATCHDOG_DELAYS.length} tentativas sem sucesso — limpando LocalAuth`);
      phone.watchdogCount = 0;
      await destroyClientAndWait(phone);
      const authDir = path.join(config.sessionDir, sess.id, phoneId);
      await removeAuthDir(authDir, sess.id, phoneId);
      phone.status = 'error';
      emitToSession(sess.id, io, EVENTS.PHONE_STATUS, {
        phoneId,
        status: 'error',
        message: 'Sessão rejeitada pelo WhatsApp. Clique em Conectar para escanear o QR.',
        notify: true, // R5: dispara notificação Windows no frontend
      });
      _emitPhonesList(sess, sess.id, io);
      return;
    }

    // R2+R3: backoff progressivo com feedback visível
    const nextMs = WATCHDOG_DELAYS[Math.min(phone.watchdogCount, WATCHDOG_DELAYS.length - 1)];
    const nextLabel = nextMs >= 60000 ? `${Math.round(nextMs / 60000)}min` : `${Math.round(nextMs / 1000)}s`;
    logger.warn(`[${sess.id}:${phoneId}] Watchdog: tentativa ${phone.watchdogCount}/${WATCHDOG_DELAYS.length} — reconectando...`);
    emitToSession(sess.id, io, EVENTS.PHONE_STATUS, {
      phoneId,
      status: 'connecting',
      message: `Reconectando... tentativa ${phone.watchdogCount}/${WATCHDOG_DELAYS.length} (próxima em ${nextLabel})`,
    });
    connectPhone(sess, phoneId, io).catch(err =>
      logger.error(`[${sess.id}:${phoneId}] Watchdog erro:`, err)
    );
  }, ms);
}

/** @param {import('../types').Phone} phone */
function clearPhoneWatchdog(phone) {
  clearTimeout(phone.watchdog);
  phone.watchdog = null;
  phone.watchdogCount = 0; // R1: reset ao conectar com sucesso
}

/**
 * Inicia heartbeat de 5min para detectar sessões mortas silenciosamente (R4).
 * @param {import('../types').Session} sess
 * @param {string} phoneId
 * @param {import('socket.io').Server} io
 */
function startPhoneHeartbeat(sess, phoneId, io) {
  const phone = sess.phones[phoneId];
  if (!phone) return;
  clearInterval(phone.heartbeat);
  phone.heartbeat = setInterval(async () => {
    if (phone.status !== 'ready' || !phone.client) {
      clearPhoneHeartbeat(phone);
      return;
    }
    try {
      const state = await phone.client.getState();
      if (state !== 'CONNECTED') {
        logger.warn(`[${sess.id}:${phoneId}] Heartbeat: estado ${state} — reconectando proativamente`);
        clearPhoneHeartbeat(phone);
        phone.status = 'disconnected';
        phone.contacts = [];
        emitToSession(sess.id, io, EVENTS.PHONE_STATUS, { phoneId, status: 'disconnected', message: 'Conexão perdida — reconectando...' });
        emitToSession(sess.id, io, EVENTS.PHONE_CONTACTS, { phoneId, contacts: [] });
        _emitPhonesList(sess, sess.id, io);
        connectPhone(sess, phoneId, io).catch(err => logger.error(`[${sess.id}:${phoneId}] Heartbeat reconexão erro:`, err));
      }
    } catch (err) {
      logger.warn(`[${sess.id}:${phoneId}] Heartbeat falhou: ${err.message} — reconectando`);
      clearPhoneHeartbeat(phone);
      phone.status = 'disconnected';
      emitToSession(sess.id, io, EVENTS.PHONE_STATUS, { phoneId, status: 'disconnected', message: 'Conexão perdida — reconectando...' });
      _emitPhonesList(sess, sess.id, io);
      connectPhone(sess, phoneId, io).catch(err2 => logger.error(`[${sess.id}:${phoneId}] Heartbeat reconexão erro:`, err2));
    }
  }, 5 * 60 * 1000);
}

/** @param {import('../types').Phone} phone */
function clearPhoneHeartbeat(phone) {
  clearInterval(phone.heartbeat);
  phone.heartbeat = null;
}

/**
 * Conecta um telefone ao WhatsApp via Puppeteer + LocalAuth.
 * Emite eventos de status durante todo o processo.
 *
 * @param {import('../types').Session} sess
 * @param {string} phoneId
 * @param {import('socket.io').Server} io
 */
async function connectPhone(sess, phoneId, io) {
  const sessionId = sess.id;
  const phone = sess.phones[phoneId];
  if (!phone) return;

  await destroyClientAndWait(phone);

  const executablePath = getChromiumPath();
  logger.info(`[${sessionId}:${phoneId}] ${executablePath ? '✓ Chromium: ' + executablePath : '⚠ Chromium padrão'}`);

  const lockFile = path.join(config.sessionDir, sessionId, phoneId, `session-${sessionId}_${phoneId}`, 'SingletonLock');
  try { fs.unlinkSync(lockFile); logger.info(`[${sessionId}:${phoneId}] SingletonLock removido`); } catch {}

  phone.client = new Client({
    authStrategy: new LocalAuth({
      clientId: `${sessionId}_${phoneId}`,
      dataPath: path.join(config.sessionDir, sessionId, phoneId),
    }),
    webVersion: readPinnedWaVersion(),
    webVersionCache: {
      type: 'local',
      path: WA_VERSION_CACHE_DIR,
    },
    puppeteer: {
      headless: true,
      executablePath,
      timeout: 120000,
      protocolTimeout: 300000,
      args: [
        '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
        '--disable-extensions', '--disable-default-apps', '--disable-sync',
        '--disable-translate', '--hide-scrollbars', '--no-first-run',
        '--window-size=1280,800',
        '--disable-blink-features=AutomationControlled',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-ipc-flooding-protection',
        '--use-angle=swiftshader-webgl',
        '--disable-features=CalculateNativeWinOcclusion,BackForwardCache',
      ],
    },
  });

  phone.client.on('qr', async qr => {
    phone.status = 'qr';
    const qrImage = await qrcode.toDataURL(qr);
    emitToSession(sessionId, io, EVENTS.PHONE_QR, { phoneId, phoneName: phone.name, qr: qrImage });
    emitToSession(sessionId, io, EVENTS.PHONE_STATUS, { phoneId, status: 'qr', message: 'Escaneie o QR code' });
    _emitPhonesList(sess, sessionId, io);
  });

  phone.client.on('loading_screen', percent => {
    phone.status = 'connecting';
    emitToSession(sessionId, io, EVENTS.PHONE_STATUS, {
      phoneId,
      status: 'connecting',
      message: `Carregando... ${percent}%`,
    });
    setPhoneWatchdog(sess, phoneId, io);
  });

  phone.client.on('authenticated', () => {
    phone.status = 'connecting';
    emitToSession(sessionId, io, EVENTS.PHONE_STATUS, {
      phoneId,
      status: 'connecting',
      message: 'Autenticado! Inicializando...',
    });
    setPhoneWatchdog(sess, phoneId, io);
    _emitPhonesList(sess, sessionId, io);
  });

  phone.client.on('ready', async () => {
    clearPhoneWatchdog(phone);
    phone.status = 'ready';
    phone.lastActivityAt = Date.now();
    sess.lastActivityAt = Date.now();
    emitToSession(sessionId, io, EVENTS.PHONE_STATUS, {
      phoneId,
      status: 'ready',
      message: 'Conectado! Aguardando sincronização...',
    });
    _emitPhonesList(sess, sessionId, io);

    if (phone.contacts.length > 0) {
      emitToSession(sessionId, io, EVENTS.PHONE_CONTACTS, { phoneId, contacts: phone.contacts });
      emitToSession(sessionId, io, EVENTS.PHONE_STATUS, {
        phoneId,
        status: 'ready',
        message: `${phone.contacts.length} conversas (cache) — atualizando...`,
      });
    }

    await sleep(3000);
    if (phone.status === 'ready') {
      const { loadContactsForPhone } = require('./contactManager');
      const result = await loadContactsForPhone(sess, phoneId, io);
      if (result === 'ok') {
        startPhoneHeartbeat(sess, phoneId, io); // R4
        // Só pina a versão depois que getChats confirmou que ela funciona
        try {
          const waVersion = await phone.client.getWWebVersion();
          writePinnedWaVersion(waVersion);
        } catch {}
      }
      if (result === 'needs_reconnect') {
        logger.warn(`[${sessionId}:${phoneId}] getChats esgotou retries — limpando sessão e reconectando`);
        await destroyClientAndWait(phone);
        phone.status = 'disconnected';
        const authDir = path.join(config.sessionDir, sessionId, phoneId);
        const removed = await removeAuthDir(authDir, sessionId, phoneId);
        if (removed) logger.info(`[${sessionId}:${phoneId}] LocalAuth limpo após falha de getChats`);
        emitToSession(sessionId, io, EVENTS.PHONE_STATUS, {
          phoneId,
          status: 'error',
          message: 'Sessão com falha ao carregar dados. Reconectando...',
        });
        _emitPhonesList(sess, sessionId, io);
        await sleep(2000);
        connectPhone(sess, phoneId, io).catch(err =>
          logger.error(`[${sessionId}:${phoneId}] Erro ao reconectar após falha de getChats:`, err)
        );
      }
    }
  });

  phone.client.on('disconnected', reason => {
    clearPhoneWatchdog(phone);
    clearPhoneHeartbeat(phone); // R4
    phone.status = 'disconnected';
    phone.contacts = [];
    emitToSession(sessionId, io, EVENTS.PHONE_STATUS, {
      phoneId,
      status: 'disconnected',
      message: `Desconectado: ${reason}`,
    });
    emitToSession(sessionId, io, EVENTS.PHONE_CONTACTS, { phoneId, contacts: [] });
    _emitPhonesList(sess, sessionId, io);
  });

  phone.client.on('auth_failure', async () => {
    clearPhoneWatchdog(phone);
    clearPhoneHeartbeat(phone); // R4
    phone.status = 'disconnected';
    await destroyClientAndWait(phone);
    // Apaga LocalAuth corrompido/expirado para que a próxima tentativa gere novo QR
    const authDir = path.join(config.sessionDir, sessionId, phoneId);
    await removeAuthDir(authDir, sessionId, phoneId);
    emitToSession(sessionId, io, EVENTS.PHONE_STATUS, {
      phoneId,
      status: 'error',
      message: 'Sessão expirada. Clique em Conectar para escanear um novo QR.',
    });
    _emitPhonesList(sess, sessionId, io);
  });

  phone.status = 'connecting';
  emitToSession(sessionId, io, EVENTS.PHONE_STATUS, { phoneId, status: 'connecting', message: 'Iniciando...' });
  _emitPhonesList(sess, sessionId, io);
  setPhoneWatchdog(sess, phoneId, io);

  phone.client.initialize().catch(async err => {
    logger.error(`[${sessionId}:${phoneId}] Falha ao inicializar cliente:`, err.message);
    clearPhoneWatchdog(phone);
    try { phone.client.destroy(); } catch {}
    phone.client = null;
    phone.status = 'disconnected';

    const isAlreadyRunning = err.message.includes('already running');
    const isContextError =
      err.message.includes('context') ||
      err.message.includes('Target closed') ||
      err.message.includes('detached');

    if (isAlreadyRunning) {
      // Sessão OK — só o processo Chrome anterior ficou zumbi. Limpa apenas o lock.
      const lock = path.join(config.sessionDir, sessionId, phoneId, `session-${sessionId}_${phoneId}`, 'SingletonLock');
      try { fs.unlinkSync(lock); } catch {}
      logger.info(`[${sessionId}:${phoneId}] SingletonLock removido após "already running"`);
      emitToSession(sessionId, io, EVENTS.PHONE_STATUS, {
        phoneId,
        status: 'error',
        message: 'Processo anterior em execução foi encerrado. Clique em Conectar.',
      });
    } else {
      const authDir = path.join(config.sessionDir, sessionId, phoneId);
      await fs.promises.rm(authDir, { recursive: true, force: true }).catch(() => {});
      logger.info(`[${sessionId}:${phoneId}] LocalAuth limpo após falha de inicialização`);
      const msg = isContextError
        ? 'Sessão anterior inválida. Clique em Conectar para gerar um novo QR.'
        : 'Falha ao abrir o navegador. Verifique se o Google Chrome está instalado.';
      emitToSession(sessionId, io, EVENTS.PHONE_STATUS, { phoneId, status: 'error', message: msg });
    }
    _emitPhonesList(sess, sessionId, io);
  });
}

/**
 * Desconecta um telefone fazendo logout explícito (apaga LocalAuth).
 * Use apenas quando o usuário clica "Desconectar".
 *
 * @param {import('../types').Phone} phone
 */
async function disconnectPhone(phone) {
  clearPhoneWatchdog(phone);
  clearPhoneHeartbeat(phone); // R4
  if (phone.client) {
    try { await phone.client.logout(); } catch {}
    try { await phone.client.destroy(); } catch {}
    phone.client = null;
  }
  phone.status = 'disconnected';
  phone.contacts = [];
}

/**
 * Encerra todos os clientes sem logout — mantém LocalAuth em disco.
 * Chamado no fechamento do app.
 *
 * INVARIANTE: NUNCA chamar logout() aqui. logout() apagaria os dados LocalAuth
 * e forçaria novo QR code na próxima abertura.
 *
 * @param {Object.<string, import('../types').Session>} sessions
 */
async function destroyAllSessions(sessions) {
  for (const sess of Object.values(sessions)) {
    for (const phone of Object.values(sess.phones)) {
      clearPhoneWatchdog(phone);
      clearPhoneHeartbeat(phone); // R4
      if (phone.client) {
        try { await Promise.race([phone.client.destroy(), sleep(5000)]); } catch {}
        phone.client = null;
      }
      phone.status = 'disconnected';
    }
  }
}

/**
 * Emite phones_list para o room da sessão.
 * Helper interno — evita importar sessionService aqui.
 */
function _emitPhonesList(sess, sessionId, io) {
  const payload = Object.values(sess.phones).map(p => ({
    id: p.id,
    name: p.name,
    status: p.status,
    contactCount: p.contacts.length,
  }));
  io.to(`s:${sessionId}`).emit(EVENTS.PHONES_LIST, { phones: payload });
}

module.exports = { connectPhone, disconnectPhone, destroyAllSessions, setPhoneWatchdog, clearPhoneWatchdog, clearPhoneHeartbeat };
