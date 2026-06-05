const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const multer = require('multer');
const qrcode = require('qrcode');
const path = require('path');
const fs = require('fs');
const os = require('os');
const XLSX = require('xlsx');
const { spawn } = require('child_process');

const {
  sanitizeSessionId,
  normalizePhone,
  removeNinthDigit,
  personalizeMessage,
  sleep,
  MIN_SEND_DELAY_MS,
  DEFAULT_SEND_DELAY_MS,
  MAX_CONTACTS_PER_SEND,
  MAX_FILE_SIZE_BYTES,
  MAX_SHEET_ROWS,
  CONTACT_LOAD_RETRIES,
} = require('./utils');
const { isNewerVersion, fetchLatestRelease, downloadFile } = require('./updater');
const { version: CURRENT_VERSION } = require('../package.json');

// ── Auto-update ──
const GITHUB_OWNER    = 'alclord';
const GITHUB_REPO     = 'arx-send';
const ASSET_NAME      = 'ARX-Send-Setup.exe';
const UPDATES_ENABLED = Boolean(process.pkg) || process.env.CHECK_UPDATES === 'true';

// status: idle | checking | up_to_date | available | downloading | ready
const updateState = {
  status:      'idle',
  version:     null,
  progress:    0,
  filePath:    null,
  downloadUrl: null,
};
let updateCheckInProgress = false;

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

process.on('uncaughtException', (err) => {
  console.error('Erro não tratado:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('Promise rejeitada sem tratamento:', reason);
});

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Rota de uploads restrita: exige que o arquivo exista dentro do uploadsDir
app.get('/uploads/:file', async (req, res) => {
  const filename = path.basename(req.params.file);
  const filePath = path.join(uploadsDir, filename);
  try {
    await fs.promises.access(filePath);
  } catch {
    return res.status(404).end();
  }
  res.sendFile(filename, { root: uploadsDir }, (err) => {
    if (err && !res.headersSent) res.status(500).end();
  });
});

// ── Diretórios ──
// Quando empacotado com pkg (process.pkg = true), usa AppData para arquivos graváveis
const appDataBase = process.pkg
  ? path.join(process.env.LOCALAPPDATA || os.homedir(), 'arx-send')
  : path.join(__dirname, '..');

const uploadsDir = path.join(appDataBase, 'uploads');
const cacheDir   = path.join(appDataBase, 'cache');
const sessionDir = process.platform === 'win32'
  ? path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'arx-send', 'sessions')
  : path.join(appDataBase, '.wa_sessions');
[uploadsDir, cacheDir, sessionDir].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

// Remove uploads com mais de 2 horas que não foram usados em nenhum envio
async function cleanOrphanedUploads() {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  try {
    const files = await fs.promises.readdir(uploadsDir);
    await Promise.all(files.map(async (f) => {
      try {
        const fp   = path.join(uploadsDir, f);
        const stat = await fs.promises.stat(fp);
        if (stat.mtimeMs < cutoff) await fs.promises.unlink(fp);
      } catch (err) {
        console.warn(`[cleanup] Erro ao remover arquivo ${f}:`, err.message);
      }
    }));
  } catch (err) {
    console.warn('[cleanup] Erro ao listar uploads:', err.message);
  }
}
cleanOrphanedUploads();
setInterval(cleanOrphanedUploads, 60 * 60 * 1000);

// Remove sessões desconectadas sem cliente ativo há mais de 1 hora
function cleanStaleSessions() {
  for (const [id, sess] of Object.entries(sessions)) {
    if (sess.status === 'disconnected' && !sess.client && !sess.isSending) {
      delete sessions[id];
    }
  }
}
setInterval(cleanStaleSessions, 60 * 60 * 1000);

// ── Multer ──
const ALLOWED_UPLOAD_EXTS = new Set([
  '.jpg','.jpeg','.png','.gif','.webp','.bmp',
  '.mp4','.mov','.avi','.mkv','.3gp',
  '.mp3','.ogg','.wav','.aac','.m4a',
  '.pdf','.doc','.docx','.xls','.xlsx','.ppt','.pptx','.zip','.txt'
]);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename:    (req, file, cb) => cb(null, Date.now() + '_' + path.basename(file.originalname))
});
const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_UPLOAD_EXTS.has(ext)) return cb(null, true);
    cb(new Error(`Tipo de arquivo não permitido: ${ext}`));
  }
});

// ── Sessões ──
// sessions[id] = { id, client, status, contacts, isSending, stopRequested, watchdog }
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
      watchdog:      null,
    };
  }
  return sessions[id];
}

function setWatchdog(sessionId, ms = 180000) {
  const sess = getSession(sessionId);
  clearTimeout(sess.watchdog);
  sess.watchdog = setTimeout(() => {
    if (sess.status === 'connecting') {
      console.log(`[${sessionId}] Watchdog: travado em connecting — reconectando...`);
      emit(sessionId, 'status', { status: 'connecting', message: 'Reconectando automaticamente...' });
      connectSession(sessionId).catch(err => console.error(`[${sessionId}] Watchdog erro ao reconectar:`, err));
    }
  }, ms);
}

function clearWatchdog(sessionId) {
  const sess = getSession(sessionId);
  clearTimeout(sess.watchdog);
  sess.watchdog = null;
}

function emit(sessionId, event, data) {
  io.to(`s:${sessionId}`).emit(event, data);
}

// ── Cache de contatos ──
function loadCachedContacts(sessionId) {
  const file = path.join(cacheDir, `${sessionId}.json`);
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
      path.join(cacheDir, `${sessionId}.json`),
      JSON.stringify(contacts)
    );
  } catch (err) {
    console.warn(`[${sessionId}] Falha ao salvar cache de contatos:`, err.message);
  }
}

// ── Chromium ──
function getChromiumPath() {
  if (process.platform === 'linux') {
    const candidates = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
    return undefined;
  }
  // Windows: tenta Chrome instalado primeiro (mais rápido e sempre disponível)
  const winCandidates = [
    path.join(process.env.PROGRAMFILES        || 'C:\\Program Files',        'Google\\Chrome\\Application\\chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(process.env.LOCALAPPDATA        || '', 'Google\\Chrome\\Application\\chrome.exe'),
  ];
  for (const p of winCandidates) {
    if (p && fs.existsSync(p)) return p;
  }
  // Fallback: Chromium do Puppeteer
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
    } catch (err) {
      console.warn(`[${sessionId}] Erro ao destruir cliente anterior:`, err.message);
    }
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
      timeout:         120000,
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
    emit(sessionId, 'qr',     { qr: qrImage });
    emit(sessionId, 'status', { status: 'qr', message: 'Escaneie o QR code com seu celular' });
  });

  sess.client.on('loading_screen', (percent) => {
    sess.status = 'connecting';
    emit(sessionId, 'status', { status: 'connecting', message: `Carregando... ${percent}%` });
    setWatchdog(sessionId, 120000); // 2 min para sair do loading
  });

  sess.client.on('authenticated', () => {
    sess.status = 'connecting';
    emit(sessionId, 'status', { status: 'connecting', message: 'Autenticado! Inicializando...' });
    setWatchdog(sessionId, 120000);
  });

  sess.client.on('ready', async () => {
    clearWatchdog(sessionId);
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
    clearWatchdog(sessionId);
    sess.status   = 'disconnected';
    sess.contacts = [];
    emit(sessionId, 'status',   { status: 'disconnected', message: `Desconectado: ${reason}` });
    emit(sessionId, 'contacts', { contacts: [] });
  });

  sess.client.on('auth_failure', async () => {
    sess.status = 'disconnected';
    try { await sess.client.destroy(); } catch (err) {
      console.warn(`[${sessionId}] Erro ao destruir cliente após falha de auth:`, err.message);
    }
    sess.client = null;
    emit(sessionId, 'status', { status: 'error', message: 'Falha na autenticação.' });
  });

  sess.client.initialize();
}

// ── Carregar contatos ──
async function loadContacts(sessionId, attempt = 1) {
  const sess = getSession(sessionId);
  if (sess.status !== 'ready' || !sess.client) return;

  const retryMs = attempt === 1 ? 4000 : 6000;

  emit(sessionId, 'status', {
    status:  'ready',
    message: `Carregando contatos${attempt > 1 ? ` (${attempt}/${CONTACT_LOAD_RETRIES})` : ''}...`
  });

  try {
    const chats = await sess.client.getChats();
    console.log(`[${sessionId}] getChats tentativa ${attempt}: ${chats.length} conversas`);

    if (chats.length === 0 && attempt < CONTACT_LOAD_RETRIES) {
      await sleep(retryMs);
      return loadContacts(sessionId, attempt + 1);
    }

    sess.contacts = chats.map(c => ({
      id:      c.id._serialized,
      name:    c.name || c.id.user,
      isGroup: c.isGroup,
      unread:  c.unreadCount || 0
    })).sort((a, b) => a.name.localeCompare(b.name));

    await saveCachedContacts(sessionId, sess.contacts);
    emit(sessionId, 'contacts', { contacts: sess.contacts });
    emit(sessionId, 'status',   { status: 'ready', message: `Pronto — ${sess.contacts.length} conversas carregadas` });
  } catch (e) {
    console.error(`[${sessionId}] Erro ao carregar contatos (tentativa ${attempt}):`, e.message);
    const transient = e.message.includes('timed out') || e.message.includes('context') || e.message.includes('Target');
    if (transient && attempt < CONTACT_LOAD_RETRIES) {
      await sleep(retryMs);
      return loadContacts(sessionId, attempt + 1);
    }
    emit(sessionId, 'status', { status: 'ready', message: 'Erro ao carregar contatos. Clique em Recarregar.' });
  }
}

// ── Auto-update: funções ──
function emitUpdateStatus() {
  io.emit('update_status', {
    currentVersion: CURRENT_VERSION,
    status:         updateState.status,
    version:        updateState.version,
    progress:       updateState.progress,
  });
}

async function downloadUpdate() {
  if (updateState.status === 'ready') return;
  updateState.status   = 'downloading';
  updateState.progress = 0;
  emitUpdateStatus();

  const dest = path.join(os.tmpdir(), `ARX-Send-Setup-${updateState.version}.exe`);
  try {
    await downloadFile(updateState.downloadUrl, dest, (pct) => {
      updateState.progress = pct;
      emitUpdateStatus();
    });
    updateState.status   = 'ready';
    updateState.filePath = dest;
    updateState.progress = 100;
    emitUpdateStatus();
    console.log(`[update] Versão ${updateState.version} pronta em: ${dest}`);
  } catch (err) {
    console.warn('[update] Erro ao baixar atualização:', err.message);
    updateState.status   = 'available';
    updateState.progress = 0;
    emitUpdateStatus();
    fs.promises.unlink(dest).catch(() => {});
  }
}

async function checkForUpdates() {
  if (updateCheckInProgress) return;
  if (updateState.status === 'downloading' || updateState.status === 'ready') return;

  updateCheckInProgress = true;
  updateState.status = 'checking';
  emitUpdateStatus();

  try {
    const release = await fetchLatestRelease(GITHUB_OWNER, GITHUB_REPO);

    if (!release.tag_name) {
      // Sem releases publicadas ainda
      updateState.status = 'idle';
      emitUpdateStatus();
      return;
    }

    if (!isNewerVersion(release.tag_name, CURRENT_VERSION)) {
      updateState.status  = 'up_to_date';
      updateState.version = release.tag_name;
      emitUpdateStatus();
      return;
    }

    const asset = release.assets?.find(a => a.name === ASSET_NAME);
    if (!asset) {
      console.warn(`[update] Asset "${ASSET_NAME}" não encontrado na release ${release.tag_name}`);
      updateState.status = 'idle';
      emitUpdateStatus();
      return;
    }

    updateState.version     = release.tag_name;
    updateState.downloadUrl = asset.browser_download_url;
    updateState.status      = 'available';
    emitUpdateStatus();

    await downloadUpdate();
  } catch (err) {
    console.warn('[update] Erro ao verificar atualizações:', err.message);
    updateState.status = 'idle';
    emitUpdateStatus();
  } finally {
    updateCheckInProgress = false;
  }
}

// ── Socket.IO ──
io.on('connection', (socket) => {
  socket.on('join_session', (rawId) => {
    const sessionId = sanitizeSessionId(rawId);
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

    // Envia estado atual da atualização ao conectar
    socket.emit('update_status', {
      currentVersion: CURRENT_VERSION,
      status:         updateState.status,
      version:        updateState.version,
      progress:       updateState.progress,
    });
  });
});

// ── API ──
function sessionMiddleware(req, res, next) {
  const id = sanitizeSessionId(req.params.sessionId);
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
    try { await s.client.logout(); } catch (err) {
      console.warn(`[${req.sessionId}] Erro ao fazer logout:`, err.message);
    }
    try { await s.client.destroy(); } catch (err) {
      console.warn(`[${req.sessionId}] Erro ao destruir cliente:`, err.message);
    }
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

// Trata erros do multer (fileFilter rejeitou, arquivo muito grande, etc.)
app.use((err, req, res, next) => {
  if (err?.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'Arquivo muito grande (máx. 64 MB)' });
  if (err instanceof multer.MulterError || err?.message?.startsWith('Tipo de arquivo')) {
    return res.status(400).json({ error: err.message });
  }
  next(err);
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

  const { contactIds, message, filename, delayMs, contactsData } = req.body;
  if (!contactIds?.length)                       return res.status(400).json({ error: 'Nenhum contato selecionado' });
  if (contactIds.length > MAX_CONTACTS_PER_SEND) return res.status(400).json({ error: `Máximo de ${MAX_CONTACTS_PER_SEND} contatos por envio` });
  if (!message?.trim() && !filename)             return res.status(400).json({ error: 'Mensagem ou arquivo obrigatório' });

  res.json({ ok: true, message: 'Envio iniciado' });

  sess.isSending     = true;
  sess.stopRequested = false;

  const total = contactIds.length;
  const delay = Math.max(delayMs || DEFAULT_SEND_DELAY_MS, MIN_SEND_DELAY_MS);

  emit(sid, 'send_start', { total });

  try {
    let media = null;
    if (filename) {
      const safeFilename = path.basename(filename);
      const filePath = path.join(uploadsDir, safeFilename);
      if (fs.existsSync(filePath)) media = MessageMedia.fromFilePath(filePath);
    }

    for (let i = 0; i < contactIds.length; i++) {
      if (sess.stopRequested) { emit(sid, 'send_stopped', { index: i, total }); break; }

      const contact = sess.contacts.find(c => c.id === contactIds[i]);
      const name    = contact?.name || contactIds[i];

      emit(sid, 'send_progress', { index: i, total, name, status: 'sending' });

      // Personalizar mensagem com variáveis da planilha
      const rowData  = contactsData?.[contactIds[i]] || {};
      const finalMsg = personalizeMessage(message?.trim() || '', rowData);

      const sendTo = async (id) => {
        if (media && finalMsg) {
          await sess.client.sendMessage(id, media, { caption: finalMsg });
        } else if (media) {
          await sess.client.sendMessage(id, media);
        } else {
          await sess.client.sendMessage(id, finalMsg);
        }
      };

      let sent = false;
      try {
        await sendTo(contactIds[i]);
        sent = true;
      } catch (err) {
        // Se falhou com erro de LID, tenta sem o nono dígito
        const isLidError = err.message.includes('LID') || err.message.includes('lid');
        const altId = isLidError ? removeNinthDigit(contactIds[i]) : null;
        if (altId) {
          try {
            await sendTo(altId);
            sent = true;
          } catch (err2) {
            console.error(`[${sid}] Erro ao enviar para ${name}:`, err2.message);
            emit(sid, 'send_progress', { index: i, total, name, status: 'error', error: err2.message });
          }
        } else {
          console.error(`[${sid}] Erro ao enviar para ${name}:`, err.message);
          emit(sid, 'send_progress', { index: i, total, name, status: 'error', error: err.message });
        }
      }
      if (sent) emit(sid, 'send_progress', { index: i, total, name, status: 'done' });

      if (i < contactIds.length - 1 && !sess.stopRequested) await sleep(delay);
    }

    emit(sid, 'send_done', { total });
  } finally {
    sess.isSending = false;
  }
});

// ── Rotas de importação de planilha ──
app.post('/api/:sessionId/parse-sheet', sessionMiddleware, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });
  try {
    const wb   = XLSX.readFile(req.file.path, { sheetRows: MAX_SHEET_ROWS });
    const ws   = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
    if (!rows.length) {
      fs.promises.unlink(req.file.path).catch(err => console.warn('[parse-sheet] Falha ao remover arquivo vazio:', err.message));
      return res.status(400).json({ error: 'Planilha vazia' });
    }
    const headers = rows[0].map(String);
    const preview = rows.slice(1, 4).map(r => headers.map((_, i) => String(r[i] ?? '')));
    res.json({ ok: true, headers, preview, filename: req.file.filename });
  } catch (e) {
    fs.promises.unlink(req.file.path).catch(err => console.warn('[parse-sheet] Falha ao remover arquivo com erro:', err.message));
    res.status(400).json({ error: 'Erro ao ler planilha: ' + e.message });
  }
});

app.post('/api/:sessionId/extract-phones', sessionMiddleware, async (req, res) => {
  const { filename, column, nameColumn } = req.body;
  if (!filename) return res.status(400).json({ error: 'Arquivo não informado' });
  const filePath = path.join(uploadsDir, path.basename(filename));
  try {
    await fs.promises.access(filePath);
  } catch {
    return res.status(400).json({ error: 'Arquivo não encontrado' });
  }
  try {
    const wb      = XLSX.readFile(filePath, { sheetRows: MAX_SHEET_ROWS });
    const ws      = wb.Sheets[wb.SheetNames[0]];
    const rows    = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
    const headers = rows[0].map(String);
    const colIdx  = parseInt(column);
    const nameIdx = nameColumn !== undefined && nameColumn !== '' ? parseInt(nameColumn) : -1;
    const contacts = [];
    for (let i = 1; i < rows.length; i++) {
      const phone = normalizePhone(rows[i][colIdx]);
      if (!phone) continue;
      const name = nameIdx >= 0 ? String(rows[i][nameIdx] || phone) : phone;
      const rowData = {};
      headers.forEach((h, idx) => { rowData[h] = String(rows[i][idx] ?? ''); });
      contacts.push({ id: phone, name, isGroup: false, imported: true, rowData });
    }
    fs.promises.unlink(filePath).catch(err => console.warn('[extract-phones] Falha ao remover arquivo:', err.message));
    res.json({ ok: true, contacts, headers });
  } catch (e) {
    res.status(400).json({ error: 'Erro ao processar planilha: ' + e.message });
  }
});

// ── Rotas de atualização ──
app.get('/api/update/status', (req, res) => {
  res.json({
    currentVersion: CURRENT_VERSION,
    status:         updateState.status,
    version:        updateState.version,
    progress:       updateState.progress,
  });
});

app.post('/api/update/install', async (req, res) => {
  if (updateState.status !== 'ready' || !updateState.filePath) {
    return res.status(400).json({ error: 'Nenhuma atualização pronta para instalar' });
  }

  // Verifica se o arquivo ainda existe (pode ter sido limpo pelo SO)
  try {
    await fs.promises.access(updateState.filePath);
  } catch {
    updateState.status   = 'available';
    updateState.filePath = null;
    emitUpdateStatus();
    downloadUpdate().catch(err => console.warn('[update] Erro ao rebaixar:', err.message));
    return res.status(400).json({ error: 'Arquivo perdido, rebaixando. Tente novamente em instantes.' });
  }

  const sending = Object.values(sessions).some(s => s.isSending);
  if (sending) {
    return res.status(400).json({ error: 'Aguarde o disparo em andamento terminar antes de atualizar.' });
  }

  res.json({ ok: true });

  setTimeout(() => {
    try {
      spawn(updateState.filePath, ['/VERYSILENT', '/CLOSEAPPLICATIONS'], {
        detached: true,
        stdio:    'ignore',
      }).unref();
    } catch (err) {
      console.error('[update] Falha ao iniciar installer:', err.message);
    }
    process.exit(0);
  }, 800);
});

server.listen(PORT, () => {
  console.log(`\n🚀 ARX Send v${CURRENT_VERSION} rodando em http://localhost:${PORT}\n`);
  // Abre o navegador automaticamente quando rodando como .exe empacotado
  if (process.pkg) {
    const safePort = parseInt(PORT, 10);
    if (safePort > 0 && safePort < 65536) {
      const { exec } = require('child_process');
      setTimeout(() => exec(`start http://localhost:${safePort}`), 1500);
    }
  }
});

// Verifica atualizações 30s após o servidor subir, depois a cada 6 horas
if (UPDATES_ENABLED) {
  setTimeout(checkForUpdates, 30 * 1000);
  setInterval(checkForUpdates, 6 * 60 * 60 * 1000);
}
