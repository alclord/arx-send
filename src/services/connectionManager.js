
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

/**
 * Inicia watchdog para um telefone travado em "connecting".
 * Após ms milissegundos sem transição, reconnecta automaticamente.
 *
 * @param {import('../types').Session} sess
 * @param {string} phoneId
 * @param {import('socket.io').Server} io
 * @param {number} [ms]
 */
function setPhoneWatchdog(sess, phoneId, io, ms = config.WATCHDOG_TIMEOUT_MS) {
  const phone = sess.phones[phoneId];
  if (!phone) return;
  clearTimeout(phone.watchdog);
  phone.watchdog = setTimeout(() => {
    if (phone.status === 'connecting') {
      logger.warn(`[${sess.id}:${phoneId}] Watchdog: travado em connecting — reconectando...`);
      emitToSession(sess.id, io, EVENTS.PHONE_STATUS, {
        phoneId,
        status: 'connecting',
        message: 'Reconectando automaticamente...',
      });
      connectPhone(sess, phoneId, io).catch(err =>
        logger.error(`[${sess.id}:${phoneId}] Watchdog erro:`, err)
      );
    }
  }, ms);
}

/** @param {import('../types').Phone} phone */
function clearPhoneWatchdog(phone) {
  clearTimeout(phone.watchdog);
  phone.watchdog = null;
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

  if (phone.client) {
    try { await Promise.race([phone.client.destroy(), sleep(5000)]); } catch {}
    phone.client = null;
    await sleep(1000);
  }

  const executablePath = getChromiumPath();
  logger.info(`[${sessionId}:${phoneId}] ${executablePath ? '✓ Chromium: ' + executablePath : '⚠ Chromium padrão'}`);

  phone.client = new Client({
    authStrategy: new LocalAuth({
      clientId: `${sessionId}_${phoneId}`,
      dataPath: path.join(config.sessionDir, sessionId, phoneId),
    }),
    webVersionCache: {
      type: 'remote',
      remotePath:
        'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.3000.1041871181-alpha.html',
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

    await sleep(6000);
    if (phone.status === 'ready') {
      const { loadContactsForPhone } = require('./contactManager');
      const result = await loadContactsForPhone(sess, phoneId, io);
      if (result === 'needs_reconnect') {
        logger.warn(`[${sessionId}:${phoneId}] getChats esgotou retries — limpando sessão e reconectando`);
        try { await phone.client.destroy(); } catch {}
        phone.client = null;
        phone.status = 'disconnected';
        const authDir = path.join(config.sessionDir, sessionId, phoneId);
        fs.rm(authDir, { recursive: true, force: true }, () => {
          logger.info(`[${sessionId}:${phoneId}] LocalAuth limpo após falha de getChats`);
        });
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
    phone.status = 'disconnected';
    try { await phone.client.destroy(); } catch {}
    phone.client = null;
    // Apaga LocalAuth corrompido/expirado para que a próxima tentativa gere novo QR
    const authDir = path.join(config.sessionDir, sessionId, phoneId);
    fs.rm(authDir, { recursive: true, force: true }, () => {});
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

  phone.client.initialize().catch(err => {
    logger.error(`[${sessionId}:${phoneId}] Falha ao inicializar cliente:`, err.message);
    clearPhoneWatchdog(phone);
    try { phone.client.destroy(); } catch {}
    phone.client = null;
    phone.status = 'disconnected';

    const authDir = path.join(config.sessionDir, sessionId, phoneId);
    fs.rm(authDir, { recursive: true, force: true }, () => {
      logger.info(`[${sessionId}:${phoneId}] LocalAuth limpo após falha de inicialização`);
    });

    const isContextError =
      err.message.includes('context') ||
      err.message.includes('Target closed') ||
      err.message.includes('detached');
    const msg = isContextError
      ? 'Sessão anterior inválida. Clique em Conectar para gerar um novo QR.'
      : 'Falha ao abrir o navegador. Verifique se o Google Chrome está instalado.';

    emitToSession(sessionId, io, EVENTS.PHONE_STATUS, { phoneId, status: 'error', message: msg });
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

module.exports = { connectPhone, disconnectPhone, destroyAllSessions, setPhoneWatchdog, clearPhoneWatchdog };
