/* ═══════════════════════════════════════════════════════════════════════
   main-modelo.ts — Punto de entrada del VISOR DEL MODELO 3D (/modelo/)

   Página aparte del visor de planos (src/main.ts, /). Sólo COMPONE: el
   visor 3D (modelo-3d/), la identidad (usuario/) y el puente con APEX
   (integracion-apex/). Si le llega un plano PDF, lo pasa al visor de planos
   (ver app/viewer-routes.ts).

   APEX lo abre igual que al visor de planos, con la URL /modelo/:
     ?repoId=…&nombre=modelo.ifc            modelo del repositorio
     ?modelo=/ruta/modelo.ifc               URL directa (pruebas)
     o postMessage { action:'init' | 'openModel', repoId, nombre }
   ═══════════════════════════════════════════════════════════════════════ */
import './app/styles-modelo.css';

import { handOff, VISOR_PLANOS_PATH } from './app/viewer-routes';
import { createConfirm } from './compartido/ui/confirm';
import { initDropdowns } from './compartido/ui/dropdowns';
import { initLicensesLink } from './compartido/ui/licenses';
import { initRailDrag } from './compartido/ui/rail-drag';
import { renderIcons } from './compartido/ui/icons';
import { listenToApex, type OpenPlanoRequest } from './integracion-apex/apex-bridge';
import { initCloseViewer } from './integracion-apex/close-viewer';
import { createModelViewer } from './modelo-3d/model-viewer';
import { isModelFile } from './modelo-3d/models-api';
import { createIdentity } from './usuario/identity';

const confirm  = createConfirm();
const identity = createIdentity();
const viewer   = createModelViewer();

/** Abre un modelo 3D. Un plano PDF se pasa al visor de planos (/). */
function openDocument(req: OpenPlanoRequest) {
  const isPdf = !req.model && !req.modelUrl
    && (/\.pdf$/i.test(req.name || '') || (!!req.pdfUrl && !isModelFile(req.pdfUrl)));
  if (isPdf) { handOff(VISOR_PLANOS_PATH, req, identity); return; }
  if (req.repoId != null) viewer.openFromRepo(req.repoId, req.name);
  else                    viewer.openFromUrl(req.modelUrl || req.pdfUrl, req.name);
}

/* ── Arranque ────────────────────────────────────────────────────────── */
renderIcons();
initDropdowns();
initRailDrag('saf_rail_pos_modelo');   // posición propia: no comparte la del riel del plano
initLicensesLink(document.querySelector('.model-area'));
confirm.init();
initCloseViewer(confirm, 'Se cerrará el visor del modelo 3D.');
viewer.init();

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
    if (plano) openDocument(plano);
  },
  onOpenPlano    : openDocument,
  onSetLinkTarget: () => {},   // los hipervínculos son del visor de planos
});

// Identidad y modelo desde la URL del iframe
const params   = new URLSearchParams(window.location.search);
identity.readFromUrl(params);
const repoId   = params.get('repoId') || params.get('id_en_repositorio');
const modelUrl = params.get('modelo');
const pdfUrl   = params.get('pdf');
if (repoId || modelUrl || pdfUrl) {
  openDocument({ repoId: repoId || undefined, modelUrl: modelUrl || undefined, pdfUrl: pdfUrl || undefined,
                 docId: params.get('docId') || undefined, name: params.get('nombre') || undefined });
}
