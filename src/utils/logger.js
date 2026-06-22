const fs = require('fs');
const path = require('path');

const MAX_FILE_BYTES = 1 * 1024 * 1024;
const MAX_BUFFER = 500;

class Logger {
  constructor() {
    this._buf = [];
    this._file = null;
  }

  init(logsDir) {
    try {
      if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
    } catch {}
    this._file = path.join(logsDir, 'app.log');
    this._maybeRotate();

    const self = this;
    const origLog = console.log.bind(console);
    const origWarn = console.warn.bind(console);
    const origError = console.error.bind(console);

    console.log = (...a) => { origLog(...a); self._write('INFO', a); };
    console.warn = (...a) => { origWarn(...a); self._write('WARN', a); };
    console.error = (...a) => {
      origError(...a);
      const isDeprecation = a.some(x => typeof x === 'string' && x.includes('DeprecationWarning'));
      self._write(isDeprecation ? 'WARN' : 'ERROR', a);
    };
  }

  _ts() {
    return new Date().toISOString().replace('T', ' ').slice(0, 19);
  }

  _serialize(a) {
    if (a instanceof Error) return a.stack || a.message;
    if (typeof a === 'object' && a !== null) {
      try { return JSON.stringify(a); } catch { return String(a); }
    }
    return String(a);
  }

  _write(level, args) {
    const msg = args.map(a => this._serialize(a)).join(' ');
    const line = `[${this._ts()}] [${level}] ${msg}`;
    this._buf.push(line);
    if (this._buf.length > MAX_BUFFER) this._buf.shift();
    if (this._file) {
      try {
        fs.appendFileSync(this._file, line + '\n', 'utf8');
        this._maybeRotate();
      } catch {}
    }
  }

  _maybeRotate() {
    if (!this._file) return;
    try {
      if (fs.existsSync(this._file) && fs.statSync(this._file).size >= MAX_FILE_BYTES) {
        const old = this._file.replace('.log', '.1.log');
        try { fs.unlinkSync(old); } catch {}
        fs.renameSync(this._file, old);
      }
    } catch {}
  }

  info(...a) { this._write('INFO', a); }
  warn(...a) { this._write('WARN', a); }
  error(...a) { this._write('ERROR', a); }

  getLines() { return [...this._buf]; }
  getFilePath() { return this._file || ''; }
}

module.exports = new Logger();
