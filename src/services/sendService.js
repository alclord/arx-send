const path = require('path');
const fs = require('fs');
const { MessageMedia } = require('whatsapp-web.js');
const config = require('../app/config');
const { getSession, touchSession, emit } = require('./sessionService');
const { personalizeMessage, removeNinthDigit, sleep } = require('../utils/helpers');
const { logSend, logSendStart, logSendDone } = require('./auditService');
const { EVENTS } = require('../socket/events');

function isLidError(err) {
  const msg = err?.message || '';
  // Usa \bLID\b para evitar falso positivo com 'invalid' (que contém a substring 'lid')
  return /\bLID\b/i.test(msg) || msg.includes('invalid wid');
}

function isTransientError(err) {
  const msg = err?.message || '';
  return (
    msg.includes('timeout') ||
    msg.includes('Timeout') ||
    msg.includes('ECONNRESET') ||
    msg.includes('ENOTFOUND') ||
    msg.includes('navigation') ||
    msg.includes('Protocol error') ||
    msg.includes('Target closed') ||
    msg.includes('Session closed')
  );
}

async function trySendWithRetry(sendFn, maxRetries, baseDelayMs) {
  let lastErr;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await sendFn();
      return { ok: true };
    } catch (err) {
      lastErr = err;
      if (!isTransientError(err)) return { ok: false, err };
      if (attempt < maxRetries) {
        const wait = baseDelayMs * Math.pow(2, attempt - 1);
        await sleep(wait);
      }
    }
  }
  return { ok: false, err: lastErr };
}

async function sendMessages(sessionId, io, { contactIds, message, filename, delayMs, contactsData, phoneId }) {
  const sess = getSession(sessionId);
  const phone = sess.phones[phoneId];

  sess.isSending = true;
  sess.stopRequested = false;
  touchSession(sessionId);

  const total = contactIds.length;
  const delay = Math.max(delayMs || config.DEFAULT_SEND_DELAY_MS, config.MIN_SEND_DELAY_MS);
  let sentCount = 0;
  let failedCount = 0;

  logSendStart(sessionId, phoneId, total);
  emit(sessionId, io, EVENTS.SEND_START, { total });

  try {
    let media = null;
    if (filename) {
      const safeFilename = path.basename(filename);
      const filePath = path.join(config.uploadsDir, safeFilename);
      if (fs.existsSync(filePath)) media = MessageMedia.fromFilePath(filePath);
    }

    for (let i = 0; i < contactIds.length; i++) {
      if (sess.stopRequested) {
        emit(sessionId, io, EVENTS.SEND_STOPPED, { index: i, total });
        break;
      }

      const contact = phone.contacts.find(c => c.id === contactIds[i]);
      const name = contact?.name || contactIds[i];

      emit(sessionId, io, EVENTS.SEND_PROGRESS, { index: i, total, name, status: 'sending' });

      const rowData = contactsData?.[contactIds[i]] || {};
      const finalMsg = personalizeMessage(message?.trim() || '', rowData);

      const makeSendFn = (id) => () => {
        if (media && finalMsg) return phone.client.sendMessage(id, media, { caption: finalMsg });
        if (media) return phone.client.sendMessage(id, media);
        return phone.client.sendMessage(id, finalMsg);
      };

      let sent = false;

      const result = await trySendWithRetry(
        makeSendFn(contactIds[i]),
        config.SEND_MAX_RETRIES,
        config.SEND_RETRY_BASE_MS
      );

      if (result.ok) {
        sent = true;
      } else if (isLidError(result.err)) {
        const altId = removeNinthDigit(contactIds[i]);
        if (altId) {
          const retryResult = await trySendWithRetry(
            makeSendFn(altId),
            config.SEND_MAX_RETRIES,
            config.SEND_RETRY_BASE_MS
          );
          if (retryResult.ok) {
            sent = true;
          } else {
            console.error(`[${sessionId}] Erro ao enviar para ${name} (alt):`, retryResult.err.message);
            emit(sessionId, io, EVENTS.SEND_PROGRESS, { index: i, total, name, status: 'error', error: retryResult.err.message });
            logSend(sessionId, contactIds[i], 'failed', retryResult.err.message);
            failedCount++;
          }
        } else {
          console.error(`[${sessionId}] Erro LID sem alt para ${name}:`, result.err.message);
          emit(sessionId, io, EVENTS.SEND_PROGRESS, { index: i, total, name, status: 'error', error: result.err.message });
          logSend(sessionId, contactIds[i], 'failed', result.err.message);
          failedCount++;
        }
      } else {
        console.error(`[${sessionId}] Erro ao enviar para ${name}:`, result.err.message);
        emit(sessionId, io, EVENTS.SEND_PROGRESS, { index: i, total, name, status: 'error', error: result.err.message });
        logSend(sessionId, contactIds[i], 'failed', result.err.message);
        failedCount++;
      }

      if (sent) {
        emit(sessionId, io, EVENTS.SEND_PROGRESS, { index: i, total, name, status: 'done' });
        logSend(sessionId, contactIds[i], 'sent');
        sentCount++;
      }

      if (i < contactIds.length - 1 && !sess.stopRequested) await sleep(delay);
    }

    const stopped = sess.stopRequested;
    emit(sessionId, io, EVENTS.SEND_DONE, { total });
    logSendDone(sessionId, phoneId, { sent: sentCount, failed: failedCount, stopped });
  } finally {
    sess.isSending = false;
    touchSession(sessionId);

    if (filename) {
      const safeFilename = path.basename(filename);
      const filePath = path.join(config.uploadsDir, safeFilename);
      fs.unlink(filePath, err => {
        if (err && err.code !== 'ENOENT') {
          console.warn(`[${sessionId}] Não foi possível remover arquivo após envio: ${err.message}`);
        }
      });
    }
  }
}

module.exports = { sendMessages, trySendWithRetry };
