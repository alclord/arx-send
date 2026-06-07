const config = require('../app/config');
const { sendMessages } = require('../services/sendService');
const { sessionMiddleware } = require('./sessionRoutes');

function registerSendRoutes(app, io) {
  app.post('/api/:sessionId/stop', sessionMiddleware, (req, res) => {
    req.sess.stopRequested = true;
    res.json({ ok: true });
  });

  app.post('/api/:sessionId/send', sessionMiddleware, async (req, res) => {
    const sess = req.sess;
    const sid = req.sessionId;

    if (sess.status !== 'ready') return res.status(400).json({ error: 'WhatsApp n\u00e3o conectado' });
    if (sess.isSending) return res.status(400).json({ error: 'Envio j\u00e1 em andamento' });

    const { contactIds, message, filename, delayMs, contactsData } = req.body;
    if (!contactIds?.length) return res.status(400).json({ error: 'Nenhum contato selecionado' });
    if (contactIds.length > config.MAX_CONTACTS_PER_SEND) {
      return res.status(400).json({ error: `M\u00e1ximo de ${config.MAX_CONTACTS_PER_SEND} contatos por envio` });
    }
    if (!message?.trim() && !filename) return res.status(400).json({ error: 'Mensagem ou arquivo obrigat\u00f3rio' });

    res.json({ ok: true, message: 'Envio iniciado' });

    sendMessages(sid, io, { contactIds, message, filename, delayMs, contactsData }).catch(err => {
      console.error(`[${sid}] Erro no envio:`, err.message);
    });
  });
}

module.exports = { registerSendRoutes };
