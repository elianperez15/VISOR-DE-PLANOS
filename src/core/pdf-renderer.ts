/* ──────────────────────────────────────────────
   PDFRenderer — carga y renderiza páginas de PDF
   Usa PDF.js v3 (pdfjs-dist desde npm, bundleado por Vite)
   ────────────────────────────────────────────── */
import * as pdfjsLib from 'pdfjs-dist';
// Vite emite el worker como asset y devuelve su URL final
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.js?url';

export class PDFRenderer {
  constructor() {
    pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
    this._doc = null;
    this._numPages = 0;
  }

  /**
   * Carga un PDF desde File (objeto File) o desde una URL string
   * @returns {Promise<{numPages: number}>}
   */
  async load(source, httpHeaders = null) {
    let loadingTask;
    if (source instanceof File) {
      const arrayBuffer = await source.arrayBuffer();
      loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    } else {
      // httpHeaders: el endpoint ORDS 'documento' espera el id (y nombre) como
      // headers HTTP; pdf.js los manda en la petición GET del PDF.
      loadingTask = pdfjsLib.getDocument(
        httpHeaders ? { url: source, httpHeaders } : { url: source }
      );
    }
    this._doc = await loadingTask.promise;
    this._numPages = this._doc.numPages;
    return { numPages: this._numPages };
  }

  get numPages()  { return this._numPages; }
  get isLoaded()  { return this._doc !== null; }

  /**
   * Renderiza una página a un data URL.
   *
   * `supersample` es el factor de sobre-muestreo respecto al tamaño lógico (1x).
   * Se multiplica por `devicePixelRatio` para igualar la resolución física de la
   * pantalla, y se limita para no exceder el tamaño máximo de canvas del navegador.
   *
   * @param {number} pageNum      1-based
   * @param {number} supersample  factor de sobre-muestreo base (3 ≈ máxima nitidez)
   * @param {number} rotation     giro en grados horarios (0 | 90 | 180 | 270)
   * @returns {Promise<{dataUrl, imageWidth, imageHeight, logicalWidth, logicalHeight}>}
   */
  async renderPage(pageNum, supersample = 3.0, rotation = 0) {
    if (!this._doc) throw new Error('No hay PDF cargado');

    const page = await this._doc.getPage(pageNum);

    // Sumar la rotación de la app a la rotación intrínseca del PDF (/Rotate).
    // Pasar `rotation` a getViewport la SOBRESCRIBE, así que hay que añadir
    // page.rotate para respetar la orientación con la que se guardó el archivo.
    const totalRotation = (((page.rotate || 0) + rotation) % 360 + 360) % 360;

    // Tamaño lógico de la página YA rotada (puntos PDF a 1x). Para 90/270 el
    // ancho y alto quedan intercambiados respecto a la orientación original.
    const base = page.getViewport({ scale: 1, rotation: totalRotation });

    // Escala efectiva = supersample × DPR, acotada por el límite de canvas del navegador
    const dpr     = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    const MAX_DIM = 8192; // px por lado; seguro en navegadores de escritorio
    const capByDim = MAX_DIM / Math.max(base.width, base.height);
    const renderScale = Math.max(1, Math.min(supersample * dpr, capByDim));

    const viewport = page.getViewport({ scale: renderScale, rotation: totalRotation });

    const canvas = document.createElement('canvas');
    canvas.width  = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);

    const ctx = canvas.getContext('2d', { alpha: false });
    // Re-muestreo de máxima calidad al escalar el raster en pantalla
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    await page.render({ canvasContext: ctx, viewport, intent: 'display' }).promise;

    // Liberar recursos de la página después de renderizar
    page.cleanup();

    return {
      // PNG sin pérdida → líneas de plano nítidas, sin artefactos JPEG
      dataUrl      : canvas.toDataURL('image/png'),
      imageWidth   : canvas.width,
      imageHeight  : canvas.height,
      logicalWidth : Math.round(base.width),   // px a 1x
      logicalHeight: Math.round(base.height),
    };
  }

  /**
   * Renderiza SOLO una región rectangular de la página (en coordenadas lógicas)
   * a la densidad pedida. Base del zoom profundo "tipo Procore": en vez de
   * rasterizar toda la página en alta resolución, se rasteriza solo lo visible.
   *
   * @param {number} pageNum  1-based
   * @param {{x:number,y:number,w:number,h:number}} rect  región en puntos PDF (1x, ya rotados)
   * @param {number} density  px de salida por unidad lógica (≈ zoom × devicePixelRatio)
   * @param {number} rotation giro en grados horarios (0 | 90 | 180 | 270)
   * @returns {Promise<{dataUrl:string, pxW:number, pxH:number}>}
   */
  async renderRegion(pageNum, rect, density, rotation = 0) {
    if (!this._doc) throw new Error('No hay PDF cargado');

    const page = await this._doc.getPage(pageNum);

    // Acotar densidad para que el tile no exceda el máximo de canvas del navegador
    const MAX_DIM = 8192;
    const s = Math.max(
      1,
      Math.min(density, MAX_DIM / Math.max(1, rect.w), MAX_DIM / Math.max(1, rect.h)),
    );

    // Misma orientación total que renderPage: intrínseca del PDF + rotación de la app.
    const totalRotation = (((page.rotate || 0) + rotation) % 360 + 360) % 360;

    // El viewport rotado usa el mismo espacio lógico (ya rotado) que rect,
    // por lo que el desplazamiento -rect.x/-rect.y sigue recortando la región.
    const viewport = page.getViewport({ scale: s, rotation: totalRotation });

    const canvas = document.createElement('canvas');
    canvas.width  = Math.max(1, Math.ceil(rect.w * s));
    canvas.height = Math.max(1, Math.ceil(rect.h * s));

    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    // El transform desplaza la página para que la esquina de la región caiga en (0,0)
    await page.render({
      canvasContext: ctx,
      viewport,
      transform: [1, 0, 0, 1, -rect.x * s, -rect.y * s],
      intent: 'display',
    }).promise;

    page.cleanup();

    return {
      dataUrl: canvas.toDataURL('image/png'),
      pxW: canvas.width,
      pxH: canvas.height,
    };
  }

  destroy() {
    if (this._doc) {
      this._doc.destroy();
      this._doc = null;
      this._numPages = 0;
    }
  }
}
