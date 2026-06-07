const path = require('path');
const fs = require('fs');
const config = require('../app/config');

function registerUploadRoutes(app) {
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
