const express = require('express');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const { securityHeaders, createRateLimiter, authMiddleware } = require('./security');
const { registerSessionRoutes } = require('../routes/sessionRoutes');
const { registerSendRoutes } = require('../routes/sendRoutes');
const { registerSheetRoutes } = require('../routes/sheetRoutes');
const { registerUpdateRoutes } = require('../routes/updateRoutes');
const { registerUploadRoutes } = require('../routes/uploadRoutes');
const { registerLogRoutes } = require('../routes/logRoutes');
const { registerSocketHandlers } = require('../socket/handlers');
const { multerErrorHandler } = require('../services/mediaService');
const { startCleanupIntervals, stopCleanupIntervals } = require('../services/cleanupService');

function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.use(express.json({ limit: '2mb' }));
  app.use(securityHeaders);
  app.use(express.static(path.join(__dirname, '../../public')));

  const apiLimiter = createRateLimiter(60000, 60);
  app.use('/api/', apiLimiter);
  app.use('/api/', authMiddleware);

  return app;
}

function registerAllRoutes(app, io) {
  registerUploadRoutes(app);
  registerLogRoutes(app);
  registerSessionRoutes(app, io);
  registerSendRoutes(app, io);
  registerSheetRoutes(app);
  registerUpdateRoutes(app, io);
  app.use(multerErrorHandler);
}

function ensureDirectories() {
  [config.uploadsDir, config.cacheDir, config.logsDir, config.sessionDir].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });
}

function startApp(app, io) {
  ensureDirectories();
  registerAllRoutes(app, io);
  registerSocketHandlers(io);
  startCleanupIntervals();
  return app;
}

module.exports = { createApp, registerAllRoutes, ensureDirectories, startApp, stopCleanupIntervals };
