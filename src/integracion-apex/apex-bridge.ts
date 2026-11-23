/* ──────────────────────────────────────────────────────────────────────
   apex-bridge.ts — Puente postMessage con la página APEX que embebe el visor

   APEX y el visor viven en orígenes distintos: todo pasa por postMessage y
   cada lado valida el origen del otro (VITE_APEX_ORIGIN ↔ VISOR_ORIGIN). Si
   no están emparejados, los mensajes se descartan EN SILENCIO.

   Salida (visor → APEX): openRfi · openPlano · downloadDoc · close
   Entrada (APEX → visor): init · setUser · openPDF · openModel · setLinkTarget,
   y en cualquier mensaje: codigo_proyecto y el permiso de colaborador.
   Un archivo .ifc / .frag (por su nombre) se abre en el visor 3D aunque
   llegue por openPDF o init.
   ────────────────────────────────────────────────────────────────────── */
import { APEX_ORIGIN } from '../app/config';

/** ¿El visor corre dentro de un iframe (APEX)? */
export function isEmbedded(): boolean {
  return window.parent !== window;
}

/** Envía un mensaje a la página APEX (no hace nada si el visor no está embebido). */
export function postToApex(msg: Record<string, unknown>): void {
  try { if (isEmbedded()) window.parent.postMessage(msg, APEX_ORIGIN); } catch (e) {}
}

/**
 * Pide al contenedor que cierre el visor.
 * OJO: va con targetOrigin '*' — dentro del iframe NO conocemos el origen real
 * del padre, y APEX_ORIGIN (que por defecto es el propio origen del visor)
 * haría que el navegador descartara el mensaje. Sin datos sensibles → '*' es
 * seguro; el padre sí valida e.origin al recibirlo.
 */
export function requestClose(): void {
  const msg = { source: 'visor-planos', action: 'close' };
  try { if (window.parent && window.parent !== window) window.parent.postMessage(msg, '*'); } catch (e) {}
  try { if (window.top && window.top !== window) window.top.postMessage(msg, '*'); } catch (e) {}
  // Además intentar cerrar la ventana directamente (si la abrió window.open).
  try { window.close(); } catch (e) {}
  try { window.open('', '_self'); window.close(); } catch (e) {}
}

/** Documento a abrir (plano PDF o modelo 3D): por id de repositorio (vía ORDS) o por URL directa. */
export interface OpenPlanoRequest {
  repoId?: string | number;
  pdfUrl?: string;
  /** URL directa de un modelo 3D (IFC / .frag). */
  modelUrl?: string;
  docId?: string | number;
  name?: string;
  /** Abrir en el visor 3D aunque el nombre no termine en .ifc / .frag (acción openModel). */
  model?: boolean;
}

export interface ApexHandlers {
  onProjectCode(code: string): void;
  onPermission(value: unknown): void;
  /** setUser: nombre y/o código de usuario (USUARIO_GRABACION). */
  onSetUser(name: string | undefined, code: unknown): void;
  /** init: identidad + revisión + (opcional) plano a abrir. */
  onInit(init: { name?: string; code: unknown; revId: unknown; plano: OpenPlanoRequest | null }): void;
  onOpenPlano(req: OpenPlanoRequest): void;
  /** APEX devuelve el plano elegido para un hipervínculo. */
  onSetLinkTarget(target: { repoId: unknown; name?: string; file?: string }): void;
}

/** Escucha los mensajes de APEX (o de la propia ventana, en pruebas). */
export function listenToApex(handlers: ApexHandlers): void {
  window.addEventListener('message', e => {
    if (e.origin !== APEX_ORIGIN && e.origin !== window.location.origin) return;
    const d = e.data;
    if (!d || typeof d !== 'object') return;

    // Código de proyecto y permiso de colaborador: pueden venir en cualquier mensaje
    if (d.codigo_proyecto != null && String(d.codigo_proyecto).trim() !== '') {
      handlers.onProjectCode(String(d.codigo_proyecto).trim());
    }
    const permission = d.P0_PERMISO_COLABORADOR ?? d.permiso_colaborador ?? d.permiso;
    if (permission != null) handlers.onPermission(permission);

    switch (d.action) {
      case 'setUser':
        handlers.onSetUser(d.name, d.codigo ?? d.usuario_id ?? d.codigo_usuario);
        break;
      case 'setLinkTarget':
        handlers.onSetLinkTarget({ repoId: d.repoId, name: d.name, file: d.file });
        break;
      case 'openPDF':
        handlers.onOpenPlano({ repoId: d.repoId ?? undefined, pdfUrl: d.pdfUrl, docId: d.docId, name: d.name });
        break;
      case 'openModel':
        handlers.onOpenPlano({ repoId: d.repoId ?? undefined, modelUrl: d.modelUrl, name: d.nombre || d.name, model: true });
        break;
      case 'init': {
        const name = d.nombre || d.name;
        handlers.onInit({
          name : d.usuario_conectado || d.usuario || d.name,
          code : d.codigo_usuario ?? d.usuario_id ?? d.codigo,
          revId: d.id_revision ?? d.id_revisiones_plano,
          plano: (d.repoId != null || d.pdfUrl || d.modelUrl)
            ? { repoId: d.repoId ?? undefined, pdfUrl: d.pdfUrl, modelUrl: d.modelUrl, docId: d.docId, name }
            : null,
        });
        break;
      }
    }
  });
}
