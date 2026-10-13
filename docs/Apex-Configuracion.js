/* ============================================================================
 * Apex-Configuracion.js — Integración del Visor de Planos con Oracle APEX
 *
 * DÓNDE VA ESTE CÓDIGO
 *   Página APEX → sección "JavaScript" → "Function and Global Variable
 *   Declaration". Las llamadas (actualizarFramePlanos) van en un Dynamic
 *   Action, normalmente "Page Load" o al cambiar el plano seleccionado.
 *
 * CÓMO SE COMUNICAN
 *   El visor vive en un <iframe> de otro dominio, así que APEX y el visor NO
 *   pueden leerse el DOM. Todo pasa por `postMessage`, en dos direcciones:
 *
 *     APEX  ──{action:'init', ...}──▶  Visor     (identidad, plano, permisos)
 *     APEX  ◀──{action:'openPlano'}──  Visor     (abrir otro plano)
 *     APEX  ◀──{action:'openRfi'}───   Visor     (abrir el drawer de RFI)
 *     APEX  ◀──{action:'downloadDoc'}─ Visor     (descargar un archivo)
 *     APEX  ◀──{action:'close'}──────  Visor     (cerrar el visor)
 *
 * SEGURIDAD — LA REGLA DE LOS DOS ORÍGENES
 *   Cada lado solo acepta mensajes del otro:
 *     · Aquí (APEX):  VISOR_ORIGIN         debe ser el origen del visor.
 *     · En el visor:  VITE_APEX_ORIGIN     debe ser el origen de ESTA página.
 *   Si no coinciden, el mensaje se descarta EN SILENCIO: no verás ningún
 *   error, simplemente el visor se quedará vacío. Es el fallo más difícil de
 *   diagnosticar de toda la integración — revisa esto primero.
 *   Ver docs/DESPLIEGUE.md → "Cambiar de entorno: SIEMPRE son dos cambios".
 *
 * ALTERNATIVA: PARÁMETROS EN LA URL
 *   El visor también acepta la identidad por query string, útil para pruebas
 *   sin postMessage:
 *     ?usuario=Nombre&codigo_usuario=123&codigo_proyecto=ABC
 *     &id_revision=456&P0_PERMISO_COLABORADOR=1
 *   Claves alternativas aceptadas: usuario_conectado · user · nombreUsuario
 *   para el nombre; usuario_id · id_usuario para el código.
 * ==========================================================================*/


/* ─────────────────────────────────────────────────────────────────────────
   CONFIGURACIÓN
   ───────────────────────────────────────────────────────────────────────── */

/**
 * Origen del visor. DEBE coincidir con el `VITE_APEX_ORIGIN` configurado en
 * el visor, pero al revés: allá se pone el origen de APEX, aquí el del visor.
 */
const VISOR_ORIGIN = 'https://planos.aicsacorp.com';

/** Id del <iframe> (o de la región APEX que lo contiene). */
const VISOR_FRAME_ID = 'frame-planos';


/* ─────────────────────────────────────────────────────────────────────────
   APEX  ──▶  VISOR :  mensaje de inicialización
   ───────────────────────────────────────────────────────────────────────── */

/**
 * Carga el visor y le manda todo lo que necesita en un solo mensaje `init`.
 *
 * CAMPOS DEL MENSAJE (todos opcionales salvo los marcados):
 *   action              'init'  ← obligatorio
 *   usuario_conectado   Nombre visible del usuario. Alternativas: usuario, name
 *   codigo_usuario      ID numérico → se guarda como USUARIO_GRABACION en las
 *                       marcas. Sin él se graba 0 y las marcas quedan huérfanas.
 *                       Alternativas: usuario_id, codigo
 *   repoId              id_en_repositorio del plano → el visor lo pide a ORDS
 *   nombre              Nombre del archivo (se envía a ORDS como header)
 *   pdfUrl              Alternativa a repoId: URL directa de un PDF
 *   codigo_proyecto     Filtra los listados de planos y de RFI
 *   id_revision         Revisión del plano (para el historial de marcas)
 *   P0_PERMISO_COLABORADOR  '1' → puede guardar marcas y descargar
 */
function actualizarFramePlanos() {
  const datos = {
    action: 'init',
    usuario_conectado:      "&GLOBAL_NOMBRE_CORTO_USUARIO.",
    codigo_usuario:         "&GLOBAL_CODIGO_USUARIO.",
    repoId:                 apex.item("P&APP_PAGE_ID._ID_EN_REPOSITORIO").getValue(),
    nombre:                 apex.item("P&APP_PAGE_ID._NOMBRE_ARCHIVO").getValue(),
    codigo_proyecto:        apex.item("P&APP_PAGE_ID._CODIGO_PROYECTO").getValue(),
    P0_PERMISO_COLABORADOR: apex.item("P0_PERMISO_COLABORADOR").getValue()
  };

  // El id puede apuntar al <iframe> o a la región APEX que lo envuelve.
  let frame = document.getElementById(VISOR_FRAME_ID);
  if (frame && frame.tagName !== 'IFRAME') frame = frame.querySelector('iframe');
  if (!frame) {
    console.error('[SAF] No se encontró el iframe del visor (#' + VISOR_FRAME_ID + ')');
    return;
  }

  // El init se manda cuando el visor terminó de cargar: antes no hay listener.
  frame.addEventListener('load', function () {
    frame.contentWindow.postMessage(datos, VISOR_ORIGIN);
    console.log('[SAF] init enviado →', datos);
  }, { once: true });

  // IMPORTANTE: el parámetro ?t= no es decorativo.
  // Asignar a `src` el MISMO valor que ya tiene no recarga el iframe, así que
  // el evento 'load' nunca se dispara y el init nunca se envía — el visor se
  // queda vacío sin ningún error. El timestamp garantiza que la URL cambie.
  frame.src = VISOR_ORIGIN + '?t=' + Date.now();
}


/* ─────────────────────────────────────────────────────────────────────────
   VISOR  ──▶  APEX :  manejadores
   ───────────────────────────────────────────────────────────────────────── */

/**
 * `openPlano` — el usuario siguió un hipervínculo a otro plano.
 *
 * El iframe está en sandbox: no puede abrir pestañas ni usar apex.server.process.
 * Por eso delega en el padre.
 *
 * Campos: repoId · name · file · url (una URL del visor ya armada, por si
 * prefieres abrirla directo en vez de pasar por el proceso de APEX).
 */
function handleOpenPlano(d) {
  apex.server.process(
    'ABRIR_PLANO',
    { x01: d.repoId, x02: d.file },
    {
      dataType: 'json',
      success: function (r) {
        if (r && r.url) window.open(r.url, '_blank');
      }
    }
  );
}

/**
 * `downloadDoc` — descarga de un archivo generado por el visor (PNG del plano
 * con marcas, por ejemplo).
 *
 * El iframe en sandbox no puede disparar descargas; manda el contenido como
 * data URL y el padre crea el enlace.
 *
 * Campos: filename · dataUrl
 */
function handleDownloadDoc(d) {
  const a = document.createElement('a');
  a.href     = d.dataUrl;
  a.download = d.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * `openRfi` — abrir el drawer de RFI.
 *
 * Campos: rfiId (ausente si mode==='create') · apexPage (87490) ·
 *         mode ('create' para alta) · repoId · page (página del plano).
 */
function handleOpenRfi(d) {
  apex.submit({ request: 'irRFI', set: { 'P&APP_PAGE_ID._ID_RFI': d.rfiId } });
}

/**
 * `close` — el usuario cerró el visor (ya confirmó el diálogo).
 *
 * OJO: este mensaje llega con `source: 'visor-planos'` y SIN el campo `action`
 * en la forma habitual, porque el visor lo envía con targetOrigin '*' (dentro
 * del iframe no conoce el origen real del padre). Por eso se valida aquí por
 * `e.origin`, igual que los demás.
 */
function handleClose() {
  apex.submit('CERRAR');
}


/* ─────────────────────────────────────────────────────────────────────────
   LISTENER ÚNICO
   Un solo `message` para todos los mensajes del visor. Tener varios listeners
   sueltos provocó en su momento modales duplicados.
   ───────────────────────────────────────────────────────────────────────── */
window.addEventListener('message', function (e) {
  // Validación de origen PRIMERO y para TODOS los mensajes, sin excepción.
  // Sin esto, cualquier página embebida podría disparar descargas o cerrar
  // la sesión del visor.
  if (e.origin !== VISOR_ORIGIN) return;

  const d = e.data;
  if (!d || typeof d !== 'object') return;

  // El mensaje de cierre viaja con `source` en vez de depender solo de action.
  if (d.source === 'visor-planos' && d.action === 'close') {
    handleClose();
    return;
  }

  switch (d.action) {
    case 'openPlano':   handleOpenPlano(d);    break;
    case 'downloadDoc': handleDownloadDoc(d);  break;
    case 'openRfi':     handleOpenRfi(d);      break;
  }
});


/* ─────────────────────────────────────────────────────────────────────────
   DIAGNÓSTICO

   Si el visor se queda en blanco, abre la consola del navegador (F12) y
   revisa en este orden:

   1. ¿Aparece "[SAF] init enviado → {...}" ?
      NO  → el evento 'load' no se disparó. Casi siempre es el `frame.src`
            sin cambiar (ver el comentario del ?t=), o el id del iframe.
      SÍ  → el mensaje salió; sigue al punto 2.

   2. En la consola del IFRAME (selector de contexto → el del visor),
      ¿aparece "[SAF] codigo_usuario (init): ..." ?
      NO  → el visor descartó el mensaje por origen. VISOR_ORIGIN de aquí y
            VITE_APEX_ORIGIN de allá no están emparejados.

   3. ¿Sale "No se pudo cargar el PDF" con un bloque "── Diagnóstico ──"?
      Ese bloque trae el status HTTP real, el Content-Type y los headers
      enviados. Ver docs/DESPLIEGUE.md → "Diagnosticar 'no carga el PDF'".

   4. ¿Las marcas no se guardan?
      Revisa que `codigo_usuario` no llegue vacío: sin él se graba
      USUARIO_GRABACION = 0. El visor lo avisa con un console.warn.
   ───────────────────────────────────────────────────────────────────────── */
