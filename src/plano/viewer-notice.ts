/* ──────────────────────────────────────────────────────────────────────
   viewer-notice.ts — Aviso "no hay nada que mostrar" y loader del plano

   El visor sólo abre planos del file server: cuando no aparece ninguno hay
   que decir por qué, en el propio lienzo (embebido en APEX un alert() es
   intrusivo y deja el lienzo en blanco).
   ────────────────────────────────────────────────────────────────────── */
import type { LoadError } from './pdf-renderer';

const NOTICE_TITLE = 'No se pudo cargar el archivo para su visualización';
const $ = (id: string) => document.getElementById(id) as any;

let noticeTimer: ReturnType<typeof setTimeout> | undefined;   // espera antes de dar por hecho que no vendrá plano

/**
 * Muestra el aviso que ocupa el lienzo. `reason` es la frase para el usuario;
 * `technical`, el volcado de diagnóstico, que va replegado. Separarlos importa:
 * el diagnóstico de PDFRenderer llega a incluir el HTML que devolvió el
 * servidor, y eso en pantalla no es un mensaje, es ruido.
 */
export function showViewerNotice(reason: string, technical?: string): void {
  clearTimeout(noticeTimer);
  const notice = $('viewer-notice');
  if (!notice) return;
  const title = $('viewer-notice-title'), detail = $('viewer-notice-detail');
  const tech = $('viewer-notice-tech'), techText = $('viewer-notice-tech-text');
  if (title)  title.textContent  = NOTICE_TITLE;
  if (detail) detail.textContent = reason || '';
  if (tech) {
    const hasTechnical = !!technical;
    tech.hidden = !hasTechnical;
    tech.open   = false;   // siempre plegado al aparecer
    if (hasTechnical && techText) techText.textContent = technical;
  }
  notice.style.display = 'flex';
}

export function hideViewerNotice(): void {
  clearTimeout(noticeTimer);
  const notice = $('viewer-notice');
  if (notice) notice.style.display = 'none';
}

/**
 * Da un margen antes de avisar de que no hay plano: embebido en APEX, la
 * petición llega por postMessage un instante después de cargar, y el aviso no
 * debe parpadear encima del plano que está a punto de abrirse.
 */
export function scheduleViewerNotice(reason: string, isPlanoLoaded: () => boolean): void {
  if (window.parent === window) { showViewerNotice(reason); return; }
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    if (!isPlanoLoaded()) showViewerNotice(reason);
  }, 2500);
}

/** Traduce el error de carga a [motivo legible, detalle técnico]. */
export function noticeFromError(e: LoadError): [string, string] {
  const reason = e && e.pista
    ? e.pista
    : 'El documento no se pudo abrir. Vuelve a intentarlo en unos minutos.';
  return [reason, (e && (e.tecnico || e.message)) || ''];
}

/** Muestra el loader de "cargando plano". */
export function showPlanoLoader(msg: string): void {
  const loader = $('plano-loader');
  if (!loader) return;
  const text = $('plano-loader-text');
  if (text && msg) text.textContent = msg;
  loader.style.display = 'flex';
}

export function hidePlanoLoader(): void {
  const loader = $('plano-loader');
  if (loader) loader.style.display = 'none';
}
