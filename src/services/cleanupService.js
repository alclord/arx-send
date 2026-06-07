const fs = require('fs');
const path = require('path');
const config = require('../app/config');
const { cleanStaleSessions } = require('./sessionService');

async function cleanOrphanedUploads() {
  const cutoff = Date.now() - config.ORPHAN_FILE_AGE_MS;
  try {
    const files = await fs.promises.readdir(config.uploadsDir);
    await Promise.all(files.map(async (f) => {
      try {
        const fp = path.join(config.uploadsDir, f);
        const stat = await fs.promises.stat(fp);
        if (stat.mtimeMs < cutoff) await fs.promises.unlink(fp);
      } catch (err) {
        console.warn(`[cleanup] Erro ao remover arquivo ${f}:`, err.message);
      }
    }));
  } catch (err) {
    console.warn('[cleanup] Erro ao listar uploads:', err.message);
  }
}

function startCleanupIntervals() {
  cleanOrphanedUploads();
  setInterval(cleanOrphanedUploads, config.CLEANUP_INTERVAL_MS);
  setInterval(cleanStaleSessions, config.CLEANUP_INTERVAL_MS);
}

module.exports = { cleanOrphanedUploads, startCleanupIntervals };
