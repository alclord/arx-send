const config = require('./app/config');
const { createApp, startApp } = require('./app');
const { createHTTPServer } = require('./app/http');
const { checkForUpdates } = require('./services/updateService');

process.on('uncaughtException', (err) => console.error('Erro não tratado:', err));
process.on('unhandledRejection', (reason) => console.error('Promise rejeitada sem tratamento:', reason));

const app = createApp();
const { server, io } = createHTTPServer(app);
startApp(app, io);

server.listen(config.PORT, () => {
  console.log(`\n🚀 ARX Send v${config.CURRENT_VERSION} rodando em http://localhost:${config.PORT}\n`);

  if (config.IS_PKG && !process.versions.electron) {
    const safePort = parseInt(config.PORT, 10);
    if (safePort > 0 && safePort < 65536) {
      const { exec } = require('child_process');
      setTimeout(() => exec(`start http://localhost:${safePort}`), 1500);
    }
  }
});

if (config.UPDATES_ENABLED) {
  setTimeout(() => checkForUpdates(io), config.UPDATE_CHECK_INITIAL_MS);
  setInterval(() => checkForUpdates(io), config.UPDATE_CHECK_INTERVAL_MS);
}
