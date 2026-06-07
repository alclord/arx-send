const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');

const rateLimitMap = new Map();

function createRateLimiter(windowMs, maxRequests) {
  return (req, res, next) => {
    const key = req.ip || req.connection.remoteAddress || 'unknown';
    const now = Date.now();
    if (!rateLimitMap.has(key)) {
      rateLimitMap.set(key, []);
    }
    const timestamps = rateLimitMap.get(key).filter(t => now - t < windowMs);
    if (timestamps.length >= maxRequests) {
      return res.status(429).json({ error: 'Muitas requisições. Tente novamente em instantes.' });
    }
    timestamps.push(now);
    rateLimitMap.set(key, timestamps);
    next();
  };
}

function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy',
    `default-src 'self'; ` +
    `script-src 'self' 'unsafe-inline'; ` +
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; ` +
    `font-src 'self' https://fonts.gstatic.com; ` +
    `img-src 'self' data: blob:; ` +
    `connect-src 'self' ws: wss:; ` +
    `media-src 'self' data:;`
  );
  next();
}

const AUTH_FILE = path.join(
  process.env.LOCALAPPDATA || os.homedir(),
  'arx-send', '.auth_token'
);

function getOrCreateAuthToken() {
  try {
    if (fs.existsSync(AUTH_FILE)) {
      return fs.readFileSync(AUTH_FILE, 'utf8').trim();
    }
  } catch {}
  const token = crypto.randomBytes(32).toString('hex');
  try {
    const dir = path.dirname(AUTH_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(AUTH_FILE, token, 'utf8');
  } catch {}
  return token;
}

const AUTH_TOKEN = getOrCreateAuthToken();

function authMiddleware(req, res, next) {
  if (process.env.NODE_ENV === 'development') return next();
  const token = req.headers['x-auth-token'] || req.query.token;
  if (token === AUTH_TOKEN) return next();
  res.status(401).json({ error: 'Não autorizado' });
}

module.exports = { createRateLimiter, securityHeaders, authMiddleware, AUTH_TOKEN };
