const logger = require('../utils/logger');

function registerLogRoutes(app) {
  app.get('/api/logs', (req, res) => {
    res.json({ lines: logger.getLines(), file: logger.getFilePath() });
  });
}

module.exports = { registerLogRoutes };
