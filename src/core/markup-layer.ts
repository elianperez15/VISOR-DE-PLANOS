/* ═══════════════════════════════════════════════════════════════════════
   MarkupLayer — capa de anotaciones Fabric.js v5 para visor de planos SAF

   Herramientas:
   select · pan · arrow · measure · angle · perimeter
   cloud  · rect · ellipse · highlight
   text   · note · callout · freehand · area · stamp · eraser
   ═══════════════════════════════════════════════════════════════════════ */

import { fabric } from 'fabric';
import { ScaleManager } from './scale-manager';

// El backend WebGL de filtros tiene un límite de textura (~2048 px): en imágenes
// grandes el filtro (p.ej. el tinte rojo del overlay) solo se aplica a la esquina
// superior izquierda. El backend 2D procesa la imagen completa sin ese límite.
if (fabric.Canvas2dFilterBackend) {
  fabric.filterBackend = new fabric.Canvas2dFilterBackend();
}

export class MarkupLayer {
  constructor(canvasId, options = {}) {
    this.scaleManager = options.scaleManager || new ScaleManager();

    this.canvas = new fabric.Canvas(canvasId, {
      selection             : true,
      preserveObjectStacking: true,
      stopContextMenu       : false,
      fireRightClick        : true,
      enableRetinaScaling   : true,   // usa devicePixelRatio → nitidez en pantallas HiDPI/Retina
    });

    // ── Estilo activo ──────────────────────────────────────────────────
    this.strokeColor = '#ef4444';
    this.fillColor   = 'rgba(239,68,68,0.10)';
    this.strokeWidth = 2;

    // ── Estado de dibujo ───────────────────────────────────────────────
    this.currentTool   = 'select';
    this._drawingPts   = [];
    this._isDrawing    = false;
    this._twoClick     = false;  // modo "dos puntos": esperando el segundo clic
    this._tempLine     = null;
    this._tempPoly     = null;
    this._mouseStart   = null;
    this._lastClick    = 0;    // ms del último mousedown (detección dbl-clic)
    this._isPanning    = false;
    this._panStart     = null;
    this._spaceDown    = false;  // barra espaciadora mantenida → pan temporal

    // ── Background (página PDF) ────────────────────────────────────────
    this._bgImage = null;
    this._pdfW    = 0;
    this._pdfH    = 0;  // ancho y alto LÓGICOS de la página (en puntos PDF)

    // ── Detalle de alta resolución (re-render dinámico tipo Procore) ───
    this._detailImg    = null;  // fabric.Image del tile de la región visible
    this._detailTimer  = null;  // debounce de _refreshDetail
    this._baseSS       = 1;     // supersample del fondo base (imageW / logicalW)
    this.requestRegion = null;  // (rect{x,y,w,h}, density) => Promise<{dataUrl,pxW,pxH}>
    this._detailReqId  = 0;     // descarta resultados obsoletos al hacer zoom/pan rápido
    this._cmpImg       = null;  // overlay de comparación de revisiones (Rev B sobre A)

    // ── Undo / Redo ────────────────────────────────────────────────────
    this._undoStack  = [];
    this._redoStack  = [];
    this._maxHistory = 60;
    this._skipSnap   = false;

    // ── Callbacks ─────────────────────────────────────────────────────
    this.onZoomChange  = null;  // (zoom: number) => void
    this.onUndoChange  = null;  // (undoLen, redoLen) => void
    this.onAreaReady   = null;  // (labelStr) => void
    this.onStampPick   = null;  // (x, y) => void — abre modal sello
    this.onImagePick   = null;  // (x, y) => void — abre selector de archivo de imagen
    this.onHint        = null;  // (msg: string) => void
    this.onAutoSelect  = null;  // () => void — al terminar de colocar la nube
    this.onAnnotHover  = null;  // (data|null, mouseEvent) => void — tooltip de autor
    this.onAnnotClick  = null;  // (fabricObj|null) => void — al seleccionar/deseleccionar
    this.onFollowLink  = null;  // (targetPage:number) => void — doble clic en hipervínculo
    this.onShowImage   = null;  // (dataUrl:string) => void — clic en miniatura de adjunto

    // ── Usuario actual ─────────────────────────────────────────────────
    this.currentUser = 'Anónimo';

    this._init();
  }

  /* ════════════════════════════════════════════════════════════════════
     INIT
     ════════════════════════════════════════════════════════════════════ */
  _init() {
    this._bindCanvasEvents();
    this._bindKeyboard();
    this._sizeToContainer();

    if (typeof ResizeObserver !== 'undefined') {
      const wrapper = this.canvas.wrapperEl.parentElement;
      if (wrapper) new ResizeObserver(() => {
        this._sizeToContainer();
        if (this._bgImage) this._fitToCanvas();
      }).observe(wrapper);
    }
  }

  _sizeToContainer() {
    const el = this.canvas.wrapperEl.parentElement;
    if (!el) return;
    this.canvas.setWidth(el.clientWidth);
    this.canvas.setHeight(el.clientHeight);
    this.canvas.renderAll();
  }

  /* ════════════════════════════════════════════════════════════════════
     BACKGROUND (PDF)
     ════════════════════════════════════════════════════════════════════ */
  setBackground(dataUrl, imageWidth, imageHeight, logicalWidth, logicalHeight) {
    return new Promise(resolve => {
      if (this._bgImage) { this.canvas.remove(this._bgImage); this._bgImage = null; }
      this._clearDetail();
      this._pdfW = logicalWidth;
      this._pdfH = logicalHeight;
      this._baseSS = imageWidth / logicalWidth;  // resolución del fondo base

      fabric.Image.fromURL(dataUrl, img => {
        img.set({
          left: 0, top: 0,
          scaleX: logicalWidth  / imageWidth,
          scaleY: logicalHeight / imageHeight,
          selectable: false, evented: false,
          hasControls: false, hasBorders: false,
          lockMovementX: true, lockMovementY: true,
        });
        img.isBackground = true;
        img.name = '__pdf_bg__';

        this.canvas.add(img);
        this.canvas.sendToBack(img);
        this._bgImage = img;
        this._fitToCanvas();
        this.canvas.renderAll();
        resolve();
      });
    });
  }

  _fitToCanvas() {
    const cw = this.canvas.width, ch = this.canvas.height;
    const zoom = Math.min(cw / this._pdfW, ch / this._pdfH) * 0.92;
    this.canvas.setViewportTransform([
      zoom, 0, 0, zoom,
      (cw - this._pdfW * zoom) / 2,
      (ch - this._pdfH * zoom) / 2,
    ]);
    this.onZoomChange && this.onZoomChange(zoom);
    this._scheduleDetail();
  }

  /* ════════════════════════════════════════════════════════════════════
     DETALLE DE ALTA RESOLUCIÓN — re-render dinámico de la región visible
     Mantiene nitidez a cualquier zoom sin rasterizar toda la página en alta
     resolución: solo se re-rasteriza lo que está a la vista (enfoque Procore).
     ════════════════════════════════════════════════════════════════════ */

  /** Rectángulo visible del plano en coordenadas LÓGICAS (puntos PDF) */
  _visibleLogicalRect() {
    const vt = this.canvas.viewportTransform;
    const z  = vt[0] || 1;
    const cw = this.canvas.getWidth(), ch = this.canvas.getHeight();
    let x1 = (0  - vt[4]) / z, y1 = (0  - vt[5]) / z;
    let x2 = (cw - vt[4]) / z, y2 = (ch - vt[5]) / z;
    x1 = Math.max(0, Math.min(x1, this._pdfW));
    y1 = Math.max(0, Math.min(y1, this._pdfH));
    x2 = Math.max(0, Math.min(x2, this._pdfW));
    y2 = Math.max(0, Math.min(y2, this._pdfH));
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1, zoom: z };
  }

  _clearDetail() {
    if (this._detailTimer) { clearTimeout(this._detailTimer); this._detailTimer = null; }
    if (this._detailImg)   { this.canvas.remove(this._detailImg); this._detailImg = null; }
    this._detailReqId++;   // invalida cualquier render en vuelo
  }

  /** Programa un refresco del tile de detalle (debounce tras zoom/pan) */
  _scheduleDetail() {
    if (!this.requestRegion || !this._bgImage) return;
    if (this._detailTimer) clearTimeout(this._detailTimer);
    this._detailTimer = setTimeout(() => this._refreshDetail(), 180);
  }

  async _refreshDetail() {
    if (!this.requestRegion || !this._bgImage) return;
    const dpr  = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    const rect = this._visibleLogicalRect();
    if (rect.w <= 0 || rect.h <= 0) return;

    const density = rect.zoom * dpr;  // px de pantalla por unidad lógica
    // Si el fondo base ya tiene resolución suficiente para este zoom, no hace falta detalle
    if (density <= this._baseSS * 1.05) { this._clearDetail(); return; }

    const reqId = ++this._detailReqId;
    let res;
    try {
      res = await this.requestRegion({ x: rect.x, y: rect.y, w: rect.w, h: rect.h }, density);
    } catch (e) {
      console.error('refreshDetail:', e);
      return;
    }
    // Descartar si el viewport ya cambió (otro refresh ganó la carrera)
    if (reqId !== this._detailReqId || !res || !res.dataUrl) return;

    fabric.Image.fromURL(res.dataUrl, img => {
      if (reqId !== this._detailReqId) return;  // re-chequear tras la carga async
      img.set({
        left: rect.x, top: rect.y,
        scaleX: rect.w / res.pxW,
        scaleY: rect.h / res.pxH,
        selectable: false, evented: false,
        hasControls: false, hasBorders: false,
        objectCaching: false,
      });
      img.isBackground = true;
      img.name = '__pdf_detail__';

      if (this._detailImg) this.canvas.remove(this._detailImg);
      this._detailImg = img;
      this.canvas.add(img);
      // Orden z: fondo base atrás, detalle encima del base, markup arriba de todo
      this.canvas.sendToBack(img);
      if (this._bgImage) this.canvas.sendToBack(this._bgImage);
      this.canvas.renderAll();
    });
  }

  /* ════════════════════════════════════════════════════════════════════
     COMPARACIÓN DE REVISIONES — overlay de la Revisión B sobre la A
     La imagen de B se escala al tamaño lógico de A y se inserta por encima
     del fondo pero por debajo del markup. No se serializa (isBackground).
     ════════════════════════════════════════════════════════════════════ */
  setCompareOverlay(dataUrl, imgW, imgH, opts = {}) {
    const { opacity = 0.5, tint = null } = opts;
    return new Promise(resolve => {
      this.clearCompareOverlay();
      if (!dataUrl || !this._pdfW) { resolve(); return; }
      fabric.Image.fromURL(dataUrl, img => {
        img.set({
          left: 0, top: 0,
          scaleX: this._pdfW / imgW,
          scaleY: this._pdfH / imgH,
          selectable: false, evented: false,
          hasControls: false, hasBorders: false,
          opacity,
        });
        img.isBackground = true;   // no se guarda como markup
        img.isCompare    = true;
        img.name         = '__cmp__';
        if (tint && fabric.Image.filters && fabric.Image.filters.BlendColor) {
          img.filters = [ new fabric.Image.filters.BlendColor({ color: tint, mode: 'tint', alpha: 0.55 }) ];
          img.applyFilters();
        }
        // Insertar justo encima de los fondos (bg + detalle), bajo el markup
        const bgCount = this.canvas.getObjects().filter(o => o.isBackground).length;
        this.canvas.insertAt(img, bgCount, false);
        this._cmpImg = img;
        this.canvas.renderAll();
        resolve();
      });
    });
  }

  clearCompareOverlay() {
    if (this._cmpImg) { this.canvas.remove(this._cmpImg); this._cmpImg = null; this.canvas.renderAll(); }
  }

  setCompareOpacity(o) {
    if (this._cmpImg) { this._cmpImg.set('opacity', o); this.canvas.renderAll(); }
  }

  hasCompareOverlay() { return !!this._cmpImg; }

  /* ════════════════════════════════════════════════════════════════════
     HERRAMIENTAS
     ════════════════════════════════════════════════════════════════════ */
  setTool(tool) {
    this._cancelDrawing();
    this.currentTool = tool;

    const isSelect   = tool === 'select';
    const isFreehand = tool === 'freehand';
    const isPan      = tool === 'pan';
    const isEraser   = tool === 'eraser';

    this.canvas.isDrawingMode = isFreehand;
    this.canvas.selection     = isSelect;

    if (isFreehand) {
      const b = new fabric.PencilBrush(this.canvas);
      b.color = this.strokeColor; b.width = this.strokeWidth;
      this.canvas.freeDrawingBrush = b;
    }

    const cursor = isSelect ? 'default'
                 : isPan    ? 'grab'
                 : isEraser ? 'cell'
                 : 'crosshair';
    this.canvas.defaultCursor = cursor;
    this.canvas.hoverCursor   = isEraser ? 'cell' : isSelect ? 'move' : cursor;
    this.canvas.discardActiveObject();
    this.canvas.renderAll();
  }

  setStrokeColor(c) {
    this.strokeColor = c;
    if (this.canvas.isDrawingMode && this.canvas.freeDrawingBrush)
      this.canvas.freeDrawingBrush.color = c;
  }
  setFillColor(c)   { this.fillColor   = c; }
  setStrokeWidth(w) {
    this.strokeWidth = parseInt(w,10) || 2;
    if (this.canvas.isDrawingMode && this.canvas.freeDrawingBrush)
      this.canvas.freeDrawingBrush.width = this.strokeWidth;
  }

  /* ════════════════════════════════════════════════════════════════════
     EVENTOS CANVAS
     ════════════════════════════════════════════════════════════════════ */
  _bindCanvasEvents() {
    this.canvas.on('mouse:wheel',  e => this._onWheel(e));
    this.canvas.on('mouse:down',   e => this._onDown(e));
    this.canvas.on('mouse:move',   e => this._onMove(e));
    this.canvas.on('mouse:up',     e => this._onUp(e));

    // Doble clic en el plano → acercar (Alt = alejar) hacia el punto
    this.canvas.on('mouse:dblclick', opt => {
      if (this._isDrawing) return;
      if (opt.target && !opt.target.isBackground) return;  // no interferir con objetos/texto
      this._zoomBy(opt.e.altKey ? 0.5 : 2, opt.e.offsetX, opt.e.offsetY);
    });

    // Snapshot para undo/redo
    const snap = e => { if (!e.target?.isBackground && !this._skipSnap) this._snapshot(); };
    this.canvas.on('object:added',    snap);
    this.canvas.on('object:modified', snap);
    this.canvas.on('object:removed',  snap);
    this.canvas.on('path:created',    opt => {
      if (opt.path) {
        opt.path.data = { type:'freehand', autor:this.currentUser, fecha:new Date().toISOString() };
        this._snapshot();
      }
    });

    // Tooltip de autor al pasar el cursor
    this.canvas.on('mouse:over', opt => {
      if (opt.target && !opt.target.isBackground && opt.target.data?.autor) {
        this.onAnnotHover && this.onAnnotHover(opt.target.data, opt.e);
      }
    });
    this.canvas.on('mouse:out', opt => {
      if (opt.target && !opt.target.isBackground) {
        this.onAnnotHover && this.onAnnotHover(null, null);
      }
    });

    // Panel de propiedades: abre al seleccionar una anotación en modo select
    this.canvas.on('selection:created', opt => {
      if (this.currentTool !== 'select') return;
      const obj = opt.selected?.[0];
      if (obj && !obj.isBackground) this.onAnnotClick && this.onAnnotClick(obj);
    });
    this.canvas.on('selection:updated', opt => {
      if (this.currentTool !== 'select') return;
      const obj = opt.selected?.[0];
      if (obj && !obj.isBackground) this.onAnnotClick && this.onAnnotClick(obj);
    });
    this.canvas.on('selection:cleared', () => {
      // No forzamos cierre — el panel permanece abierto para que el
      // usuario pueda completar el formulario sin perder datos.
      // Se cierra explícitamente con los botones ✕ / Cancelar.
    });

    // Doble-clic en una figura → editar su texto/etiqueta
    this.canvas.on('mouse:dblclick', opt => {
      const obj = opt.target;
      if (!obj || obj.isBackground) return;
      if (obj.data?.type === 'link')             this.onFollowLink && this.onFollowLink(obj.data.targetPage);
      else if (obj.data?.type === 'photo-pin')   { const a = this._firstImageAttachment(obj); if (a) this.onShowImage && this.onShowImage(a.dataUrl); }
      else if (obj.data?.type === 'cloud')       this._editCloudLabel(obj);
      else if (this._isLabelable(obj))           this._editLabel(obj);
    });

    // Sincronizar etiqueta al mover / escalar / rotar la figura
    ['object:moving', 'object:scaling', 'object:rotating', 'object:modified'].forEach(ev => {
      this.canvas.on(ev, opt => {
        const obj = opt.target;
        if (!obj) return;
        if (obj.data?.type === 'cloud' && obj.data?.cloudId) this._syncCloudLabel(obj);
        else if (obj.data?.labelId)                          this._syncLabel(obj);
        if (obj.data?.labelId)                               this._syncThumb(obj);
      });
    });
  }

  /* ── Rueda / trackpad: zoom o pan según el gesto (inteligente) ────── */
  _onWheel(opt) {
    const e = opt.e;
    e.preventDefault(); e.stopPropagation();

    // Pinza del trackpad o Ctrl/Cmd + rueda → ZOOM hacia el cursor
    const zoomGesture = e.ctrlKey || e.metaKey;
    // Heurística mouse vs trackpad: la rueda de mouse llega en pasos grandes,
    // enteros y sin componente horizontal; el trackpad manda deltas finos/diagonales.
    const mouseWheel = !zoomGesture && e.deltaX === 0 &&
                       Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 40;

    if (zoomGesture || mouseWheel) {
      this._zoomBy(Math.exp(-e.deltaY * 0.0015), e.offsetX, e.offsetY);
    } else {
      // Trackpad de dos dedos → DESPLAZAR el plano
      this.canvas.relativePan({ x: -e.deltaX, y: -e.deltaY });
      this._scheduleDetail();
    }
  }

  /** Zoom multiplicativo acotado, centrado en el punto (x,y) del canvas */
  _zoomBy(factor, x, y) {
    let z = this.canvas.getZoom() * factor;
    z = Math.min(Math.max(z, 0.04), 20);
    this.canvas.zoomToPoint({ x, y }, z);
    this.onZoomChange && this.onZoomChange(z);
    this._scheduleDetail();
  }

  /* ── Mouse down ───────────────────────────────────────────────────── */
  _onDown(opt) {
    const ptr  = this.canvas.getPointer(opt.e);
    const tool = this.currentTool;

    // Clic en una miniatura de adjunto → ver la imagen en grande
    if (opt.target?.data?.type === 'att-thumb') {
      this.onShowImage && this.onShowImage(opt.target.data.src);
      return;
    }

    // Eraser: borrar objeto bajo cursor
    if (tool === 'eraser') {
      const tgt = opt.target;
      if (tgt && !tgt.isBackground) {
        // Eliminar también su etiqueta de texto enlazada
        if (tgt.data?.type === 'cloud' && tgt.data?.cloudId) this._removeCloudLabel(tgt.data.cloudId);
        if (tgt.data?.labelId) { this._removeLabel(tgt.data.labelId); this._removeThumb(tgt.data.labelId); }
        this.canvas.remove(tgt);
        this.canvas.discardActiveObject();
        this.canvas.renderAll();
      }
      return;
    }

    // Pan: botón medio · herramienta pan · barra espaciadora mantenida
    if (opt.e.button === 1 || tool === 'pan' || this._spaceDown) {
      this._isPanning = true;
      this._panStart  = { x: opt.e.clientX, y: opt.e.clientY };
      this.canvas.setCursor('grabbing');
      opt.e.preventDefault();
      return;
    }

    if (tool === 'select' || tool === 'freehand') return;
    opt.e.preventDefault();

    // Detección de doble-clic manual
    const now  = Date.now();
    const isDbl = now - this._lastClick < 360;
    this._lastClick = now;

    switch (tool) {
      // ── Herramientas de arrastre ────────────────────────────────────
      case 'arrow':
      case 'measure':
      case 'rect':
      case 'ellipse':
      case 'highlight':
      case 'link':
      case 'cloud':
        if (this._twoClick && this._mouseStart) {
          // segundo clic → colocar la figura entre los dos puntos
          this._removeTempLine();
          this._finishShape(tool, this._mouseStart, ptr);
          this._twoClick = false; this._mouseStart = null;
        } else if (!this._isDrawing) {
          this._isDrawing  = true;
          this._mouseStart = { x: ptr.x, y: ptr.y };
        }
        break;

      // ── Herramientas de multi-clic (cierre con Enter/Esc) ───────────
      case 'area':
      case 'perimeter':
        if (isDbl) { this._finalizeMultiPoint(); }
        else       { this._drawingPts.push({x:ptr.x,y:ptr.y}); this._isDrawing=true; this._updateTempPoly(ptr); }
        break;

      // ── Ángulo: exactamente 3 clics ─────────────────────────────────
      case 'angle':
        this._drawingPts.push({x:ptr.x,y:ptr.y});
        this._isDrawing = true;
        this._updateTempPoly(ptr);
        this._hint(this._drawingPts.length===1
          ? '∠ Clic en el extremo del primer brazo'
          : '∠ Clic en el extremo del segundo brazo');
        if (this._drawingPts.length >= 3) this._finalizeMultiPoint();
        break;

      // ── Texto ────────────────────────────────────────────────────────
      case 'text':    this._addText(ptr);    break;
      case 'note':    this._addNote(ptr);    break;
      case 'callout': this._addCallout(ptr); break;

      // ── Sello ────────────────────────────────────────────────────────
      case 'stamp':
        this._pendingStampPos = { x: ptr.x, y: ptr.y };
        this.onStampPick && this.onStampPick(ptr.x, ptr.y);
        break;

      // ── Imagen ───────────────────────────────────────────────────────
      case 'image':
        this._pendingImagePos = { x: ptr.x, y: ptr.y };
        this.onImagePick && this.onImagePick(ptr.x, ptr.y);
        break;
    }
  }

  /* ── Mouse move ───────────────────────────────────────────────────── */
  _onMove(opt) {
    const ptr = this.canvas.getPointer(opt.e);

    if (this._isPanning && this._panStart) {
      this.canvas.relativePan({ x: opt.e.clientX-this._panStart.x, y: opt.e.clientY-this._panStart.y });
      this._panStart = { x: opt.e.clientX, y: opt.e.clientY };
      return;
    }

    const tool = this.currentTool;
    const dragTools = ['arrow','measure','rect','ellipse','highlight','link','cloud'];

    // Modo dos-puntos: tras el primer clic, la preview sigue al cursor sin botón
    if (this._twoClick && this._mouseStart && dragTools.includes(tool)) {
      this._updateTempPreview(this._mouseStart, ptr);
      return;
    }

    if (!this._isDrawing) return;

    if (dragTools.includes(tool)) {
      this._updateTempPreview(this._mouseStart, ptr);
    } else if (['area','perimeter','angle'].includes(tool)) {
      this._updateTempPoly(ptr);
    }
  }

  /* ── Mouse up ─────────────────────────────────────────────────────── */
  _onUp(opt) {
    if (this._isPanning) {
      this._isPanning = false; this._panStart = null;
      this.canvas.setCursor(this.currentTool==='pan'?'grab':'crosshair');
      this._scheduleDetail();
      return;
    }

    const tool = this.currentTool;
    if (!this._isDrawing || ['select','freehand','area','perimeter','angle','text','note','callout','stamp','eraser'].includes(tool)) return;

    const ptr   = this.canvas.getPointer(opt.e);
    const start = this._mouseStart;
    if (!start) return;

    const dist = Math.hypot(ptr.x-start.x, ptr.y-start.y);

    if (dist >= 5) {
      // Fue un arrastre → colocar la figura entre los dos extremos
      this._removeTempLine();
      this._isDrawing = false;
      this._finishShape(tool, start, ptr);
      this._mouseStart = null;
    } else {
      // Fue un clic simple → modo "dos puntos": la preview sigue al cursor
      // y el siguiente clic coloca la figura.
      this._isDrawing = false;
      this._twoClick  = true;
      this._hint && this._hint('Clic en el segundo punto para colocar la figura · Esc cancela');
    }
  }

  /** Coloca la figura final del tipo dado entre dos puntos y la deja seleccionada */
  _finishShape(tool, start, end) {
    if (tool === 'cloud') { this._addCloudFromRect(start.x, start.y, end.x, end.y); return; }
    switch (tool) {
      case 'arrow':     this._addArrow    (start.x,start.y,end.x,end.y); break;
      case 'measure':   this._addDimension(start.x,start.y,end.x,end.y); break;
      case 'rect':      this._addRect     (start.x,start.y,end.x,end.y); break;
      case 'ellipse':   this._addEllipse  (start.x,start.y,end.x,end.y); break;
      case 'highlight': this._addHighlight(start.x,start.y,end.x,end.y); break;
      case 'link':      this._addLink     (start.x,start.y,end.x,end.y); break;
    }
    // Volver a "Seleccionar" con la figura activa y abrir sus propiedades
    const created = this.canvas.getActiveObject();
    if (this.onAutoSelect) this.onAutoSelect();
    if (created) {
      this.canvas.setActiveObject(created);
      this.canvas.renderAll();
      this.onAnnotClick && this.onAnnotClick(created);
    }
  }

  /** Preview en vivo con la FORMA real de la figura (no solo una línea) */
  _updateTempPreview(start, end) {
    this._removeTempLine();
    const tool = this.currentTool;
    const base = {
      stroke: this.strokeColor, strokeWidth: this.strokeWidth,
      strokeDashArray: [6,4], fill: 'transparent',
      selectable: false, evented: false, opacity: 0.85,
    };
    const L = Math.min(start.x,end.x), T = Math.min(start.y,end.y);
    const W = Math.abs(end.x-start.x), Hh = Math.abs(end.y-start.y);
    let g;
    if (tool === 'arrow' || tool === 'measure') {
      g = new fabric.Line([start.x,start.y,end.x,end.y], base);
    } else if (tool === 'ellipse') {
      g = new fabric.Ellipse(Object.assign({ left:L, top:T, rx:W/2, ry:Hh/2 }, base));
    } else if (tool === 'cloud' && W > 4 && Hh > 4) {
      // Previsualizar la nube real (festones) en lugar de un rectángulo
      const d = this._revisionCloudPath(L, T, W, Hh);
      g = new fabric.Path(d, Object.assign({ strokeLineJoin:'round', strokeLineCap:'round' }, base));
    } else {
      g = new fabric.Rect(Object.assign({ left:L, top:T, width:W, height:Hh }, base));
    }
    this._tempLine = g;
    this.canvas.add(g);
    this.canvas.renderAll();
  }

  /* ════════════════════════════════════════════════════════════════════
     TECLADO
     ════════════════════════════════════════════════════════════════════ */
  _bindKeyboard() {
    this._keyFn = e => {
      const tag = document.activeElement.tagName;
      if (tag==='INPUT'||tag==='TEXTAREA') return;

      if (e.key==='Enter' && this._isDrawing) { this._finalizeMultiPoint(); return; }
      if (e.key==='Escape')                   { this._cancelDrawing();       return; }

      if ((e.key==='Delete'||e.key==='Backspace')) {
        const obj = this.canvas.getActiveObject();
        if (obj && !obj.isBackground) {
          if (obj.isEditing) return; // texto en edición
          // Eliminar también su etiqueta de texto enlazada
          if (obj.data?.type === 'cloud' && obj.data?.cloudId) this._removeCloudLabel(obj.data.cloudId);
          if (obj.data?.labelId) { this._removeLabel(obj.data.labelId); this._removeThumb(obj.data.labelId); }
          this.canvas.remove(obj);
          this.canvas.discardActiveObject();
          this.canvas.renderAll();
        }
      }
    };
    document.addEventListener('keydown', this._keyFn);

    // Barra espaciadora mantenida → pan temporal (se restaura al soltar)
    document.addEventListener('keydown', e => {
      const tag = document.activeElement.tagName;
      if (tag==='INPUT'||tag==='TEXTAREA') return;
      if (e.code === 'Space' && !this._spaceDown) {
        this._spaceDown = true;
        this.canvas.selection = false;          // sin rectángulo de selección al panear
        this.canvas.defaultCursor = 'grab';
        this.canvas.setCursor('grab');
        e.preventDefault();
      }
    });
    document.addEventListener('keyup', e => {
      if (e.code === 'Space') {
        this._spaceDown = false;
        this.canvas.selection = (this.currentTool === 'select');
        this.canvas.defaultCursor = this.currentTool==='pan' ? 'grab' : 'default';
        this.canvas.setCursor(this.canvas.defaultCursor);
      }
    });
  }

  /* ════════════════════════════════════════════════════════════════════
     TEMPORALES (rubber-band)
     ════════════════════════════════════════════════════════════════════ */
  _updateTempLine(start, end) {
    this._removeTempLine();
    this._tempLine = new fabric.Line([start.x,start.y,end.x,end.y], {
      stroke: this.strokeColor, strokeWidth: this.strokeWidth,
      strokeDashArray: [5,4], selectable: false, evented: false,
    });
    this.canvas.add(this._tempLine);
    this.canvas.renderAll();
  }

  _removeTempLine() {
    if (this._tempLine) { this.canvas.remove(this._tempLine); this._tempLine=null; }
  }

  _updateTempPoly(cur) {
    if (this._tempPoly) { this.canvas.remove(this._tempPoly); this._tempPoly=null; }
    if (!this._drawingPts.length) return;
    const pts = [...this._drawingPts, {x:cur.x,y:cur.y}];
    this._tempPoly = new fabric.Polyline(pts, {
      stroke: this.strokeColor, strokeWidth: this.strokeWidth,
      fill: 'transparent', strokeDashArray: [5,4],
      selectable: false, evented: false,
    });
    this.canvas.add(this._tempPoly);
    this.canvas.renderAll();
  }

  _cancelDrawing() {
    this._isDrawing=false; this._twoClick=false; this._drawingPts=[]; this._mouseStart=null;
    this._removeTempLine();
    if (this._tempPoly) { this.canvas.remove(this._tempPoly); this._tempPoly=null; }
    this.canvas.renderAll();
  }

  /* ════════════════════════════════════════════════════════════════════
     FINALIZAR MULTI-CLIC
     ════════════════════════════════════════════════════════════════════ */
  _finalizeMultiPoint() {
    const pts  = this._drawingPts.slice();
    const tool = this.currentTool;
    this._cancelDrawing();

    if (pts.length < 2) return;

    switch (tool) {
      case 'area':      this._addArea     (pts); break;
      case 'perimeter': this._addPerimeter(pts); break;
      case 'angle':     if (pts.length>=3) this._addAngle(pts[0],pts[1],pts[2]); break;
    }
  }

  /* ════════════════════════════════════════════════════════════════════
     CREAR OBJETOS
     ════════════════════════════════════════════════════════════════════ */

  /* ── Flecha ─────────────────────────────────────────────────────────── */
  _addArrow(x1,y1,x2,y2) {
    const ang  = Math.atan2(y2-y1,x2-x1)*(180/Math.PI);
    const size = Math.max(10,this.strokeWidth*5);
    const grp  = new fabric.Group([
      new fabric.Line([x1,y1,x2,y2],{stroke:this.strokeColor,strokeWidth:this.strokeWidth,selectable:false}),
      new fabric.Triangle({left:x2,top:y2,width:size,height:size,fill:this.strokeColor,stroke:this.strokeColor,angle:ang+90,originX:'center',originY:'center',selectable:false}),
    ]);
    grp.data = { type:'arrow' };
    this._place(grp);
  }

  /* ── Dimensión / Cota ───────────────────────────────────────────────── */
  _addDimension(x1,y1,x2,y2) {
    const dist  = this.scaleManager.distance(x1,y1,x2,y2);
    const label = this.scaleManager.format(dist);
    const ang   = Math.atan2(y2-y1,x2-x1)*(180/Math.PI);
    const perpR = (ang+90)*Math.PI/180;
    const tick  = 10, sw = this.strokeWidth, sz = Math.max(8,sw*4);
    const dx    = Math.cos(perpR)*tick, dy = Math.sin(perpR)*tick;
    const mx=(x1+x2)/2, my=(y1+y2)/2;

    const grp = new fabric.Group([
      new fabric.Line([x1,y1,x2,y2],{stroke:this.strokeColor,strokeWidth:sw,selectable:false}),
      new fabric.Line([x1-dx,y1-dy,x1+dx,y1+dy],{stroke:this.strokeColor,strokeWidth:sw,selectable:false}),
      new fabric.Line([x2-dx,y2-dy,x2+dx,y2+dy],{stroke:this.strokeColor,strokeWidth:sw,selectable:false}),
      new fabric.Triangle({left:x1,top:y1,width:sz,height:sz,fill:this.strokeColor,stroke:this.strokeColor,angle:ang-90,originX:'center',originY:'center',selectable:false}),
      new fabric.Triangle({left:x2,top:y2,width:sz,height:sz,fill:this.strokeColor,stroke:this.strokeColor,angle:ang+90,originX:'center',originY:'center',selectable:false}),
      new fabric.Text(label,{left:mx,top:my-18,fontSize:14,fontFamily:'Arial',fill:this.strokeColor,backgroundColor:'#1c213099',originX:'center',originY:'bottom',selectable:false}),
    ]);
    grp.data = { type:'dimension', label };
    this._place(grp);
  }

  /* ── Ángulo ─────────────────────────────────────────────────────────── */
  _addAngle(vertex, a1, a2) {
    const ang1 = Math.atan2(a1.y-vertex.y, a1.x-vertex.x);
    const ang2 = Math.atan2(a2.y-vertex.y, a2.x-vertex.x);
    let   deg  = Math.abs((ang2-ang1) * 180/Math.PI);
    if (deg > 180) deg = 360 - deg;
    const label = deg.toFixed(1) + '°';
    const R = 30;
    const midAng = (ang1+ang2)/2;
    const arc = this._arcPath(vertex.x, vertex.y, R, ang1, ang2);

    const grp = new fabric.Group([
      new fabric.Line([vertex.x,vertex.y,a1.x,a1.y],{stroke:this.strokeColor,strokeWidth:this.strokeWidth,selectable:false}),
      new fabric.Line([vertex.x,vertex.y,a2.x,a2.y],{stroke:this.strokeColor,strokeWidth:this.strokeWidth,selectable:false}),
      new fabric.Path(arc,{stroke:this.strokeColor,strokeWidth:1,fill:'transparent',selectable:false}),
      new fabric.Text(label,{
        left:vertex.x+(R+16)*Math.cos(midAng),
        top :vertex.y+(R+16)*Math.sin(midAng),
        fontSize:13,fontFamily:'Arial',fill:this.strokeColor,
        backgroundColor:'#1c213099',originX:'center',originY:'center',selectable:false,
      }),
    ]);
    grp.data = { type:'angle', label };
    this._place(grp);
  }

  _arcPath(cx,cy,r,a1,a2) {
    const x1=cx+r*Math.cos(a1), y1=cy+r*Math.sin(a1);
    const x2=cx+r*Math.cos(a2), y2=cy+r*Math.sin(a2);
    let diff = a2-a1; if (diff<0) diff+=2*Math.PI;
    const la = diff > Math.PI ? 1 : 0;
    const sw = diff > 0 ? 1 : 0;
    return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${la} ${sw} ${x2.toFixed(2)} ${y2.toFixed(2)}`;
  }

  /* ── Rectángulo ─────────────────────────────────────────────────────── */
  _addRect(x1,y1,x2,y2) {
    const obj = new fabric.Rect({
      left:Math.min(x1,x2), top:Math.min(y1,y2),
      width:Math.abs(x2-x1), height:Math.abs(y2-y1),
      stroke:this.strokeColor, strokeWidth:this.strokeWidth, fill:this.fillColor,
    });
    obj.data = { type:'rect' };
    this._place(obj);
  }

  /* ── Elipse ─────────────────────────────────────────────────────────── */
  _addEllipse(x1,y1,x2,y2) {
    const rx = Math.abs(x2-x1)/2, ry = Math.abs(y2-y1)/2;
    const obj = new fabric.Ellipse({
      left:Math.min(x1,x2)+rx, top:Math.min(y1,y2)+ry, rx, ry,
      stroke:this.strokeColor, strokeWidth:this.strokeWidth, fill:this.fillColor,
      originX:'center', originY:'center',
    });
    obj.data = { type:'ellipse' };
    this._place(obj);
  }

  /* ── Highlight ──────────────────────────────────────────────────────── */
  _addHighlight(x1,y1,x2,y2) {
    const obj = new fabric.Rect({
      left:Math.min(x1,x2), top:Math.min(y1,y2),
      width:Math.abs(x2-x1), height:Math.abs(y2-y1),
      fill:'rgba(250,204,21,0.35)', stroke:'transparent', strokeWidth:0,
    });
    obj.data = { type:'highlight' };
    this._place(obj);
  }

  /* ── Hipervínculo a otra hoja (salta a una página al doble-clic) ─────── */
  _addLink(x1,y1,x2,y2) {
    const obj = new fabric.Rect({
      left:Math.min(x1,x2), top:Math.min(y1,y2),
      width:Math.abs(x2-x1), height:Math.abs(y2-y1),
      fill:'rgba(14,165,233,0.12)', stroke:'#0ea5e9', strokeWidth:1.5,
      strokeDashArray:[6,3], rx:3, ry:3,
      hoverCursor:'pointer',
    });
    obj.data = { type:'link', targetPage:null };
    this._place(obj);
  }

  /* ── Nube de revisión ───────────────────────────────────────────────── */
  _addCloud(pts) {
    const closed = [...pts, pts[0]];
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i=0;i<closed.length-1;i++) {
      const a=closed[i], b=closed[i+1];
      const dx=b.x-a.x, dy=b.y-a.y;
      const len=Math.sqrt(dx*dx+dy*dy), n=Math.max(2,Math.round(len/18)), r=len/n/2;
      for (let j=1;j<=n;j++){
        const t=j/n;
        d+=` A ${r.toFixed(1)} ${r.toFixed(1)} 0 0 1 ${(a.x+dx*t).toFixed(1)} ${(a.y+dy*t).toFixed(1)}`;
      }
    }
    const obj = new fabric.Path(d+' Z',{
      stroke:this.strokeColor, strokeWidth:this.strokeWidth, fill:this.fillColor,
    });
    obj.data = { type:'cloud', points: pts };
    this._place(obj);
  }

  /* ── Nube natural (drag o clic simple) ─────────────────────────────── */
  _addCloudFromRect(x1, y1, x2, y2) {
    const L = Math.min(x1,x2), T = Math.min(y1,y2);
    const W = Math.abs(x2-x1), H = Math.abs(y2-y1);

    const d = this._revisionCloudPath(L, T, W, H);
    const obj = new fabric.Path(d, {
      stroke         : this.strokeColor,
      strokeWidth    : this.strokeWidth,
      fill           : this.fillColor,
      strokeLineJoin : 'round',
      strokeLineCap  : 'round',
    });
    const cloudId = `cld-${Date.now().toString(36)}`;
    obj.data = { type: 'cloud', cloudId };
    this._place(obj);

    // Auto-volver a selección para poder moverla de inmediato
    if (this.onAutoSelect) {
      requestAnimationFrame(() => {
        this.setTool('select');
        this.onAutoSelect();
      });
    }
  }

  /* ── Path de nube natural con curvas Bézier ─────────────────────────── */
  /**
   * Nube de revisión estilo Procore/Bluebeam: festones (arcos) uniformes
   * recorriendo el perímetro del rectángulo, todos bombeados hacia afuera.
   */
  _revisionCloudPath(L, T, W, H) {
    // Radio del festón: proporcional al tamaño, acotado para que se vea parejo
    const R = Math.max(7, Math.min(20, Math.min(W, H) / 3));
    const corners = [
      [L,     T    ],   // sup-izq
      [L + W, T    ],   // sup-der
      [L + W, T + H],   // inf-der
      [L,     T + H],   // inf-izq   (sentido horario, y hacia abajo)
    ];
    let d = `M ${L.toFixed(1)} ${T.toFixed(1)} `;
    for (let i = 0; i < 4; i++) {
      const [x1, y1] = corners[i];
      const [x2, y2] = corners[(i + 1) % 4];
      const len = Math.hypot(x2 - x1, y2 - y1);
      const n   = Math.max(1, Math.round(len / (2 * R)));  // nº de festones en este lado
      const r   = (len / n) / 2;                            // radio que encaja exacto
      const ux  = (x2 - x1) / len, uy = (y2 - y1) / len;
      for (let k = 1; k <= n; k++) {
        const px = x1 + ux * (len * k / n);
        const py = y1 + uy * (len * k / n);
        // sweep=1 → el arco bomba hacia afuera al recorrer en sentido horario
        d += `A ${r.toFixed(1)} ${r.toFixed(1)} 0 0 1 ${px.toFixed(1)} ${py.toFixed(1)} `;
      }
    }
    return d + 'Z';
  }

  _naturalCloudPath(L, T, W, H) {
    // Coordenadas absolutas desde fracción (0–1)
    const p = (rx, ry) => `${(L + rx * W).toFixed(1)} ${(T + ry * H).toFixed(1)}`;

    // Elige 3 o 4 bumps según la proporción ancho/alto
    if (W / Math.max(H, 1) >= 2.2) {
      // ── 4 bumps (nube ancha) ────────────────────────────
      return [
        `M  ${p(0.04, 0.82)}`,
        `C  ${p(0.00, 0.82)} ${p(0.00, 0.60)} ${p(0.04, 0.50)}`,  // lado izq
        `C  ${p(0.04, 0.24)} ${p(0.22, 0.14)} ${p(0.28, 0.33)}`,  // bump izq
        `C  ${p(0.29, 0.39)} ${p(0.32, 0.39)} ${p(0.35, 0.29)}`,  // valle 1
        `C  ${p(0.35, 0.06)} ${p(0.55, 0.06)} ${p(0.55, 0.29)}`,  // bump ctr-izq
        `C  ${p(0.57, 0.37)} ${p(0.59, 0.37)} ${p(0.62, 0.28)}`,  // valle 2
        `C  ${p(0.62, 0.06)} ${p(0.82, 0.06)} ${p(0.82, 0.33)}`,  // bump ctr-der
        `C  ${p(0.84, 0.39)} ${p(0.86, 0.37)} ${p(0.88, 0.32)}`,  // valle 3
        `C  ${p(0.92, 0.18)} ${p(1.00, 0.36)} ${p(0.97, 0.52)}`,  // bump der
        `C  ${p(1.00, 0.62)} ${p(1.00, 0.82)} ${p(0.96, 0.82)}`,  // lado der
        `C  ${p(0.72, 0.97)} ${p(0.28, 0.97)} ${p(0.04, 0.82)}`,  // base
        'Z',
      ].join(' ');
    } else {
      // ── 3 bumps (nube estándar) ─────────────────────────
      return [
        `M  ${p(0.06, 0.82)}`,
        `C  ${p(0.00, 0.82)} ${p(0.00, 0.62)} ${p(0.06, 0.52)}`,  // lado izq
        `C  ${p(0.06, 0.24)} ${p(0.28, 0.12)} ${p(0.36, 0.32)}`,  // bump izq
        `C  ${p(0.38, 0.38)} ${p(0.41, 0.38)} ${p(0.44, 0.30)}`,  // valle 1
        `C  ${p(0.44, 0.03)} ${p(0.70, 0.03)} ${p(0.70, 0.30)}`,  // bump central (mayor)
        `C  ${p(0.73, 0.38)} ${p(0.76, 0.38)} ${p(0.78, 0.32)}`,  // valle 2
        `C  ${p(0.84, 0.12)} ${p(1.00, 0.28)} ${p(0.96, 0.52)}`,  // bump der
        `C  ${p(1.00, 0.62)} ${p(1.00, 0.82)} ${p(0.94, 0.82)}`,  // lado der
        `C  ${p(0.70, 0.97)} ${p(0.30, 0.97)} ${p(0.06, 0.82)}`,  // base
        'Z',
      ].join(' ');
    }
  }

  /* ── Texto de nube (doble-clic) ─────────────────────────────────────── */
  _editCloudLabel(cloudObj) {
    const cloudId = cloudObj.data?.cloudId;
    if (!cloudId) return;

    // Buscar etiqueta existente
    let lbl = this.canvas.getObjects().find(
      o => o.data?.type === 'cloud-label' && o.data?.cloudId === cloudId
    );

    const center = cloudObj.getCenterPoint();

    if (!lbl) {
      // Crear IText centrado en la nube
      lbl = new fabric.IText('', {
        left      : center.x,
        top       : center.y,
        originX   : 'center',
        originY   : 'center',
        fontSize  : Math.round(Math.min(cloudObj.width, cloudObj.height) * 0.14 + 10),
        fontFamily: 'Arial',
        fill      : cloudObj.stroke || this.strokeColor,
        editable  : true,
        textAlign : 'center',
        selectable: true,
      });
      lbl.data = {
        type    : 'cloud-label',
        cloudId : cloudId,
        autor   : this.currentUser,
        fecha   : new Date().toISOString(),
      };
      this._skipSnap = true;
      this.canvas.add(lbl);
      this._skipSnap = false;

      // Al salir del modo edición: si está vacío, eliminar
      // (bandera para no agregar el listener más de una vez)
      lbl._exitHandlerBound = true;
      lbl.on('editing:exited', () => {
        if (!lbl.text.trim()) {
          this.canvas.remove(lbl);
          this.canvas.renderAll();
        } else {
          this._snapshot();
        }
      });
    }

    // Si la etiqueta ya existía (cargada de JSON), asegurar que el listener
    // de salida esté enlazado (solo una vez).
    if (!lbl._exitHandlerBound) {
      lbl._exitHandlerBound = true;
      lbl.on('editing:exited', () => {
        if (!lbl.text.trim()) {
          this.canvas.remove(lbl);
          this.canvas.renderAll();
        } else {
          this._snapshot();
        }
      });
    }

    this.canvas.setActiveObject(lbl);
    lbl.enterEditing();
    lbl.selectAll();
    this.canvas.renderAll();
  }

  /* ════════════════════════════════════════════════════════════════════
     ETIQUETA DE TEXTO GENÉRICA (cualquier figura) — IText enlazada por labelId
     ════════════════════════════════════════════════════════════════════ */

  /** ¿La figura admite etiqueta de texto? (excluye textos, notas, callouts, fondos) */
  _isLabelable(obj) {
    const t = obj?.data?.type;
    return ['rect','ellipse','arrow','highlight','measure','area','perimeter','angle'].includes(t);
  }

  /** Busca la IText enlazada a una figura por su labelId */
  _findLabel(labelId) {
    return this.canvas.getObjects().find(
      o => o.data?.type === 'shape-label' && o.data?.labelId === labelId
    );
  }

  /** Texto actual de la etiqueta de una figura ('' si no tiene) */
  getLabelText(obj) {
    const lbl = obj?.data?.labelId ? this._findLabel(obj.data.labelId) : null;
    return lbl ? lbl.text : '';
  }

  /** Crea/actualiza/elimina la etiqueta de texto de una figura (desde el panel) */
  setLabelText(obj, text) {
    if (!obj) return;
    text = (text || '').trim();
    if (!obj.data) obj.data = {};
    if (!obj.data.labelId) obj.data.labelId = `lbl-${Date.now().toString(36)}`;
    let lbl = this._findLabel(obj.data.labelId);

    if (!text) { if (lbl) { this.canvas.remove(lbl); this.canvas.renderAll(); } return; }

    if (!lbl) {
      lbl = this._makeLabel(obj);
      this._skipSnap = true; this.canvas.add(lbl); this._skipSnap = false;
    }
    lbl.set('text', text);
    this._syncLabel(obj);
    this.canvas.renderAll();
  }

  /** Construye la IText centrada en la figura */
  _makeLabel(obj) {
    const c = obj.getCenterPoint();
    const lbl = new fabric.IText('', {
      left: c.x, top: c.y, originX:'center', originY:'center',
      fontSize: 16, fontFamily:'Arial', fill: obj.stroke || this.strokeColor,
      textAlign:'center', editable:true, selectable:true,
    });
    lbl.data = {
      type:'shape-label', labelId: obj.data.labelId,
      autor:this.currentUser, fecha:new Date().toISOString(),
    };
    this._bindLabelExit(lbl);
    return lbl;
  }

  _bindLabelExit(lbl) {
    if (lbl._exitHandlerBound) return;
    lbl._exitHandlerBound = true;
    lbl.on('editing:exited', () => {
      if (!lbl.text.trim()) { this.canvas.remove(lbl); this.canvas.renderAll(); }
      else this._snapshot();
    });
  }

  /** Doble-clic: edita la etiqueta in-situ */
  _editLabel(obj) {
    if (!obj.data) obj.data = {};
    if (!obj.data.labelId) obj.data.labelId = `lbl-${Date.now().toString(36)}`;
    let lbl = this._findLabel(obj.data.labelId);
    if (!lbl) {
      lbl = this._makeLabel(obj);
      this._skipSnap = true; this.canvas.add(lbl); this._skipSnap = false;
    } else {
      this._bindLabelExit(lbl);
    }
    this.canvas.setActiveObject(lbl);
    lbl.enterEditing();
    lbl.selectAll();
    this.canvas.renderAll();
  }

  /** Mueve la etiqueta al centro de su figura */
  _syncLabel(obj) {
    const lbl = obj?.data?.labelId ? this._findLabel(obj.data.labelId) : null;
    if (!lbl) return;
    const c = obj.getCenterPoint();
    lbl.set({ left: c.x, top: c.y });
    lbl.setCoords();
  }

  _removeLabel(labelId) {
    const lbl = this._findLabel(labelId);
    if (lbl) this.canvas.remove(lbl);
  }

  /* ════════════════════════════════════════════════════════════════════
     MINIATURA DE ADJUNTO — preview de la primera imagen, fijada a la figura
     No se serializa (se regenera desde data.adjuntos). Clic → ver en grande.
     ════════════════════════════════════════════════════════════════════ */

  /** Devuelve el primer adjunto de tipo imagen de una figura, o null */
  _firstImageAttachment(obj) {
    const list = obj?.data?.adjuntos || [];
    return list.find(a => (a.type || '').startsWith('image/')) || null;
  }

  _findThumb(linkId) {
    return this.canvas.getObjects().find(
      o => o.data?.type === 'att-thumb' && o.data?.linkId === linkId
    );
  }

  _removeThumb(linkId) {
    const t = this._findThumb(linkId);
    if (t) this.canvas.remove(t);
  }

  /** Crea/actualiza/elimina la miniatura según los adjuntos de la figura */
  refreshThumb(obj) {
    if (!obj) return;
    if (!obj.data) obj.data = {};
    if (!obj.data.labelId) obj.data.labelId = `lbl-${Date.now().toString(36)}`;
    const linkId = obj.data.labelId;
    const att = this._firstImageAttachment(obj);
    const existing = this._findThumb(linkId);
    const show = !!att && obj.data.attShown !== false;   // visible por defecto

    if (!show) { if (existing) { this.canvas.remove(existing); this.canvas.renderAll(); } return; }

    // Si ya existe con la misma imagen, solo reposicionar
    if (existing && existing.data.src === att.dataUrl) { this._syncThumb(obj); return; }
    if (existing) this.canvas.remove(existing);

    fabric.Image.fromURL(att.dataUrl, img => {
      const W = 120;                          // ancho objetivo (px lógicos)
      const s = W / (img.width || W);
      img.set({
        scaleX: s, scaleY: s,
        originX:'left', originY:'top',
        selectable:false, evented:true,
        hoverCursor:'pointer',
        stroke:'#0ea5e9', strokeWidth: 2 / s,  // borde visible ~2px reales
      });
      img.data = { type:'att-thumb', linkId, src: att.dataUrl };
      img.isThumb = true;                     // excluida del guardado
      this._skipSnap = true;
      this.canvas.add(img);
      this._skipSnap = false;
      this._syncThumb(obj);
      this.canvas.renderAll();
    });
  }

  /** Coloca la miniatura junto a la esquina superior derecha de la figura */
  _syncThumb(obj) {
    const linkId = obj?.data?.labelId;
    const t = linkId ? this._findThumb(linkId) : null;
    if (!t) return;
    obj.setCoords();
    const tr = obj.aCoords && obj.aCoords.tr ? obj.aCoords.tr : obj.getCenterPoint();
    t.set({ left: tr.x + 6, top: tr.y });
    t.setCoords();
    this.canvas.bringToFront(t);
  }

  /* ── Estilo en vivo de una figura (desde el panel de propiedades) ────── */
  setObjProp(obj, prop, val) {
    if (!obj) return;
    if (prop === 'opacity') {
      obj.set('opacity', val);
    } else {
      // Para grupos (flecha, cota…) aplicar a los hijos
      const targets = obj.type === 'group' && obj.getObjects ? obj.getObjects() : [obj];
      targets.forEach(o => o.set(prop, val));
      obj.set(prop, val);
    }
    obj.dirty = true;
    this.canvas.requestRenderAll();
  }

  /* ── Sincronizar etiqueta al mover / escalar / rotar la nube ─────────── */
  _syncCloudLabel(cloudObj) {
    const cloudId = cloudObj.data?.cloudId;
    if (!cloudId) return;
    const lbl = this.canvas.getObjects().find(
      o => o.data?.type === 'cloud-label' && o.data?.cloudId === cloudId
    );
    if (!lbl) return;
    const center = cloudObj.getCenterPoint();
    lbl.set({ left: center.x, top: center.y });
    lbl.setCoords();
    this.canvas.renderAll();
  }

  /* ── Eliminar etiqueta de nube (al borrar la nube) ───────────────────── */
  _removeCloudLabel(cloudId) {
    const lbl = this.canvas.getObjects().find(
      o => o.data?.type === 'cloud-label' && o.data?.cloudId === cloudId
    );
    if (lbl) this.canvas.remove(lbl);
  }

  /* ── Área ───────────────────────────────────────────────────────────── */
  _addArea(pts) {
    const pxArea  = this.scaleManager.polygonArea(pts);
    const label   = this.scaleManager.formatArea(pxArea);
    const cx = pts.reduce((s,p)=>s+p.x,0)/pts.length;
    const cy = pts.reduce((s,p)=>s+p.y,0)/pts.length;

    const polygon = new fabric.Polygon(pts,{
      stroke:this.strokeColor, strokeWidth:this.strokeWidth, fill:this.fillColor,
    });
    polygon.data = { type:'area', areaLabel:label };

    const txt = new fabric.Text(label,{
      left:cx, top:cy, fontSize:14, fontFamily:'Arial',
      fill:this.strokeColor, backgroundColor:'#1c213099',
      originX:'center', originY:'center', selectable:false,
    });
    txt.data = { type:'area-label' };

    this._place(polygon);
    this._place(txt);
    this.onAreaReady && this.onAreaReady(label);
  }

  /* ── Perímetro (polilínea con longitud total) ───────────────────────── */
  _addPerimeter(pts) {
    let total = 0;
    for (let i=1;i<pts.length;i++) total += this.scaleManager.distance(pts[i-1].x,pts[i-1].y,pts[i].x,pts[i].y);
    const label = this.scaleManager.format(total);

    const obj = new fabric.Polyline(pts,{
      stroke:this.strokeColor, strokeWidth:this.strokeWidth, fill:'transparent',
    });
    obj.data = { type:'perimeter', label };

    const mx = (pts[0].x+pts[pts.length-1].x)/2;
    const my = Math.min(...pts.map(p=>p.y)) - 18;
    const txt = new fabric.Text(label,{
      left:mx, top:my, fontSize:14, fontFamily:'Arial',
      fill:this.strokeColor, backgroundColor:'#1c213099',
      originX:'center', originY:'bottom', selectable:false,
    });
    txt.data = { type:'perimeter-label' };

    this._place(obj);
    this._place(txt);
    this.onAreaReady && this.onAreaReady(`Perímetro: ${label}`);
  }

  /* ── Texto IText ────────────────────────────────────────────────────── */
  _addText(pos) {
    const obj = new fabric.IText('Texto',{
      left:pos.x, top:pos.y, fontSize:16, fontFamily:'Arial',
      fill:this.strokeColor, editable:true,
    });
    obj.data = { type:'text' };
    this._place(obj);
    setTimeout(()=>{ this.canvas.setActiveObject(obj); obj.enterEditing(); obj.selectAll(); this.canvas.renderAll(); },40);
  }

  /* ── Nota (post-it) ─────────────────────────────────────────────────── */
  _addNote(pos) {
    const W=160, H=80, PAD=10;
    const bg = new fabric.Rect({width:W,height:H,rx:6,ry:6,fill:'#fef3c7',stroke:'#d97706',strokeWidth:1.5,left:0,top:0,selectable:false});
    const txt = new fabric.IText('Nota',{left:PAD,top:PAD,fontSize:13,fontFamily:'Arial',fill:'#92400e',editable:true,selectable:false,width:W-PAD*2});
    const grp = new fabric.Group([bg,txt],{left:pos.x,top:pos.y});
    grp.data = { type:'note' };
    this._place(grp);
  }

  /* ── Callout (globo con línea de apunte) ─────────────────────────────── */
  _addCallout(pos) {
    const W=160, H=60, PAD=10;
    const bubbleX=30, bubbleY=-70;
    const bg   = new fabric.Rect({left:bubbleX,top:bubbleY,width:W,height:H,rx:8,ry:8,fill:'#eff6ff',stroke:'#3b82f6',strokeWidth:1.5,selectable:false});
    const ptr  = new fabric.Triangle({left:bubbleX+W/2-6,top:bubbleY+H,width:12,height:14,fill:'#3b82f6',selectable:false});
    const line = new fabric.Line([bubbleX+W/2,bubbleY+H+14,0,0],{stroke:'#3b82f6',strokeWidth:1.5,selectable:false});
    const txt  = new fabric.IText('Comentario',{left:bubbleX+PAD,top:bubbleY+PAD,fontSize:12,fontFamily:'Arial',fill:'#1e40af',editable:true,selectable:false,width:W-PAD*2});
    const grp  = new fabric.Group([line,bg,ptr,txt],{left:pos.x,top:pos.y,originX:'center',originY:'bottom'});
    grp.data   = { type:'callout' };
    this._place(grp);
  }

  /* ── Sello (rubber stamp — texto inclinado) ─────────────────────────── */
  addStamp(x, y, label, color) {
    const col = color || this.strokeColor;
    const PAD = 12;
    const txt  = new fabric.Text(label, {
      fontSize:18, fontFamily:'Arial Black,sans-serif', fontWeight:'bold',
      fill:col, left:0, top:0, selectable:false,
    });
    const rect = new fabric.Rect({
      left:-PAD, top:-PAD, width:txt.width+PAD*2, height:txt.height+PAD*2,
      stroke:col, strokeWidth:3, fill:`${col}18`, rx:6, ry:6, selectable:false,
    });
    const grp = new fabric.Group([rect, txt], {
      left:x, top:y, angle:-15, originX:'center', originY:'center',
    });
    grp.data = { type:'stamp', label };
    this._place(grp);
  }

  /* ── Pin de foto estilo Procore: ícono clavado en el plano ──────────────
     La imagen no se ve grande sobre el plano (vista limpia); se guarda como
     adjunto del pin. Clic = seleccionar (barra flotante con ojo + ampliar);
     doble clic = abrir en grande. El ojo muestra/oculta una previa de 120px. */
  placePendingImage(dataUrl, name, type) {
    let cx, cy;
    if (this._pendingImagePos) {
      cx = this._pendingImagePos.x;
      cy = this._pendingImagePos.y;
    } else {
      const r = this._visibleLogicalRect();
      cx = r.x + r.w / 2;
      cy = r.y + r.h / 2;
    }
    this._pendingImagePos = null;

    const ACCENT = '#f97316';
    // Glifo de cámara (cuerpo + lente) en el espacio 24×24 del set de iconos
    const CAM = 'M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9'
              + 'a2 2 0 0 0-2-2h-3l-2.5-3z M15 13a3 3 0 1 0-6 0 3 3 0 1 0 6 0z';
    const glyph = new fabric.Path(CAM, {
      fill: '', stroke: '#fff', strokeWidth: 2,
      strokeLineJoin: 'round', strokeLineCap: 'round',
      originX: 'center', originY: 'center',
    });
    const gs = 19 / (glyph.height || 19);
    glyph.scale(gs);
    const badge = new fabric.Rect({
      width: 40, height: 34, rx: 9, ry: 9,
      fill: ACCENT, stroke: '#fff', strokeWidth: 2.5,
      originX: 'center', originY: 'center',
    });
    const tip = new fabric.Triangle({
      width: 14, height: 10, fill: ACCENT, stroke: '#fff', strokeWidth: 1.5,
      angle: 180, originX: 'center', originY: 'center', top: 21,
    });
    const grp = new fabric.Group([tip, badge, glyph], {
      left: cx, top: cy, originX: 'center', originY: 'bottom',
      hoverCursor: 'pointer',
    });
    grp.data = {
      type: 'photo-pin',
      name: name || 'imagen',
      attShown: false,                                   // vista limpia: sin previa grande
      adjuntos: [{
        name: name || 'imagen',
        type: (type || '').startsWith('image/') ? type : 'image/png',
        size: dataUrl.length,
        dataUrl,
      }],
    };
    this._place(grp);
  }

  /* ── Etiqueta profesional (borde doble ± trama diagonal) ────────────── */

  /** Genera un canvas pequeño con líneas diagonales para usar como patrón */
  _makeHatchCanvas(color) {
    const sz = 9;
    const c  = document.createElement('canvas');
    c.width  = sz;
    c.height = sz;
    const cx = c.getContext('2d');
    cx.strokeStyle = color;
    cx.lineWidth   = 1.2;
    cx.globalAlpha = 0.42;
    // Diagonal ↘ continua a tile
    cx.beginPath();
    cx.moveTo(sz, 0); cx.lineTo(0, sz);
    cx.moveTo(sz * 2, 0); cx.lineTo(sz, sz);
    cx.moveTo(0, 0); cx.lineTo(-sz, sz);
    cx.stroke();
    return c;
  }

  /**
   * addLabel — etiqueta rectangular con borde doble
   * @param {string} style  'solid' | 'hatch'
   */
  addLabel(x, y, text, color, style = 'solid') {
    const col   = color || this.strokeColor;
    const PAD_H = 18, PAD_V = 11;
    const SW    = 3;   // grosor borde exterior
    const GAP   = 4;   // espacio entre borde exterior e interior

    // Medir texto antes de construir el grupo
    const probe = new fabric.Text(text, {
      fontSize:22, fontFamily:'Arial Black, Impact, sans-serif',
      fontWeight:'bold', charSpacing:80,
    });
    const TW = probe.width, TH = probe.height;
    const W  = TW + PAD_H * 2;
    const H  = TH + PAD_V * 2;

    const objs = [];

    // Trama diagonal (solo para estilo 'hatch')
    if (style === 'hatch') {
      const pat = new fabric.Pattern({
        source  : this._makeHatchCanvas(col),
        repeat  : 'repeat',
      });
      objs.push(new fabric.Rect({
        left:0, top:0, width:W, height:H,
        fill: pat, stroke:'transparent', strokeWidth:0,
        selectable:false, evented:false,
      }));
    }

    // Borde exterior (más grueso)
    objs.push(new fabric.Rect({
      left:0, top:0, width:W, height:H,
      stroke:col, strokeWidth:SW,
      fill: style === 'hatch' ? 'transparent' : `${col}15`,
      rx:2, ry:2, selectable:false,
    }));

    // Borde interior (línea fina)
    const inset = SW + GAP;
    objs.push(new fabric.Rect({
      left:inset, top:inset,
      width:W - inset * 2, height:H - inset * 2,
      stroke:col, strokeWidth:1.2, fill:'transparent',
      rx:1, ry:1, selectable:false,
    }));

    // Texto centrado
    objs.push(new fabric.Text(text, {
      left: PAD_H, top: PAD_V,
      fontSize:22, fontFamily:'Arial Black, Impact, sans-serif',
      fontWeight:'bold', fill:col, charSpacing:80, selectable:false,
    }));

    const grp = new fabric.Group(objs, {
      left:x, top:y, originX:'center', originY:'center',
    });
    grp.data = { type:'label', label:text, style };
    this._place(grp);
  }

  /* ════════════════════════════════════════════════════════════════════
     API PÚBLICA
     ════════════════════════════════════════════════════════════════════ */

  setMarkupVisible(v) {
    this._markupObjs().forEach(o => { o.visible = v; });
    this.canvas.renderAll();
  }

  zoom(factor) {
    const z = Math.min(Math.max(this.canvas.getZoom()*factor,0.04),20);
    this.canvas.zoomToPoint({x:this.canvas.width/2,y:this.canvas.height/2},z);
    this.onZoomChange && this.onZoomChange(z);
    this._scheduleDetail();
  }

  /** Zoom a un nivel absoluto (ej: 1 = 100%), centrado en el lienzo */
  zoomTo(z) {
    z = Math.min(Math.max(z, 0.04), 20);
    this.canvas.zoomToPoint({x:this.canvas.width/2, y:this.canvas.height/2}, z);
    this.onZoomChange && this.onZoomChange(z);
    this._scheduleDetail();
  }

  getZoom()     { return this.canvas.getZoom(); }
  fitToCanvas() { if (this._pdfW>0) this._fitToCanvas(); }

  /* ── Serialización ─────────────────────────────────────────────────── */
  getMarkupJSON() {
    // Las miniaturas de adjuntos no se guardan: se regeneran desde data.adjuntos
    return JSON.stringify(
      this._markupObjs().filter(o=>!o.isThumb).map(o=>o.toObject(['data','name']))
    );
  }

  setMarkupJSON(json) {
    this._skipSnap = true;
    this._markupObjs().forEach(o=>this.canvas.remove(o));
    const objects = json ? JSON.parse(json) : [];
    if (!objects.length) {
      this.canvas.renderAll(); this._skipSnap=false;
      this._undoStack=[]; this._redoStack=[];
      this.onUndoChange&&this.onUndoChange(0,0); return;
    }
    fabric.util.enlivenObjects(objects, enlivened => {
      enlivened.forEach(o=>this.canvas.add(o));
      // Regenerar miniaturas de figuras que tengan imágenes adjuntas
      enlivened.forEach(o => { if (this._firstImageAttachment(o)) this.refreshThumb(o); });
      this.canvas.renderAll(); this._skipSnap=false;
      this._undoStack=[]; this._redoStack=[];
      this.onUndoChange&&this.onUndoChange(0,0);
    });
  }

  clearMarkup() {
    this._skipSnap=false;
    this._markupObjs().forEach(o=>this.canvas.remove(o));
    this.canvas.renderAll();
    this._undoStack=[]; this._redoStack=[];
    this.onUndoChange&&this.onUndoChange(0,0);
  }

  exportPNG(mult=2) { return this.canvas.toDataURL({format:'png',multiplier:mult}); }

  /** logicalHeight de la página actual (para XFDF) */
  getPageHeight() { return this._pdfH; }

  /* ── Undo / Redo ──────────────────────────────────────────────────── */
  undo() {
    if (!this._undoStack.length) return;
    const cur = this._markupObjs().map(o=>o.toObject(['data','name']));
    this._redoStack.push(JSON.stringify(cur));
    this._restoreObjects(this._undoStack.pop());
    this.onUndoChange&&this.onUndoChange(this._undoStack.length,this._redoStack.length);
  }

  redo() {
    if (!this._redoStack.length) return;
    const cur = this._markupObjs().map(o=>o.toObject(['data','name']));
    this._undoStack.push(JSON.stringify(cur));
    this._restoreObjects(this._redoStack.pop());
    this.onUndoChange&&this.onUndoChange(this._undoStack.length,this._redoStack.length);
  }

  /* ════════════════════════════════════════════════════════════════════
     PRIVADO: utilidades internas
     ════════════════════════════════════════════════════════════════════ */

  _markupObjs() { return this.canvas.getObjects().filter(o=>!o.isBackground); }

  _place(obj) {
    // Inyectar autor y fecha si el objeto no los tiene ya
    if (obj.data && !obj.data.autor) {
      obj.data.autor = this.currentUser;
      obj.data.fecha = new Date().toISOString();
    }
    this.canvas.add(obj);
    this.canvas.setActiveObject(obj);
    this.canvas.renderAll();
  }

  /** Lista de autores únicos en la página actual con conteo de anotaciones */
  getAuthors() {
    const map = {};
    this._markupObjs().forEach(o => {
      const a = o.data?.autor || 'Anónimo';
      map[a] = (map[a] || 0) + 1;
    });
    return Object.entries(map).map(([name, count]) => ({ name, count }));
  }

  /** Mostrar/ocultar anotaciones de un autor específico */
  filterByAutor(name, visible) {
    this._markupObjs().forEach(o => {
      if ((o.data?.autor || 'Anónimo') === name) o.visible = visible;
    });
    this.canvas.renderAll();
  }

  _snapshot() {
    if (this._undoStack.length>=this._maxHistory) this._undoStack.shift();
    this._undoStack.push(JSON.stringify(this._markupObjs().map(o=>o.toObject(['data','name']))));
    this._redoStack = [];
    this.onUndoChange&&this.onUndoChange(this._undoStack.length,0);
  }

  _restoreObjects(jsonStr) {
    this._skipSnap=true;
    this._markupObjs().forEach(o=>this.canvas.remove(o));
    const objs = JSON.parse(jsonStr||'[]');
    if (!objs.length) { this.canvas.renderAll(); this._skipSnap=false; return; }
    fabric.util.enlivenObjects(objs, enlivened => {
      enlivened.forEach(o=>this.canvas.add(o));
      this.canvas.renderAll(); this._skipSnap=false;
    });
  }

  _hint(msg) { this.onHint && this.onHint(msg); }

  destroy() {
    document.removeEventListener('keydown', this._keyFn);
    this.canvas.dispose();
  }
}
