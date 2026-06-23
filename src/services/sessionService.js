
/**
 * @fileoverview sessionService — fachada de gerenciamento de sessões.
 *
 * Mantém o mapa de sessões em memória e re-exporta as operações dos três
 * módulos especializados: phoneStore, connectionManager, contactManager.
 *
 * Toda a API pública deste módulo permanece idêntica à versão anterior
 * para garantir compatibilidade com routes e socket handlers existentes.
 */

const config = require('../app/config');
const logger = require('../utils/logger');
const { loadPhones, savePhones, makePhone, deletPhoneData, deletePhoneData } = require('./phoneStore');
const { connectPhone, disconnectPhone, destroyAllSessions } = require('./connectionManager');
const { loadContactsForPhone } = require('./contactManager');
const { EVENTS } = require('../socket/events');

/** @type {Object.<string, import('../types').Session>} */
const sessions = {};

// ── Sessões ────────────────────────────────────────────────────────────

/**
 * Retorna ou cria uma sessão, carregando telefones salvos do disco.
 * @param {string} id
 * @returns {import('../types').Session}
 */
function getSession(id) {
  if (!sessions[id]) {
    sessions[id] = {
      id,
      phones: {},
      isSending: false,
      stopRequested: false,
      lastActivityAt: Date.now(),
    };
    loadPhones(sessions[id]);
  }
  return sessions[id];
}

/** @param {string} id */
function touchSession(id) {
  if (sessions[id]) sessions[id].lastActivityAt = Date.now();
}

// ── Emit helpers ────────────────────────────────────────────────────────

/**
 * @param {string} sessionId
 * @param {import('socket.io').Server} io
 * @param {string} event
 * @param {*} data
 */
function emit(sessionId, io, event, data) {
  io.to(`s:${sessionId}`).emit(event, data);
}

/**
 * @param {import('../types').Session} sess
 * @returns {import('../types').PhoneListItem[]}
 */
function phonesListPayload(sess) {
  return Object.values(sess.phones).map(p => ({
    id: p.id,
    name: p.name,
    status: p.status,
    contactCount: p.contacts.length,
  }));
}

/**
 * @param {string} sessionId
 * @param {import('socket.io').Server} io
 */
function emitPhonesList(sessionId, io) {
  const sess = getSession(sessionId);
  emit(sessionId, io, EVENTS.PHONES_LIST, { phones: phonesListPayload(sess) });
}

// Contador para garantir unicidade de IDs mesmo em chamadas no mesmo milissegundo
let _phoneIdCounter = 0;

// ── CRUD de telefones ───────────────────────────────────────────────────

/**
 * @param {string} sessionId
 * @param {string} name
 * @returns {string|null} phoneId ou null se limite atingido
 */
function addPhone(sessionId, name) {
  const sess = getSession(sessionId);
  if (Object.keys(sess.phones).length >= config.MAX_PHONES_PER_SESSION) return null;
  const id = `ph_${Date.now()}_${++_phoneIdCounter}`;
  sess.phones[id] = makePhone(id, name);
  savePhones(sessionId, sess);
  return id;
}

/**
 * @param {string} sessionId
 * @param {string} phoneId
 * @param {string} name
 */
function renamePhone(sessionId, phoneId, name) {
  const sess = sessions[sessionId];
  if (!sess) return false;
  const phone = sess.phones[phoneId];
  if (!phone) return false;
  phone.name = name;
  savePhones(sessionId, sess);
  return true;
}

/**
 * Remove um telefone: faz logout, destroy e apaga dados LocalAuth.
 * Use somente quando o usuário remove o telefone explicitamente.
 *
 * @param {string} sessionId
 * @param {string} phoneId
 */
function removePhone(sessionId, phoneId) {
  const sess = sessions[sessionId];
  if (!sess) return;
  const phone = sess.phones[phoneId];
  if (!phone) return;
  clearTimeout(phone.watchdog);
  if (phone.client) {
    phone.client.logout().catch(() => {});
    phone.client.destroy().catch(() => {});
    phone.client = null;
  }
  delete sess.phones[phoneId];
  savePhones(sessionId, sess);
  deletePhoneData(sessionId, phoneId);
}

// ── Wrappers de conexão (compatibilidade de assinatura com routes) ──────

/**
 * Conecta um telefone. Wrapper que resolve a sessão antes de delegar.
 * @param {string} sessionId
 * @param {string} phoneId
 * @param {import('socket.io').Server} io
 */
async function connectPhoneById(sessionId, phoneId, io) {
  const sess = getSession(sessionId);
  return connectPhone(sess, phoneId, io);
}

/**
 * Desconecta um telefone e emite status para o room.
 * @param {string} sessionId
 * @param {string} phoneId
 */
async function disconnectPhoneById(sessionId, phoneId) {
  const sess = sessions[sessionId];
  if (!sess) return;
  const phone = sess.phones[phoneId];
  if (!phone) return;
  await disconnectPhone(phone);
}

/**
 * Recarrega contatos de um telefone.
 * @param {string} sessionId
 * @param {string} phoneId
 * @param {import('socket.io').Server} io
 */
async function loadContactsById(sessionId, phoneId, io) {
  const sess = sessions[sessionId];
  if (!sess) return;
  return loadContactsForPhone(sess, phoneId, io);
}

/**
 * Encerra todos os clientes sem logout — mantém LocalAuth em disco.
 * Chamado no fechamento do app. NUNCA usar logout() aqui.
 */
async function destroyAll() {
  return destroyAllSessions(sessions);
}

/** Remove sessões inativas do mapa em memória */
function cleanStaleSessions() {
  const ttlCutoff = Date.now() - config.SESSION_TTL_MS;
  for (const [id, sess] of Object.entries(sessions)) {
    const allDisconnected = Object.values(sess.phones).every(p => p.status === 'disconnected' && !p.client);
    const isStale = sess.lastActivityAt < ttlCutoff;
    if (allDisconnected && isStale && !sess.isSending) {
      delete sessions[id];
      logger.info(`[${id}] Sessão desconectada removida da memória (TTL)`);
    }
  }
}

module.exports = {
  sessions,
  getSession,
  touchSession,
  addPhone,
  renamePhone,
  removePhone,
  connectPhone: connectPhoneById,
  disconnectPhone: disconnectPhoneById,
  loadContactsForPhone: loadContactsById,
  destroyAllSessions: destroyAll,
  cleanStaleSessions,
  emit,
  phonesListPayload,
  emitPhonesList,
  MAX_PHONES_PER_SESSION: config.MAX_PHONES_PER_SESSION,
};
