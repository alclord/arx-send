
/**
 * @fileoverview app.js — bootstrap e funções de UI não cobertas por módulos específicos.
 *
 * Carregado por último no HTML. Dependências (na ordem dos <script> tags):
 *   1. state.js        — estado global
 *   2. send-flow.js    — progresso e timer de envio
 *   3. updater-ui.js   — banner de atualização
 *   4. socket-client.js — Socket.io e API helper
 *   5. app.js          — este arquivo (bootstrap + UI residual)
 *
 * Contém: utilitários de HTML, telefones, QR modal, contatos, planilha,
 * modo de envio, diagnóstico, toast, focus trap.
 */

// ── Detecção de ambiente ──────────────────────────────────────────────────
const isElectron = !!(window.electronAPI && window.electronAPI.isElectron);

if (isElectron && window.electronAPI.getAppVersion) {
  window.electronAPI.getAppVersion().then(v => {
    const el = document.getElementById('appVersion');
    if (el && v) el.textContent = 'v' + v;
  });
}

if (isElectron && window.electronAPI.getAuthToken) {
  window.electronAPI.getAuthToken().then(t => { state.authToken = t; });
}

// ── Utilitários de HTML ───────────────────────────────────────────────────

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function setText(el, text) { el.textContent = text; }
function setHTML(el, html) { el.innerHTML = html; }

// ── Resumo do header ──────────────────────────────────────────────────────

function updateHeaderSummary() {
  const ready = state.phones.filter(p => p.status === 'ready').length;
  const total = state.phones.length;
  const el = document.getElementById('phonesSummaryText');
  const summary = document.getElementById('phonesSummary');
  summary.classList.remove('state-none', 'state-ready', 'state-warn');
  if (total === 0) {
    setText(el, 'Nenhum telefone');
    summary.classList.add('state-none');
  } else {
    setText(el, `${ready}/${total} conectado${ready !== 1 ? 's' : ''}`);
    summary.classList.add(ready > 0 ? 'state-ready' : 'state-warn');
  }
}

// ── Modal de telefones ────────────────────────────────────────────────────

function openPhonesModal() {
  document.getElementById('phoneNameInput')?.focus();
}

function closePhonesModal() {
  document.getElementById('phonesModal').classList.remove('show');
}

const STATUS_LABEL = {
  ready: 'Pronto',
  connecting: 'Conectando...',
  qr: 'Aguardando QR...',
  disconnected: 'Desconectado',
  error: 'Erro',
};

function renderPhonesList() {
  const list = document.getElementById('phonesListEl');
  const count = document.getElementById('phonesModalCount');
  if (!list) return;

  setText(count, `${state.phones.length} / 10`);

  const btnAdd = document.getElementById('btnAddPhone');
  const limitNote = document.getElementById('phonesLimitNote');
  if (state.phones.length >= 10) {
    btnAdd.disabled = true;
    limitNote.style.display = '';
  } else {
    btnAdd.disabled = false;
    limitNote.style.display = 'none';
  }

  if (state.phones.length === 0) {
    list.innerHTML = '<div class="phones-empty">Nenhum telefone cadastrado.<br>Adicione um abaixo.</div>';
    return;
  }

  const frag = document.createDocumentFragment();
  for (const phone of state.phones) {
    const statusInfo = state.phoneStatuses[phone.id] || {};
    const statusLabel = statusInfo.message || STATUS_LABEL[phone.status] || phone.status;
    const isReady = phone.status === 'ready';
    const isConnecting = phone.status === 'connecting' || phone.status === 'qr';

    const row = document.createElement('div');
    row.className = 'phone-row';

    const dot = document.createElement('div');
    dot.className = 'dot ' + phone.status;

    const info = document.createElement('div');
    info.className = 'phone-row-info';

    const name = document.createElement('div');
    name.className = 'phone-row-name';
    name.textContent = phone.name;

    const status = document.createElement('div');
    status.className = 'phone-row-status';
    status.textContent =
      isReady && phone.contactCount > 0
        ? `${statusLabel} · ${phone.contactCount} conversas`
        : statusLabel;

    info.appendChild(name);
    info.appendChild(status);

    const actions = document.createElement('div');
    actions.className = 'phone-row-actions';

    const connectBtn = document.createElement('button');
    connectBtn.className = 'btn-phone-connect' + (isReady ? ' disconnect' : '');
    connectBtn.disabled = isConnecting;
    if (isReady) {
      connectBtn.textContent = 'Desconectar';
      connectBtn.onclick = () => doDisconnectPhone(phone.id);
    } else {
      connectBtn.textContent = isConnecting ? 'Aguardando...' : 'Conectar';
      connectBtn.onclick = () => doConnectPhone(phone.id);
    }

    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn-phone-remove';
    removeBtn.setAttribute('aria-label', `Remover ${phone.name}`);
    removeBtn.innerHTML =
      '<svg aria-hidden="true" focusable="false" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    removeBtn.onclick = () => doRemovePhone(phone.id, phone.name);

    actions.appendChild(connectBtn);
    actions.appendChild(removeBtn);

    row.appendChild(dot);
    row.appendChild(info);
    row.appendChild(actions);
    frag.appendChild(row);
  }

  list.innerHTML = '';
  list.appendChild(frag);
}

async function doAddPhone() {
  const input = document.getElementById('phoneNameInput');
  const name = input.value.trim();
  if (!name) { input.focus(); return; }
  if (state.phones.length >= 10) return;
  const res = await api('/phones', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  const data = await res.json();
  if (!data.ok) { alert(data.error || 'Erro ao adicionar telefone'); return; }
  input.value = '';
  input.focus();
}

async function doConnectPhone(phoneId) {
  const phone = state.phones.find(p => p.id === phoneId);
  const phoneName = phone ? phone.name : 'WhatsApp';
  state.currentQrPhoneId = phoneId;
  setText(document.getElementById('qrModalTitle'), `Conectar — ${phoneName}`);
  showQrLoading('Abrindo navegador, aguarde...');
  await api(`/phones/${phoneId}/connect`, { method: 'POST' });
}

async function doDisconnectPhone(phoneId) {
  await api(`/phones/${phoneId}/disconnect`, { method: 'POST' });
}

async function doRemovePhone(phoneId, name) {
  if (!confirm(`Remover "${name}"? A sessão do WhatsApp será encerrada.`)) return;
  await api(`/phones/${phoneId}`, { method: 'DELETE' });
  if (state.selectedPhoneId === phoneId) {
    state.selectedPhoneId = null;
    state.contacts = [];
    renderList();
  }
  delete state.phoneContacts[phoneId];
  delete state.phoneStatuses[phoneId];
}

function retryCurrentPhone() {
  if (state.currentQrPhoneId) doConnectPhone(state.currentQrPhoneId);
}

// ── QR Modal ──────────────────────────────────────────────────────────────

function closeQrModal() {
  document.getElementById('qrModal').classList.remove('show');
  state.currentQrPhoneId = null;
}

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

// ── Seletor de contatos ───────────────────────────────────────────────────

function updatePhoneSourceSelect() {
  const bar = document.getElementById('phoneSourceBar');
  const sel = document.getElementById('phoneSourceSelect');
  const readyPhones = state.phones.filter(p => p.status === 'ready');

  if (readyPhones.length === 0) {
    bar.style.display = 'none';
    sel.innerHTML = '';
    if (state.selectedPhoneId) {
      state.selectedPhoneId = null;
      state.contacts = [];
      renderList();
    }
    return;
  }

  bar.style.display = '';
  const prev = sel.value;
  sel.innerHTML = readyPhones
    .map(p => `<option value="${esc(p.id)}">${esc(p.name)} (${p.contactCount || 0})</option>`)
    .join('');

  if (prev && readyPhones.find(p => p.id === prev)) {
    sel.value = prev;
  } else {
    sel.value = readyPhones[0].id;
    onPhoneSourceChange();
  }
}

function onPhoneSourceChange() {
  const sel = document.getElementById('phoneSourceSelect');
  state.selectedPhoneId = sel.value || null;
  state.contacts = state.selectedPhoneId ? (state.phoneContacts[state.selectedPhoneId] || []) : [];
  renderList();
  updateSendBtn();
}

// ── Seletor de telefone para envio ────────────────────────────────────────

function updatePhoneSelectorSend() {
  const sel = document.getElementById('phoneSelectorSend');
  const readyPhones = state.phones.filter(p => p.status === 'ready');
  const prev = sel.value;
  sel.innerHTML =
    '<option value="">— Selecione um telefone —</option>' +
    readyPhones.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
  if (prev && readyPhones.find(p => p.id === prev)) {
    sel.value = prev;
  } else if (readyPhones.length === 1) {
    sel.value = readyPhones[0].id;
  }
  updateSendBtn();
}

function onSendPhoneChange() {
  updateSendBtn();
  updateSummary();
}

function getSelectedSendPhoneId() {
  return document.getElementById('phoneSelectorSend')?.value || null;
}

async function reloadContacts() {
  if (!state.selectedPhoneId) return;
  await api(`/phones/${state.selectedPhoneId}/reload-contacts`, { method: 'POST' });
}

// ── Filtros e lista de contatos ───────────────────────────────────────────

function setFilter(f, btn) {
  state.currentFilter = f;
  state.vsLimit = 200;
  document.querySelectorAll('.filter-tab').forEach(b => {
    b.classList.remove('active');
    b.setAttribute('aria-selected', 'false');
  });
  btn.classList.add('active');
  btn.setAttribute('aria-selected', 'true');
  renderList();
}

function renderList() {
  const q = document.getElementById('searchInput').value.toLowerCase().trim();
  const list = document.getElementById('contactsList');

  if (!state.contacts.length && !state.importedContacts.length) {
    const hasReady = state.phones.some(p => p.status === 'ready');
    const iconId = hasReady ? 'icon-message-square' : 'icon-smartphone';
    const msg = hasReady
      ? 'Nenhum contato carregado'
      : 'Adicione e conecte um telefone<br>para ver seus contatos';
    const cta = hasReady
      ? `<button class="load-more-btn" onclick="reloadContacts()">Recarregar contatos</button>`
      : '';
    setHTML(list, `<div class="empty-state"><svg aria-hidden="true" focusable="false" class="empty-icon" width="36" height="36"><use href="#${iconId}"/></svg><p>${msg}</p>${cta}</div>`);
    return;
  }

  const allContacts = [...state.importedContacts, ...state.contacts];
  const filtered = allContacts.filter(c => {
    if (state.currentFilter === 'people' && c.isGroup) return false;
    if (state.currentFilter === 'groups' && !c.isGroup) return false;
    if (q && !c.name.toLowerCase().includes(q)) return false;
    return true;
  });

  setText(document.getElementById('listCount'), `${filtered.length} itens`);
  if (!filtered.length) {
    setHTML(list, `<div class="empty-state"><svg aria-hidden="true" focusable="false" class="empty-icon" width="36" height="36"><use href="#icon-search"/></svg><p>Nenhum resultado para "<em>${esc(q)}</em>"</p></div>`);
    return;
  }

  const visible = filtered.slice(0, state.vsLimit);
  const frag = document.createDocumentFragment();
  for (const c of visible) {
    const sel = state.selectedIds.has(c.id);
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

  if (filtered.length > state.vsLimit) {
    const remaining = filtered.length - state.vsLimit;
    const btn = document.createElement('button');
    btn.className = 'load-more-btn';
    btn.textContent = `Mostrar mais ${remaining} contato${remaining !== 1 ? 's' : ''}`;
    btn.onclick = () => { state.vsLimit += 200; renderList(); };
    list.appendChild(btn);
  }

  setText(document.getElementById('selBadge'), state.selectedIds.size);
  updateSendBtn();
}

function toggleContact(id) {
  if (state.selectedIds.has(id)) state.selectedIds.delete(id);
  else state.selectedIds.add(id);
  renderList();
  updateSendBtn();
}

function selectAll() {
  const q = document.getElementById('searchInput').value.toLowerCase().trim();
  const allContacts = [...state.importedContacts, ...state.contacts];
  allContacts.filter(c => {
    if (state.currentFilter === 'people' && c.isGroup) return false;
    if (state.currentFilter === 'groups' && !c.isGroup) return false;
    if (q && !c.name.toLowerCase().includes(q)) return false;
    return true;
  }).forEach(c => state.selectedIds.add(c.id));
  renderList();
  updateSendBtn();
}

function deselectAll() {
  if (state.selectedIds.size > 10 && !confirm(`Remover ${state.selectedIds.size} contatos selecionados?`)) return;
  state.selectedIds.clear();
  renderList();
  updateSendBtn();
}

// ── Modo de envio ─────────────────────────────────────────────────────────

function setMode(mode, btn) {
  state.sendMode = mode;
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('textSection').style.display = mode === 'file' ? 'none' : '';
  document.getElementById('fileSection').style.display = mode === 'text' ? 'none' : '';
  updateSendBtn();
}

function getDelayMs() {
  const val = Math.max(1, parseInt(document.getElementById('delayVal')?.value, 10) || 3);
  const unit = document.getElementById('delayUnit')?.value || 's';
  return unit === 'm' ? val * 60000 : val * 1000;
}

function getDelayLabel() {
  const val = Math.max(1, parseInt(document.getElementById('delayVal')?.value, 10) || 3);
  const unit = document.getElementById('delayUnit')?.value || 's';
  return unit === 'm' ? `${val}min` : `${val}s`;
}

function updateDelayHint() {
  const val = Math.max(1, parseInt(document.getElementById('delayVal')?.value, 10) || 3);
  const unit = document.getElementById('delayUnit')?.value || 's';
  const label = unit === 'm' ? (val === 1 ? 'minuto' : 'minutos') : (val === 1 ? 'segundo' : 'segundos');
  const el = document.getElementById('delayHint');
  if (el) setText(el, `Envio a cada ${val} ${label}`);
  updateSummary();
}

document.getElementById('delayVal')?.addEventListener('input', updateDelayHint);
document.getElementById('delayUnit')?.addEventListener('change', updateDelayHint);

// ── Draft de mensagem ─────────────────────────────────────────────────────

let _draftTimer = null;
function saveDraft() {
  clearTimeout(_draftTimer);
  _draftTimer = setTimeout(() => {
    localStorage.setItem('draft_message', document.getElementById('msgText').value);
  }, 500);
}

document.getElementById('msgText').addEventListener('input', function () {
  setText(document.getElementById('charCount'), this.value.length + ' caracteres');
  updateSendBtn();
  saveDraft();
});

(function restoreDraft() {
  const draft = localStorage.getItem('draft_message');
  if (draft) {
    document.getElementById('msgText').value = draft;
    setText(document.getElementById('charCount'), draft.length + ' caracteres');
  }
})();

// ── Upload de arquivo de mídia ────────────────────────────────────────────

const fileInput = document.getElementById('fileInput');
const fileZone = document.getElementById('fileZone');

fileInput.addEventListener('change', () => { if (fileInput.files[0]) handleFile(fileInput.files[0]); });
fileZone.addEventListener('dragover', e => { e.preventDefault(); fileZone.classList.add('drag'); });
fileZone.addEventListener('dragleave', () => fileZone.classList.remove('drag'));
fileZone.addEventListener('drop', e => {
  e.preventDefault();
  fileZone.classList.remove('drag');
  if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
});

async function handleFile(file) {
  const formData = new FormData();
  formData.append('file', file);
  const res = await api('/upload', { method: 'POST', body: formData });
  const data = await res.json();
  if (!data.ok) { alert('Erro ao enviar arquivo: ' + data.error); return; }
  state.uploadedFile = data;
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
    thumb.innerHTML = fileIcon(data.mimetype, data.original);
  }
  document.getElementById('filePreview').classList.add('show');
  document.getElementById('fileZone').style.display = 'none';
  updateSendBtn();
}

function removeFile() {
  state.uploadedFile = null;
  fileInput.value = '';
  document.getElementById('filePreview').classList.remove('show');
  document.getElementById('fileZone').style.display = '';
  updateSendBtn();
}

// ── Resumo e botão de envio ────────────────────────────────────────────────

function switchTab(tab) {
  if (tab === 'send') updateSummary();
}

function updateSummary() {
  const sendPhoneId = getSelectedSendPhoneId();
  const phone = state.phones.find(p => p.id === sendPhoneId);
  setText(document.getElementById('sumContacts'), state.selectedIds.size);
  setText(document.getElementById('sumDelay'), getDelayLabel());
  setText(document.getElementById('sumMsg'), state.sendMode === 'file' ? '(sem texto)' : (document.getElementById('msgText').value.trim() || '—'));
  setText(document.getElementById('sumFile'), state.uploadedFile ? state.uploadedFile.original : '—');
  setText(document.getElementById('sumPhone'), phone ? phone.name : '—');
}

function updateSendBtn() {
  const hasText = document.getElementById('msgText').value.trim().length > 0;
  const hasContent = state.sendMode === 'text'
    ? hasText
    : state.sendMode === 'file'
    ? !!state.uploadedFile
    : hasText && !!state.uploadedFile;
  const sendPhoneId = getSelectedSendPhoneId();
  const phoneReady = !!(sendPhoneId && state.phones.find(p => p.id === sendPhoneId && p.status === 'ready'));
  document.getElementById('sendBtn').disabled = !(state.selectedIds.size > 0 && state.selectedIds.size <= 5000 && hasContent && phoneReady) || state.isSending;
}

// ── Helpers de arquivo ────────────────────────────────────────────────────

function fileIcon(mime, name) {
  const svg = path =>
    `<svg aria-hidden="true" focusable="false" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
  if (mime.startsWith('image/')) return svg('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>');
  if (mime.startsWith('video/')) return svg('<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/>');
  if (mime.startsWith('audio/')) return svg('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>');
  if (mime.includes('pdf')) return svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>');
  if (mime.includes('word') || /\.docx?$/.test(name)) return svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>');
  if (mime.includes('sheet') || /\.xlsx?$/.test(name)) return svg('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>');
  return svg('<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>');
}

function formatBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}

// ── Variáveis de planilha ─────────────────────────────────────────────────

function updateVarsBar() {
  const section = document.getElementById('varsSection');
  const bar = document.getElementById('varsBar');
  if (!state.sheetHeaders.length) { section.style.display = 'none'; return; }
  section.style.display = '';
  bar.innerHTML = '';
  state.sheetHeaders.forEach(h => {
    const btn = document.createElement('button');
    btn.className = 'var-btn';
    btn.textContent = h;
    btn.setAttribute('onclick', `insertVar('${esc(h)}')`);
    bar.appendChild(btn);
  });

  const sel = document.getElementById('previewContactSelect');
  sel.innerHTML = '';
  state.importedContacts.forEach((c, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = (c.name || c.id.replace('@c.us', '')) + ` (#${i + 1})`;
    sel.appendChild(opt);
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
  const idx = parseInt(document.getElementById('previewContactSelect')?.value || '0', 10);
  const contact = state.importedContacts[idx];
  if (!contact?.rowData) { setText(previewEl, '—'); return; }
  const template = document.getElementById('msgText').value;
  if (!template.trim()) { setText(previewEl, '—'); return; }

  previewEl.innerHTML = '';
  const parts = template.split(/(\{\{[^}]+\}\})/g);
  parts.forEach(part => {
    const match = part.match(/^\{\{([^}]+)\}\}$/);
    if (match) {
      const key = match[1].trim();
      const val = contact.rowData[key];
      const span = document.createElement('span');
      if (val !== undefined && val !== '') {
        span.textContent = `[${val}]`;
        span.style.color = 'var(--accent)';
      } else {
        span.textContent = `{{${key}}}`;
        span.className = 'var-missing';
        span.title = 'Variável sem valor neste contato';
      }
      previewEl.appendChild(span);
    } else {
      previewEl.appendChild(document.createTextNode(part));
    }
  });
}

// ── Modal de importação de planilha ───────────────────────────────────────

function openImportModal() {
  state.importFilename = null;
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
  e.preventDefault();
  importFileZone.classList.remove('drag');
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
  state.importFilename = data.filename;
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

    const opt2 = opt1.cloneNode(true);
    nameEl.appendChild(opt2);
  });

  const guess = headers.findIndex(h => /tel|fone|celular|whatsapp|number|phone/i.test(h));
  if (guess >= 0) phoneEl.value = guess;
  const guessName = headers.findIndex(h => /nome|name|cliente|contato/i.test(h));
  if (guessName >= 0) nameEl.value = guessName;

  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const theadRow = document.createElement('tr');
  headers.forEach(h => {
    const th = document.createElement('th');
    th.textContent = h || '—';
    theadRow.appendChild(th);
  });
  thead.appendChild(theadRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  preview.forEach(row => {
    const tr = document.createElement('tr');
    row.forEach(v => {
      const td = document.createElement('td');
      td.textContent = v;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  const previewEl = document.getElementById('importPreview');
  previewEl.innerHTML = '';
  previewEl.appendChild(table);
}

async function confirmImport() {
  if (!state.importFilename) return;
  const phoneCol = document.getElementById('importPhoneCol').value;
  const nameCol = document.getElementById('importNameCol').value;
  const btn = document.getElementById('importOkBtn');
  btn.disabled = true;
  setText(btn, 'Importando...');

  const r = await api('/extract-phones', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: state.importFilename, column: phoneCol, nameColumn: nameCol || '' }),
  });
  const data = await r.json();
  btn.disabled = false;
  setText(btn, 'Importar contatos');

  if (!data.ok) { alert('Erro: ' + data.error); return; }

  state.importedContacts = data.contacts;
  state.sheetHeaders = data.headers || [];
  state.importedContacts.forEach(c => state.selectedIds.add(c.id));
  renderList();
  updateSendBtn();
  updateVarsBar();
  closeImportModal();
  showToast(`${state.importedContacts.length} contatos importados com sucesso`, 'success');
}

// ── Atalhos de teclado ────────────────────────────────────────────────────

document.addEventListener('keydown', e => {
  const tag = document.activeElement?.tagName;
  const inInput = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';

  if (e.key === 'Escape') {
    if (document.getElementById('importModal').classList.contains('show')) closeImportModal();
    else if (document.getElementById('qrModal').classList.contains('show')) closeQrModal();
    else if (document.getElementById('diagModal').classList.contains('show')) closeDiagModal();
    else if (document.getElementById('phonesModal').classList.contains('show')) closePhonesModal();
    return;
  }

  if (inInput) return;

  if (e.ctrlKey && e.key === 'Enter') {
    const btn = document.getElementById('sendBtn');
    if (!btn.disabled) startSend();
  }
});

// ── Diagnóstico / logs ────────────────────────────────────────────────────

let _diagLines = [];

async function openDiagModal() {
  document.getElementById('diagModal').classList.add('show');
  document.getElementById('diagLoading').style.display = '';
  document.getElementById('diagLogLines').innerHTML = '';
  document.getElementById('diagFile').textContent = '';
  if (isElectron) document.getElementById('diagOpenFolder').style.display = '';

  try {
    const headers = {};
    if (state.authToken) headers['x-auth-token'] = state.authToken;
    const res = await fetch('/api/logs', { headers });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const { lines, file } = await res.json();
    _diagLines = lines || [];
    document.getElementById('diagFile').textContent = file ? `Arquivo: ${file}` : '';
    document.getElementById('diagLoading').style.display = 'none';
    const container = document.getElementById('diagLogLines');
    if (!_diagLines.length) {
      container.innerHTML = '<span style="color:var(--muted)">Nenhum log disponível ainda.</span>';
    } else {
      container.innerHTML = _diagLines.map(line => {
        const cls = line.includes('] [ERROR]') ? 'log-error' : line.includes('] [WARN]') ? 'log-warn' : 'log-info';
        return `<div class="diag-log-line ${cls}">${esc(line)}</div>`;
      }).join('');
    }
    document.getElementById('diagLogWrap').scrollTop = document.getElementById('diagLogWrap').scrollHeight;
  } catch (err) {
    document.getElementById('diagLoading').style.display = 'none';
    document.getElementById('diagLogLines').innerHTML =
      `<span style="color:var(--red)">Erro ao carregar logs: ${esc(err.message)}</span>`;
  }
}

function closeDiagModal() {
  document.getElementById('diagModal').classList.remove('show');
}

async function copyDiagLogs() {
  if (!_diagLines.length) return;
  try {
    await navigator.clipboard.writeText(_diagLines.join('\n'));
    showToast('Logs copiados!', 'success');
  } catch {
    showToast('Erro ao copiar logs', 'error');
  }
}

async function openDiagFolder() {
  if (isElectron && window.electronAPI.openLogsFolder) {
    await window.electronAPI.openLogsFolder();
  }
}

// ── Toast ─────────────────────────────────────────────────────────────────

function showToast(msg, type) {
  const t = document.getElementById('appToast');
  t.textContent = msg;
  t.className = 'app-toast show ' + (type || '');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), 4000);
}

// ── Focus trap ────────────────────────────────────────────────────────────

function trapFocus(modal) {
  const sel = 'button:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';
  modal.addEventListener('keydown', e => {
    if (e.key !== 'Tab' || !modal.classList.contains('show')) return;
    const els = [...modal.querySelectorAll(sel)].filter(el => {
      const s = getComputedStyle(el);
      return s.display !== 'none' && s.visibility !== 'hidden';
    });
    if (!els.length) return;
    const first = els[0];
    const last = els[els.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
}

['importModal', 'phonesModal', 'qrModal', 'diagModal'].forEach(id => trapFocus(document.getElementById(id)));
