/* ──────────────────────────────────────────────────────────────────────
   config.ts — Endpoints y orígenes del visor (centralizado)

   Buenas prácticas:
   · NADA de dominios hardcodeados en el código de la app.
   · Por defecto, rutas RELATIVAS (mismo origen que el visor) → sin CORS,
     sin acoplar el build a un dominio concreto.
   · Override con variables VITE_* (.env.production), útil cuando APEX y el
     visor viven en dominios distintos.
   ────────────────────────────────────────────────────────────────────── */

/**
 * Base del servicio ORDS de APEX (host + schema). Se controla con VITE_ORDS_BASE.
 * Relativa por defecto (/ords/safws): nginx reenvía /ords/ al ORDS real
 * (saf.aicsacorp.com), así que el navegador lo ve todo en el mismo origen.
 * Mover ORDS = editar el proxy_pass de nginx, NO recompilar el visor.
 */
const ORDS_BASE = (import.meta.env.VITE_ORDS_BASE ?? '/ords/safws').replace(/\/+$/, '');

/**
 * Une la base con el segmento del endpoint (sin dobles barras).
 *
 * OJO: el nombre del módulo ORDS ("Reportes") NO va en la URL. Lo que va es su
 * BASE PATH, que en este ORDS es `planos-hub/` y ya está incluido en cada
 * constante de abajo. Verificado el 2026-09-22 contra dev.aicsacorp.com:
 *   /ords/safws/planos-hub/documento            → 200 application/pdf
 *   /ords/safws/Reportes/planos-hub/documento   → 404 NotFound
 * (Los comentarios de server/sql/*.sql que mencionan /Reportes/ están obsoletos.)
 */
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
   Para apuntar a otro host, VITE_COLLAB_URL (p.ej. en un .env.local).
   ────────────────────────────────────────────────────────────────────── */
/**
 * Interruptor de la colaboración EN VIVO (cursores, marcas de otros en tiempo
 * real, presencia). `VITE_COLLAB_ENABLED=false` la apaga.
 *
 * OJO — esto NO afecta a la persistencia. Guardar y cargar marcas, la
 * calibración de escala y la rotación viajan por HTTP contra ORDS
 * (features/collab-sync.ts), no por el WebSocket. Con el flag apagado todo eso
 * sigue funcionando igual; lo único que se pierde es ver a otros usuarios
 * trabajando al mismo tiempo.
 *
 * Por defecto TRUE: si la variable no está definida, el visor se comporta como
 * siempre. Apagarlo tiene que ser una decisión explícita.
 */
export const COLLAB_ENABLED = String(
  import.meta.env.VITE_COLLAB_ENABLED ?? 'true'
).toLowerCase() !== 'false';

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
