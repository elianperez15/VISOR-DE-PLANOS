/* ═══════════════════════════════════════════════════════════════════════
   main.ts — Punto de entrada del Visor de Planos SAF (PDF.js + Fabric.js)

   Sólo COMPONE el visor: crea los módulos de cada dominio, los conecta entre
   sí por sus `ctx` y arranca. La lógica vive en cada carpeta de dominio:

     plano/              abrir, renderizar, navegar y rotar el PDF
     anotaciones/        lienzo de marcas, herramientas, panel de propiedades, adjuntos
     mediciones/         escala, calibración, resultado de áreas
     rfi/                RFIs vinculados a nubes y sellos
     hipervinculos/      enlaces de un plano a otro
     revisiones/         comparación de revisiones
     modelo-3d/          visor del modelo 3D (otra página: /modelo/, ver main-modelo.ts)
     colaboracion/       colaboración en vivo (WebSocket), colaboradores, autoría
     persistencia/       marcas en Oracle vía ORDS, exportación de la sesión
     exportacion/        descarga en PDF, captura por selección
     integracion-apex/   puente postMessage con la página APEX
     usuario/            identidad, permisos y color por usuario
     compartido/         UI y utilidades sin dominio
     app/                configuración y atajos de teclado
   ═══════════════════════════════════════════════════════════════════════ */
import './app/styles.css';

import { initKeyboardShortcuts } from './app/keyboard-shortcuts';
import { createConfirm } from './compartido/ui/confirm';
import { initDropdowns } from './compartido/ui/dropdowns';
import { showHint } from './compartido/ui/hint';
import { renderIcons } from './compartido/ui/icons';
import { initLicensesLink } from './compartido/ui/licenses';
import { initRailDrag } from './compartido/ui/rail-drag';
import { listenToApex, type OpenPlanoRequest } from './integracion-apex/apex-bridge';
import { initCloseViewer } from './integracion-apex/close-viewer';
import { createIdentity } from './usuario/identity';
import { createPlanViewer } from './plano/plan-viewer';
import { hideViewerNotice, scheduleViewerNotice } from './plano/viewer-notice';
import { MarkupLayer } from './anotaciones/lienzo/markup-layer';
import { createAttachments } from './anotaciones/attachments';
import { createPropertiesPanel } from './anotaciones/properties-panel';
import { createStampPicker } from './anotaciones/stamp-picker';
import { createToolbar } from './anotaciones/toolbar';
import { initAreaPanel, hideAreaResult, showAreaResult } from './mediciones/area-panel';
import { createCalibration } from './mediciones/calibration';
import { ScaleManager } from './mediciones/scale-manager';
import { createRfi } from './rfi/rfi';
import { createPlanLinks } from './hipervinculos/plan-links';
import { createCompareRevisions } from './revisiones/compare-revisions';
import { showAuthorTooltip } from './colaboracion/author-tooltip';
import { Collab } from './colaboracion/collab';
import { createCollabSync } from './colaboracion/collab-sync';
import { createCollaboratorsPanel } from './colaboracion/collaborators-panel';
import { createMarkupStore } from './persistencia/markup-store';
import { initSaveMarks } from './persistencia/save-marks';
import { exportSessionFile } from './persistencia/session-file';
import { createExportPdf } from './exportacion/export-pdf';
import { createRegionSnapshot } from './exportacion/region-snapshot';
import { isModelFile } from './modelo-3d/models-api';
import { handOff, VISOR_MODELO_PATH } from './app/viewer-routes';

/* ── Estado compartido ───────────────────────────────────────────────── */
const confirm      = createConfirm();
const scaleManager = new ScaleManager();
let   markup: MarkupLayer | null = null;   // lienzo de marcas del documento abierto
const getMarkup    = () => markup;

/* ── Dominios ────────────────────────────────────────────────────────── */
const identity = createIdentity({
  onUserChange: name => {
    if (markup) markup.currentUser = name;
    collabSync.reannounce(name);
  },
});

const plan = createPlanViewer({
  createMarkup,
  getMarkup,
  onDocumentClosing : () => { collabSync.reset(); markupStore.reset(); compare.close(); },
  onDocumentOpened  : () => {
    // Conectar PRIMERO a la sala (cursores y cambios en vivo), luego traer las
    // capas ya guardadas sin bloquear la conexión.
    collabSync.start();
    markupStore.loadFromServer();
  },
  onBeforePageChange: () => regionSnapshot.cancel(),   // un recorte a medias no sobrevive al cambio de página
  onBeforeShowPage  : () => panel.closeIfOpen(),
  onPageShown       : n => { collabSync.onPageShown(n); collaborators.render(); compare.onPageChange(n); },
  onRotated         : () => collabSync.pushLocalLayer(),   // sincroniza en vivo (no persiste)
});
const { session } = plan;

const collabSync = createCollabSync({
  collab         : new Collab(),
  getMarkup,
  getSession     : () => session,
  getCurrentPage : plan.getCurrentPage,
  getUser        : () => identity.name,
  onPresence     : () => collaborators.render(),
  onScaleReceived: scale => calibration.applyScaleFromSession(scale),
});

const collaborators = createCollaboratorsPanel({
  getMarkup,
  getUser : () => identity.name,
  presence: collabSync.presence,
});

const markupStore = createMarkupStore({
  getMarkup,
  getSession              : () => session,
  getCurrentPage          : plan.getCurrentPage,
  getUser                 : () => identity.name,
  getUserId               : () => identity.userId,
  getRevId                : () => identity.revId,
  storeRemoteLayer        : (page, author, json) => collabSync.storeRemoteLayer(page, author, json),
  applyRemoteLayersForPage: page => collabSync.applyRemoteLayersForPage(page),
  onRotationLoaded        : deg => plan.applySavedRotation(deg),
  onScaleLoaded           : scale => calibration.applyScaleFromSession(scale),
});

const toolbar = createToolbar({
  getMarkup,
  confirm,
  onBeforeActivate: () => rfi.onToolChange(),   // cambiar de herramienta cancela el modo Nube RFI
  onMyMarksCleared: () => {
    session.pages[plan.getCurrentPage()] = markup.getMarkupJSON();
    collabSync.pushLocalLayer();   // sincroniza en vivo; el borrado se guarda al pulsar «Guardar»
    hideAreaResult();
  },
});
const activateTool = (tool: string) => toolbar.activateTool(tool);

const panel       = createPropertiesPanel({ getMarkup });
const stamps      = createStampPicker({ getMarkup, activateTool });
const attachments = createAttachments({ getMarkup, panel, activateTool, confirm });

const calibration = createCalibration({
  scaleManager,
  getMarkup,
  getSession    : () => session,
  activateTool,
  broadcastScale: scale => collabSync.broadcastScale(scale),
  saveScale     : () => markupStore.saveScaleNow(),
});

const rfi = createRfi({
  getMarkup,
  getActive     : () => panel.getActive(),
  getSession    : () => session,
  getCurrentPage: plan.getCurrentPage,
  getProjectCode: () => identity.projectCode,
  activateTool,
  confirm,
  pushLocalLayer: () => collabSync.pushLocalLayer(),
  saveObjectsNow: (page, objs) => markupStore.saveObjectsNow(page, objs),
});

const links = createPlanLinks({
  getMarkup,
  getActive     : () => panel.getActive(),
  getSession    : () => session,
  getProjectCode: () => identity.projectCode,
  getUserName   : () => identity.name,
  getUserId     : () => identity.userId,
  confirm,
});

const regionSnapshot = createRegionSnapshot({
  getMarkup,
  isDocumentLoaded: () => plan.pdfRenderer.isLoaded,
  defaultName     : () => `${(session.docName || 'plano').replace(/\.pdf$/i, '')}_captura_p${plan.getCurrentPage()}`,
});

const compare = createCompareRevisions({
  getMarkup,
  getSession          : () => session,
  getCurrentPage      : plan.getCurrentPage,
  getTotalPages       : plan.getTotalPages,
  pdfRenderer         : plan.pdfRenderer,
  getRotation         : plan.getRotation,
  getProjectCode      : () => identity.projectCode,
  updateScaleBadge    : () => calibration.updateScaleBadge(),
  startRegionSnapshot : baseName => regionSnapshot.start(baseName),
  cancelRegionSnapshot: () => regionSnapshot.cancel(),
});

const exportPdf = createExportPdf({
  pdfRenderer   : plan.pdfRenderer,
  getMarkup,
  getSession    : () => session,
  getCurrentPage: plan.getCurrentPage,
  getTotalPages : plan.getTotalPages,
  goToPage      : n => plan.goToPage(n),
  canDownload   : () => identity.canCollaborate,
});

/** Crea el lienzo de marcas de un documento recién abierto y lo conecta con los dominios. */
function createMarkup(): MarkupLayer {
  if (markup) markup.destroy();
  markup = new MarkupLayer('fabric-canvas', { scaleManager });
  markup.currentUser     = identity.name;
  markup.onUndoChange    = toolbar.updateUndoButtons;
  markup.onAutoSelect    = () => activateTool('select');   // vuelve a "Seleccionar" tras colocar una figura
  markup.onHint          = msg => showHint(msg);
  markup.onAreaReady     = showAreaResult;
  markup.onStampPick     = stamps.open;
  markup.onImagePick     = attachments.pickImageToPlace;
  markup.onShowImage     = attachments.showImage;
  markup.onAnnotClick    = obj => panel.open(obj);
  markup.onAnnotHover    = showAuthorTooltip;
  markup.onFollowLink    = links.follow;
  markup.onLinkCreated   = links.onLinkCreated;
  markup.onCloudCreated  = rfi.onCloudCreated;
  markup.onStampDblClick = rfi.onStampDblClick;
  markup.onLocalChange   = () => collabSync.pushLocalLayer();   // emitir la capa propia a la sala
  markup.canvas.on('after:render', attachments.updateFigToolbar);   // mini-toolbar sobre la figura
  // Si se elimina la figura abierta en el panel, cerrar el panel
  markup.canvas.on('object:removed', (opt: any) => {
    if (opt.target && opt.target === panel.getActive()) panel.close();
  });
  collabSync.trackCursor(markup);
  return markup;
}

/** Abre el plano pedido por APEX (por id de repositorio o por URL directa). */
/** Abre un plano PDF. Un modelo 3D (.ifc / .frag) se pasa al visor 3D (/modelo/). */
function openPlano(req: OpenPlanoRequest) {
  if (req.model || req.modelUrl || isModelFile(req.name) || isModelFile(req.pdfUrl)) {
    handOff(VISOR_MODELO_PATH, req, identity);
    return;
  }
  hideViewerNotice();   // llega un plano: el aviso de "nada que mostrar" sobra
  if (req.repoId != null) plan.openFromRepo(req.repoId, req.name);
  else if (req.pdfUrl)    plan.openFromUrl(req.pdfUrl, req.docId, req.name);
}

/* ── Arranque ────────────────────────────────────────────────────────── */
renderIcons();
initDropdowns();
initRailDrag();
initLicensesLink(document.getElementById('canvas-area'));

exportPdf.init();
initCloseViewer(confirm);
initSaveMarks({
  hasDocument: () => !!markup,
  canSave    : () => identity.canCollaborate,
  syncSession: () => {
    const page = plan.getCurrentPage();
    session.pages[page]       = markup.getMarkupJSON();
    session.pageHeights[page] = markup.getPageHeight();
    session.rotation          = plan.getRotation();
    session.scale             = calibration.buildScaleObj();
    return session;
  },
  saveNow: () => markupStore.saveNow(),
});

plan.init();
toolbar.init();
rfi.init();
collaborators.init();
calibration.init();
initAreaPanel();
compare.init();
regionSnapshot.init();
stamps.init();
panel.init();
links.init();
confirm.init();
attachments.init();

listenToApex({
  onProjectCode  : code => identity.setProjectCode(code),
  onPermission   : value => identity.setPermission(value),
  onSetUser      : (name, code) => {
    if (name) identity.setUser(name);
    identity.setUserId(code, 'postMessage');
  },
  onInit         : ({ name, code, revId, plano }) => {
    if (name) identity.setUser(name);
    identity.setUserId(code, 'init');
    identity.setRevId(revId);
    if (plano) openPlano(plano);
  },
  onOpenPlano    : openPlano,
  onSetLinkTarget: target => links.setTargetFromApex(target),
});

// Identidad y plano desde la URL del iframe:
//   ?usuario_conectado=…&repoId=123                  (plano del repositorio; un .ifc/.frag pasa a /modelo/)
//   ?usuario_conectado=…&pdf=/pdfs/p.pdf&docId=123   (URL directa de un PDF)
const params = new URLSearchParams(window.location.search);
identity.readFromUrl(params);
const repoId   = params.get('repoId') || params.get('id_en_repositorio');
const pdfParam = params.get('pdf');
if (repoId || pdfParam) {
  openPlano({ repoId: repoId || undefined, pdfUrl: pdfParam || undefined,
              docId: params.get('docId') || undefined, name: params.get('nombre') || undefined });
} else {
  // Nadie ha pedido un plano. Embebido aún puede llegar por postMessage, así
  // que el aviso espera un momento antes de aparecer.
  scheduleViewerNotice('El visor no recibió ningún plano que mostrar. '
    + 'Ábrelo desde el listado de planos del sistema.', () => plan.pdfRenderer.isLoaded);
}

initKeyboardShortcuts({
  getMarkup,
  isModalOpen  : () => calibration.isOpen() || stamps.isOpen(),
  activateTool,
  togglePanel  : () => panel.toggle(),
  exportSession: () => {
    if (!markup) return;
    session.pages[plan.getCurrentPage()] = markup.getMarkupJSON();
    session.rotation = plan.getRotation();
    if (scaleManager.isCalibrated()) session.scale = calibration.buildScaleObj();
    exportSessionFile(session);
  },
});
