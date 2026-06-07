const socket = io();
const isElectron = !!(window.electronAPI && window.electronAPI.isElectron);

if (isElectron && window.electronAPI.onUpdateStatus) {
  window.electronAPI.onUpdateStatus(({ status, version, progress, message }) => {
    const text = document.getElementById('updateText');
    const progWrap = document.getElementById('updateProgWrap');
    const progBar = document.getElementById('updateProgBar');
    const pctEl = document.getElementById('updatePct');
    const btn = document.getElementById('updateBtn');

    if (status === 'available') {
      text.innerHTML = `Nova versão <strong>${version}</strong> disponível — baixando...`;
      progWrap.style.display = 'none';
      pctEl.textContent = '';
      btn.style.display = 'none';
    } else if (status === 'downloading') {
      text.innerHTML = `Baixando atualização <strong>${version}</strong>...`;
      progWrap.style.display = '';
      progBar.style.width = progress + '%';
      pctEl.textContent = progress + '%';
      btn.style.display = 'none';
    } else if (status === 'ready') {
      text.innerHTML = `✅ Atualização <strong>${version}</strong> pronta para instalar`;
      progWrap.style.display = 'none';
      pctEl.textContent = '';
      btn.style.display = '';
    } else if (status === 'error') {
      text.textContent = message || 'Erro ao buscar atualização.';
      progWrap.style.display = 'none';
      pctEl.textContent = '';
    }
  });
}

// ── Sessão ──
let sessionId = null;

function enterSession() {
  const raw = document.getElementById('sessionInput').value.trim();
  const id = raw.toLowerCase().replace(/[^a-z0-9_-]/g, '');
  if (!id || id.length < 2) {
    document.getElementById('loginError').textContent = 'Nome deve ter ao menos 2 caracteres válidos.';
    return;
  }
  sessionId = id;
  localStorage.setItem('wa_session', id);
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('sessionBadge').textContent = '# ' + id;
  socket.emit('join_session', id);
}

function clearLoginError() {
  document.getElementById('loginError').textContent = '';
}

function switchSession() {
  if (!confirm('Trocar de sessão? Você sairá da sessão atual.')) return;
  localStorage.removeItem('wa_session');
  location.reload();
}

const saved = localStorage.getItem('wa_session');
if (saved) {
  document.getElementById('sessionInput').value = saved;
  socket.on('connect', () => { if (!sessionId) enterSession(); });
} else {
  document.getElementById('loginScreen').classList.remove('hidden');
}

socket.on('session_joined', ({ sessionId: id }) => {
  sessionId = id;
  document.getElementById('sessionBadge').textContent = '# ' + id;
  document.getElementById('loginScreen').classList.add('hidden');
});

// ── Estado ──
let contacts = [];
let importedContacts = [];
let sheetHeaders = [];
let selectedIds = new Set();
let currentFilter = 'all';
let sendMode = 'text';
let selectedDelay = 3000;
let uploadedFile = null;
let isSending = false;
let waStatus = 'disconnected';
let importFilename = null;

// ── Socket events ──
socket.on('status', ({ status, message }) => {
  waStatus = status;
  updateStatusUI(status, message);
  if (status === 'ready' || status === 'connecting') {
    document.getElementById('qrModal').classList.remove('show');
  }
  if (status === 'error') {
    document.getElementById('qrLoading').classList.remove('show');
    document.getElementById('qrImage').style.display = 'none';
    document.getElementById('qrInstructions').style.display = 'none';
    document.getElementById('qrSteps').style.display = 'none';
    document.getElementById('qrErrorMsg').textContent = message || 'Falha na conexão.';
    document.getElementById('qrError').classList.add('show');
    document.getElementById('qrModal').classList.add('show');
  }
});

socket.on('qr', ({ qr }) => {
  document.getElementById('qrLoading').classList.remove('show');
  document.getElementById('qrError').classList.remove('show');
  document.getElementById('qrImage').src = qr;
  document.getElementById('qrImage').style.display = '';
  document.getElementById('qrInstructions').style.display = '';
  document.getElementById('qrSteps').style.display = '';
  document.getElementById('qrModal').classList.add('show');
});

socket.on('contacts', ({ contacts: c }) => {
  contacts = c;
  for (const id of selectedIds) {
    if (!contacts.find(x => x.id === id)) selectedIds.delete(id);
  }
  renderList();
  updateSendBtn();
});

socket.on('send_start', ({ total }) => {
  isSending = true;
  document.getElementById('progressBox').classList.add('show');
  document.getElementById('progLog').innerHTML = '';
  document.getElementById('progBar').style.width = '0%';
  document.getElementById('progLabel').textContent = 'Iniciando...';
  document.getElementById('progCounter').textContent = `0 / ${total}`;
  document.getElementById('sendBtn').style.display = 'none';
  document.getElementById('stopBtn').style.display = '';
});

socket.on('send_progress', ({ index, total, name, status, error }) => {
  const pct = Math.round(((index + 1) / total) * 100);
  document.getElementById('progBar').style.width = pct + '%';
  document.getElementById('progCounter').textContent = `${index + 1} / ${total}`;
  const log = document.getElementById('progLog');
  if (status === 'sending') {
    document.getElementById('progLabel').textContent = `Enviando para ${name}...`;
    const el = document.createElement('div');
    el.className = 'log-sending'; el.textContent = `⏳ ${name}`; el.id = 'log_' + index;
    log.appendChild(el);
  } else if (status === 'done') {
    const el = document.getElementById('log_' + index) || log.lastChild;
    if (el) { el.className = 'log-done'; el.textContent = `✓ ${name}`; }
  } else if (status === 'error') {
    const el = document.getElementById('log_' + index) || log.lastChild;
    if (el) { el.className = 'log-error'; el.textContent = `✗ ${name}: ${error}`; }
  }
  log.scrollTop = log.scrollHeight;
});

socket.on('send_done', () => {
  isSending = false;
  document.getElementById('progLabel').textContent = '✅ Disparo concluído!';
  document.getElementById('progBar').style.width = '100%';
  document.getElementById('sendBtn').style.display = '';
  document.getElementById('stopBtn').style.display = 'none';
  updateSendBtn();
  if (isElectron && window.electronAPI.showNotification) {
    window.electronAPI.showNotification({ title: 'ARX Send', body: '✅ Disparo concluído!' });
  }
});

socket.on('send_stopped', () => {
  isSending = false;
  document.getElementById('progLabel').textContent = '⏹ Parado';
  document.getElementById('sendBtn').style.display = '';
  document.getElementById('stopBtn').style.display = 'none';
  updateSendBtn();
});

socket.on('update_status', ({ status, version, progress }) => {
  const banner = document.getElementById('updateBanner');
  const text = document.getElementById('updateText');
  const progWrap = document.getElementById('updateProgWrap');
  const progBar = document.getElementById('updateProgBar');
  const pctEl = document.getElementById('updatePct');
  const btn = document.getElementById('updateBtn');

  if (status === 'available') {
    banner.classList.add('show');
    text.innerHTML = `Nova versão <strong>${version}</strong> disponível — baixando...`;
    progWrap.style.display = 'none';
    pctEl.textContent = '';
    btn.style.display = 'none';
  } else if (status === 'downloading') {
    banner.classList.add('show');
    text.innerHTML = `Baixando atualização <strong>${version}</strong>...`;
    progWrap.style.display = '';
    progBar.style.width = progress + '%';
    pctEl.textContent = progress + '%';
    btn.style.display = 'none';
  } else if (status === 'ready') {
    banner.classList.add('show');
    text.innerHTML = `✅ Atualização <strong>${version}</strong> pronta para instalar`;
    progWrap.style.display = 'none';
    pctEl.textContent = '';
    btn.style.display = '';
    btn.disabled = false;
    btn.textContent = 'Reiniciar e instalar';
  } else {
    banner.classList.remove('show');
  }
});

async function installUpdate() {
  if (!confirm('O aplicativo será fechado para instalar a atualização e reabrirá automaticamente.\n\nDeseja continuar?')) return;

  if (isElectron && window.electronAPI.installUpdate) {
    await window.electronAPI.installUpdate();
    return;
  }

  const btn = document.getElementById('updateBtn');
  const text = document.getElementById('updateText');
  btn.disabled = true;
  btn.textContent = 'Instalando...';
  text.textContent = 'Instalando atualização — o app reabrirá em instantes...';
  try {
    await fetch('/api/update/install', { method: 'POST' });
  } catch { }
}

async function checkForUpdates() {
  const text = document.getElementById('updateText');
  text.textContent = 'Verificando atualizações...';

  if (isElectron && window.electronAPI.checkForUpdates) {
    await window.electronAPI.checkForUpdates();
    return;
  }

  try {
    const res = await fetch('/api/update/check');
    const data = await res.json();
    if (data.updateAvailable) {
      text.innerHTML = `Nova versão <strong>${data.latestVersion}</strong> disponível`;
      document.getElementById('updateBtn').style.display = '';
    } else {
      text.textContent = 'Você já está na versão mais recente.';
    }
  } catch {
    text.textContent = 'Erro ao verificar atualizações.';
  }
}

// ── API helpers ──
function api(path, opts) {
  return fetch(`/api/${sessionId}${path}`, opts);
}

// ── QR ──
function closeQrModal() { document.getElementById('qrModal').classList.remove('show'); }

function showQrLoading(msg) {
  document.getElementById('qrLoadingMsg').textContent = msg || 'Abrindo navegador, aguarde...';
  document.getElementById('qrLoading').classList.add('show');
  document.getElementById('qrError').classList.remove('show');
  document.getElementById('qrImage').style.display = 'none';
  document.getElementById('qrImage').src = '';
  document.getElementById('qrInstructions').style.display = 'none';
  document.getElementById('qrSteps').style.display = 'none';
  document.getElementById('qrModal').classList.add('show');
}

// ── UI ──
function updateStatusUI(status, message) {
  const dot = document.getElementById('statusDot');
  const txt = document.getElementById('statusText');
  const btn = document.getElementById('connectBtn');
  dot.className = 'dot ' + status;
  txt.textContent = message || status;
  if (status === 'ready') {
    btn.textContent = 'Desconectar'; btn.className = 'btn-connect disconnect'; btn.disabled = false;
  } else if (status === 'connecting') {
    btn.textContent = 'Conectando...'; btn.className = 'btn-connect'; btn.disabled = true;
  } else if (status === 'qr') {
    btn.textContent = 'Novo QR'; btn.className = 'btn-connect'; btn.disabled = false;
  } else {
    btn.textContent = 'Conectar'; btn.className = 'btn-connect'; btn.disabled = false;
  }
}

async function toggleConnect() {
  if (!sessionId) return;
  if (waStatus === 'ready') {
    await api('/disconnect', { method: 'POST' });
  } else if (waStatus !== 'connecting') {
    showQrLoading(waStatus === 'qr' ? 'Gerando novo QR code...' : 'Abrindo navegador, aguarde...');
    await api('/connect', { method: 'POST' });
  }
}

async function reloadContacts() {
  if (waStatus !== 'ready') return;
  await api('/reload-contacts', { method: 'POST' });
}

// ── Contacts ──
function setFilter(f, btn) {
  currentFilter = f;
  document.querySelectorAll('.filter-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderList();
}

function renderList() {
  const q = document.getElementById('searchInput').value.toLowerCase().trim();
  const list = document.getElementById('contactsList');
  if (!contacts.length) {
    list.innerHTML = `<div class="empty-state"><div class="icon">${waStatus === 'ready' ? '📭' : '📱'}</div><p>${waStatus === 'ready' ? 'Nenhum contato carregado' : 'Conecte seu WhatsApp<br>para ver seus contatos'}</p></div>`;
    return;
  }
  const allContacts = [...importedContacts, ...contacts];
  const filtered = allContacts.filter(c => {
    if (currentFilter === 'people' && c.isGroup) return false;
    if (currentFilter === 'groups' && !c.isGroup) return false;
    if (q && !c.name.toLowerCase().includes(q)) return false;
    return true;
  });
  document.getElementById('listCount').textContent = `${filtered.length} itens`;
  if (!filtered.length) {
    list.innerHTML = `<div class="empty-state"><div class="icon">🔍</div><p>Nenhum resultado para "<em>${esc(q)}</em>"</p></div>`;
    return;
  }
  list.innerHTML = filtered.map(c => {
    const sel = selectedIds.has(c.id);
    const badge = c.imported ? '<span class="badge-imported">Planilha</span>'
      : c.isGroup ? '<span class="badge-group">Grupo</span>' : '';
    return `<div class="contact-item${sel ? ' selected' : ''}" onclick="toggleContact('${esc(c.id)}')">
      <div class="cb"><svg viewBox="0 0 12 10" fill="none"><polyline points="1,5 4,8 11,1"/></svg></div>
      <div class="avatar">${c.name.charAt(0).toUpperCase()}</div>
      <div class="contact-info">
        <div class="contact-name">${esc(c.name)}</div>
        ${c.unread ? `<div class="contact-sub">${c.unread} não lida(s)</div>` : c.imported ? `<div class="contact-sub">${c.id.replace('@c.us', '')}</div>` : ''}
      </div>
      ${badge}
    </div>`;
  }).join('');
  document.getElementById('selBadge').textContent = selectedIds.size;
  updateSendBtn();
}

function toggleContact(id) {
  if (selectedIds.has(id)) selectedIds.delete(id); else selectedIds.add(id);
  renderList(); updateSendBtn();
}

function selectAll() {
  const q = document.getElementById('searchInput').value.toLowerCase().trim();
  const allContacts = [...importedContacts, ...contacts];
  allContacts.filter(c => {
    if (currentFilter === 'people' && c.isGroup) return false;
    if (currentFilter === 'groups' && !c.isGroup) return false;
    if (q && !c.name.toLowerCase().includes(q)) return false;
    return true;
  }).forEach(c => selectedIds.add(c.id));
  renderList(); updateSendBtn();
}

function deselectAll() { selectedIds.clear(); renderList(); updateSendBtn(); }

// ── Mode & Delay ──
function setMode(mode, btn) {
  sendMode = mode;
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('textSection').style.display = mode === 'file' ? 'none' : '';
  document.getElementById('fileSection').style.display = mode === 'text' ? 'none' : '';
  updateSendBtn();
}

document.querySelectorAll('.delay-opt').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.delay-opt').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedDelay = parseInt(btn.dataset.v);
    document.getElementById('sumDelay').textContent = btn.textContent;
  });
});

document.getElementById('msgText').addEventListener('input', function () {
  document.getElementById('charCount').textContent = this.value.length + ' caracteres';
  updateSendBtn();
});

// ── File ──
const fileInput = document.getElementById('fileInput');
const fileZone = document.getElementById('fileZone');

fileInput.addEventListener('change', () => { if (fileInput.files[0]) handleFile(fileInput.files[0]); });
fileZone.addEventListener('dragover', e => { e.preventDefault(); fileZone.classList.add('drag'); });
fileZone.addEventListener('dragleave', () => fileZone.classList.remove('drag'));
fileZone.addEventListener('drop', e => {
  e.preventDefault(); fileZone.classList.remove('drag');
  if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
});

async function handleFile(file) {
  const formData = new FormData();
  formData.append('file', file);
  const res = await api('/upload', { method: 'POST', body: formData });
  const data = await res.json();
  if (!data.ok) { alert('Erro ao enviar arquivo: ' + data.error); return; }
  uploadedFile = data;
  document.getElementById('fileName').textContent = data.original;
  document.getElementById('fileSize').textContent = formatBytes(data.size);
  const thumb = document.getElementById('fileThumb');
  thumb.innerHTML = data.mimetype.startsWith('image/') ? `<img src="${data.path}" alt="preview"/>` : fileIcon(data.mimetype, data.original);
  document.getElementById('filePreview').classList.add('show');
  document.getElementById('fileZone').style.display = 'none';
  updateSendBtn();
}

function removeFile() {
  uploadedFile = null; fileInput.value = '';
  document.getElementById('filePreview').classList.remove('show');
  document.getElementById('fileZone').style.display = '';
  updateSendBtn();
}

// ── Tabs ──
function switchTab(tab, btn) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('tab-' + tab).classList.add('active');
  if (tab === 'send') updateSummary();
}

function updateSummary() {
  document.getElementById('sumContacts').textContent = selectedIds.size;
  document.getElementById('sumMsg').textContent = sendMode === 'file' ? '(sem texto)' : (document.getElementById('msgText').value.trim() || '—');
  document.getElementById('sumFile').textContent = uploadedFile ? uploadedFile.original : '—';
}

// ── Send ──
function updateSendBtn() {
  const hasText = document.getElementById('msgText').value.trim().length > 0;
  const hasContent = sendMode === 'text' ? hasText : sendMode === 'file' ? !!uploadedFile : hasText && !!uploadedFile;
  document.getElementById('sendBtn').disabled = !(selectedIds.size > 0 && hasContent && waStatus === 'ready') || isSending;
}

async function startSend() {
  if (isSending) return;
  updateSummary();
  switchTab('send', document.querySelector('.tab[data-tab="send"]'));

  const contactsData = {};
  importedContacts.forEach(c => { if (c.rowData) contactsData[c.id] = c.rowData; });

  try {
    const res = await api('/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contactIds: [...selectedIds],
        message: sendMode === 'file' ? '' : document.getElementById('msgText').value,
        filename: uploadedFile?.filename || null,
        delayMs: selectedDelay,
        contactsData: Object.keys(contactsData).length ? contactsData : undefined
      })
    });
    const data = await res.json();
    if (!data.ok) {
      document.getElementById('progLabel').textContent = '❌ ' + (data.error || 'Erro ao iniciar disparo');
      document.getElementById('progressBox').classList.add('show');
    }
  } catch (e) {
    document.getElementById('progLabel').textContent = '❌ Erro de comunicação: ' + e.message;
    document.getElementById('progressBox').classList.add('show');
  }
}

async function stopSend() { await api('/stop', { method: 'POST' }); }

// ── Helpers ──
function fileIcon(mime, name) {
  if (mime.startsWith('image/')) return '🖼️';
  if (mime.startsWith('video/')) return '🎥';
  if (mime.startsWith('audio/')) return '🎵';
  if (mime.includes('pdf')) return '📄';
  if (mime.includes('word') || /\.docx?$/.test(name)) return '📝';
  if (mime.includes('sheet') || /\.xlsx?$/.test(name)) return '📊';
  return '📁';
}
function formatBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── Variáveis da planilha ──
function updateVarsBar() {
  const section = document.getElementById('varsSection');
  const bar = document.getElementById('varsBar');
  if (!sheetHeaders.length) { section.style.display = 'none'; return; }
  section.style.display = '';
  bar.innerHTML = sheetHeaders.map(h =>
    `<button class="var-btn" onclick="insertVar('${esc(h)}')">${esc(h)}</button>`
  ).join('');
  updateMsgPreview();
}

function insertVar(colName) {
  const ta = document.getElementById('msgText');
  const pos = ta.selectionStart;
  const val = ta.value;
  ta.value = val.slice(0, pos) + `{{${colName}}}` + val.slice(ta.selectionEnd);
  ta.selectionStart = ta.selectionEnd = pos + colName.length + 4;
  ta.focus();
  updateSendBtn();
  updateMsgPreview();
}

function updateMsgPreview() {
  const previewEl = document.getElementById('msgPreview');
  if (!previewEl) return;
  const firstImported = importedContacts[0];
  if (!firstImported?.rowData) { previewEl.textContent = '—'; return; }
  const template = document.getElementById('msgText').value;
  if (!template.trim()) { previewEl.textContent = '—'; return; }
  const preview = template.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
    const val = firstImported.rowData[key.trim()];
    return val !== undefined ? `[${val}]` : `{{${key.trim()}}}`;
  });
  previewEl.textContent = preview;
}

// ── Import Planilha ──
function openImportModal() {
  importFilename = null;
  document.getElementById('importFileInput').value = '';
  document.getElementById('importFileError').textContent = '';
  document.getElementById('importFileZone').classList.remove('drag');
  showImportStep(1);
  document.getElementById('importModal').classList.add('show');
}

function closeImportModal() {
  document.getElementById('importModal').classList.remove('show');
}

function showImportStep(n) {
  document.querySelectorAll('.import-step').forEach((el, i) => {
    el.classList.toggle('active', i + 1 === n);
  });
}

function backImportStep() { showImportStep(1); }

const importFileZone = document.getElementById('importFileZone');
const importFileInput = document.getElementById('importFileInput');
importFileZone.addEventListener('dragover', e => { e.preventDefault(); importFileZone.classList.add('drag'); });
importFileZone.addEventListener('dragleave', () => importFileZone.classList.remove('drag'));
importFileZone.addEventListener('drop', e => {
  e.preventDefault(); importFileZone.classList.remove('drag');
  if (e.dataTransfer.files[0]) handleImportFile(e.dataTransfer.files[0]);
});
importFileInput.addEventListener('change', () => {
  if (importFileInput.files[0]) handleImportFile(importFileInput.files[0]);
});

async function handleImportFile(file) {
  const allowed = ['.xlsx', '.xls', '.csv'];
  const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
  if (!allowed.includes(ext)) {
    document.getElementById('importFileError').textContent = 'Formato inválido. Use .xlsx, .xls ou .csv';
    return;
  }
  document.getElementById('importFileError').textContent = 'Lendo arquivo...';
  const fd = new FormData();
  fd.append('file', file);
  const r = await api('/parse-sheet', { method: 'POST', body: fd });
  const data = await r.json();
  if (!data.ok) {
    document.getElementById('importFileError').textContent = data.error || 'Erro ao ler arquivo';
    return;
  }
  importFilename = data.filename;
  buildImportStep2(data.headers, data.preview);
  showImportStep(2);
}

function buildImportStep2(headers, preview) {
  const phoneEl = document.getElementById('importPhoneCol');
  const nameEl = document.getElementById('importNameCol');
  phoneEl.innerHTML = headers.map((h, i) => `<option value="${i}">${h || 'Coluna ' + (i + 1)}</option>`).join('');
  nameEl.innerHTML = '<option value="">— nenhuma —</option>' +
    headers.map((h, i) => `<option value="${i}">${h || 'Coluna ' + (i + 1)}</option>`).join('');

  const guess = headers.findIndex(h => /tel|fone|celular|whatsapp|number|phone/i.test(h));
  if (guess >= 0) phoneEl.value = guess;

  const guessName = headers.findIndex(h => /nome|name|cliente|contato/i.test(h));
  if (guessName >= 0) nameEl.value = guessName;

  const previewHtml = `<table>
    <tr>${headers.map(h => `<th>${esc(h || '—')}</th>`).join('')}</tr>
    ${preview.map(row => `<tr>${row.map(v => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}
  </table>`;
  document.getElementById('importPreview').innerHTML = previewHtml;
}

async function confirmImport() {
  if (!importFilename) return;
  const phoneCol = document.getElementById('importPhoneCol').value;
  const nameCol = document.getElementById('importNameCol').value;
  const btn = document.getElementById('importOkBtn');
  btn.disabled = true;
  btn.textContent = 'Importando...';

  const r = await api('/extract-phones', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: importFilename, column: phoneCol, nameColumn: nameCol || '' })
  });
  const data = await r.json();
  btn.disabled = false;
  btn.textContent = 'Importar contatos';

  if (!data.ok) { alert('Erro: ' + data.error); return; }

  importedContacts = data.contacts;
  sheetHeaders = data.headers || [];
  importedContacts.forEach(c => selectedIds.add(c.id));
  renderList();
  updateSendBtn();
  updateVarsBar();
  closeImportModal();
}
