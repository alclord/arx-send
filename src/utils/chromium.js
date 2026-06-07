const path = require('path');
const fs = require('fs');

function getChromiumPath() {
  if (process.platform === 'linux') {
    const candidates = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
    return undefined;
  }
  const winCandidates = [
    path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
  ];
  for (const p of winCandidates) {
    if (p && fs.existsSync(p)) return p;
  }
  const base = path.join(process.env.USERPROFILE || process.env.HOME || '', '.cache', 'puppeteer', 'chrome');
  if (!fs.existsSync(base)) return undefined;
  const builds = fs.readdirSync(base).filter(d => d.startsWith('win64-'));
  if (!builds.length) return undefined;
  const exe = path.join(base, builds[builds.length - 1], 'chrome-win64', 'chrome.exe');
  return fs.existsSync(exe) ? exe : undefined;
}

module.exports = { getChromiumPath };
