const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');

const rateLimitMap = new Map();

function cleanupRateLimit() {
  const now = Date.now();
  for (const [key, timestamps] of rateLimitMap) {
    const valid = timestamps.filter(t => now - t < 300000);
    if (valid.length === 0) rateLimitMap.delete(key);
    else rateLimitMap.set(key, valid);
  }
}

setInterval(cleanupRateLimit, 300000);

function createRateLimiter(windowMs, maxRequests) {
  return (req, res, next) => {
    const key = req.ip || req.connection?.remoteAddress || 'unknown';
    const now = Date.now();
    if (!rateLimitMap.has(key)) rateLimitMap.set(key, []);
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
    `script-src 'self'; ` +
    `style-src 'self' https://fonts.googleapis.com; ` +
    `font-src 'self' https://fonts.gstatic.com; ` +
    `img-src 'self' data: blob:; ` +
    `connect-src 'self' ws://localhost:* wss://localhost:*; ` +
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
  } catch (err) {
    console.warn('[security] Erro ao ler token:', err.message);
  }
  const token = crypto.randomBytes(32).toString('hex');
  try {
    const dir = path.dirname(AUTH_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(AUTH_FILE, token, { encoding: 'utf8', mode: 0o600 });
  } catch (err) {
    console.warn('[security] Erro ao salvar token:', err.message);
  }
  return token;
}

const AUTH_TOKEN = getOrCreateAuthToken();

function constantTimeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function authMiddleware(req, res, next) {
  if (process.env.NODE_ENV === 'development') return next();
  const token = req.headers['x-auth-token'];
  if (!token || !constantTimeCompare(token, AUTH_TOKEN)) {
    return res.status(401).json({ error: 'Não autorizado' });
  }
  next();
}

module.exports = { createRateLimiter, securityHeaders, authMiddleware, AUTH_TOKEN, constantTimeCompare };
