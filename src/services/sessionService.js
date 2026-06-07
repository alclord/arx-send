const path = require('path');
const fs = require('fs');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const config = require('../app/config');
const { sleep } = require('../utils/helpers');
const { getChromiumPath } = require('../utils/chromium');

const sessions = {};

function getSession(id) {
  if (!sessions[id]) {
    sessions[id] = {
      id,
      client: null,
      status: 'disconnected',
      contacts: loadCachedContacts(id),
      isSending: false,
      stopRequested: false,
      watchdog: null,
    };
  }
  return sessions[id];
}

function setWatchdog(sessionId, io, ms = config.WATCHDOG_TIMEOUT_MS) {
  const sess = getSession(sessionId);
  clearTimeout(sess.watchdog);
  sess.watchdog = setTimeout(() => {
    if (sess.status === 'connecting') {
      console.log(`[${sessionId}] Watchdog: travado em connecting — reconectando...`);
      emit(sessionId, io, 'status', { status: 'connecting', message: 'Reconectando automaticamente...' });
      connectSession(sessionId, io).catch(err => console.error(`[${sessionId}] Watchdog erro ao reconectar:`, err));
    }
  }, ms);
}

function clearWatchdog(sessionId) {
  const sess = getSession(sessionId);
  clearTimeout(sess.watchdog);
  sess.watchdog = null;
}

function emit(sessionId, io, event, data) {
  io.to(`s:${sessionId}`).emit(event, data);
}

function loadCachedContacts(sessionId) {
  const file = path.join(config.cacheDir, `${sessionId}.json`);
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.warn(`[${sessionId}] Falha ao carregar cache de contatos:`, err.message);
  }
  return [];
}

async function saveCachedContacts(sessionId, contacts) {
  try {
    await fs.promises.writeFile(
      path.join(config.cacheDir, `${sessionId}.json`),
      JSON.stringify(contacts)
    );
  } catch (err) {
    console.warn(`[${sessionId}] Falha ao salvar cache de contatos:`, err.message);
  }
}

async function connectSession(sessionId, io) {
  const sess = getSession(sessionId);

  if (sess.client) {
    try {
      await Promise.race([sess.client.destroy(), sleep(5000)]);
    } catch (err) {
      console.warn(`[${sessionId}] Erro ao destruir cliente anterior:`, err.message);
    }
    sess.client = null;
    await sleep(1000);
  }

  const executablePath = getChromiumPath();
  console.log(`[${sessionId}] ${executablePath ? '\u2713 Chromium: ' + executablePath : '\u26a0 Usando Chromium padr\u00e3o'}`);

  sess.client = new Client({
    authStrategy: new LocalAuth({
      clientId: sessionId,
      dataPath: path.join(config.sessionDir, sessionId)
    }),
    webVersionCache: { type: 'none' },
    puppeteer: {
      headless: true,
      executablePath,
      timeout: 120000,
      protocolTimeout: 120000,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-default-apps',
        '--disable-sync',
        '--disable-translate',
        '--hide-scrollbars',
        '--no-first-run',
        '--window-size=1280,800',
        '--disable-blink-features=AutomationControlled',
      ]
    }
  });

  sess.client.on('qr', async (qr) => {
    sess.status = 'qr';
    const qrImage = await qrcode.toDataURL(qr);
    emit(sessionId, io, 'qr', { qr: qrImage });
    emit(sessionId, io, 'status', { status: 'qr', message: 'Escaneie o QR code com seu celular' });
  });

  sess.client.on('loading_screen', (percent) => {
    sess.status = 'connecting';
    emit(sessionId, io, 'status', { status: 'connecting', message: `Carregando... ${percent}%` });
    setWatchdog(sessionId, io, 120000);
  });

  sess.client.on('authenticated', () => {
    sess.status = 'connecting';
    emit(sessionId, io, 'status', { status: 'connecting', message: 'Autenticado! Inicializando...' });
    setWatchdog(sessionId, io, 120000);
  });

  sess.client.on('ready', async () => {
    clearWatchdog(sessionId);
    sess.status = 'ready';
    emit(sessionId, io, 'status', { status: 'ready', message: 'Conectado! Aguardando sincroniza\u00e7\u00e3o...' });

    if (sess.contacts.length > 0) {
      emit(sessionId, io, 'contacts', { contacts: sess.contacts });
      emit(sessionId, io, 'status', { status: 'ready', message: `${sess.contacts.length} conversas (cache) — atualizando...` });
    }

    await sleep(3000);
    if (sess.status === 'ready') await loadContacts(sessionId, io);
  });

  sess.client.on('disconnected', (reason) => {
    clearWatchdog(sessionId);
    sess.status = 'disconnected';
    sess.contacts = [];
    emit(sessionId, io, 'status', { status: 'disconnected', message: `Desconectado: ${reason}` });
    emit(sessionId, io, 'contacts', { contacts: [] });
  });

  sess.client.on('auth_failure', async () => {
    sess.status = 'disconnected';
    try { await sess.client.destroy(); } catch (err) {
      console.warn(`[${sessionId}] Erro ao destruir cliente ap\u00f3s falha de auth:`, err.message);
    }
    sess.client = null;
    emit(sessionId, io, 'status', { status: 'error', message: 'Falha na autentica\u00e7\u00e3o.' });
  });

  sess.client.initialize();
}

async function loadContacts(sessionId, io, attempt = 1) {
  const sess = getSession(sessionId);
  if (sess.status !== 'ready' || !sess.client) return;

  const retryMs = attempt === 1 ? 4000 : 6000;

  emit(sessionId, io, 'status', {
    status: 'ready',
    message: `Carregando contatos${attempt > 1 ? ` (${attempt}/${config.CONTACT_LOAD_RETRIES})` : ''}...`
  });

  try {
    const chats = await sess.client.getChats();
    console.log(`[${sessionId}] getChats tentativa ${attempt}: ${chats.length} conversas`);

    if (chats.length === 0 && attempt < config.CONTACT_LOAD_RETRIES) {
      await sleep(retryMs);
      return loadContacts(sessionId, io, attempt + 1);
    }

    sess.contacts = chats.map(c => ({
      id: c.id._serialized,
      name: c.name || c.id.user,
      isGroup: c.isGroup,
      unread: c.unreadCount || 0
    })).sort((a, b) => a.name.localeCompare(b.name));

    await saveCachedContacts(sessionId, sess.contacts);
    emit(sessionId, io, 'contacts', { contacts: sess.contacts });
    emit(sessionId, io, 'status', { status: 'ready', message: `Pronto — ${sess.contacts.length} conversas carregadas` });
  } catch (e) {
    console.error(`[${sessionId}] Erro ao carregar contatos (tentativa ${attempt}):`, e.message);
    const transient = e.message.includes('timed out') || e.message.includes('context') || e.message.includes('Target');
    if (transient && attempt < config.CONTACT_LOAD_RETRIES) {
      await sleep(retryMs);
      return loadContacts(sessionId, io, attempt + 1);
    }
    emit(sessionId, io, 'status', { status: 'ready', message: 'Erro ao carregar contatos. Clique em Recarregar.' });
  }
}

async function destroySession(sessionId) {
  const sess = getSession(sessionId);
  if (sess.client) {
    try { await sess.client.logout(); } catch (err) {
      console.warn(`[${sessionId}] Erro ao fazer logout:`, err.message);
    }
    try { await sess.client.destroy(); } catch (err) {
      console.warn(`[${sessionId}] Erro ao destruir cliente:`, err.message);
    }
    sess.client = null;
  }
  sess.status = 'disconnected';
  sess.contacts = [];
}

function cleanStaleSessions() {
  for (const [id, sess] of Object.entries(sessions)) {
    if (sess.status === 'disconnected' && !sess.client && !sess.isSending) {
      delete sessions[id];
    }
  }
}

module.exports = {
  sessions,
  getSession,
  setWatchdog,
  clearWatchdog,
  connectSession,
  loadContacts,
  destroySession,
  cleanStaleSessions,
  emit,
};
