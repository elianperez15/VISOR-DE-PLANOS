/* ──────────────────────────────────────────────
   PDFRenderer — carga y renderiza páginas de PDF
   Usa PDF.js v3 (pdfjs-dist desde npm, bundleado por Vite)
   ────────────────────────────────────────────── */
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
// Vite emite el worker como asset y devuelve su URL final
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.js?url';

/**
 * Repite la petición que falló para explicar QUÉ devolvió el servidor.
 * Se llama solo en la ruta de error, así que no cuesta nada en el caso normal.
 *
 * El síntoma más común es un HTTP 200 cuyo cuerpo no es un PDF (una página de
 * login o un error de ORDS): pdf.js lo reporta como "Invalid PDF structure",
 * que no dice nada útil.
 *
 * Devuelve las tres piezas por separado, no un solo texto: al usuario se le
 * enseña `pista` (una frase que puede entender y accionar) y el volcado técnico
 * queda replegado para quien tenga que diagnosticar.
 * @returns {Promise<{mensaje:string, pista:string, tecnico:string}>}
 */
async function diagnosticarFalloDeCarga(
  url: string, httpHeaders: Record<string, string> | null, errorOriginal: any,
): Promise<{ mensaje: string; pista: string; tecnico: string }> {
  const base = errorOriginal?.message || String(errorOriginal);
  const enviados = httpHeaders
    ? Object.entries(httpHeaders).map(([k, v]) => `${k}: ${v}`).join(' · ')
    : '(ninguno)';

  let res;
  try {
    res = await fetch(url, { headers: httpHeaders || {}, credentials: 'same-origin' });
  } catch (e) {
    return {
      mensaje: base,
      pista  : 'No se pudo contactar con el servidor de documentos.',
      tecnico: `La petición a ${url} no llegó a completarse: ${e.message}\n`
             + `Headers enviados: ${enviados}\n`
             + `Suele ser el proxy /ords/ de nginx apuntando a un host que no responde.`,
    };
  }

  const ctype = res.headers.get('content-type') || '(sin Content-Type)';
  const clen  = Number(res.headers.get('content-length') || 0);
  let detalle = `HTTP ${res.status} ${res.statusText} · ${ctype}`;
  let pista   = '';

  if (res.status === 404) {
    pista = 'El servidor no encuentra el servicio de documentos.';
  } else if (res.status === 401 || res.status === 403) {
    pista = 'No tienes permiso para acceder a este documento.';
  } else if (res.status === 502 || res.status === 504) {
    pista = 'El servidor de documentos no está respondiendo.';
  } else if (clen > 2_000_000) {
    // No re-descargamos un PDF grande solo para diagnosticar.
    detalle += ` · ${(clen / 1048576).toFixed(1)} MB`;
    pista = 'El documento llegó pero no se pudo interpretar. Puede estar dañado.';
  } else {
    const buf   = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    const cabeza = new TextDecoder('latin1').decode(bytes.slice(0, 300))
      .replace(/\s+/g, ' ').trim();
    detalle += ` · ${bytes.length} bytes`;

    if (bytes.length === 0) {
      pista = 'El servidor devolvió un documento vacío. Es posible que ese plano ya no exista.';
    } else if (cabeza.startsWith('%PDF-')) {
      pista = 'El archivo está dañado o incompleto en el servidor.';
    } else {
      detalle += `\nEmpieza con: ${cabeza.slice(0, 200)}`;
      pista = res.status === 200
        ? 'El servidor no devolvió un documento, sino una página de error o de inicio de sesión.'
        : 'El servidor devolvió un error en vez del documento.';
    }
  }

  return {
    mensaje: base,
    pista,
    tecnico: `${detalle}\nURL: ${url}\nHeaders enviados: ${enviados}`,
  };
}

/** Esperas (ms) antes de cada reintento cuando el servidor responde 502/503/504. */
const REINTENTOS_TRANSITORIOS = [600, 1500];

/** Región rectangular en coordenadas lógicas (puntos PDF a 1x). */
export interface Rect { x: number; y: number; w: number; h: number; }

/** Error de carga: `pista` es la frase para el usuario; `tecnico`, el volcado de diagnóstico. */
export interface LoadError extends Error { pista?: string; tecnico?: string; }

export interface PageRender {
  dataUrl: string | null;
  canvas: HTMLCanvasElement;
  imageWidth: number;
  imageHeight: number;
  logicalWidth: number;
  logicalHeight: number;
}

export interface RegionRender {
  dataUrl: string | null;
  canvas: HTMLCanvasElement;
  pxW: number;
  pxH: number;
}

export class PDFRenderer {
  private _doc: PDFDocumentProxy | null = null;
  private _numPages = 0;
  private _regionTask: RenderTask | null = null;   // render de región en vuelo (para poder cancelarlo)
  private _loadSeq = 0;                            // sólo la carga más reciente puede quedarse con el documento

  constructor() {
    pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  }

  /**
   * Carga un PDF desde una URL. `httpHeaders`: el endpoint ORDS 'documento'
   * espera el id (y nombre) como headers HTTP; pdf.js los manda en el GET.
   */
  async load(url: string, httpHeaders: Record<string, string> | null = null): Promise<{ numPages: number }> {
    const seq = ++this._loadSeq;
    let doc: PDFDocumentProxy;
    /* `isEvalSupported: false` cierra CVE-2024-4367: un PDF manipulado puede
       colar JavaScript en la FontMatrix de un glifo y pdf.js lo evaluaría.
       Es la mitigación oficial mientras sigamos en pdf.js v3 — actualizar a v4+
       obliga a migrar la API de render, que es otro trabajo. El coste es que
       algunas fuentes se dibujan por la vía lenta; en planos no se nota. */
    const opciones = { isEvalSupported: false };
    try {
      // El primer GET tras un rato sin uso puede llegar con 502/503/504 (el
      // proxy /ords/ o ORDS todavía "despertando") y el siguiente ya responde
      // bien: se reintenta antes de darlo por fallido.
      for (let intento = 0; ; intento++) {
        try {
          doc = await pdfjsLib.getDocument(
            httpHeaders ? { url, httpHeaders, ...opciones } : { url, ...opciones },
          ).promise;
          break;
        } catch (err) {
          const transitorio = [502, 503, 504].includes((err as any)?.status);
          if (!transitorio || intento >= REINTENTOS_TRANSITORIOS.length || seq !== this._loadSeq) throw err;
          console.warn(`[SAF] PDF respondió ${(err as any).status}; reintento ${intento + 1}…`);
          await new Promise(r => setTimeout(r, REINTENTOS_TRANSITORIOS[intento]));
        }
      }
    } catch (err) {
      if (seq !== this._loadSeq) throw err;   // ya se pidió otro documento: no hace falta diagnosticar
      // pdf.js hace el fetch por dentro y solo devuelve su propio mensaje
      // ("Invalid PDF structure", "Missing PDF"…), ocultando el HTTP real.
      // Repetimos la petición SOLO al fallar, para poder decir qué pasó.
      const d = await diagnosticarFalloDeCarga(url, httpHeaders, err);
      // El `message` conserva todo (consola, logs); las piezas van aparte para
      // que la interfaz enseñe sólo lo que el usuario puede entender.
      const fallo: LoadError = new Error(`${d.mensaje}\n\n── Diagnóstico ──\n${d.tecnico}\n\n${d.pista}`);
      fallo.pista   = d.pista;
      fallo.tecnico = d.tecnico;
      throw fallo;
    }
    if (seq !== this._loadSeq) {
      // Llegó tarde: mientras cargaba se pidió otro documento, que es el que vale
      doc.destroy();
      throw new Error('Carga reemplazada por otra más reciente');
    }
    // pdf.js abre un worker por documento: el anterior se libera al reemplazarlo
    this.destroy();
    this._doc = doc;
    this._numPages = doc.numPages;
    return { numPages: this._numPages };
  }

  get numPages()  { return this._numPages; }
  get isLoaded()  { return this._doc !== null; }

  /**
   * Bytes ORIGINALES del PDF cargado, tal cual llegaron del servidor.
   * Base de la descarga "sin marcas": es el documento intacto, vectorial.
   * @returns {Promise<Uint8Array>}
   */
  async getData(): Promise<Uint8Array> {
    if (!this._doc) throw new Error('No hay PDF cargado');
    return await this._doc.getData();
  }

  /**
   * Tamaño LÓGICO (puntos PDF a 1x) de una página ya rotada, sin rasterizarla.
   * Permite calcular de antemano la escala exacta con la que hay que renderizar
   * para llenar un presupuesto de píxeles — en vez de rasterizar en grande y
   * después reducir (que desperdicia memoria y emborrona las líneas finas).
   *
   * @param {number} pageNum  1-based
   * @param {number} rotation giro en grados horarios (0 | 90 | 180 | 270)
   * @returns {Promise<{w:number, h:number}>}
   */
  async getPageSize(pageNum: number, rotation = 0): Promise<{ w: number; h: number }> {
    if (!this._doc) throw new Error('No hay PDF cargado');
    const page = await this._doc.getPage(pageNum);
    const totalRotation = (((page.rotate || 0) + rotation) % 360 + 360) % 360;
    const vp = page.getViewport({ scale: 1, rotation: totalRotation });
    page.cleanup();
    return { w: vp.width, h: vp.height };
  }

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
   * @param {{scale?:number, raw?:boolean}} opts
   *        · `scale` fija la escala de render EXACTA (px por unidad lógica) e
   *          ignora `supersample`/devicePixelRatio. Lo usa la comparación de
   *          revisiones para rasterizar justo al tamaño del espacio de diff.
   *        · `raw` devuelve el <canvas> y omite `toDataURL()`. Codificar un PNG
   *          de decenas de megapíxeles cuesta cientos de ms; si el destino es
   *          otro canvas (diff, fabric.Image), el data URL es puro desperdicio.
   * @returns {Promise<{dataUrl, canvas, imageWidth, imageHeight, logicalWidth, logicalHeight}>}
   */
  async renderPage(
    pageNum: number, supersample = 3.0, rotation = 0,
    opts: { scale?: number; raw?: boolean } = {},
  ): Promise<PageRender> {
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
    const wanted = opts.scale > 0 ? opts.scale : supersample * dpr;
    // Con `scale` explícita no se aplica el piso de 1x: el llamador ya pidió
    // una escala concreta y reducirla descuadraría el tamaño que espera.
    const renderScale = opts.scale > 0
      ? Math.min(wanted, capByDim)
      : Math.max(1, Math.min(wanted, capByDim));

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
      dataUrl      : opts.raw ? null : canvas.toDataURL('image/png'),
      canvas,
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
   * @param {{raw?:boolean, readback?:boolean}} opts
   *        · `raw` devuelve el <canvas> sin codificar a PNG.
   *        · `readback` pinta en un canvas preparado para leerlo con
   *          getImageData (el diff de revisiones lo hace). Sin esta pista el
   *          navegador lo respalda en GPU y cada lectura obliga a traérselo.
   *
   * Sólo se rasteriza UNA región a la vez por documento: al pedir otra se
   * CANCELA la anterior. Al hacer pan se encadenan peticiones, y sin esto las
   * obsoletas siguen compitiendo por el hilo principal y retrasan justo a la
   * que el usuario está esperando.
   * @returns {Promise<{dataUrl:string|null, canvas:HTMLCanvasElement, pxW:number, pxH:number}>}
   */
  async renderRegion(
    pageNum: number, rect: Rect, density: number, rotation = 0,
    opts: { raw?: boolean; readback?: boolean } = {},
  ): Promise<RegionRender> {
    if (!this._doc) throw new Error('No hay PDF cargado');

    if (this._regionTask) {
      try { this._regionTask.cancel(); } catch (e) { /* ya terminado */ }
      this._regionTask = null;
    }

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

    const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: !!opts.readback });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    // El transform desplaza la página para que la esquina de la región caiga en (0,0)
    const task = page.render({
      canvasContext: ctx,
      viewport,
      transform: [1, 0, 0, 1, -rect.x * s, -rect.y * s],
      intent: 'display',
    });
    this._regionTask = task;
    try {
      await task.promise;
    } finally {
      if (this._regionTask === task) this._regionTask = null;
    }

    page.cleanup();

    return {
      dataUrl: opts.raw ? null : canvas.toDataURL('image/png'),
      canvas,
      pxW: canvas.width,
      pxH: canvas.height,
    };
  }

  /** Cancela el render en vuelo y libera el documento (y su worker). */
  destroy() {
    if (this._regionTask) {
      try { this._regionTask.cancel(); } catch (e) { /* ya terminado */ }
      this._regionTask = null;
    }
    if (this._doc) {
      this._doc.destroy();
      this._doc = null;
      this._numPages = 0;
    }
  }
}
