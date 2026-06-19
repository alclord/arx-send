const config = require('../app/config');
const { sanitizeSessionId } = require('../utils/helpers');
const { getSession, phonesListPayload, connectPhone } = require('../services/sessionService');
const { updateState } = require('../services/updateService');

function registerSocketHandlers(io) {
  io.on('connection', (socket) => {
    let currentSessionId = null;

    socket.on('join_session', (rawId) => {
      const sessionId = sanitizeSessionId(rawId);
      if (!sessionId) return;

      currentSessionId = sessionId;
      socket.join(`s:${sessionId}`);
      const sess = getSession(sessionId);

      socket.emit('session_joined', { sessionId });
      socket.emit('phones_list', { phones: phonesListPayload(sess) });

      // Emite contatos em cache de cada telefone pronto
      for (const phone of Object.values(sess.phones)) {
        if (phone.contacts.length > 0) {
          socket.emit('phone_contacts', { phoneId: phone.id, contacts: phone.contacts });
        }
      }

      // Auto-reconectar telefones salvos que não estão ativos
      for (const phone of Object.values(sess.phones)) {
        if (!phone.client && phone.status === 'disconnected') {
          connectPhone(sessionId, phone.id, io).catch(err =>
            console.error(`[${sessionId}:${phone.id}] Auto-reconectar erro:`, err)
          );
        }
      }

      socket.emit('update_status', {
        currentVersion: config.CURRENT_VERSION,
        status: updateState.status,
        version: updateState.version,
        progress: updateState.progress,
      });
    });

    socket.on('disconnect', () => {
      if (currentSessionId) {
        socket.leave(`s:${currentSessionId}`);
      }
    });
  });
}

module.exports = { registerSocketHandlers };
