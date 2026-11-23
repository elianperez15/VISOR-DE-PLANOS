/* ──────────────────────────────────────────────────────────────────────
   plan-viewer.ts — Abrir, navegar, rotar y hacer zoom sobre el plano (PDF)

   Es el dueño del documento abierto: el PDFRenderer, la sesión de marcas del
   documento y la página/rotación actuales. El resto de dominios (anotaciones,
   colaboración, comparación…) se enganchan por los hooks del `ctx`, de modo
   que este módulo no conoce a ninguno.
   ────────────────────────────────────────────────────────────────────── */
import { API_PDF } from '../app/config';
import { setStatus } from '../compartido/ui/status-bar';
import type { MarkupLayer } from '../anotaciones/lienzo/markup-layer';
import { PDFRenderer } from './pdf-renderer';
import { documentHeaders } from './plans-api';
import {
  hidePlanoLoader, hideViewerNotice, noticeFromError, showPlanoLoader, showViewerNotice,
} from './viewer-notice';

const PDF_RENDER_SUPERSAMPLE = 3.0;   // factor de supermuestreo al rasterizar el PDF

/** Sesión de marcado del documento abierto. */
export interface PlanSession {
  docId: string | null;                 // id_en_repositorio (TEXTO: puede traer ceros al inicio)
  docName: string;
  pages: Record<string, string>;        // JSON de las marcas, por página
  pageHeights: Record<string, number>;  // alto lógico de cada página (puntos PDF)
  scale: any;                           // escala calibrada (ver mediciones/calibration)
  rotation: number;                     // orientación guardada: 0 | 90 | 180 | 270
}

export interface PlanViewerCtx {
  /** Crea el lienzo de marcas para el documento recién abierto (descarta el anterior). */
  createMarkup(): MarkupLayer;
  getMarkup(): MarkupLayer | null;
  /** Se va a montar otro documento: limpiar lo que dependía del anterior. */
  onDocumentClosing(): void;
  /** Documento listo en pantalla (conectar a la sala, traer las marcas guardadas). */
  onDocumentOpened(): void;
  onBeforePageChange(): void;
  /** Fondo ya pintado, justo antes de restaurar las marcas de la página. */
  onBeforeShowPage(): void;
  /** Marcas de la página `n` ya restauradas. */
  onPageShown(n: number): void;
  /** El usuario giró la vista (las marcas ya se transformaron). */
  onRotated(): void;
}

export function createPlanViewer(ctx: PlanViewerCtx) {
  const $ = (id: string) => document.getElementById(id) as any;
  const pdfRenderer = new PDFRenderer();
  const session: PlanSession = { docId: null, docName: '', pages: {}, pageHeights: {}, scale: null, rotation: 0 };
  let currentPage = 1;
  let totalPages  = 0;
  let rotation    = 0;   // giro de vista (en memoria hasta pulsar Guardar): 0 | 90 | 180 | 270
  let openSeq     = 0;   // si llegan dos aperturas seguidas, sólo cuenta la última

  /**
   * Abre un PDF desde una URL. Lo usan la integración con APEX (postMessage
   * { action:'openPDF' | 'init' }) y el parámetro ?pdf=...&docId=... del iframe.
   */
  async function openFromUrl(url: string, docId: unknown, name?: string | null, httpHeaders: Record<string, string> | null = null) {
    if (!url) return;
    const seq = ++openSeq;
    const superseded = () => seq !== openSeq;
    setStatus('Cargando PDF…');
    showPlanoLoader(name ? `Cargando ${name}…` : 'Cargando plano…');
    try {
      const { numPages } = await pdfRenderer.load(url, httpHeaders);
      totalPages = numPages;
      // id_en_repositorio es TEXTO (puede traer ceros al inicio): NO convertir a Number
      session.docId       = (docId != null && String(docId).trim() !== '') ? String(docId).trim() : null;
      session.docName     = name || url.split('/').pop() || 'documento.pdf';
      session.pages       = {};
      session.pageHeights = {};
      rotation            = 0;   // cada documento arranca sin rotar
      session.rotation    = 0;   // (se restaura desde el servidor si existe)
      ctx.onDocumentClosing();
      hideViewerNotice();
      $('canvas-wrapper').style.display = 'flex';
      const markup = ctx.createMarkup();
      markup.onZoomChange  = zoom => { $('zoom-info').textContent = `${Math.round(zoom * 100)}%`; };
      // Zoom profundo: re-render dinámico de la región visible (tipo Procore)
      markup.requestRegion = (rect, density) => pdfRenderer.renderRegion(currentPage, rect, density, rotation);
      setControlsEnabled(true);
      await goToPage(1);
      if (superseded()) return;
      ctx.onDocumentOpened();
      setStatus('');
    } catch (e) {
      // Otra apertura más reciente la canceló: su error no le importa al usuario
      if (superseded()) return;
      console.error('Abrir plano:', e);   // el diagnóstico completo, para soporte
      const [reason, technical] = noticeFromError(e);
      // En la barra de estado sólo cabe —y sólo sirve— la frase legible.
      setStatus('Error: ' + reason);
      showViewerNotice(reason, technical);
    } finally {
      if (!superseded()) hidePlanoLoader();   // el loader ya es de la apertura nueva
    }
  }

  /** Abre un plano del repositorio por su id (el endpoint ORDS 'documento' devuelve el PDF). */
  function openFromRepo(repoId: unknown, name?: string | null) {
    if (repoId == null || repoId === '') return;
    openFromUrl(API_PDF, repoId, name, documentHeaders(repoId as string, name));
  }

  async function goToPage(n: number) {
    const markup = ctx.getMarkup();
    if (!pdfRenderer.isLoaded || n < 1 || n > totalPages) return;
    ctx.onBeforePageChange();
    if (markup) session.pages[currentPage] = markup.getMarkupJSON();
    currentPage = n;
    setStatus('Renderizando…');
    const r = await pdfRenderer.renderPage(n, PDF_RENDER_SUPERSAMPLE, rotation);
    session.pageHeights[n] = r.logicalHeight;
    await markup.setBackground(r.dataUrl, r.imageWidth, r.imageHeight, r.logicalWidth, r.logicalHeight);
    ctx.onBeforeShowPage();
    markup.setMarkupJSON(session.pages[n] || null);
    ctx.onPageShown(n);
    setStatus('');
  }

  /* Rota la vista 90° a derecha (horario) o izquierda (antihorario). Gira el
     fondo re-renderizándolo con PDF.js y las marcas con la misma
     transformación, para que sigan alineadas sobre el plano. */
  async function rotate(clockwise = true) {
    const markup = ctx.getMarkup();
    if (!pdfRenderer.isLoaded || !markup) return;
    rotation = (rotation + (clockwise ? 90 : 270)) % 360;
    session.rotation = rotation;        // se guardará al pulsar Guardar
    markup.rotateContent(clockwise);    // usa las dimensiones lógicas ACTUALES (previas)
    setStatus('Rotando…');
    const r = await pdfRenderer.renderPage(currentPage, PDF_RENDER_SUPERSAMPLE, rotation);
    session.pageHeights[currentPage] = r.logicalHeight;
    await markup.setBackground(r.dataUrl, r.imageWidth, r.imageHeight, r.logicalWidth, r.logicalHeight);
    ctx.onRotated();
    setStatus('');
  }

  /** Restaura la orientación guardada: re-renderiza el fondo con esa rotación
      (las marcas ya vienen guardadas en ese espacio de coordenadas). */
  function applySavedRotation(deg: number) {
    const target = ((deg % 360) + 360) % 360;
    if (target === rotation) return;
    rotation = target;
    goToPage(currentPage);
  }

  /** Habilita los controles que requieren un documento abierto. */
  function setControlsEnabled(on: boolean) {
    ['btn-rotate-left', 'btn-rotate-right', 'btn-zoom-in', 'btn-zoom-out', 'btn-fit',
     'btn-calibrate', 'btn-clear', 'btn-save-marks', 'btn-download-doc', 'btn-compare', 'btn-snapshot']
      .forEach(id => { const el = $(id); if (el) el.disabled = !on; });
    $('btn-undo').disabled = true;
    $('btn-redo').disabled = true;
  }

  /** Enlaza zoom y rotación (una vez al inicio). */
  function init() {
    $('btn-zoom-in') .addEventListener('click', () => ctx.getMarkup()?.zoomStep(1));
    $('btn-zoom-out').addEventListener('click', () => ctx.getMarkup()?.zoomStep(-1));
    $('btn-fit')     .addEventListener('click', () => ctx.getMarkup()?.fitToCanvas());
    $('btn-rotate-left') .addEventListener('click', () => rotate(false));
    $('btn-rotate-right').addEventListener('click', () => rotate(true));
  }

  return {
    pdfRenderer,
    session,
    getCurrentPage: () => currentPage,
    getTotalPages : () => totalPages,
    getRotation   : () => rotation,
    openFromUrl, openFromRepo, goToPage, rotate, applySavedRotation, init,
  };
}

export type PlanViewer = ReturnType<typeof createPlanViewer>;
