/* ──────────────────────────────────────────────────────────────────────
   compare-revisions.ts — Comparación de revisiones (overlay Rev B sobre A)

   Carga un segundo PDF (revisión B) y lo superpone, semitransparente y con
   tinte opcional, sobre el plano actual (revisión A) para detectar cambios.
   Feature autocontenida: posee su propio PDFRenderer y estado de overlay.
   ────────────────────────────────────────────────────────────────────── */
import { PDFRenderer } from '../core/pdf-renderer';

export interface CompareCtx {
  getMarkup: () => any;
  getSession: () => any;
  getCurrentPage: () => number;
  getTotalPages: () => number;
  pdfRenderer: any;                 // renderer del plano base (para saber si hay PDF cargado)
  setStatus: (msg: string) => void;
  updateScaleBadge: () => void;
}

export function createCompareRevisions(ctx: CompareCtx) {
  const $ = (id: string) => document.getElementById(id) as any;
  const renderer = new PDFRenderer();   // revisión B
  let active = false, tint = false, opacity = 0.5;

  async function renderForPage(n: number) {
    const markup = ctx.getMarkup();
    if (!markup || !renderer.isLoaded) return;
    if (n < 1 || n > renderer.numPages) { markup.clearCompareOverlay(); return; }
    const r = await renderer.renderPage(n, 3.0);
    await markup.setCompareOverlay(r.dataUrl, r.imageWidth, r.imageHeight, {
      opacity,
      tint: tint ? '#e11d48' : null,
    });
  }

  async function loadRevision(file: File) {
    ctx.setStatus('Cargando revisión B…');
    try {
      await renderer.load(file);
      active = true;
      const session = ctx.getSession();
      $('cmp-name-b').textContent = file.name;
      $('cmp-name-a').textContent = session.docName || '—';
      $('compare-bar').style.display = 'flex';
      $('btn-compare').classList.add('tb-btn-active');
      await renderForPage(ctx.getCurrentPage());
      ctx.setStatus(`Comparando · A: ${session.docName}  vs  B: ${file.name}`);
    } catch (e: any) {
      ctx.setStatus('Error al cargar revisión: ' + e.message);
      alert('No se pudo cargar la revisión:\n' + e.message);
    }
  }

  /** Cierra la comparación (quita el overlay). */
  function close() {
    active = false;
    const markup = ctx.getMarkup();
    markup && markup.clearCompareOverlay();
    $('compare-bar').style.display = 'none';
    $('btn-compare').classList.remove('tb-btn-active');
    ctx.updateScaleBadge();   // re-mostrar la escala tras quitar el overlay
    const s = ctx.getSession();
    ctx.setStatus(`Pág. ${ctx.getCurrentPage()}/${ctx.getTotalPages()}  ·  ${s.docName}`);
  }

  /** Re-renderiza el overlay al cambiar de página (lo llama goToPage). */
  function onPageChange(n: number) {
    if (active) renderForPage(n);
  }

  /** Enlaza los controles de la barra de comparación (una vez al inicio). */
  function init() {
    $('btn-compare')?.addEventListener('click', () => {
      if (!ctx.pdfRenderer.isLoaded) return;
      if (!renderer.isLoaded) {            // aún sin Rev B → cargarla
        $('compare-input').click();
      } else if (active) {                 // ya comparando → cerrar
        close();
      } else {                             // Rev B cargada → reactivar
        active = true;
        $('compare-bar').style.display = 'flex';
        $('btn-compare').classList.add('tb-btn-active');
        renderForPage(ctx.getCurrentPage());
      }
    });
    $('compare-input')?.addEventListener('change', (e: any) => {
      if (e.target.files[0]) loadRevision(e.target.files[0]);
      e.target.value = '';
    });
    $('btn-compare-close')?.addEventListener('click', close);
    $('btn-compare-change')?.addEventListener('click', () => $('compare-input').click());
    $('cmp-opacity')?.addEventListener('input', (e: any) => {
      opacity = parseInt(e.target.value, 10) / 100;
      const markup = ctx.getMarkup();
      markup && markup.setCompareOpacity(opacity);
    });
    $('cmp-tint')?.addEventListener('change', (e: any) => {
      tint = e.target.checked;
      if (active) renderForPage(ctx.getCurrentPage());
    });
  }

  return { init, close, onPageChange };
}
