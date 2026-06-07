const SESSION_ID_MAX_LENGTH = 30;

function sanitizeSessionId(raw) {
  return String(raw || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, SESSION_ID_MAX_LENGTH);
}

function normalizePhone(raw) {
  let digits = String(raw).replace(/\D/g, '').replace(/^0+/, '');
  if (!digits) return null;
  if (!digits.startsWith('55')) digits = '55' + digits;
  if (digits.length < 12 || digits.length > 13) return null;
  return digits + '@c.us';
}

function removeNinthDigit(id) {
  const m = id.match(/^55(\d{2})9(\d{8})@c\.us$/);
  return m ? `55${m[1]}${m[2]}@c.us` : null;
}

function personalizeMessage(template, rowData) {
  if (!template) return '';
  return template.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
    const k = key.trim();
    return rowData[k] !== undefined ? rowData[k] : `{{${k}}}`;
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = {
  sanitizeSessionId,
  normalizePhone,
  removeNinthDigit,
  personalizeMessage,
  sleep,
};
