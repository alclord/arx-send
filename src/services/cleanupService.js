const fs = require('fs');
const path = require('path');
const config = require('../app/config');
const { cleanStaleSessions } = require('./sessionService');

const intervals = [];

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
  intervals.push(setInterval(cleanOrphanedUploads, config.CLEANUP_INTERVAL_MS));
  intervals.push(setInterval(cleanStaleSessions, config.CLEANUP_INTERVAL_MS));
}

function stopCleanupIntervals() {
  intervals.forEach(id => clearInterval(id));
  intervals.length = 0;
}

module.exports = { cleanOrphanedUploads, startCleanupIntervals, stopCleanupIntervals };
