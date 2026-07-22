/* ──────────────────────────────────────────────────────────────────────
   collab.ts — Cliente de colaboración en tiempo real (WebSocket NATIVO)

   Sin dependencias npm: usa el WebSocket del navegador. Abre la conexión,
   entra a la sala del plano (= id_en_repositorio) y expone callbacks. El
   visor (main.ts) decide qué hacer con cada evento. No persiste nada — la
   durabilidad es por ORDS.
   ────────────────────────────────────────────────────────────────────── */
import { COLLAB_URL, COLLAB_PATH } from '../config';

export type Peer = { id: string; user: string; color: string };

/** Capa de un autor (toda su anotación de una página). */
export type LayerDelta = {
  doc: string | number;
  page: number;
  autor: string;
  json: string;          // getLayerJSON(autor) serializado
};

export type CursorMsg = {
  id?: string;           // socket id del peer (lo rellena el servidor al reenviar)
  user?: string;
  color?: string;
  doc: string | number;
  page: number;
  x: number;             // coordenadas LÓGICAS del plano (puntos PDF)
  y: number;
};

type Callbacks = {
  onConnect?:    () => void;
  onDisconnect?: () => void;
  onPeers?:      (peers: Peer[]) => void;   // al entrar: quiénes ya están
  onPeerJoin?:   (peer: Peer) => void;
  onPeerLeave?:  (id: string) => void;
  onDelta?:      (delta: LayerDelta) => void;
  onCursor?:     (cursor: CursorMsg) => void;
  onScale?:      (scale: any) => void;   // escala calibrada global
};

export class Collab {
  private ws: WebSocket | null = null;
  private doc: string | number | null = null;
  private user = 'Anónimo';
  private color = '#64748b';
  private cb: Callbacks = {};
  private _wantOpen = false;
  private _retries = 0;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  /** Registra los manejadores de eventos (antes de connect). */
  on(callbacks: Callbacks): void {
    this.cb = { ...this.cb, ...callbacks };
  }

  get connected(): boolean { return this.ws?.readyState === WebSocket.OPEN; }

  /** Abre la conexión y entra a la sala del plano. */
  connect(doc: string | number, user: string, color: string): void {
    if (doc == null) return;
    this.user = user || 'Anónimo';
    this.color = color || '#64748b';

    if (this.ws && this.doc !== doc) this.disconnect();   // cambio de plano
    this.doc = doc;
    this._wantOpen = true;

    if (!this.ws) this._open();
    else if (this.connected) this._join();
  }

  /** ws://host/rt/ws  (o wss:// si el visor va por HTTPS) — derivado del origen. */
  private _wsUrl(): string {
    const base = COLLAB_URL.replace(/^http/, 'ws').replace(/\/+$/, '');
    return base + COLLAB_PATH;
  }

  private _open(): void {
    let ws: WebSocket;
    try { ws = new WebSocket(this._wsUrl()); }
    catch { this._scheduleReconnect(); return; }
    this.ws = ws;

    ws.onopen = () => { this._retries = 0; this._join(); this.cb.onConnect?.(); };
    ws.onmessage = ev => {
      let message: any; try { message = JSON.parse(ev.data); } catch { return; }
      this._dispatch(message);
    };
    ws.onclose = () => {
      this.cb.onDisconnect?.();
      this.ws = null;
      if (this._wantOpen) this._scheduleReconnect();
    };
    ws.onerror = () => { try { ws.close(); } catch {} };
  }

  private _scheduleReconnect(): void {
    if (this._reconnectTimer) return;
    const delay = Math.min(1000 * 2 ** this._retries, 8000);   // backoff hasta 8s
    this._retries++;
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      if (this._wantOpen) this._open();
    }, delay);
  }

  private _send(obj: any): void {
    if (this.connected) this.ws!.send(JSON.stringify(obj));
  }

  private _join(): void {
    this._send({ t: 'join', doc: this.doc, user: this.user, color: this.color });
  }

  /** Reenvía la capa propia (de una página) al resto de la sala. */
  sendDelta(page: number, autor: string, json: string): void {
    if (this.doc == null) return;
    this._send({ t: 'delta', doc: this.doc, page, autor, json });
  }

  /** Envía la posición del cursor (coordenadas lógicas del plano). */
  sendCursor(page: number, x: number, y: number): void {
    if (this.doc == null) return;
    this._send({ t: 'cursor', doc: this.doc, page, x, y });
  }

  /** Difunde la escala calibrada a toda la sala (global). */
  sendScale(scale: any): void {
    if (this.doc == null) return;
    this._send({ t: 'scale', doc: this.doc, scale });
  }

  private _dispatch(message: any): void {
    switch (message.t) {
      case 'peers':      this.cb.onPeers?.(message.peers || []); break;
      case 'peer-join':  this.cb.onPeerJoin?.(message.peer); break;
      case 'peer-leave': this.cb.onPeerLeave?.(message.id); break;
      case 'delta':      this.cb.onDelta?.(message as LayerDelta); break;
      case 'cursor':     this.cb.onCursor?.(message as CursorMsg); break;
      case 'scale':      this.cb.onScale?.(message.scale); break;
    }
  }

  disconnect(): void {
    this._wantOpen = false;
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
    if (this.ws) {
      this.ws.onclose = null;          // no reconectar al cerrar a propósito
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
    this.doc = null;
    this._retries = 0;
  }
}
