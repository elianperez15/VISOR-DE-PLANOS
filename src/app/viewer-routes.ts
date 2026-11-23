/* ──────────────────────────────────────────────────────────────────────
   viewer-routes.ts — Las dos páginas del visor y el traspaso entre ellas

     /          visor de planos (PDF, 2D)    index.html         → src/main.ts
     /modelo/   visor del modelo (IFC, 3D)   modelo/index.html  → src/main-modelo.ts

   Si a una página le llega un archivo de la otra (p. ej. APEX manda un .ifc
   al visor de planos), lo reenvía con TODO lo necesario en la URL: APEX manda
   el `init` una sola vez (al primer 'load' del iframe) y no lo repetiría
   tras la navegación.
   ────────────────────────────────────────────────────────────────────── */
import type { OpenPlanoRequest } from '../integracion-apex/apex-bridge';
import type { Identity } from '../usuario/identity';

export const VISOR_PLANOS_PATH = import.meta.env.BASE_URL;
export const VISOR_MODELO_PATH = `${import.meta.env.BASE_URL}modelo/`;

/** Abre el documento en la otra página del visor, conservando identidad, proyecto y permiso. */
export function handOff(path: string, req: OpenPlanoRequest, identity: Identity): void {
  const params = new URLSearchParams();
  const set = (key: string, value: unknown) => {
    if (value != null && String(value).trim() !== '') params.set(key, String(value));
  };
  set('repoId', req.repoId);
  set('nombre', req.name);
  if (req.repoId == null) set(path === VISOR_MODELO_PATH ? 'modelo' : 'pdf', req.modelUrl || req.pdfUrl);
  set('docId', req.docId);
  set('usuario_conectado', identity.name);
  set('codigo_usuario', identity.userId);
  set('id_revision', identity.revId);
  set('codigo_proyecto', identity.projectCode);
  params.set('P0_PERMISO_COLABORADOR', identity.canCollaborate ? '1' : '0');
  window.location.replace(`${path}?${params}`);
}
