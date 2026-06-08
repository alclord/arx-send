const socket = io();
const isElectron = !!(window.electronAPI && window.electronAPI.isElectron);

let pendingUpdateInfo = null;

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function setText(el, text) { el.textContent = text; }
function setHTML(el, html) { el.innerHTML = html; }

if (isElectron && window.electronAPI.onUpdateStatus) {
  window.electronAPI.onUpdateStatus(({ status, progress, message, type }) => {
    const text = document.getElementById('updateText');
    const progWrap = document.getElementById('updateProgWrap');
    const progBar = document.getElementById('updateProgBar');
    const pctEl = document.getElementById('updatePct');
    const btn = document.getElementById('updateBtn');
    const checkBtn = document.getElementById('checkUpdateBtn');

    if (status === 'downloading') {
      checkBtn.style.display = 'none';
      setText(text, type === 'asar'
        ? 'Baixando atualização leve...'
        : 'Baixando instalador (Electron atualizado)...');
      progWrap.style.display = '';
      progBar.style.width = progress + '%';
      setText(pctEl, progress + '%');
      btn.style.display = 'none';
    } else if (status === 'installing') {
      setText(text, message || 'Instalando...');
      progWrap.style.display = 'none';
      setText(pctEl, '');
    } else if (status === 'ready') {
      setText(text, message || 'Atualização pronta!');
      progWrap.style.display = 'none';
      setText(pctEl, '');
      btn.style.display = 'none';
      checkBtn.style.display = 'none';
    } else if (status === 'error') {
      setText(text, message || 'Erro ao buscar atualização.');
      progWrap.style.display = 'none';
      setText(pctEl, '');
      btn.style.display = 'none';
      checkBtn.style.display = '';
      checkBtn.disabled = false;
      setText(checkBtn, 'Verificar atualizações');
    }
  });
}

let sessionId = null;

function enterSession() {
  const raw = document.getElementById('sessionInput').value.trim();
  const id = raw.toLowerCase().replace(/[^a-z0-9_-]/g, '');
  if (!id || id.length < 2) {
    setText(document.getElementById('loginError'), 'Nome deve ter ao menos 2 caracteres válidos.');
    return;
  }
  sessionId = id;
  localStorage.setItem('wa_session', id);
  document.getElementById('loginScreen').classList.add('hidden');
  setText(document.getElementById('sessionBadge'), '# ' + id);
  socket.emit('join_session', id);
}

function clearLoginError() {
  setText(document.getElementById('loginError'), '');
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
  setText(document.getElementById('sessionBadge'), '# ' + id);
  document.getElementById('loginScreen').classList.add('hidden');
});

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
    setText(document.getElementById('qrErrorMsg'), message || 'Falha na conexão.');
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
  setText(document.getElementById('progLog'), '');
  document.getElementById('progBar').style.width = '0%';
  setText(document.getElementById('progLabel'), 'Iniciando...');
  setText(document.getElementById('progCounter'), `0 / ${total}`);
  document.getElementById('sendBtn').style.display = 'none';
  document.getElementById('stopBtn').style.display = '';
});

socket.on('send_progress', ({ index, total, name, status, error }) => {
  const pct = Math.round(((index + 1) / total) * 100);
  document.getElementById('progBar').style.width = pct + '%';
  setText(document.getElementById('progCounter'), `${index + 1} / ${total}`);
  const log = document.getElementById('progLog');
  if (status === 'sending') {
    setText(document.getElementById('progLabel'), `Enviando para ${name}...`);
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
  setText(document.getElementById('progLabel'), '✅ Disparo concluído!');
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
  setText(document.getElementById('progLabel'), '⏹ Parado');
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
    setHTML(text, `Nova versão <strong>${esc(version)}</strong> disponível — baixando...`);
    progWrap.style.display = 'none';
    setText(pctEl, '');
    btn.style.display = 'none';
  } else if (status === 'downloading') {
    banner.classList.add('show');
    setHTML(text, `Baixando atualização <strong>${esc(version)}</strong>...`);
    progWrap.style.display = '';
    progBar.style.width = progress + '%';
    setText(pctEl, progress + '%');
    btn.style.display = 'none';
  } else if (status === 'ready') {
    banner.classList.add('show');
    setHTML(text, `✅ Atualização <strong>${esc(version)}</strong> pronta para instalar`);
    progWrap.style.display = 'none';
    setText(pctEl, '');
    btn.style.display = '';
    btn.disabled = false;
    setText(btn, 'Reiniciar e instalar');
  } else {
    banner.classList.remove('show');
  }
});

async function installUpdate() {
  if (!pendingUpdateInfo) return;

  if (isElectron && window.electronAPI.downloadUpdate) {
    const btn = document.getElementById('updateBtn');
    btn.disabled = true;
    setText(btn, 'Baixando...');
    await window.electronAPI.downloadUpdate(pendingUpdateInfo);
    return;
  }

  if (!confirm('O aplicativo será fechado para instalar a atualização e reabrirá automaticamente.\n\nDeseja continuar?')) return;

  const btn = document.getElementById('updateBtn');
  const text = document.getElementById('updateText');
  btn.disabled = true;
  setText(btn, 'Instalando...');
  setText(text, 'Instalando atualização — o app reabrirá em instantes...');
  try {
    await fetch('/api/update/install', { method: 'POST' });
  } catch { }
}

async function checkForUpdates() {
  const text = document.getElementById('updateText');
  const btn = document.getElementById('checkUpdateBtn');
  const updateBtn = document.getElementById('updateBtn');
  btn.disabled = true;
  setText(btn, 'Verificando...');
  setText(text, 'Verificando atualizações...');
  updateBtn.style.display = 'none';

  if (isElectron && window.electronAPI.checkForUpdates) {
    const result = await window.electronAPI.checkForUpdates();
    btn.disabled = false;
    setText(btn, 'Verificar atualizações');
    if (result.updateAvailable) {
      pendingUpdateInfo = result;
      if (result.electronChanged) {
        setHTML(text, `Nova versão <strong>${esc(result.version)}</strong> disponível (Electron atualizado — instalador completo)`);
      } else {
        setHTML(text, `Nova versão <strong>${esc(result.version)}</strong> disponível (atualização leve)`);
      }
      updateBtn.style.display = '';
      setText(updateBtn, result.electronChanged ? 'Baixar instalador' : 'Baixar e reiniciar');
    } else {
      setText(text, 'Você já está na versão mais recente.');
      pendingUpdateInfo = null;
    }
    return;
  }

  try {
    const res = await fetch('/api/update/check');
    const data = await res.json();
    btn.disabled = false;
    setText(btn, 'Verificar atualizações');
    if (data.updateAvailable) {
      setHTML(text, `Nova versão <strong>${esc(data.latestVersion)}</strong> disponível`);
      updateBtn.style.display = '';
    } else {
      setText(text, 'Você já está na versão mais recente.');
    }
  } catch {
    btn.disabled = false;
    setText(btn, 'Verificar atualizações');
    setText(text, 'Erro ao verificar atualizações.');
  }
}

function api(path, opts) {
  return fetch(`/api/${sessionId}${path}`, opts);
}

function closeQrModal() { document.getElementById('qrModal').classList.remove('show'); }

function showQrLoading(msg) {
  setText(document.getElementById('qrLoadingMsg'), msg || 'Abrindo navegador, aguarde...');
  document.getElementById('qrLoading').classList.add('show');
  document.getElementById('qrError').classList.remove('show');
  document.getElementById('qrImage').style.display = 'none';
  document.getElementById('qrImage').src = '';
  document.getElementById('qrInstructions').style.display = 'none';
  document.getElementById('qrSteps').style.display = 'none';
  document.getElementById('qrModal').classList.add('show');
}

function updateStatusUI(status, message) {
  const dot = document.getElementById('statusDot');
  const txt = document.getElementById('statusText');
  const btn = document.getElementById('connectBtn');
  dot.className = 'dot ' + status;
  setText(txt, message || status);
  if (status === 'ready') {
    setText(btn, 'Desconectar'); btn.className = 'btn-connect disconnect'; btn.disabled = false;
  } else if (status === 'connecting') {
    setText(btn, 'Conectando...'); btn.className = 'btn-connect'; btn.disabled = true;
  } else if (status === 'qr') {
    setText(btn, 'Novo QR'); btn.className = 'btn-connect'; btn.disabled = false;
  } else {
    setText(btn, 'Conectar'); btn.className = 'btn-connect'; btn.disabled = false;
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
    const icon = waStatus === 'ready' ? '📭' : '📱';
    const msg = waStatus === 'ready' ? 'Nenhum contato carregado' : 'Conecte seu WhatsApp<br>para ver seus contatos';
    setHTML(list, `<div class="empty-state"><div class="icon">${icon}</div><p>${msg}</p></div>`);
    return;
  }
  const allContacts = [...importedContacts, ...contacts];
  const filtered = allContacts.filter(c => {
    if (currentFilter === 'people' && c.isGroup) return false;
    if (currentFilter === 'groups' && !c.isGroup) return false;
    if (q && !c.name.toLowerCase().includes(q)) return false;
    return true;
  });
  setText(document.getElementById('listCount'), `${filtered.length} itens`);
  if (!filtered.length) {
    setHTML(list, `<div class="empty-state"><div class="icon">🔍</div><p>Nenhum resultado para "<em>${esc(q)}</em>"</p></div>`);
    return;
  }

  const frag = document.createDocumentFragment();
  for (const c of filtered) {
    const sel = selectedIds.has(c.id);
    const div = document.createElement('div');
    div.className = 'contact-item' + (sel ? ' selected' : '');
    div.setAttribute('onclick', `toggleContact('${esc(c.id)}')`);

    const cb = document.createElement('div');
    cb.className = 'cb';
    cb.innerHTML = '<svg viewBox="0 0 12 10" fill="none"><polyline points="1,5 4,8 11,1"/></svg>';

    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.textContent = c.name.charAt(0).toUpperCase();

    const info = document.createElement('div');
    info.className = 'contact-info';
    const nameDiv = document.createElement('div');
    nameDiv.className = 'contact-name';
    nameDiv.textContent = c.name;
    info.appendChild(nameDiv);

    if (c.unread) {
      const sub = document.createElement('div');
      sub.className = 'contact-sub';
      sub.textContent = `${c.unread} não lida(s)`;
      info.appendChild(sub);
    } else if (c.imported) {
      const sub = document.createElement('div');
      sub.className = 'contact-sub';
      sub.textContent = c.id.replace('@c.us', '');
      info.appendChild(sub);
    }

    div.appendChild(cb);
    div.appendChild(avatar);
    div.appendChild(info);

    if (c.imported || c.isGroup) {
      const badge = document.createElement('span');
      badge.className = c.imported ? 'badge-imported' : 'badge-group';
      badge.textContent = c.imported ? 'Planilha' : 'Grupo';
      div.appendChild(badge);
    }

    frag.appendChild(div);
  }
  list.innerHTML = '';
  list.appendChild(frag);

  setText(document.getElementById('selBadge'), selectedIds.size);
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
    setText(document.getElementById('sumDelay'), btn.textContent);
  });
});

document.getElementById('msgText').addEventListener('input', function () {
  setText(document.getElementById('charCount'), this.value.length + ' caracteres');
  updateSendBtn();
});

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
  setText(document.getElementById('fileName'), data.original);
  setText(document.getElementById('fileSize'), formatBytes(data.size));
  const thumb = document.getElementById('fileThumb');
  thumb.innerHTML = '';
  if (data.mimetype.startsWith('image/')) {
    const img = document.createElement('img');
    img.src = data.path;
    img.alt = 'preview';
    thumb.appendChild(img);
  } else {
    thumb.textContent = fileIcon(data.mimetype, data.original);
  }
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

function switchTab(tab, btn) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('tab-' + tab).classList.add('active');
  if (tab === 'send') updateSummary();
}

function updateSummary() {
  setText(document.getElementById('sumContacts'), selectedIds.size);
  setText(document.getElementById('sumMsg'), sendMode === 'file' ? '(sem texto)' : (document.getElementById('msgText').value.trim() || '—'));
  setText(document.getElementById('sumFile'), uploadedFile ? uploadedFile.original : '—');
}

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
      setText(document.getElementById('progLabel'), '❌ ' + (data.error || 'Erro ao iniciar disparo'));
      document.getElementById('progressBox').classList.add('show');
    }
  } catch (e) {
    setText(document.getElementById('progLabel'), '❌ Erro de comunicação: ' + e.message);
    document.getElementById('progressBox').classList.add('show');
  }
}

async function stopSend() { await api('/stop', { method: 'POST' }); }

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

function updateVarsBar() {
  const section = document.getElementById('varsSection');
  const bar = document.getElementById('varsBar');
  if (!sheetHeaders.length) { section.style.display = 'none'; return; }
  section.style.display = '';
  bar.innerHTML = '';
  sheetHeaders.forEach(h => {
    const btn = document.createElement('button');
    btn.className = 'var-btn';
    btn.textContent = h;
    btn.setAttribute('onclick', `insertVar('${esc(h)}')`);
    bar.appendChild(btn);
  });
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
  if (!firstImported?.rowData) { setText(previewEl, '—'); return; }
  const template = document.getElementById('msgText').value;
  if (!template.trim()) { setText(previewEl, '—'); return; }
  const preview = template.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
    const val = firstImported.rowData[key.trim()];
    return val !== undefined ? `[${val}]` : `{{${key.trim()}}}`;
  });
  setText(previewEl, preview);
}

function openImportModal() {
  importFilename = null;
  document.getElementById('importFileInput').value = '';
  setText(document.getElementById('importFileError'), '');
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
    setText(document.getElementById('importFileError'), 'Formato inválido. Use .xlsx, .xls ou .csv');
    return;
  }
  setText(document.getElementById('importFileError'), 'Lendo arquivo...');
  const fd = new FormData();
  fd.append('file', file);
  const r = await api('/parse-sheet', { method: 'POST', body: fd });
  const data = await r.json();
  if (!data.ok) {
    setText(document.getElementById('importFileError'), data.error || 'Erro ao ler arquivo');
    return;
  }
  importFilename = data.filename;
  buildImportStep2(data.headers, data.preview);
  showImportStep(2);
}

function buildImportStep2(headers, preview) {
  const phoneEl = document.getElementById('importPhoneCol');
  const nameEl = document.getElementById('importNameCol');
  phoneEl.innerHTML = '';
  nameEl.innerHTML = '';

  const noneOpt = document.createElement('option');
  noneOpt.value = '';
  noneOpt.textContent = '— nenhuma —';
  nameEl.appendChild(noneOpt);

  headers.forEach((h, i) => {
    const opt1 = document.createElement('option');
    opt1.value = i;
    opt1.textContent = h || 'Coluna ' + (i + 1);
    phoneEl.appendChild(opt1);

    const opt2 = document.createElement('option');
    opt2.value = i;
    opt2.textContent = h || 'Coluna ' + (i + 1);
    nameEl.appendChild(opt2);
  });

  const guess = headers.findIndex(h => /tel|fone|celular|whatsapp|number|phone/i.test(h));
  if (guess >= 0) phoneEl.value = guess;

  const guessName = headers.findIndex(h => /nome|name|cliente|contato/i.test(h));
  if (guessName >= 0) nameEl.value = guessName;

  const table = document.createElement('table');
  const thead = document.createElement('tr');
  headers.forEach(h => {
    const th = document.createElement('th');
    th.textContent = h || '—';
    thead.appendChild(th);
  });
  table.appendChild(thead);

  preview.forEach(row => {
    const tr = document.createElement('tr');
    row.forEach(v => {
      const td = document.createElement('td');
      td.textContent = v;
      tr.appendChild(td);
    });
    table.appendChild(tr);
  });

  const previewEl = document.getElementById('importPreview');
  previewEl.innerHTML = '';
  previewEl.appendChild(table);
}

async function confirmImport() {
  if (!importFilename) return;
  const phoneCol = document.getElementById('importPhoneCol').value;
  const nameCol = document.getElementById('importNameCol').value;
  const btn = document.getElementById('importOkBtn');
  btn.disabled = true;
  setText(btn, 'Importando...');

  const r = await api('/extract-phones', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: importFilename, column: phoneCol, nameColumn: nameCol || '' })
  });
  const data = await r.json();
  btn.disabled = false;
  setText(btn, 'Importar contatos');

  if (!data.ok) { alert('Erro: ' + data.error); return; }

  importedContacts = data.contacts;
  sheetHeaders = data.headers || [];
  importedContacts.forEach(c => selectedIds.add(c.id));
  renderList();
  updateSendBtn();
  updateVarsBar();
  closeImportModal();
}
