const path = require('path');
const fs = require('fs');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const config = require('../app/config');
const { sleep } = require('../utils/helpers');
const { getChromiumPath } = require('../utils/chromium');

const MAX_PHONES_PER_SESSION = 10;
const sessions = {};

function getSession(id) {
  if (!sessions[id]) {
    sessions[id] = {
      id,
      phones: {},
      isSending: false,
      stopRequested: false,
      lastActivityAt: Date.now(),
    };
    loadPhones(id);
  }
  return sessions[id];
}

function touchSession(id) {
  if (sessions[id]) sessions[id].lastActivityAt = Date.now();
}

// ── Persistência de telefones ──

function phonesFilePath(sessionId) {
  return path.join(config.cacheDir, `${sessionId}_phones.json`);
}

function loadPhones(sessionId) {
  const sess = sessions[sessionId];
  const file = phonesFilePath(sessionId);
  try {
    if (fs.existsSync(file)) {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const p of saved) {
        sess.phones[p.id] = makePhone(p.id, p.name);
      }
    }
  } catch (err) {
    console.warn(`[${sessionId}] Falha ao carregar telefones:`, err.message);
  }
}

function savePhones(sessionId) {
  const sess = sessions[sessionId];
  if (!sess) return;
  const data = Object.values(sess.phones).map(p => ({ id: p.id, name: p.name }));
  try {
    fs.writeFileSync(phonesFilePath(sessionId), JSON.stringify(data));
  } catch (err) {
    console.warn(`[${sessionId}] Falha ao salvar telefones:`, err.message);
  }
}

function makePhone(id, name) {
  return {
    id,
    name,
    client: null,
    status: 'disconnected',
    contacts: loadCachedContacts(id),
    watchdog: null,
    lastActivityAt: Date.now(),
  };
}

// ── Contatos por telefone ──

function contactsCachePath(phoneId) {
  return path.join(config.cacheDir, `phone_${phoneId}.json`);
}

function loadCachedContacts(phoneId) {
  const file = contactsCachePath(phoneId);
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.warn(`[phone:${phoneId}] Falha ao carregar cache de contatos:`, err.message);
  }
  return [];
}

async function saveCachedContacts(phoneId, contacts) {
  try {
    await fs.promises.writeFile(contactsCachePath(phoneId), JSON.stringify(contacts));
  } catch (err) {
    console.warn(`[phone:${phoneId}] Falha ao salvar cache de contatos:`, err.message);
  }
}

// ── Emit helpers ──

function emit(sessionId, io, event, data) {
  io.to(`s:${sessionId}`).emit(event, data);
}

function phonesListPayload(sess) {
  return Object.values(sess.phones).map(p => ({
    id: p.id,
    name: p.name,
    status: p.status,
    contactCount: p.contacts.length,
  }));
}

function emitPhonesList(sessionId, io) {
  const sess = getSession(sessionId);
  emit(sessionId, io, 'phones_list', { phones: phonesListPayload(sess) });
}

// ── Gerenciamento de telefones ──

function addPhone(sessionId, name) {
  const sess = getSession(sessionId);
  if (Object.keys(sess.phones).length >= MAX_PHONES_PER_SESSION) return null;
  const id = `ph_${Date.now()}`;
  sess.phones[id] = makePhone(id, name);
  savePhones(sessionId);
  return id;
}

function renamePhone(sessionId, phoneId, name) {
  const sess = sessions[sessionId];
  if (!sess) return false;
  const phone = sess.phones[phoneId];
  if (!phone) return false;
  phone.name = name;
  savePhones(sessionId);
  return true;
}

function removePhone(sessionId, phoneId) {
  const sess = sessions[sessionId];
  if (!sess) return;
  const phone = sess.phones[phoneId];
  if (!phone) return;
  clearTimeout(phone.watchdog);
  if (phone.client) {
    phone.client.destroy().catch(() => {});
    phone.client = null;
  }
  delete sess.phones[phoneId];
  savePhones(sessionId);
  try { fs.unlinkSync(contactsCachePath(phoneId)); } catch {}
}

// ── Watchdog por telefone ──

function setPhoneWatchdog(sessionId, phoneId, io, ms = config.WATCHDOG_TIMEOUT_MS) {
  const sess = sessions[sessionId];
  if (!sess) return;
  const phone = sess.phones[phoneId];
  if (!phone) return;
  clearTimeout(phone.watchdog);
  phone.watchdog = setTimeout(() => {
    if (phone.status === 'connecting') {
      console.log(`[${sessionId}:${phoneId}] Watchdog: travado em connecting — reconectando...`);
      emit(sessionId, io, 'phone_status', { phoneId, status: 'connecting', message: 'Reconectando automaticamente...' });
      connectPhone(sessionId, phoneId, io).catch(err =>
        console.error(`[${sessionId}:${phoneId}] Watchdog erro:`, err)
      );
    }
  }, ms);
}

function clearPhoneWatchdog(sessionId, phoneId) {
  const sess = sessions[sessionId];
  if (!sess) return;
  const phone = sess.phones[phoneId];
  if (!phone) return;
  clearTimeout(phone.watchdog);
  phone.watchdog = null;
}

// ── Conexão / desconexão ──

async function connectPhone(sessionId, phoneId, io) {
  const sess = getSession(sessionId);
  const phone = sess.phones[phoneId];
  if (!phone) return;

  if (phone.client) {
    try { await Promise.race([phone.client.destroy(), sleep(5000)]); } catch {}
    phone.client = null;
    await sleep(1000);
  }

  const executablePath = getChromiumPath();
  console.log(`[${sessionId}:${phoneId}] ${executablePath ? '✓ Chromium: ' + executablePath : '⚠ Chromium padrão'}`);

  phone.client = new Client({
    authStrategy: new LocalAuth({
      clientId: `${sessionId}_${phoneId}`,
      dataPath: path.join(config.sessionDir, sessionId, phoneId),
    }),
    webVersionCache: { type: 'none' },
    puppeteer: {
      headless: true,
      executablePath,
      timeout: 120000,
      protocolTimeout: 120000,
      args: [
        '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
        '--disable-gpu', '--disable-extensions', '--disable-background-networking',
        '--disable-default-apps', '--disable-sync', '--disable-translate',
        '--hide-scrollbars', '--no-first-run', '--window-size=1280,800',
        '--disable-blink-features=AutomationControlled',
      ],
    },
  });

  phone.client.on('qr', async (qr) => {
    phone.status = 'qr';
    const qrImage = await qrcode.toDataURL(qr);
    emit(sessionId, io, 'phone_qr', { phoneId, phoneName: phone.name, qr: qrImage });
    emit(sessionId, io, 'phone_status', { phoneId, status: 'qr', message: 'Escaneie o QR code' });
    emitPhonesList(sessionId, io);
  });

  phone.client.on('loading_screen', (percent) => {
    phone.status = 'connecting';
    emit(sessionId, io, 'phone_status', { phoneId, status: 'connecting', message: `Carregando... ${percent}%` });
    setPhoneWatchdog(sessionId, phoneId, io, 120000);
  });

  phone.client.on('authenticated', () => {
    phone.status = 'connecting';
    emit(sessionId, io, 'phone_status', { phoneId, status: 'connecting', message: 'Autenticado! Inicializando...' });
    setPhoneWatchdog(sessionId, phoneId, io, 120000);
    emitPhonesList(sessionId, io);
  });

  phone.client.on('ready', async () => {
    clearPhoneWatchdog(sessionId, phoneId);
    phone.status = 'ready';
    phone.lastActivityAt = Date.now();
    touchSession(sessionId);
    emit(sessionId, io, 'phone_status', { phoneId, status: 'ready', message: 'Conectado! Aguardando sincronização...' });
    emitPhonesList(sessionId, io);

    if (phone.contacts.length > 0) {
      emit(sessionId, io, 'phone_contacts', { phoneId, contacts: phone.contacts });
      emit(sessionId, io, 'phone_status', { phoneId, status: 'ready', message: `${phone.contacts.length} conversas (cache) — atualizando...` });
    }

    await sleep(3000);
    if (phone.status === 'ready') await loadContactsForPhone(sessionId, phoneId, io);
  });

  phone.client.on('disconnected', (reason) => {
    clearPhoneWatchdog(sessionId, phoneId);
    phone.status = 'disconnected';
    phone.contacts = [];
    emit(sessionId, io, 'phone_status', { phoneId, status: 'disconnected', message: `Desconectado: ${reason}` });
    emit(sessionId, io, 'phone_contacts', { phoneId, contacts: [] });
    emitPhonesList(sessionId, io);
  });

  phone.client.on('auth_failure', async () => {
    phone.status = 'disconnected';
    try { await phone.client.destroy(); } catch {}
    phone.client = null;
    emit(sessionId, io, 'phone_status', { phoneId, status: 'error', message: 'Falha na autenticação.' });
    emitPhonesList(sessionId, io);
  });

  phone.status = 'connecting';
  emit(sessionId, io, 'phone_status', { phoneId, status: 'connecting', message: 'Iniciando...' });
  emitPhonesList(sessionId, io);
  phone.client.initialize();
}

async function disconnectPhone(sessionId, phoneId) {
  const sess = sessions[sessionId];
  if (!sess) return;
  const phone = sess.phones[phoneId];
  if (!phone) return;
  clearPhoneWatchdog(sessionId, phoneId);
  if (phone.client) {
    try { await phone.client.logout(); } catch {}
    try { await phone.client.destroy(); } catch {}
    phone.client = null;
  }
  phone.status = 'disconnected';
  phone.contacts = [];
}

// ── Carregar contatos ──

async function loadContactsForPhone(sessionId, phoneId, io, attempt = 1) {
  const sess = sessions[sessionId];
  if (!sess) return;
  const phone = sess.phones[phoneId];
  if (!phone || phone.status !== 'ready' || !phone.client) return;

  const retryMs = attempt === 1 ? 4000 : 6000;

  emit(sessionId, io, 'phone_status', {
    phoneId,
    status: 'ready',
    message: `Carregando contatos${attempt > 1 ? ` (${attempt}/${config.CONTACT_LOAD_RETRIES})` : ''}...`,
  });

  try {
    const chats = await phone.client.getChats();
    console.log(`[${sessionId}:${phoneId}] getChats tentativa ${attempt}: ${chats.length} conversas`);

    if (chats.length === 0 && attempt < config.CONTACT_LOAD_RETRIES) {
      await sleep(retryMs);
      return loadContactsForPhone(sessionId, phoneId, io, attempt + 1);
    }

    phone.contacts = chats.map(c => ({
      id: c.id._serialized,
      name: c.name || c.id.user,
      isGroup: c.isGroup,
      unread: c.unreadCount || 0,
    })).sort((a, b) => a.name.localeCompare(b.name));

    await saveCachedContacts(phoneId, phone.contacts);
    emit(sessionId, io, 'phone_contacts', { phoneId, contacts: phone.contacts });
    emit(sessionId, io, 'phone_status', { phoneId, status: 'ready', message: `Pronto — ${phone.contacts.length} conversas carregadas` });
    emitPhonesList(sessionId, io);
  } catch (e) {
    console.error(`[${sessionId}:${phoneId}] Erro ao carregar contatos (tentativa ${attempt}):`, e.message);
    const transient = e.message.includes('timed out') || e.message.includes('context') || e.message.includes('Target');
    if (transient && attempt < config.CONTACT_LOAD_RETRIES) {
      await sleep(retryMs);
      return loadContactsForPhone(sessionId, phoneId, io, attempt + 1);
    }
    emit(sessionId, io, 'phone_status', { phoneId, status: 'ready', message: 'Erro ao carregar contatos.' });
  }
}

// ── Limpeza ──

async function destroyAllSessions() {
  for (const [sessionId, sess] of Object.entries(sessions)) {
    for (const phoneId of Object.keys(sess.phones)) {
      await disconnectPhone(sessionId, phoneId);
    }
  }
}

function cleanStaleSessions() {
  const ttlCutoff = Date.now() - config.SESSION_TTL_MS;
  for (const [id, sess] of Object.entries(sessions)) {
    const allDisconnected = Object.values(sess.phones).every(p => p.status === 'disconnected' && !p.client);
    const isStale = sess.lastActivityAt < ttlCutoff;
    if (allDisconnected && isStale && !sess.isSending) {
      delete sessions[id];
      console.log(`[${id}] Sessão desconectada removida da memória (TTL)`);
    }
  }
}

module.exports = {
  sessions,
  getSession,
  touchSession,
  addPhone,
  renamePhone,
  removePhone,
  connectPhone,
  disconnectPhone,
  loadContactsForPhone,
  destroyAllSessions,
  cleanStaleSessions,
  emit,
  phonesListPayload,
  emitPhonesList,
  MAX_PHONES_PER_SESSION,
};
