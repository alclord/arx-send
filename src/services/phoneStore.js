
/**
 * @fileoverview phoneStore — CRUD de telefones em disco.
 *
 * Responsabilidade única: persistir e recuperar a lista de telefones de uma sessão.
 * Não conhece clientes WhatsApp, conexões ou contatos.
 */

const path = require('path');
const fs = require('fs');
const config = require('../app/config');
const logger = require('../utils/logger');

/** @param {string} sessionId */
function phonesFilePath(sessionId) {
  return path.join(config.cacheDir, `${sessionId}_phones.json`);
}

/**
 * Carrega telefones salvos em disco para o objeto de sessão.
 * @param {import('../types').Session} sess
 */
function loadPhones(sess) {
  const file = phonesFilePath(sess.id);
  try {
    if (fs.existsSync(file)) {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const p of saved) {
        sess.phones[p.id] = makePhone(p.id, p.name);
      }
    }
  } catch (err) {
    logger.warn(`[${sess.id}] Falha ao carregar telefones:`, err.message);
  }
}

/**
 * Persiste a lista atual de telefones da sessão em disco.
 * @param {string} sessionId
 * @param {import('../types').Session} sess
 */
function savePhones(sessionId, sess) {
  if (!sess) return;
  const data = Object.values(sess.phones).map(p => ({ id: p.id, name: p.name }));
  try {
    fs.writeFileSync(phonesFilePath(sessionId), JSON.stringify(data));
  } catch (err) {
    logger.warn(`[${sessionId}] Falha ao salvar telefones:`, err.message);
  }
}

/**
 * Cria o objeto de telefone com estado inicial.
 * @param {string} id
 * @param {string} name
 * @returns {import('../types').Phone}
 */
function makePhone(id, name) {
  return {
    id,
    name,
    client: null,
    status: 'disconnected',
    contacts: loadCachedContacts(id),
    watchdog: null,
    watchdogCount: 0,
    heartbeat: null,
    lastActivityAt: Date.now(),
  };
}

/** @param {string} phoneId */
function contactsCachePath(phoneId) {
  return path.join(config.cacheDir, `phone_${phoneId}.json`);
}

/** @param {string} phoneId */
function loadCachedContacts(phoneId) {
  const file = contactsCachePath(phoneId);
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    logger.warn(`[phone:${phoneId}] Falha ao carregar cache de contatos:`, err.message);
  }
  return [];
}

/**
 * Persiste contatos de um telefone em disco.
 * @param {string} phoneId
 * @param {import('../types').Contact[]} contacts
 */
async function saveCachedContacts(phoneId, contacts) {
  try {
    await fs.promises.writeFile(contactsCachePath(phoneId), JSON.stringify(contacts));
  } catch (err) {
    logger.warn(`[phone:${phoneId}] Falha ao salvar cache de contatos:`, err.message);
  }
}

/**
 * Remove todos os arquivos de um telefone: cache de contatos e pasta LocalAuth.
 * Chamado apenas quando o usuário remove o telefone explicitamente.
 * @param {string} sessionId
 * @param {string} phoneId
 */
function deletePhoneData(sessionId, phoneId) {
  try { fs.unlinkSync(contactsCachePath(phoneId)); } catch {}
  const authDir = path.join(config.sessionDir, sessionId, phoneId);
  fs.rm(authDir, { recursive: true, force: true }, () => {});
}

module.exports = { loadPhones, savePhones, makePhone, loadCachedContacts, saveCachedContacts, deletePhoneData };
