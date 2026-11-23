/* ──────────────────────────────────────────────────────────────────────
   markup-store.ts — Persistencia de las marcas en Oracle vía ORDS (HTTP)

   Cada usuario tiene UNA capa por plano: el POST la reemplaza entera (MERGE
   por usuario + plano) y el GET devuelve las capas de todos los usuarios.
     POST {API_MARKUP}  header id  body { usuario, usuario_id, id_revision, sesion }
     GET  {API_MARKUP}  header id  → { capas: [{ usuario, usuario_id, sesion }] }

   Es independiente de la colaboración en vivo: con VITE_COLLAB_ENABLED=false
   guardar y cargar marcas, la escala y la rotación funcionan igual.
   ────────────────────────────────────────────────────────────────────── */
import { API_MARKUP } from '../app/config';
import type { MarkupLayer } from '../anotaciones/lienzo/markup-layer';
import type { PlanSession } from '../plano/plan-viewer';

export interface MarkupStoreCtx {
  getMarkup(): MarkupLayer | null;
  getSession(): PlanSession;
  getCurrentPage(): number;
  getUser(): string;
  getUserId(): string | number | null;
  getRevId(): number | null;
  /** Capa guardada de OTRO usuario (se pinta bloqueada). */
  storeRemoteLayer(page: string, author: string, json: string): void;
  applyRemoteLayersForPage(page: number): void;
  onRotationLoaded(deg: number): void;
  onScaleLoaded(scale: any): void;
}

/** Marcas del autor `user` dentro del JSON de una página. */
function ownObjects(json: string, user: string): any[] {
  return JSON.parse(json).filter((o: any) => (o.data?.autor || 'Anónimo') === user);
}

export function createMarkupStore(ctx: MarkupStoreCtx) {
  // ── Baseline PERSISTIDO en el servidor ─────────────────────────────────
  // Refleja lo que YA está guardado del usuario (lo cargado al abrir + lo
  // confirmado con «Guardar»). Permite autoguardar SOLO una figura (nube RFI)
  // o SOLO la escala, sin arrastrar las demás marcas aún no guardadas.
  const saved = { pages: {} as Record<string, string>, scale: null as any, rotation: 0 };

  /** Reemplaza el baseline de páginas por una copia de `pages`. */
  function setSavedPages(pages: Record<string, string>) {
    for (const k in saved.pages) delete saved.pages[k];
    for (const p in pages) if (pages[p]) saved.pages[p] = pages[p];
  }

  /** Olvida el baseline al cambiar de plano (se rehace al cargar el nuevo). */
  function reset() {
    setSavedPages({});
    saved.scale = null;
    saved.rotation = 0;
  }

  /** Páginas con SOLO las marcas del usuario actual (capa propia limpia). */
  function ownPages() {
    const session = ctx.getSession(), user = ctx.getUser(), page = ctx.getCurrentPage(), markup = ctx.getMarkup();
    const out: Record<string, string> = {};
    for (const p in session.pages) {
      const json = session.pages[p];
      if (!json) continue;
      try {
        const mine = ownObjects(json, user);
        if (mine.length) out[p] = JSON.stringify(mine);
      } catch (e) {}
    }
    if (markup) {
      const current = markup.getLayerJSON(user);
      try { if (JSON.parse(current).length) out[page] = current; else delete out[page]; } catch (e) {}
    }
    return out;
  }

  /** POST del cuerpo completo. El handler REEMPLAZA toda la capa del usuario
      (no hace merge por objeto): `pages` debe contener EXACTAMENTE lo que debe
      quedar persistido para este usuario. */
  async function post(pages: Record<string, string>, scale: any, rotation: number): Promise<boolean> {
    const session = ctx.getSession();
    if (session.docId == null) return false;   // archivo local: sin servidor
    try {
      const sesion = {
        version: 3, docName: session.docName,
        pages, pageHeights: session.pageHeights, scale,
        rotation: rotation || 0,
      };
      const res = await fetch(API_MARKUP, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', id: String(session.docId) },
        credentials: 'include',
        body: JSON.stringify({
          usuario    : ctx.getUser(),
          usuario_id : ctx.getUserId(),
          id_revision: ctx.getRevId(),
          sesion,
        }),
      });
      return res.ok;
    } catch (e: any) { console.warn('[SAF] postSesion:', e.message); return false; }
  }

  /** Guardado COMPLETO (botón «Guardar»): todas las marcas propias, la rotación
      y la escala. Al confirmar, actualiza el baseline persistido. */
  async function saveNow(): Promise<boolean> {
    const session = ctx.getSession();
    const pages = ownPages();
    const ok = await post(pages, session.scale, session.rotation || 0);
    if (ok) {
      setSavedPages(pages);
      saved.scale    = session.scale;
      saved.rotation = session.rotation || 0;
    }
    return ok;
  }

  /** Autoguarda SOLO la escala calibrada (es global), conservando lo ya guardado. */
  async function saveScaleNow(): Promise<boolean> {
    const session = ctx.getSession();
    const ok = await post({ ...saved.pages }, session.scale, saved.rotation);
    if (ok) saved.scale = session.scale;
    return ok;
  }

  /** Autoguarda SOLO los objetos indicados en `page` (p.ej. una nube RFI y su
      sello), conservando lo ya guardado. `objs` ya vienen serializados (toObject). */
  async function saveObjectsNow(page: number | string, objs: any[]): Promise<boolean> {
    if (!objs || !objs.length) return false;
    const session = ctx.getSession();
    const pages: Record<string, string> = { ...saved.pages };
    let list: any[] = [];
    try { list = JSON.parse(pages[page] || '[]'); } catch (e) { list = []; }
    // Reemplaza versiones previas de esos objetos (dedupe por cloudId)
    const ids = new Set(objs.map(o => o?.data?.cloudId).filter(Boolean));
    if (ids.size) list = list.filter(o => !ids.has(o?.data?.cloudId));
    list.push(...objs);
    pages[page] = JSON.stringify(list);
    const ok = await post(pages, session.scale, saved.rotation);
    if (ok) { saved.pages[page] = pages[page]; saved.scale = session.scale; }
    return ok;
  }

  /** Carga las capas de todos los usuarios (propias editables, ajenas bloqueadas). */
  async function loadFromServer() {
    const session = ctx.getSession();
    if (session.docId == null) return;
    try {
      const res = await fetch(API_MARKUP, { credentials: 'include', headers: { id: String(session.docId) } });
      if (!res.ok) return;   // 404 = plano sin marcas aún
      const data = await res.json();
      const user = ctx.getUser(), userId = ctx.getUserId();
      let savedRotation: number | null = null;
      let savedScale: any = null;
      let savedScaleTs = -1;
      const minePages: Record<string, string> = {};   // capa propia tal como está en el servidor
      (data?.capas || []).forEach((capa: any) => {
        const pages = capa?.sesion?.pages || {};
        const mine = (userId != null && String(capa.usuario_id) === String(userId)) || (capa.usuario === user);
        if (mine && typeof capa?.sesion?.rotation === 'number') savedRotation = capa.sesion.rotation;
        // La escala es GLOBAL: gana la calibración MÁS RECIENTE (mayor ts) entre todas las capas
        const scale = capa?.sesion?.scale;
        if (scale) {
          const ts = Number(scale.ts) || 0;
          if (ts >= savedScaleTs) { savedScaleTs = ts; savedScale = scale; }
        }
        for (const p in pages) {
          if (mine) { session.pages[p] = pages[p]; minePages[p] = pages[p]; }
          else ctx.storeRemoteLayer(p, capa.usuario, pages[p]);
        }
      });
      const markup = ctx.getMarkup(), page = ctx.getCurrentPage();
      markup && markup.setMarkupJSON(session.pages[page] || null);
      ctx.applyRemoteLayersForPage(page);
      setSavedPages(minePages);
      saved.rotation = savedRotation != null ? savedRotation : (session.rotation || 0);
      if (savedScale) {
        session.scale = savedScale;
        saved.scale   = savedScale;
        ctx.onScaleLoaded(savedScale);
      }
      if (savedRotation != null) {
        session.rotation = savedRotation;
        ctx.onRotationLoaded(savedRotation);
      }
    } catch (e: any) { console.warn('[SAF] loadRemoteLayersFromServer:', e.message); }
  }

  return { saveNow, saveScaleNow, saveObjectsNow, loadFromServer, reset };
}

export type MarkupStore = ReturnType<typeof createMarkupStore>;
