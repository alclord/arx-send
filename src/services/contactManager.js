
/**
 * @fileoverview contactManager — carregamento e cache de contatos WhatsApp.
 *
 * Responsabilidade única: obter contatos via getChats(), cachear em disco
 * e emitir eventos Socket.io para o frontend.
 */

const config = require('../app/config');
const logger = require('../utils/logger');
const { sleep } = require('../utils/helpers');
const { saveCachedContacts } = require('./phoneStore');
const { EVENTS } = require('../socket/events');

/**
 * Emite evento para um room de sessão.
 * @param {string} sessionId
 * @param {import('socket.io').Server} io
 * @param {string} event
 * @param {*} data
 */
function emitToSession(sessionId, io, event, data) {
  io.to(`s:${sessionId}`).emit(event, data);
}

/**
 * Carrega contatos de um telefone com retry automático.
 * Emite phone_contacts e phone_status durante o processo.
 *
 * @param {import('../types').Session} sess
 * @param {string} phoneId
 * @param {import('socket.io').Server} io
 * @param {number} [attempt]
 */
async function loadContactsForPhone(sess, phoneId, io, attempt = 1) {
  const sessionId = sess.id;
  const phone = sess.phones[phoneId];
  if (!phone || phone.status !== 'ready' || !phone.client) return;

  const retryMs = attempt === 1 ? 4000 : 6000;

  emitToSession(sessionId, io, EVENTS.PHONE_STATUS, {
    phoneId,
    status: 'ready',
    message: `Carregando contatos${attempt > 1 ? ` (${attempt}/${config.CONTACT_LOAD_RETRIES})` : ''}...`,
  });

  try {
    const chats = await phone.client.getChats();
    logger.info(`[${sessionId}:${phoneId}] getChats tentativa ${attempt}: ${chats.length} conversas`);

    if (chats.length === 0 && attempt < config.CONTACT_LOAD_RETRIES) {
      await sleep(retryMs);
      return loadContactsForPhone(sess, phoneId, io, attempt + 1);
    }

    phone.contacts = chats
      .map(c => ({
        id: c.id._serialized,
        name: c.name || c.id.user,
        isGroup: c.isGroup,
        unread: c.unreadCount || 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    await saveCachedContacts(phoneId, phone.contacts);
    emitToSession(sessionId, io, EVENTS.PHONE_CONTACTS, { phoneId, contacts: phone.contacts });
    emitToSession(sessionId, io, EVENTS.PHONE_STATUS, {
      phoneId,
      status: 'ready',
      message: `Pronto — ${phone.contacts.length} conversas carregadas`,
    });
    const { emitPhonesList } = require('./sessionService');
    emitPhonesList(sessionId, io);
    return 'ok';
  } catch (e) {
    logger.error(`[${sessionId}:${phoneId}] Erro ao carregar contatos (tentativa ${attempt}):`, e.message);
    const transient =
      e.message.includes('timed out') ||
      e.message.includes('context') ||
      e.message.includes('Target') ||
      e.message.includes('is not defined') ||
      // Página ainda reinjetando funções logo após o QR/autenticação
      e.message.includes('Cannot read properties of undefined') ||
      // ReferenceError minificada do bundle interno do WhatsApp Web (ex: "r", "e1")
      /^[a-zA-Z_$][\w$]*$/.test(e.message.trim());
    if (transient && attempt < config.CONTACT_LOAD_RETRIES) {
      await sleep(retryMs);
      return loadContactsForPhone(sess, phoneId, io, attempt + 1);
    }
    if (transient) {
      return 'needs_reconnect';
    }
    emitToSession(sessionId, io, EVENTS.PHONE_STATUS, {
      phoneId,
      status: 'ready',
      message: 'Erro ao carregar contatos.',
    });
    return 'error';
  }
}

module.exports = { loadContactsForPhone };
