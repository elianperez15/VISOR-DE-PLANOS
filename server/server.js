/**
 * server.js — Punto de entrada del API REST del Visor de Planos
 * Express + node-oracledb (modo thin: NO requiere Oracle Instant Client)
 *
 * Variables de entorno (o secrets en /run/secrets/<nombre>):
 *   ORACLE_USER, ORACLE_PASSWORD, ORACLE_CONNSTR
 *   XFDF_DIR        (default /data/xfdf dentro del contenedor)
 *   XFDF_USE_DB     ('false' para omitir Oracle y usar solo disco)
 *   PORT            (default 3000)
 *   TRUST_PROXY     ('true' si corre detrás de Nginx — para rate-limit por IP real)
 */

const fs      = require('fs');
const express = require('express');
const helmet  = require('helmet');
const rateLimit = require('express-rate-limit');

// ── Secrets: leer de /run/secrets si existen, si no caer a env ──────────
function secret(name, envVar) {
  const p = `/run/secrets/${name}`;
  if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8').trim();
  return process.env[envVar];
}
// Propagar a las variables que esperan los routers (leen process.env.*)
process.env.ORACLE_USER     = secret('oracle_user',     'ORACLE_USER')     || 'saf';
process.env.ORACLE_PASSWORD = secret('oracle_password', 'ORACLE_PASSWORD') || '';
// connectString no es secreto crítico; viene por env directo

const app  = express();
const PORT = parseInt(process.env.PORT, 10) || 3000;

// Detrás de Nginx: confiar en X-Forwarded-For para rate-limit por IP real
if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1);

app.disable('x-powered-by');
app.use(helmet());

// Limitar abuso del API
app.use('/api/', rateLimit({
  windowMs: 60 * 1000,   // 1 min
  max: 120,              // 120 req/min por IP
  standardHeaders: true,
  legacyHeaders: false,
}));

// Body parsers — el JSON para /api/markup, el XML crudo para PUT /api/xfdf
app.use(express.json({ limit: '10mb' }));
app.use('/api/xfdf', express.text({ type: ['application/xml', 'text/xml'], limit: '10mb' }));

// Rutas
app.use('/api/markup', require('./routes/markup'));
app.use('/api/xfdf',   require('./routes/xfdf'));

// Healthcheck (para el HEALTHCHECK del contenedor y el monitoreo)
app.get('/healthz', (_req, res) => res.json({ ok: true }));

// Escuchar en todas las interfaces del contenedor (Nginx lo alcanza por la red del pod)
app.listen(PORT, '0.0.0.0', () => {
  console.log(`SAF Planos API escuchando en :${PORT}`);
});
