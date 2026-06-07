const path = require('path');
const fs = require('fs');
const config = require('../app/config');
const { upload } = require('../services/mediaService');

function registerUploadRoutes(app) {
  app.post('/api/:sessionId/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    res.json({
      ok: true,
      filename: req.file.filename,
      original: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype,
      path: `/uploads/${req.file.filename}`,
    });
  });

  app.get('/uploads/:file', async (req, res) => {
    const filename = path.basename(req.params.file);
    const filePath = path.join(config.uploadsDir, filename);
    try {
      await fs.promises.access(filePath);
    } catch {
      return res.status(404).end();
    }
    res.sendFile(filename, { root: config.uploadsDir }, (err) => {
      if (err && !res.headersSent) res.status(500).end();
    });
  });
}

module.exports = { registerUploadRoutes };
