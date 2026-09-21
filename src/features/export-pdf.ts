/* ──────────────────────────────────────────────────────────────────────
   export-pdf.ts — Descarga del documento en PDF (con marcas / sin marcas)

   · SIN marcas → se entregan los BYTES ORIGINALES del PDF cargado. Es el
     documento intacto: vectorial, todas las páginas, tamaño mínimo.
   · CON marcas → se genera un PDF nuevo con una página por hoja, cada una
     rasterizada tal como se ve en el visor (fondo + marcas + rotación). Para
     recorrer el documento se usa la propia página del visor (goToPage), así el
     resultado es exactamente WYSIWYG: incluye las marcas de los colaboradores,
     los sellos, los adjuntos anclados y el overlay de comparación si está activo.

   pdf-lib (≈430 KB) se importa de forma DIFERIDA: sólo se descarga la primera
   vez que se pide un PDF con marcas, no en la carga inicial del visor.
   ────────────────────────────────────────────────────────────────────── */

export interface ExportPdfCtx {
  pdfRenderer: any;
  getMarkup: () => any;
  getSession: () => any;
  getCurrentPage: () => number;
  getTotalPages: () => number;
  goToPage: (n: number) => Promise<void>;
  downloadFile: (dataUrl: string, filename: string) => void;
  setStatus: (msg: string) => void;
}

export function createExportPdf(ctx: ExportPdfCtx) {
  const MAX_PAGE_PX  = 5000;   // lado máximo del ráster de cada página
  const MAX_SS       = 3;      // tope de sobre-muestreo respecto al tamaño lógico
  const JPEG_QUALITY = 0.95;   // el PDF viaja como data URL → JPEG alto, no PNG

  function baseName() {
    return (ctx.getSession().docName || 'documento').replace(/\.pdf$/i, '');
  }

  /** Uint8Array → data URL, por trozos (evita desbordar la pila en PDF grandes). */
  function bytesToDataUrl(bytes: Uint8Array) {
    let bin = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK)
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as any);
    return 'data:application/pdf;base64,' + btoa(bin);
  }

  /** PDF original, tal cual se cargó: sin ninguna marca y sin recomprimir. */
  async function downloadOriginal() {
    const bytes = await ctx.pdfRenderer.getData();
    ctx.downloadFile(bytesToDataUrl(bytes), `${baseName()}.pdf`);
  }

  /** PDF con las marcas incrustadas (una página por hoja, tal como se ve). */
  async function downloadWithMarkup() {
    const markup = ctx.getMarkup();
    if (!markup) return;
    const total  = ctx.getTotalPages();
    const backTo = ctx.getCurrentPage();
    const { PDFDocument } = await import('pdf-lib');   // carga diferida
    const doc    = await PDFDocument.create();
    try {
      for (let n = 1; n <= total; n++) {
        if (total > 1) ctx.setStatus(`Generando PDF… página ${n}/${total}`);
        if (n !== ctx.getCurrentPage()) await ctx.goToPage(n);
        const { w, h } = markup.getPageSize();
        if (!w || !h) continue;
        // Densidad: la mayor posible sin pasarse del lado máximo del ráster
        const mult = Math.max(1, Math.min(MAX_SS, MAX_PAGE_PX / Math.max(w, h)));
        const img  = await doc.embedJpg(markup.exportPageArea(mult, 'jpeg', JPEG_QUALITY));
        doc.addPage([w, h]).drawImage(img, { x: 0, y: 0, width: w, height: h });
      }
    } finally {
      if (ctx.getCurrentPage() !== backTo) await ctx.goToPage(backTo);
    }
    ctx.downloadFile(await doc.saveAsBase64({ dataUri: true }), `${baseName()}_con-marcas.pdf`);
  }

  return { downloadOriginal, downloadWithMarkup };
}
