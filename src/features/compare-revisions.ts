/* ──────────────────────────────────────────────────────────────────────
   compare-revisions.ts — Comparación de revisiones (overlay Rev B sobre A)

   Carga un segundo PDF (revisión B) y lo superpone, semitransparente y con
   tinte opcional, sobre el plano actual (revisión A) para detectar cambios.
   La revisión B puede venir del repositorio (URL del API) o de un PDF del
   equipo del usuario (input de archivo / arrastrar y soltar en el selector).
   Feature autocontenida: posee su propio PDFRenderer y estado de overlay.

   RENDIMIENTO: el rasterizado de los PDF (lo caro) se cachea por página en
   un único slot. Los cambios de alineación/offset/opacidad reutilizan ese
   ráster y sólo recalculan el diff (bucle de píxeles), sin volver a rasterizar.
   Un contador de secuencia descarta los renders obsoletos, de modo que los
   cambios rápidos no se acumulan ni "traban" la interfaz.
   ────────────────────────────────────────────────────────────────────── */
import { PDFRenderer } from '../core/pdf-renderer';
import { renderIcons } from '../ui/icons';

export interface CompareCtx {
  getMarkup: () => any;
  getSession: () => any;
  getCurrentPage: () => number;
  getTotalPages: () => number;
  pdfRenderer: any;                 // renderer del plano base (para saber si hay PDF cargado)
  setStatus: (msg: string) => void;
  updateScaleBadge: () => void;
  onPickRevision?: () => void;      // abre el selector de plano (BD) para elegir la revisión
  closeRevisionPicker?: () => void; // cierra ese selector (al elegir un PDF del equipo)
  showHint?: (msg: string, persist?: boolean) => void;   // guía flotante visible
  downloadImage?: (dataUrl: string, filename: string) => void;   // descarga un PNG (APEX o directo)
  startRegionSnapshot?: (baseName: string) => void;   // captura por selección (features/region-snapshot)
  cancelRegionSnapshot?: () => void;                 // aborta la captura en curso
}

interface PageRaster {
  n: number;
  w: number; h: number;
  aData: ImageData;    // ráster de A (downscaled a w×h)
  bData: ImageData;    // ráster de B (downscaled a w×h, en el origen)
  logicalWidth: number;
  bRender: any;        // render crudo de B (full-res) para el modo "ajustar"
}

export function createCompareRevisions(ctx: CompareCtx) {
  const $ = (id: string) => document.getElementById(id) as any;
  const renderer = new PDFRenderer();   // revisión comparada (B)
  let active = false;
  const OPACITY = 1;                     // resaltado de diferencias a plena intensidad
  let aligning = false;                  // modo "Ajustar": overlay arrastrable
  let offsetX = 0, offsetY = 0;          // desplazamiento de B (unidades del plano)

  let raster: PageRaster | null = null;  // caché del ráster de la página actual
  let renderSeq = 0;                     // secuencia: descarta renders obsoletos
  let renderTimer: any = null;           // debounce de peticiones rápidas

  const INK_THRESHOLD = 165;            // luminancia < umbral = "tinta" (línea del plano)
  const COLOR_ONLY_A  = [37, 99, 235];  // azul → solo en el plano ACTUAL (A)
  const COLOR_ONLY_B  = [225, 29, 72];  // rojo → solo en la revisión COMPARADA (B)
  const COLOR_SAME    = [155, 160, 168];// gris → sin cambios (contexto)
  const MAX_DIM       = 2600;           // lado máximo del espacio de diff

  /** Refleja en el botón si estás ajustando (✓ Aplicar) o no (⤧ Ajustar). */
  function updateAlignBtn() {
    const b = $('btn-compare-align');
    if (!b) return;
    b.classList.toggle('tb-btn-active', aligning);
    b.innerHTML = aligning ? '<i data-lucide="check"></i>' : '<i data-lucide="move"></i>';
    b.title = aligning ? 'Aplicar alineación (listo)' : 'Ajustar alineación — arrastra la revisión';
    renderIcons(b);
  }

  /** Muestra/oculta el loader ligero y bloquea la barra mientras calcula. */
  function showLoading(on: boolean) {
    const el = $('compare-loading');
    if (el) el.style.display = on ? 'flex' : 'none';
    const bar = $('compare-bar');
    if (bar) bar.classList.toggle('is-busy', on);
  }

  /** ¿El archivo elegido es un PDF? (algunos navegadores no rellenan `type`). */
  function isPdfFile(f: File) {
    return f.type === 'application/pdf' || /\.pdf$/i.test(f.name || '');
  }

  function loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = url; });
  }
  function offscreen(w: number, h: number) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    return { canvas: c, ctx: c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D };
  }

  /** Rasteriza A y B para la página `n` y cachea el resultado (una sola vez por página). */
  async function getPageRaster(n: number): Promise<PageRaster> {
    if (raster && raster.n === n) return raster;
    const SS = 2.0;
    // Rasterizar ambos PDF en paralelo (lo más caro; se hace una vez por página)
    const [aRender, bRender] = await Promise.all([
      ctx.pdfRenderer.renderPage(n, SS, 0),
      renderer.renderPage(n, SS, 0),
    ]);
    let w = Math.min(aRender.imageWidth, bRender.imageWidth);
    let h = Math.min(aRender.imageHeight, bRender.imageHeight);
    const s = Math.min(1, MAX_DIM / Math.max(w, h));
    w = Math.max(1, Math.round(w * s)); h = Math.max(1, Math.round(h * s));
    const [ia, ib] = await Promise.all([loadImage(aRender.dataUrl), loadImage(bRender.dataUrl)]);
    const ca = offscreen(w, h), cb = offscreen(w, h);
    ca.ctx.drawImage(ia, 0, 0, w, h);
    cb.ctx.drawImage(ib, 0, 0, w, h);
    raster = {
      n, w, h,
      aData: ca.ctx.getImageData(0, 0, w, h),
      bData: cb.ctx.getImageData(0, 0, w, h),
      logicalWidth: aRender.logicalWidth || w,
      bRender,
    };
    return raster;
  }

  /** Calcula la imagen de DIFERENCIAS a partir de rásters ya cacheados (estilo Procore).
      B se muestrea con desplazamiento (offX/offY px) para alinear las revisiones —
      sin volver a dibujar en canvas: sólo un desplazamiento de índice en el bucle. */
  function computeDiffDataUrl(A: ImageData, B: ImageData, w: number, h: number, offX: number, offY: number) {
    const co = offscreen(w, h);
    const out = co.ctx.createImageData(w, h);
    const ad = A.data, bd = B.data, O = out.data;
    for (let y = 0; y < h; y++) {
      const by = y - offY;
      const bRow = by >= 0 && by < h ? by * w : -1;
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const la = ad[i] * 0.299 + ad[i + 1] * 0.587 + ad[i + 2] * 0.114;
        const inkA = la < INK_THRESHOLD;
        let inkB = false;
        const bx = x - offX;
        if (bRow >= 0 && bx >= 0 && bx < w) {
          const j = (bRow + bx) * 4;
          const lb = bd[j] * 0.299 + bd[j + 1] * 0.587 + bd[j + 2] * 0.114;
          inkB = lb < INK_THRESHOLD;
        }
        let col: number[] | null = null;
        if (inkA && inkB)       col = COLOR_SAME;
        else if (inkA && !inkB) col = COLOR_ONLY_A;   // solo en el actual → azul
        else if (!inkA && inkB) col = COLOR_ONLY_B;   // solo en la comparada → rojo
        if (col) { O[i] = col[0]; O[i + 1] = col[1]; O[i + 2] = col[2]; O[i + 3] = 255; }
        else     { O[i] = O[i + 1] = O[i + 2] = 255; O[i + 3] = 255; }   // fondo blanco
      }
    }
    co.ctx.putImageData(out, 0, 0);
    return co.canvas.toDataURL('image/png');
  }

  /** Punto de entrada de render: gestiona loader + secuencia y delega en diff/align. */
  async function renderForPage(n: number) {
    const markup = ctx.getMarkup();
    if (!markup || !renderer.isLoaded) return;
    if (n < 1 || n > renderer.numPages) { markup.clearCompareOverlay(); return; }
    const seq = ++renderSeq;   // toda petición previa aún en vuelo queda obsoleta
    showLoading(true);
    try {
      if (aligning) await renderAlign(n, seq);
      else          await renderDiff(n, seq);
    } catch (e) {
      console.error('Error al comparar revisiones:', e);
    } finally {
      if (seq === renderSeq) showLoading(false);   // sólo oculta si nadie lo reemplazó
    }
  }

  /** Modo diferencias: overlay coloreado (no interactivo), con el offset aplicado. */
  async function renderDiff(n: number, seq: number) {
    ctx.setStatus('Comparando revisiones…');
    const r = await getPageRaster(n);
    if (seq !== renderSeq) return;   // otra petición lo reemplazó → descartar
    const pxPerUnit = r.w / (r.logicalWidth || r.w);
    const offX = Math.round(offsetX * pxPerUnit);
    const offY = Math.round(offsetY * pxPerUnit);
    const diffUrl = computeDiffDataUrl(r.aData, r.bData, r.w, r.h, offX, offY);
    if (seq !== renderSeq) return;
    await ctx.getMarkup().setCompareOverlay(diffUrl, r.w, r.h, { opacity: OPACITY, tint: null });
    ctx.setStatus('');
    ctx.showHint && ctx.showHint('');   // ocultar la guía de ajuste
  }

  /** Modo ajustar: muestra la revisión comparada semitransparente y ARRASTRABLE. */
  async function renderAlign(n: number, seq: number) {
    const markup = ctx.getMarkup();
    const r = await getPageRaster(n);
    if (seq !== renderSeq) return;
    markup.setTool && markup.setTool('select');   // para poder arrastrar el overlay
    const b = r.bRender;
    await markup.setCompareOverlay(b.dataUrl, b.imageWidth, b.imageHeight, {
      opacity: 0.55,
      interactive: true,
      offsetX, offsetY,
      onMove: (left: number, top: number) => { offsetX = left; offsetY = top; },
    });
    ctx.showHint && ctx.showHint('Arrastra la revisión o usa las flechas del teclado (Shift = paso mayor) · pulsa ✓ para aplicar', true);
  }

  /** Re-render con debounce: coalesce ráfagas de cambios (páginas, offset, reset). */
  function scheduleRender(n: number) {
    if (renderTimer) clearTimeout(renderTimer);
    renderTimer = setTimeout(() => { renderTimer = null; renderForPage(n); }, 90);
  }

  function setRevNames(nameB: string) {
    const session = ctx.getSession();
    const a = $('cmp-name-a'), b = $('cmp-name-b');
    if (a) { a.textContent = session.docName || '—'; a.title = session.docName || ''; }
    if (b) { b.textContent = nameB || '—'; b.title = nameB || ''; }
  }

  /** Carga la revisión a comparar y activa el overlay.
      `source` es una URL del API (con headers) o un File del equipo del usuario. */
  async function loadRevision(source: string | File, httpHeaders: any, name: string) {
    ctx.setStatus('Cargando revisión…');
    showLoading(true);
    try {
      offsetX = 0; offsetY = 0; aligning = false;
      raster = null;                 // invalidar caché: es otra revisión
      updateAlignBtn();
      await renderer.load(source, httpHeaders);
      active = true;
      setRevNames(name);
      $('compare-bar').style.display = 'flex';
      $('btn-compare').classList.add('tb-btn-active');
      await renderForPage(ctx.getCurrentPage());
      ctx.setStatus('');
    } catch (e: any) {
      ctx.setStatus('Error al cargar revisión: ' + e.message);
      alert('No se pudo cargar la revisión:\n' + e.message);
    } finally {
      showLoading(false);
    }
  }

  /** Carga la revisión a comparar desde la BD (URL del API + headers), como en hipervínculos. */
  function loadRevisionUrl(url: string, httpHeaders: any, name: string) {
    return loadRevision(url, httpHeaders, name);
  }

  /** Carga la revisión a comparar desde un PDF del equipo del usuario. */
  function loadRevisionFile(file: File) {
    if (!file) return;
    if (!ctx.pdfRenderer.isLoaded) {
      alert('Abre primero un plano en el visor para poder compararlo.');
      return;
    }
    if (!isPdfFile(file)) {
      alert('Sólo se puede comparar con archivos PDF.');
      return;
    }
    return loadRevision(file, null, file.name);
  }

  /** Cierra la comparación (quita el overlay). */
  function close() {
    active = false;
    aligning = false;
    offsetX = 0; offsetY = 0;
    raster = null;                   // liberar caché de rásters
    renderSeq++;                     // invalidar cualquier render en vuelo
    if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
    showLoading(false);
    closeDlMenu();
    ctx.cancelRegionSnapshot && ctx.cancelRegionSnapshot();   // recorte en curso, si hay
    const markup = ctx.getMarkup();
    markup && markup.clearCompareOverlay();
    $('compare-bar').style.display = 'none';
    $('btn-compare').classList.remove('tb-btn-active');
    updateAlignBtn();
    ctx.showHint && ctx.showHint('');
    ctx.updateScaleBadge();   // re-mostrar la escala tras quitar el overlay
    const s = ctx.getSession();
    ctx.setStatus(`Pág. ${ctx.getCurrentPage()}/${ctx.getTotalPages()}  ·  ${s.docName}`);
  }

  /** Re-renderiza el overlay al cambiar de página (lo llama goToPage). */
  function onPageChange(n: number) {
    if (active) scheduleRender(n);
  }

  /** Cierra el menú de descarga (si está abierto). */
  function closeDlMenu() { const m = $('cmp-dl-menu'); if (m) m.classList.remove('open'); }

  /** Nombre base para las imágenes exportadas de la comparación. */
  function exportBaseName() {
    return (ctx.getSession().docName || 'plano').replace(/\.pdf$/i, '');
  }

  /** Descarga el plano completo (con el resaltado de diferencias) como PNG. */
  function downloadFull() {
    const markup = ctx.getMarkup();
    if (!markup || !ctx.downloadImage) return;
    try {
      const url = markup.exportDocument(3);
      ctx.downloadImage(url, `${exportBaseName()}_comparacion_p${ctx.getCurrentPage()}.png`);
    } catch (e) { console.error('Descarga de comparación:', e); }
  }

  /** Descarga un área del plano: lo gestiona la feature de captura por selección
      (dibujar → ajustar → confirmar), que es la dueña de la barra #region-bar. */
  function downloadRegion() {
    ctx.startRegionSnapshot &&
      ctx.startRegionSnapshot(`${exportBaseName()}_area_p${ctx.getCurrentPage()}`);
  }

  /** Enlaza los controles de la barra de comparación (una vez al inicio). */
  function init() {
    $('btn-compare')?.addEventListener('click', () => {
      if (!ctx.pdfRenderer.isLoaded) return;
      if (!renderer.isLoaded) {            // aún sin revisión → elegirla de la BD
        ctx.onPickRevision && ctx.onPickRevision();
      } else if (active) {                 // ya comparando → cerrar
        close();
      } else {                             // revisión cargada → reactivar
        active = true;
        $('compare-bar').style.display = 'flex';
        $('btn-compare').classList.add('tb-btn-active');
        renderForPage(ctx.getCurrentPage());
      }
    });
    $('btn-compare-close')?.addEventListener('click', close);
    // Carpeta → cambiar el plano a comparar (abre el selector de la BD)
    $('btn-compare-folder')?.addEventListener('click', () => ctx.onPickRevision && ctx.onPickRevision());

    /* ── Comparar contra un PDF del equipo del usuario ──
       Zona del selector: clic para elegir el archivo, o arrastrarlo encima. */
    const fileIn = $('compare-file-input');
    const drop   = $('cmp-drop');
    /** Cierra el selector y arranca la comparación con el archivo elegido.
        Si no es un PDF, avisa y deja el selector abierto para reintentar. */
    const useLocalFile = (f: File) => {
      if (!isPdfFile(f)) { alert('Sólo se puede comparar con archivos PDF.'); return; }
      ctx.closeRevisionPicker && ctx.closeRevisionPicker();
      loadRevisionFile(f);
    };
    drop?.addEventListener('click', () => fileIn && fileIn.click());
    fileIn?.addEventListener('change', (e: any) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';                 // permite volver a elegir el MISMO archivo
      if (f) useLocalFile(f);
    });
    // Arrastrar y soltar. Se escucha en todo el modal para que un "casi acierto"
    // no haga que el navegador abra el PDF y se pierda la sesión del visor.
    const dropZone = drop && (drop.closest('.modal-overlay') || drop);
    if (drop && dropZone) {
      const over = (on: boolean) => drop.classList.toggle('is-over', on);
      dropZone.addEventListener('dragover', (e: any) => { e.preventDefault(); over(true); });
      dropZone.addEventListener('dragleave', (e: any) => {
        if (!dropZone.contains(e.relatedTarget)) over(false);
      });
      dropZone.addEventListener('drop', (e: any) => {
        e.preventDefault();
        over(false);
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) useLocalFile(f);
      });
    }
    // Ajustar alineación: alterna entre arrastrar la revisión y ver las diferencias.
    // Al estar activo, el botón muestra ✓ (Aplicar): al pulsarlo se confirma la posición.
    $('btn-compare-align')?.addEventListener('click', () => {
      if (!active) return;
      aligning = !aligning;
      updateAlignBtn();
      renderForPage(ctx.getCurrentPage());
    });
    // Reiniciar la alineación (offset a 0)
    $('btn-compare-align-reset')?.addEventListener('click', () => {
      offsetX = 0; offsetY = 0;
      if (active) scheduleRender(ctx.getCurrentPage());
    });

    // Descargar como imagen: menú con "plano completo" y "seleccionar área"
    $('btn-compare-download')?.addEventListener('click', (e: any) => {
      e.stopPropagation();
      const m = $('cmp-dl-menu'); if (m) m.classList.toggle('open');
    });
    $('btn-dl-full')?.addEventListener('click', () => { closeDlMenu(); downloadFull(); });
    $('btn-dl-region')?.addEventListener('click', () => { closeDlMenu(); downloadRegion(); });
    document.addEventListener('click', () => closeDlMenu());   // cerrar al clic fuera

    // (Confirmar / cancelar el recorte lo enlaza features/region-snapshot)

    // Ajuste con flechas del teclado (solo en modo "Ajustar")
    document.addEventListener('keydown', (e) => {
      if (!active || !aligning) return;
      const tag = document.activeElement && document.activeElement.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const step = e.shiftKey ? 10 : 1;
      let dx = 0, dy = 0;
      if      (e.key === 'ArrowLeft')  dx = -step;
      else if (e.key === 'ArrowRight') dx =  step;
      else if (e.key === 'ArrowUp')    dy = -step;
      else if (e.key === 'ArrowDown')  dy =  step;
      else return;
      e.preventDefault();
      const markup = ctx.getMarkup();
      const pos = markup && markup.nudgeCompareOverlay && markup.nudgeCompareOverlay(dx, dy);
      if (pos) { offsetX = pos.left; offsetY = pos.top; }
    });
  }

  return { init, close, onPageChange, loadRevisionUrl, loadRevisionFile };
}
