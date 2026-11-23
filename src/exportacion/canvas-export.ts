/* ──────────────────────────────────────────────────────────────────────
   canvas-export.ts — Imágenes del lienzo (métodos de MarkupLayer)

     · Recorte de región → PNG ("captura por selección"):
       fase 'draw'   : arrastrar de esquina a esquina, o clic en un punto y
                       clic en el opuesto (el rectángulo sigue al cursor);
       fase 'adjust' : el rectángulo queda movible/redimensionable hasta que
                       se confirma; sólo entonces se genera la imagen.
     · Página completa (con o sin márgenes) para la descarga y el PDF.
   ────────────────────────────────────────────────────────────────────── */
import { fabric } from 'fabric';
import type { MarkupLayer } from '../anotaciones/lienzo/markup-layer';

export const canvasExportMethods = {
  /* ── Recorte de región → PNG (para "Seleccionar área") ─────────────────
     Fase 'draw'   : dos formas de definir el área, a elección del usuario —
                     · arrastrar de una esquina a la otra, o
                     · hacer clic en un punto y clic en el opuesto (dos puntos),
                       con el rectángulo siguiendo el cursor entre ambos clics.
     Fase 'adjust' : el rectángulo queda movible/redimensionable hasta que se
                     confirma; sólo entonces se genera la imagen. */
  beginRegionSnapshot(this: MarkupLayer, opts) {
    opts = opts || {};
    this._snapshotMode = 'draw';
    this._snapOnReady  = opts.onReady || null;   // se llama al terminar de dibujar
    this._snapOnDone   = opts.onDone  || null;   // se llama al confirmar/cancelar (dataUrl|null)
    this._snapRect  = null;
    this._snapStart = null;
    this._snapTwoClick = false;                 // esperando el 2.º punto (modo clic-clic)
    this.canvas.selection = false;
    this.canvas.discardActiveObject();
    this.canvas.skipTargetFind = true;   // los clics definen el área, no seleccionan marcas
    this.canvas.defaultCursor = 'crosshair';
    this.canvas.setCursor('crosshair');
    this.canvas.renderAll();
  },

  cancelRegionSnapshot(this: MarkupLayer) { if (this._snapshotMode) this._finishRegionSnapshot(null); },

  /** Genera la imagen de la región ajustada y termina. */
  confirmRegionSnapshot(this: MarkupLayer) {
    if (this._snapshotMode !== 'adjust' || !this._snapRect) { this._finishRegionSnapshot(null); return; }
    const r = this._snapRect;
    // Ocultar la selección/manijas y el trazo para que no salgan en la imagen
    this.canvas.discardActiveObject();
    r.set({ strokeWidth: 0, fill: 'transparent' });
    this.canvas.renderAll();
    let { left, top, width, height } = r.getBoundingRect();   // coords de pantalla
    const cw = this.canvas.getWidth(), ch = this.canvas.getHeight();
    left = Math.max(0, left); top = Math.max(0, top);
    width  = Math.min(width,  cw - left);
    height = Math.min(height, ch - top);
    let url = null;
    if (width > 1 && height > 1)
      url = this.canvas.toDataURL({ format: 'png', multiplier: 2, left, top, width, height });
    this._finishRegionSnapshot(url);
  },

  _finishRegionSnapshot(this: MarkupLayer, dataUrl) {
    this._snapshotMode = null;
    if (this._snapRect) { this.canvas.remove(this._snapRect); this._snapRect = null; }
    this._snapStart = null;
    this._snapTwoClick = false;
    this.canvas.skipTargetFind = false;
    this.canvas.discardActiveObject();
    this.canvas.selection     = (this.currentTool === 'select');
    this.canvas.defaultCursor = this.currentTool === 'pan' ? 'grab' : 'default';
    this.canvas.setCursor(this.canvas.defaultCursor);
    this.canvas.renderAll();
    const cb = this._snapOnDone; this._snapOnDone = null; this._snapOnReady = null;
    if (cb) cb(dataUrl || null);
  },

  _snapDown(this: MarkupLayer, opt) {
    const ptr = this.canvas.getPointer(opt.e);
    // 2.º punto del modo clic-clic → cerrar el área con el rectángulo ya dibujado
    if (this._snapTwoClick) {
      this._snapMove(opt);   // asegura que el rect llegue exactamente al punto clicado
      if (this._snapRect && this._snapRect.width >= 8 && this._snapRect.height >= 8) {
        this._snapTwoClick = false;
        this._snapEnterAdjust();
      }
      return;
    }
    this._snapStart = ptr;
    this._snapRect = new fabric.Rect({
      left: ptr.x, top: ptr.y, width: 0, height: 0,
      fill: 'rgba(37,99,235,0.12)', stroke: '#2563eb', strokeWidth: 1.5,
      strokeDashArray: [6, 4], selectable: false, evented: false,
    });
    this._snapRect.isBackground = true;   // no cuenta como marca ni se serializa
    this.canvas.add(this._snapRect);
  },

  _snapMove(this: MarkupLayer, opt) {
    if (!this._snapStart || !this._snapRect) return;
    const ptr = this.canvas.getPointer(opt.e);
    this._snapRect.set({
      left  : Math.min(this._snapStart.x, ptr.x),
      top   : Math.min(this._snapStart.y, ptr.y),
      width : Math.abs(ptr.x - this._snapStart.x),
      height: Math.abs(ptr.y - this._snapStart.y),
    });
    this.canvas.renderAll();
  },

  _snapUp(this: MarkupLayer, _opt?) {
    // Soltar sin apenas mover = fue un CLIC, no un arrastre: se queda el primer
    // punto fijado y el rectángulo sigue al cursor hasta el clic del 2.º punto.
    if (!this._snapRect || this._snapRect.width < 8 || this._snapRect.height < 8) {
      if (this._snapRect && this._snapStart) {
        this._snapTwoClick = true;
        this.canvas.renderAll();
      }
      return;
    }
    this._snapEnterAdjust();
  },

  /** Fija el área dibujada y pasa a la fase "ajustar" (movible/redimensionable). */
  _snapEnterAdjust(this: MarkupLayer) {
    if (!this._snapRect) return;
    this._snapshotMode = 'adjust';
    this._snapStart = null;
    this._snapTwoClick = false;
    this.canvas.skipTargetFind = false;   // ahora Fabric sí debe "ver" el rect para ajustarlo
    const r = this._snapRect;
    r.set({
      selectable: true, evented: true, hasControls: true, hasBorders: true,
      lockRotation: true, strokeUniform: true,
      cornerColor: '#2563eb', cornerStrokeColor: '#ffffff', cornerStyle: 'circle',
      transparentCorners: false, borderColor: '#2563eb', cornerSize: 12,
      hoverCursor: 'move',
    });
    r.setControlsVisibility && r.setControlsVisibility({ mtr: false });   // sin rotación
    this.canvas.selection = false;
    this.canvas.setActiveObject(r);
    this.canvas.defaultCursor = 'default';
    this.canvas.setCursor('default');
    this.canvas.renderAll();
    if (this._snapOnReady) this._snapOnReady();
  },

  exportPNG(this: MarkupLayer, multiplier=2) { return this.canvas.toDataURL({format:'png',multiplier}); },

  /**
   * Exporta la PÁGINA completa (PDF + marcas si están visibles) como PNG.
   * Ajusta la vista a toda la hoja para no recortar, exporta y restaura.
   */
  exportDocument(this: MarkupLayer, multiplier = 3) {
    if (!this._pdfW) return this.exportPNG(multiplier);
    const savedViewport = this.canvas.viewportTransform.slice();
    this._clearDetail();        // usar el fondo base completo, sin el tile de zoom
    this._fitToCanvas();        // toda la página a la vista
    this.canvas.renderAll();
    const url = this.canvas.toDataURL({ format: 'png', multiplier });
    this.canvas.setViewportTransform(savedViewport);
    this.canvas.renderAll();
    this._scheduleDetail();
    return url;
  },

  /**
   * Exporta EXACTAMENTE el área de la hoja (sin los márgenes del lienzo que sí
   * incluye exportDocument), con el fondo y las marcas visibles. Es la base de
   * la descarga en PDF "con marcas": el ráster encaja 1:1 con la página.
   */
  exportPageArea(this: MarkupLayer, multiplier = 2, format = 'jpeg', quality = 0.95) {
    if (!this._pdfW || !this._pdfH) return this.exportPNG(multiplier);
    const savedViewport = this.canvas.viewportTransform.slice();
    this._clearDetail();                                     // fondo base completo, sin el tile de zoom
    this.canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);    // 1:1 con el espacio lógico
    this.canvas.renderAll();
    const url = this.canvas.toDataURL({
      format, quality, multiplier,
      left: 0, top: 0, width: this._pdfW, height: this._pdfH,
    });
    this.canvas.setViewportTransform(savedViewport);
    this.canvas.renderAll();
    this._scheduleDetail();
    return url;
  },
};
