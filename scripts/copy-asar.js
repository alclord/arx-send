const fs = require('fs');
const path = require('path');

const pkg = require('../package.json');
const electronVersion = require('electron/package.json').version;

const src = path.join(__dirname, '..', 'dist', 'win-unpacked', 'resources', 'app.asar');
const destDir = path.join(__dirname, '..', 'dist');
const destAsar = path.join(destDir, 'app.asar');
const releaseJson = path.join(destDir, 'release.json');

if (!fs.existsSync(src)) {
  console.error('app.asar not found at', src);
  process.exit(1);
}

fs.copyFileSync(src, destAsar);
console.log('Copied app.asar to dist/');

const release = {
  version: pkg.version,
  electronVersion,
  minElectronVersion: electronVersion,
  artifacts: {
    asar: `app.asar`,
    installer: `ARX-Send-Setup-${pkg.version}.exe`,
  },
};

fs.writeFileSync(releaseJson, JSON.stringify(release, null, 2));
console.log('Generated release.json:', release);
