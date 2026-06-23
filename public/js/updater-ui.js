
/**
 * @fileoverview updater-ui.js — banner de atualização e comunicação IPC com o updater.
 *
 * Trata eventos update_status (Socket.io e IPC Electron) e expõe as ações
 * installUpdate() e checkForUpdates() para o HTML.
 *
 * Depende de: state.js
 */

/* globals state, setText, setHTML, esc */

// ── IPC Electron (eventos push do main process) ───────────────────────

if (window.electronAPI?.onUpdateStatus) {
  window.electronAPI.onUpdateStatus(({ status, progress, message, type, version, electronChanged }) => {
    const text = document.getElementById('updateText');
    const progWrap = document.getElementById('updateProgWrap');
    const progBar = document.getElementById('updateProgBar');
    const pctEl = document.getElementById('updatePct');
    const btn = document.getElementById('updateBtn');
    const checkBtn = document.getElementById('checkUpdateBtn');
    const banner = document.getElementById('updateBanner');
    const dot = document.getElementById('updateDot');
    const wrap = document.getElementById('updateWrap');
    banner?.classList.add('show');

    if (status === 'available') {
      state.pendingUpdateInfo = { updateAvailable: true, version, electronChanged };
      if (electronChanged) {
        setHTML(text, `Nova versão <strong>${esc(version)}</strong> disponível (requer instalador completo)`);
        setText(btn, 'Baixar instalador');
      } else {
        setHTML(text, `Nova versão <strong>${esc(version)}</strong> disponível`);
        setText(btn, 'Baixar e reiniciar');
      }
      btn.style.display = '';
      btn.disabled = false;
      progWrap.style.display = 'none';
      setText(pctEl, '');
      checkBtn.style.display = 'none';
      if (dot) dot.style.display = 'block';
      if (wrap) wrap.classList.add('available');
    } else if (status === 'downloading') {
      checkBtn.style.display = 'none';
      setText(text, type === 'asar' ? 'Baixando atualização leve...' : 'Baixando instalador (Electron atualizado)...');
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

// ── Handler de evento Socket.io update_status ─────────────────────────

function onUpdateStatusEvent({ status, version, progress }) {
  const banner = document.getElementById('updateBanner');
  const text = document.getElementById('updateText');
  const progWrap = document.getElementById('updateProgWrap');
  const progBar = document.getElementById('updateProgBar');
  const pctEl = document.getElementById('updatePct');
  const btn = document.getElementById('updateBtn');
  const dot = document.getElementById('updateDot');
  const wrap = document.getElementById('updateWrap');

  const isActive = status === 'available' || status === 'ready';
  if (dot) dot.style.display = isActive ? 'block' : 'none';
  if (wrap) wrap.classList.toggle('available', isActive);

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
}

// ── Ações ─────────────────────────────────────────────────────────────

async function installUpdate() {
  if (!state.pendingUpdateInfo) return;
  if (window.electronAPI?.downloadUpdate) {
    const btn = document.getElementById('updateBtn');
    const text = document.getElementById('updateText');
    btn.disabled = true;
    setText(btn, 'Baixando...');
    const result = await window.electronAPI.downloadUpdate(state.pendingUpdateInfo);
    if (result && !result.ok) {
      btn.disabled = false;
      setText(btn, state.pendingUpdateInfo.electronChanged ? 'Baixar instalador' : 'Baixar e reiniciar');
      setText(text, `Erro: ${result.error}`);
    }
    return;
  }
  if (!confirm('O aplicativo será fechado para instalar a atualização e reabrirá automaticamente.\n\nDeseja continuar?')) return;
  const btn = document.getElementById('updateBtn');
  const text = document.getElementById('updateText');
  btn.disabled = true;
  setText(btn, 'Instalando...');
  setText(text, 'Instalando atualização — o app reabrirá em instantes...');
  try { await fetch('/api/update/install', { method: 'POST' }); } catch {}
}

async function checkForUpdates() {
  const text = document.getElementById('updateText');
  const btn = document.getElementById('checkUpdateBtn');
  const updateBtn = document.getElementById('updateBtn');
  const wrap = document.getElementById('updateWrap');
  const banner = document.getElementById('updateBanner');
  wrap?.classList.add('checking');
  banner?.classList.add('show');
  btn.disabled = true;
  setText(btn, 'Verificando...');
  setText(text, 'Verificando atualizações...');
  updateBtn.style.display = 'none';

  if (window.electronAPI?.checkForUpdates) {
    const result = await window.electronAPI.checkForUpdates();
    wrap?.classList.remove('checking');
    btn.disabled = false;
    setText(btn, 'Verificar atualizações');
    if (result.updateAvailable) {
      state.pendingUpdateInfo = result;
      setHTML(text, result.electronChanged
        ? `Nova versão <strong>${esc(result.version)}</strong> disponível (Electron atualizado — instalador completo)`
        : `Nova versão <strong>${esc(result.version)}</strong> disponível (atualização leve)`
      );
      updateBtn.style.display = '';
      setText(updateBtn, result.electronChanged ? 'Baixar instalador' : 'Baixar e reiniciar');
    } else {
      setText(text, 'Você já está na versão mais recente.');
      state.pendingUpdateInfo = null;
      setTimeout(() => banner?.classList.remove('show'), 3000);
    }
    return;
  }

  try {
    const res = await fetch('/api/update/check');
    const data = await res.json();
    wrap?.classList.remove('checking');
    btn.disabled = false;
    setText(btn, 'Verificar atualizações');
    if (data.updateAvailable) {
      setHTML(text, `Nova versão <strong>${esc(data.latestVersion)}</strong> disponível`);
      updateBtn.style.display = '';
    } else {
      setText(text, 'Você já está na versão mais recente.');
      setTimeout(() => banner?.classList.remove('show'), 3000);
    }
  } catch {
    wrap?.classList.remove('checking');
    btn.disabled = false;
    setText(btn, 'Verificar atualizações');
    setText(text, 'Erro ao verificar atualizações.');
  }
}

window.onUpdateStatusEvent = onUpdateStatusEvent;
window.installUpdate = installUpdate;
window.checkForUpdates = checkForUpdates;
