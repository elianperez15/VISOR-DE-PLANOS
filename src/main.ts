/* ═══════════════════════════════════════════════════════════════════════
   main.ts — Orquestador SAF Visor de Planos
   PDF.js + Fabric.js + XFDF
   ═══════════════════════════════════════════════════════════════════════ */

import './styles/viewer.css';

import { PDFRenderer } from './core/pdf-renderer';
import { ScaleManager } from './core/scale-manager';
import { MarkupLayer } from './core/markup-layer';
import { Storage } from './data/storage';
import { XFDFConverter } from './data/xfdf';

// Iconos line-style (estilo Lucide) embebidos localmente — sin dependencia ni CDN
import { renderIcons } from './ui/icons';

(function () {
  'use strict';

  /* ── Instancias ────────────────────────────────────────────────────── */
  const pdfRenderer     = new PDFRenderer();
  const compareRenderer = new PDFRenderer();   // Revisión B (comparación)
  const scaleManager    = new ScaleManager();
  const storage         = new Storage();
  let   markup          = null;

  /* ── Estado de comparación de revisiones ──────────────────────────── */
  let compareActive  = false;
  let compareTint    = false;
  let compareOpacity = 0.5;

  /* ── Estado ───────────────────────────────────────────────────────── */
  const session = { docName:'', pages:{}, pageHeights:{}, scale:null };
  let currentPage   = 1;
  let totalPages    = 0;
  let markupVisible = true;

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
    btnPrev      : $('btn-prev'),
    btnNext      : $('btn-next'),
    pageInfo     : $('page-info'),
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
    userInput    : $('user-input'),
    btnSetUser   : $('btn-set-user'),
    authorsList  : $('authors-list'),
    annotTooltip : $('annot-tooltip'),
  };

  /* ── Grupos de herramientas ──────────────────────────────────────── */
  const ANNOT_TOOLS = {
    arrow    : { lc:'arrow-up-right', name:'Flecha'  },
    rect     : { lc:'square',         name:'Rect'    },
    ellipse  : { lc:'circle',         name:'Elipse'  },
    highlight: { lc:'highlighter',    name:'Resalt.' },
    freehand : { lc:'pencil',         name:'Libre'   },
    cloud    : { lc:'cloud',          name:'Nube'    },
    text     : { lc:'type',           name:'Texto'   },
    note     : { lc:'sticky-note',    name:'Nota'    },
    callout  : { lc:'message-square', name:'Globo'   },
    stamp    : { lc:'stamp',          name:'Sello'   },
    link     : { lc:'link',           name:'Enlace'  },
    image    : { lc:'camera',         name:'Imagen'  },
  };
  const MEASURE_TOOLS = {
    measure  : { lc:'ruler',    name:'Cota'      },
    angle    : { lc:'triangle', name:'Ángulo'    },
    area     : { lc:'hexagon',  name:'Área'      },
    perimeter: { lc:'spline',   name:'Perímetro' },
  };

  const TOOL_HINTS = {
    arrow    : '↗ Clic y arrastra para dibujar flecha',
    measure  : '📏 Clic y arrastra para medir distancia (calibra la escala primero)',
    angle    : '∠ Clic 1 = vértice · Clic 2 = brazo A · Clic 3 = brazo B',
    perimeter: '〰 Clic para agregar puntos · Enter para cerrar y calcular longitud total',
    cloud    : '☁ Arrastra para dibujar la nube · Clic simple = nube estándar',
    rect     : '▭ Clic y arrastra para rectángulo',
    ellipse  : '⬭ Clic y arrastra para elipse',
    highlight: '🖍 Clic y arrastra para resaltar área',
    text     : 'T Clic para insertar texto editable',
    note     : '📝 Clic para insertar nota post-it',
    callout  : '💬 Clic para insertar globo de comentario',
    freehand : '✏ Dibuja libremente con el ratón',
    area     : '⬡ Clic para agregar vértices · Enter para calcular área · Esc cancela',
    stamp    : '🔖 Clic en el plano para colocar sello',
    image    : '📷 Clic en el plano para elegir y colocar una imagen',
    link     : '🔗 Arrastra para crear el enlace · luego define la hoja destino en el panel · doble clic para saltar',
    eraser   : '⌫ Clic sobre un objeto para eliminarlo',
    pan      : '✋ Arrastra para mover la vista · Rueda del ratón = zoom',
    select   : '',
  };

  /* ════════════════════════════════════════════════════════════════════
     DROPDOWNS — posición fixed calculada con JS para escapar overflow
     ════════════════════════════════════════════════════════════════════ */

  function openDropdown(dd, anchorBtn) {
    closeAllDropdowns();
    // Posicionar con fixed relativo al viewport
    const r       = anchorBtn.getBoundingClientRect();
    const inRail   = !!anchorBtn.closest('.tool-rail');
    if (inRail) {
      // Flyout a la derecha del riel
      dd.style.top  = r.top + 'px';
      dd.style.left = (r.right + 6) + 'px';
    } else {
      // Desplegable debajo del botón (barra superior)
      dd.style.top  = (r.bottom + 4) + 'px';
      dd.style.left = r.left + 'px';
    }
    dd.classList.add('open');

    // Ajustar si se sale por los bordes
    requestAnimationFrame(() => {
      const dr = dd.getBoundingClientRect();
      if (dr.right > window.innerWidth - 8) {
        dd.style.left = Math.max(8, window.innerWidth - dr.width - 8) + 'px';
      }
      if (dr.bottom > window.innerHeight - 8) {
        dd.style.top = Math.max(8, window.innerHeight - dr.height - 8) + 'px';
      }
    });
  }

  function closeAllDropdowns() {
    document.querySelectorAll('.tb-dropdown.open').forEach(d => d.classList.remove('open'));
  }

  function initDropdowns() {
    // Toggle al hacer clic en el botón activador
    document.querySelectorAll('.tb-dropdown-wrap').forEach(wrap => {
      const btn = wrap.querySelector('.tb-dropdown-btn');
      const dd  = wrap.querySelector('.tb-dropdown');
      if (!btn || !dd) return;

      btn.addEventListener('click', e => {
        e.stopPropagation();
        if (dd.classList.contains('open')) { closeAllDropdowns(); }
        else                               { openDropdown(dd, btn); }
      });
    });

    // Cerrar al hacer clic en cualquier ítem de dropdown
    document.querySelectorAll('.tb-drop-item').forEach(item => {
      item.addEventListener('click', () => closeAllDropdowns());
    });

    // Cerrar al hacer clic fuera de cualquier dropdown-wrap
    document.addEventListener('click', e => {
      if (!e.target.closest('.tb-dropdown-wrap')) closeAllDropdowns();
    });

    // Cerrar con Escape
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeAllDropdowns();
    });
  }

  /* ── Activar herramienta ─────────────────────────────────────────── */
  function activateTool(tool) {
    if (!markup) return;
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

    showHint(TOOL_HINTS[tool] || '');
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
    markup.onAnnotClick  = obj  => openAnnotPanel(obj);
    markup.onFollowLink  = n    => {
      if (n >= 1 && n <= totalPages) goToPage(n);
      else showHint(n ? `La hoja ${n} no existe (este doc tiene ${totalPages})` : 'Este enlace no tiene hoja destino — selecciónalo y defínela');
    };
    markup.onShowImage   = src  => { $('att-lightbox-img').src = src; $('att-lightbox').style.display = 'flex'; };
    markup.canvas.on('after:render', updateFigToolbar);   // mini-toolbar sobre la figura
    markup.currentUser   = _currentUserName;
    // Zoom profundo: re-render dinámico de la región visible (tipo Procore)
    markup.requestRegion = (rect, density) => pdfRenderer.renderRegion(currentPage, rect, density);
    initAnnotTooltip();
  }

  /* ════════════════════════════════════════════════════════════════════
     PDF
     ════════════════════════════════════════════════════════════════════ */
  async function openPDF(file) {
    setStatus('Cargando PDF…');
    try {
      const { numPages } = await pdfRenderer.load(file);
      totalPages = numPages;
      session.docName     = file.name;
      session.pages       = {};
      session.pageHeights = {};
      ui.emptyState.style.display    = 'none';
      ui.canvasWrapper.style.display = 'flex';
      closeCompare();   // la Rev B anterior ya no corresponde al nuevo documento
      initMarkup();
      enableDocs(true);
      await goToPage(1);
      setStatus(`${file.name}  ·  ${numPages} página${numPages>1?'s':''}`);
    } catch (e) {
      setStatus('Error: ' + e.message);
      alert('No se pudo cargar el PDF:\n' + e.message);
    }
  }

  /* ════════════════════════════════════════════════════════════════════
     NAVEGACIÓN
     ════════════════════════════════════════════════════════════════════ */
  async function goToPage(n) {
    if (!pdfRenderer.isLoaded || n<1 || n>totalPages) return;
    if (markup) session.pages[currentPage] = markup.getMarkupJSON();
    currentPage = n;
    ui.pageInfo.textContent = `${n} / ${totalPages}`;
    ui.btnPrev.disabled = n<=1;
    ui.btnNext.disabled = n>=totalPages;
    setStatus('Renderizando…');
    const r = await pdfRenderer.renderPage(n, 2.0);
    session.pageHeights[n] = r.logicalHeight;
    await markup.setBackground(r.dataUrl, r.imageWidth, r.imageHeight, r.logicalWidth, r.logicalHeight);
    _apCloseIfOpen();
    markup.setMarkupJSON(session.pages[n] || null);
    buildUsersPanel();
    if (compareActive) renderCompareForPage(n);   // mantener overlay de Rev B
    setStatus(`Pág. ${n}/${totalPages}  ·  ${session.docName}`);
  }

  /* ── Comparación de revisiones (overlay Rev B sobre A) ────────────── */
  async function renderCompareForPage(n) {
    if (!markup || !compareRenderer.isLoaded) return;
    if (n < 1 || n > compareRenderer.numPages) { markup.clearCompareOverlay(); return; }
    const r = await compareRenderer.renderPage(n, 2.0);
    await markup.setCompareOverlay(r.dataUrl, r.imageWidth, r.imageHeight, {
      opacity: compareOpacity,
      tint   : compareTint ? '#e11d48' : null,
    });
  }

  async function loadCompareRevision(file) {
    setStatus('Cargando revisión B…');
    try {
      await compareRenderer.load(file);
      compareActive = true;
      $('cmp-name-b').textContent = file.name;
      $('cmp-name-a').textContent = session.docName || '—';
      $('compare-bar').style.display = 'flex';
      $('btn-compare').classList.add('tb-btn-active');
      await renderCompareForPage(currentPage);
      setStatus(`Comparando · A: ${session.docName}  vs  B: ${file.name}`);
    } catch (e) {
      setStatus('Error al cargar revisión: ' + e.message);
      alert('No se pudo cargar la revisión:\n' + e.message);
    }
  }

  function closeCompare() {
    compareActive = false;
    markup && markup.clearCompareOverlay();
    $('compare-bar').style.display = 'none';
    $('btn-compare').classList.remove('tb-btn-active');
    updateScaleBadge();                                   // re-mostrar la escala tras quitar el overlay
    setStatus(`Pág. ${currentPage}/${totalPages}  ·  ${session.docName}`);
  }

  /* ════════════════════════════════════════════════════════════════════
     SESIÓN JSON
     ════════════════════════════════════════════════════════════════════ */
  function saveSession() {
    if (!markup) return;
    session.pages[currentPage] = markup.getMarkupJSON();
    if (scaleManager.isCalibrated())
      session.scale = { pxPerUnit:scaleManager.pxPerUnit, unit:scaleManager.unit };
    const data = { version:3, docName:session.docName, pages:session.pages, pageHeights:session.pageHeights, scale:session.scale };
    storage.downloadJSON(data, `saf-markup-${session.docName.replace(/\.pdf$/i,'')}-${Date.now()}.json`);
    storage.saveSession(data);
    setStatus('Sesión JSON guardada ✓');
  }

  async function loadSessionFile(file) {
    try {
      const data = await storage.readJSONFile(file);
      if (!data.pages) throw new Error('Formato inválido');
      Object.assign(session, { docName:data.docName||session.docName, pages:data.pages||{}, pageHeights:data.pageHeights||{}, scale:data.scale||null });
      if (data.scale?.pxPerUnit) { scaleManager.pxPerUnit=data.scale.pxPerUnit; scaleManager.unit=data.scale.unit; updateScaleBadge(); }
      if (markup && pdfRenderer.isLoaded) { markup.setMarkupJSON(session.pages[currentPage]||null); buildUsersPanel(); setStatus('Sesión JSON cargada ✓'); }
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
  let _calMode     = 'points';
  let _calState    = 0;
  let _calPt1      = null, _calPt2 = null;
  let _calListener = null;

  function switchCalTab(mode) {
    _calMode = mode;
    const isPoints = (mode === 'points');

    ui.calModePoints.style.display = isPoints ? 'block' : 'none';
    ui.calModeDirect.style.display = isPoints ? 'none'  : 'block';
    ui.btnCalTabPoints.classList.toggle('cal-tab-active',  isPoints);
    ui.btnCalTabDirect.classList.toggle('cal-tab-active', !isPoints);

    // En modo puntos, el overlay deja pasar los clics al canvas (panel a la esquina);
    // en modo directo es un modal centrado normal.
    ui.modalCal.classList.toggle('modal-pick', isPoints);

    if (isPoints) {
      // Reiniciar flujo 2-puntos
      _calState = 1; _calPt1 = _calPt2 = null;
      ui.calStep1.style.display='block';
      ui.calStep2.style.display='none';
      ui.calStep3.style.display='none';
      ui.btnCalApply.disabled = true;
      _addCalCanvasListener();
    } else {
      _removeCalCanvasListener();
      if (markup) markup.canvas.defaultCursor = 'default';
      updateDirectPreview();
    }
  }

  function _addCalCanvasListener() {
    if (_calListener || !markup) return;
    markup.canvas.defaultCursor = 'crosshair';
    _calListener = opt => {
      if (!_calState) return;
      const ptr = markup.canvas.getPointer(opt.e);
      if (_calState === 1) {
        _calPt1=ptr; _calState=2;
        ui.calStep1.style.display='none';
        ui.calStep2.style.display='block';
      } else if (_calState === 2) {
        _calPt2=ptr; _calState=3;
        const px = Math.hypot(_calPt2.x-_calPt1.x, _calPt2.y-_calPt1.y);
        ui.calPxHint.textContent = `Distancia medida: ${px.toFixed(1)} px`;
        ui.calStep2.style.display='none';
        ui.calStep3.style.display='block';
        ui.btnCalApply.disabled = false;
        if (window._calLine) markup.canvas.remove(window._calLine);
        window._calLine = new fabric.Line(
          [_calPt1.x,_calPt1.y,_calPt2.x,_calPt2.y],
          {stroke:'#facc15',strokeWidth:2,strokeDashArray:[5,3],selectable:false,evented:false}
        );
        markup.canvas.add(window._calLine);
        markup.canvas.renderAll();
      }
    };
    markup.canvas.on('mouse:up', _calListener);
  }

  function _removeCalCanvasListener() {
    if (_calListener && markup) { markup.canvas.off('mouse:up',_calListener); _calListener=null; }
  }

  function openCalibrate() {
    // Reset todo
    _calPt1=_calPt2=null;
    ui.calValue.value='';
    ui.calPxDirect.value='';
    ui.calValDirect.value='';
    ui.calDirectPreview.textContent='';
    ui.btnCalApply.disabled=true;
    // Neutralizar la herramienta para que clicar puntos no dibuje ni seleccione
    if (markup) activateTool('select');
    switchCalTab('points');          // siempre abre en modo 2-puntos
    ui.modalCal.style.display='flex';
  }

  function updateDirectPreview() {
    const px  = parseFloat(ui.calPxDirect.value);
    const val = parseFloat(ui.calValDirect.value);
    const unit = ui.calUnitDirect.value;
    if (px>0 && val>0) {
      const pxPerUnit = px / val;
      ui.calDirectPreview.textContent = `→ 1 ${unit} = ${pxPerUnit.toFixed(2)} px`;
      ui.btnCalApply.disabled = false;
    } else {
      ui.calDirectPreview.textContent = '';
      ui.btnCalApply.disabled = true;
    }
  }

  function applyCalibration() {
    if (_calMode === 'direct') {
      const px  = parseFloat(ui.calPxDirect.value);
      const val = parseFloat(ui.calValDirect.value);
      if (!px||px<=0||!val||val<=0) { alert('Ingresa valores mayores a 0'); return; }
      scaleManager.calibrate(px, val, ui.calUnitDirect.value);
      closeCalibrate();
      updateScaleBadge();
      setStatus(`Escala: 1 ${ui.calUnitDirect.value} = ${scaleManager.pxPerUnit.toFixed(2)} px  ✓`);
    } else {
      if (!_calPt2) { alert('Haz clic en dos puntos del plano primero.'); return; }
      const val = parseFloat(ui.calValue.value);
      if (!val||val<=0) { alert('Ingresa un valor mayor a 0'); return; }
      const px = Math.hypot(_calPt2.x-_calPt1.x, _calPt2.y-_calPt1.y);
      scaleManager.calibrate(px, val, ui.calUnit.value);
      closeCalibrate();
      updateScaleBadge();
      setStatus(`Escala: 1 ${ui.calUnit.value} = ${scaleManager.pxPerUnit.toFixed(2)} px  ✓`);
    }
  }

  function closeCalibrate() {
    _calState=0;
    ui.modalCal.style.display='none';
    _removeCalCanvasListener();
    if (markup) markup.canvas.defaultCursor='default';
    if (window._calLine) {
      markup&&markup.canvas.remove(window._calLine);
      window._calLine=null;
      markup&&markup.canvas.renderAll();
    }
    markup&&markup.setTool(markup.currentTool);
  }

  /* ════════════════════════════════════════════════════════════════════
     PANEL DE PROPIEDADES DE ANOTACIÓN
     ════════════════════════════════════════════════════════════════════ */

  /** Catálogo de tipos de anotación de construcción */
  const ANNOT_TYPES = [
    { id:'RFI',   label:'RFI',          desc:'Request for Information',           icon:'📋' },
    { id:'NCR',   label:'NCR',          desc:'Non-Conformance Report',            icon:'🔴' },
    { id:'OBS',   label:'Observación',  desc:'Observación / Incidencia',          icon:'👁'  },
    { id:'AC',    label:'AC',           desc:'Aprobación de Cambio',              icon:'✅' },
    { id:'PCN',   label:'PCN/ECR',      desc:'Solicitud de cambio',               icon:'🔄' },
    { id:'COM',   label:'Comentario',   desc:'Comentario general',                icon:'💬' },
    { id:'DUDA',  label:'Duda',         desc:'Duda de constructibilidad',         icon:'❓' },
    { id:'COORD', label:'Coordinación', desc:'Nota de coordinación entre disciplinas', icon:'🔗' },
    { id:'MED',   label:'Medición',     desc:'Anotación de medición / cantidad',  icon:'📏' },
    { id:'HITO',  label:'Hito calidad', desc:'Hito de calidad / control',         icon:'🏁' },
    { id:'CHECK', label:'Checklist',    desc:'Checklist / verificación',          icon:'☑'  },
  ];

  let _apObj        = null;   // objeto Fabric.js activo en el panel
  let _panelEnabled = true;   // el panel se abre al seleccionar una figura (se puede ocultar con ◧)

  /** Activa o desactiva el panel de propiedades globalmente */
  function toggleAnnotPanel() {
    _panelEnabled = !_panelEnabled;

    // Actualizar estado visual del botón en la toolbar
    if (ui.btnTogglePanel) {
      ui.btnTogglePanel.classList.toggle('tb-btn-active', _panelEnabled);
      ui.btnTogglePanel.title = _panelEnabled
        ? 'Ocultar panel de propiedades  (P)'
        : 'Mostrar panel de propiedades  (P)';
    }

    if (!_panelEnabled) {
      // Apagar → cerrar el panel si estaba abierto
      const panel = $('annot-panel');
      if (panel) panel.style.display = 'none';
    } else if (_apObj) {
      // Encender con objeto activo → reabrirlo de inmediato
      openAnnotPanel(_apObj);
    }
  }

  /* ── Helpers de color para la sección Apariencia ── */
  function _colorToHex(c) {
    if (!c) return '#ef4444';
    c = String(c);
    if (c[0] === '#') return c.length === 4 ? '#'+c[1]+c[1]+c[2]+c[2]+c[3]+c[3] : c.slice(0,7);
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return '#ef4444';
    const [r,g,b] = m[1].split(',').map(n => parseInt(n,10));
    return '#' + [r,g,b].map(n => (n|0).toString(16).padStart(2,'0')).join('');
  }
  function _fillAlpha(c) {
    const m = String(c||'').match(/rgba\([^)]+,\s*([\d.]+)\s*\)/);
    return m ? parseFloat(m[1]) : (String(c||'')[0] === '#' ? 1 : 0.15);
  }
  function _hexToRgba(hex, a) {
    hex = hex.replace('#','');
    if (hex.length === 3) hex = hex.split('').map(x => x+x).join('');
    const r = parseInt(hex.slice(0,2),16), g = parseInt(hex.slice(2,4),16), b = parseInt(hex.slice(4,6),16);
    return `rgba(${r},${g},${b},${a})`;
  }
  /** Lee el estilo representativo de una figura (resuelve grupos como flecha/cota) */
  function _apReadStyle(obj) {
    const first = (obj.getObjects && obj.getObjects()[0]) || obj;
    return {
      stroke     : obj.stroke || first.stroke || '#ef4444',
      fill       : (obj.fill && obj.fill !== 'transparent') ? obj.fill : (first.fill || 'rgba(239,68,68,0.15)'),
      strokeWidth: obj.strokeWidth || first.strokeWidth || 2,
      opacity    : obj.opacity != null ? obj.opacity : 1,
    };
  }

  /** Abre el panel y lo llena con los datos de `obj` */
  function openAnnotPanel(obj) {
    const panel = $('annot-panel');
    if (!panel) return;
    if (!_panelEnabled) return;  // panel desactivado → pantalla completa
    if (!obj) return;  // no cerramos al deseleccionar; el usuario cierra con ✕

    _apObj = obj;
    const d = obj.data || {};

    /* ── Identidad ── */
    const autor = d.autor || 'Anónimo';
    const color = getUserColor(autor);
    $('ap-id-dot').style.background = color;
    $('ap-id-autor').textContent = autor;
    _apRefreshMeta(d);

    /* ── Apariencia + etiqueta de la figura ── */
    const st = _apReadStyle(obj);
    $('ap-stroke').value = _colorToHex(st.stroke);
    $('ap-fill').value   = _colorToHex(st.fill);
    $('ap-stroke-w').value = st.strokeWidth;
    $('ap-stroke-w-val').textContent = Math.round(st.strokeWidth);
    $('ap-opacity').value = Math.round(st.opacity * 100);
    $('ap-opacity-val').textContent = Math.round(st.opacity * 100);
    $('ap-label').value = markup ? markup.getLabelText(obj) : '';

    /* ── Hipervínculo (solo para enlaces) ── */
    const isLink = (d.type === 'link');
    $('ap-link-section').style.display = isLink ? 'block' : 'none';
    if (isLink) $('ap-link-page').value = d.targetPage || '';

    /* ── Descripción ── */
    $('ap-desc').value = d.descripcion || '';
    $('ap-desc-count').textContent = ($('ap-desc').value).length;

    /* ── Adjuntos (solo el pin de cámara puede llevar imágenes) ── */
    const isPhotoPin = (d.type === 'photo-pin');
    $('ap-att-section').style.display = isPhotoPin ? 'block' : 'none';
    if (isPhotoPin) renderAttachments();

    panel.style.display = 'flex';
  }

  /* ── Adjuntos de la figura (fotos / archivos) ───────────────────────── */
  function renderAttachments() {
    const grid = $('ap-att-grid');
    if (!grid) return;
    const list = (_apObj && _apObj.data && _apObj.data.adjuntos) || [];
    $('ap-att-count').textContent = list.length ? `(${list.length})` : '';
    grid.innerHTML = list.map((a, i) => {
      const isImg = (a.type || '').startsWith('image/');
      const thumb = isImg
        ? `<img src="${a.dataUrl}" alt="">`
        : `<span class="ap-att-fileicon"><i data-lucide="file"></i></span>`;
      return `<div class="ap-att-item" title="${a.name}">
        <button class="ap-att-thumb" data-act="open" data-i="${i}">${thumb}</button>
        <span class="ap-att-name">${a.name}</span>
        <button class="ap-att-del" data-act="del" data-i="${i}" title="Quitar">✕</button>
      </div>`;
    }).join('');
    renderIcons();   // convierte los <i data-lucide="file">
  }

  function openAttachment(a) {
    if ((a.type || '').startsWith('image/')) {
      $('att-lightbox-img').src = a.dataUrl;
      $('att-lightbox').style.display = 'flex';
    } else {
      const link = document.createElement('a');
      link.href = a.dataUrl; link.download = a.name; link.click();
    }
  }

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

  /** Redimensiona/recomprime una imagen para ahorrar espacio (mantiene PNG si era PNG) */
  function _downscaleImage(dataUrl, srcType, maxDim, quality, cb) {
    const img = new Image();
    img.onload = () => {
      let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
      const m = Math.max(w, h);
      if (m > maxDim) { const r = maxDim / m; w = Math.round(w * r); h = Math.round(h * r); }
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      const isPng = srcType === 'image/png';
      const outType = isPng ? 'image/png' : 'image/jpeg';
      let out;
      try { out = c.toDataURL(outType, quality); } catch (e) { out = dataUrl; }
      // Si por alguna razón quedó más grande que el original, conservar el original
      cb(out.length < dataUrl.length ? out : dataUrl, out.length < dataUrl.length ? outType : srcType);
    };
    img.onerror = () => cb(dataUrl, srcType);
    img.src = dataUrl;
  }

  /** Actualiza la línea de meta (fecha · tipo · prioridad) */
  function _apRefreshMeta(d) {
    const tipo  = ANNOT_TYPES.find(t => t.id === (d.tipoAnnot || ''));
    const fecha = d.fecha
      ? new Date(d.fecha).toLocaleString('es', {
          day:'2-digit', month:'short', year:'numeric',
          hour:'2-digit', minute:'2-digit'
        })
      : '';
    const parts = [fecha];
    if (tipo)        parts.push(`${tipo.icon} ${tipo.label}`);
    if (d.prioridad) parts.push(d.prioridad);
    $('ap-id-meta').textContent = parts.filter(Boolean).join('  ·  ');
  }

  /** Cierra el panel y descarta la selección */
  function closeAnnotPanel() {
    _apObj = null;
    const panel = $('annot-panel');
    if (panel) panel.style.display = 'none';
    if (markup) { markup.canvas.discardActiveObject(); markup.canvas.renderAll(); }
  }

  /** Guarda los datos del formulario en obj.data y registra en undo */
  function saveAnnotProps() {
    if (!_apObj) return;

    _apObj.data = Object.assign(_apObj.data || {}, {
      descripcion: $('ap-desc').value.trim(),
    });

    _apRefreshMeta(_apObj.data);
    markup && markup._snapshot();

    // Flash de confirmación en el botón
    const btn = $('btn-ap-save');
    const orig = btn.textContent;
    btn.textContent = '✓ Guardado';
    btn.style.background = '#16a34a';
    setTimeout(() => { btn.textContent = orig; btn.style.background = ''; }, 1400);
  }

  /** Cierra el panel al navegar de página o al abrir nuevo PDF */
  function _apCloseIfOpen() {
    if ($('annot-panel')?.style.display !== 'none') closeAnnotPanel();
  }

  /* ════════════════════════════════════════════════════════════════════
     USUARIOS — atribución de anotaciones
     ════════════════════════════════════════════════════════════════════ */

  // Endpoint Oracle APEX para resolver ID → nombre completo del usuario
  const API_USUARIO = 'https://saf.aicsacorp.com/ords/safws/api_pdf/usuario_conectado';

  // 12 colores deterministicos para identificar autores visualmente
  const USER_COLORS = [
    '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6',
    '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#14b8a6',
    '#a855f7', '#64748b'
  ];

  let _currentUserName = 'Anónimo';

  function _hashUser(name) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = ((h << 5) - h) + name.charCodeAt(i);
    return Math.abs(h) % USER_COLORS.length;
  }

  function getUserColor(name) {
    if (!name || name === 'Anónimo') return '#64748b';
    return USER_COLORS[_hashUser(name)];
  }

  /**
   * Llama al API de Oracle APEX para resolver un ID de sesión → nombre completo.
   * Respuesta esperada: { items: [{ nombre_persona: "CARLOS ALBERTO RAMIREZ MENDOZA" }] }
   */
  async function fetchAndSetUser(userId) {
    try {
      const prevStatus = ui.tbStatus.textContent;
      setStatus('Identificando usuario…');
      const res = await fetch(
        `${API_USUARIO}?usuario_conectado=${encodeURIComponent(userId)}`,
        { credentials: 'include' }   // por si el ORDS requiere cookie de sesión APEX
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data   = await res.json();
      const nombre = data?.items?.[0]?.nombre_persona;
      if (!nombre) throw new Error('nombre_persona vacío');
      setCurrentUser(nombre);
      // Restaurar status anterior si no se ha cargado un PDF todavía
      if (ui.tbStatus.textContent === 'Identificando usuario…') setStatus(prevStatus);
    } catch (err) {
      console.warn('[SAF] fetchAndSetUser:', err.message);
      setCurrentUser(`Usuario ${userId}`);   // fallback: mostrar el ID
    }
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

    // Persistir preferencia entre sesiones
    try { localStorage.setItem('saf_user', _currentUserName); } catch (e) {}
  }

  /** Reconstruye la lista de autores dentro del panel de usuarios */
  function buildUsersPanel() {
    if (!markup || !ui.authorsList) return;
    const authors = markup.getAuthors(); // [{ name, count }]

    if (!authors.length) {
      ui.authorsList.innerHTML = '<div class="author-empty">Sin anotaciones en esta página</div>';
      return;
    }

    ui.authorsList.innerHTML = authors.map(a => {
      const color = getUserColor(a.name);
      const isCurrent = (a.name === _currentUserName);
      return `<div class="author-row${isCurrent ? ' author-current' : ''}" data-author="${a.name}">
        <span class="author-dot" style="background:${color}"></span>
        <span class="author-name">${a.name}</span>
        <span class="author-count">${a.count}</span>
        <button class="author-toggle" data-author="${a.name}" title="Mostrar/ocultar">👁</button>
      </div>`;
    }).join('');

    // Botón ojo: toggle visibilidad de anotaciones del autor
    ui.authorsList.querySelectorAll('.author-toggle').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const row    = btn.closest('.author-row');
        const hidden = row.classList.toggle('author-hidden');
        markup.filterByAutor(btn.dataset.author, !hidden);
        btn.title = hidden ? 'Mostrar anotaciones' : 'Ocultar anotaciones';
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

  // 2. PDF
  [ui.btnOpen, ui.btnOpenLarge].forEach(b => b.addEventListener('click', () => ui.fileInput.click()));
  ui.fileInput.addEventListener('change', e => { if(e.target.files[0]) openPDF(e.target.files[0]); e.target.value=''; });

  // 3. Sesión JSON
  ui.btnSave.addEventListener('click', saveSession);
  ui.btnLoad.addEventListener('click', () => ui.sessionInput.click());
  ui.sessionInput.addEventListener('change', e => { if(e.target.files[0]) loadSessionFile(e.target.files[0]); e.target.value=''; });

  // 4. XFDF
  ui.btnXfdfSave.addEventListener('click', saveXFDF);
  ui.btnXfdfLoad.addEventListener('click', () => ui.xfdfInput.click());
  ui.xfdfInput.addEventListener('change', e => { if(e.target.files[0]) loadXFDFFile(e.target.files[0]); e.target.value=''; });

  // 5. Páginas / zoom
  ui.btnPrev.addEventListener('click', () => goToPage(currentPage-1));
  ui.btnNext.addEventListener('click', () => goToPage(currentPage+1));
  ui.btnZoomIn .addEventListener('click', () => markup&&markup.zoom(1.25));
  ui.btnZoomOut.addEventListener('click', () => markup&&markup.zoom(0.8));
  ui.btnFit    .addEventListener('click', () => markup&&markup.fitToCanvas());

  // 6. Herramientas (toolbar principal + items de dropdown)
  document.querySelectorAll('.tb-tool').forEach(btn => {
    btn.addEventListener('click', () => activateTool(btn.dataset.tool));
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
  [ui.calPxDirect, ui.calValDirect, ui.calUnitDirect].forEach(el =>
    el.addEventListener('input', updateDirectPreview)
  );

  // 11. Limpiar
  ui.btnClear.addEventListener('click', () => {
    if (!markup) return;
    if (!confirm('¿Limpiar todos los markups de esta página?')) return;
    markup.clearMarkup(); session.pages[currentPage]=null;
    ui.areaPanel.style.display='none';
  });

  // 12. PNG
  ui.btnExportPng.addEventListener('click', () => {
    if (!markup) return;
    const a=document.createElement('a');
    a.href=markup.exportPNG(2);
    a.download=`${session.docName.replace(/\.pdf$/i,'')}_p${currentPage}_markup.png`;
    a.click();
  });

  // 13. Panel área
  $('btn-area-close').addEventListener('click', () => { ui.areaPanel.style.display='none'; });

  // 13b. Comparación de revisiones
  $('btn-compare').addEventListener('click', () => {
    if (!pdfRenderer.isLoaded) return;
    if (!compareRenderer.isLoaded) {           // aún sin Rev B → cargarla
      $('compare-input').click();
    } else if (compareActive) {                // ya comparando → cerrar
      closeCompare();
    } else {                                   // Rev B cargada → reactivar
      compareActive = true;
      $('compare-bar').style.display = 'flex';
      $('btn-compare').classList.add('tb-btn-active');
      renderCompareForPage(currentPage);
    }
  });
  $('compare-input').addEventListener('change', e => {
    if (e.target.files[0]) loadCompareRevision(e.target.files[0]);
    e.target.value = '';
  });
  $('btn-compare-close').addEventListener('click', closeCompare);
  $('btn-compare-change').addEventListener('click', () => $('compare-input').click());
  $('cmp-opacity').addEventListener('input', e => {
    compareOpacity = parseInt(e.target.value, 10) / 100;
    markup && markup.setCompareOpacity(compareOpacity);
  });
  $('cmp-tint').addEventListener('change', e => {
    compareTint = e.target.checked;
    if (compareActive) renderCompareForPage(currentPage);
  });

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
    ui.btnTogglePanel.addEventListener('click', toggleAnnotPanel);
    ui.btnTogglePanel.classList.toggle('tb-btn-active', _panelEnabled);
  }

  // 16. Panel de propiedades de anotación ──────────────────────────────
  $('btn-ap-close') .addEventListener('click', closeAnnotPanel);
  $('btn-ap-cancel').addEventListener('click', closeAnnotPanel);
  $('btn-ap-save')  .addEventListener('click', saveAnnotProps);

  // Botones de prioridad (mutual exclusivo)
  document.querySelectorAll('.ap-prio').forEach(btn => {
    btn.addEventListener('click', () => {
      const wasActive = btn.classList.contains('active');
      document.querySelectorAll('.ap-prio').forEach(b => b.classList.remove('active'));
      if (!wasActive) btn.classList.add('active');   // segundo clic → deselecciona
    });
  });

  // Contador de caracteres en descripción
  $('ap-desc') && $('ap-desc').addEventListener('input', () => {
    $('ap-desc-count').textContent = $('ap-desc').value.length;
  });

  // ── Apariencia + etiqueta de la figura (edición en vivo) ──────────────
  $('ap-label') && $('ap-label').addEventListener('input', () => {
    if (markup && _apObj) markup.setLabelText(_apObj, $('ap-label').value);
  });
  $('ap-stroke') && $('ap-stroke').addEventListener('input', () => {
    if (markup && _apObj) markup.setObjProp(_apObj, 'stroke', $('ap-stroke').value);
  });
  $('ap-fill') && $('ap-fill').addEventListener('input', () => {
    if (!markup || !_apObj) return;
    const a = _fillAlpha(_apObj.fill);                 // conservar la opacidad del relleno
    markup.setObjProp(_apObj, 'fill', _hexToRgba($('ap-fill').value, a));
  });
  $('ap-stroke-w') && $('ap-stroke-w').addEventListener('input', () => {
    if (!markup || !_apObj) return;
    const w = parseInt($('ap-stroke-w').value, 10);
    $('ap-stroke-w-val').textContent = w;
    markup.setObjProp(_apObj, 'strokeWidth', w);
  });
  $('ap-opacity') && $('ap-opacity').addEventListener('input', () => {
    if (!markup || !_apObj) return;
    const o = parseInt($('ap-opacity').value, 10);
    $('ap-opacity-val').textContent = o;
    markup.setObjProp(_apObj, 'opacity', o / 100);
  });
  $('ap-link-page') && $('ap-link-page').addEventListener('input', () => {
    if (!_apObj || _apObj.data?.type !== 'link') return;
    const n = parseInt($('ap-link-page').value, 10);
    _apObj.data.targetPage = (n > 0) ? n : null;
    markup && markup._snapshot();
  });

  // ── Adjuntos: agregar / abrir / quitar ──────────────────────────────
  $('btn-ap-attach') && $('btn-ap-attach').addEventListener('click', () => $('ap-att-input').click());
  $('ap-att-input') && $('ap-att-input').addEventListener('change', e => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!_apObj || !files.length) return;
    if (!_apObj.data) _apObj.data = {};
    if (!_apObj.data.adjuntos) _apObj.data.adjuntos = [];
    const target = _apObj;   // figura fija aunque cambie la selección durante la lectura
    let pending = files.length;
    const done = () => { if (--pending === 0) { renderAttachments(); markup && markup.refreshThumb(target); markup && markup._snapshot(); } };
    files.forEach(f => {
      if (f.size > 25 * 1024 * 1024) {
        alert(`"${f.name}" supera 25 MB. Adjunta un archivo más liviano.`);
        done(); return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const raw = reader.result;
        if ((f.type || '').startsWith('image/')) {
          // Optimizar: redimensionar a máx 1920px y recomprimir (foto de varios MB → ~200 KB)
          _downscaleImage(raw, f.type, 1920, 0.82, (outUrl, outType) => {
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
    if (f.size > 25 * 1024 * 1024) { alert(`"${f.name}" supera 25 MB. Elige una imagen más liviana.`); activateTool('select'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      _downscaleImage(reader.result, f.type, 1920, 0.85, (outUrl, outType) => {
        markup.placePendingImage(outUrl, f.name, outType);
        activateTool('select');
      });
    };
    reader.onerror = () => { alert('No se pudo leer la imagen.'); activateTool('select'); };
    reader.readAsDataURL(f);
  });

  $('ap-att-grid') && $('ap-att-grid').addEventListener('click', e => {
    const btn = e.target.closest('[data-act]');
    if (!btn || !_apObj || !_apObj.data?.adjuntos) return;
    const i = parseInt(btn.dataset.i, 10);
    const a = _apObj.data.adjuntos[i];
    if (!a) return;
    if (btn.dataset.act === 'del') {
      _apObj.data.adjuntos.splice(i, 1);
      renderAttachments();
      markup && markup.refreshThumb(_apObj);
      markup && markup._snapshot();
    } else {
      openAttachment(a);
    }
  });
  $('att-lightbox') && $('att-lightbox').addEventListener('click', () => {
    $('att-lightbox').style.display = 'none';
  });
  // Mini-toolbar: mostrar/ocultar el adjunto sobre la figura
  $('fig-toggle-att') && $('fig-toggle-att').addEventListener('click', () => {
    const obj = markup && markup.canvas.getActiveObject();
    if (!obj || !obj.data) return;
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
  if (ui.btnSetUser) {
    ui.btnSetUser.addEventListener('click', () => {
      const n = (ui.userInput.value || '').trim();
      if (n) setCurrentUser(n);
      ui.userInput.value = '';
      closeAllDropdowns();
    });
  }
  if (ui.userInput) {
    // Enter aplica
    ui.userInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const n = (ui.userInput.value || '').trim();
        if (n) setCurrentUser(n);
        ui.userInput.value = '';
        closeAllDropdowns();
      }
    });
    // Evitar que el clic dentro del input cierre el dropdown
    ui.userInput.addEventListener('click', e => e.stopPropagation());
  }

  // Abrir panel de usuarios → reconstruir lista de autores en tiempo real
  if ($('btn-users')) {
    $('btn-users').addEventListener('click', () => { if (markup) buildUsersPanel(); });
  }

  // PostMessage desde Oracle APEX
  // Soporta dos formas:
  //   { action: 'setUser',   name:   'Carlos Ramírez' }  → nombre directo
  //   { action: 'setUserId', userId: 173               }  → resuelve vía API
  window.addEventListener('message', e => {
    if (!e.data || typeof e.data !== 'object') return;
    if (e.data.action === 'setUser'   && e.data.name)   setCurrentUser(e.data.name);
    if (e.data.action === 'setUserId' && e.data.userId)  fetchAndSetUser(e.data.userId);
  });

  // Identificación al cargar
  // Prioridad: 1) ?usuario_conectado=ID (llama al API)
  //            2) ?usuario=Nombre       (nombre directo en URL)
  //            3) localStorage          (sesión anterior)
  (function () {
    const params  = new URLSearchParams(window.location.search);
    const userId  = params.get('usuario_conectado');   // ← ID numérico de sesión APEX
    const urlUser = params.get('usuario') || params.get('user');

    if (userId) {
      fetchAndSetUser(userId);           // resuelve nombre_persona desde el API
    } else if (urlUser) {
      setCurrentUser(urlUser);           // nombre ya en la URL
    } else {
      try {
        const saved = localStorage.getItem('saf_user');
        if (saved && saved !== 'Anónimo') setCurrentUser(saved);
      } catch (e) {}
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
        '=':()=>markup&&markup.zoom(1.25), '+':()=>markup&&markup.zoom(1.25),
        '-':()=>markup&&markup.zoom(0.8),
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
      case 'p': case 'P': toggleAnnotPanel(); break;
      case 'ArrowLeft':  case 'PageUp':   if(currentPage>1)        goToPage(currentPage-1); break;
      case 'ArrowRight': case 'PageDown': if(currentPage<totalPages) goToPage(currentPage+1); break;
    }
  });

  /* ── Utilidades UI ─────────────────────────────────────────────────── */
  function enableDocs(on) {
    [ui.btnPrev,ui.btnNext,ui.btnZoomIn,ui.btnZoomOut,ui.btnFit,
     ui.btnSave,ui.btnXfdfSave,ui.btnCalibrate,ui.btnClear,ui.btnExportPng,
     $('btn-compare')]
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

  let _hintTimer;
  function showHint(msg) {
    const el=ui.drawHint;
    if (!msg) { el.style.display='none'; return; }
    el.textContent=msg; el.style.display='block';
    clearTimeout(_hintTimer);
    if (!msg) _hintTimer=setTimeout(()=>el.style.display='none', 2500);
  }

})();
