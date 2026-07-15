/* ──────────────────────────────────────────────────────────────────────
   collab-sync.ts — Sincronización de marcas en tiempo real + persistencia

   Orquesta la colaboración: emite/recibe capas por autor, presencia y
   cursores (vía el cliente WebSocket) y persiste las marcas en ORDS.

   Es una feature autocontenida: posee su propio estado (capas remotas y el
   timer de guardado) y recibe del orquestador un `ctx` con getters en vivo
   del estado de la app (markup, sesión, página, usuario) — así no depende
   de variables globales y queda desacoplada.
   ────────────────────────────────────────────────────────────────────── */
import { API_MARKUP } from '../config';
import { getUserColor } from '../core/user-colors';

export interface CollabSyncCtx {
  collab: any;                       // instancia de Collab (WebSocket)
  presence: Map<string, any>;        // mapa de presencia compartido (lo lee el panel de usuarios)
  getMarkup: () => any;
  getSession: () => any;
  getCurrentPage: () => number;
  getUser: () => string;
  getUserId: () => any;
  getRevId: () => any;
  onPresence: () => void;            // refrescar el panel de colaboradores
}

export function createCollabSync(ctx: CollabSyncCtx) {
  // Estado propio de la feature
  const remoteLayers: Record<string, Record<string, string>> = {}; // [page][autor] = json
  let saveTimer: any = null;

  /** Emite la capa propia de la página actual a la sala y la persiste en ORDS. */
  function pushLocalLayer() {
    const markup = ctx.getMarkup();
    if (!markup) return;
    const page = ctx.getCurrentPage(), user = ctx.getUser();
    const json = markup.getLayerJSON(user);
    if (ctx.collab.connected) ctx.collab.sendDelta(page, user, json);
    ctx.getSession().pages[page] = markup.getMarkupJSON();   // persistencia durable
    saveLayerToServer();
  }

  /** Aplica las capas remotas almacenadas para la página indicada. */
  function applyRemoteLayersForPage(page: number) {
    const markup = ctx.getMarkup();
    const layersByAuthor = remoteLayers[page];
    if (!markup || !layersByAuthor) return;
    for (const author in layersByAuthor) markup.applyRemoteLayer(author, layersByAuthor[author]);
  }

  /** Reenvía mis capas a la sala (el relay no guarda estado → para nuevos peers). */
  function resendMyLayers() {
    const markup = ctx.getMarkup();
    if (!markup || !ctx.collab.connected) return;
    const page = ctx.getCurrentPage(), user = ctx.getUser(), session = ctx.getSession();
    ctx.collab.sendDelta(page, user, markup.getLayerJSON(user));
    for (const p in session.pages) {
      if (Number(p) === page) continue;
      const json = session.pages[p];
      if (!json) continue;
      try {
        const mine = JSON.parse(json).filter((o: any) => (o.data?.autor || 'Anónimo') === user);
        if (mine.length) ctx.collab.sendDelta(Number(p), user, JSON.stringify(mine));
      } catch (e) {}
    }
  }

  /** Conecta el visor a la sala del plano y registra los manejadores. */
  function start() {
    const session = ctx.getSession();
    if (session.docId == null) return;   // sala = id_en_repositorio
    ctx.collab.on({
      onPeers: (peers: any[]) => {
        ctx.presence.clear();
        (peers || []).forEach(p => p && p.id && ctx.presence.set(p.id, p));
        ctx.onPresence();
      },
      onPeerJoin: (peer: any) => {
        if (peer && peer.id) ctx.presence.set(peer.id, peer);
        ctx.onPresence();
        resendMyLayers();   // que el recién llegado vea lo ya dibujado
      },
      onPeerLeave: (id: string) => {
        ctx.presence.delete(id);
        const m = ctx.getMarkup(); m && m.removePeerCursor(id);
        ctx.onPresence();
      },
      onDelta: (d: any) => {
        if (d.autor === ctx.getUser()) return;   // ignorar eco
        (remoteLayers[d.page] = remoteLayers[d.page] || {})[d.autor] = d.json;
        const m = ctx.getMarkup();
        if (d.page === ctx.getCurrentPage()) m && m.applyRemoteLayer(d.autor, d.json);
      },
      onCursor: (c: any) => {
        if (c.page !== ctx.getCurrentPage() || c.id == null) return;
        const m = ctx.getMarkup(); m && m.setPeerCursor(c.id, c.x, c.y, c.user, c.color);
      },
    });
    ctx.collab.connect(session.docId, ctx.getUser(), getUserColor(ctx.getUser()));
  }

  /** Limpia el estado de colaboración al cambiar de plano. */
  function reset() {
    for (const k in remoteLayers) delete remoteLayers[k];
    ctx.presence.clear();
    ctx.collab.disconnect();
    const m = ctx.getMarkup(); m && m.clearPeerCursors();
  }

  /** Páginas con SOLO las marcas del usuario actual (capa propia limpia). */
  function ownPages() {
    const session = ctx.getSession(), user = ctx.getUser(), page = ctx.getCurrentPage(), markup = ctx.getMarkup();
    const out: Record<string, string> = {};
    for (const p in session.pages) {
      const json = session.pages[p];
      if (!json) continue;
      try {
        const mine = JSON.parse(json).filter((o: any) => (o.data?.autor || 'Anónimo') === user);
        if (mine.length) out[p] = JSON.stringify(mine);
      } catch (e) {}
    }
    if (markup) {
      const cur = markup.getLayerJSON(user);
      try { if (JSON.parse(cur).length) out[page] = cur; else delete out[page]; } catch (e) {}
    }
    return out;
  }

  /** POST (debounced) de la capa propia → el handler ORDS hace el MERGE. */
  function saveLayerToServer() {
    const session = ctx.getSession();
    if (session.docId == null) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        const sesion = {
          version: 3, docName: session.docName,
          pages: ownPages(), pageHeights: session.pageHeights, scale: session.scale,
        };
        await fetch(API_MARKUP, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', id: String(session.docId) },
          credentials: 'include',
          body: JSON.stringify({
            usuario     : ctx.getUser(),
            usuario_id  : ctx.getUserId(),
            id_revision : ctx.getRevId(),
            sesion,
          }),
        });
      } catch (e: any) { console.warn('[SAF] saveLayerToServer:', e.message); }
    }, 1200);
  }

  /** Carga las capas de todos los usuarios desde ORDS (propias editables, ajenas bloqueadas). */
  async function loadFromServer() {
    const session = ctx.getSession();
    if (session.docId == null) return;
    try {
      const res = await fetch(API_MARKUP, {
        credentials: 'include',
        headers: { id: String(session.docId) },
      });
      if (!res.ok) return;   // 404 = plano sin markups aún
      const data = await res.json();
      const user = ctx.getUser(), userId = ctx.getUserId();
      (data?.capas || []).forEach((capa: any) => {
        const pages = capa?.sesion?.pages || {};
        const mine = (userId != null && String(capa.usuario_id) === String(userId)) || (capa.usuario === user);
        for (const p in pages) {
          if (mine) session.pages[p] = pages[p];
          else (remoteLayers[p] = remoteLayers[p] || {})[capa.usuario] = pages[p];
        }
      });
      const markup = ctx.getMarkup(), page = ctx.getCurrentPage();
      markup && markup.setMarkupJSON(session.pages[page] || null);
      applyRemoteLayersForPage(page);
    } catch (e: any) { console.warn('[SAF] loadRemoteLayersFromServer:', e.message); }
  }

  return { pushLocalLayer, applyRemoteLayersForPage, start, reset, loadFromServer };
}
