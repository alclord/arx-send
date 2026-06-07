const path = require('path');
const multer = require('multer');
const config = require('../app/config');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, config.uploadsDir),
  filename: (req, file, cb) => cb(null, Date.now() + '_' + path.basename(file.originalname))
});

const upload = multer({
  storage,
  limits: { fileSize: config.MAX_FILE_SIZE_BYTES },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (config.ALLOWED_UPLOAD_EXTS.has(ext)) return cb(null, true);
    cb(new Error(`Tipo de arquivo n\u00e3o permitido: ${ext}`));
  }
});

function multerErrorHandler(err, req, res, next) {
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'Arquivo muito grande (m\u00e1x. 64 MB)' });
  }
  if (err instanceof multer.MulterError || err?.message?.startsWith('Tipo de arquivo')) {
    return res.status(400).json({ error: err.message });
  }
  next(err);
}

module.exports = { upload, multerErrorHandler };
