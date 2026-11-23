/* ──────────────────────────────────────────────────────────────────────
   detail-tiles.ts — Nitidez del plano a cualquier zoom (métodos de MarkupLayer)

   En vez de rasterizar toda la página en alta resolución, sólo se re-rasteriza
   la región visible (enfoque Procore) y se coloca como un "tile" encima del
   fondo base. Hay dos ranuras de detalle, nunca activas a la vez:
     · el tile del PLANO BASE (requestRegion), debajo de todo;
     · el tile del OVERLAY de comparación (revisiones/compare-overlay).
   Ambos son OPACOS y cubren sólo lo visible: se limitan a tapar lo que hay
   debajo, y eso es lo que evita el parpadeo al hacer pan.
   ────────────────────────────────────────────────────────────────────── */
import { fabric } from 'fabric';
import type { MarkupLayer } from '../anotaciones/lienzo/markup-layer';

export const detailTileMethods = {
  /** Rectángulo visible del plano en coordenadas LÓGICAS (puntos PDF) */
  _visibleLogicalRect(this: MarkupLayer) {
    const vt = this.canvas.viewportTransform;
    const zoom = vt[0] || 1;
    const canvasWidth = this.canvas.getWidth(), canvasHeight = this.canvas.getHeight();
    let x1 = (0  - vt[4]) / zoom, y1 = (0  - vt[5]) / zoom;
    let x2 = (canvasWidth - vt[4]) / zoom, y2 = (canvasHeight - vt[5]) / zoom;
    x1 = Math.max(0, Math.min(x1, this._pdfW));
    y1 = Math.max(0, Math.min(y1, this._pdfH));
    x2 = Math.max(0, Math.min(x2, this._pdfW));
    y2 = Math.max(0, Math.min(y2, this._pdfH));
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1, zoom };
  },

  /** Quita el tile del PLANO BASE. */
  _clearBaseTile(this: MarkupLayer) {
    this._detailReqId++;   // invalida cualquier render en vuelo
    if (!this._detailImg) return;
    this.canvas.remove(this._detailImg);
    this._detailImg = null;
    this.canvas.requestRenderAll();
  },

  _clearDetail(this: MarkupLayer) {
    if (this._detailTimer) { clearTimeout(this._detailTimer); this._detailTimer = null; }
    this._clearBaseTile();
    this._clearCmpTile();
  },

  /** Programa un refresco de los tiles de detalle (debounce tras zoom/pan) */
  _scheduleDetail(this: MarkupLayer) {
    const DETAIL_DEBOUNCE_MS = 180;
    if (!this._bgImage) return;
    if (!this.requestRegion && !this.requestCompareRegion) return;
    if (this._detailTimer) clearTimeout(this._detailTimer);
    this._detailTimer = setTimeout(() => this._refreshDetail(), DETAIL_DEBOUNCE_MS);
  },

  /** Región a pedir: lo visible MÁS un margen, para que un desplazamiento corto
      siga cayendo dentro del tile que ya hay y no obligue a re-renderizar.
      Acotada a la página (no tiene sentido rasterizar fuera de la hoja). */
  _tileRequestRect(this: MarkupLayer, rect) {
    const M = 0.15;   // fracción de la vista añadida a cada lado
    const mx = rect.w * M, my = rect.h * M;
    const x  = Math.max(0, rect.x - mx);
    const y  = Math.max(0, rect.y - my);
    const x2 = Math.min(this._pdfW, rect.x + rect.w + mx);
    const y2 = Math.min(this._pdfH, rect.y + rect.h + my);
    return { x, y, w: Math.max(1, x2 - x), h: Math.max(1, y2 - y) };
  },

  /** ¿El tile que ya está puesto cubre `rect` con al menos la densidad pedida?
      Si la cubre no hay nada que hacer: ni pedir, ni rasterizar, ni repintar. */
  _tileCovers(this: MarkupLayer, img, rect, density) {
    const t = img && img._tile;
    if (!t) return false;
    const EPS = 0.5;   // holgura en unidades de plano, por redondeos del viewport
    return t.density >= density * 0.98
        && t.x <= rect.x + EPS
        && t.y <= rect.y + EPS
        && t.x + t.w >= rect.x + rect.w - EPS
        && t.y + t.h >= rect.y + rect.h - EPS;
  },

  /** ¿El error viene de haber cancelado un render obsoleto? (no es un fallo) */
  _isCancelled(this: MarkupLayer, err) {
    return !!err && (err.name === 'RenderingCancelledException' || err.type === 'canvas');
  },

  /** Coloca un tile ya cargado sobre la región `rect` que representa. */
  _placeTile(this: MarkupLayer, img, rect, res) {
    img.set({
      left: rect.x, top: rect.y,
      scaleX: rect.w / res.pxW,
      scaleY: rect.h / res.pxH,
      selectable: false, evented: false,
      hasControls: false, hasBorders: false,
      objectCaching: false,
    });
    img.isBackground = true;   // no se serializa como markup
    // Qué cubre este tile, para poder reutilizarlo en el siguiente refresco
    img._tile = { x: rect.x, y: rect.y, w: rect.w, h: rect.h, density: res.pxW / rect.w };
  },

  /** Convierte la respuesta de un proveedor de región en un fabric.Image.
      Puede llegar como <canvas> ya pintado (ruta rápida, sin codificar PNG). */
  _tileToImage(this: MarkupLayer, res, cb) {
    if (res.canvas) cb(new fabric.Image(res.canvas));
    else            fabric.Image.fromURL(res.dataUrl, cb);
  },

  /* Dos ranuras independientes de detalle, nunca activas a la vez:
       · el tile del PLANO BASE (requestRegion), debajo de todo;
       · el tile del OVERLAY de comparación (requestCompareRegion), justo encima
         del overlay. Con el diff activo trae la diferencia recalculada; en modo
         "ajustar", el plano base ya mezclado con la revisión.
     Ambos son OPACOS y cubren sólo la región visible, así que se limitan a tapar
     lo que hay debajo. Eso es lo que evita el parpadeo al hacer pan: el área que
     el tile todavía no cubre enseña la misma imagen, sólo que menos nítida. */
  async _refreshDetail(this: MarkupLayer) {
    if (!this._bgImage) return;
    const dpr  = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    const rect = this._visibleLogicalRect();
    if (rect.w <= 0 || rect.h <= 0) return;
    const density = rect.zoom * dpr;   // px de pantalla por unidad lógica

    /* El tile del plano base sólo sobra cuando lo de encima es OPACO: con el diff
       puesto, pedirlo sería trabajo invisible. Al ajustar, en cambio, la revisión
       va translúcida y el plano base se ve a través de ella, así que hacen falta
       los dos. */
    if (this._cmpImg && !this._cmpDragging) this._clearBaseTile();
    else this._refreshBaseTile(rect, density);

    if (this._cmpImg && this.requestCompareRegion) this._refreshCmpTile(rect, density);
    else this._clearCmpTile();
  },

  async _refreshBaseTile(this: MarkupLayer, rect, density) {
    if (!this.requestRegion) { this._clearBaseTile(); return; }
    const MARGIN = 1.05;   // tolerancia antes de pedir un tile de detalle
    // Si el fondo base ya tiene resolución suficiente para este zoom, no hace falta
    if (density <= this._baseSS * MARGIN) { this._clearBaseTile(); return; }
    // Ni tampoco si el tile que ya está puesto cubre lo visible
    if (this._tileCovers(this._detailImg, rect, density)) return;

    const req = this._tileRequestRect(rect);
    const reqId = ++this._detailReqId;
    let res;
    try {
      res = await this.requestRegion(req, density);
    } catch (err) {
      if (!this._isCancelled(err)) console.error('refreshBaseTile:', err);
      return;
    }
    if (reqId !== this._detailReqId) return;   // el viewport ya cambió: otro refresh ganó
    if (!res || !(res.canvas || res.dataUrl)) { this._clearBaseTile(); return; }

    this._tileToImage(res, (img) => {
      if (reqId !== this._detailReqId) return;   // re-chequear tras la carga async
      this._placeTile(img, req, res);
      img.name = '__pdf_detail__';
      if (this._detailImg) this.canvas.remove(this._detailImg);
      this._detailImg = img;
      // Orden z: fondo base atrás, detalle encima del base, markup arriba de todo
      this.canvas.add(img);
      this.canvas.sendToBack(img);
      if (this._bgImage) this.canvas.sendToBack(this._bgImage);
      this.canvas.renderAll();
    });
  },
};
