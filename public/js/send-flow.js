
/**
 * @fileoverview send-flow.js — progresso de envio e countdown timer.
 *
 * Gerencia o estado visual do disparo: barra de progresso, log de envios,
 * timer de countdown entre mensagens e botões start/stop.
 *
 * Depende de: state.js, socket-client.js
 */

/* globals state, api, updateSendBtn, setText, esc */

let _timerInterval = null;

// ── Timer de countdown ────────────────────────────────────────────────

function _clearSendTimer() {
  if (_timerInterval) { clearInterval(_timerInterval); _timerInterval = null; }
  const w = document.getElementById('progTimerWrap');
  if (w) w.style.display = 'none';
}

function _startSendTimer(delayMs) {
  _clearSendTimer();
  if (delayMs <= 30000) return;
  let remaining = Math.ceil(delayMs / 1000);
  const timerEl = document.getElementById('progTimer');
  const timerWrap = document.getElementById('progTimerWrap');
  if (!timerEl || !timerWrap) return;
  const fmt = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  timerWrap.style.display = 'flex';
  setText(timerEl, fmt(remaining));
  _timerInterval = setInterval(() => {
    remaining--;
    if (remaining <= 0) { _clearSendTimer(); return; }
    setText(timerEl, fmt(remaining));
  }, 1000);
}

// ── Handlers de eventos Socket ───────────────────────────────────────

function onSendStart({ total }) {
  state.isSending = true;
  _clearSendTimer();
  const progressBox = document.getElementById('progressBox');
  progressBox.classList.add('show');
  progressBox.classList.remove('done');
  document.getElementById('progressActions').style.display = 'none';
  document.getElementById('sendBtn').classList.remove('loading');
  setText(document.getElementById('progLog'), '');
  document.getElementById('progBar').style.width = '0%';
  setText(document.getElementById('progLabel'), 'Iniciando...');
  setText(document.getElementById('progCounter'), `0 / ${total}`);
  document.getElementById('sendBtn').style.display = 'none';
  document.getElementById('stopBtn').style.display = 'flex';
}

function onSendProgressEvent({ index, total, name, status, error }) {
  const pct = Math.round(((index + 1) / total) * 100);
  document.getElementById('progBar').style.width = pct + '%';
  setText(document.getElementById('progCounter'), `${index + 1} / ${total}`);
  const log = document.getElementById('progLog');
  if (status === 'sending') {
    _clearSendTimer();
    setText(document.getElementById('progLabel'), `Enviando para ${name}...`);
    const el = document.createElement('div');
    el.className = 'log-sending';
    el.textContent = `⏳ ${name}`;
    el.id = 'log_' + index;
    log.appendChild(el);
  } else if (status === 'done') {
    const el = document.getElementById('log_' + index) || log.lastChild;
    if (el) { el.className = 'log-done'; el.textContent = `✓ ${name}`; }
    if (index + 1 < total) _startSendTimer(state.sendDelayMs);
  } else if (status === 'error') {
    const el = document.getElementById('log_' + index) || log.lastChild;
    if (el) { el.className = 'log-error'; el.textContent = `✗ ${name}: ${error}`; }
    if (index + 1 < total) _startSendTimer(state.sendDelayMs);
  }
  log.scrollTop = log.scrollHeight;
}

function onSendDone() {
  state.isSending = false;
  _clearSendTimer();
  const sendBtn = document.getElementById('sendBtn');
  sendBtn.classList.remove('loading');
  sendBtn.style.display = '';
  setText(document.getElementById('progLabel'), 'Disparo concluído!');
  document.getElementById('progBar').style.width = '100%';
  document.getElementById('progressBox').classList.add('done');
  document.getElementById('stopBtn').style.display = 'none';
  const closeBtn = document.getElementById('closeProgressBtn');
  if (closeBtn) closeBtn.style.display = 'block';
  updateSendBtn();
  if (window.electronAPI?.showNotification) {
    window.electronAPI.showNotification({ title: 'ARX Send', body: 'Disparo concluído!' });
  }
}

function onSendStopped() {
  state.isSending = false;
  _clearSendTimer();
  const sendBtn = document.getElementById('sendBtn');
  sendBtn.classList.remove('loading');
  sendBtn.style.display = '';
  setText(document.getElementById('progLabel'), 'Parado');
  document.getElementById('stopBtn').style.display = 'none';
  const closeBtn = document.getElementById('closeProgressBtn');
  if (closeBtn) closeBtn.style.display = 'block';
  updateSendBtn();
}

// ── Ações de UI ──────────────────────────────────────────────────────

async function startSend() {
  if (state.isSending) return;
  const sendPhoneId = getSelectedSendPhoneId();
  if (!sendPhoneId) { alert('Selecione um telefone para enviar.'); return; }
  state.sendDelayMs = getDelayMs();

  updateSummary();
  const sendBtn = document.getElementById('sendBtn');
  sendBtn.classList.add('loading');
  sendBtn.disabled = true;

  const contactsData = {};
  state.importedContacts.forEach(c => { if (c.rowData) contactsData[c.id] = c.rowData; });

  try {
    const res = await api('/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contactIds: [...state.selectedIds],
        message: state.sendMode === 'file' ? '' : document.getElementById('msgText').value,
        filename: state.uploadedFile?.filename || null,
        delayMs: getDelayMs(),
        phoneId: sendPhoneId,
        contactsData: Object.keys(contactsData).length ? contactsData : undefined,
      }),
    });
    const data = await res.json();
    if (!data.ok) {
      sendBtn.classList.remove('loading');
      sendBtn.style.display = '';
      setText(document.getElementById('progLabel'), '❌ ' + (data.error || 'Erro ao iniciar disparo'));
      document.getElementById('progressBox').classList.add('show');
      document.getElementById('progressActions').style.display = 'flex';
    }
  } catch (e) {
    sendBtn.classList.remove('loading');
    sendBtn.style.display = '';
    setText(document.getElementById('progLabel'), '❌ Erro de comunicação: ' + e.message);
    document.getElementById('progressBox').classList.add('show');
    document.getElementById('progressActions').style.display = 'flex';
  }
}

async function stopSend() {
  await api('/stop', { method: 'POST' });
}

function closeProgressView() {
  document.getElementById('progressBox').classList.remove('show');
  const closeBtn = document.getElementById('closeProgressBtn');
  if (closeBtn) closeBtn.style.display = 'none';
}

window.onSendStart = onSendStart;
window.onSendProgressEvent = onSendProgressEvent;
window.onSendDone = onSendDone;
window.onSendStopped = onSendStopped;
window.startSend = startSend;
window.stopSend = stopSend;
window.closeProgressView = closeProgressView;
