const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app, shell } = require('electron');
const { isNewerVersion } = require('./index');

const GITHUB_API = 'https://api.github.com';

function computeSha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

class AutoUpdater {
  constructor({ owner, repo, currentVersion, onStatus }) {
    this.owner = owner;
    this.repo = repo;
    this.currentVersion = currentVersion;
    this.onStatus = onStatus || (() => {});
    this._aborted = false;
  }

  abort() {
    this._aborted = true;
  }

  async check() {
    this._aborted = false;
    const release = await this._fetchLatestRelease();
    if (this._aborted) return { updateAvailable: false };

    if (!isNewerVersion(release.tag_name, this.currentVersion)) {
      return { updateAvailable: false };
    }

    const releaseJson = await this._downloadReleaseJson(release);
    if (this._aborted) return { updateAvailable: false };

    const electronChanged = releaseJson.electronVersion !== process.versions.electron;

    return {
      updateAvailable: true,
      version: release.tag_name.replace(/^v/, ''),
      electronChanged,
      release,
      releaseJson,
    };
  }

  async downloadAndApply(updateInfo) {
    this._aborted = false;
    const { release, releaseJson, electronChanged } = updateInfo;

    if (electronChanged) {
      return this._downloadInstaller(release, releaseJson);
    } else {
      return this._downloadAsar(release, releaseJson);
    }
  }

  async _downloadAsar(release, releaseJson) {
    const asarAsset = release.assets.find(a => a.name === 'app.asar');
    if (!asarAsset) throw new Error('app.asar not found in release');

    this.onStatus({ status: 'downloading', progress: 0, message: 'Baixando atualização...', type: 'asar' });

    const tmpPath = path.join(app.getPath('temp'), 'app.asar.update');
    await this._downloadFile(asarAsset.browser_download_url, tmpPath, (progress) => {
      this.onStatus({ status: 'downloading', progress, message: `Baixando... ${progress}%`, type: 'asar' });
    });

    if (this._aborted) { fs.unlinkSync(tmpPath); return { applied: false }; }

    // Verify SHA-256 if provided in release.json
    const expectedHash = releaseJson?.sha256?.['app.asar'];
    if (expectedHash) {
      this.onStatus({ status: 'installing', message: 'Verificando integridade...' });
      const actualHash = await computeSha256(tmpPath);
      if (actualHash !== expectedHash.toLowerCase()) {
        fs.unlinkSync(tmpPath);
        throw new Error('Falha na verificação de integridade (SHA-256 inválido). Tente novamente.');
      }
    }

    const resourcesPath = process.resourcesPath || path.join(app.getAppPath(), '..');
    const destPath = path.join(resourcesPath, 'app.asar');

    this.onStatus({ status: 'installing', message: 'Instalando atualização...' });

    try {
      fs.copyFileSync(tmpPath, destPath);
      fs.unlinkSync(tmpPath);
    } catch (err) {
      fs.unlinkSync(tmpPath);
      throw new Error('Não foi possível substituir o app.asar. Execute como administrador.');
    }

    this.onStatus({ status: 'ready', message: 'Atualização instalada! Reiniciando...' });

    setTimeout(() => app.relaunch(), 1500);
    setTimeout(() => app.quit(), 2000);

    return { applied: true };
  }

  async _downloadInstaller(release, releaseJson) {
    const exeAsset = release.assets.find(a => a.name.endsWith('.exe'));
    if (!exeAsset) throw new Error('Installer not found in release');

    this.onStatus({ status: 'downloading', progress: 0, message: 'Baixando instalador (Electron atualizado)...', type: 'installer' });

    const tmpPath = path.join(app.getPath('temp'), exeAsset.name);
    await this._downloadFile(exeAsset.browser_download_url, tmpPath, (progress) => {
      this.onStatus({ status: 'downloading', progress, message: `Baixando instalador... ${progress}%`, type: 'installer' });
    });

    if (this._aborted) { fs.unlinkSync(tmpPath); return { applied: false }; }

    // Verify SHA-256 if provided in release.json
    const expectedHash = releaseJson?.sha256?.[exeAsset.name];
    if (expectedHash) {
      this.onStatus({ status: 'installing', message: 'Verificando integridade do instalador...' });
      const actualHash = await computeSha256(tmpPath);
      if (actualHash !== expectedHash.toLowerCase()) {
        fs.unlinkSync(tmpPath);
        throw new Error('Falha na verificação de integridade do instalador (SHA-256 inválido). Tente novamente.');
      }
    }

    this.onStatus({ status: 'ready', message: 'Instalador baixado. Iniciando instalação...' });

    setTimeout(() => {
      shell.openPath(tmpPath);
      app.quit();
    }, 1500);

    return { applied: true };
  }

  async _fetchLatestRelease() {
    const url = `${GITHUB_API}/repos/${this.owner}/${this.repo}/releases/latest`;
    return new Promise((resolve, reject) => {
      const req = https.get(url, { headers: { 'User-Agent': 'arx-send-updater' } }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            return reject(new Error(`GitHub API: HTTP ${res.statusCode}`));
          }
          try { resolve(JSON.parse(data)); }
          catch { reject(new Error('Resposta inválida do GitHub')); }
        });
        res.on('error', reject);
      });
      req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
      req.on('error', reject);
    });
  }

  async _downloadReleaseJson(release) {
    const asset = release.assets.find(a => a.name === 'release.json');
    if (!asset) throw new Error('release.json not found in release');

    const url = asset.browser_download_url;
    return new Promise((resolve, reject) => {
      const req = https.get(url, { headers: { 'User-Agent': 'arx-send-updater' } }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch { reject(new Error('release.json inválido')); }
        });
        res.on('error', reject);
      });
      req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
      req.on('error', reject);
    });
  }

  _downloadFile(url, destPath, onProgress) {
    return new Promise((resolve, reject) => {
      const follow = (currentUrl) => {
        const mod = currentUrl.startsWith('https') ? https : http;
        const req = mod.get(currentUrl, { headers: { 'User-Agent': 'arx-send-updater' } }, (res) => {
          if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
            return follow(res.headers.location);
          }
          if (res.statusCode !== 200) {
            return reject(new Error(`Download falhou: HTTP ${res.statusCode}`));
          }
          const total = parseInt(res.headers['content-length'] || '0', 10);
          let received = 0;
          const out = fs.createWriteStream(destPath);
          res.on('data', chunk => {
            received += chunk.length;
            if (total > 0 && onProgress) onProgress(Math.round(received / total * 100));
          });
          res.pipe(out);
          out.on('finish', () => resolve());
          out.on('error', err => { fs.unlink(destPath, () => {}); reject(err); });
          res.on('error', err => { out.destroy(); fs.unlink(destPath, () => {}); reject(err); });
        });
        req.setTimeout(120000, () => { req.destroy(); reject(new Error('Timeout no download')); });
        req.on('error', reject);
      };
      follow(url);
    });
  }
}

module.exports = { AutoUpdater };
