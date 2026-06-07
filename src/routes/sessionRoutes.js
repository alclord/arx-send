const { sanitizeSessionId } = require('../utils/helpers');
const { getSession, connectSession, destroySession, loadContacts, emit } = require('../services/sessionService');

function sessionMiddleware(req, res, next) {
  const id = sanitizeSessionId(req.params.sessionId);
  if (!id) return res.status(400).json({ error: 'sessionId inv\u00e1lido' });
  req.sessionId = id;
  req.sess = getSession(id);
  next();
}

function registerSessionRoutes(app, io) {
  app.get('/api/:sessionId/status', sessionMiddleware, (req, res) => {
    const s = req.sess;
    res.json({ status: s.status, contacts: s.contacts.length });
  });

  app.post('/api/:sessionId/connect', sessionMiddleware, (req, res) => {
    const s = req.sess;
    if (s.status === 'ready') return res.json({ ok: true, message: 'J\u00e1 conectado' });
    if (s.status === 'connecting') return res.json({ ok: true, message: 'J\u00e1 conectando...' });
    connectSession(req.sessionId, io);
    res.json({ ok: true, message: 'Iniciando conex\u00e3o...' });
  });

  app.post('/api/:sessionId/disconnect', sessionMiddleware, async (req, res) => {
    const sid = req.sessionId;
    await destroySession(sid);
    emit(sid, io, 'status', { status: 'disconnected', message: 'Desconectado' });
    emit(sid, io, 'contacts', { contacts: [] });
    res.json({ ok: true });
  });

  app.post('/api/:sessionId/reload-contacts', sessionMiddleware, async (req, res) => {
    if (req.sess.status !== 'ready') return res.status(400).json({ error: 'N\u00e3o conectado' });
    await loadContacts(req.sessionId, io);
    res.json({ ok: true, count: req.sess.contacts.length });
  });
}

module.exports = { registerSessionRoutes, sessionMiddleware };
