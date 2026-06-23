const fs = require('fs');
const path = require('path');
const config = require('../app/config');
const logger = require('../utils/logger');
const { cleanStaleSessions } = require('./sessionService');

const auditFile = path.join(config.appDataBase, 'audit.jsonl');

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

async function purgeAuditLog() {
  const cutoff = new Date(Date.now() - config.AUDIT_RETENTION_MS).toISOString();
  try {
    const content = await fs.promises.readFile(auditFile, 'utf8');
    const lines = content.split('\n').filter(Boolean);
    const kept = lines.filter(line => {
      try {
        return JSON.parse(line).t >= cutoff;
      } catch {
        return false;
      }
    });
    if (kept.length === lines.length) return;
    const removed = lines.length - kept.length;
    await fs.promises.writeFile(auditFile, kept.join('\n') + (kept.length ? '\n' : ''), 'utf8');
    logger.info(`[audit] Purge: ${removed} entradas removidas (retenção: ${config.AUDIT_RETENTION_DAYS}d)`);
  } catch (err) {
    if (err.code !== 'ENOENT') logger.warn('[audit] Erro ao purgar audit.jsonl:', err.message);
  }
}

function startCleanupIntervals() {
  cleanOrphanedUploads();
  purgeAuditLog();
  intervals.push(setInterval(cleanOrphanedUploads, config.CLEANUP_INTERVAL_MS));
  intervals.push(setInterval(cleanStaleSessions, config.CLEANUP_INTERVAL_MS));
  intervals.push(setInterval(purgeAuditLog, config.CLEANUP_INTERVAL_MS));
}

function stopCleanupIntervals() {
  intervals.forEach(id => clearInterval(id));
  intervals.length = 0;
}

module.exports = { cleanOrphanedUploads, startCleanupIntervals, stopCleanupIntervals };
