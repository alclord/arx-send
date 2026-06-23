
/**
 * @fileoverview auditService — audit trail de operações do ARX Send.
 *
 * Registra eventos críticos em JSONL (uma linha JSON por evento).
 * Arquivo: %APPDATA%\arx-send\audit.jsonl
 *
 * Eventos registrados:
 *   - send:sent      — mensagem enviada com sucesso
 *   - send:failed    — falha no envio
 *   - phone:connect  — telefone conectado ao WhatsApp
 *   - phone:disconnect — telefone desconectado
 *   - send:start     — disparo iniciado
 *   - send:done      — disparo concluído
 *   - send:stopped   — disparo parado pelo usuário
 */

const fs = require('fs');
const path = require('path');
const config = require('../app/config');

const auditFile = path.join(config.appDataBase, 'audit.jsonl');

/**
 * Escreve uma linha de audit no arquivo JSONL.
 * @param {string} event  - Nome do evento (ex: 'send:sent')
 * @param {Object} data   - Payload do evento
 */
function logAudit(event, data) {
  const line =
    JSON.stringify({
      t: new Date().toISOString(),
      event,
      ...data,
    }) + '\n';

  fs.appendFile(auditFile, line, err => {
    if (err) console.warn('[audit] Write failed:', err.message);
  });
}

/**
 * Registra resultado de envio de uma mensagem.
 * @param {string} sessionId
 * @param {string} phoneId
 * @param {string} recipient  - WhatsApp ID do destinatário
 * @param {'sent'|'failed'} status
 * @param {string} [error]
 */
function logSend(sessionId, recipient, status, error = null) {
  logAudit(`send:${status}`, {
    session: sessionId,
    to: recipient,
    ...(error && { error }),
  });
}

/**
 * Registra início de um disparo em massa.
 * @param {string} sessionId
 * @param {string} phoneId
 * @param {number} total - Total de contatos
 */
function logSendStart(sessionId, phoneId, total) {
  logAudit('send:start', { session: sessionId, phone: phoneId, total });
}

/**
 * Registra conclusão de um disparo.
 * @param {string} sessionId
 * @param {string} phoneId
 * @param {{ sent: number, failed: number, stopped: boolean }} summary
 */
function logSendDone(sessionId, phoneId, summary) {
  logAudit('send:done', { session: sessionId, phone: phoneId, ...summary });
}

/**
 * Registra conexão de um telefone.
 * @param {string} sessionId
 * @param {string} phoneId
 * @param {string} phoneName
 */
function logPhoneConnect(sessionId, phoneId, phoneName) {
  logAudit('phone:connect', { session: sessionId, phone: phoneId, name: phoneName });
}

/**
 * Registra desconexão de um telefone.
 * @param {string} sessionId
 * @param {string} phoneId
 * @param {string} [reason]
 */
function logPhoneDisconnect(sessionId, phoneId, reason) {
  logAudit('phone:disconnect', { session: sessionId, phone: phoneId, ...(reason && { reason }) });
}

module.exports = {
  logSend,
  logSendStart,
  logSendDone,
  logPhoneConnect,
  logPhoneDisconnect,
};
