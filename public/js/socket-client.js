
/**
 * @fileoverview socket-client.js — toda a comunicação Socket.io do frontend.
 *
 * Conecta ao servidor, emite join_session e registra todos os handlers
 * de eventos recebidos. Delega para os outros módulos (contacts, send-flow, updater-ui).
 *
 * Depende de: state.js (carregado antes no HTML)
 */

/* globals state, renderPhonesList, updatePhoneSourceSelect, updatePhoneSelectorSend,
           updateHeaderSummary, updateSendBtn, onSendProgressEvent, onSendDone,
           onSendStopped, onUpdateStatusEvent, closeQrModal */

const socket = io();
window._socket = socket;

// ── Sessão ───────────────────────────────────────────────────────────────

function enterSession() {
  const raw = document.getElementById('sessionInput').value.trim();
  const id = raw.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 30);
  if (!id || id.length < 2) {
    setText(document.getElementById('loginError'), 'Nome deve ter ao menos 2 caracteres válidos.');
    return;
  }
  state.sessionId = id;
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
  socket.on('connect', () => { if (!state.sessionId) enterSession(); });
} else {
  document.getElementById('loginScreen').classList.remove('hidden');
}

socket.on('session_joined', ({ sessionId: id }) => {
  state.sessionId = id;
  setText(document.getElementById('sessionBadge'), '# ' + id);
  document.getElementById('loginScreen').classList.add('hidden');
});

// ── Telefones ────────────────────────────────────────────────────────────

socket.on('phones_list', ({ phones }) => {
  state.phones = phones;
  renderPhonesList();
  updatePhoneSourceSelect();
  updatePhoneSelectorSend();
  updateHeaderSummary();
  updateSendBtn();
});

socket.on('phone_status', ({ phoneId, status, message }) => {
  state.phoneStatuses[phoneId] = { status, message };
  const phone = state.phones.find(ph => ph.id === phoneId);
  if (phone) phone.status = status;
  renderPhonesList();
  updatePhoneSourceSelect();
  updatePhoneSelectorSend();
  updateHeaderSummary();
  updateSendBtn();

  if (state.currentQrPhoneId === phoneId) {
    if (status === 'ready' || status === 'connecting') closeQrModal();
    if (status === 'error') {
      document.getElementById('qrLoading').classList.remove('show');
      document.getElementById('qrImage').style.display = 'none';
      document.getElementById('qrInstructions').style.display = 'none';
      document.getElementById('qrSteps').style.display = 'none';
      setText(document.getElementById('qrErrorMsg'), message || 'Falha na conexão.');
      document.getElementById('qrError').classList.add('show');
      document.getElementById('qrModal').classList.add('show');
    }
  }
});

socket.on('phone_qr', ({ phoneId, phoneName, qr }) => {
  state.currentQrPhoneId = phoneId;
  setText(document.getElementById('qrModalTitle'), `Conectar — ${phoneName}`);
  document.getElementById('qrLoading').classList.remove('show');
  document.getElementById('qrError').classList.remove('show');
  document.getElementById('qrImage').src = qr;
  document.getElementById('qrImage').style.display = 'block';
  document.getElementById('qrInstructions').style.display = 'block';
  document.getElementById('qrSteps').style.display = 'block';
  document.getElementById('qrModal').classList.add('show');
});

socket.on('phone_contacts', ({ phoneId, contacts }) => {
  state.phoneContacts[phoneId] = contacts;
  const phone = state.phones.find(ph => ph.id === phoneId);
  if (phone) phone.contactCount = contacts.length;
  if (phoneId === state.selectedPhoneId) {
    state.contacts = contacts;
    for (const id of state.selectedIds) {
      if (!state.contacts.find(x => x.id === id) && !state.importedContacts.find(x => x.id === id)) {
        state.selectedIds.delete(id);
      }
    }
    renderList();
    updateSendBtn();
  }
  renderPhonesList();
});

// ── Envio (delegado a send-flow.js) ─────────────────────────────────────
socket.on('send_start', onSendStart);
socket.on('send_progress', onSendProgressEvent);
socket.on('send_done', onSendDone);
socket.on('send_stopped', onSendStopped);

// ── Update (delegado a updater-ui.js) ────────────────────────────────────
socket.on('update_status', onUpdateStatusEvent);

// ── API helper ────────────────────────────────────────────────────────────

function api(path, opts = {}) {
  const headers = Object.assign({}, opts.headers);
  if (state.authToken) headers['x-auth-token'] = state.authToken;
  return fetch(`/api/${state.sessionId}${path}`, Object.assign({}, opts, { headers }));
}

window.api = api;
window.socket = socket;
window.enterSession = enterSession;
window.clearLoginError = clearLoginError;
window.switchSession = switchSession;
