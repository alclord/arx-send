const https = require('https');
const http = require('http');
const fs = require('fs');

function isNewerVersion(latest, current) {
  const parse = v => v.replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  const a = parse(latest);
  const b = parse(current);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

function fetchLatestRelease(owner, repo) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: `/repos/${owner}/${repo}/releases/latest`,
      headers: { 'User-Agent': 'arx-send-updater', 'Accept': 'application/vnd.github.v3+json' },
    };
    const req = https.get(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`GitHub API: HTTP ${res.statusCode}`));
        }
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('Resposta inv\u00e1lida da API do GitHub')); }
      });
      res.on('error', reject);
    });
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout ao verificar atualiza\u00e7\u00f5es')); });
    req.on('error', reject);
  });
}

function downloadFile(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const follow = (currentUrl) => {
      const mod = currentUrl.startsWith('https://') ? https : http;
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
        out.on('finish', () => out.close(resolve));
        out.on('error', err => { fs.unlink(destPath, () => {}); reject(err); });
        res.on('error', err => { out.destroy(); fs.unlink(destPath, () => {}); reject(err); });
      });
      req.setTimeout(60000, () => { req.destroy(); reject(new Error('Timeout no download')); });
      req.on('error', reject);
    };
    follow(url);
  });
}

module.exports = { isNewerVersion, fetchLatestRelease, downloadFile };
