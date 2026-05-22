const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const multer = require('multer');
const qrcode = require('qrcode');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

process.on('uncaughtException', (err) => {
  console.error('Erro não tratado (ignorado):', err.message);
});

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// ── Diretórios ──
const uploadsDir = path.join(__dirname, '../uploads');
const cacheDir   = path.join(__dirname, '../cache');
const sessionDir = path.join(__dirname, '../.wa_sessions');
[uploadsDir, cacheDir, sessionDir].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

// ── Multer ──
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename:    (req, file, cb) => cb(null, Date.now() + '_' + file.originalname)
});
const upload = multer({ storage, limits: { fileSize: 64 * 1024 * 1024 } });

// ── Sessões ──
// sessions[id] = { id, client, status, contacts, isSending, stopRequested }
const sessions = {};

function getSession(id) {
  if (!sessions[id]) {
    sessions[id] = {
      id,
      client:        null,
      status:        'disconnected',
      contacts:      loadCachedContacts(id),
      isSending:     false,
      stopRequested: false,
    };
  }
  return sessions[id];
}

function emit(sessionId, event, data) {
  io.to(`s:${sessionId}`).emit(event, data);
}

// ── Cache de contatos ──
function loadCachedContacts(sessionId) {
  const file = path.join(cacheDir, `${sessionId}.json`);
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {}
  return [];
}

function saveCachedContacts(sessionId, contacts) {
  try {
    fs.writeFileSync(path.join(cacheDir, `${sessionId}.json`), JSON.stringify(contacts));
  } catch (_) {}
}

// ── Chromium ──
function getChromiumPath() {
  if (process.platform === 'linux') {
    const candidates = ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'];
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
    return undefined;
  }
  const base = path.join(process.env.USERPROFILE || process.env.HOME || '', '.cache', 'puppeteer', 'chrome');
  if (!fs.existsSync(base)) return undefined;
  const builds = fs.readdirSync(base).filter(d => d.startsWith('win64-'));
  if (!builds.length) return undefined;
  const exe = path.join(base, builds[builds.length - 1], 'chrome-win64', 'chrome.exe');
  return fs.existsSync(exe) ? exe : undefined;
}

// ── Conectar sessão ──
async function connectSession(sessionId) {
  const sess = getSession(sessionId);

  if (sess.client) {
    try {
      await Promise.race([sess.client.destroy(), sleep(5000)]);
    } catch (_) {}
    sess.client = null;
    await sleep(1000);
  }

  const executablePath = getChromiumPath();
  console.log(`[${sessionId}] ${executablePath ? '✓ Chromium: ' + executablePath : '⚠ Usando Chromium padrão'}`);

  sess.client = new Client({
    authStrategy: new LocalAuth({
      clientId: sessionId,
      dataPath:  path.join(sessionDir, sessionId)
    }),
    webVersionCache: { type: 'none' },
    puppeteer: {
      headless:        true,
      executablePath,
      protocolTimeout: 120000,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-extensions',
        '--window-size=1280,800',
        '--disable-blink-features=AutomationControlled',
      ]
    }
  });

  sess.client.on('qr', async (qr) => {
    sess.status = 'qr';
    const qrImage = await qrcode.toDataURL(qr);
    emit(sessionId, 'qr',     { qr: qrImage });
    emit(sessionId, 'status', { status: 'qr', message: 'Escaneie o QR code com seu celular' });
  });

  sess.client.on('loading_screen', (percent) => {
    sess.status = 'connecting';
    emit(sessionId, 'status', { status: 'connecting', message: `Carregando... ${percent}%` });
  });

  sess.client.on('authenticated', () => {
    sess.status = 'connecting';
    emit(sessionId, 'status', { status: 'connecting', message: 'Autenticado! Inicializando...' });
  });

  sess.client.on('ready', async () => {
    sess.status = 'ready';
    emit(sessionId, 'status', { status: 'ready', message: 'Conectado! Aguardando sincronização...' });

    // Serve cache imediatamente se existir
    if (sess.contacts.length > 0) {
      emit(sessionId, 'contacts', { contacts: sess.contacts });
      emit(sessionId, 'status',   { status: 'ready', message: `${sess.contacts.length} conversas (cache) — atualizando...` });
    }

    await sleep(3000);
    if (sess.status === 'ready') await loadContacts(sessionId);
  });

  sess.client.on('disconnected', (reason) => {
    sess.status   = 'disconnected';
    sess.contacts = [];
    emit(sessionId, 'status',   { status: 'disconnected', message: `Desconectado: ${reason}` });
    emit(sessionId, 'contacts', { contacts: [] });
  });

  sess.client.on('auth_failure', async () => {
    sess.status = 'disconnected';
    try { await sess.client.destroy(); } catch (_) {}
    sess.client = null;
    emit(sessionId, 'status', { status: 'error', message: 'Falha na autenticação.' });
  });

  sess.client.initialize();
}

// ── Carregar contatos ──
async function loadContacts(sessionId, attempt = 1) {
  const sess = getSession(sessionId);
  if (sess.status !== 'ready' || !sess.client) return;

  const max       = 8;
  const retryMs   = attempt === 1 ? 4000 : 6000;

  emit(sessionId, 'status', {
    status:  'ready',
    message: `Carregando contatos${attempt > 1 ? ` (${attempt}/${max})` : ''}...`
  });

  try {
    const chats = await sess.client.getChats();
    console.log(`[${sessionId}] getChats tentativa ${attempt}: ${chats.length} conversas`);

    if (chats.length === 0 && attempt < max) {
      await sleep(retryMs);
      return loadContacts(sessionId, attempt + 1);
    }

    sess.contacts = chats.map(c => ({
      id:      c.id._serialized,
      name:    c.name || c.id.user,
      isGroup: c.isGroup,
      unread:  c.unreadCount || 0
    })).sort((a, b) => a.name.localeCompare(b.name));

    saveCachedContacts(sessionId, sess.contacts);
    emit(sessionId, 'contacts', { contacts: sess.contacts });
    emit(sessionId, 'status',   { status: 'ready', message: `Pronto — ${sess.contacts.length} conversas carregadas` });
  } catch (e) {
    console.error(`[${sessionId}] Erro ao carregar contatos (tentativa ${attempt}):`, e.message);
    const transient = e.message.includes('timed out') || e.message.includes('context') || e.message.includes('Target');
    if (transient && attempt < max) {
      await sleep(retryMs);
      return loadContacts(sessionId, attempt + 1);
    }
    emit(sessionId, 'status', { status: 'ready', message: 'Erro ao carregar contatos. Clique em Recarregar.' });
  }
}

// ── Socket.IO ──
io.on('connection', (socket) => {
  socket.on('join_session', (rawId) => {
    const sessionId = String(rawId || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 30);
    if (!sessionId) return;

    socket.join(`s:${sessionId}`);
    const sess = getSession(sessionId);

    socket.emit('session_joined', { sessionId });
    socket.emit('status', {
      status:  sess.status,
      message: sess.status === 'ready'      ? `Pronto — ${sess.contacts.length} conversas carregadas`
             : sess.status === 'connecting' ? 'Conectando...'
             : sess.status === 'qr'         ? 'Aguardando leitura do QR code...'
             : 'Desconectado'
    });

    if (sess.contacts.length > 0) {
      socket.emit('contacts', { contacts: sess.contacts });
    }
  });
});

// ── API ──
function sessionMiddleware(req, res, next) {
  const id = String(req.params.sessionId || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 30);
  if (!id) return res.status(400).json({ error: 'sessionId inválido' });
  req.sessionId = id;
  req.sess = getSession(id);
  next();
}

app.get('/api/:sessionId/status', sessionMiddleware, (req, res) => {
  const s = req.sess;
  res.json({ status: s.status, contacts: s.contacts.length });
});

app.post('/api/:sessionId/connect', sessionMiddleware, (req, res) => {
  const s = req.sess;
  if (s.status === 'ready')      return res.json({ ok: true, message: 'Já conectado' });
  if (s.status === 'connecting') return res.json({ ok: true, message: 'Já conectando...' });
  connectSession(req.sessionId);
  res.json({ ok: true, message: 'Iniciando conexão...' });
});

app.post('/api/:sessionId/disconnect', sessionMiddleware, async (req, res) => {
  const s = req.sess;
  if (s.client) {
    try { await s.client.logout(); }  catch (_) {}
    try { await s.client.destroy(); } catch (_) {}
    s.client = null;
  }
  s.status   = 'disconnected';
  s.contacts = [];
  emit(req.sessionId, 'status',   { status: 'disconnected', message: 'Desconectado' });
  emit(req.sessionId, 'contacts', { contacts: [] });
  res.json({ ok: true });
});

app.post('/api/:sessionId/reload-contacts', sessionMiddleware, async (req, res) => {
  if (req.sess.status !== 'ready') return res.status(400).json({ error: 'Não conectado' });
  await loadContacts(req.sessionId);
  res.json({ ok: true, count: req.sess.contacts.length });
});

app.post('/api/:sessionId/upload', sessionMiddleware, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });
  res.json({
    ok:       true,
    filename: req.file.filename,
    original: req.file.originalname,
    size:     req.file.size,
    mimetype: req.file.mimetype,
    path:     `/uploads/${req.file.filename}`
  });
});

app.post('/api/:sessionId/stop', sessionMiddleware, (req, res) => {
  req.sess.stopRequested = true;
  res.json({ ok: true });
});

app.post('/api/:sessionId/send', sessionMiddleware, async (req, res) => {
  const sess = req.sess;
  const sid  = req.sessionId;

  if (sess.status !== 'ready')  return res.status(400).json({ error: 'WhatsApp não conectado' });
  if (sess.isSending)           return res.status(400).json({ error: 'Envio já em andamento' });

  const { contactIds, message, filename, delayMs } = req.body;
  if (!contactIds?.length)           return res.status(400).json({ error: 'Nenhum contato selecionado' });
  if (!message?.trim() && !filename) return res.status(400).json({ error: 'Mensagem ou arquivo obrigatório' });

  res.json({ ok: true, message: 'Envio iniciado' });

  sess.isSending     = true;
  sess.stopRequested = false;

  const total = contactIds.length;
  const delay = Math.max(delayMs || 3000, 1500);

  emit(sid, 'send_start', { total });

  let media = null;
  if (filename) {
    const filePath = path.join(uploadsDir, filename);
    if (fs.existsSync(filePath)) media = MessageMedia.fromFilePath(filePath);
  }

  for (let i = 0; i < contactIds.length; i++) {
    if (sess.stopRequested) { emit(sid, 'send_stopped', { index: i, total }); break; }

    const contact = sess.contacts.find(c => c.id === contactIds[i]);
    const name    = contact?.name || contactIds[i];

    emit(sid, 'send_progress', { index: i, total, name, status: 'sending' });

    try {
      if (media && message?.trim()) {
        await sess.client.sendMessage(contactIds[i], media, { caption: message.trim() });
      } else if (media) {
        await sess.client.sendMessage(contactIds[i], media);
      } else {
        await sess.client.sendMessage(contactIds[i], message.trim());
      }
      emit(sid, 'send_progress', { index: i, total, name, status: 'done' });
    } catch (err) {
      console.error(`[${sid}] Erro ao enviar para ${name}:`, err.message);
      emit(sid, 'send_progress', { index: i, total, name, status: 'error', error: err.message });
    }

    if (i < contactIds.length - 1 && !sess.stopRequested) await sleep(delay);
  }

  if (filename) {
    try { fs.unlinkSync(path.join(uploadsDir, filename)); } catch (_) {}
  }

  sess.isSending = false;
  emit(sid, 'send_done', { total });
});

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

server.listen(PORT, () => {
  console.log(`\n🚀 WA Bulk Sender rodando em http://localhost:${PORT}\n`);
});
