const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const pkg = require('../package.json');
const electronVersion = require('electron/package.json').version;

const src = path.join(__dirname, '..', 'dist', 'win-unpacked', 'resources', 'app.asar');
const destDir = path.join(__dirname, '..', 'dist');
const destAsar = path.join(destDir, 'app.asar');
const installerExe = path.join(destDir, `ARX-Send-Setup-${pkg.version}.exe`);
const releaseJson = path.join(destDir, 'release.json');

if (!fs.existsSync(src)) {
  console.error('app.asar not found at', src);
  process.exit(1);
}

fs.copyFileSync(src, destAsar);
console.log('Copied app.asar to dist/');

function sha256File(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

const asarHash = sha256File(destAsar);
const installerHash = sha256File(installerExe);

const release = {
  version: pkg.version,
  electronVersion,
  minElectronVersion: electronVersion,
  artifacts: {
    asar: 'app.asar',
    installer: `ARX-Send-Setup-${pkg.version}.exe`,
  },
  sha256: {
    'app.asar': asarHash,
    ...(installerHash && { [`ARX-Send-Setup-${pkg.version}.exe`]: installerHash }),
  },
};

fs.writeFileSync(releaseJson, JSON.stringify(release, null, 2));
console.log('Generated release.json with SHA-256 hashes:', {
  'app.asar': asarHash?.slice(0, 16) + '...',
  installer: installerHash?.slice(0, 16) + '...',
});
