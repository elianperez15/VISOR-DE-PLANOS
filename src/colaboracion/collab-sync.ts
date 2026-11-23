/* ──────────────────────────────────────────────────────────────────────
   collab-sync.ts — Colaboración en vivo entre los usuarios de un plano

   Sobre el cliente WebSocket (collab.ts): emite/recibe la capa de cada autor,
   la presencia, los cursores y la escala global. Guarda además las capas de
   los OTROS autores por página (las que llegan en vivo y las que trae
   persistencia/markup-store al abrir), para pintarlas al cambiar de página.

   No persiste nada: la durabilidad es por ORDS (persistencia/markup-store).
   Con VITE_COLLAB_ENABLED=false el cliente no conecta y todo esto es no-op.
   ────────────────────────────────────────────────────────────────────── */
import { getUserColor } from '../usuario/user-colors';
import type { MarkupLayer } from '../anotaciones/lienzo/markup-layer';
import type { PlanSession } from '../plano/plan-viewer';
import type { Collab, Peer } from './collab';

const CURSOR_THROTTLE_MS = 50;   // mínimo entre envíos de cursor

export interface CollabSyncCtx {
  collab: Collab;
  getMarkup(): MarkupLayer | null;
  getSession(): PlanSession;
  getCurrentPage(): number;
  getUser(): string;
  /** Cambió la presencia (refrescar el panel de colaboradores). */
  onPresence(): void;
  /** Otro colaborador calibró la escala global. */
  onScaleReceived(scale: any): void;
}

export function createCollabSync(ctx: CollabSyncCtx) {
  const { collab } = ctx;
  const remoteLayers: Record<string, Record<string, string>> = {};   // [page][autor] = json
  const presence = new Map<string, Peer>();                          // id(socket) → peer
  let lastCursorSentAt = 0;

  /** Guarda la capa de otro autor para la página indicada. */
  function storeRemoteLayer(page: number | string, author: string, json: string) {
    (remoteLayers[page] = remoteLayers[page] || {})[author] = json;
  }

  /** Pinta las capas de los otros autores guardadas para la página. */
  function applyRemoteLayersForPage(page: number) {
    const markup = ctx.getMarkup();
    const layersByAuthor = remoteLayers[page];
    if (!markup || !layersByAuthor) return;
    for (const author in layersByAuthor) markup.applyRemoteLayer(author, layersByAuthor[author]);
  }

  /** Se mostró la página `n`: los cursores son por página y las capas ajenas se repintan. */
  function onPageShown(n: number) {
    ctx.getMarkup()?.clearPeerCursors();
    applyRemoteLayersForPage(n);
  }

  /** Emite la capa propia de la página actual a la sala (sincronización en vivo).
      NO persiste en ORDS: el guardado en servidor ocurre al pulsar Guardar. */
  function pushLocalLayer() {
    const markup = ctx.getMarkup();
    if (!markup) return;
    const page = ctx.getCurrentPage(), user = ctx.getUser();
    const json = markup.getLayerJSON(user);
    if (collab.connected) collab.sendDelta(page, user, json);
    ctx.getSession().pages[page] = markup.getMarkupJSON();   // copia local en memoria
  }

  /** Reenvía mis capas a la sala (el relay no guarda estado → para nuevos peers). */
  function resendMyLayers() {
    const markup = ctx.getMarkup();
    if (!markup || !collab.connected) return;
    const page = ctx.getCurrentPage(), user = ctx.getUser(), session = ctx.getSession();
    collab.sendDelta(page, user, markup.getLayerJSON(user));
    for (const p in session.pages) {
      if (Number(p) === page) continue;
      const json = session.pages[p];
      if (!json) continue;
      try {
        const mine = JSON.parse(json).filter((o: any) => (o.data?.autor || 'Anónimo') === user);
        if (mine.length) collab.sendDelta(Number(p), user, JSON.stringify(mine));
      } catch (e) {}
    }
  }

  /** Conecta el visor a la sala del plano (sala = id_en_repositorio). */
  function start() {
    const session = ctx.getSession();
    if (session.docId == null) return;
    collab.on({
      onPeers: peers => {
        presence.clear();
        (peers || []).forEach(p => p && p.id && presence.set(p.id, p));
        ctx.onPresence();
      },
      onPeerJoin: peer => {
        if (peer && peer.id) presence.set(peer.id, peer);
        ctx.onPresence();
        resendMyLayers();   // que el recién llegado vea lo ya dibujado
        const scale = ctx.getSession().scale;   // y la escala vigente (aunque no esté guardada)
        if (scale) collab.sendScale(scale);
      },
      onPeerLeave: id => {
        presence.delete(id);
        ctx.getMarkup()?.removePeerCursor(id);
        ctx.onPresence();
      },
      onDelta: d => {
        if (d.autor === ctx.getUser()) return;   // ignorar eco
        storeRemoteLayer(d.page, d.autor, d.json);
        if (d.page === ctx.getCurrentPage()) ctx.getMarkup()?.applyRemoteLayer(d.autor, d.json);
      },
      onCursor: c => {
        if (c.page !== ctx.getCurrentPage() || c.id == null) return;
        ctx.getMarkup()?.setPeerCursor(c.id, c.x, c.y, c.user, c.color);
      },
      onScale: scale => {
        ctx.getSession().scale = scale;
        ctx.onScaleReceived(scale);
      },
    });
    collab.connect(session.docId, ctx.getUser(), getUserColor(ctx.getUser()));
  }

  /** Envía la posición del cursor (coordenadas lógicas, con throttle) mientras se mueve. */
  function trackCursor(markup: MarkupLayer) {
    markup.canvas.on('mouse:move', (opt: any) => {
      if (!collab.connected) return;
      const now = Date.now();
      if (now - lastCursorSentAt < CURSOR_THROTTLE_MS) return;
      lastCursorSentAt = now;
      const p = markup.scenePointFromEvent(opt.e);
      collab.sendCursor(ctx.getCurrentPage(), Math.round(p.x), Math.round(p.y));
    });
  }

  /** Cambió el nombre del usuario: re-anunciarse en la sala con la identidad correcta. */
  function reannounce(user: string) {
    const docId = ctx.getSession().docId;
    if (collab.connected && docId != null) collab.connect(docId, user, getUserColor(user));
  }

  /** Difunde la escala calibrada a toda la sala y la deja en la sesión. */
  function broadcastScale(scale: any) {
    ctx.getSession().scale = scale;
    collab.sendScale(scale);
  }

  /** Sale de la sala y olvida las capas ajenas al cambiar de plano. */
  function reset() {
    for (const k in remoteLayers) delete remoteLayers[k];
    presence.clear();
    collab.disconnect();
    ctx.getMarkup()?.clearPeerCursors();
  }

  return {
    presence,
    start, reset, reannounce, trackCursor, pushLocalLayer, broadcastScale,
    storeRemoteLayer, applyRemoteLayersForPage, onPageShown,
  };
}

export type CollabSync = ReturnType<typeof createCollabSync>;
