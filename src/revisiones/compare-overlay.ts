/* ──────────────────────────────────────────────────────────────────────
   compare-overlay.ts — Overlay de la revisión comparada sobre el lienzo
   (métodos de MarkupLayer)

   La imagen de la revisión B se escala al tamaño lógico de A y se inserta
   por encima del fondo pero por debajo de las marcas. No se serializa
   (isBackground). En modo "ajustar" es arrastrable para alinear revisiones.
   El tile de detalle del overlay acompaña al arrastre (ver _dragCmpTile).
   ────────────────────────────────────────────────────────────────────── */
import { fabric } from 'fabric';
import type { MarkupLayer } from '../anotaciones/lienzo/markup-layer';

export const compareOverlayMethods = {
  /** Quita el tile DEL OVERLAY y, si estaba tapado por él, devuelve al overlay
      su opacidad. */
  _clearCmpTile(this: MarkupLayer) {
    this._cmpTileReqId++;
    let changed = false;
    if (this._cmpTileImg) {
      this.canvas.remove(this._cmpTileImg);
      this._cmpTileImg = null;
      changed = true;
    }
    if (this._cmpImg && this._cmpImg.opacity === 0) {
      this._cmpImg.set('opacity', this._cmpOpacity);
      changed = true;
    }
    if (changed) this.canvas.requestRenderAll();
  },

  /** Arrastra el tile del overlay junto al overlay, en vez de re-renderizarlo.
      El tile translúcido de "ajustar" lleva SÓLO la revisión, así que trasladarlo
      equivale exactamente a volver a rasterizarla en la posición nueva — y eso
      permite que el arrastre se vea nítido. Se mueve también la región que dice
      cubrir, para que `_tileCovers` sepa cuándo deja de alcanzar. */
  _dragCmpTile(this: MarkupLayer, dropIfUncovered = false) {
    const t = this._cmpTileImg, c = this._cmpImg;
    if (!t || !c || !t._anchor) return;
    const dx = c.left - t._anchor.cmpLeft, dy = c.top - t._anchor.cmpTop;
    t.left = t._anchor.left + dx;
    t.top  = t._anchor.top  + dy;
    if (t._tile) { t._tile.x = t._anchor.left + dx; t._tile.y = t._anchor.top + dy; }
    t.setCoords();
    /* Arrastrando más allá del margen, el tile deja de cubrir la vista y su borde
       quedaría a la vista con la revisión cortada. Se retira: vuelve a verse el
       overlay entero, de menos resolución, hasta que al soltar llegue el tile de
       la posición nueva. (La densidad 0 hace que sólo se compruebe la geometría.) */
    if (dropIfUncovered && !this._tileCovers(t, this._visibleLogicalRect(), 0)) {
      this._clearCmpTile();
    }
  },

  async _refreshCmpTile(this: MarkupLayer, rect, density) {
    const MARGIN = 1.05;
    if (density <= (this._cmpSS || 1) * MARGIN) { this._clearCmpTile(); return; }
    if (this._tileCovers(this._cmpTileImg, rect, density)) return;

    const req = this._tileRequestRect(rect);
    const reqId = ++this._cmpTileReqId;
    /* Ancla del arrastre. Se toma ANTES del render: el proveedor lee el
       desplazamiento actual al empezar, así que un ancla tomada después
       describiría una posición que no es la de la imagen devuelta. */
    const anchor = { left: req.x, top: req.y, cmpLeft: this._cmpImg.left, cmpTop: this._cmpImg.top };
    let res;
    try {
      res = await this.requestCompareRegion(req, density);
    } catch (err) {
      if (!this._isCancelled(err)) console.error('refreshCmpTile:', err);
      return;
    }
    if (reqId !== this._cmpTileReqId) return;
    // El proveedor puede declinar (p.ej. el diff aún no tiene su ráster base)
    if (!res || !(res.canvas || res.dataUrl)) { this._clearCmpTile(); return; }

    this._tileToImage(res, (img) => {
      if (reqId !== this._cmpTileReqId || !this._cmpImg) return;
      this._placeTile(img, req, res);
      img.name    = '__cmp_detail__';
      img._anchor = anchor;
      /* Un tile OPACO (el diff) se limita a tapar al overlay, que sigue visible:
         así el área que el tile aún no cubre enseña la misma imagen, sólo que
         menos nítida — nada de parpadeos al hacer pan.
         Uno TRANSLÚCIDO (la revisión al ajustarla) no puede superponerse al
         overlay: las dos capas se sumarían y el dibujo saldría más oscuro. Ahí sí
         hay que ocultar el overlay mientras el tile esté puesto. */
      const translucent = typeof res.opacity === 'number' && res.opacity < 1;
      if (translucent) img.set('opacity', res.opacity);

      if (this._cmpTileImg) this.canvas.remove(this._cmpTileImg);
      this._cmpTileImg = img;
      // Justo ENCIMA del overlay (que a su vez está sobre el fondo), bajo el markup
      const at = this.canvas.getObjects().indexOf(this._cmpImg);
      if (at >= 0) this.canvas.insertAt(img, at + 1, false);
      else         this.canvas.add(img);
      this._dragCmpTile();   // por si el overlay se movió durante el render
      if (translucent) this._cmpImg.set('opacity', 0);
      else if (this._cmpImg.opacity === 0) this._cmpImg.set('opacity', this._cmpOpacity);
      this.canvas.renderAll();
    });
  },

  /* ════════════════════════════════════════════════════════════════════
     COMPARACIÓN DE REVISIONES — overlay de la Revisión B sobre la A
     La imagen de B se escala al tamaño lógico de A y se inserta por encima
     del fondo pero por debajo del markup. No se serializa (isBackground).
     ════════════════════════════════════════════════════════════════════ */
  setCompareOverlay(this: MarkupLayer, 
    source: string | HTMLCanvasElement, imgW: number, imgH: number,
    opts: {
      opacity?: number; tint?: string | null; interactive?: boolean;
      offsetX?: number; offsetY?: number; onMove?: ((left: number, top: number) => void) | null;
    } = {},
  ) {
    const { opacity = 0.5, tint = null, interactive = false, offsetX = 0, offsetY = 0, onMove = null } = opts;
    return new Promise<void>(resolve => {
      this.clearCompareOverlay();
      if (!source || !this._pdfW) { resolve(); return; }
      const build = (img) => {
        img.set({
          left: offsetX, top: offsetY,
          scaleX: this._pdfW / imgW,
          scaleY: this._pdfH / imgH,
          // En modo "ajustar" el overlay es arrastrable (para alinear las revisiones)
          selectable: interactive, evented: interactive,
          hasControls: false, hasBorders: interactive,
          lockScalingX: true, lockScalingY: true, lockRotation: true,
          hoverCursor: interactive ? 'move' : 'default',
          opacity,
        });
        img.isBackground = true;   // no se guarda como markup
        img.isCompare    = true;
        img.name         = '__cmp__';
        if (tint && fabric.Image.filters && fabric.Image.filters.BlendColor) {
          img.filters = [ new fabric.Image.filters.BlendColor({ color: tint, mode: 'tint', alpha: 0.55 }) ];
          img.applyFilters();
        }
        if (interactive) {
          // Encima de todo para poder arrastrarlo en cualquier zona
          this.canvas.add(img);
          this.canvas.setActiveObject(img);
          // El tile de detalle acompaña al arrastre (ver _dragCmpTile), así que la
          // revisión se ve nítida MIENTRAS se mueve; al soltar se pide uno nuevo
          // sólo si el desplazamiento la ha sacado de lo que el tile cubría.
          img.on('moving', () => { this._dragCmpTile(true); if (onMove) onMove(img.left, img.top); });
          img.on('modified', () => {
            this._dragCmpTile(true);
            if (onMove) onMove(img.left, img.top);
            this._scheduleDetail();
          });
        } else {
          // Encima de los fondos (bg + detalle), bajo el markup
          const bgCount = this.canvas.getObjects().filter(o => o.isBackground).length;
          this.canvas.insertAt(img, bgCount, false);
        }
        this._cmpImg      = img;
        this._cmpSS       = imgW / this._pdfW;   // resolución efectiva del overlay
        this._cmpDragging = interactive;
        this._cmpOpacity  = opacity;   // la real: `img.opacity` se anula bajo un tile translúcido
        this.canvas.renderAll();
        // Con el overlay puesto, el tile de detalle debe pasar a servir el diff
        this._clearDetail();
        this._scheduleDetail();
        resolve();
      };
      // `source` puede ser un <canvas> ya pintado (ruta rápida, sin PNG) o una URL
      if (typeof source !== 'string') build(new fabric.Image(source));
      else fabric.Image.fromURL(source, build);
    });
  },

  clearCompareOverlay(this: MarkupLayer) {
    if (!this._cmpImg) return;
    this.canvas.remove(this._cmpImg);
    this._cmpImg = null;
    this._cmpSS = 0;
    this._cmpDragging = false;
    // El tile que hubiera era del diff: descartarlo y volver al detalle del plano
    this._clearDetail();
    this.canvas.renderAll();
    this._scheduleDetail();
  },

  /** Desplaza el overlay de comparación (modo ajustar) por dx/dy en unidades del
      plano — usado por las flechas del teclado. Devuelve la nueva posición. */
  nudgeCompareOverlay(this: MarkupLayer, dx, dy) {
    if (!this._cmpImg) return null;
    this._cmpImg.left += dx;
    this._cmpImg.top  += dy;
    this._cmpImg.setCoords();
    this._dragCmpTile(true);  // el tile de detalle sigue al overlay
    this.canvas.renderAll();
    this._scheduleDetail();   // y se rehace si ya no alcanza a cubrir la vista
    return { left: this._cmpImg.left, top: this._cmpImg.top };
  },
};
