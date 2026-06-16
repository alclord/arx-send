const { sanitizeSessionId } = require('../utils/helpers');
const {
  getSession, addPhone, renamePhone, removePhone,
  connectPhone, disconnectPhone, loadContactsForPhone,
  emit, emitPhonesList, phonesListPayload, MAX_PHONES_PER_SESSION,
} = require('../services/sessionService');

function sessionMiddleware(req, res, next) {
  const id = sanitizeSessionId(req.params.sessionId);
  if (!id) return res.status(400).json({ error: 'sessionId inválido' });
  req.sessionId = id;
  req.sess = getSession(id);
  next();
}

function phoneMiddleware(req, res, next) {
  const phone = req.sess.phones[req.params.phoneId];
  if (!phone) return res.status(404).json({ error: 'Telefone não encontrado' });
  req.phone = phone;
  req.phoneId = req.params.phoneId;
  next();
}

function registerSessionRoutes(app, io) {
  // Listar telefones
  app.get('/api/:sessionId/phones', sessionMiddleware, (req, res) => {
    res.json({ phones: phonesListPayload(req.sess) });
  });

  // Adicionar telefone
  app.post('/api/:sessionId/phones', sessionMiddleware, (req, res) => {
    const name = String(req.body.name || '').trim().slice(0, 50);
    if (!name) return res.status(400).json({ error: 'Nome obrigatório' });
    if (Object.keys(req.sess.phones).length >= MAX_PHONES_PER_SESSION) {
      return res.status(400).json({ error: `Máximo de ${MAX_PHONES_PER_SESSION} telefones por sessão` });
    }
    const phoneId = addPhone(req.sessionId, name);
    emitPhonesList(req.sessionId, io);
    res.json({ ok: true, phoneId });
  });

  // Renomear telefone
  app.patch('/api/:sessionId/phones/:phoneId', sessionMiddleware, phoneMiddleware, (req, res) => {
    const name = String(req.body.name || '').trim().slice(0, 50);
    if (!name) return res.status(400).json({ error: 'Nome obrigatório' });
    renamePhone(req.sessionId, req.phoneId, name);
    emitPhonesList(req.sessionId, io);
    res.json({ ok: true });
  });

  // Conectar telefone
  app.post('/api/:sessionId/phones/:phoneId/connect', sessionMiddleware, phoneMiddleware, (req, res) => {
    const phone = req.phone;
    if (phone.status === 'ready') return res.json({ ok: true, message: 'Já conectado' });
    if (phone.status === 'connecting') return res.json({ ok: true, message: 'Já conectando...' });
    connectPhone(req.sessionId, req.phoneId, io);
    res.json({ ok: true });
  });

  // Desconectar telefone
  app.post('/api/:sessionId/phones/:phoneId/disconnect', sessionMiddleware, phoneMiddleware, async (req, res) => {
    await disconnectPhone(req.sessionId, req.phoneId);
    emit(req.sessionId, io, 'phone_status', { phoneId: req.phoneId, status: 'disconnected', message: 'Desconectado' });
    emit(req.sessionId, io, 'phone_contacts', { phoneId: req.phoneId, contacts: [] });
    emitPhonesList(req.sessionId, io);
    res.json({ ok: true });
  });

  // Remover telefone
  app.delete('/api/:sessionId/phones/:phoneId', sessionMiddleware, phoneMiddleware, (req, res) => {
    removePhone(req.sessionId, req.phoneId);
    emitPhonesList(req.sessionId, io);
    res.json({ ok: true });
  });

  // Recarregar contatos de um telefone
  app.post('/api/:sessionId/phones/:phoneId/reload-contacts', sessionMiddleware, phoneMiddleware, async (req, res) => {
    if (req.phone.status !== 'ready') return res.status(400).json({ error: 'Telefone não conectado' });
    await loadContactsForPhone(req.sessionId, req.phoneId, io);
    res.json({ ok: true, count: req.phone.contacts.length });
  });

  // Status geral da sessão (compat)
  app.get('/api/:sessionId/status', sessionMiddleware, (req, res) => {
    const phones = Object.values(req.sess.phones);
    res.json({ phones: phones.length, ready: phones.filter(p => p.status === 'ready').length });
  });
}

module.exports = { registerSessionRoutes, sessionMiddleware };
