const path = require('path');
const os = require('os');

const IS_PKG = Boolean(process.pkg);
const IS_ELECTRON = typeof process.versions !== 'undefined' && typeof process.versions.electron !== 'undefined';
const APP_NAME = 'arx-send';
const PORT = process.env.PORT || 3000;
const CURRENT_VERSION = require('../../package.json').version;

const GITHUB_OWNER = 'alclord';
const GITHUB_REPO = 'arx-send';
const ASSET_NAME = 'ARX-Send-Setup.exe';
const UPDATES_ENABLED = IS_PKG || process.env.CHECK_UPDATES === 'true';

const SESSION_ID_MAX_LENGTH = 30;
const MIN_SEND_DELAY_MS = 1500;
const DEFAULT_SEND_DELAY_MS = 3000;
const MAX_CONTACTS_PER_SEND = 5000;
const MAX_FILE_SIZE_BYTES = 64 * 1024 * 1024;
const MAX_SHEET_ROWS = 10001;
const CONTACT_LOAD_RETRIES = 8;
const WATCHDOG_TIMEOUT_MS = 180000;
const ORPHAN_FILE_AGE_MS = 2 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const UPDATE_CHECK_INITIAL_MS = 30 * 1000;
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

const ALLOWED_UPLOAD_EXTS = new Set([
  '.jpg','.jpeg','.png','.gif','.webp','.bmp',
  '.mp4','.mov','.avi','.mkv','.3gp',
  '.mp3','.ogg','.wav','.aac','.m4a',
  '.pdf','.doc','.docx','.xls','.xlsx','.ppt','.pptx','.zip','.txt'
]);

const tmpDir = require('os').tmpdir();

const appDataBase = IS_PKG
  ? path.join(process.env.LOCALAPPDATA || os.homedir(), APP_NAME)
  : IS_ELECTRON
  ? path.join(process.env.APPDATA || os.homedir(), APP_NAME)
  : path.join(__dirname, '../..');

const uploadsDir = path.join(appDataBase, 'uploads');
const cacheDir = path.join(appDataBase, 'cache');
const sessionDir = process.platform === 'win32'
  ? path.join(process.env.LOCALAPPDATA || os.tmpdir(), APP_NAME, 'sessions')
  : path.join(appDataBase, '.wa_sessions');

module.exports = {
  IS_PKG, APP_NAME, PORT, CURRENT_VERSION,
  GITHUB_OWNER, GITHUB_REPO, ASSET_NAME, UPDATES_ENABLED,
  SESSION_ID_MAX_LENGTH, MIN_SEND_DELAY_MS, DEFAULT_SEND_DELAY_MS,
  MAX_CONTACTS_PER_SEND, MAX_FILE_SIZE_BYTES, MAX_SHEET_ROWS,
  CONTACT_LOAD_RETRIES, WATCHDOG_TIMEOUT_MS,
  ORPHAN_FILE_AGE_MS, CLEANUP_INTERVAL_MS,
  UPDATE_CHECK_INITIAL_MS, UPDATE_CHECK_INTERVAL_MS,
  ALLOWED_UPLOAD_EXTS, tmpDir,
  appDataBase, uploadsDir, cacheDir, sessionDir
};
