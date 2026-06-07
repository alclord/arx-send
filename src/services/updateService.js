const path = require('path');
const os = require('os');
const fs = require('fs');
const config = require('../app/config');
const { isNewerVersion, fetchLatestRelease, downloadFile } = require('../updater/index');

const updateState = {
  status: 'idle',
  version: null,
  progress: 0,
  filePath: null,
  downloadUrl: null,
};
let updateCheckInProgress = false;

function emitUpdateStatus(io) {
  io.emit('update_status', {
    currentVersion: config.CURRENT_VERSION,
    status: updateState.status,
    version: updateState.version,
    progress: updateState.progress,
  });
}

async function downloadUpdate(io) {
  if (updateState.status === 'ready') return;
  updateState.status = 'downloading';
  updateState.progress = 0;
  emitUpdateStatus(io);

  const dest = path.join(os.tmpdir(), `ARX-Send-Setup-${updateState.version}.exe`);
  try {
    await downloadFile(updateState.downloadUrl, dest, (pct) => {
      updateState.progress = pct;
      emitUpdateStatus(io);
    });
    updateState.status = 'ready';
    updateState.filePath = dest;
    updateState.progress = 100;
    emitUpdateStatus(io);
    console.log(`[update] Vers\u00e3o ${updateState.version} pronta em: ${dest}`);
  } catch (err) {
    console.warn('[update] Erro ao baixar atualiza\u00e7\u00e3o:', err.message);
    updateState.status = 'available';
    updateState.progress = 0;
    emitUpdateStatus(io);
    fs.promises.unlink(dest).catch(() => {});
  }
}

async function checkForUpdates(io) {
  if (updateCheckInProgress) return;
  if (updateState.status === 'downloading' || updateState.status === 'ready') return;

  updateCheckInProgress = true;
  updateState.status = 'checking';
  emitUpdateStatus(io);

  try {
    const release = await fetchLatestRelease(config.GITHUB_OWNER, config.GITHUB_REPO);

    if (!release.tag_name) {
      updateState.status = 'idle';
      emitUpdateStatus(io);
      return;
    }

    if (!isNewerVersion(release.tag_name, config.CURRENT_VERSION)) {
      updateState.status = 'up_to_date';
      updateState.version = release.tag_name;
      emitUpdateStatus(io);
      return;
    }

    const asset = release.assets?.find(a => a.name === config.ASSET_NAME);
    if (!asset) {
      console.warn(`[update] Asset "${config.ASSET_NAME}" n\u00e3o encontrado na release ${release.tag_name}`);
      updateState.status = 'idle';
      emitUpdateStatus(io);
      return;
    }

    updateState.version = release.tag_name;
    updateState.downloadUrl = asset.browser_download_url;
    updateState.status = 'available';
    emitUpdateStatus(io);

    await downloadUpdate(io);
  } catch (err) {
    console.warn('[update] Erro ao verificar atualiza\u00e7\u00f5es:', err.message);
    updateState.status = 'idle';
    emitUpdateStatus(io);
  } finally {
    updateCheckInProgress = false;
  }
}

module.exports = {
  updateState,
  emitUpdateStatus,
  checkForUpdates,
  downloadUpdate,
};
