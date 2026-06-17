/**
 * SAF Planos — API REST para markup con Oracle
 * Node.js + Express + node-oracledb
 *
 * Montar en server.js:
 *   const markupRouter = require('./server/routes/markup');
 *   app.use('/api/markup', markupRouter);
 */

const express    = require('express');
const oracledb   = require('oracledb');
const router     = express.Router();

// ── Configuración de conexión ──────────────────────────────────
// Leer de variables de entorno o de tu config central de SAF
const DB_CONFIG = {
  user        : process.env.ORACLE_USER     || 'saf',
  password    : process.env.ORACLE_PASSWORD || 'saf_pass',
  connectString: process.env.ORACLE_CONNSTR || 'localhost/SAFDB',
};

async function getConn() {
  return oracledb.getConnection(DB_CONFIG);
}

// ── POST /api/markup/save ─────────────────────────────────────
// Body: { docId, page, objectsJson, scale: { pxPerUnit, unit } }
router.post('/save', async (req, res) => {
  const { docId, page, objectsJson, scale } = req.body;
  if (!docId || !page) {
    return res.status(400).json({ error: 'docId y page son requeridos' });
  }

  let conn;
  try {
    conn = await getConn();
    await conn.execute(
      `BEGIN
         PKG_PLANO_MARKUP.GUARDAR_MARKUP(
           p_doc_id        => :docId,
           p_pagina        => :page,
           p_objetos_json  => :json,
           p_escala_px     => :scalePx,
           p_escala_unidad => :scaleUnit,
           p_usuario       => :user
         );
       END;`,
      {
        docId    : { val: docId,             type: oracledb.NUMBER  },
        page     : { val: page,              type: oracledb.NUMBER  },
        json     : { val: JSON.stringify(objectsJson || []),
                     type: oracledb.CLOB  },
        scalePx  : { val: scale?.pxPerUnit ?? null, type: oracledb.NUMBER  },
        scaleUnit: { val: scale?.unit       ?? null, type: oracledb.STRING  },
        user     : { val: req.user?.name    ?? 'API', type: oracledb.STRING },
      }
    );
    res.json({ ok: true });

  } catch (e) {
    console.error('markup/save error:', e);
    res.status(500).json({ error: e.message });
  } finally {
    conn && await conn.close();
  }
});


// ── GET /api/markup/load/:docId ───────────────────────────────
// Retorna la sesión completa del documento
router.get('/load/:docId', async (req, res) => {
  const docId = parseInt(req.params.docId, 10);
  if (!docId) return res.status(400).json({ error: 'docId inválido' });

  let conn;
  try {
    conn = await getConn();
    const result = await conn.execute(
      `SELECT PKG_PLANO_MARKUP.OBTENER_SESION(:docId) AS SESION FROM DUAL`,
      { docId: { val: docId, type: oracledb.NUMBER } },
      { outFormat: oracledb.OUT_FORMAT_OBJECT, fetchInfo: { SESION: { type: oracledb.STRING } } }
    );

    const jsonStr = result.rows[0]?.SESION;
    if (!jsonStr) return res.status(404).json({ error: 'Sin markup para este documento' });

    res.json(JSON.parse(jsonStr));

  } catch (e) {
    console.error('markup/load error:', e);
    res.status(500).json({ error: e.message });
  } finally {
    conn && await conn.close();
  }
});


// ── DELETE /api/markup/:docId/:page ──────────────────────────
router.delete('/:docId/:page', async (req, res) => {
  const docId = parseInt(req.params.docId, 10);
  const page  = parseInt(req.params.page,  10);

  let conn;
  try {
    conn = await getConn();
    await conn.execute(
      `BEGIN PKG_PLANO_MARKUP.LIMPIAR_MARKUP(:docId, :page); END;`,
      { docId: { val: docId, type: oracledb.NUMBER },
        page : { val: page,  type: oracledb.NUMBER } }
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('markup/delete error:', e);
    res.status(500).json({ error: e.message });
  } finally {
    conn && await conn.close();
  }
});

module.exports = router;
