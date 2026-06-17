/**
 * server/routes/xfdf.js — API REST para archivos XFDF (anotaciones portables)
 *
 * Montar en server.js:
 *   const xfdfRouter = require('./server/routes/xfdf');
 *   app.use('/api/xfdf', xfdfRouter);
 *
 * Endpoints:
 *   GET    /api/xfdf/:docId         → devuelve el XFDF (XML) del documento
 *   PUT    /api/xfdf/:docId         → guarda/sobreescribe el XFDF
 *   DELETE /api/xfdf/:docId         → elimina el XFDF
 *   GET    /api/xfdf/:docId/meta    → devuelve metadata (fecha, usuario) sin el CLOB
 */

const express    = require('express');
const router     = express.Router();
const xfdfStore  = require('../xfdf-store');   // almacén disco + Oracle

// ── Middleware: validar docId ─────────────────────────────────────
router.param('docId', (req, res, next, val) => {
  const id = parseInt(val, 10);
  if (!id || id <= 0) {
    return res.status(400).json({ error: 'docId debe ser un número entero positivo' });
  }
  req.docId = id;
  next();
});


// ── GET /api/xfdf/:docId ─────────────────────────────────────────
// Carga el XFDF de un documento.
// Responde con XML (Content-Type: application/xml).
// Si no existe devuelve 404 con JSON de error.
router.get('/:docId', async (req, res) => {
  try {
    const xfdf = await xfdfStore.load(req.docId);
    res.set('Content-Type', 'application/xml; charset=utf-8');
    res.set('Content-Disposition',
            `inline; filename="plano-${req.docId}.xfdf"`);
    res.send(xfdf);

  } catch (e) {
    // fs.readFile lanza ENOENT cuando no existe en disco; Oracle devuelve null
    if (e.code === 'ENOENT' || e.message?.includes('no encontrado')) {
      return res.status(404).json({ error: `Sin XFDF para docId=${req.docId}` });
    }
    console.error('xfdf/get error:', e);
    res.status(500).json({ error: e.message });
  }
});


// ── PUT /api/xfdf/:docId ─────────────────────────────────────────
// Guarda (upsert) el XFDF de un documento.
//
// Acepta dos formatos de cuerpo:
//   1. Content-Type: application/xml  → req.body es el XML crudo (string)
//   2. Content-Type: application/json → { xfdfContent: "<xfdf .../>", usuario: "nombre" }
//
// Para que Express parsee XML crudo, agrega en server.js:
//   app.use('/api/xfdf', express.text({ type: 'application/xml', limit: '10mb' }));
//   app.use('/api/xfdf', express.json({ limit: '10mb' }));
// (ambos middlewares, en ese orden, antes de montar el router)
router.put('/:docId', async (req, res) => {
  let xfdfContent;
  let usuario = req.user?.name ?? 'API';

  const ct = req.headers['content-type'] || '';

  if (ct.includes('application/xml') || ct.includes('text/xml')) {
    // Cuerpo es XML crudo
    xfdfContent = typeof req.body === 'string' ? req.body : req.body?.toString();
  } else {
    // Asume JSON
    xfdfContent = req.body?.xfdfContent;
    if (req.body?.usuario) usuario = req.body.usuario;
  }

  if (!xfdfContent || !xfdfContent.trim()) {
    return res.status(400).json({ error: 'Cuerpo vacío: se requiere el contenido XFDF' });
  }

  // Validación mínima: debe parecer XML con <xfdf
  if (!xfdfContent.includes('<xfdf')) {
    return res.status(422).json({ error: 'El contenido no parece un archivo XFDF válido' });
  }

  try {
    const filePath = await xfdfStore.save(req.docId, xfdfContent, usuario);
    res.json({
      ok      : true,
      docId   : req.docId,
      filePath,
      message : `XFDF guardado para docId=${req.docId}`,
    });

  } catch (e) {
    console.error('xfdf/put error:', e);
    res.status(500).json({ error: e.message });
  }
});


// ── DELETE /api/xfdf/:docId ───────────────────────────────────────
// Elimina el XFDF de disco y de Oracle.
router.delete('/:docId', async (req, res) => {
  try {
    await xfdfStore.remove(req.docId);
    res.json({ ok: true, message: `XFDF eliminado para docId=${req.docId}` });

  } catch (e) {
    console.error('xfdf/delete error:', e);
    res.status(500).json({ error: e.message });
  }
});


// ── GET /api/xfdf/:docId/meta ─────────────────────────────────────
// Devuelve solo la metadata del XFDF (fecha, usuario) sin enviar el CLOB completo.
// Útil para el cliente: saber si ya existe un XFDF antes de pedirlo.
const oracledb = require('oracledb');

router.get('/:docId/meta', async (req, res) => {
  const DB_CONFIG = {
    user         : process.env.ORACLE_USER     || 'saf',
    password     : process.env.ORACLE_PASSWORD || 'saf_pass',
    connectString: process.env.ORACLE_CONNSTR  || 'localhost/SAFDB',
  };

  const USE_DB = process.env.XFDF_USE_DB !== 'false';

  if (!USE_DB) {
    // Modo sin Oracle: comprobar existencia en disco
    const path = require('path');
    const fs   = require('fs').promises;
    const XFDF_DIR = process.env.XFDF_DIR || '/var/www/saf/xfdf';
    const filePath = path.join(XFDF_DIR, `${req.docId}.xfdf`);

    try {
      const stat = await fs.stat(filePath);
      return res.json({
        exists    : true,
        docId     : req.docId,
        fechaMod  : stat.mtime,
        fuente    : 'disco',
      });
    } catch {
      return res.json({ exists: false, docId: req.docId });
    }
  }

  let conn;
  try {
    conn = await oracledb.getConnection(DB_CONFIG);
    const result = await conn.execute(
      `SELECT FECHA_MOD, MODIFICADO_POR
         FROM SAF_PLANO_MARKUP_XFDF
        WHERE DOC_ID = :docId`,
      { docId: { val: req.docId, type: oracledb.NUMBER } },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const row = result.rows[0];
    if (!row) {
      return res.json({ exists: false, docId: req.docId });
    }

    res.json({
      exists        : true,
      docId         : req.docId,
      fechaMod      : row.FECHA_MOD,
      modificadoPor : row.MODIFICADO_POR,
      fuente        : 'oracle',
    });

  } catch (e) {
    console.error('xfdf/meta error:', e);
    res.status(500).json({ error: e.message });
  } finally {
    conn && await conn.close();
  }
});


module.exports = router;
