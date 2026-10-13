/* ──────────────────────────────────────────────────────────────────────
   compare-revisions.ts — Comparación de revisiones (overlay Rev B sobre A)

   Carga un segundo PDF (revisión B) y lo superpone, semitransparente y con
   tinte opcional, sobre el plano actual (revisión A) para detectar cambios.
   La revisión B siempre sale del repositorio (URL del API): el visor no abre
   archivos que no estén en el file server.
   Feature autocontenida: posee su propio PDFRenderer y estado de overlay.

   RESOLUCIÓN: el diff de página completa se calcula sobre un ráster acotado
   (MAX_DIM), suficiente para ver la hoja entera. Para mirar EL DETALLE, la
   feature publica `markup.requestCompareRegion`: al acercar el zoom, la capa de
   markup pide el diff de SOLO la región visible y éste se re-calcula a la
   resolución física de la pantalla (mismo enfoque de tiles que usa el plano
   base). Así el detalle no lo limita el ráster de página completa: se puede
   bajar hasta la cota de una línea y seguir viéndola nítida.

   RENDIMIENTO: el rasterizado de los PDF (lo caro) se cachea por página en
   un único slot. Los cambios de alineación/offset/opacidad reutilizan ese
   ráster y sólo recalculan el diff (bucle de píxeles), sin volver a rasterizar.
   Un contador de secuencia descarta los renders obsoletos, de modo que los
   cambios rápidos no se acumulan ni "traban" la interfaz. Los rásters viajan
   como <canvas>, nunca como data URL: codificar un PNG de decenas de
   megapíxeles cuesta más que el propio diff.
   ────────────────────────────────────────────────────────────────────── */
import { PDFRenderer } from '../core/pdf-renderer';
import { renderIcons } from '../ui/icons';

export interface CompareCtx {
  getMarkup: () => any;
  getSession: () => any;
  getCurrentPage: () => number;
  getTotalPages: () => number;
  pdfRenderer: any;                 // renderer del plano base (para saber si hay PDF cargado)
  getRotation?: () => number;       // giro de vista aplicado al plano base (0|90|180|270)
  setStatus: (msg: string) => void;
  updateScaleBadge: () => void;
  onPickRevision?: () => void;      // abre el selector de plano (BD) para elegir la revisión
  showHint?: (msg: string, persist?: boolean) => void;   // guía flotante visible
  downloadImage?: (dataUrl: string, filename: string) => void;   // descarga un PNG (APEX o directo)
  startRegionSnapshot?: (baseName: string) => void;   // captura por selección (features/region-snapshot)
  cancelRegionSnapshot?: () => void;                 // aborta la captura en curso
}

interface PageRaster {
  n: number;
  rot: number;         // rotación con la que se rasterizó (invalida la caché al girar)
  w: number; h: number;
  aData: ImageData;    // ráster de A en el espacio de diff (w×h)
  bData: ImageData;    // ráster de B remapeado a ese mismo espacio, en el origen
  logicalWidth: number;    // ancho lógico de A (puntos PDF)
  logicalHeight: number;
  bLogicalWidth: number;   // ancho lógico de B — su relación con A mapea las regiones
  bLogicalHeight: number;
}

export function createCompareRevisions(ctx: CompareCtx) {
  const $ = (id: string) => document.getElementById(id) as any;
  const renderer = new PDFRenderer();   // revisión comparada (B)
  let active = false;
  const OPACITY = 1;                     // resaltado de diferencias a plena intensidad
  const ALIGN_OPACITY = 0.55;            // transparencia de la revisión al ajustarla
  let aligning = false;                  // modo "Ajustar": overlay arrastrable
  let offsetX = 0, offsetY = 0;          // desplazamiento de B (unidades del plano)

  let raster: PageRaster | null = null;  // caché del ráster de la página actual
  let renderSeq = 0;                     // secuencia: descarta renders obsoletos
  let renderTimer: any = null;           // debounce de peticiones rápidas

  /* Qué cuenta como "tinta". Se mide como CANTIDAD de tinta (255 − luminancia),
     no como un sí/no sobre un gris medio: un plano de CAD está lleno de trazos
     finos y de líneas en gris claro (mobiliario, sanitarios, rayados), y una
     línea más delgada que un píxel se suaviza hasta un gris muy claro. Con el
     listón alto, todo eso se descartaba antes de comparar y no aparecía. */
  const INK_MIN    = 12;   // cantidad mínima para considerar que hay trazo (≈ lum. 243)
  const INK_FULL   = 160;  // cantidad a partir de la cual el color va a plena intensidad
  const DIFF_BOOST = 3;    // realce de las diferencias tenues (para que no pasen inadvertidas)
  const DIFF_FLOOR = 0.55; // tope de ese realce
  const COLOR_ONLY_A  = [37, 99, 235];  // azul → solo en el plano ACTUAL (A)
  const COLOR_ONLY_B  = [225, 29, 72];  // rojo → solo en la revisión COMPARADA (B)
  const COLOR_SAME    = [155, 160, 168];// gris → sin cambios (contexto)
  /* Lado máximo del ráster de PÁGINA COMPLETA. No limita el detalle: al acercar
     el zoom entra el tile de región (renderCompareRegion), que se calcula a la
     resolución de la pantalla. Este valor sólo fija la nitidez de la vista de
     hoja entera y de la exportación de la página completa. */
  const MAX_DIM       = 4000;
  /* Tope de sobre-muestreo del ráster de página completa respecto al tamaño
     lógico. Evita rasterizar una hoja pequeña (A4) a una escala absurda. */
  const MAX_PAGE_SS   = 6;
  /* Tope del lado de un tile de detalle. */
  const MAX_TILE_DIM  = 6000;
  /* Tope de PÍXELES de un tile. Manda más que el tope de lado: el coste de un
     tile es su área, y en la comparación esa área se paga cinco veces (dos
     rasterizados de PDF, dos lecturas de píxeles y el bucle del diff). Sin este
     techo, una ventana grande con devicePixelRatio 2 pide del orden de 18 Mpx
     por tile y el detalle tarda segundos en aparecer. Al pasarse, se baja la
     densidad: se pierde algo de nitidez en pantallas muy grandes, pero el
     detalle entra enseguida — que es lo que se nota. */
  const MAX_TILE_PX   = 9_000_000;

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

  /** Giro de vista activo en el visor (el overlay debe rasterizarse igual). */
  function rot() { return (ctx.getRotation && ctx.getRotation()) || 0; }

  /** Canvas fuera de pantalla. `readback` avisa de que se va a leer con
      getImageData: sin esa pista el navegador lo respalda en GPU y cada lectura
      obliga a traérselo de vuelta. El canvas de SALIDA no se lee (sólo se pinta
      y luego se dibuja en pantalla), así que ahí la pista sobra. */
  function offscreen(w: number, h: number, readback = false) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const o: any = readback ? { willReadFrequently: true } : {};
    return { canvas: c, ctx: c.getContext('2d', o) as CanvasRenderingContext2D };
  }

  /** Rasteriza A y B para la página `n` y cachea el resultado (una sola vez por página).

      Se consulta primero el tamaño lógico de ambas páginas para rasterizar a la
      escala EXACTA del espacio de diff. Antes se rasterizaba en grande y se
      reducía con drawImage: esa reducción difumina las líneas finas justo antes
      de aplicar el umbral de tinta, que es lo que más daño hacía a la nitidez. */
  async function getPageRaster(n: number): Promise<PageRaster> {
    const rotation = rot();
    if (raster && raster.n === n && raster.rot === rotation) return raster;

    const [aSize, bSize] = await Promise.all([
      ctx.pdfRenderer.getPageSize(n, rotation),
      renderer.getPageSize(n, rotation),
    ]);
    // El espacio de diff es el de A: el overlay se escala a la hoja del plano actual
    const ss = Math.min(MAX_PAGE_SS, MAX_DIM / Math.max(aSize.w, aSize.h));
    const w  = Math.max(1, Math.round(aSize.w * ss));
    const h  = Math.max(1, Math.round(aSize.h * ss));

    // Rasterizar ambos PDF en paralelo (lo más caro; se hace una vez por página).
    // B se pide al ancho del espacio de diff: así se estira a la hoja de A igual
    // que hacía la versión anterior, pero sin pasar por un ráster intermedio.
    const [aRender, bRender] = await Promise.all([
      ctx.pdfRenderer.renderPage(n, 0, rotation, { scale: ss, raw: true }),
      renderer.renderPage(n, 0, rotation, { scale: w / bSize.w, raw: true }),
    ]);

    // Normalizar ambos al mismo w×h exacto (absorbe el redondeo y, si las hojas
    // no tienen la misma proporción, el ajuste vertical).
    const ca = offscreen(w, h, true), cb = offscreen(w, h, true);
    ca.ctx.drawImage(aRender.canvas, 0, 0, w, h);
    cb.ctx.drawImage(bRender.canvas, 0, 0, w, h);

    raster = {
      n, rot: rotation, w, h,
      aData: ca.ctx.getImageData(0, 0, w, h),
      bData: cb.ctx.getImageData(0, 0, w, h),
      logicalWidth : aRender.logicalWidth  || w,
      logicalHeight: aRender.logicalHeight || h,
      bLogicalWidth : bRender.logicalWidth  || w,
      bLogicalHeight: bRender.logicalHeight || h,
    };
    return raster;
  }

  /** Empaqueta un color RGB en el entero que espera un Uint32Array sobre ImageData.
      El orden de bytes depende de la máquina, así que se escribe por bytes. */
  function packRGB(c: number[]) {
    const probe = new Uint8ClampedArray(4);
    const view  = new Uint32Array(probe.buffer);
    probe[0] = c[0]; probe[1] = c[1]; probe[2] = c[2]; probe[3] = 255;
    return view[0];
  }
  const PX_BG = packRGB([255, 255, 255]);

  /** Tabla de 256 colores ya empaquetados, indexada por la cantidad de tinta.
      Así el plano conserva su jerarquía —un muro sale rotundo y una línea de
      mobiliario sale tenue, como en el original— sin pagar ninguna cuenta por
      píxel: el bucle del diff se queda en una consulta a tabla.
      `boost` sólo se aplica a las DIFERENCIAS: un cambio en una línea tenue
      tiene que verse, pero un contexto tenue debe quedarse tenue. */
  function buildInkLut(color: number[], boost: boolean) {
    const lut   = new Uint32Array(256);
    const probe = new Uint8ClampedArray(4);
    const view  = new Uint32Array(probe.buffer);
    for (let t = 0; t < 256; t++) {
      let a = Math.min(1, t / INK_FULL);
      // Realce proporcional, no un mínimo fijo: un suelo plano convertiría el
      // ruido de fondo de un plano escaneado en una mancha de color a toda página.
      if (boost) a = Math.max(a, Math.min(DIFF_FLOOR, a * DIFF_BOOST));
      probe[0] = 255 + (color[0] - 255) * a;
      probe[1] = 255 + (color[1] - 255) * a;
      probe[2] = 255 + (color[2] - 255) * a;
      probe[3] = 255;
      lut[t] = view[0];
    }
    return lut;
  }
  const LUT_SAME   = buildInkLut(COLOR_SAME,   false);
  const LUT_ONLY_A = buildInkLut(COLOR_ONLY_A, true);
  const LUT_ONLY_B = buildInkLut(COLOR_ONLY_B, true);

  /** Calcula la imagen de DIFERENCIAS a partir de dos rásters del mismo tamaño
      (estilo Procore) y devuelve el <canvas> resultante — sin codificar a PNG.
      Cada píxel se colorea según DÓNDE hay trazo (azul/rojo/gris) y con qué
      intensidad lo hay, de modo que el dibujo conserva su jerarquía original.
      B se muestrea con desplazamiento (offX/offY px) para alinear las revisiones:
      sin volver a dibujar en canvas, sólo un desplazamiento de índice en el bucle.

      El bucle escribe la salida como Uint32 (un store por píxel en vez de cuatro);
      a estas resoluciones la diferencia se nota. */
  function computeDiffCanvas(A: ImageData, B: ImageData, w: number, h: number, offX: number, offY: number) {
    const co = offscreen(w, h);
    const out = co.ctx.createImageData(w, h);
    const ad = A.data, bd = B.data;
    const O = new Uint32Array(out.data.buffer);
    for (let y = 0; y < h; y++) {
      const by = y - offY;
      const bRow = by >= 0 && by < h ? by * w : -1;
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const i = (row + x) * 4;
        // Cantidad de tinta = lo que le falta al píxel para ser blanco
        const tA = 255 - (ad[i] * 0.299 + ad[i + 1] * 0.587 + ad[i + 2] * 0.114);
        let tB = 0;
        const bx = x - offX;
        if (bRow >= 0 && bx >= 0 && bx < w) {
          const j = (bRow + bx) * 4;
          tB = 255 - (bd[j] * 0.299 + bd[j + 1] * 0.587 + bd[j + 2] * 0.114);
        }
        const inkA = tA >= INK_MIN, inkB = tB >= INK_MIN;
        if (!inkA && !inkB) { O[row + x] = PX_BG; continue; }
        const t = (tA > tB ? tA : tB) | 0;   // intensidad del trazo más marcado
        O[row + x] = inkA
          ? (inkB ? LUT_SAME[t]   : LUT_ONLY_A[t])   // solo en el actual → azul
          : LUT_ONLY_B[t];                           // solo en la comparada → rojo
      }
    }
    co.ctx.putImageData(out, 0, 0);
    return co.canvas;
  }

  /* ════════════════════════════════════════════════════════════════════
     DIFF DE ALTA RESOLUCIÓN POR REGIÓN (detalle al acercar el zoom)

     La capa de markup llama a esto con el rectángulo VISIBLE del plano (en
     puntos PDF de A) y la densidad de la pantalla (px por punto). Se rasterizan
     de nuevo ambas revisiones SOLO en esa región y a esa densidad, y se hace el
     diff ahí. Al acercar, la región se encoge y la densidad sube, de modo que la
     nitidez es siempre la del monitor: el detalle no tiene techo.

     En modo "Ajustar" no se diferencia: se devuelve sólo la revisión, translúcida,
     porque ahí la capa se arrastra y tiene que poder moverse sola.

     La región que pide la capa de markup viene con un margen alrededor de lo
     visible, para que un desplazamiento corto siga cayendo dentro del tile que
     ya está puesto y no dispare un rasterizado nuevo.
     ════════════════════════════════════════════════════════════════════ */
  async function renderCompareRegion(rect: {x:number,y:number,w:number,h:number}, density: number) {
    const n = ctx.getCurrentPage();
    if (!active || !renderer.isLoaded) return null;
    if (n < 1 || n > renderer.numPages) return null;
    const r = raster;
    if (!r || r.n !== n || r.rot !== rot()) return null;   // sin caché aún: la vista completa manda

    // Escala del tile, acotada por su lado máximo. Se calcula aquí —replicando el
    // acotado de renderRegion— para poder lanzar los dos rasterizados EN
    // PARALELO: si hubiera que esperar al de A sólo para saber a qué escala pedir
    // el de B, el detalle tardaría el doble en aparecer.
    const sa = Math.max(1, Math.min(
      density,
      MAX_TILE_DIM / Math.max(1, rect.w),
      MAX_TILE_DIM / Math.max(1, rect.h),
      Math.sqrt(MAX_TILE_PX / Math.max(1, rect.w * rect.h)),
    ));

    // Mapeo A→B: el diff de página completa estira B hasta la hoja de A, así que
    // aquí se aplica la misma relación de tamaños lógicos, más el offset de
    // alineación (que está en unidades del plano A).
    const kx = r.bLogicalWidth  / (r.logicalWidth  || 1);
    const ky = r.bLogicalHeight / (r.logicalHeight || 1);
    const bRect = {
      x: (rect.x - offsetX) * kx,
      y: (rect.y - offsetY) * ky,
      w: rect.w * kx,
      h: rect.h * ky,
    };

    const rotation = r.rot;

    /* Ajustando: SÓLO la revisión, translúcida, sin mezclar con el plano base.
       Una capa aparte se puede arrastrar —trasladarla equivale exactamente a
       re-renderizar B en la posición nueva—, y arrastrar es justo lo que se hace
       en este modo. Mezclada saldría opaca y moverla arrastraría también el
       plano base, que tiene que quedarse quieto.
       De paso sale la mitad de cara: un rasterizado en vez de dos, y sin bucle
       de diferencias. */
    if (aligning) {
      const bOnly = await renderer.renderRegion(n, bRect, sa / kx, rotation, { raw: true });
      return {
        canvas: bOnly.canvas, dataUrl: null,
        pxW: bOnly.pxW, pxH: bOnly.pxH,
        opacity: ALIGN_OPACITY,   // translúcido: la capa de markup tapa el overlay
      };
    }

    const [aTile, bTile] = await Promise.all([
      ctx.pdfRenderer.renderRegion(n, rect,  sa,      rotation, { raw: true, readback: true }),
      renderer     .renderRegion(n, bRect, sa / kx, rotation, { raw: true, readback: true }),
    ]);
    const w2 = aTile.pxW, h2 = aTile.pxH;
    const g2 = (c: HTMLCanvasElement) => c.getContext('2d') as CanvasRenderingContext2D;

    /* A ya viene con el tamaño y el canvas correctos: se lee directo. B sólo pasa
       por un lienzo intermedio si sus dimensiones no coinciden (hojas de distinta
       proporción); en el caso normal coinciden y nos ahorramos un canvas de
       decenas de MB y una copia de varios millones de píxeles — por tile. */
    const aData = g2(aTile.canvas).getImageData(0, 0, w2, h2);
    let bData: ImageData;
    if (bTile.pxW === w2 && bTile.pxH === h2) {
      bData = g2(bTile.canvas).getImageData(0, 0, w2, h2);
    } else {
      const cb = offscreen(w2, h2, true);
      cb.ctx.drawImage(bTile.canvas, 0, 0, w2, h2);
      bData = cb.ctx.getImageData(0, 0, w2, h2);
    }

    const canvas = computeDiffCanvas(aData, bData, w2, h2, 0, 0);   // offset ya aplicado en bRect
    return { canvas, dataUrl: null, pxW: w2, pxH: h2 };
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
    const diffCanvas = computeDiffCanvas(r.aData, r.bData, r.w, r.h, offX, offY);
    if (seq !== renderSeq) return;
    await ctx.getMarkup().setCompareOverlay(diffCanvas, r.w, r.h, { opacity: OPACITY, tint: null });
    ctx.setStatus('');
    ctx.showHint && ctx.showHint('');   // ocultar la guía de ajuste
  }

  /** Modo ajustar: muestra la revisión comparada semitransparente y ARRASTRABLE. */
  async function renderAlign(n: number, seq: number) {
    const markup = ctx.getMarkup();
    const r = await getPageRaster(n);
    if (seq !== renderSeq) return;
    // El ráster crudo de B se rehace aquí en vez de cachearse: sólo lo usa este
    // modo, y guardarlo permanentemente costaría decenas de MB por página.
    const b = await renderer.renderPage(n, 0, r.rot, { scale: r.w / r.bLogicalWidth, raw: true });
    if (seq !== renderSeq) return;
    markup.setTool && markup.setTool('select');   // para poder arrastrar el overlay
    await markup.setCompareOverlay(b.canvas, b.canvas.width, b.canvas.height, {
      opacity: ALIGN_OPACITY,
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

  /** Carga la revisión a comparar (una URL del API, con headers) y activa el
      overlay. Sólo se compara contra planos del repositorio: no hay forma de
      traer un PDF del equipo del usuario. */
  async function loadRevision(source: string, httpHeaders: any, name: string) {
    ctx.setStatus('Cargando revisión…');
    showLoading(true);
    try {
      offsetX = 0; offsetY = 0; aligning = false;
      raster = null;                 // invalidar caché: es otra revisión
      updateAlignBtn();
      await renderer.load(source, httpHeaders);
      active = true;
      // Publicar el proveedor de detalle: a partir de aquí, el zoom profundo
      // re-calcula el diff de la región visible a resolución de pantalla.
      const markup = ctx.getMarkup();
      if (markup) markup.requestCompareRegion = renderCompareRegion;
      setRevNames(name);
      $('compare-bar').style.display = 'flex';
      $('btn-compare').classList.add('tb-btn-active');
      await renderForPage(ctx.getCurrentPage());
      ctx.setStatus('');
    } catch (e: any) {
      // `e.message` trae el diagnóstico completo (hasta el HTML que devolvió el
      // servidor). Para la interfaz basta la frase legible; el resto, a consola.
      const motivo = e.pista || 'No se pudo abrir el plano a comparar.';
      console.error('Comparar revisión:', e);
      ctx.setStatus('Error al cargar revisión: ' + motivo);
      alert('No se pudo cargar la revisión:\n' + motivo);
    } finally {
      showLoading(false);
    }
  }

  /** Carga la revisión a comparar desde la BD (URL del API + headers), como en hipervínculos. */
  function loadRevisionUrl(url: string, httpHeaders: any, name: string) {
    return loadRevision(url, httpHeaders, name);
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
    if (markup) {
      markup.requestCompareRegion = null;   // volver al detalle del plano base
      markup.clearCompareOverlay();
    }
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
        const markup = ctx.getMarkup();
        if (markup) markup.requestCompareRegion = renderCompareRegion;
        $('compare-bar').style.display = 'flex';
        $('btn-compare').classList.add('tb-btn-active');
        renderForPage(ctx.getCurrentPage());
      }
    });
    $('btn-compare-close')?.addEventListener('click', close);
    // Carpeta → cambiar el plano a comparar (abre el selector de la BD)
    $('btn-compare-folder')?.addEventListener('click', () => ctx.onPickRevision && ctx.onPickRevision());

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

  return { init, close, onPageChange, loadRevisionUrl };
}
