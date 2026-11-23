/* ============================================================================
 * Apex-Configuracion.js — Integración del Visor de Planos con Oracle APEX
 *
 * Va en: Página APEX → JavaScript → "Function and Global Variable Declaration".
 * actualizarFramePlanos() se llama desde un Dynamic Action (Page Load o al
 * cambiar de plano).
 *
 * APEX y el visor (iframe de otro dominio) se comunican solo por postMessage.
 * VISOR_ORIGIN (aquí) y VITE_APEX_ORIGIN (en el visor) deben estar emparejados:
 * si no, los mensajes se descartan en silencio y el visor queda vacío.
 * Ver docs/DESPLIEGUE.md.
 * ==========================================================================*/

const VISOR_ORIGIN   = 'https://planos.aicsacorp.com';
const VISOR_FRAME_ID = 'frame-planos';   // id del <iframe> o de la región que lo contiene


/* ── APEX → VISOR ───────────────────────────────────────────────────────── */

function actualizarFramePlanos() {
  const datos = {
    action: 'init',
    usuario_conectado:      "&GLOBAL_NOMBRE_CORTO_USUARIO.",
    codigo_usuario:         "&GLOBAL_CODIGO_USUARIO.",   // sin él las marcas se graban con usuario 0
    repoId:                 apex.item("P&APP_PAGE_ID._ID_EN_REPOSITORIO").getValue(),
    nombre:                 apex.item("P&APP_PAGE_ID._NOMBRE_ARCHIVO").getValue(),
    codigo_proyecto:        apex.item("P&APP_PAGE_ID._CODIGO_PROYECTO").getValue(),
    P0_PERMISO_COLABORADOR: apex.item("P0_PERMISO_COLABORADOR").getValue()
  };

  let frame = document.getElementById(VISOR_FRAME_ID);
  if (frame && frame.tagName !== 'IFRAME') frame = frame.querySelector('iframe');
  if (!frame) {
    console.error('[SAF] No se encontró el iframe del visor (#' + VISOR_FRAME_ID + ')');
    return;
  }

  frame.addEventListener('load', function () {
    frame.contentWindow.postMessage(datos, VISOR_ORIGIN);
    console.log('[SAF] init enviado →', datos);
  }, { once: true });

  // ?t= obliga a recargar: con el mismo src no se dispara 'load' y el init no se envía.
  frame.src = VISOR_ORIGIN + '?t=' + Date.now();
}

/* Visor 3D (IFC): misma integración, otra ruta del visor. */
function actualizarFrameModelo() {
  const datos = {
    action: 'init',
    usuario_conectado:      "&GLOBAL_NOMBRE_CORTO_USUARIO.",
    codigo_usuario:         "&GLOBAL_CODIGO_USUARIO.",
    repoId:                 apex.item("P&APP_PAGE_ID._ID_MODELO_REPOSITORIO").getValue(),
    nombre:                 apex.item("P&APP_PAGE_ID._NOMBRE_MODELO").getValue(),
    codigo_proyecto:        apex.item("P&APP_PAGE_ID._CODIGO_PROYECTO").getValue(),
    P0_PERMISO_COLABORADOR: apex.item("P0_PERMISO_COLABORADOR").getValue()
  };

  let frame = document.getElementById(VISOR_FRAME_ID);
  if (frame && frame.tagName !== 'IFRAME') frame = frame.querySelector('iframe');
  if (!frame) {
    console.error('[SAF] No se encontró el iframe del visor (#' + VISOR_FRAME_ID + ')');
    return;
  }

  frame.addEventListener('load', function () {
    frame.contentWindow.postMessage(datos, VISOR_ORIGIN);
    console.log('[SAF] init (modelo 3D) enviado →', datos);
  }, { once: true });

  frame.src = VISOR_ORIGIN + '/modelo/?t=' + Date.now();
}


/* ── VISOR → APEX ───────────────────────────────────────────────────────── */
/* El iframe está en sandbox: no puede abrir pestañas, descargar ni llamar a
   apex.server.process, así que delega estas acciones en la página. */

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

function handleDownloadDoc(d) {
  const a = document.createElement('a');
  a.href     = d.dataUrl;
  a.download = d.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function handleOpenRfi(d) {
  apex.submit({ request: 'irRFI', set: { 'P&APP_PAGE_ID._ID_RFI': d.rfiId } });
}

function handleClose() {
  apex.submit('CERRAR');
}

// Un único listener: varios sueltos provocaban modales duplicados.
window.addEventListener('message', function (e) {
  if (e.origin !== VISOR_ORIGIN) return;   // validar origen siempre, antes que nada

  const d = e.data;
  if (!d || typeof d !== 'object') return;

  // 'close' llega con source:'visor-planos' (el visor lo envía con targetOrigin '*').
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
