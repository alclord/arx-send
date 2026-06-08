const config = require('../app/config');
const { sanitizeSessionId } = require('../utils/helpers');
const { getSession } = require('../services/sessionService');
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
      socket.emit('status', {
        status: sess.status,
        message: sess.status === 'ready' ? `Pronto — ${sess.contacts.length} conversas carregadas`
               : sess.status === 'connecting' ? 'Conectando...'
               : sess.status === 'qr' ? 'Aguardando leitura do QR code...'
               : 'Desconectado'
      });

      if (sess.contacts.length > 0) {
        socket.emit('contacts', { contacts: sess.contacts });
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
