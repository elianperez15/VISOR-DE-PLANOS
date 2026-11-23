/* ═══════════════════════════════════════════════════════════════════════
   MarkupLayer — lienzo de anotaciones (Fabric.js v5) sobre el plano

   Herramientas:
   select · pan · arrow · line · measure · angle · perimeter · area
   cloud  · cloud-poly · rect · ellipse · highlight · link · image
   text   · note · callout · freehand · stamp · eraser

   Este archivo es el NÚCLEO: estado, fondo, herramientas, eventos de ratón y
   teclado, serialización y deshacer. El comportamiento de cada dominio sobre
   el lienzo vive en su carpeta y se agrega al prototipo (mixins, al final):

     anotaciones/lienzo/  shapes · clouds · text-labels · attachment-thumbs
     mediciones/          measure-shapes
     rfi/                 rfi-cloud-stamp
     plano/               detail-tiles
     revisiones/          compare-overlay
     exportacion/         canvas-export
     colaboracion/        canvas-collab

   La interfaz `MarkupLayer` (declaración fusionada con la clase) le da al
   compilador los tipos de esos métodos, así que `this.` se sigue validando.
   ═══════════════════════════════════════════════════════════════════════ */

import { fabric } from 'fabric';
import { ScaleManager } from '../../mediciones/scale-manager';
import { measureShapeMethods } from '../../mediciones/measure-shapes';
import { rfiCloudMethods } from '../../rfi/rfi-cloud-stamp';
import { detailTileMethods } from '../../plano/detail-tiles';
import { compareOverlayMethods } from '../../revisiones/compare-overlay';
import { canvasExportMethods } from '../../exportacion/canvas-export';
import { canvasCollabMethods } from '../../colaboracion/canvas-collab';
import type { Rect } from '../../plano/pdf-renderer';
import { shapeMethods } from './shapes';
import { cloudMethods } from './clouds';
import { textLabelMethods } from './text-labels';
import { attachmentThumbMethods } from './attachment-thumbs';

// Límites de zoom del lienzo (multiplicador absoluto sobre el tamaño lógico)
const MIN_ZOOM = 0.04;
const MAX_ZOOM = 20;

// El backend WebGL de filtros tiene un límite de textura (~2048 px): en imágenes
// grandes el filtro (p.ej. el tinte rojo del overlay) solo se aplica a la esquina
// superior izquierda. El backend 2D procesa la imagen completa sin ese límite.
if (fabric.Canvas2dFilterBackend) {
  fabric.filterBackend = new fabric.Canvas2dFilterBackend();
}

type Point = { x: number; y: number };

/** Tile de detalle que entrega un proveedor de región (plano base o comparación). */
export interface RegionTile {
  canvas?: HTMLCanvasElement | null;
  dataUrl?: string | null;
  pxW: number;
  pxH: number;
  opacity?: number;   // < 1 → tile translúcido (revisión al ajustarla)
}
export type RegionProvider = (rect: Rect, density: number) => Promise<RegionTile | null>;

export class MarkupLayer {
  scaleManager: ScaleManager;
  canvas: any;   // fabric.Canvas

  // ── Estilo activo ──────────────────────────────────────────────────
  strokeColor = '#ef4444';
  fillColor   = 'rgba(239,68,68,0.10)';
  strokeWidth = 2;
  fontSize    = 16;   // tamaño de texto para Texto / Nota / Globo

  // ── Estado de dibujo ───────────────────────────────────────────────
  currentTool    = 'select';
  _drawingPts: Point[] = [];
  _isDrawing     = false;
  _twoClick      = false;  // modo "dos puntos": esperando el segundo clic
  _tempLine: any = null;
  _tempPoly: any = null;
  _mouseStart: Point | null = null;
  _lastClick     = 0;      // ms del último mousedown (detección dbl-clic)
  _lastRightClick = 0;     // ms del último clic derecho (doble clic derecho = zoom out)
  _isPanning     = false;
  _panStart: Point | null = null;
  _spaceDown     = false;  // barra espaciadora mantenida → pan temporal
  _pendingStampPos: Point | null = null;   // dónde va el sello que se está eligiendo
  _pendingImagePos: Point | null = null;   // dónde va la imagen que se está eligiendo
  // Listeners del documento y observador de tamaño: se liberan en destroy()
  _docListeners: [string, EventListener][] = [];
  _resizeObserver: ResizeObserver | null = null;

  // ── Background (página PDF) ────────────────────────────────────────
  _bgImage: any = null;
  _pdfW = 0;
  _pdfH = 0;  // ancho y alto LÓGICOS de la página (en puntos PDF)

  // ── Detalle de alta resolución (re-render dinámico tipo Procore) ───
  _detailImg: any = null;   // fabric.Image del tile de la región visible
  _detailTimer: ReturnType<typeof setTimeout> | null = null;  // debounce de _refreshDetail
  _baseSS = 1;              // supersample del fondo base (imageW / logicalW)
  requestRegion: RegionProvider | null = null;
  // Igual que requestRegion pero devuelve el DIFF de revisiones de esa región.
  // Lo inyecta revisiones/compare-revisions mientras la comparación está activa.
  requestCompareRegion: RegionProvider | null = null;
  _detailReqId  = 0;        // descarta resultados obsoletos al hacer zoom/pan rápido
  _cmpImg: any  = null;     // overlay de comparación de revisiones (Rev B sobre A)
  _cmpSS        = 0;        // resolución del overlay de comparación (imgW / logicalW)
  _cmpDragging  = false;    // overlay en modo "ajustar" (arrastrable)
  _cmpOpacity   = 1;        // opacidad real del overlay (se anula bajo un tile translúcido)
  _cmpTileImg: any = null;  // tile de detalle DEL OVERLAY (ranura aparte del base)
  _cmpTileReqId = 0;

  // ── Recorte de región (captura por selección) ─────────────────────
  _snapshotMode: 'draw' | 'adjust' | null = null;
  _snapOnReady: (() => void) | null = null;
  _snapOnDone: ((dataUrl: string | null) => void) | null = null;
  _snapRect: any = null;
  _snapStart: Point | null = null;
  _snapTwoClick = false;

  // ── Undo / Redo ────────────────────────────────────────────────────
  _undoStack: string[] = [];
  _redoStack: string[] = [];
  _maxHistory = 60;
  _skipSnap   = false;

  // ── Callbacks ─────────────────────────────────────────────────────
  onZoomChange: ((zoom: number) => void) | null = null;
  onUndoChange: ((undoLen: number, redoLen: number) => void) | null = null;
  onAreaReady: ((label: string) => void) | null = null;
  onStampPick: ((x: number, y: number) => void) | null = null;       // abre modal sello
  onImagePick: ((x: number, y: number) => void) | null = null;       // abre selector de imagen
  onHint: ((msg: string) => void) | null = null;
  onAutoSelect: (() => void) | null = null;                          // al terminar de colocar una figura
  onAnnotHover: ((data: any, evt: MouseEvent | null) => void) | null = null;   // tooltip de autor
  onAnnotClick: ((obj: any) => void) | null = null;                  // al seleccionar una anotación
  onFollowLink: ((data: any) => void) | null = null;                 // doble clic en hipervínculo
  onShowImage: ((dataUrl: string) => void) | null = null;            // ampliar imagen adjunta
  onStampDblClick: ((data: any, obj: any) => void) | null = null;    // doble clic en un sello (p.ej. RFI)
  onCloudCreated: ((obj: any) => void) | null = null;                // se colocó una nube de revisión
  onLinkCreated: ((obj: any) => void) | null = null;                 // se colocó un hipervínculo
  onLocalChange: (() => void) | null = null;                         // el usuario cambió SU capa (debounced)

  // ── Colaboración en tiempo real ────────────────────────────────────
  _applyingRemote = false;   // true mientras se pinta una capa remota (no re-emitir)
  _collabTimer: ReturnType<typeof setTimeout> | null = null;   // debounce de onLocalChange
  _peerCursors = new Map<string, any>();   // id → fabric objeto del cursor remoto
  _lastCursorZoom = 1;       // último zoom aplicado a los cursores remotos

  // ── Usuario actual ─────────────────────────────────────────────────
  currentUser = 'Anónimo';

  // ── Autores ocultos (filtro del panel de colaboradores) ────────────
  _hiddenAuthors = new Set<string>();   // nombres cuyos markups están ocultos

  constructor(canvasId: string, options: { scaleManager?: ScaleManager } = {}) {
    this.scaleManager = options.scaleManager || new ScaleManager();

    this.canvas = new fabric.Canvas(canvasId, {
      selection             : true,
      preserveObjectStacking: true,
      stopContextMenu       : false,
      fireRightClick        : true,
      enableRetinaScaling   : true,   // usa devicePixelRatio → nitidez en pantallas HiDPI/Retina
    });

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
      if (wrapper) {
        this._resizeObserver = new ResizeObserver(() => {
          this._sizeToContainer();
          if (this._bgImage) this._fitToCanvas();
        });
        this._resizeObserver.observe(wrapper);
      }
    }
  }

  /** Escucha un evento del documento; destroy() lo quita (el lienzo se recrea por plano). */
  _listen<K extends keyof DocumentEventMap>(type: K, fn: (e: DocumentEventMap[K]) => void) {
    document.addEventListener(type, fn);
    this._docListeners.push([type, fn as EventListener]);
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
  setBackground(dataUrl: string, imageWidth: number, imageHeight: number, logicalWidth: number, logicalHeight: number) {
    return new Promise<void>(resolve => {
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
  /** Tamaño de texto por defecto para las nuevas anotaciones (Texto/Nota/Globo).
      Igual que los demás controles de estilo: define el valor de las próximas figuras. */
  setFontSize(px) {
    this.fontSize = parseInt(px, 10) || 16;
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
      if (obj && !obj.isBackground && !obj.isThumb) this.onAnnotClick && this.onAnnotClick(obj);
    });
    this.canvas.on('selection:updated', opt => {
      if (this.currentTool !== 'select') return;
      const obj = opt.selected?.[0];
      if (obj && !obj.isBackground && !obj.isThumb) this.onAnnotClick && this.onAnnotClick(obj);
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
        else if (obj.data?.type === 'cloud' && obj.data?.isRfi) this.onStampDblClick && this.onStampDblClick(obj.data, obj);
        return;
      }
      if (obj.data?.type === 'link')             this.onFollowLink && this.onFollowLink(obj.data);
      else if (obj.data?.type === 'att-thumb')   this.onShowImage && this.onShowImage(obj.data.src);   // miniatura → ampliar
      else if (obj.data?.type === 'photo-pin')   { const attachment = this._firstImageAttachment(obj); if (attachment) this.onShowImage && this.onShowImage(attachment.dataUrl); }
      else if (obj.data?.type === 'stamp')       this.onStampDblClick && this.onStampDblClick(obj.data, obj);
      else if (obj.data?.type === 'cloud' && obj.data?.isRfi) this.onStampDblClick && this.onStampDblClick(obj.data, obj);  // nube RFI → abrir RFI
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

  /** Coordenadas de pantalla (clientX/clientY) de un evento de ratón O táctil.
      En tablets el evento es TouchEvent y clientX/clientY viven en touches[]. */
  _clientXY(e) {
    if (e && e.touches && e.touches[0])               return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    if (e && e.changedTouches && e.changedTouches[0]) return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
    return { x: e ? e.clientX : 0, y: e ? e.clientY : 0 };
  }

  /* ── Mouse down ───────────────────────────────────────────────────── */
  _onDown(opt) {
    // Clic derecho: reservado para el doble-clic-derecho de zoom out (no dibuja)
    if (opt.e && opt.e.button === 2) return;
    if (this._snapshotMode === 'draw')  { this._snapDown(opt); return; }   // recorte: dibujar
    if (this._snapshotMode === 'adjust') return;                           // recorte: Fabric ajusta el rect
    const ptr  = this.canvas.getPointer(opt.e);
    const tool = this.currentTool;

    // La miniatura del adjunto: clic la selecciona para REDIMENSIONAR (esquina ↘);
    // doble clic la amplía. No dibujar/borrar encima de ella.
    if (opt.target?.isThumb) {
      if (tool !== 'select') { this.canvas.setActiveObject(opt.target); this.canvas.renderAll(); }
      return;
    }

    // Eraser: borrar objeto bajo cursor
    if (tool === 'eraser') {
      const target = opt.target;
      if (target && target.data?.remoto) {
        this._hint && this._hint('Esta figura es de otro usuario — no puedes borrarla');
        return;
      }
      if (this._isLockedRfiCloud(target)) {
        this._hint && this._hint('Nube RFI vinculada — no se puede eliminar');
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
      this._panStart  = this._clientXY(opt.e);   // funciona con ratón y con táctil (tablet)
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
      case 'line':
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

      // ── Herramientas de multi-clic (cierre con Enter/Esc/doble clic) ─
      case 'area':
      case 'perimeter':
      case 'cloud-poly':   // nube de puntos: clic en cada vértice, doble clic cierra
        if (isDbl) { this._finalizeMultiPoint(); }
        else {
          this._drawingPts.push({x:ptr.x,y:ptr.y}); this._isDrawing=true; this._updateTempPoly(ptr);
          if (tool === 'cloud-poly')
            this._hint('[[icon:cloud]] Clic en cada punto de la nube · doble clic o Enter para cerrar');
        }
        break;

      // ── Ángulo: exactamente 3 clics ─────────────────────────────────
      case 'angle':
        this._drawingPts.push({x:ptr.x,y:ptr.y});
        this._isDrawing = true;
        this._updateTempPoly(ptr);
        this._hint(this._drawingPts.length===1
          ? '[[icon:triangle]] Clic en el extremo del primer brazo'
          : '[[icon:triangle]] Clic en el extremo del segundo brazo');
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
    if (this._snapshotMode === 'draw')  { this._snapMove(opt); return; }   // recorte: dibujar
    if (this._snapshotMode === 'adjust') return;                           // recorte: Fabric ajusta
    const ptr = this.canvas.getPointer(opt.e);

    if (this._isPanning && this._panStart) {
      const c = this._clientXY(opt.e);   // ratón o táctil
      // Ignorar lecturas inválidas (evita que un NaN corrompa el transform y "borre" el plano)
      if (Number.isFinite(c.x) && Number.isFinite(c.y)) {
        this.canvas.relativePan({ x: c.x - this._panStart.x, y: c.y - this._panStart.y });
        this._panStart = c;
      }
      return;
    }

    const tool = this.currentTool;
    const dragTools = ['arrow','line','measure','rect','ellipse','highlight','link','cloud'];

    // Modo dos-puntos: tras el primer clic, la preview sigue al cursor sin botón
    if (this._twoClick && this._mouseStart && dragTools.includes(tool)) {
      this._updateTempPreview(this._mouseStart, ptr);
      return;
    }

    if (!this._isDrawing) return;

    if (dragTools.includes(tool)) {
      this._updateTempPreview(this._mouseStart, ptr);
    } else if (['area','perimeter','angle','cloud-poly'].includes(tool)) {
      this._updateTempPoly(ptr);
    }
  }

  /* ── Mouse up ─────────────────────────────────────────────────────── */
  _onUp(opt) {
    if (this._snapshotMode === 'draw')  { this._snapUp(opt); return; }   // recorte: fin del dibujo
    if (this._snapshotMode === 'adjust') return;                         // recorte: Fabric ajusta
    if (this._isPanning) {
      this._isPanning = false; this._panStart = null;
      this.canvas.setCursor(this.currentTool==='pan'?'grab':'crosshair');
      this._scheduleDetail();
      return;
    }

    const tool = this.currentTool;
    if (!this._isDrawing || ['select','freehand','area','perimeter','angle','cloud-poly','text','note','callout','stamp','eraser'].includes(tool)) return;

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
      case 'line':      this._addLine     (start.x,start.y,end.x,end.y); break;
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
    if (tool === 'arrow' || tool === 'line' || tool === 'measure') {
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
    this._listen('keydown', domEvent => {
      const activeTag = document.activeElement.tagName;
      if (activeTag==='INPUT'||activeTag==='TEXTAREA') return;

      if (domEvent.key==='Escape' && this._snapshotMode) { this.cancelRegionSnapshot(); return; }
      if (domEvent.key==='Enter' && this._isDrawing) { this._finalizeMultiPoint(); return; }
      if (domEvent.key==='Escape') {
        this._cancelDrawing();                 // descarta la figura en progreso (arrastre/2 clics/multipunto)
        this.canvas.discardActiveObject();     // deselecciona lo que hubiera seleccionado
        // Aborta por completo la colocación: vuelve a "Seleccionar" (también en herramientas de 1 clic)
        if (this.currentTool !== 'select') {
          if (this.onAutoSelect) this.onAutoSelect();
          else this.setTool('select');
        }
        this.canvas.renderAll();
        return;
      }

      if ((domEvent.key==='Delete'||domEvent.key==='Backspace')) {
        const obj = this.canvas.getActiveObject();
        if (obj && !obj.isBackground) {
          if (obj.isThumb) return;   // la miniatura del adjunto se gestiona desde el pin
          if (obj.isEditing) return; // texto en edición
          if (obj.data?.remoto) return; // figura de otro usuario → no borrable
          if (this._isLockedRfiCloud(obj)) { this._hint && this._hint('Nube RFI vinculada — no se puede eliminar'); return; }
          // Eliminar también su etiqueta de texto enlazada
          if (obj.data?.type === 'cloud' && obj.data?.cloudId) this._removeCloudLabel(obj.data.cloudId);
          if (obj.data?.labelId) { this._removeLabel(obj.data.labelId); this._removeThumb(obj.data.labelId); }
          this.canvas.remove(obj);
          this.canvas.discardActiveObject();
          this.canvas.renderAll();
        }
      }
    });

    // Barra espaciadora mantenida → pan temporal (se restaura al soltar)
    this._listen('keydown', domEvent => {
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
    this._listen('keyup', domEvent => {
      if (domEvent.code === 'Space') {
        this._spaceDown = false;
        this.canvas.selection = (this.currentTool === 'select');
        this.canvas.defaultCursor = this.currentTool==='pan' ? 'grab' : 'default';
        this.canvas.setCursor(this.canvas.defaultCursor);
      }
    });
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
      case 'area':       this._addArea     (pts); break;
      case 'perimeter':  this._addPerimeter(pts); break;
      case 'cloud-poly': if (pts.length>=3) this._addCloud(pts); break;   // ≥3 vértices = nube
      case 'angle':      if (pts.length>=3) this._addAngle(pts[0],pts[1],pts[2]); break;
    }
    if (this.onAutoSelect) this.onAutoSelect();   // una sola inserción → volver a seleccionar
  }

  /* ════════════════════════════════════════════════════════════════════
     API PÚBLICA
     ════════════════════════════════════════════════════════════════════ */

  setMarkupVisible(visible) {
    this._markupObjs().forEach(o => { o.visible = visible; });
    this.canvas.renderAll();
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

  fitToCanvas() { if (this._pdfW>0) this._fitToCanvas(); }

  /* ── Serialización ─────────────────────────────────────────────────── */
  getMarkupJSON() {
    // Las miniaturas de adjuntos no se guardan: se regeneran desde data.adjuntos
    return JSON.stringify(
      this._markupObjs().filter(o=>!o.isThumb).map(o=>o.toObject(['data','name']))
    );
  }

  /** Registra un cambio hecho FUERA del lienzo (panel, selectores, adjuntos):
      entra al historial de deshacer y se sincroniza con la sala. */
  commitChange() {
    this._snapshot();
    this._notifyLocalChange();
  }

  /** Avisa (con debounce) que el usuario local cambió su capa. */
  _notifyLocalChange() {
    if (this._applyingRemote || !this.onLocalChange) return;
    if (this._collabTimer) clearTimeout(this._collabTimer);
    this._collabTimer = setTimeout(() => this.onLocalChange(), 500);
  }

  /** Convierte un evento del DOM a coordenadas lógicas del plano. */
  scenePointFromEvent(e) {
    return this.canvas.getPointer(e);
  }

  setMarkupJSON(json) {
    this._skipSnap = true;
    this._markupObjs().forEach(o=>this.canvas.remove(o));
    // Las capas de OTROS autores no se restauran desde la sesión: las repinta
    // la colaboración (applyRemoteLayer). Restaurarlas aquí las duplicaba: esta
    // carga es asíncrona y terminaba DESPUÉS de repintar la capa remota.
    const objects = (json ? JSON.parse(json) : []).filter(o => !o.data?.remoto);
    if (!objects.length) {
      this.canvas.renderAll(); this._skipSnap=false;
      this._undoStack=[]; this._redoStack=[];
      this.onUndoChange&&this.onUndoChange(0,0); return;
    }
    fabric.util.enlivenObjects(objects, enlivened => {
      enlivened.forEach(o=>this.canvas.add(o));
      // Regenerar miniaturas de figuras que tengan imágenes adjuntas
      enlivened.forEach(o => { if (this._firstImageAttachment(o)) this.refreshThumb(o); });
      this._relockCloudLabels(enlivened);   // etiquetas RFI: fijas (no editables/seleccionables)
      this._applyAuthorVisibility();   // respetar el filtro de autores ocultos
      this.canvas.renderAll(); this._skipSnap=false;
      this._undoStack=[]; this._redoStack=[];
      this.onUndoChange&&this.onUndoChange(0,0);
    });
  }

  /** Elimina SOLO las marcas del usuario actual (no las ajenas/bloqueadas). */
  clearMyMarkup() {
    const mine = this._markupObjs().filter(
      o => !o.data?.remoto && (o.data?.autor || 'Anónimo') === this.currentUser
           && !this._isLockedRfiCloud(o)   // las nubes RFI vinculadas no se eliminan
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

  /** Alto lógico de la página actual (se guarda en la sesión). */
  getPageHeight() { return this._pdfH; }

  /** Tamaño lógico de la página actual, en puntos PDF (para exportar a PDF). */
  getPageSize() { return { w: this._pdfW, h: this._pdfH }; }

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
  getAuthors(): { name: string; count: number }[] {
    const counts: Record<string, number> = {};
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

  /** Libera el lienzo al cambiar de plano: listeners del documento, observador
      de tamaño y temporizadores pendientes (si no, seguirían actuando sobre un
      canvas ya destruido). */
  destroy() {
    this._docListeners.forEach(([type, fn]) => document.removeEventListener(type, fn));
    this._docListeners = [];
    this._resizeObserver?.disconnect();
    if (this._detailTimer) clearTimeout(this._detailTimer);
    if (this._collabTimer) clearTimeout(this._collabTimer);
    this.canvas.dispose();
  }
}

/* ── Comportamiento de cada dominio sobre el lienzo (mixins) ───────────── */
type MixinMethods =
  typeof shapeMethods & typeof cloudMethods & typeof textLabelMethods & typeof attachmentThumbMethods &
  typeof measureShapeMethods & typeof rfiCloudMethods & typeof detailTileMethods &
  typeof compareOverlayMethods & typeof canvasExportMethods & typeof canvasCollabMethods;

export interface MarkupLayer extends MixinMethods {}

Object.assign(
  MarkupLayer.prototype,
  shapeMethods, cloudMethods, textLabelMethods, attachmentThumbMethods,
  measureShapeMethods, rfiCloudMethods, detailTileMethods,
  compareOverlayMethods, canvasExportMethods, canvasCollabMethods,
);
