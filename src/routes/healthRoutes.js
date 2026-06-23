
/**
 * @fileoverview healthRoutes — endpoint de health check do ARX Send.
 *
 * GET /api/health — retorna status de cada telefone conectado.
 * Útil para diagnóstico sem abrir o painel de logs.
 */

const config = require('../app/config');
const { sessions } = require('../services/sessionService');

/**
 * @param {import('express').Application} app
 */
function registerHealthRoutes(app) {
  app.get('/api/health', (req, res) => {
    const phoneSummaries = [];

    for (const [sessionId, sess] of Object.entries(sessions)) {
      for (const phone of Object.values(sess.phones)) {
        phoneSummaries.push({
          session: sessionId,
          phoneId: phone.id,
          name: phone.name,
          status: phone.status,
          contacts: phone.contacts.length,
          isSending: sess.isSending,
        });
      }
    }

    res.json({
      ok: true,
      version: config.CURRENT_VERSION,
      uptime: Math.floor(process.uptime()),
      sessions: Object.keys(sessions).length,
      phones: phoneSummaries,
    });
  });
}

module.exports = { registerHealthRoutes };
