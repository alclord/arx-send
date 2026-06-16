const path = require('path');
const multer = require('multer');
const config = require('../app/config');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, config.uploadsDir),
  filename: (req, file, cb) => cb(null, Date.now() + '_' + path.basename(file.originalname))
});

function getWaLimit(mimetype) {
  if (mimetype.startsWith('image/')) return config.WA_FILE_LIMITS.image;
  if (mimetype.startsWith('video/')) return config.WA_FILE_LIMITS.video;
  if (mimetype.startsWith('audio/')) return config.WA_FILE_LIMITS.audio;
  return config.WA_FILE_LIMITS.document;
}

function formatMB(bytes) {
  return (bytes / 1024 / 1024).toFixed(0) + ' MB';
}

const upload = multer({
  storage,
  limits: { fileSize: config.MAX_FILE_SIZE_BYTES },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!config.ALLOWED_UPLOAD_EXTS.has(ext)) {
      return cb(new Error(`Tipo de arquivo não permitido: ${ext}`));
    }
    cb(null, true);
  }
});

function validateWaLimits(req, res, next) {
  const file = req.file;
  if (!file) return next();

  const limit = getWaLimit(file.mimetype);
  if (file.size > limit) {
    const fs = require('fs');
    fs.unlink(file.path, () => {});
    return res.status(400).json({
      error: `Arquivo muito grande para o WhatsApp. Limite para este tipo: ${formatMB(limit)}. Seu arquivo: ${formatMB(file.size)}.`
    });
  }
  next();
}

function multerErrorHandler(err, req, res, next) {
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: `Arquivo muito grande (máx. ${formatMB(config.MAX_FILE_SIZE_BYTES)})` });
  }
  if (err instanceof multer.MulterError || err?.message?.startsWith('Tipo de arquivo')) {
    return res.status(400).json({ error: err.message });
  }
  next(err);
}

module.exports = { upload, validateWaLimits, multerErrorHandler };
