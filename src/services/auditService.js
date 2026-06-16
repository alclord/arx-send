const fs = require('fs');
const path = require('path');
const config = require('../app/config');

const auditFile = path.join(config.appDataBase, 'audit.jsonl');

function logSend(sessionId, recipient, status, error = null) {
  const line = JSON.stringify({
    t: new Date().toISOString(),
    session: sessionId,
    to: recipient,
    status,
    ...(error && { error }),
  }) + '\n';

  fs.appendFile(auditFile, line, err => {
    if (err) console.warn('[audit] Write failed:', err.message);
  });
}

module.exports = { logSend };
