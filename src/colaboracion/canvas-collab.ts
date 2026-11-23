/* ──────────────────────────────────────────────────────────────────────
   canvas-collab.ts — Capas de otros autores y cursores remotos en el lienzo
   (métodos de MarkupLayer)

   Cada usuario es dueño de SUS objetos. Se sincroniza la capa completa de un
   autor (no objeto por objeto): reusa la misma serialización que el guardado
   y maneja etiquetas, miniaturas y nubes sin lógica extra.
   ────────────────────────────────────────────────────────────────────── */
import { fabric } from 'fabric';
import type { MarkupLayer } from '../anotaciones/lienzo/markup-layer';

export const canvasCollabMethods = {
  /** Serializa SOLO los objetos del autor indicado (su capa de la página). */
  getLayerJSON(this: MarkupLayer, autor) {
    return JSON.stringify(
      this._markupObjs()
        .filter(o => !o.isThumb && (o.data?.autor || 'Anónimo') === autor)
        .map(o => o.toObject(['data','name']))
    );
  },

  /**
   * Reemplaza la capa de un autor REMOTO con la versión recibida.
   * Los objetos ajenos quedan bloqueados (cada quien dueño de lo suyo).
   * No dispara snapshots ni re-emite (flag _applyingRemote).
   */
  applyRemoteLayer(this: MarkupLayer, autor, json) {
    if (!autor || autor === this.currentUser) return;   // nunca pisar lo propio
    this._applyingRemote = true;
    this._skipSnap = true;

    // 1) Quitar los objetos actuales de ese autor (y sus labels/thumbs)
    this._markupObjs()
      .filter(o => (o.data?.autor || 'Anónimo') === autor)
      .forEach(o => {
        if (o.data?.labelId) { this._removeLabel(o.data.labelId); this._removeThumb(o.data.labelId); }
        this.canvas.remove(o);
      });

    // 2) Pintar la capa recibida (bloqueada para el usuario local)
    const objects = json ? JSON.parse(json) : [];
    const finish = () => {
      this._applyAuthorVisibility();   // respetar el filtro de autores ocultos
      this._skipSnap = false;
      this._applyingRemote = false;
      this._keepCursorsOnTop();
      this.canvas.renderAll();
    };
    if (!objects.length) { finish(); return; }

    fabric.util.enlivenObjects(objects, enlivened => {
      enlivened.forEach(o => {
        // Se puede SELECCIONAR (para ver sus propiedades) pero NO editar/mover:
        // cada usuario es dueño de sus objetos.
        o.selectable   = true;
        o.evented      = true;       // recibe hover → tooltip con autor y hora
        o.hoverCursor  = 'help';
        o.lockMovementX = o.lockMovementY = true;
        o.lockScalingX  = o.lockScalingY  = true;
        o.lockRotation  = true;
        o.hasControls   = false;     // sin manijas de redimensión/rotación
        o.editable      = false;     // IText/etiquetas no editables
        if (o.data) o.data.remoto = true;   // marca de objeto ajeno (no borrable)
        this.canvas.add(o);
      });
      enlivened.forEach(o => { if (this._firstImageAttachment(o)) this.refreshThumb(o); });
      this._relockCloudLabels(enlivened);   // etiquetas RFI: fijas también en capas ajenas
      finish();
    });
  },

  /** Crea/actualiza el cursor de un peer en coordenadas LÓGICAS del plano. */
  setPeerCursor(this: MarkupLayer, id, x, y, user, color) {
    let cursor = this._peerCursors.get(id);
    if (!cursor) {
      const triangle = new fabric.Triangle({
        width: 12, height: 16, fill: color || '#3b82f6',
        left: 0, top: 0, angle: -35, originX: 'left', originY: 'top',
        stroke: '#fff', strokeWidth: 1,
      });
      const nameTag = new fabric.Text(` ${user || ''} `, {
        fontSize: 12, fill: '#fff', backgroundColor: color || '#3b82f6',
        left: 10, top: 14, originX: 'left', originY: 'top', fontFamily: 'sans-serif',
      });
      cursor = new fabric.Group([triangle, nameTag], {
        selectable: false, evented: false, hoverCursor: 'default',
        originX: 'left', originY: 'top',
      });
      cursor.isCursor = true;
      this._peerCursors.set(id, cursor);
      this.canvas.add(cursor);
    }
    cursor.set({ left: x, top: y });
    // Tamaño constante en pantalla, independiente del zoom
    const zoom = this.canvas.getZoom() || 1;
    cursor.scaleX = cursor.scaleY = 1 / zoom;
    cursor.setCoords();
    this._keepCursorsOnTop();
    this.canvas.requestRenderAll();
  },

  /** Elimina el cursor de un peer (salió de la sala). */
  removePeerCursor(this: MarkupLayer, id) {
    const cursor = this._peerCursors.get(id);
    if (cursor) { this.canvas.remove(cursor); this._peerCursors.delete(id); this.canvas.requestRenderAll(); }
  },

  /** Quita todos los cursores (cambio de plano / desconexión). */
  clearPeerCursors(this: MarkupLayer) {
    this._peerCursors.forEach(cursor => this.canvas.remove(cursor));
    this._peerCursors.clear();
    this.canvas.requestRenderAll();
  },

  _keepCursorsOnTop(this: MarkupLayer) {
    this._peerCursors.forEach(cursor => cursor.bringToFront && cursor.bringToFront());
  },
};
