const path = require('path');
const fs = require('fs');
const { MessageMedia } = require('whatsapp-web.js');
const config = require('../app/config');
const { getSession, emit } = require('./sessionService');
const { personalizeMessage, removeNinthDigit, sleep } = require('../utils/helpers');

async function sendMessages(sessionId, io, { contactIds, message, filename, delayMs, contactsData }) {
  const sess = getSession(sessionId);

  sess.isSending = true;
  sess.stopRequested = false;

  const total = contactIds.length;
  const delay = Math.max(delayMs || config.DEFAULT_SEND_DELAY_MS, config.MIN_SEND_DELAY_MS);

  emit(sessionId, io, 'send_start', { total });

  try {
    let media = null;
    if (filename) {
      const safeFilename = path.basename(filename);
      const filePath = path.join(config.uploadsDir, safeFilename);
      if (fs.existsSync(filePath)) media = MessageMedia.fromFilePath(filePath);
    }

    for (let i = 0; i < contactIds.length; i++) {
      if (sess.stopRequested) {
        emit(sessionId, io, 'send_stopped', { index: i, total });
        break;
      }

      const contact = sess.contacts.find(c => c.id === contactIds[i]);
      const name = contact?.name || contactIds[i];

      emit(sessionId, io, 'send_progress', { index: i, total, name, status: 'sending' });

      const rowData = contactsData?.[contactIds[i]] || {};
      const finalMsg = personalizeMessage(message?.trim() || '', rowData);

      const sendTo = async (id) => {
        if (media && finalMsg) {
          await sess.client.sendMessage(id, media, { caption: finalMsg });
        } else if (media) {
          await sess.client.sendMessage(id, media);
        } else {
          await sess.client.sendMessage(id, finalMsg);
        }
      };

      let sent = false;
      try {
        await sendTo(contactIds[i]);
        sent = true;
      } catch (err) {
        const isLidError = err.message.includes('LID') || err.message.includes('lid');
        const altId = isLidError ? removeNinthDigit(contactIds[i]) : null;
        if (altId) {
          try {
            await sendTo(altId);
            sent = true;
          } catch (err2) {
            console.error(`[${sessionId}] Erro ao enviar para ${name}:`, err2.message);
            emit(sessionId, io, 'send_progress', { index: i, total, name, status: 'error', error: err2.message });
          }
        } else {
          console.error(`[${sessionId}] Erro ao enviar para ${name}:`, err.message);
          emit(sessionId, io, 'send_progress', { index: i, total, name, status: 'error', error: err.message });
        }
      }
      if (sent) emit(sessionId, io, 'send_progress', { index: i, total, name, status: 'done' });

      if (i < contactIds.length - 1 && !sess.stopRequested) await sleep(delay);
    }

    emit(sessionId, io, 'send_done', { total });
  } finally {
    sess.isSending = false;
  }
}

module.exports = { sendMessages };
