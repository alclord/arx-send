const config = require('./app/config');
const { createApp, startApp, stopCleanupIntervals } = require('./app');
const { createHTTPServer } = require('./app/http');
const { checkForUpdates } = require('./services/updateService');
const { destroyAllSessions } = require('./services/sessionService');

process.on('uncaughtException', (err) => console.error('Erro não tratado:', err));
process.on('unhandledRejection', (reason) => console.error('Promise rejeitada sem tratamento:', reason));

const app = createApp();
const { server, io } = createHTTPServer(app);
startApp(app, io);

let isShuttingDown = false;
async function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n[${signal}] Encerrando gracefulmente...`);
  stopCleanupIntervals();
  await destroyAllSessions();
  server.close(() => {
    console.log('Servidor fechado.');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

server.listen(config.PORT, () => {
  console.log(`\n🚀 ARX Send v${config.CURRENT_VERSION} rodando em http://localhost:${config.PORT}\n`);

  if (config.IS_PKG && !process.versions.electron) {
    const safePort = parseInt(config.PORT, 10);
    if (safePort > 0 && safePort < 65536) {
      const { execFile } = require('child_process');
      setTimeout(() => execFile('cmd', ['/c', 'start', `http://localhost:${safePort}`]), 1500);
    }
  }
});

if (config.UPDATES_ENABLED) {
  setTimeout(() => checkForUpdates(io), config.UPDATE_CHECK_INITIAL_MS);
  setInterval(() => checkForUpdates(io), config.UPDATE_CHECK_INTERVAL_MS);
}
