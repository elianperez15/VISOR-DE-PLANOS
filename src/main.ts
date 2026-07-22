/* ═══════════════════════════════════════════════════════════════════════
   main.ts — Orquestador SAF Visor de Planos  (PDF.js + Fabric.js)

   Este archivo cablea los módulos y mantiene el estado de la sesión. La
   lógica reutilizable/independiente vive en módulos aparte:

     core/pdf-renderer   · render del PDF
     core/markup-layer   · capa de anotaciones (Fabric)
     core/collab         · cliente WebSocket de colaboración
     core/scale-manager  · calibración de escala
     core/user-colors    · color determinístico por autor
     ui/tool-defs        · catálogos de herramientas y tipos de anotación
     ui/dropdowns        · menús desplegables / flyouts
     ui/rail-drag        · riel flotante arrastrable
     ui/color-utils      · conversión de colores (panel apariencia)
     ui/image-utils      · optimización de imágenes adjuntas
     ui/icons            · iconos embebidos
     features/collab-sync       · colaboración tiempo real + persistencia ORDS
     features/properties-panel  · panel de propiedades de la anotación
     features/list-picker       · modal genérico con buscador (planos · RFIs)
     features/compare-revisions · comparación de revisiones (overlay)
     config              · endpoints (VITE_*)

   Secciones de este archivo (en orden):
     1.  Instancias y estado          8.  Calibración de escala
     2.  Refs DOM + loader            9.  Panel de propiedades + adjuntos
     3.  Herramientas / initMarkup    10. Usuarios / presencia / tooltip
     4.  Colaboración en tiempo real  11. Selector de plano (hipervínculo)
     5.  Carga de PDF                 12. Arranque (wiring de eventos)
     6.  Navegación / comparación     13. Utilidades UI
     7.  Sesión JSON / XFDF           14. Bootstrap (URL params / postMessage)
   ═══════════════════════════════════════════════════════════════════════ */

import './styles/viewer.css';

import { PDFRenderer } from './core/pdf-renderer';
import { ScaleManager } from './core/scale-manager';
import { MarkupLayer } from './core/markup-layer';
import { Storage } from './data/storage';
import { XFDFConverter } from './data/xfdf';
import { Collab } from './core/collab';
import { API_PDF, APEX_ORIGIN, API_RFI, APEX_RFI_PAGE, API_PLANOS } from './config';

// Iconos line-style (estilo Lucide) embebidos localmente — sin dependencia ni CDN
import { renderIcons } from './ui/icons';

// Módulos de UI / datos extraídos (lógica cohesiva separada del orquestador)
import { ANNOT_TOOLS, MEASURE_TOOLS, TOOL_HINTS, ANNOT_TYPES } from './ui/tool-defs';
import { getUserColor } from './core/user-colors';
import { closeAllDropdowns, initDropdowns } from './ui/dropdowns';
import { initRailDrag } from './ui/rail-drag';
import { createConfirm } from './ui/confirm';
import { colorToHex, extractFillAlpha, hexToRgba } from './ui/color-utils';
import { downscaleImage } from './ui/image-utils';
import { createCollabSync } from './features/collab-sync';
import { createPropertiesPanel } from './features/properties-panel';
import { createCompareRevisions } from './features/compare-revisions';
import { createListPicker } from './features/list-picker';

(function () {
  'use strict';

  /* ── Constantes de configuración ───────────────────────────────────── */
  const CURSOR_THROTTLE_MS    = 50;                // mínimo entre envíos de cursor
  const PDF_RENDER_SUPERSAMPLE = 3.0;              // factor de supermuestreo al rasterizar PDF
  const MAX_ATTACHMENT_BYTES  = 25 * 1024 * 1024;  // 25 MB por adjunto
  const ATTACHMENT_MAX_DIM    = 1920;              // px máximos al redimensionar imágenes
  const ATTACHMENT_JPEG_QUALITY      = 0.82;       // calidad al pegar/soltar imagen
  const ATTACHMENT_JPEG_QUALITY_FILE = 0.85;       // calidad al adjuntar desde archivo
  const HINT_AUTO_HIDE_MS     = 5000;              // tiempo visible de los hints

  /* ── Instancias ────────────────────────────────────────────────────── */
  const pdfRenderer     = new PDFRenderer();
  const scaleManager    = new ScaleManager();
  const storage         = new Storage();
  const collab          = new Collab();
  const confirmDialog   = createConfirm();   // modal de confirmación reutilizable
  let   markup          = null;

  let   lastCursorSentAt = 0;   // throttle del envío de cursor (mouse:move)

  /* ── Presencia: usuarios conectados a la sala  id(socket) → {user,color}.
     Lo escribe collab-sync y lo lee buildUsersPanel (compartido por referencia). */
  const presenceByUser = new Map();

  /* ── Estado ───────────────────────────────────────────────────────── */
  const session = { docId:null, docName:'', pages:{}, pageHeights:{}, scale:null, rotation:0 };
  let currentPage   = 1;
  let totalPages    = 0;
  let markupVisible = true;
  let rotation      = 0;    // giro de vista temporal (en memoria): 0 | 90 | 180 | 270

  /* ── Refs DOM ─────────────────────────────────────────────────────── */
  const $ = id => document.getElementById(id);
  const ui = {
    fileInput    : $('file-input'),
    sessionInput : $('session-input'),
    xfdfInput    : $('xfdf-input'),
    btnOpen      : $('btn-open'),
    btnOpenLarge : $('btn-open-large'),
    btnSave      : $('btn-save'),
    btnLoad      : $('btn-load'),
    btnXfdfSave  : $('btn-xfdf-save'),
    btnXfdfLoad  : $('btn-xfdf-load'),
    btnRotateLeft : $('btn-rotate-left'),
    btnRotateRight: $('btn-rotate-right'),
    zoomInfo     : $('zoom-info'),
    btnZoomIn    : $('btn-zoom-in'),
    btnZoomOut   : $('btn-zoom-out'),
    btnFit       : $('btn-fit'),
    tbStatus     : $('tb-status'),
    btnUndo      : $('btn-undo'),
    btnRedo      : $('btn-redo'),
    btnToggle    : $('btn-toggle-markup'),
    btnCalibrate : $('btn-calibrate'),
    btnClear     : $('btn-clear'),
    btnExportPng : $('btn-export-png'),
    strokeColor  : $('stroke-color'),
    fillColor    : $('fill-color'),
    fillAlpha    : $('fill-alpha'),
    strokeWidth  : $('stroke-width'),
    emptyState   : $('empty-state'),
    canvasWrapper: $('canvas-wrapper'),
    drawHint     : $('draw-hint'),
    saveToast    : $('save-toast'),
    saveToastIc  : $('save-toast-ic'),
    saveToastMsg : $('save-toast-msg'),
    areaPanel    : $('area-panel'),
    areaValue    : $('area-value'),
    // Calibración
    modalCal        : $('modal-calibrate'),
    calStep1        : $('cal-step-1'),
    calStep2        : $('cal-step-2'),
    calStep3        : $('cal-step-3'),
    calPxHint       : $('cal-px-hint'),
    calValue        : $('cal-value'),
    calUnit         : $('cal-unit'),
    btnCalApply     : $('btn-cal-apply'),
    btnCalCancel    : $('btn-cal-cancel'),
    btnCalTabPoints : $('btn-cal-tab-points'),
    btnCalTabDirect : $('btn-cal-tab-direct'),
    calModePoints   : $('cal-mode-points'),
    calModeDirect   : $('cal-mode-direct'),
    calPxDirect     : $('cal-px-direct'),
    calValDirect    : $('cal-val-direct'),
    calUnitDirect   : $('cal-unit-direct'),
    calDirectPreview: $('cal-direct-preview'),
    calSteps        : $('cal-steps'),
    calResult       : $('cal-result'),
    calResultValue  : $('cal-result-value'),
    btnCalReset     : $('btn-cal-reset'),
    // Sello
    modalStamp    : $('modal-stamp'),
    btnStampCancel: $('btn-stamp-cancel'),
    // Grupos de herramientas
    btnAnnotGroup  : $('btn-annot-group'),
    btnMeasureGroup: $('btn-measure-group'),
    // Panel de propiedades
    btnTogglePanel: $('btn-toggle-panel'),
    // Usuarios
    userDot      : $('user-dot'),
    userNameLabel: $('user-name-label'),
    authorsList  : $('authors-list'),
    annotTooltip : $('annot-tooltip'),
    planoLoader     : $('plano-loader'),
    planoLoaderText : $('plano-loader-text'),
  };

  /* ── Modo embebido (APEX): se abre un plano por parámetro → sin "Abrir PDF" ── */
  let isEmbeddedMode = false;

  /** Muestra/oculta el loader de "cargando plano". */
  function showPlanoLoader(msg) {
    if (!ui.planoLoader) return;
    if (ui.planoLoaderText && msg) ui.planoLoaderText.textContent = msg;
    ui.planoLoader.style.display = 'flex';
  }
  function hidePlanoLoader() {
    if (ui.planoLoader) ui.planoLoader.style.display = 'none';
  }

  /** Oculta las opciones de abrir un PDF local (modo embebido en APEX). */
  function disableOpenControls() {
    isEmbeddedMode = true;
    [ui.btnOpen, ui.btnOpenLarge].forEach(b => { if (b) b.style.display = 'none'; });
  }

  /* ── RFI: selector (modal) + drawer en APEX ────────────────────────── */

  // Cuando está activo, la próxima nube colocada abrirá la modal para vincular un RFI.
  let pendingRfiCloud = false;
  const RFI_CLOUD_COLOR = '#e1251b';   // rojo fijo de las nubes RFI

  /** Selector de RFI — mismo modal/estilo que el de hipervínculos (list-picker). */
  const rfiPicker = createListPicker({
    ids: { modal: 'modal-rfi', search: 'rfi-search', list: 'rfi-list', close: 'btn-rfi-close' },
    loadingText: 'Cargando RFIs…',
    fetchItems: async () => {
      const headers: any = {};
      if (_codigoProyecto != null && String(_codigoProyecto).trim() !== '')
        headers.codigo_proyecto = String(_codigoProyecto).trim();
      const res = await fetch(API_RFI, { credentials: 'include', headers });
      return res.ok ? ((await res.json()).items || []) : [];
    },
    toRow: (it) => ({
      value: String(it.id ?? it.ID ?? ''),
      label: String(it.display ?? it.DISPLAY ?? it.nombre ?? (it.id ?? '')),
    }),
    onPick: (target, id, label) => {
      if (!target) return;
      target.data = Object.assign(target.data || {}, { rfiId: id, rfiLabel: label });
      if (activeAnnotationObject === target) $('ap-rfi-name').textContent = label;
      // Nube RFI: escribir "RFI <número>" dentro de la nube
      if (target.data?.type === 'cloud' && markup) {
        markup.setCloudLabel(target, `RFI ${id}`);
      }
      markup && markup._snapshot();
      markup && markup._notifyLocalChange && markup._notifyLocalChange();
      openRfiDrawer(id);   // al elegir, abre el drawer
    },
  });

  /** Avisa a APEX (padre) para abrir el drawer del RFI seleccionado (página 87490). */
  function openRfiDrawer(rfiId) {
    if (rfiId == null || String(rfiId).trim() === '') return;
    const msg = {
      action  : 'openRfi',
      rfiId   : rfiId,                 // id del RFI elegido → lo recibe el drawer
      apexPage: APEX_RFI_PAGE,         // página del drawer (87490)
      repoId  : session.docId,         // id_en_repositorio del plano (por si lo necesita)
      page    : currentPage,
    };
    try { if (window.parent !== window) window.parent.postMessage(msg, APEX_ORIGIN); } catch (e) {}
    showHint('Abriendo RFI…');
  }

  /** Doble clic en el sello RFI → abrir el drawer con su RFI vinculado (si lo tiene). */
  function onRfiStampDblClick(data) {
    const d = data || {};
    if (String(d.label || '').toUpperCase() !== 'RFI') return;   // solo el sello RFI
    if (d.rfiId) openRfiDrawer(d.rfiId);
    else showHint('Selecciona el RFI en el panel de propiedades');
  }


  /* ── Activar herramienta ─────────────────────────────────────────── */
  function activateTool(tool) {
    if (!markup) return;
    pendingRfiCloud = false;   // cualquier cambio de herramienta cancela el modo Nube RFI
    markup.setTool(tool);
    closeAllDropdowns();

    // Reset active
    document.querySelectorAll('.tb-tool').forEach(b => b.classList.remove('tb-btn-active'));
    document.querySelectorAll('.tb-tool-group-btn').forEach(b => b.classList.remove('tb-btn-active'));

    // Marcar el botón directo (si existe en la barra principal)
    document.querySelectorAll(`.tb-tool[data-tool="${tool}"]`)
      .forEach(b => b.classList.add('tb-btn-active'));

    // Actualizar label del grupo dropdown
    if (ANNOT_TOOLS[tool]) {
      const info = ANNOT_TOOLS[tool];
      ui.btnAnnotGroup.querySelector('.tool-gicon').innerHTML = `<i data-lucide="${info.lc}"></i>`;
      ui.btnAnnotGroup.querySelector('.tool-gname').textContent = info.name;
      ui.btnAnnotGroup.classList.add('tb-btn-active');
      renderIcons();
    } else if (MEASURE_TOOLS[tool]) {
      const info = MEASURE_TOOLS[tool];
      ui.btnMeasureGroup.querySelector('.tool-gicon').innerHTML = `<i data-lucide="${info.lc}"></i>`;
      ui.btnMeasureGroup.querySelector('.tool-gname').textContent = info.name;
      ui.btnMeasureGroup.classList.add('tb-btn-active');
      renderIcons();
    }

    showHint(TOOL_HINTS[tool] || '', true);
  }

  /* ════════════════════════════════════════════════════════════════════
     INIT CANVAS
     ════════════════════════════════════════════════════════════════════ */
  function initMarkup() {
    if (markup) markup.destroy();
    markup = new MarkupLayer('fabric-canvas', { scaleManager });
    markup.onZoomChange  = z    => { ui.zoomInfo.textContent = `${Math.round(z*100)}%`; };
    markup.onUndoChange  = (u,r) => { ui.btnUndo.disabled=!u; ui.btnRedo.disabled=!r; };
    markup.onAreaReady   = lbl  => { ui.areaValue.textContent=lbl; ui.areaPanel.style.display='flex'; };
    markup.onStampPick   = ()   => { ui.modalStamp.style.display='flex'; };
    markup.onImagePick   = ()   => { const inp = $('img-place-input'); inp.value=''; inp.click(); };
    markup.onHint        = msg  => showHint(msg);
    markup.onAutoSelect  = ()   => activateTool('select'); // vuelve a select tras colocar nube
    markup.onAnnotClick  = obj  => propsPanel.open(obj);
    markup.onFollowLink  = data => {
      const d = data || {};
      if (d.targetRepoId != null && String(d.targetRepoId).trim() !== '') {
        // Avisar a APEX (padre) para que ejecute su ajax callback y abra el plano.
        // El iframe va en sandbox → no puede abrir pestañas ni usar apex.server.process;
        // el padre sí. Le pasamos también una URL lista por si decide abrirla directo.
        const p = new URLSearchParams();
        p.set('repoId', String(d.targetRepoId));
        if (d.targetFile) p.set('nombre', d.targetFile);
        if (_currentUserName && _currentUserName !== 'Anónimo') p.set('usuario_conectado', _currentUserName);
        if (_currentUserId != null) p.set('codigo_usuario', String(_currentUserId));
        const url = window.location.origin + window.location.pathname + '?' + p.toString();

        const msg = {
          action : 'openPlano',
          repoId : d.targetRepoId,
          name   : d.targetName || null,
          file   : d.targetFile || null,
          url,
        };
        console.info('[SAF] openPlano →', msg);   // diagnóstico: qué se envía a APEX
        // UN solo envío (dos causaban doble modal). El padre valida e.origin.
        try { if (window.parent !== window) window.parent.postMessage(msg, APEX_ORIGIN); } catch (e) {}
        showHint(`Abriendo ${d.targetName || ('plano ' + d.targetRepoId)}…`);
        return;
      }
      showHint('Este enlace no tiene plano destino — selecciónalo y elige uno con "Elegir plano…"');
    };
    markup.onShowImage   = src  => { $('att-lightbox-img').src = src; $('att-lightbox').style.display = 'flex'; };
    // Doble clic en un sello RFI → avisar a APEX para abrir su drawer de RFIs
    markup.onStampDblClick = (data) => onRfiStampDblClick(data);
    // Nube RFI: al colocar la nube en modo RFI, abrir la modal para vincular el RFI.
    // Se difiere al siguiente frame para que primero termine la colocación y el
    // auto-select de la nube; así la modal abre limpia y con foco en el buscador.
    markup.onCloudCreated = (obj) => {
      if (!pendingRfiCloud) return;
      pendingRfiCloud = false;
      obj.data = Object.assign(obj.data || {}, { isRfi: true });
      obj.set({ stroke: RFI_CLOUD_COLOR });   // color rojo fijo por defecto
      markup.canvas.renderAll();
      requestAnimationFrame(() => rfiPicker.open(obj));
    };
    // Colaboración: al cambiar la capa propia → emitir a la sala + persistir
    markup.onLocalChange = ()   => collabSync.pushLocalLayer();
    markup.canvas.on('after:render', updateFigToolbar);   // mini-toolbar sobre la figura
    // Si se elimina la figura abierta en el panel, cerrar el panel de propiedades
    markup.canvas.on('object:removed', opt => { if (opt.target && opt.target === activeAnnotationObject) propsPanel.close(); });
    // Cursor en vivo: enviar posición lógica (throttle ~50ms)
    markup.canvas.on('mouse:move', opt => {
      if (!collab.connected) return;
      const now = Date.now();
      if (now - lastCursorSentAt < CURSOR_THROTTLE_MS) return;
      lastCursorSentAt = now;
      const p = markup.scenePointFromEvent(opt.e);
      collab.sendCursor(currentPage, Math.round(p.x), Math.round(p.y));
    });
    markup.currentUser   = _currentUserName;
    // Zoom profundo: re-render dinámico de la región visible (tipo Procore)
    markup.requestRegion = (rect, density) => pdfRenderer.renderRegion(currentPage, rect, density, rotation);
    initAnnotTooltip();
  }

  /* ════════════════════════════════════════════════════════════════════
     COLABORACIÓN EN TIEMPO REAL  →  feature ./features/collab-sync
     El orquestador solo inyecta getters del estado y un callback de presencia.
     ════════════════════════════════════════════════════════════════════ */
  const collabSync = createCollabSync({
    collab,
    presence       : presenceByUser,                 // Map compartido (lo lee buildUsersPanel)
    getMarkup      : () => markup,
    getSession     : () => session,
    getCurrentPage : () => currentPage,
    getUser        : () => _currentUserName,
    getUserId      : () => _currentUserId,
    getRevId       : () => _currentRevId,
    onPresence     : () => buildUsersPanel(),
    // Restaura la orientación guardada: re-renderiza el fondo con esa rotación
    // (las marcas ya vienen guardadas en ese espacio de coordenadas).
    onRotationLoaded: (deg) => {
      const target = ((deg % 360) + 360) % 360;
      if (target === rotation) return;
      rotation = target;
      goToPage(currentPage);
    },
    // Restaura la escala calibrada guardada (pixeles / distancia_real / unidad).
    onScaleLoaded: (scale) => applyScaleFromSession(scale),
  });

  /* ════════════════════════════════════════════════════════════════════
     PDF
     ════════════════════════════════════════════════════════════════════ */
  async function openPDF(file) {
    setStatus('Cargando PDF…');
    try {
      const { numPages } = await pdfRenderer.load(file);
      totalPages = numPages;
      session.docId       = null;          // archivo local → sin sala de colaboración
      session.docName     = file.name;
      session.pages       = {};
      session.pageHeights = {};
      rotation            = 0;             // cada documento arranca sin rotar
      session.rotation    = 0;             // (se restaura desde el servidor si existe)
      collabSync.reset();
      ui.emptyState.style.display    = 'none';
      ui.canvasWrapper.style.display = 'flex';
      compare.close();   // la Rev B anterior ya no corresponde al nuevo documento
      initMarkup();
      enableDocs(true);
      await goToPage(1);
      setStatus('');
    } catch (e) {
      setStatus('Error: ' + e.message);
      alert('No se pudo cargar el PDF:\n' + e.message);
    }
  }

  /**
   * Abre un PDF desde una URL (p.ej. /pdfs/plano-123.pdf servido por Nginx).
   * Usado por la integración con APEX vía postMessage { action:'openPDF' }
   * o por el parámetro ?pdf=...&docId=... en la URL del iframe.
   */
  async function openPDFFromUrl(url, docId, name, httpHeaders = null) {
    if (!url) return;
    setStatus('Cargando PDF…');
    showPlanoLoader(name ? `Cargando ${name}…` : 'Cargando plano…');
    try {
      const { numPages } = await pdfRenderer.load(url, httpHeaders);
      totalPages = numPages;
      // id_en_repositorio es TEXTO (puede traer ceros al inicio): NO convertir a Number
      session.docId       = (docId != null && String(docId).trim() !== '') ? String(docId).trim() : null;
      session.docName     = name || url.split('/').pop() || 'documento.pdf';
      session.pages       = {};
      session.pageHeights = {};
      rotation            = 0;             // cada documento arranca sin rotar
      session.rotation    = 0;             // (se restaura desde el servidor si existe)
      collabSync.reset();
      ui.emptyState.style.display    = 'none';
      ui.canvasWrapper.style.display = 'flex';
      compare.close();
      initMarkup();
      enableDocs(true);
      await goToPage(1);
      // Colaboración: conectar PRIMERO a la sala (cursores y cambios en vivo),
      // luego traer las capas ya guardadas sin bloquear la conexión.
      collabSync.start();
      collabSync.loadFromServer();
      setStatus('');
    } catch (e) {
      setStatus('Error: ' + e.message);
      alert('No se pudo cargar el PDF desde la URL:\n' + e.message);
    } finally {
      hidePlanoLoader();
    }
  }

  /* ════════════════════════════════════════════════════════════════════
     NAVEGACIÓN
     ════════════════════════════════════════════════════════════════════ */
  async function goToPage(n) {
    if (!pdfRenderer.isLoaded || n<1 || n>totalPages) return;
    if (markup) session.pages[currentPage] = markup.getMarkupJSON();
    currentPage = n;
    setStatus('Renderizando…');
    const r = await pdfRenderer.renderPage(n, PDF_RENDER_SUPERSAMPLE, rotation);
    session.pageHeights[n] = r.logicalHeight;
    await markup.setBackground(r.dataUrl, r.imageWidth, r.imageHeight, r.logicalWidth, r.logicalHeight);
    propsPanel.closeIfOpen();
    markup.setMarkupJSON(session.pages[n] || null);
    markup.clearPeerCursors();                    // los cursores son por página
    collabSync.applyRemoteLayersForPage(n);       // pintar capas remotas de esta página
    buildUsersPanel();
    compare.onPageChange(n);   // mantener overlay de Rev B si está activa
    setStatus('');
  }

  /* Rota la vista 90° a derecha (horario) o izquierda (antihorario), temporal y
     en memoria. Gira el fondo re-renderizándolo con PDF.js y las marcas con la
     misma transformación, para que sigan alineadas sobre el plano. */
  async function rotateDocument(clockwise = true) {
    if (!pdfRenderer.isLoaded || !markup) return;
    rotation = (rotation + (clockwise ? 90 : 270)) % 360;
    session.rotation = rotation;        // se guardará al pulsar Guardar
    markup.rotateContent(clockwise);   // gira las marcas usando las dimensiones lógicas ACTUALES (previas)
    setStatus('Rotando…');
    const r = await pdfRenderer.renderPage(currentPage, PDF_RENDER_SUPERSAMPLE, rotation);
    session.pageHeights[currentPage] = r.logicalHeight;
    await markup.setBackground(r.dataUrl, r.imageWidth, r.imageHeight, r.logicalWidth, r.logicalHeight);
    collabSync.pushLocalLayer();        // sincroniza en vivo con los colaboradores (no persiste)
    setStatus('');
  }

  /* Comparación de revisiones → feature ./features/compare-revisions */
  const compare = createCompareRevisions({
    getMarkup        : () => markup,
    getSession       : () => session,
    getCurrentPage   : () => currentPage,
    getTotalPages    : () => totalPages,
    pdfRenderer,
    setStatus        : (m) => setStatus(m),
    updateScaleBadge : () => updateScaleBadge(),
  });

  /* ════════════════════════════════════════════════════════════════════
     SESIÓN JSON
     ════════════════════════════════════════════════════════════════════ */
  function saveSession() {
    if (!markup) return;
    session.pages[currentPage] = markup.getMarkupJSON();
    session.rotation = rotation;
    if (scaleManager.isCalibrated()) session.scale = buildScaleObj();
    const data = { version:3, docName:session.docName, pages:session.pages, pageHeights:session.pageHeights, scale:session.scale, rotation:session.rotation||0 };
    storage.downloadJSON(data, `saf-markup-${session.docName.replace(/\.pdf$/i,'')}-${Date.now()}.json`);
    storage.saveSession(data);
    setStatus('Sesión JSON guardada ✓');
  }

  async function loadSessionFile(file) {
    try {
      const data = await storage.readJSONFile(file);
      if (!data.pages) throw new Error('Formato inválido');
      Object.assign(session, { docName:data.docName||session.docName, pages:data.pages||{}, pageHeights:data.pageHeights||{}, scale:data.scale||null, rotation:data.rotation||0 });
      applyScaleFromSession(data.scale);
      if (markup && pdfRenderer.isLoaded) {
        rotation = ((session.rotation % 360) + 360) % 360;
        markup.setMarkupJSON(session.pages[currentPage]||null);
        if (rotation) goToPage(currentPage);   // re-renderiza el fondo con la orientación guardada
        buildUsersPanel(); setStatus('Sesión JSON cargada ✓');
      }
      else setStatus('Sesión cargada. Abre el PDF correspondiente.');
    } catch (e) { alert('Error al cargar sesión: '+e.message); }
  }

  /* ════════════════════════════════════════════════════════════════════
     XFDF
     ════════════════════════════════════════════════════════════════════ */
  function saveXFDF() {
    if (!markup) return;
    session.pages[currentPage] = markup.getMarkupJSON();
    session.pageHeights[currentPage] = markup.getPageHeight();
    const pagesWithMarkup = {};
    for (const [p, json] of Object.entries(session.pages)) {
      if (json && JSON.parse(json).length > 0) pagesWithMarkup[p] = json;
    }
    if (!Object.keys(pagesWithMarkup).length) { alert('No hay anotaciones que guardar.'); return; }
    const scale = scaleManager.isCalibrated() ? { pxPerUnit:scaleManager.pxPerUnit, unit:scaleManager.unit } : null;
    const xfdf  = XFDFConverter.toXFDF(pagesWithMarkup, session.docName||'documento.pdf', scale, session.pageHeights);
    XFDFConverter.downloadXFDF(xfdf, session.docName.replace(/\.pdf$/i,'') + '.xfdf');
    setStatus('XFDF guardado ✓');
  }

  async function loadXFDFFile(file) {
    try {
      const xfdfStr = await XFDFConverter.readFile(file);
      const { pages:parsed, scale } = XFDFConverter.fromXFDF(xfdfStr, session.pageHeights);
      if (scale?.pxPerUnit) { scaleManager.pxPerUnit=scale.pxPerUnit; scaleManager.unit=scale.unit; updateScaleBadge(); }
      for (const [p, objs] of Object.entries(parsed)) session.pages[p] = JSON.stringify(objs);
      if (markup && pdfRenderer.isLoaded) {
        markup.setMarkupJSON(session.pages[currentPage]||null);
        buildUsersPanel();
        setStatus(`XFDF cargado: ${file.name}  —  ${Object.keys(parsed).length} pág.`);
      } else setStatus(`XFDF cargado. Abre el PDF "${session.docName}" para verlo.`);
    } catch (e) { alert('Error al cargar XFDF: '+e.message); console.error(e); }
  }

  /* ════════════════════════════════════════════════════════════════════
     CALIBRACIÓN DE ESCALA
     ════════════════════════════════════════════════════════════════════ */
  let calibrationMode     = 'points';
  let calibrationState    = 0;
  let calibrationPoint1      = null, calibrationPoint2 = null;
  let calibrationListener = null;

  /** Marca el chip de paso activo/completado (1..3) en el indicador visual. */
  function setCalStep(step) {
    if (!ui.calSteps) return;
    ui.calSteps.querySelectorAll('.cal-step-chip').forEach(chip => {
      const n = Number(chip.getAttribute('data-step'));
      chip.classList.toggle('is-active', n === step);
      chip.classList.toggle('is-done',   n <  step);
    });
  }

  /** Reinicia el flujo de 2 puntos (sin cerrar la modal). */
  function resetPointsFlow() {
    calibrationState = 1; calibrationPoint1 = calibrationPoint2 = null;
    ui.calStep1.style.display='block';
    ui.calStep2.style.display='none';
    ui.calStep3.style.display='none';
    ui.calValue.value='';
    ui.calResult.style.display='none';
    ui.btnCalApply.disabled = true;
    setCalStep(1);
    if (window.calibrationLine && markup) {
      markup.canvas.remove(window.calibrationLine);
      window.calibrationLine = null;
      markup.canvas.renderAll();
    }
    addCalibrationListener();
  }

  function switchCalTab(mode) {
    calibrationMode = mode;
    const isPoints = (mode === 'points');

    ui.calModePoints.style.display = isPoints ? 'block' : 'none';
    ui.calModeDirect.style.display = isPoints ? 'none'  : 'block';
    ui.btnCalTabPoints.classList.toggle('cal-tab-active',  isPoints);
    ui.btnCalTabDirect.classList.toggle('cal-tab-active', !isPoints);
    ui.calResult.style.display = 'none';

    // La modal siempre queda anclada (clase modal-pick fija en el HTML): no salta
    // al cambiar de pestaña. En modo puntos el cursor es de mira sobre el canvas.
    if (isPoints) {
      resetPointsFlow();
    } else {
      removeCalibrationListener();
      if (markup) markup.canvas.defaultCursor = 'default';
      ui.btnCalApply.disabled = true;
      updateDirectPreview();
    }
  }

  function addCalibrationListener() {
    if (calibrationListener || !markup) return;
    markup.canvas.defaultCursor = 'crosshair';
    calibrationListener = opt => {
      if (!calibrationState) return;
      const ptr = markup.canvas.getPointer(opt.e);
      if (calibrationState === 1) {
        calibrationPoint1=ptr; calibrationState=2;
        ui.calStep1.style.display='none';
        ui.calStep2.style.display='block';
        setCalStep(2);
      } else if (calibrationState === 2) {
        calibrationPoint2=ptr; calibrationState=3;
        const px = Math.hypot(calibrationPoint2.x-calibrationPoint1.x, calibrationPoint2.y-calibrationPoint1.y);
        ui.calPxHint.innerHTML = `Distancia medida: <b>${px.toFixed(1)} px</b>`;
        ui.calStep2.style.display='none';
        ui.calStep3.style.display='block';
        setCalStep(3);
        ui.calValue.focus();
        updatePointsPreview();       // aún sin distancia real → Aplicar deshabilitado
        if (window.calibrationLine) markup.canvas.remove(window.calibrationLine);
        window.calibrationLine = new fabric.Line(
          [calibrationPoint1.x,calibrationPoint1.y,calibrationPoint2.x,calibrationPoint2.y],
          {stroke:'#facc15',strokeWidth:2,strokeDashArray:[5,3],selectable:false,evented:false}
        );
        markup.canvas.add(window.calibrationLine);
        markup.canvas.renderAll();
      }
    };
    markup.canvas.on('mouse:up', calibrationListener);
  }

  function removeCalibrationListener() {
    if (calibrationListener && markup) { markup.canvas.off('mouse:up',calibrationListener); calibrationListener=null; }
  }

  function openCalibrate() {
    // Reset todo
    calibrationPoint1=calibrationPoint2=null;
    ui.calValue.value='';
    ui.calPxDirect.value='';
    ui.calValDirect.value='';
    ui.calResult.style.display='none';
    ui.btnCalApply.disabled=true;
    // Neutralizar la herramienta para que clicar puntos no dibuje ni seleccione
    if (markup) activateTool('select');
    switchCalTab('points');          // siempre abre en modo 2-puntos
    ui.modalCal.style.display='flex';
  }

  /** Muestra la escala resultante en la caja de resultado. */
  function showCalResult(pxPerUnit, unit) {
    ui.calResultValue.textContent = `1 ${unit} = ${pxPerUnit.toFixed(2)} px`;
    ui.calResult.style.display = 'flex';
  }

  /** Modo 2 puntos: recalcula la vista previa cuando cambia la distancia real. */
  function updatePointsPreview() {
    const val = parseFloat(ui.calValue.value);
    if (calibrationPoint2 && val > 0) {
      const px = Math.hypot(calibrationPoint2.x-calibrationPoint1.x, calibrationPoint2.y-calibrationPoint1.y);
      showCalResult(px / val, ui.calUnit.value);
      ui.btnCalApply.disabled = false;
    } else {
      ui.calResult.style.display = 'none';
      ui.btnCalApply.disabled = true;
    }
  }

  function updateDirectPreview() {
    const px  = parseFloat(ui.calPxDirect.value);
    const val = parseFloat(ui.calValDirect.value);
    if (px>0 && val>0) {
      showCalResult(px / val, ui.calUnitDirect.value);
      ui.btnCalApply.disabled = false;
    } else {
      ui.calResult.style.display = 'none';
      ui.btnCalApply.disabled = true;
    }
  }

  function applyCalibration() {
    if (calibrationMode === 'direct') {
      const px  = parseFloat(ui.calPxDirect.value);
      const val = parseFloat(ui.calValDirect.value);
      if (!px||px<=0||!val||val<=0) { alert('Ingresa valores mayores a 0'); return; }
      scaleManager.calibrate(px, val, ui.calUnitDirect.value);
      session.scale = buildScaleObj();     // queda listo para guardar (botón Guardar)
      collabSync.broadcastScale(session.scale);   // escala global → todos los colaboradores
      closeCalibrate();
      updateScaleBadge();
      setStatus(`Escala: 1 ${ui.calUnitDirect.value} = ${scaleManager.pxPerUnit.toFixed(2)} px  ✓`);
    } else {
      if (!calibrationPoint2) { alert('Haz clic en dos puntos del plano primero.'); return; }
      const val = parseFloat(ui.calValue.value);
      if (!val||val<=0) { alert('Ingresa un valor mayor a 0'); return; }
      const px = Math.hypot(calibrationPoint2.x-calibrationPoint1.x, calibrationPoint2.y-calibrationPoint1.y);
      scaleManager.calibrate(px, val, ui.calUnit.value);
      session.scale = buildScaleObj();     // queda listo para guardar (botón Guardar)
      collabSync.broadcastScale(session.scale);   // escala global → todos los colaboradores
      closeCalibrate();
      updateScaleBadge();
      setStatus(`Escala: 1 ${ui.calUnit.value} = ${scaleManager.pxPerUnit.toFixed(2)} px  ✓`);
    }
  }

  function closeCalibrate() {
    calibrationState=0;
    ui.modalCal.style.display='none';
    removeCalibrationListener();
    if (markup) markup.canvas.defaultCursor='default';
    if (window.calibrationLine) {
      markup&&markup.canvas.remove(window.calibrationLine);
      window.calibrationLine=null;
      markup&&markup.canvas.renderAll();
    }
    markup&&markup.setTool(markup.currentTool);
  }

  /* ════════════════════════════════════════════════════════════════════
     PANEL DE PROPIEDADES DE ANOTACIÓN
     ════════════════════════════════════════════════════════════════════ */

  let activeAnnotationObject        = null;   // objeto Fabric.js activo en el panel
  let linkPickTarget = null; // enlace al que se le asignará el plano destino (vía postMessage APEX)

  /* Selector de plano destino (hipervínculo) — usa el picker genérico.
     El id del plano actual va como header `id` para excluirlo del listado. */
  const planoPicker = createListPicker({
    ids: { modal: 'modal-plano', search: 'plano-search', list: 'plano-list', close: 'btn-plano-close' },
    loadingText: 'Cargando planos…',
    fetchItems: async () => {
      const headers: any = {};
      const docId = session.docId;
      if (docId != null && String(docId).trim() !== '') headers.id = String(docId).trim();
      if (_codigoProyecto != null && String(_codigoProyecto).trim() !== '')
        headers.codigo_proyecto = String(_codigoProyecto).trim();
      const res = await fetch(API_PLANOS, { credentials: 'include', headers });
      const items = res.ok ? ((await res.json()).items || []) : [];
      return items.filter(p => p.id_en_repositorio != null);
    },
    toRow: (p) => ({
      value: String(p.id_en_repositorio),
      label: String(p.display || p.nombre_archivo || `Plano ${p.id_en_repositorio}`),
    }),
    onPick: (link, repo, name, item) => {
      if (!link || link.data?.type !== 'link') return;
      link.data.targetRepoId = repo;
      link.data.targetName   = name;
      link.data.targetFile   = item?.nombre_archivo || null;
      if (activeAnnotationObject === link) $('ap-link-target-name').textContent = name;
      markup && markup._snapshot();
      markup && markup._notifyLocalChange && markup._notifyLocalChange();
      showHint(`Enlace → ${name}`);
    },
  });

  /* Panel de propiedades → feature ./features/properties-panel.
     El objeto activo (activeAnnotationObject) se queda aquí y se comparte por get/set. */
  const propsPanel = createPropertiesPanel({
    getMarkup     : () => markup,
    getActiveObj  : () => activeAnnotationObject,
    setActiveObj  : (o) => { activeAnnotationObject = o; },
    btnToggle     : ui.btnTogglePanel,
  });

  /** Posiciona la mini-toolbar sobre la figura seleccionada (si tiene imagen adjunta) */
  function updateFigToolbar() {
    const tb = $('fig-toolbar');
    if (!tb || !markup) return;
    const obj = markup.canvas.getActiveObject();
    if (!obj || !obj.data || !markup._firstImageAttachment(obj)) {
      if (tb.style.display !== 'none') { tb.style.display = 'none'; tb.dataset.shown = ''; }
      return;
    }
    obj.setCoords();
    const tl = obj.aCoords.tl, tr = obj.aCoords.tr;
    const sx = (tl.x + tr.x) / 2, sy = Math.min(tl.y, tr.y);
    const v = markup.canvas.viewportTransform;                 // [zoom,0,0,zoom,tx,ty]
    const px = v[0] * sx + v[2] * sy + v[4];
    const py = v[1] * sx + v[3] * sy + v[5];
    const r = markup.canvas.upperCanvasEl.getBoundingClientRect();
    tb.style.left = (r.left + px) + 'px';
    tb.style.top  = (r.top + py - 40) + 'px';
    tb.style.display = 'flex';
    const shown = obj.data.attShown !== false;
    if (tb.dataset.shown !== String(shown)) {                  // solo redibuja el icono si cambió
      tb.dataset.shown = String(shown);
      const btn = $('fig-toggle-att');
      btn.classList.toggle('on', shown);
      btn.title = shown ? 'Ocultar adjunto en el plano' : 'Mostrar adjunto en el plano';
      btn.innerHTML = `<i data-lucide="${shown ? 'eye-off' : 'eye'}"></i>`;
      renderIcons();
    }
  }

  /* downscaleImage → ./ui/image-utils
     Panel de propiedades (open/close/toggle/refreshMeta/adjuntos) → propsPanel */

  /* ════════════════════════════════════════════════════════════════════
     USUARIOS — atribución de anotaciones
     ════════════════════════════════════════════════════════════════════ */

  // API_USUARIO y API_PDF se importan desde ./config (configurables por VITE_*)

  /**
   * Llama al API de APEX para descargar el PDF y lo abre en el visor.
   * El id de repositorio y el nombre van como segmentos de ruta (valores puros):
   *   GET {API_PDF}/123/plano-x.pdf
   */
  function openPDFFromRepo(repoId, name) {
    if (repoId == null || repoId === '') return;
    // El endpoint ORDS 'documento' espera id y nombre como HTTP HEADERS.
    // El nombre se codifica (encodeURIComponent) porque los headers solo admiten
    // ISO-8859-1: acentos/ñ/… reventarían con "non ISO-8859-1 code point".
    const headers: Record<string, string> = { id: String(repoId) };
    if (name) headers.nombre = encodeURIComponent(String(name));
    openPDFFromUrl(API_PDF, repoId, name, headers);
  }

  // Identidad del usuario actual (getUserColor se importa de ./core/user-colors)
  let _currentUserName = 'Anónimo';
  let _currentUserId   = null;   // id numérico del usuario (USUARIO_GRABACION) si APEX lo envía
  let _currentRevId    = null;   // id de la revisión del plano (ID_REVISIONES_PLANO) opcional
  let _codigoProyecto  = null;   // P9130008_CODIGO_PROYECTO — filtra planos-listado y rfi-listado
  let _canCollaborate  = false;  // P0_PERMISO_COLABORADOR === '1' → puede guardar marcas y descargar

  /** Normaliza el valor del permiso de colaborador (APEX) a booleano. */
  function setCollabPermission(value) {
    _canCollaborate = String(value ?? '').trim() === '1';
    applyCollabPermission();
  }

  /** Muestra/oculta los botones Guardar y Descargar según el permiso. */
  function applyCollabPermission() {
    ['btn-save-marks', 'btn-download-doc'].forEach(id => {
      const b = $(id);
      if (b) b.style.display = _canCollaborate ? '' : 'none';
    });
  }

  /** Cambia el usuario activo: actualiza markup layer + UI */
  function setCurrentUser(name) {
    _currentUserName = (name || 'Anónimo').trim() || 'Anónimo';
    if (markup) markup.currentUser = _currentUserName;

    const color = getUserColor(_currentUserName);
    if (ui.userDot) {
      ui.userDot.style.background = color;
      ui.userDot.style.display    = 'inline-block';
    }
    if (ui.userNameLabel) ui.userNameLabel.textContent = _currentUserName;

    // Si ya estamos en una sala, re-anunciarse con la identidad correcta
    if (collab.connected && session.docId != null)
      collab.connect(session.docId, _currentUserName, color);

    // No se persiste el nombre: la identidad siempre viene de la URL (APEX),
    // así no queda ningún nombre "fantasma" de sesiones anteriores.
    try { localStorage.removeItem('saf_user'); } catch (e) {}
  }

  /**
   * Reconstruye la lista de COLABORADORES del plano: usuarios conectados en vivo
   * (presencia por WebSocket) unidos con los autores que tienen marcas en la página.
   * Marca quién está "en línea" y permite ocultar/mostrar por autor.
   */
  function buildUsersPanel() {
    if (!ui.authorsList) return;
    const authors = markup ? markup.getAuthors() : []; // [{ name, count }]
    const countByName = {};
    authors.forEach(a => { countByName[a.name] = a.count; });

    // Conjunto de conectados: yo siempre + los peers presentes en la sala
    const online = new Set();
    online.add(_currentUserName);
    presenceByUser.forEach(p => p && p.user && online.add(p.user));

    // Lista final: conectados + autores con marcas (sin duplicados)
    const names = [...new Set([...online, ...authors.map(a => a.name)])];

    if (!names.length) {
      ui.authorsList.innerHTML = '<div class="author-empty">Sin colaboradores aún</div>';
      return;
    }

    ui.authorsList.innerHTML = names.map(name => {
      const color     = getUserColor(name);
      const isCurrent = (name === _currentUserName);
      const isOnline  = online.has(name);
      const count     = countByName[name] || 0;
      const hidden    = markup ? markup.isAuthorHidden(name) : false;
      return `<div class="author-row${isCurrent ? ' author-current' : ''}${isOnline ? ' author-online' : ''}${hidden ? ' author-hidden' : ''}" data-author="${name}">
        <span class="author-dot" style="background:${color}"></span>
        <span class="author-name">${name}${isCurrent ? ' (tú)' : ''}</span>
        ${isOnline ? '<span class="author-presence-badge">● en línea</span>' : ''}
        ${count ? `<span class="author-count">${count}</span>` : ''}
        <button class="author-toggle" data-author="${name}" title="${hidden ? 'Mostrar anotaciones' : 'Ocultar anotaciones'}">👁</button>
      </div>`;
    }).join('');

    // Botón ojo: toggle visibilidad de anotaciones del autor (estado persistente
    // en el markup, así sobrevive a reconstrucciones de la lista).
    ui.authorsList.querySelectorAll('.author-toggle').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        if (!markup) return;
        const name      = btn.dataset.author;
        const nowHidden = !markup.isAuthorHidden(name);   // alterna sobre el estado real
        markup.filterByAutor(name, !nowHidden);
        btn.closest('.author-row').classList.toggle('author-hidden', nowHidden);
        btn.title = nowHidden ? 'Mostrar anotaciones' : 'Ocultar anotaciones';
      });
    });
  }

  /** Conecta el tooltip flotante de autor con el evento onAnnotHover */
  function initAnnotTooltip() {
    const tip = ui.annotTooltip;
    if (!tip || !markup) return;

    markup.onAnnotHover = (data, evt) => {
      if (!data) { tip.style.display = 'none'; return; }

      const autor = data.autor || 'Anónimo';
      const color = getUserColor(autor);
      const fecha = data.fecha
        ? new Date(data.fecha).toLocaleString('es', {
            day:'2-digit', month:'short', year:'numeric',
            hour:'2-digit', minute:'2-digit'
          })
        : '';

      const tipoInfo  = ANNOT_TYPES.find(t => t.id === (data.tipoAnnot || ''));
      const prioClass = data.prioridad ? `tip-prio-${data.prioridad}` : '';

      tip.innerHTML =
        `<span class="tip-dot" style="background:${color}"></span>` +
        `<span class="tip-autor">${autor}</span>` +
        (fecha       ? `<span class="tip-fecha">${fecha}</span>` : '') +
        (tipoInfo    ? `<span class="tip-type">${tipoInfo.icon} ${tipoInfo.label}</span>` : '') +
        (data.prioridad ? `<span class="tip-fecha ${prioClass}">▪ ${data.prioridad}</span>` : '');

      // Posicionar al lado del cursor
      tip.style.left    = ((evt?.clientX || 0) + 16) + 'px';
      tip.style.top     = ((evt?.clientY || 0) - 12) + 'px';
      tip.style.display = 'flex';

      // Ajustar si se sale del viewport
      requestAnimationFrame(() => {
        const r = tip.getBoundingClientRect();
        if (r.right  > window.innerWidth  - 8) tip.style.left = (window.innerWidth  - r.width  - 8) + 'px';
        if (r.bottom > window.innerHeight - 8) tip.style.top  = (window.innerHeight - r.height - 8) + 'px';
      });
    };
  }

  /* ════════════════════════════════════════════════════════════════════
     ARRANQUE — wiring de eventos
     ════════════════════════════════════════════════════════════════════ */

  // 0. Iconos Lucide (reemplaza los <i data-lucide> por SVG)
  renderIcons();

  // 1. Dropdowns
  initDropdowns();

  // 1b. Riel de herramientas arrastrable (recuerda su posición)
  initRailDrag();

  // 2. PDF (abrir local solo desde la pantalla vacía; en modo embebido se oculta)
  [ui.btnOpen, ui.btnOpenLarge].forEach(b => b && b.addEventListener('click', () => ui.fileInput.click()));
  ui.fileInput && ui.fileInput.addEventListener('change', e => { if(e.target.files[0]) openPDF(e.target.files[0]); e.target.value=''; });

  // 3. Descargar documento (PDF + marcas si están visibles)
  $('btn-download-doc') && $('btn-download-doc').addEventListener('click', downloadDocument);

  // 3b. Guardar marcas (persiste la capa propia en el servidor)
  $('btn-save-marks') && $('btn-save-marks').addEventListener('click', saveMarks);

  // 5. Zoom / rotación
  ui.btnZoomIn .addEventListener('click', () => markup&&markup.zoomStep(1));
  ui.btnZoomOut.addEventListener('click', () => markup&&markup.zoomStep(-1));
  ui.btnFit    .addEventListener('click', () => markup&&markup.fitToCanvas());
  ui.btnRotateLeft .addEventListener('click', () => rotateDocument(false));
  ui.btnRotateRight.addEventListener('click', () => rotateDocument(true));

  // 6. Herramientas (toolbar principal + items de dropdown)
  document.querySelectorAll('.tb-tool').forEach(btn => {
    btn.addEventListener('click', () => activateTool(btn.dataset.tool));
  });

  // 6b. Nube RFI: activa la nube y marca que, al colocarla, se abra la modal de RFI.
  // OJO: activateTool() resetea el flag, por eso se activa DESPUÉS de llamarla.
  $('btn-tool-cloud-rfi') && $('btn-tool-cloud-rfi').addEventListener('click', () => {
    activateTool('cloud');
    pendingRfiCloud = true;
    showHint('Dibuja la nube y elige el RFI a vincular', true);
  });

  // 7. Estilos
  ui.strokeColor.addEventListener('input', e => { markup&&markup.setStrokeColor(e.target.value); syncFill(); });
  ui.fillColor  .addEventListener('input', ()  => syncFill());
  ui.fillAlpha  .addEventListener('input', ()  => syncFill());
  ui.strokeWidth.addEventListener('change', e  => markup&&markup.setStrokeWidth(e.target.value));

  function syncFill() {
    const hex=ui.fillColor.value, a=parseInt(ui.fillAlpha.value,10)/100;
    const r=parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16);
    markup&&markup.setFillColor(`rgba(${r},${g},${b},${a.toFixed(2)})`);
  }

  // 8. Toggle markup
  ui.btnToggle.addEventListener('click', () => {
    if (!markup) return;
    markupVisible=!markupVisible;
    markup.setMarkupVisible(markupVisible);
    ui.btnToggle.classList.toggle('tb-btn-active', markupVisible);
  });

  // 9. Undo / Redo
  ui.btnUndo.addEventListener('click', () => markup&&markup.undo());
  ui.btnRedo.addEventListener('click', () => markup&&markup.redo());

  // 10. Calibrar
  ui.btnCalibrate   .addEventListener('click', openCalibrate);
  ui.btnCalApply    .addEventListener('click', applyCalibration);
  ui.btnCalCancel   .addEventListener('click', closeCalibrate);
  ui.btnCalTabPoints.addEventListener('click', () => switchCalTab('points'));
  ui.btnCalTabDirect.addEventListener('click', () => switchCalTab('direct'));
  ui.btnCalReset && ui.btnCalReset.addEventListener('click', resetPointsFlow);
  [ui.calPxDirect, ui.calValDirect, ui.calUnitDirect].forEach(el =>
    el.addEventListener('input', updateDirectPreview)
  );
  [ui.calValue, ui.calUnit].forEach(el =>
    el.addEventListener('input', updatePointsPreview)
  );
  // Enter aplica (si es válido), Escape cierra la calibración.
  document.addEventListener('keydown', e => {
    if (ui.modalCal.style.display !== 'flex') return;
    if (e.key === 'Escape') { closeCalibrate(); }
    else if (e.key === 'Enter' && !ui.btnCalApply.disabled) { applyCalibration(); }
  });

  // 11. Eliminar MIS marcas de esta página (con modal de confirmación propia)
  ui.btnClear && ui.btnClear.addEventListener('click', () => {
    if (!markup) return;
    confirmDialog.open({
      title  : 'Eliminar mis marcas',
      message: '¿Seguro que quieres eliminar todas tus marcas de esta página? Esta acción no se puede deshacer.',
      okText : 'Eliminar',
      danger : true,
      onConfirm: () => {
        markup.clearMyMarkup();                 // borra solo lo del usuario actual
        session.pages[currentPage] = markup.getMarkupJSON();
        collabSync.pushLocalLayer();            // sincroniza/persiste el borrado
        ui.areaPanel.style.display = 'none';
        showHint('Tus marcas de esta página fueron eliminadas');
      },
    });
  });

  // 12. Descargar documento — PNG de la página (con marcas si están visibles)
  /** Escala parametrizada para persistir: píxeles medidos, distancia real y unidad. */
  function buildScaleObj() {
    if (!scaleManager.isCalibrated()) return null;
    return {
      pxPerUnit      : scaleManager.pxPerUnit,   // derivado (para los cálculos)
      pixeles        : scaleManager.pxDistance,  // píxeles medidos en el plano
      distancia_real : scaleManager.realValue,   // distancia real ingresada
      unidad         : scaleManager.unit,        // unidad de medida (m, cm, …)
      ts             : Date.now(),               // hora de calibración → gana la más reciente
    };
  }

  /** Restaura la escala desde la sesión guardada (server o archivo). */
  function applyScaleFromSession(scale) {
    if (!scale) return;
    const px   = scale.pixeles ?? null;
    const real = scale.distancia_real ?? null;
    const unit = scale.unidad || scale.unit || 'm';
    if (px > 0 && real > 0) {
      scaleManager.calibrate(px, real, unit);   // reconstruye desde los parámetros crudos
    } else if (scale.pxPerUnit) {
      scaleManager.pxPerUnit = scale.pxPerUnit; // compatibilidad con guardados antiguos
      scaleManager.unit      = unit;
    }
    updateScaleBadge();
  }

  /* ── Toast de guardado ─────────────────────────────────────────────── */
  let saveToastTimer = null;
  /**
   * Muestra el toast de guardado.
   * @param {'loading'|'success'|'error'} state
   * @param {string} msg   texto a mostrar
   * @param {number} hideAfter  ms hasta ocultar (0 = no auto-ocultar; para 'loading')
   */
  function showSaveToast(state, msg, hideAfter = 0) {
    if (!ui.saveToast) return;
    if (saveToastTimer) { clearTimeout(saveToastTimer); saveToastTimer = null; }
    ui.saveToast.classList.remove('is-loading', 'is-success', 'is-error');
    ui.saveToast.classList.add('is-' + state, 'is-visible');
    ui.saveToastMsg.textContent = msg;
    // Ícono: el spinner de 'loading' es puramente CSS (sin SVG)
    if (state === 'loading') {
      ui.saveToastIc.innerHTML = '';
    } else {
      ui.saveToastIc.innerHTML = `<i data-lucide="${state === 'success' ? 'check' : 'alert-triangle'}"></i>`;
      renderIcons(ui.saveToastIc);
    }
    if (hideAfter > 0) saveToastTimer = setTimeout(hideSaveToast, hideAfter);
  }
  function hideSaveToast() {
    if (!ui.saveToast) return;
    ui.saveToast.classList.remove('is-visible');
    if (saveToastTimer) { clearTimeout(saveToastTimer); saveToastTimer = null; }
  }

  /** Guarda TODO explícitamente (solo al pulsar Guardar): marcas, rotación y escala. */
  async function saveMarks() {
    if (!markup) return;
    if (!_canCollaborate) { showSaveToast('error', 'No tienes permiso para guardar', 3000); return; }
    session.pages[currentPage]       = markup.getMarkupJSON();
    session.pageHeights[currentPage] = markup.getPageHeight();
    session.rotation                 = rotation;
    session.scale                    = buildScaleObj();
    if (session.docId == null) {     // archivo local (sin sala): no hay servidor donde guardar
      showSaveToast('error', 'Sin servidor: usa Descargar para exportar', 3000);
      return;
    }
    const btn = $('btn-save-marks');
    if (btn) btn.disabled = true;    // evita doble clic durante el guardado
    showSaveToast('loading', 'Guardando…');
    const ok = await collabSync.saveNow();
    if (btn) btn.disabled = false;
    if (ok) showSaveToast('success', 'Cambios guardados', 3000);
    else    showSaveToast('error',   'No se pudo guardar. Reintenta.', 3000);
  }

  function downloadDocument() {
    if (!markup) return;
    if (!_canCollaborate) { showHint('No tienes permiso para descargar'); return; }
    closeAllDropdowns();
    let dataUrl;
    try {
      dataUrl = markup.exportDocument(3);      // respeta la visibilidad de las marcas
    } catch (err) {
      console.error('[SAF] exportDocument:', err);
      showHint('No se pudo generar la imagen del documento');
      return;
    }
    const filename = `${(session.docName || 'documento').replace(/\.pdf$/i,'')}_p${currentPage}.png`;

    if (window.parent !== window) {
      // Embebido en APEX (iframe sandbox): el padre dispara la descarga
      try { window.parent.postMessage({ action: 'downloadDoc', filename, dataUrl }, APEX_ORIGIN); } catch (e) {}
      showHint('Descargando documento…');
    } else {
      // Standalone: descarga directa
      const a = document.createElement('a');
      a.href = dataUrl; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
    }
  }

  // 13. Panel área
  $('btn-area-close').addEventListener('click', () => { ui.areaPanel.style.display='none'; });

  // 13b. Comparación de revisiones (feature ./features/compare-revisions)
  compare.init();

  // 14. Sellos y Etiquetas
  // .stamp-opt  → rubber stamp clásico (inclinado)
  // .stamp-label → etiqueta profesional (borde doble, recto)
  document.querySelectorAll('.stamp-opt, .stamp-label').forEach(btn => {
    btn.addEventListener('click', () => {
      ui.modalStamp.style.display = 'none';
      if (!markup || !markup._pendingStampPos) return;
      const { x, y } = markup._pendingStampPos;
      const style     = btn.dataset.style || 'stamp';
      if (style === 'label' || style === 'hatch') {
        markup.addLabel(x, y, btn.dataset.stamp, btn.dataset.color, style);
      } else {
        markup.addStamp(x, y, btn.dataset.stamp, btn.dataset.color);
      }
      markup._pendingStampPos = null;
      // Volver a select para poder mover/redimensionar el sello recién colocado
      activateTool('select');
    });
  });
  ui.btnStampCancel.addEventListener('click', () => {
    ui.modalStamp.style.display = 'none';
    if (markup) markup._pendingStampPos = null;
    activateTool('select');   // cancelar también vuelve a select
  });

  // 15. Toggle del panel de propiedades (toolbar + tecla P)
  if (ui.btnTogglePanel) {
    ui.btnTogglePanel.addEventListener('click', () => propsPanel.toggle());
    ui.btnTogglePanel.classList.toggle('tb-btn-active', true);
  }

  // 16. Panel de propiedades de anotación ──────────────────────────────
  // Las propiedades se aplican en vivo: ya no hay botones Guardar / Cancelar.
  $('btn-ap-close') && $('btn-ap-close').addEventListener('click', () => propsPanel.close());

  // Botones de prioridad (mutual exclusivo)
  document.querySelectorAll('.ap-prio').forEach(btn => {
    btn.addEventListener('click', () => {
      const wasActive = btn.classList.contains('active');
      document.querySelectorAll('.ap-prio').forEach(b => b.classList.remove('active'));
      if (!wasActive) btn.classList.add('active');   // segundo clic → deselecciona
    });
  });

  // Descripción: contador + guardado en vivo en la figura (sin botón Guardar)
  $('ap-desc') && $('ap-desc').addEventListener('input', () => {
    $('ap-desc-count').textContent = $('ap-desc').value.length;
    if (activeAnnotationObject) {
      activeAnnotationObject.data = Object.assign(activeAnnotationObject.data || {}, { descripcion: $('ap-desc').value.trim() });
      propsPanel.refreshMeta(activeAnnotationObject.data);
    }
  });
  // Al perder el foco: registrar en el historial y propagar a la sala
  $('ap-desc') && $('ap-desc').addEventListener('change', () => {
    if (markup && activeAnnotationObject) { markup._snapshot(); markup._notifyLocalChange && markup._notifyLocalChange(); }
  });

  // ── Apariencia + etiqueta de la figura (edición en vivo) ──────────────
  $('ap-label') && $('ap-label').addEventListener('input', () => {
    if (markup && activeAnnotationObject) markup.setLabelText(activeAnnotationObject, $('ap-label').value);
  });
  $('ap-stroke') && $('ap-stroke').addEventListener('input', () => {
    if (markup && activeAnnotationObject) markup.setObjProp(activeAnnotationObject, 'stroke', $('ap-stroke').value);
  });
  $('ap-fill') && $('ap-fill').addEventListener('input', () => {
    if (!markup || !activeAnnotationObject) return;
    const a = extractFillAlpha(activeAnnotationObject.fill);                 // conservar la opacidad del relleno
    markup.setObjProp(activeAnnotationObject, 'fill', hexToRgba($('ap-fill').value, a));
  });
  $('ap-stroke-w') && $('ap-stroke-w').addEventListener('input', () => {
    if (!markup || !activeAnnotationObject) return;
    const w = parseInt($('ap-stroke-w').value, 10);
    $('ap-stroke-w-val').textContent = w;
    markup.setObjProp(activeAnnotationObject, 'strokeWidth', w);
  });
  $('ap-opacity') && $('ap-opacity').addEventListener('input', () => {
    if (!markup || !activeAnnotationObject) return;
    const o = parseInt($('ap-opacity').value, 10);
    $('ap-opacity-val').textContent = o;
    markup.setObjProp(activeAnnotationObject, 'opacity', o / 100);
  });
  $('ap-link-page') && $('ap-link-page').addEventListener('input', () => {
    if (!activeAnnotationObject || activeAnnotationObject.data?.type !== 'link') return;
    const n = parseInt($('ap-link-page').value, 10);
    activeAnnotationObject.data.targetPage = (n > 0) ? n : null;
    markup && markup._snapshot();
  });

  // Elegir plano destino → abrir el selector DENTRO del visor (list-picker)
  $('btn-ap-pick-plano') && $('btn-ap-pick-plano').addEventListener('click', () => {
    if (!activeAnnotationObject || activeAnnotationObject.data?.type !== 'link') return;
    linkPickTarget = activeAnnotationObject;     // también para el flujo por postMessage (APEX)
    planoPicker.open(activeAnnotationObject);
  });
  // Quitar el destino
  $('btn-ap-clear-plano') && $('btn-ap-clear-plano').addEventListener('click', () => {
    if (!activeAnnotationObject || activeAnnotationObject.data?.type !== 'link') return;
    confirmDialog.open({
      title: 'Quitar destino', message: '¿Quitar el plano destino de este enlace?',
      okText: 'Quitar', danger: true,
      onConfirm: () => {
        activeAnnotationObject.data.targetRepoId = null;
        activeAnnotationObject.data.targetName   = null;
        $('ap-link-target-name').textContent = '— sin destino —';
        markup && markup._snapshot();
        markup && markup._notifyLocalChange && markup._notifyLocalChange();
      },
    });
  });

  // RFI: abrir el selector (modal) / quitar el RFI vinculado del sello
  $('btn-ap-pick-rfi') && $('btn-ap-pick-rfi').addEventListener('click', () => {
    if (activeAnnotationObject) rfiPicker.open(activeAnnotationObject);
  });
  $('btn-ap-clear-rfi') && $('btn-ap-clear-rfi').addEventListener('click', () => {
    if (!activeAnnotationObject) return;
    confirmDialog.open({
      title: 'Quitar RFI', message: '¿Desvincular el RFI de este sello?',
      okText: 'Quitar', danger: true,
      onConfirm: () => {
        activeAnnotationObject.data = Object.assign(activeAnnotationObject.data || {}, { rfiId: null, rfiLabel: null });
        $('ap-rfi-name').textContent = '— sin RFI —';
        markup && markup._snapshot();
        markup && markup._notifyLocalChange && markup._notifyLocalChange();
      },
    });
  });

  // Eventos de los modales selector (planos + RFIs) y de confirmación
  planoPicker.init();
  rfiPicker.init();
  confirmDialog.init();

  // ── Adjuntos: agregar / abrir / quitar ──────────────────────────────
  $('btn-ap-attach') && $('btn-ap-attach').addEventListener('click', () => $('ap-att-input').click());
  $('ap-att-input') && $('ap-att-input').addEventListener('change', e => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!activeAnnotationObject || !files.length) return;
    if (!activeAnnotationObject.data) activeAnnotationObject.data = {};
    if (!activeAnnotationObject.data.adjuntos) activeAnnotationObject.data.adjuntos = [];
    const target = activeAnnotationObject;   // figura fija aunque cambie la selección durante la lectura
    let pending = files.length;
    const done = () => { if (--pending === 0) { propsPanel.refreshAttachments(); markup && markup.refreshThumb(target); markup && markup._snapshot(); } };
    files.forEach(f => {
      if (f.size > MAX_ATTACHMENT_BYTES) {
        alert(`"${f.name}" supera 25 MB. Adjunta un archivo más liviano.`);
        done(); return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const raw = reader.result;
        if ((f.type || '').startsWith('image/')) {
          // Optimizar: redimensionar a máx 1920px y recomprimir (foto de varios MB → ~200 KB)
          downscaleImage(raw, f.type, ATTACHMENT_MAX_DIM, ATTACHMENT_JPEG_QUALITY, (outUrl, outType) => {
            target.data.adjuntos.push({ name: f.name, type: outType, size: outUrl.length, dataUrl: outUrl, optimizada: true });
            done();
          });
        } else {
          target.data.adjuntos.push({ name: f.name, type: f.type, size: f.size, dataUrl: raw });
          done();
        }
      };
      reader.onerror = done;
      reader.readAsDataURL(f);
    });
  });
  // ── Imagen como anotación: colocar foto/figura sobre el plano ────────
  $('img-place-input') && $('img-place-input').addEventListener('change', e => {
    const f = (e.target.files || [])[0];
    e.target.value = '';
    if (!f || !markup) { activateTool('select'); return; }
    if (!f.type.startsWith('image/')) { alert('Selecciona un archivo de imagen.'); activateTool('select'); return; }
    if (f.size > MAX_ATTACHMENT_BYTES) { alert(`"${f.name}" supera 25 MB. Elige una imagen más liviana.`); activateTool('select'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      downscaleImage(reader.result, f.type, ATTACHMENT_MAX_DIM, ATTACHMENT_JPEG_QUALITY_FILE, (outUrl, outType) => {
        markup.placePendingImage(outUrl, f.name, outType);
        activateTool('select');
      });
    };
    reader.onerror = () => { alert('No se pudo leer la imagen.'); activateTool('select'); };
    reader.readAsDataURL(f);
  });

  $('ap-att-grid') && $('ap-att-grid').addEventListener('click', e => {
    const btn = e.target.closest('[data-act]');
    if (!btn || !activeAnnotationObject || !activeAnnotationObject.data?.adjuntos) return;
    const i = parseInt(btn.dataset.i, 10);
    const a = activeAnnotationObject.data.adjuntos[i];
    if (!a) return;
    if (btn.dataset.act === 'del') {
      const obj = activeAnnotationObject;   // fijar la figura aunque cambie la selección
      confirmDialog.open({
        title: 'Quitar adjunto', message: `¿Quitar "${a.name}" de esta figura?`,
        okText: 'Quitar', danger: true,
        onConfirm: () => {
          obj.data.adjuntos.splice(i, 1);
          propsPanel.refreshAttachments();
          markup && markup.refreshThumb(obj);
          markup && markup._snapshot();
          markup && markup._notifyLocalChange && markup._notifyLocalChange();
        },
      });
    } else {
      propsPanel.openAttachment(a);
    }
  });
  $('att-lightbox') && $('att-lightbox').addEventListener('click', () => {
    $('att-lightbox').style.display = 'none';
  });
  // Mini-toolbar: mostrar/ocultar el adjunto sobre la figura
  $('fig-toggle-att') && $('fig-toggle-att').addEventListener('click', () => {
    const obj = markup && markup.canvas.getActiveObject();
    if (!obj || !obj.data || obj.data.remoto) return;   // no modificar figuras ajenas
    const shown = obj.data.attShown !== false;
    obj.data.attShown = !shown;                  // alterna
    markup.refreshThumb(obj);
    markup._snapshot && markup._snapshot();
    $('fig-toolbar').dataset.shown = '';         // fuerza refresco del icono
    updateFigToolbar();
  });
  // Mini-toolbar: ampliar la imagen en el lightbox
  $('fig-enlarge-att') && $('fig-enlarge-att').addEventListener('click', () => {
    const obj = markup && markup.canvas.getActiveObject();
    const a   = obj && markup._firstImageAttachment(obj);
    if (!a) return;
    $('att-lightbox-img').src = a.dataUrl;
    $('att-lightbox').style.display = 'flex';
  });

  // Evitar que inputs dentro del panel propaguen teclas globales (atajos)
  $('annot-panel') && $('annot-panel').addEventListener('keydown', e => e.stopPropagation());

  // 16. Usuarios ─────────────────────────────────────────────────────────
  // El usuario lo fija APEX (usuario_conectado / postMessage); ya NO se puede
  // cambiar manualmente. El dropdown solo muestra quién está colaborando.
  if ($('btn-users')) {
    $('btn-users').addEventListener('click', () => buildUsersPanel());
  }

  // PostMessage desde Oracle APEX
  // Soporta:
  //   { action: 'setUser',   name:   'Carlos Ramírez' }            → nombre directo
  //   { action: 'openPDF', pdfUrl:'/pdfs/p-123.pdf', docId:123 }    → abre un plano
  //
  // SEGURIDAD: APEX_ORIGIN viene de ./config (VITE_APEX_ORIGIN); por defecto
  // el propio origen del visor (cuando APEX lo embebe en el mismo dominio).
  window.addEventListener('message', e => {
    // Acepta solo mensajes del portal APEX (o de la propia ventana en pruebas)
    if (e.origin !== APEX_ORIGIN && e.origin !== window.location.origin) return;
    if (!e.data || typeof e.data !== 'object') return;
    // Código de proyecto: APEX puede enviarlo en cualquier mensaje (o uno dedicado)
    if (e.data.codigo_proyecto != null && String(e.data.codigo_proyecto).trim() !== '') {
      _codigoProyecto = String(e.data.codigo_proyecto).trim();
    }
    // Permiso de colaborador (P0_PERMISO_COLABORADOR): APEX puede enviarlo en cualquier mensaje
    const permMsg = e.data.P0_PERMISO_COLABORADOR ?? e.data.permiso_colaborador ?? e.data.permiso;
    if (permMsg != null) setCollabPermission(permMsg);
    if (e.data.action === 'setUser') {
      if (e.data.name) setCurrentUser(e.data.name);
      // Código de usuario (USUARIO_GRABACION) — APEX puede mandarlo por postMessage
      const cod = e.data.codigo ?? e.data.usuario_id ?? e.data.codigo_usuario;
      if (cod != null && String(cod).trim() !== '') {
        _currentUserId = /^\d+$/.test(String(cod)) ? Number(cod) : cod;
        console.info('[SAF] codigo_usuario (postMessage):', _currentUserId);
      }
    }
    // APEX devuelve el plano elegido para el hipervínculo → asignarlo al enlace
    if (e.data.action === 'setLinkTarget') {
      const tgt = linkPickTarget || (markup && markup.canvas.getActiveObject());
      if (tgt && tgt.data?.type === 'link' && e.data.repoId != null) {
        tgt.data.targetRepoId = e.data.repoId;
        tgt.data.targetName   = e.data.name || `Plano ${e.data.repoId}`;
        if (e.data.file) tgt.data.targetFile = e.data.file;
        if (activeAnnotationObject === tgt) $('ap-link-target-name').textContent = tgt.data.targetName;
        markup && markup._snapshot();
        markup && markup._notifyLocalChange && markup._notifyLocalChange();
        showHint(`Enlace → ${tgt.data.targetName}`);
      }
      linkPickTarget = null;
    }
    // Abrir plano: por id de repositorio (vía API APEX) o por URL directa
    if (e.data.action === 'openPDF') {
      disableOpenControls();   // APEX abre el plano → modo embebido sin "Abrir PDF"
      if (e.data.repoId != null) openPDFFromRepo(e.data.repoId, e.data.name);
      else if (e.data.pdfUrl)    openPDFFromUrl(e.data.pdfUrl, e.data.docId, e.data.name);
    }

    // Mensaje de inicialización consolidado: identidad + proyecto + permiso + abrir plano.
    // (codigo_proyecto y P0_PERMISO_COLABORADOR ya se aplican arriba para cualquier mensaje.)
    if (e.data.action === 'init') {
      const d = e.data;
      const nombreUsuario = d.usuario_conectado || d.usuario || d.name;
      if (nombreUsuario) setCurrentUser(nombreUsuario);
      const cod = d.codigo_usuario ?? d.usuario_id ?? d.codigo;
      if (cod != null && String(cod).trim() !== '') {
        _currentUserId = /^\d+$/.test(String(cod)) ? Number(cod) : cod;
        console.info('[SAF] codigo_usuario (init):', _currentUserId);
      }
      const rid = d.id_revision ?? d.id_revisiones_plano;
      if (rid != null && /^\d+$/.test(String(rid))) _currentRevId = Number(rid);
      // Abrir el plano (por id de repositorio o URL directa)
      if (d.repoId != null || d.pdfUrl) {
        disableOpenControls();
        if (d.repoId != null) openPDFFromRepo(d.repoId, d.nombre || d.name);
        else                  openPDFFromUrl(d.pdfUrl, d.docId, d.nombre || d.name);
      }
    }
  });

  // Identificación al cargar — el NOMBRE viene directo en la URL del iframe
  // (ya no se consulta ningún API). Se acepta cualquiera de estas claves y el
  // valor se usa tal cual como nombre del usuario:
  //   ?usuario=Nombre · ?usuario_conectado=Nombre · ?user=Nombre · ?nombreUsuario=Nombre
  (function () {
    const params  = new URLSearchParams(window.location.search);
    const urlUser = (params.get('usuario')
                  || params.get('usuario_conectado')
                  || params.get('user')
                  || params.get('nombreUsuario')
                  || params.get('usuario_nombre')
                  || '').trim();

    // La identidad SOLO viene de la URL (APEX). Si llega vacía → Anónimo,
    // sin recuperar ningún nombre previo del navegador (nada de "fantasmas").
    if (urlUser) setCurrentUser(urlUser);
    else         setCurrentUser('Anónimo');

    // Id del usuario para guardar/consultar marcas: PRIMERO el parámetro de la URL
    // (APEX lo inyecta desde su localStorage), y como respaldo el localStorage propio.
    const uid = params.get('codigo_usuario') || params.get('usuario_id') || params.get('id_usuario');
    if (uid && uid.trim()) {
      _currentUserId = /^\d+$/.test(uid.trim()) ? Number(uid.trim()) : uid.trim();
    } else {
      try {
        const cod = (localStorage.getItem('codigo_usuario') || '').trim();
        if (cod) _currentUserId = /^\d+$/.test(cod) ? Number(cod) : cod;
      } catch (e) {}
    }
    const rid = params.get('id_revision') || params.get('id_revisiones_plano');
    if (rid && /^\d+$/.test(rid)) _currentRevId = Number(rid);

    // Código de proyecto (P9130008_CODIGO_PROYECTO) — filtra planos-listado y rfi-listado
    const cp = (params.get('codigo_proyecto') || params.get('proyecto') || '').trim();
    if (cp) { _codigoProyecto = cp; console.info('[SAF] codigo_proyecto:', _codigoProyecto); }

    // Permiso de colaborador (P0_PERMISO_COLABORADOR): '1' → puede guardar y descargar
    const perm = params.get('P0_PERMISO_COLABORADOR')
              ?? params.get('permiso_colaborador')
              ?? params.get('permiso');
    setCollabPermission(perm);
    console.info('[SAF] permiso_colaborador:', _canCollaborate);

    if (_currentUserId == null)
      console.warn('[SAF] Sin codigo_usuario: USUARIO_GRABACION se guardará como 0. ' +
                   'Pásalo en la URL (?codigo_usuario=...) o por postMessage {action:"setUser",codigo:...}.');
    else
      console.info('[SAF] codigo_usuario para guardar marcas:', _currentUserId);

    // Abrir un plano directamente desde la URL del iframe:
    //   por id de repositorio (vía API APEX):
    //     /planos/?usuario_conectado=ID&repoId=123
    //   o por URL directa de un PDF:
    //     /planos/?usuario_conectado=ID&pdf=/pdfs/plano-123.pdf&docId=123
    const repoId   = params.get('repoId') || params.get('id_en_repositorio');
    const pdfParam = params.get('pdf');
    if (repoId || pdfParam) {
      // Hay una petición de plano → modo embebido: sin opción de abrir PDF local
      disableOpenControls();
      if (repoId)   openPDFFromRepo(repoId, params.get('nombre'));
      else          openPDFFromUrl(pdfParam, params.get('docId'), params.get('nombre'));
    }
  })();

  /* ── Atajos de teclado ─────────────────────────────────────────────── */
  document.addEventListener('keydown', e => {
    const tag=document.activeElement.tagName;
    if (tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT') return;
    if (ui.modalCal.style.display==='flex' || ui.modalStamp.style.display==='flex') return;

    if (e.ctrlKey||e.metaKey) {
      const map = {
        z:()=>markup&&markup.undo(), y:()=>markup&&markup.redo(),
        o:()=>ui.fileInput.click(), s:()=>saveSession(),
        '=':()=>markup&&markup.zoomStep(1), '+':()=>markup&&markup.zoomStep(1),
        '-':()=>markup&&markup.zoomStep(-1),
        '0':()=>markup&&markup.fitToCanvas(),   // Ctrl/Cmd+0 → ajustar a pantalla
        '1':()=>markup&&markup.zoomTo(1),        // Ctrl/Cmd+1 → 100%
      };
      const key=(e.shiftKey&&e.key==='Z')?'y':e.key;
      if (map[key]) { map[key](); e.preventDefault(); }
      return;
    }

    const tools={v:'select',h:'pan',t:'text',d:'freehand',e:'eraser',
                  r:'rect',o:'ellipse',a:'arrow',n:'note',c:'callout'};
    if (tools[e.key.toLowerCase()]) { activateTool(tools[e.key.toLowerCase()]); return; }

    switch (e.key) {
      case 'f': case 'F': markup&&markup.fitToCanvas(); break;
      case 'p': case 'P': propsPanel.toggle(); break;
    }
  });

  /* ── Utilidades UI ─────────────────────────────────────────────────── */
  function enableDocs(on) {
    [ui.btnRotateLeft,ui.btnRotateRight,ui.btnZoomIn,ui.btnZoomOut,ui.btnFit,
     ui.btnCalibrate,ui.btnClear,
     $('btn-save-marks'), $('btn-download-doc'), $('btn-compare')]
     .forEach(el => { if(el) el.disabled=!on; });
    ui.btnUndo.disabled=true; ui.btnRedo.disabled=true;
  }

  function setStatus(msg) { ui.tbStatus.textContent=msg; }

  /** Badge persistente con la escala calibrada (no se pierde al usar overlay) */
  function updateScaleBadge() {
    const el = $('scale-info');
    if (!el) return;
    if (scaleManager.isCalibrated()) {
      el.textContent = `📐 1 ${scaleManager.unit} = ${scaleManager.pxPerUnit.toFixed(1)} px`;
      el.style.display = '';
    } else {
      el.style.display = 'none';
    }
  }

  let hintTimer;
  function showHint(msg, persist=false) {
    const el=ui.drawHint;
    clearTimeout(hintTimer);
    if (!msg) { el.style.display='none'; return; }
    el.textContent=msg; el.style.display='block';
    // Las leyendas de acción se auto-ocultan a los 5s; los hints de herramienta persisten.
    if (!persist) hintTimer=setTimeout(()=>el.style.display="none", HINT_AUTO_HIDE_MS);
  }

})();
