const { spawn } = require('child_process');
const fs = require('fs');
const config = require('../app/config');
const { updateState, emitUpdateStatus, downloadUpdate } = require('../services/updateService');
const { sessions } = require('../services/sessionService');

function registerUpdateRoutes(app, io) {
  app.get('/api/update/status', (req, res) => {
    res.json({
      currentVersion: config.CURRENT_VERSION,
      status: updateState.status,
      version: updateState.version,
      progress: updateState.progress,
    });
  });

  app.post('/api/update/install', async (req, res) => {
    if (updateState.status !== 'ready' || !updateState.filePath) {
      return res.status(400).json({ error: 'Nenhuma atualiza\u00e7\u00e3o pronta para instalar' });
    }

    try {
      await fs.promises.access(updateState.filePath);
    } catch {
      updateState.status = 'available';
      updateState.filePath = null;
      emitUpdateStatus(io);
      downloadUpdate(io).catch(err => console.warn('[update] Erro ao rebaixar:', err.message));
      return res.status(400).json({ error: 'Arquivo perdido, rebaixando. Tente novamente em instantes.' });
    }

    const sending = Object.values(sessions).some(s => s.isSending);
    if (sending) {
      return res.status(400).json({ error: 'Aguarde o disparo em andamento terminar antes de atualizar.' });
    }

    res.json({ ok: true });

    setTimeout(() => {
      try {
        spawn(updateState.filePath, ['/VERYSILENT', '/CLOSEAPPLICATIONS'], {
          detached: true,
          stdio: 'ignore',
        }).unref();
      } catch (err) {
        console.error('[update] Falha ao iniciar installer:', err.message);
      }
      process.exit(0);
    }, 800);
  });
}

module.exports = { registerUpdateRoutes };
