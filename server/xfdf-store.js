/**
 * xfdf-store.js — Almacén de archivos XFDF en Oracle (CLOB) y en disco
 *
 * Estrategia "archivo suelto":
 *   · El PDF vive en /var/www/saf/pdfs/<docId>.pdf
 *   · El XFDF vive en /var/www/saf/xfdf/<docId>.xfdf  (fallback disco)
 *   · Oracle guarda el XFDF en SAF_PLANO_MARKUP.XFDF_CONTENT para
 *     consultas SQL y auditoría.
 *
 * Ambas rutas son opcionales: USE_DB controla si se escribe en Oracle.
 */

const fs        = require('fs').promises;
const path      = require('path');
const oracledb  = require('oracledb');

const USE_DB    = process.env.XFDF_USE_DB !== 'false';   // default true
const XFDF_DIR  = process.env.XFDF_DIR || '/var/www/saf/xfdf';

const DB_CONFIG = {
  user         : process.env.ORACLE_USER     || 'saf',
  password     : process.env.ORACLE_PASSWORD || 'saf_pass',
  connectString: process.env.ORACLE_CONNSTR  || 'localhost/SAFDB',
};

// ── Asegurar que el directorio XFDF exista ──────────────────────────────
async function ensureDir() {
  await fs.mkdir(XFDF_DIR, { recursive: true });
}

// ── GUARDAR ─────────────────────────────────────────────────────────────
/**
 * Guarda el XFDF para un documento.
 * @param {string|number} docId
 * @param {string}        xfdfContent   string XML completo
 * @param {string}        [usuario]
 */
async function save(docId, xfdfContent, usuario = 'API') {
  await ensureDir();

  // 1. Guardar en disco (siempre)
  const filePath = path.join(XFDF_DIR, `${docId}.xfdf`);
  await fs.writeFile(filePath, xfdfContent, 'utf8');

  // 2. Guardar en Oracle (si está habilitado)
  if (USE_DB) {
    let conn;
    try {
      conn = await oracledb.getConnection(DB_CONFIG);
      // Upsert usando PKG_PLANO_MARKUP
      await conn.execute(
        `BEGIN
           PKG_PLANO_MARKUP.GUARDAR_XFDF(
             p_doc_id       => :docId,
             p_xfdf_content => :xfdf,
             p_usuario      => :usuario
           );
         END;`,
        {
          docId  : { val: docId,       type: oracledb.NUMBER },
          xfdf   : { val: xfdfContent, type: oracledb.CLOB   },
          usuario: { val: usuario,     type: oracledb.STRING  },
        }
      );
    } finally {
      conn && await conn.close();
    }
  }

  return filePath;
}

// ── CARGAR ──────────────────────────────────────────────────────────────
/**
 * Carga el XFDF para un documento.
 * Intenta Oracle primero; cae a disco si Oracle falla o está deshabilitado.
 * @param {string|number} docId
 * @returns {string}  contenido XFDF (string XML)
 */
async function load(docId) {
  // Intentar Oracle
  if (USE_DB) {
    let conn;
    try {
      conn = await oracledb.getConnection(DB_CONFIG);
      const result = await conn.execute(
        `SELECT XFDF_CONTENT FROM SAF_PLANO_MARKUP_XFDF WHERE DOC_ID = :docId`,
        { docId: { val: docId, type: oracledb.NUMBER } },
        { outFormat: oracledb.OUT_FORMAT_OBJECT, fetchInfo: { XFDF_CONTENT: { type: oracledb.STRING } } }
      );
      const row = result.rows[0];
      if (row?.XFDF_CONTENT) return row.XFDF_CONTENT;
    } catch (e) {
      console.warn('xfdf-store: Oracle lookup falló, usando archivo:', e.message);
    } finally {
      conn && await conn.close();
    }
  }

  // Fallback: disco
  const filePath = path.join(XFDF_DIR, `${docId}.xfdf`);
  return await fs.readFile(filePath, 'utf8');
}

// ── ELIMINAR ─────────────────────────────────────────────────────────────
async function remove(docId) {
  const filePath = path.join(XFDF_DIR, `${docId}.xfdf`);
  try { await fs.unlink(filePath); } catch {}

  if (USE_DB) {
    let conn;
    try {
      conn = await oracledb.getConnection(DB_CONFIG);
      await conn.execute(
        `DELETE FROM SAF_PLANO_MARKUP_XFDF WHERE DOC_ID = :docId`,
        { docId: { val: docId, type: oracledb.NUMBER } }
      );
      await conn.commit();
    } finally {
      conn && await conn.close();
    }
  }
}

module.exports = { save, load, remove };
