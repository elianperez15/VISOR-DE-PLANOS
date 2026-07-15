/* ──────────────────────────────────────────────────────────────────────
   config.ts — Endpoints y orígenes del visor (centralizado)

   Buenas prácticas:
   · NADA de dominios hardcodeados en el código de la app.
   · Por defecto, rutas RELATIVAS (mismo origen que el visor) → sin CORS,
     sin acoplar el build a un dominio concreto.
   · Override por entorno con variables VITE_* (archivo .env / .env.production),
     útil cuando APEX y el visor viven en dominios distintos.
   ────────────────────────────────────────────────────────────────────── */

/**
 * Base del servicio ORDS de APEX (host + schema). ESTO es lo que cambia
 * entre desarrollo y producción → se controla con VITE_ORDS_BASE.
 *   dev  → https://dev.aicsacorp.com/ords/safws
 *   prod → https://prod.aicsacorp.com/ords/safws
 * Relativa por defecto (mismo origen que el visor).
 */
const ORDS_BASE = (import.meta.env.VITE_ORDS_BASE ?? '/ords/safws').replace(/\/+$/, '');

/** Módulo ORDS que agrupa los endpoints (fijo, no cambia entre entornos). */
const ORDS_MODULE = 'Reportes';

/** Une base + módulo + segmento de forma segura (sin dobles barras). */
function endpoint(path: string): string {
  return `${ORDS_BASE}/${path.replace(/^\/+/, '')}`;
}

/** Resuelve ID de usuario → nombre completo. */
export const API_USUARIO = endpoint('usuario_conectado');

/**
 * Devuelve el PDF (BLOB). El handler ORDS espera el id y el nombre como
 * HTTP HEADERS (Source Type: HTTP HEADER → binds :id y :nombre):
 *   GET {API_PDF}   headers: { id: '123', nombre: 'plano-x.pdf' }
 */
export const API_PDF = endpoint('/planos-hub/documento');

/**
 * Origen del portal APEX aceptado en postMessage.
 * Por defecto el propio origen del visor (cuando APEX lo embebe en el mismo dominio).
 */
export const APEX_ORIGIN = import.meta.env.VITE_APEX_ORIGIN ?? window.location.origin;

/* ──────────────────────────────────────────────────────────────────────
   COLABORACIÓN EN TIEMPO REAL (microservicio Socket.IO)
   El visor abre wss://<origen>/rt/socket.io vía nginx (location /rt/).
   En desarrollo puedes apuntar a otro host con VITE_COLLAB_URL.
   ────────────────────────────────────────────────────────────────────── */
/** URL base del microservicio de colaboración (mismo origen por defecto). */
export const COLLAB_URL  = import.meta.env.VITE_COLLAB_URL ?? window.location.origin;
/** Ruta del WebSocket (bajo el location /rt/ de nginx → proxy al microservicio). */
export const COLLAB_PATH = '/rt/ws';

/**
 * Persistencia del markup vía ORDS. El id_en_repositorio va como HTTP HEADER
 * (header `id` → bind :id en el handler), igual que el endpoint 'documento'.
 * El handler PL/SQL hace UPSERT por (ID_EN_REPOSITORIO, USUARIO_GRABACION) y el
 * GET devuelve las capas más recientes de todos los usuarios del documento.
 *   POST {API_MARKUP}   header id: 123   body: { usuario, usuario_id, id_revision, sesion }
 *   GET  {API_MARKUP}   header id: 123 → { capas: [{ usuario, usuario_id, sesion }, ...] }
 */
export const API_MARKUP = endpoint('/planos-hub/markup');

/**
 * Listado de planos para el hipervínculo "ir a otro plano".
 * El id_en_repositorio del plano ACTUAL va como HTTP HEADER `id` (bind
 * :id_en_repositorio) para excluirlo del listado; omítelo para traer todos.
 * GET → { items: [ { display, id_en_repositorio, nombre_archivo }, ... ] }
 */
export const API_PLANOS = endpoint('/planos-hub/planos-listado');

/**
 * Listado de RFIs para el sello RFI (panel de propiedades).
 * GET → { items: [ { id, display, ... }, ... ] }
 */
export const API_RFI = endpoint('/planos-hub/rfi-listado');

/** Página APEX (drawer) que muestra el RFI seleccionado. */
export const APEX_RFI_PAGE = 87490;
