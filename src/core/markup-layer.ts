/* ═══════════════════════════════════════════════════════════════════════
   MarkupLayer — capa de anotaciones Fabric.js v5 para visor de planos SAF

   Herramientas:
   select · pan · arrow · measure · angle · perimeter
   cloud  · rect · ellipse · highlight
   text   · note · callout · freehand · area · stamp · eraser
   ═══════════════════════════════════════════════════════════════════════ */

import { fabric } from 'fabric';
import { ScaleManager } from './scale-manager';

// Límites de zoom del lienzo (multiplicador absoluto sobre el tamaño lógico)
const MIN_ZOOM = 0.04;
const MAX_ZOOM = 20;

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
    this._lastRightClick = 0;  // ms del último clic derecho (doble clic derecho = zoom out)
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
    this.onStampDblClick = null;// (data, obj) => void — doble clic en un sello (p.ej. RFI)
    this.onLocalChange = null;  // () => void — el usuario local cambió SU capa (debounced)

    // ── Colaboración en tiempo real ────────────────────────────────────
    this._applyingRemote = false;  // true mientras se pinta una capa remota (no re-emitir)
    this._collabTimer    = null;   // debounce de onLocalChange
    this._peerCursors    = new Map(); // id → fabric objeto del cursor remoto
    this._lastCursorZoom = 1;      // último zoom aplicado a los cursores remotos

    // ── Usuario actual ─────────────────────────────────────────────────
    this.currentUser = 'Anónimo';

    // ── Autores ocultos (filtro del panel de colaboradores) ────────────
    this._hiddenAuthors = new Set();   // nombres cuyos markups están ocultos

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

  /**
   * Rota 90° todas las marcas (sin el fondo), en el espacio lógico de la página.
   * Debe llamarse ANTES de re-renderizar el fondo con la nueva orientación
   * (setBackground), pues usa el ancho/alto lógicos actuales (previos).
   * Transformación rígida por objeto (independiente del tipo):
   *   horario   (x,y) → (altoPrevio − y, x)   y angle += 90
   *   antihorario (x,y) → (y, anchoPrevio − x) y angle −= 90
   * @param {boolean} clockwise  true = derecha (horario), false = izquierda
   */
  rotateContent(clockwise = true) {
    const previousWidth  = this._pdfW;
    const previousHeight = this._pdfH;
    this.canvas.getObjects()
      .filter(obj => !obj.isBackground)
      .forEach(obj => {
        const newLeft = clockwise ? previousHeight - obj.top : obj.top;
        const newTop  = clockwise ? obj.left : previousWidth - obj.left;
        obj.set({ left: newLeft, top: newTop, angle: (obj.angle || 0) + (clockwise ? 90 : -90) });
        obj.setCoords();
      });
    this.canvas.discardActiveObject();
    this.canvas.requestRenderAll();
  }

  _fitToCanvas() {
    const FIT_SCALE = 0.92;   // deja un pequeño margen alrededor de la página
    const canvasWidth = this.canvas.width, canvasHeight = this.canvas.height;
    const zoom = Math.min(canvasWidth / this._pdfW, canvasHeight / this._pdfH) * FIT_SCALE;
    this.canvas.setViewportTransform([
      zoom, 0, 0, zoom,
      (canvasWidth - this._pdfW * zoom) / 2,
      (canvasHeight - this._pdfH * zoom) / 2,
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
    const zoom = vt[0] || 1;
    const canvasWidth = this.canvas.getWidth(), canvasHeight = this.canvas.getHeight();
    let x1 = (0  - vt[4]) / zoom, y1 = (0  - vt[5]) / zoom;
    let x2 = (canvasWidth - vt[4]) / zoom, y2 = (canvasHeight - vt[5]) / zoom;
    x1 = Math.max(0, Math.min(x1, this._pdfW));
    y1 = Math.max(0, Math.min(y1, this._pdfH));
    x2 = Math.max(0, Math.min(x2, this._pdfW));
    y2 = Math.max(0, Math.min(y2, this._pdfH));
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1, zoom };
  }

  _clearDetail() {
    if (this._detailTimer) { clearTimeout(this._detailTimer); this._detailTimer = null; }
    if (this._detailImg)   { this.canvas.remove(this._detailImg); this._detailImg = null; }
    this._detailReqId++;   // invalida cualquier render en vuelo
  }

  /** Programa un refresco del tile de detalle (debounce tras zoom/pan) */
  _scheduleDetail() {
    const DETAIL_DEBOUNCE_MS = 180;
    if (!this.requestRegion || !this._bgImage) return;
    if (this._detailTimer) clearTimeout(this._detailTimer);
    this._detailTimer = setTimeout(() => this._refreshDetail(), DETAIL_DEBOUNCE_MS);
  }

  async _refreshDetail() {
    if (!this.requestRegion || !this._bgImage) return;
    const dpr  = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    const rect = this._visibleLogicalRect();
    if (rect.w <= 0 || rect.h <= 0) return;

    const density = rect.zoom * dpr;  // px de pantalla por unidad lógica
    const BASE_RESOLUTION_MARGIN = 1.05;   // tolerancia antes de pedir un tile de detalle
    // Si el fondo base ya tiene resolución suficiente para este zoom, no hace falta detalle
    if (density <= this._baseSS * BASE_RESOLUTION_MARGIN) { this._clearDetail(); return; }

    const reqId = ++this._detailReqId;
    let res;
    try {
      res = await this.requestRegion({ x: rect.x, y: rect.y, w: rect.w, h: rect.h }, density);
    } catch (err) {
      console.error('refreshDetail:', err);
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

  setCompareOpacity(opacity) {
    if (this._cmpImg) { this._cmpImg.set('opacity', opacity); this.canvas.renderAll(); }
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
      const brush = new fabric.PencilBrush(this.canvas);
      brush.color = this.strokeColor; brush.width = this.strokeWidth;
      this.canvas.freeDrawingBrush = brush;
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

  setStrokeColor(color) {
    this.strokeColor = color;
    if (this.canvas.isDrawingMode && this.canvas.freeDrawingBrush)
      this.canvas.freeDrawingBrush.color = color;
  }
  setFillColor(color)   { this.fillColor   = color; }
  setStrokeWidth(width) {
    this.strokeWidth = parseInt(width,10) || 2;
    if (this.canvas.isDrawingMode && this.canvas.freeDrawingBrush)
      this.canvas.freeDrawingBrush.width = this.strokeWidth;
  }

  /* ════════════════════════════════════════════════════════════════════
     EVENTOS CANVAS
     ════════════════════════════════════════════════════════════════════ */
  _bindCanvasEvents() {
    this.canvas.on('mouse:wheel',  e => this._onWheel(e));

    // Mantener los cursores remotos a tamaño constante al cambiar el zoom
    this.canvas.on('after:render', () => {
      if (!this._peerCursors.size) return;
      const zoom = this.canvas.getZoom() || 1;
      if (zoom === this._lastCursorZoom) return;
      this._lastCursorZoom = zoom;
      this._peerCursors.forEach(cursor => { cursor.scaleX = cursor.scaleY = 1 / zoom; cursor.setCoords(); });
    });
    this.canvas.on('mouse:down',   e => this._onDown(e));
    this.canvas.on('mouse:move',   e => this._onMove(e));
    this.canvas.on('mouse:up',     e => this._onUp(e));

    // Doble clic IZQUIERDO en el plano → acercar (zoom in) hacia el punto
    this.canvas.on('mouse:dblclick', opt => {
      if (this._isDrawing) return;
      if (opt.target && !opt.target.isBackground) return;  // no interferir con objetos/texto
      this._zoomBy(opt.e.altKey ? 0.5 : 2, opt.e.offsetX, opt.e.offsetY);
    });

    // Doble clic DERECHO en el plano → alejar (zoom out) hacia el punto.
    // Se detecta por dos contextmenu seguidos (sin menú del navegador).
    const RIGHT_DBL_CLICK_MS = 400;   // ventana para detectar doble clic derecho
    this.canvas.upperCanvasEl.addEventListener('contextmenu', domEvent => {
      domEvent.preventDefault();
      if (this._isDrawing) { this._lastRightClick = 0; return; }
      const now = Date.now();
      if (now - this._lastRightClick < RIGHT_DBL_CLICK_MS) {
        this._zoomBy(0.5, domEvent.offsetX, domEvent.offsetY);
        this._lastRightClick = 0;
      } else {
        this._lastRightClick = now;
      }
    });

    // Snapshot para undo/redo + aviso de cambio local para colaboración
    const snap = evt => {
      if (evt.target?.isBackground || evt.target?.isCursor || this._skipSnap) return;
      this._snapshot();
      this._notifyLocalChange();
    };
    this.canvas.on('object:added',    snap);
    this.canvas.on('object:modified', snap);
    this.canvas.on('object:removed',  snap);
    // Al borrar una figura no se dispara mouse:out → el tooltip de autor quedaría
    // flotando. Lo ocultamos explícitamente cuando desaparece cualquier objeto.
    this.canvas.on('object:removed', () => { this.onAnnotHover && this.onAnnotHover(null, null); });
    this.canvas.on('path:created',    opt => {
      if (opt.path) {
        opt.path.data = { type:'freehand', autor:this.currentUser, fecha:new Date().toISOString() };
        this._snapshot();
        this._notifyLocalChange();
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
      // Figura de otro usuario: solo navegación/visualización, nunca edición
      if (obj.data?.remoto) {
        if (obj.data?.type === 'link')           this.onFollowLink && this.onFollowLink(obj.data);
        else if (obj.data?.type === 'photo-pin') { const attachment = this._firstImageAttachment(obj); if (attachment) this.onShowImage && this.onShowImage(attachment.dataUrl); }
        else if (obj.data?.type === 'stamp')     this.onStampDblClick && this.onStampDblClick(obj.data, obj);
        return;
      }
      if (obj.data?.type === 'link')             this.onFollowLink && this.onFollowLink(obj.data);
      else if (obj.data?.type === 'photo-pin')   { const attachment = this._firstImageAttachment(obj); if (attachment) this.onShowImage && this.onShowImage(attachment.dataUrl); }
      else if (obj.data?.type === 'stamp')       this.onStampDblClick && this.onStampDblClick(obj.data, obj);
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
    const WHEEL_ZOOM_SENSITIVITY = 0.0015;   // factor exponencial del zoom por delta de rueda
    const MOUSE_WHEEL_MIN_DELTA  = 40;        // umbral para distinguir rueda de mouse vs trackpad
    const domEvent = opt.e;
    domEvent.preventDefault(); domEvent.stopPropagation();

    // Pinza del trackpad o Ctrl/Cmd + rueda → ZOOM hacia el cursor
    const zoomGesture = domEvent.ctrlKey || domEvent.metaKey;
    // Heurística mouse vs trackpad: la rueda de mouse llega en pasos grandes,
    // enteros y sin componente horizontal; el trackpad manda deltas finos/diagonales.
    const mouseWheel = !zoomGesture && domEvent.deltaX === 0 &&
                       Number.isInteger(domEvent.deltaY) && Math.abs(domEvent.deltaY) >= MOUSE_WHEEL_MIN_DELTA;

    if (zoomGesture || mouseWheel) {
      this._zoomBy(Math.exp(-domEvent.deltaY * WHEEL_ZOOM_SENSITIVITY), domEvent.offsetX, domEvent.offsetY);
    } else {
      // Trackpad de dos dedos → DESPLAZAR el plano
      this.canvas.relativePan({ x: -domEvent.deltaX, y: -domEvent.deltaY });
      this._scheduleDetail();
    }
  }

  /** Zoom multiplicativo acotado, centrado en el punto (x,y) del canvas */
  _zoomBy(factor, x, y) {
    let zoom = this.canvas.getZoom() * factor;
    zoom = Math.min(Math.max(zoom, MIN_ZOOM), MAX_ZOOM);
    this.canvas.zoomToPoint({ x, y }, zoom);
    this.onZoomChange && this.onZoomChange(zoom);
    this._scheduleDetail();
  }

  /* ── Mouse down ───────────────────────────────────────────────────── */
  _onDown(opt) {
    // Clic derecho: reservado para el doble-clic-derecho de zoom out (no dibuja)
    if (opt.e && opt.e.button === 2) return;
    const ptr  = this.canvas.getPointer(opt.e);
    const tool = this.currentTool;

    // Clic en una miniatura de adjunto → ver la imagen en grande
    if (opt.target?.data?.type === 'att-thumb') {
      this.onShowImage && this.onShowImage(opt.target.data.src);
      return;
    }

    // Eraser: borrar objeto bajo cursor
    if (tool === 'eraser') {
      const target = opt.target;
      if (target && target.data?.remoto) {
        this._hint && this._hint('Esta figura es de otro usuario — no puedes borrarla');
        return;
      }
      if (target && !target.isBackground) {
        // Eliminar también su etiqueta de texto enlazada
        if (target.data?.type === 'cloud' && target.data?.cloudId) this._removeCloudLabel(target.data.cloudId);
        if (target.data?.labelId) { this._removeLabel(target.data.labelId); this._removeThumb(target.data.labelId); }
        this.canvas.remove(target);
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
    const DOUBLE_CLICK_MS = 360;
    const now  = Date.now();
    const isDbl = now - this._lastClick < DOUBLE_CLICK_MS;
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

    const DRAG_THRESHOLD_PX = 5;   // distancia mínima para tratar el gesto como arrastre
    const dist = Math.hypot(ptr.x-start.x, ptr.y-start.y);

    if (dist >= DRAG_THRESHOLD_PX) {
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
    const left = Math.min(start.x,end.x), top = Math.min(start.y,end.y);
    const width = Math.abs(end.x-start.x), height = Math.abs(end.y-start.y);
    const MIN_CLOUD_PREVIEW_PX = 4;   // bajo este tamaño se previsualiza como rectángulo
    let shape;
    if (tool === 'arrow' || tool === 'measure') {
      shape = new fabric.Line([start.x,start.y,end.x,end.y], base);
    } else if (tool === 'ellipse') {
      shape = new fabric.Ellipse(Object.assign({ left, top, rx:width/2, ry:height/2 }, base));
    } else if (tool === 'cloud' && width > MIN_CLOUD_PREVIEW_PX && height > MIN_CLOUD_PREVIEW_PX) {
      // Previsualizar la nube real (festones) en lugar de un rectángulo
      const cloudPath = this._revisionCloudPath(left, top, width, height);
      shape = new fabric.Path(cloudPath, Object.assign({ strokeLineJoin:'round', strokeLineCap:'round' }, base));
    } else {
      shape = new fabric.Rect(Object.assign({ left, top, width, height }, base));
    }
    this._tempLine = shape;
    this.canvas.add(shape);
    this.canvas.renderAll();
  }

  /* ════════════════════════════════════════════════════════════════════
     TECLADO
     ════════════════════════════════════════════════════════════════════ */
  _bindKeyboard() {
    this._keyFn = domEvent => {
      const activeTag = document.activeElement.tagName;
      if (activeTag==='INPUT'||activeTag==='TEXTAREA') return;

      if (domEvent.key==='Enter' && this._isDrawing) { this._finalizeMultiPoint(); return; }
      if (domEvent.key==='Escape')                   { this._cancelDrawing();       return; }

      if ((domEvent.key==='Delete'||domEvent.key==='Backspace')) {
        const obj = this.canvas.getActiveObject();
        if (obj && !obj.isBackground) {
          if (obj.isEditing) return; // texto en edición
          if (obj.data?.remoto) return; // figura de otro usuario → no borrable
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
    document.addEventListener('keydown', domEvent => {
      const activeTag = document.activeElement.tagName;
      if (activeTag==='INPUT'||activeTag==='TEXTAREA') return;
      if (domEvent.code === 'Space' && !this._spaceDown) {
        this._spaceDown = true;
        this.canvas.selection = false;          // sin rectángulo de selección al panear
        this.canvas.defaultCursor = 'grab';
        this.canvas.setCursor('grab');
        domEvent.preventDefault();
      }
    });
    document.addEventListener('keyup', domEvent => {
      if (domEvent.code === 'Space') {
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
    if (this.onAutoSelect) this.onAutoSelect();   // una sola inserción → volver a seleccionar
  }

  /* ════════════════════════════════════════════════════════════════════
     CREAR OBJETOS
     ════════════════════════════════════════════════════════════════════ */

  /* ── Flecha ─────────────────────────────────────────────────────────── */
  _addArrow(x1,y1,x2,y2) {
    const angle = Math.atan2(y2-y1,x2-x1)*(180/Math.PI);
    const size  = Math.max(10,this.strokeWidth*5);
    const group = new fabric.Group([
      new fabric.Line([x1,y1,x2,y2],{stroke:this.strokeColor,strokeWidth:this.strokeWidth,selectable:false}),
      new fabric.Triangle({left:x2,top:y2,width:size,height:size,fill:this.strokeColor,stroke:this.strokeColor,angle:angle+90,originX:'center',originY:'center',selectable:false}),
    ]);
    group.data = { type:'arrow' };
    this._place(group);
  }

  /* ── Dimensión / Cota ───────────────────────────────────────────────── */
  _addDimension(x1,y1,x2,y2) {
    const dist      = this.scaleManager.distance(x1,y1,x2,y2);
    const label     = this.scaleManager.format(dist);
    const angle     = Math.atan2(y2-y1,x2-x1)*(180/Math.PI);
    const perpAngle = (angle+90)*Math.PI/180;
    const TICK_LEN  = 10;
    const strokeW   = this.strokeWidth, arrowSize = Math.max(8,strokeW*4);
    const dx        = Math.cos(perpAngle)*TICK_LEN, dy = Math.sin(perpAngle)*TICK_LEN;
    const midX=(x1+x2)/2, midY=(y1+y2)/2;
    const LABEL_OFFSET = 18;

    const group = new fabric.Group([
      new fabric.Line([x1,y1,x2,y2],{stroke:this.strokeColor,strokeWidth:strokeW,selectable:false}),
      new fabric.Line([x1-dx,y1-dy,x1+dx,y1+dy],{stroke:this.strokeColor,strokeWidth:strokeW,selectable:false}),
      new fabric.Line([x2-dx,y2-dy,x2+dx,y2+dy],{stroke:this.strokeColor,strokeWidth:strokeW,selectable:false}),
      new fabric.Triangle({left:x1,top:y1,width:arrowSize,height:arrowSize,fill:this.strokeColor,stroke:this.strokeColor,angle:angle-90,originX:'center',originY:'center',selectable:false}),
      new fabric.Triangle({left:x2,top:y2,width:arrowSize,height:arrowSize,fill:this.strokeColor,stroke:this.strokeColor,angle:angle+90,originX:'center',originY:'center',selectable:false}),
      new fabric.Text(label,{left:midX,top:midY-LABEL_OFFSET,fontSize:14,fontFamily:'Arial',fill:this.strokeColor,backgroundColor:'#1c213099',originX:'center',originY:'bottom',selectable:false}),
    ]);
    group.data = { type:'dimension', label };
    this._place(group);
  }

  /* ── Ángulo ─────────────────────────────────────────────────────────── */
  _addAngle(vertex, a1, a2) {
    const ARC_RADIUS  = 30;
    const LABEL_OFFSET = 16;
    const FULL_CIRCLE_DEG = 360;
    const ang1 = Math.atan2(a1.y-vertex.y, a1.x-vertex.x);
    const ang2 = Math.atan2(a2.y-vertex.y, a2.x-vertex.x);
    let   degrees = Math.abs((ang2-ang1) * 180/Math.PI);
    if (degrees > 180) degrees = FULL_CIRCLE_DEG - degrees;
    const label = degrees.toFixed(1) + '°';
    const midAngle = (ang1+ang2)/2;
    const arc = this._arcPath(vertex.x, vertex.y, ARC_RADIUS, ang1, ang2);

    const group = new fabric.Group([
      new fabric.Line([vertex.x,vertex.y,a1.x,a1.y],{stroke:this.strokeColor,strokeWidth:this.strokeWidth,selectable:false}),
      new fabric.Line([vertex.x,vertex.y,a2.x,a2.y],{stroke:this.strokeColor,strokeWidth:this.strokeWidth,selectable:false}),
      new fabric.Path(arc,{stroke:this.strokeColor,strokeWidth:1,fill:'transparent',selectable:false}),
      new fabric.Text(label,{
        left:vertex.x+(ARC_RADIUS+LABEL_OFFSET)*Math.cos(midAngle),
        top :vertex.y+(ARC_RADIUS+LABEL_OFFSET)*Math.sin(midAngle),
        fontSize:13,fontFamily:'Arial',fill:this.strokeColor,
        backgroundColor:'#1c213099',originX:'center',originY:'center',selectable:false,
      }),
    ]);
    group.data = { type:'angle', label };
    this._place(group);
  }

  _arcPath(cx,cy,r,a1,a2) {
    const x1=cx+r*Math.cos(a1), y1=cy+r*Math.sin(a1);
    const x2=cx+r*Math.cos(a2), y2=cy+r*Math.sin(a2);
    let diff = a2-a1; if (diff<0) diff+=2*Math.PI;
    const largeArc = diff > Math.PI ? 1 : 0;
    const sweep    = diff > 0 ? 1 : 0;
    return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${largeArc} ${sweep} ${x2.toFixed(2)} ${y2.toFixed(2)}`;
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
    // targetPage  → salto a una hoja del MISMO documento
    // targetRepoId→ salto a OTRO plano (id_en_repositorio); APEX maneja la navegación
    obj.data = { type:'link', targetPage:null, targetRepoId:null, targetName:null, targetFile:null };
    this._place(obj);
  }

  /* ── Nube de revisión ───────────────────────────────────────────────── */
  _addCloud(pts) {
    const SCALLOP_SPACING = 18;   // px lógicos entre festones
    const closed = [...pts, pts[0]];
    let pathData = `M ${pts[0].x} ${pts[0].y}`;
    for (let i=0;i<closed.length-1;i++) {
      const from=closed[i], to=closed[i+1];
      const dx=to.x-from.x, dy=to.y-from.y;
      const len=Math.sqrt(dx*dx+dy*dy), scallopCount=Math.max(2,Math.round(len/SCALLOP_SPACING)), radius=len/scallopCount/2;
      for (let j=1;j<=scallopCount;j++){
        const fraction=j/scallopCount;
        pathData+=` A ${radius.toFixed(1)} ${radius.toFixed(1)} 0 0 1 ${(from.x+dx*fraction).toFixed(1)} ${(from.y+dy*fraction).toFixed(1)}`;
      }
    }
    const obj = new fabric.Path(pathData+' Z',{
      stroke:this.strokeColor, strokeWidth:this.strokeWidth, fill:this.fillColor,
    });
    obj.data = { type:'cloud', points: pts };
    this._place(obj);
  }

  /* ── Nube natural (drag o clic simple) ─────────────────────────────── */
  _addCloudFromRect(x1, y1, x2, y2) {
    const left = Math.min(x1,x2), top = Math.min(y1,y2);
    const width = Math.abs(x2-x1), height = Math.abs(y2-y1);

    const cloudPath = this._revisionCloudPath(left, top, width, height);
    const obj = new fabric.Path(cloudPath, {
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
  _revisionCloudPath(left, top, width, height) {
    const MIN_SCALLOP_RADIUS = 7;
    const MAX_SCALLOP_RADIUS = 20;
    // Radio del festón: proporcional al tamaño, acotado para que se vea parejo
    const scallopRadius = Math.max(MIN_SCALLOP_RADIUS, Math.min(MAX_SCALLOP_RADIUS, Math.min(width, height) / 3));
    const corners = [
      [left,         top         ],   // sup-izq
      [left + width, top         ],   // sup-der
      [left + width, top + height],   // inf-der
      [left,         top + height],   // inf-izq   (sentido horario, y hacia abajo)
    ];
    let pathData = `M ${left.toFixed(1)} ${top.toFixed(1)} `;
    for (let i = 0; i < 4; i++) {
      const [x1, y1] = corners[i];
      const [x2, y2] = corners[(i + 1) % 4];
      const len = Math.hypot(x2 - x1, y2 - y1);
      const scallopCount = Math.max(1, Math.round(len / (2 * scallopRadius)));  // nº de festones en este lado
      const radius       = (len / scallopCount) / 2;                            // radio que encaja exacto
      const unitX = (x2 - x1) / len, unitY = (y2 - y1) / len;
      for (let k = 1; k <= scallopCount; k++) {
        const px = x1 + unitX * (len * k / scallopCount);
        const py = y1 + unitY * (len * k / scallopCount);
        // sweep=1 → el arco bomba hacia afuera al recorrer en sentido horario
        pathData += `A ${radius.toFixed(1)} ${radius.toFixed(1)} 0 0 1 ${px.toFixed(1)} ${py.toFixed(1)} `;
      }
    }
    return pathData + 'Z';
  }

  _naturalCloudPath(left, top, width, height) {
    // Coordenadas absolutas desde fracción (0–1)
    const toPath = (rx, ry) => `${(left + rx * width).toFixed(1)} ${(top + ry * height).toFixed(1)}`;

    // Elige 3 o 4 bumps según la proporción ancho/alto
    const WIDE_CLOUD_RATIO = 2.2;
    if (width / Math.max(height, 1) >= WIDE_CLOUD_RATIO) {
      // ── 4 bumps (nube ancha) ────────────────────────────
      return [
        `M  ${toPath(0.04, 0.82)}`,
        `C  ${toPath(0.00, 0.82)} ${toPath(0.00, 0.60)} ${toPath(0.04, 0.50)}`,  // lado izq
        `C  ${toPath(0.04, 0.24)} ${toPath(0.22, 0.14)} ${toPath(0.28, 0.33)}`,  // bump izq
        `C  ${toPath(0.29, 0.39)} ${toPath(0.32, 0.39)} ${toPath(0.35, 0.29)}`,  // valle 1
        `C  ${toPath(0.35, 0.06)} ${toPath(0.55, 0.06)} ${toPath(0.55, 0.29)}`,  // bump ctr-izq
        `C  ${toPath(0.57, 0.37)} ${toPath(0.59, 0.37)} ${toPath(0.62, 0.28)}`,  // valle 2
        `C  ${toPath(0.62, 0.06)} ${toPath(0.82, 0.06)} ${toPath(0.82, 0.33)}`,  // bump ctr-der
        `C  ${toPath(0.84, 0.39)} ${toPath(0.86, 0.37)} ${toPath(0.88, 0.32)}`,  // valle 3
        `C  ${toPath(0.92, 0.18)} ${toPath(1.00, 0.36)} ${toPath(0.97, 0.52)}`,  // bump der
        `C  ${toPath(1.00, 0.62)} ${toPath(1.00, 0.82)} ${toPath(0.96, 0.82)}`,  // lado der
        `C  ${toPath(0.72, 0.97)} ${toPath(0.28, 0.97)} ${toPath(0.04, 0.82)}`,  // base
        'Z',
      ].join(' ');
    } else {
      // ── 3 bumps (nube estándar) ─────────────────────────
      return [
        `M  ${toPath(0.06, 0.82)}`,
        `C  ${toPath(0.00, 0.82)} ${toPath(0.00, 0.62)} ${toPath(0.06, 0.52)}`,  // lado izq
        `C  ${toPath(0.06, 0.24)} ${toPath(0.28, 0.12)} ${toPath(0.36, 0.32)}`,  // bump izq
        `C  ${toPath(0.38, 0.38)} ${toPath(0.41, 0.38)} ${toPath(0.44, 0.30)}`,  // valle 1
        `C  ${toPath(0.44, 0.03)} ${toPath(0.70, 0.03)} ${toPath(0.70, 0.30)}`,  // bump central (mayor)
        `C  ${toPath(0.73, 0.38)} ${toPath(0.76, 0.38)} ${toPath(0.78, 0.32)}`,  // valle 2
        `C  ${toPath(0.84, 0.12)} ${toPath(1.00, 0.28)} ${toPath(0.96, 0.52)}`,  // bump der
        `C  ${toPath(1.00, 0.62)} ${toPath(1.00, 0.82)} ${toPath(0.94, 0.82)}`,  // lado der
        `C  ${toPath(0.70, 0.97)} ${toPath(0.30, 0.97)} ${toPath(0.06, 0.82)}`,  // base
        'Z',
      ].join(' ');
    }
  }

  /* ── Texto de nube (doble-clic) ─────────────────────────────────────── */
  _editCloudLabel(cloudObj) {
    const cloudId = cloudObj.data?.cloudId;
    if (!cloudId) return;

    // Buscar etiqueta existente
    let labelObj = this.canvas.getObjects().find(
      o => o.data?.type === 'cloud-label' && o.data?.cloudId === cloudId
    );

    const center = cloudObj.getCenterPoint();

    if (!labelObj) {
      // Tamaño de fuente proporcional al tamaño de la nube
      const FONT_SIZE_RATIO = 0.14;
      const FONT_SIZE_BASE  = 10;
      // Crear IText centrado en la nube
      labelObj = new fabric.IText('', {
        left      : center.x,
        top       : center.y,
        originX   : 'center',
        originY   : 'center',
        fontSize  : Math.round(Math.min(cloudObj.width, cloudObj.height) * FONT_SIZE_RATIO + FONT_SIZE_BASE),
        fontFamily: 'Arial',
        fill      : cloudObj.stroke || this.strokeColor,
        editable  : true,
        textAlign : 'center',
        selectable: true,
      });
      labelObj.data = {
        type    : 'cloud-label',
        cloudId : cloudId,
        autor   : this.currentUser,
        fecha   : new Date().toISOString(),
      };
      this._skipSnap = true;
      this.canvas.add(labelObj);
      this._skipSnap = false;

      // Al salir del modo edición: si está vacío, eliminar
      // (bandera para no agregar el listener más de una vez)
      labelObj._exitHandlerBound = true;
      labelObj.on('editing:exited', () => {
        if (!labelObj.text.trim()) {
          this.canvas.remove(labelObj);
          this.canvas.renderAll();
        } else {
          this._snapshot();
        }
        this._notifyLocalChange();
      });
      labelObj.on('changed', () => this._notifyLocalChange());   // en tiempo real al escribir
    }

    // Si la etiqueta ya existía (cargada de JSON), asegurar que el listener
    // de salida esté enlazado (solo una vez).
    if (!labelObj._exitHandlerBound) {
      labelObj._exitHandlerBound = true;
      labelObj.on('editing:exited', () => {
        if (!labelObj.text.trim()) {
          this.canvas.remove(labelObj);
          this.canvas.renderAll();
        } else {
          this._snapshot();
        }
        this._notifyLocalChange();
      });
      labelObj.on('changed', () => this._notifyLocalChange());   // en tiempo real al escribir
    }

    this.canvas.setActiveObject(labelObj);
    labelObj.enterEditing();
    labelObj.selectAll();
    this.canvas.renderAll();
  }

  /* ════════════════════════════════════════════════════════════════════
     ETIQUETA DE TEXTO GENÉRICA (cualquier figura) — IText enlazada por labelId
     ════════════════════════════════════════════════════════════════════ */

  /** ¿La figura admite etiqueta de texto? (excluye textos, notas, callouts, fondos) */
  _isLabelable(obj) {
    const type = obj?.data?.type;
    return ['rect','ellipse','arrow','highlight','measure','area','perimeter','angle'].includes(type);
  }

  /** Busca la IText enlazada a una figura por su labelId */
  _findLabel(labelId) {
    return this.canvas.getObjects().find(
      o => o.data?.type === 'shape-label' && o.data?.labelId === labelId
    );
  }

  /** Texto actual de la etiqueta de una figura ('' si no tiene) */
  getLabelText(obj) {
    const labelObj = obj?.data?.labelId ? this._findLabel(obj.data.labelId) : null;
    return labelObj ? labelObj.text : '';
  }

  /** Crea/actualiza/elimina la etiqueta de texto de una figura (desde el panel) */
  setLabelText(obj, text) {
    if (!obj) return;
    text = (text || '').trim();
    if (!obj.data) obj.data = {};
    if (!obj.data.labelId) obj.data.labelId = `lbl-${Date.now().toString(36)}`;
    let labelObj = this._findLabel(obj.data.labelId);

    if (!text) {
      if (labelObj) { this.canvas.remove(labelObj); this.canvas.renderAll(); this._notifyLocalChange(); }
      return;
    }

    if (!labelObj) {
      labelObj = this._makeLabel(obj);
      this._skipSnap = true; this.canvas.add(labelObj); this._skipSnap = false;
    }
    labelObj.set('text', text);
    this._syncLabel(obj);
    this.canvas.renderAll();
    this._notifyLocalChange();   // sincronizar la etiqueta/título en tiempo real
  }

  /** Construye la IText centrada en la figura */
  _makeLabel(obj) {
    const center = obj.getCenterPoint();
    const labelObj = new fabric.IText('', {
      left: center.x, top: center.y, originX:'center', originY:'center',
      fontSize: 16, fontFamily:'Arial', fill: obj.stroke || this.strokeColor,
      textAlign:'center', editable:true, selectable:true,
    });
    labelObj.data = {
      type:'shape-label', labelId: obj.data.labelId,
      autor:this.currentUser, fecha:new Date().toISOString(),
    };
    this._bindLabelExit(labelObj);
    return labelObj;
  }

  _bindLabelExit(labelObj) {
    if (labelObj._exitHandlerBound) return;
    labelObj._exitHandlerBound = true;
    labelObj.on('editing:exited', () => {
      if (!labelObj.text.trim()) { this.canvas.remove(labelObj); this.canvas.renderAll(); }
      else this._snapshot();
      this._notifyLocalChange();
    });
    // Mientras se escribe (doble clic in-situ) → sincronizar en tiempo real
    labelObj.on('changed', () => this._notifyLocalChange());
  }

  /** Doble-clic: edita la etiqueta in-situ */
  _editLabel(obj) {
    if (!obj.data) obj.data = {};
    if (!obj.data.labelId) obj.data.labelId = `lbl-${Date.now().toString(36)}`;
    let labelObj = this._findLabel(obj.data.labelId);
    if (!labelObj) {
      labelObj = this._makeLabel(obj);
      this._skipSnap = true; this.canvas.add(labelObj); this._skipSnap = false;
    } else {
      this._bindLabelExit(labelObj);
    }
    this.canvas.setActiveObject(labelObj);
    labelObj.enterEditing();
    labelObj.selectAll();
    this.canvas.renderAll();
  }

  /** Mueve la etiqueta al centro de su figura */
  _syncLabel(obj) {
    const labelObj = obj?.data?.labelId ? this._findLabel(obj.data.labelId) : null;
    if (!labelObj) return;
    const center = obj.getCenterPoint();
    labelObj.set({ left: center.x, top: center.y });
    labelObj.setCoords();
  }

  _removeLabel(labelId) {
    const labelObj = this._findLabel(labelId);
    if (labelObj) this.canvas.remove(labelObj);
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
    const thumb = this._findThumb(linkId);
    if (thumb) this.canvas.remove(thumb);
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
      const THUMB_WIDTH = 120;                          // ancho objetivo (px lógicos)
      const scale = THUMB_WIDTH / (img.width || THUMB_WIDTH);
      img.set({
        scaleX: scale, scaleY: scale,
        originX:'left', originY:'top',
        selectable:false, evented:true,
        hoverCursor:'pointer',
        stroke:'#0ea5e9', strokeWidth: 2 / scale,  // borde visible ~2px reales
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
    const THUMB_GAP = 6;   // separación px entre la figura y la miniatura
    const linkId = obj?.data?.labelId;
    const thumb = linkId ? this._findThumb(linkId) : null;
    if (!thumb) return;
    obj.setCoords();
    const topRight = obj.aCoords && obj.aCoords.tr ? obj.aCoords.tr : obj.getCenterPoint();
    thumb.set({ left: topRight.x + THUMB_GAP, top: topRight.y });
    thumb.setCoords();
    this.canvas.bringToFront(thumb);
  }

  /* ── Estilo en vivo de una figura (desde el panel de propiedades) ────── */
  setObjProp(obj, prop, val) {
    if (!obj) return;
    if (prop === 'opacity') {
      obj.set('opacity', val);
    } else {
      // Para grupos (flecha, cota…) aplicar a los hijos y marcarlos sucios para
      // que se refresque el bitmap cacheado del grupo (si no, no se ve en vivo).
      const targets = obj.type === 'group' && obj.getObjects ? obj.getObjects() : [obj];
      targets.forEach(o => { o.set(prop, val); o.dirty = true; });
      obj.set(prop, val);
    }
    obj.dirty = true;
    this.canvas.renderAll();   // render síncrono → cambio visible al instante
  }

  /* ── Sincronizar etiqueta al mover / escalar / rotar la nube ─────────── */
  _syncCloudLabel(cloudObj) {
    const cloudId = cloudObj.data?.cloudId;
    if (!cloudId) return;
    const labelObj = this.canvas.getObjects().find(
      o => o.data?.type === 'cloud-label' && o.data?.cloudId === cloudId
    );
    if (!labelObj) return;
    const center = cloudObj.getCenterPoint();
    labelObj.set({ left: center.x, top: center.y });
    labelObj.setCoords();
    this.canvas.renderAll();
  }

  /* ── Eliminar etiqueta de nube (al borrar la nube) ───────────────────── */
  _removeCloudLabel(cloudId) {
    const labelObj = this.canvas.getObjects().find(
      o => o.data?.type === 'cloud-label' && o.data?.cloudId === cloudId
    );
    if (labelObj) this.canvas.remove(labelObj);
  }

  /* ── Área ───────────────────────────────────────────────────────────── */
  _addArea(pts) {
    const pxArea  = this.scaleManager.polygonArea(pts);
    const label   = this.scaleManager.formatArea(pxArea);
    const centerX = pts.reduce((sum,p)=>sum+p.x,0)/pts.length;
    const centerY = pts.reduce((sum,p)=>sum+p.y,0)/pts.length;

    const polygon = new fabric.Polygon(pts,{
      stroke:this.strokeColor, strokeWidth:this.strokeWidth, fill:this.fillColor,
    });
    polygon.data = { type:'area', areaLabel:label };

    const labelText = new fabric.Text(label,{
      left:centerX, top:centerY, fontSize:14, fontFamily:'Arial',
      fill:this.strokeColor, backgroundColor:'#1c213099',
      originX:'center', originY:'center', selectable:false,
    });
    labelText.data = { type:'area-label' };

    this._place(polygon);
    this._place(labelText);
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

    const LABEL_OFFSET = 18;
    const midX = (pts[0].x+pts[pts.length-1].x)/2;
    const midY = Math.min(...pts.map(p=>p.y)) - LABEL_OFFSET;
    const labelText = new fabric.Text(label,{
      left:midX, top:midY, fontSize:14, fontFamily:'Arial',
      fill:this.strokeColor, backgroundColor:'#1c213099',
      originX:'center', originY:'bottom', selectable:false,
    });
    labelText.data = { type:'perimeter-label' };

    this._place(obj);
    this._place(labelText);
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
    if (this.onAutoSelect) this.onAutoSelect();   // herramienta vuelve a "seleccionar"
    // El texto se sigue pudiendo editar aunque estemos en modo seleccionar
    setTimeout(()=>{ this.canvas.setActiveObject(obj); obj.enterEditing(); obj.selectAll(); this.canvas.renderAll(); },40);
  }

  /* ── Nota (post-it) ─────────────────────────────────────────────────── */
  _addNote(pos) {
    const WIDTH=160, HEIGHT=80, PAD=10;
    const background = new fabric.Rect({width:WIDTH,height:HEIGHT,rx:6,ry:6,fill:'#fef3c7',stroke:'#d97706',strokeWidth:1.5,left:0,top:0,selectable:false});
    const textObj = new fabric.IText('Nota',{left:PAD,top:PAD,fontSize:13,fontFamily:'Arial',fill:'#92400e',editable:true,selectable:false,width:WIDTH-PAD*2});
    const group = new fabric.Group([background,textObj],{left:pos.x,top:pos.y});
    group.data = { type:'note' };
    this._place(group);
    if (this.onAutoSelect) this.onAutoSelect();
  }

  /* ── Callout (globo con línea de apunte) ─────────────────────────────── */
  _addCallout(pos) {
    const WIDTH=160, HEIGHT=60, PAD=10;
    const bubbleX=30, bubbleY=-70;
    const background = new fabric.Rect({left:bubbleX,top:bubbleY,width:WIDTH,height:HEIGHT,rx:8,ry:8,fill:'#eff6ff',stroke:'#3b82f6',strokeWidth:1.5,selectable:false});
    const tip        = new fabric.Triangle({left:bubbleX+WIDTH/2-6,top:bubbleY+HEIGHT,width:12,height:14,fill:'#3b82f6',selectable:false});
    const line       = new fabric.Line([bubbleX+WIDTH/2,bubbleY+HEIGHT+14,0,0],{stroke:'#3b82f6',strokeWidth:1.5,selectable:false});
    const textObj    = new fabric.IText('Comentario',{left:bubbleX+PAD,top:bubbleY+PAD,fontSize:12,fontFamily:'Arial',fill:'#1e40af',editable:true,selectable:false,width:WIDTH-PAD*2});
    const group      = new fabric.Group([line,background,tip,textObj],{left:pos.x,top:pos.y,originX:'center',originY:'bottom'});
    group.data       = { type:'callout' };
    this._place(group);
    if (this.onAutoSelect) this.onAutoSelect();
  }

  /* ── Sello (rubber stamp — texto inclinado) ─────────────────────────── */
  addStamp(x, y, label, color) {
    const stampColor = color || this.strokeColor;
    const PAD = 12;
    const textObj = new fabric.Text(label, {
      fontSize:18, fontFamily:'Arial Black,sans-serif', fontWeight:'bold',
      fill:stampColor, left:0, top:0, selectable:false,
    });
    const box = new fabric.Rect({
      left:-PAD, top:-PAD, width:textObj.width+PAD*2, height:textObj.height+PAD*2,
      stroke:stampColor, strokeWidth:3, fill:`${stampColor}18`, rx:6, ry:6, selectable:false,
    });
    const group = new fabric.Group([box, textObj], {
      left:x, top:y, angle:-15, originX:'center', originY:'center',
    });
    group.data = { type:'stamp', label };
    this._place(group);
  }

  /* ── Pin de foto estilo Procore: ícono clavado en el plano ──────────────
     La imagen no se ve grande sobre el plano (vista limpia); se guarda como
     adjunto del pin. Clic = seleccionar (barra flotante con ojo + ampliar);
     doble clic = abrir en grande. El ojo muestra/oculta una previa de 120px. */
  placePendingImage(dataUrl, name, type) {
    let centerX, centerY;
    if (this._pendingImagePos) {
      centerX = this._pendingImagePos.x;
      centerY = this._pendingImagePos.y;
    } else {
      const rect = this._visibleLogicalRect();
      centerX = rect.x + rect.w / 2;
      centerY = rect.y + rect.h / 2;
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
    const GLYPH_TARGET_HEIGHT = 19;
    const glyphScale = GLYPH_TARGET_HEIGHT / (glyph.height || GLYPH_TARGET_HEIGHT);
    glyph.scale(glyphScale);
    const badge = new fabric.Rect({
      width: 40, height: 34, rx: 9, ry: 9,
      fill: ACCENT, stroke: '#fff', strokeWidth: 2.5,
      originX: 'center', originY: 'center',
    });
    const tip = new fabric.Triangle({
      width: 14, height: 10, fill: ACCENT, stroke: '#fff', strokeWidth: 1.5,
      angle: 180, originX: 'center', originY: 'center', top: 21,
    });
    const group = new fabric.Group([tip, badge, glyph], {
      left: centerX, top: centerY, originX: 'center', originY: 'bottom',
      hoverCursor: 'pointer',
    });
    group.data = {
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
    this._place(group);
  }

  /* ── Etiqueta profesional (borde doble ± trama diagonal) ────────────── */

  /** Genera un canvas pequeño con líneas diagonales para usar como patrón */
  _makeHatchCanvas(color) {
    const size = 9;
    const canvasEl  = document.createElement('canvas');
    canvasEl.width  = size;
    canvasEl.height = size;
    const ctx = canvasEl.getContext('2d');
    ctx.strokeStyle = color;
    ctx.lineWidth   = 1.2;
    ctx.globalAlpha = 0.42;
    // Diagonal ↘ continua a tile
    ctx.beginPath();
    ctx.moveTo(size, 0); ctx.lineTo(0, size);
    ctx.moveTo(size * 2, 0); ctx.lineTo(size, size);
    ctx.moveTo(0, 0); ctx.lineTo(-size, size);
    ctx.stroke();
    return canvasEl;
  }

  /**
   * addLabel — etiqueta rectangular con borde doble
   * @param {string} style  'solid' | 'hatch'
   */
  addLabel(x, y, text, color, style = 'solid') {
    const labelColor = color || this.strokeColor;
    const PAD_H = 18, PAD_V = 11;
    const OUTER_BORDER_WIDTH = 3;   // grosor borde exterior
    const BORDER_GAP         = 4;   // espacio entre borde exterior e interior

    // Medir texto antes de construir el grupo
    const probe = new fabric.Text(text, {
      fontSize:22, fontFamily:'Arial Black, Impact, sans-serif',
      fontWeight:'bold', charSpacing:80,
    });
    const textWidth = probe.width, textHeight = probe.height;
    const width  = textWidth + PAD_H * 2;
    const height = textHeight + PAD_V * 2;

    const objs = [];

    // Trama diagonal (solo para estilo 'hatch')
    if (style === 'hatch') {
      const pattern = new fabric.Pattern({
        source  : this._makeHatchCanvas(labelColor),
        repeat  : 'repeat',
      });
      objs.push(new fabric.Rect({
        left:0, top:0, width, height,
        fill: pattern, stroke:'transparent', strokeWidth:0,
        selectable:false, evented:false,
      }));
    }

    // Borde exterior (más grueso)
    objs.push(new fabric.Rect({
      left:0, top:0, width, height,
      stroke:labelColor, strokeWidth:OUTER_BORDER_WIDTH,
      fill: style === 'hatch' ? 'transparent' : `${labelColor}15`,
      rx:2, ry:2, selectable:false,
    }));

    // Borde interior (línea fina)
    const inset = OUTER_BORDER_WIDTH + BORDER_GAP;
    objs.push(new fabric.Rect({
      left:inset, top:inset,
      width:width - inset * 2, height:height - inset * 2,
      stroke:labelColor, strokeWidth:1.2, fill:'transparent',
      rx:1, ry:1, selectable:false,
    }));

    // Texto centrado
    objs.push(new fabric.Text(text, {
      left: PAD_H, top: PAD_V,
      fontSize:22, fontFamily:'Arial Black, Impact, sans-serif',
      fontWeight:'bold', fill:labelColor, charSpacing:80, selectable:false,
    }));

    const group = new fabric.Group(objs, {
      left:x, top:y, originX:'center', originY:'center',
    });
    group.data = { type:'label', label:text, style };
    this._place(group);
  }

  /* ════════════════════════════════════════════════════════════════════
     API PÚBLICA
     ════════════════════════════════════════════════════════════════════ */

  setMarkupVisible(visible) {
    this._markupObjs().forEach(o => { o.visible = visible; });
    this.canvas.renderAll();
  }

  zoom(factor) {
    const zoom = Math.min(Math.max(this.canvas.getZoom()*factor,MIN_ZOOM),MAX_ZOOM);
    this.canvas.zoomToPoint({x:this.canvas.width/2,y:this.canvas.height/2},zoom);
    this.onZoomChange && this.onZoomChange(zoom);
    this._scheduleDetail();
  }

  /** Zoom a un nivel absoluto (ej: 1 = 100%), centrado en el lienzo */
  zoomTo(z) {
    z = Math.min(Math.max(z, MIN_ZOOM), MAX_ZOOM);
    this.canvas.zoomToPoint({x:this.canvas.width/2, y:this.canvas.height/2}, z);
    this.onZoomChange && this.onZoomChange(z);
    this._scheduleDetail();
  }

  /**
   * Zoom escalonado de 10 en 10 % (botones +/− y atajos de teclado).
   * Ajusta primero al múltiplo de 10 más cercano y luego mueve un escalón,
   * de modo que el porcentaje siempre cae en 10, 20, 30, … %.
   * @param {number} dir  +1 acercar, −1 alejar
   */
  zoomStep(dir) {
    const cur = this.canvas.getZoom() * 100;
    let next = dir > 0
      ? (Math.floor(cur / 10 + 1e-6) + 1) * 10
      : (Math.ceil(cur / 10 - 1e-6) - 1) * 10;
    next = Math.max(10, next);          // no bajar de 10 %
    this.zoomTo(next / 100);
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

  /* ════════════════════════════════════════════════════════════════════
     COLABORACIÓN EN TIEMPO REAL — capa por autor
     Cada usuario es dueño de SUS objetos. Se sincroniza la capa completa de
     un autor (no objeto-por-objeto): reusa la misma serialización que el
     guardado y maneja labels/thumbs/nubes sin lógica extra.
     ════════════════════════════════════════════════════════════════════ */

  /** Serializa SOLO los objetos del autor indicado (su capa de la página). */
  getLayerJSON(autor) {
    return JSON.stringify(
      this._markupObjs()
        .filter(o => !o.isThumb && (o.data?.autor || 'Anónimo') === autor)
        .map(o => o.toObject(['data','name']))
    );
  }

  /** Avisa (con debounce) que el usuario local cambió su capa. */
  _notifyLocalChange() {
    if (this._applyingRemote || !this.onLocalChange) return;
    if (this._collabTimer) clearTimeout(this._collabTimer);
    this._collabTimer = setTimeout(() => this.onLocalChange(), 500);
  }

  /**
   * Reemplaza la capa de un autor REMOTO con la versión recibida.
   * Los objetos ajenos quedan bloqueados (cada quien dueño de lo suyo).
   * No dispara snapshots ni re-emite (flag _applyingRemote).
   */
  applyRemoteLayer(autor, json) {
    if (!autor || autor === this.currentUser) return;   // nunca pisar lo propio
    this._applyingRemote = true;
    this._skipSnap = true;

    // 1) Quitar los objetos actuales de ese autor (y sus labels/thumbs)
    this._markupObjs()
      .filter(o => (o.data?.autor || 'Anónimo') === autor)
      .forEach(o => {
        if (o.data?.labelId) { this._removeLabel(o.data.labelId); this._removeThumb(o.data.labelId); }
        this.canvas.remove(o);
      });

    // 2) Pintar la capa recibida (bloqueada para el usuario local)
    const objects = json ? JSON.parse(json) : [];
    const finish = () => {
      this._applyAuthorVisibility();   // respetar el filtro de autores ocultos
      this._skipSnap = false;
      this._applyingRemote = false;
      this._keepCursorsOnTop();
      this.canvas.renderAll();
    };
    if (!objects.length) { finish(); return; }

    fabric.util.enlivenObjects(objects, enlivened => {
      enlivened.forEach(o => {
        // Se puede SELECCIONAR (para ver sus propiedades) pero NO editar/mover:
        // cada usuario es dueño de sus objetos.
        o.selectable   = true;
        o.evented      = true;       // recibe hover → tooltip con autor y hora
        o.hoverCursor  = 'help';
        o.lockMovementX = o.lockMovementY = true;
        o.lockScalingX  = o.lockScalingY  = true;
        o.lockRotation  = true;
        o.hasControls   = false;     // sin manijas de redimensión/rotación
        o.editable      = false;     // IText/etiquetas no editables
        if (o.data) o.data.remoto = true;   // marca de objeto ajeno (no borrable)
        this.canvas.add(o);
      });
      enlivened.forEach(o => { if (this._firstImageAttachment(o)) this.refreshThumb(o); });
      finish();
    });
  }

  /* ── Cursores remotos en vivo ──────────────────────────────────────── */

  /** Crea/actualiza el cursor de un peer en coordenadas LÓGICAS del plano. */
  setPeerCursor(id, x, y, user, color) {
    let cursor = this._peerCursors.get(id);
    if (!cursor) {
      const triangle = new fabric.Triangle({
        width: 12, height: 16, fill: color || '#3b82f6',
        left: 0, top: 0, angle: -35, originX: 'left', originY: 'top',
        stroke: '#fff', strokeWidth: 1,
      });
      const nameTag = new fabric.Text(` ${user || ''} `, {
        fontSize: 12, fill: '#fff', backgroundColor: color || '#3b82f6',
        left: 10, top: 14, originX: 'left', originY: 'top', fontFamily: 'sans-serif',
      });
      cursor = new fabric.Group([triangle, nameTag], {
        selectable: false, evented: false, hoverCursor: 'default',
        originX: 'left', originY: 'top',
      });
      cursor.isCursor = true;
      this._peerCursors.set(id, cursor);
      this.canvas.add(cursor);
    }
    cursor.set({ left: x, top: y });
    // Tamaño constante en pantalla, independiente del zoom
    const zoom = this.canvas.getZoom() || 1;
    cursor.scaleX = cursor.scaleY = 1 / zoom;
    cursor.setCoords();
    this._keepCursorsOnTop();
    this.canvas.requestRenderAll();
  }

  /** Elimina el cursor de un peer (salió de la sala). */
  removePeerCursor(id) {
    const cursor = this._peerCursors.get(id);
    if (cursor) { this.canvas.remove(cursor); this._peerCursors.delete(id); this.canvas.requestRenderAll(); }
  }

  /** Quita todos los cursores (cambio de plano / desconexión). */
  clearPeerCursors() {
    this._peerCursors.forEach(cursor => this.canvas.remove(cursor));
    this._peerCursors.clear();
    this.canvas.requestRenderAll();
  }

  _keepCursorsOnTop() {
    this._peerCursors.forEach(cursor => cursor.bringToFront && cursor.bringToFront());
  }

  /** Convierte un evento del DOM a coordenadas lógicas del plano. */
  scenePointFromEvent(e) {
    return this.canvas.getPointer(e);
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
      this._applyAuthorVisibility();   // respetar el filtro de autores ocultos
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

  /** Elimina SOLO las marcas del usuario actual (no las ajenas/bloqueadas). */
  clearMyMarkup() {
    const mine = this._markupObjs().filter(
      o => !o.data?.remoto && (o.data?.autor || 'Anónimo') === this.currentUser
    );
    mine.forEach(o => {
      if (o.data?.type === 'cloud' && o.data?.cloudId) this._removeCloudLabel(o.data.cloudId);
      if (o.data?.labelId) { this._removeLabel(o.data.labelId); this._removeThumb(o.data.labelId); }
      this.canvas.remove(o);
    });
    this.canvas.discardActiveObject();
    this.canvas.renderAll();
    this._snapshot();
  }

  exportPNG(multiplier=2) { return this.canvas.toDataURL({format:'png',multiplier}); }

  /**
   * Exporta la PÁGINA completa (PDF + marcas si están visibles) como PNG.
   * Ajusta la vista a toda la hoja para no recortar, exporta y restaura.
   */
  exportDocument(multiplier = 3) {
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
  }

  /** logicalHeight de la página actual (para XFDF) */
  getPageHeight() { return this._pdfH; }

  /* ── Undo / Redo ──────────────────────────────────────────────────── */
  undo() {
    if (!this._undoStack.length) return;
    const current = this._markupObjs().map(o=>o.toObject(['data','name']));
    this._redoStack.push(JSON.stringify(current));
    this._restoreObjects(this._undoStack.pop());
    this.onUndoChange&&this.onUndoChange(this._undoStack.length,this._redoStack.length);
  }

  redo() {
    if (!this._redoStack.length) return;
    const current = this._markupObjs().map(o=>o.toObject(['data','name']));
    this._undoStack.push(JSON.stringify(current));
    this._restoreObjects(this._redoStack.pop());
    this.onUndoChange&&this.onUndoChange(this._undoStack.length,this._redoStack.length);
  }

  /* ════════════════════════════════════════════════════════════════════
     PRIVADO: utilidades internas
     ════════════════════════════════════════════════════════════════════ */

  _markupObjs() { return this.canvas.getObjects().filter(o=>!o.isBackground && !o.isCursor); }

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
    const counts = {};
    this._markupObjs().forEach(o => {
      const author = o.data?.autor || 'Anónimo';
      counts[author] = (counts[author] || 0) + 1;
    });
    return Object.entries(counts).map(([name, count]) => ({ name, count }));
  }

  /** ¿Están ocultos los markups de este autor? */
  isAuthorHidden(name) { return this._hiddenAuthors.has(name); }

  /** Mostrar/ocultar anotaciones de un autor específico (estado persistente) */
  filterByAutor(name, visible) {
    if (visible) this._hiddenAuthors.delete(name);
    else         this._hiddenAuthors.add(name);
    // Fijar la visibilidad de TODOS los objetos de ese autor (ocultar y mostrar)
    this._markupObjs().forEach(o => {
      if ((o.data?.autor || 'Anónimo') === name) o.visible = visible;
    });
    this.canvas.renderAll();
  }

  /**
   * Reaplica la visibilidad según los autores ocultos. Se llama tras recrear
   * objetos (capa remota, cambio de página) para que el filtro no se pierda.
   */
  _applyAuthorVisibility() {
    if (!this._hiddenAuthors.size) return;
    this._markupObjs().forEach(o => {
      const author = o.data?.autor || 'Anónimo';
      if (this._hiddenAuthors.has(author)) o.visible = false;
    });
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
    const objects = JSON.parse(jsonStr||'[]');
    if (!objects.length) { this.canvas.renderAll(); this._skipSnap=false; return; }
    fabric.util.enlivenObjects(objects, enlivened => {
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
