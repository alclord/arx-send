const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const config = require('../app/config');
const { normalizePhone } = require('../utils/helpers');
const { sessionMiddleware } = require('./sessionRoutes');
const { upload } = require('../services/mediaService');

function registerSheetRoutes(app) {
  app.post('/api/:sessionId/parse-sheet', sessionMiddleware, upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    try {
      const wb = XLSX.readFile(req.file.path, { sheetRows: config.MAX_SHEET_ROWS });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
      if (!rows.length) {
        fs.promises.unlink(req.file.path).catch(err => console.warn('[parse-sheet] Falha ao remover arquivo vazio:', err.message));
        return res.status(400).json({ error: 'Planilha vazia' });
      }
      const headers = rows[0].map(String);
      const preview = rows.slice(1, 4).map(r => headers.map((_, i) => String(r[i] ?? '')));
      res.json({ ok: true, headers, preview, filename: req.file.filename });
    } catch (e) {
      fs.promises.unlink(req.file.path).catch(err => console.warn('[parse-sheet] Falha ao remover arquivo com erro:', err.message));
      res.status(400).json({ error: 'Erro ao ler planilha: ' + e.message });
    }
  });

  app.post('/api/:sessionId/extract-phones', sessionMiddleware, async (req, res) => {
    const { filename, column, nameColumn } = req.body;
    if (!filename) return res.status(400).json({ error: 'Arquivo n\u00e3o informado' });
    const filePath = path.join(config.uploadsDir, path.basename(filename));
    try {
      await fs.promises.access(filePath);
    } catch {
      return res.status(400).json({ error: 'Arquivo n\u00e3o encontrado' });
    }
    try {
      const wb = XLSX.readFile(filePath, { sheetRows: config.MAX_SHEET_ROWS });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
      const headers = rows[0].map(String);
      const colIdx = parseInt(column);
      const nameIdx = nameColumn !== undefined && nameColumn !== '' ? parseInt(nameColumn) : -1;
      const contacts = [];
      for (let i = 1; i < rows.length; i++) {
        const phone = normalizePhone(rows[i][colIdx]);
        if (!phone) continue;
        const name = nameIdx >= 0 ? String(rows[i][nameIdx] || phone) : phone;
        const rowData = {};
        headers.forEach((h, idx) => { rowData[h] = String(rows[i][idx] ?? ''); });
        contacts.push({ id: phone, name, isGroup: false, imported: true, rowData });
      }
      fs.promises.unlink(filePath).catch(err => console.warn('[extract-phones] Falha ao remover arquivo:', err.message));
      res.json({ ok: true, contacts, headers });
    } catch (e) {
      res.status(400).json({ error: 'Erro ao processar planilha: ' + e.message });
    }
  });
}

module.exports = { registerSheetRoutes };
