/* ──────────────────────────────────────────────────────────────────────
   attachment-thumbs.ts — Miniatura del adjunto junto a la figura (métodos de MarkupLayer)

   Previa de la imagen principal, fijada a la esquina de la figura y
   redimensionable. No se serializa: se regenera desde data.adjuntos.
   ────────────────────────────────────────────────────────────────────── */
import { fabric } from 'fabric';
import type { MarkupLayer } from './markup-layer';

export const attachmentThumbMethods = {
  /** Devuelve la imagen PRINCIPAL de una figura (data.principal), o la primera. */
  _firstImageAttachment(this: MarkupLayer, obj) {
    const list = obj?.data?.adjuntos || [];
    const p = obj?.data?.principal;
    if (p != null && list[p] && (list[p].type || '').startsWith('image/')) return list[p];
    return list.find(a => (a.type || '').startsWith('image/')) || null;
  },

  _findThumb(this: MarkupLayer, linkId) {
    return this.canvas.getObjects().find(
      o => o.data?.type === 'att-thumb' && o.data?.linkId === linkId
    );
  },

  _removeThumb(this: MarkupLayer, linkId) {
    const thumb = this._findThumb(linkId);
    if (thumb) this.canvas.remove(thumb);
  },

  /** Crea/actualiza/elimina la miniatura según los adjuntos de la figura */
  refreshThumb(this: MarkupLayer, obj) {
    if (!obj) return;
    if (!obj.data) obj.data = {};
    if (!obj.data.labelId) obj.data.labelId = `lbl-${Date.now().toString(36)}`;
    const linkId = obj.data.labelId;
    const att = this._firstImageAttachment(obj);
    const existing = this._findThumb(linkId);
    const show = !!att && obj.data.attShown !== false;   // visible por defecto
    const targetW = obj.data.thumbW || 120;              // ancho objetivo (px lógicos)

    if (!show) { if (existing) { this.canvas.remove(existing); this.canvas.renderAll(); } return; }

    // Si ya existe con la misma imagen: aplicar tamaño (ancho/alto) y reposicionar
    if (existing && existing.data.src === att.dataUrl) {
      const ow = existing._origW || existing.width || targetW;
      const oh = existing._origH || existing.height || targetW;
      const targetH = obj.data.thumbH || targetW * (oh / ow);   // alto: guardado o proporcional
      const sx = targetW / ow, sy = targetH / oh;
      existing.set({ scaleX: sx, scaleY: sy, strokeWidth: 2 / Math.min(sx, sy) });
      this._syncThumb(obj);
      this.canvas.renderAll();
      return;
    }
    if (existing) this.canvas.remove(existing);

    fabric.Image.fromURL(att.dataUrl, img => {
      const ow = img.width || targetW, oh = img.height || targetW;
      const targetH = obj.data.thumbH || targetW * (oh / ow);
      const sx = targetW / ow, sy = targetH / oh;
      img.set({
        scaleX: sx, scaleY: sy,
        originX:'left', originY:'top',
        // Interactiva: se puede seleccionar y REDIMENSIONAR en el plano
        selectable:true, evented:true,
        hasControls:true, hasBorders:true,
        lockRotation:true, lockMovementX:true, lockMovementY:true,  // pegada a la figura
        hoverCursor:'pointer',
        cornerColor:'#0ea5e9', cornerStrokeColor:'#fff', transparentCorners:false,
        cornerSize:12, borderColor:'#0ea5e9',
        stroke:'#0ea5e9', strokeWidth: 2 / Math.min(sx, sy),  // borde visible ~2px reales
      });
      // Manijas que mantienen fija la esquina superior-izquierda (pegada a la figura):
      //  ▸ derecha (mr)  = ancho   ·  abajo (mb) = alto   ·  esquina ↘ (br) = ambas
      img.setControlsVisibility && img.setControlsVisibility({
        tl:false, tr:false, bl:false, br:true, ml:false, mr:true, mt:false, mb:true, mtr:false,
      });
      img.data = { type:'att-thumb', linkId, src: att.dataUrl };
      img._origW = ow;                        // dimensiones naturales, para reescalar luego
      img._origH = oh;
      img.isThumb = true;                     // excluida del guardado
      img.on('scaling', () => this._onThumbResize(img, false));
      img.on('modified', () => this._onThumbResize(img, true));
      this._skipSnap = true;
      this.canvas.add(img);
      this._skipSnap = false;
      this._syncThumb(obj);
      this.canvas.renderAll();
    });
  },

  /** Al redimensionar la miniatura en el plano: persistir ancho y alto en la figura. */
  _onThumbResize(this: MarkupLayer, thumb, persist) {
    const linkId = thumb?.data?.linkId;
    const figure = linkId ? this.canvas.getObjects().find(o => !o.isThumb && o.data?.labelId === linkId) : null;
    if (!figure || !figure.data) return;
    const w = Math.max(40, Math.min(800, Math.round(thumb.getScaledWidth())));
    const h = Math.max(40, Math.min(800, Math.round(thumb.getScaledHeight())));
    figure.data.thumbW = w;
    figure.data.thumbH = h;
    thumb.set('strokeWidth', 2 / Math.min(thumb.scaleX || 1, thumb.scaleY || 1));  // borde ~2px reales
    if (persist) this._notifyLocalChange && this._notifyLocalChange();
  },

  /** Coloca la miniatura junto a la esquina superior derecha de la figura */
  _syncThumb(this: MarkupLayer, obj) {
    const THUMB_GAP = 6;   // separación px entre la figura y la miniatura
    const linkId = obj?.data?.labelId;
    const thumb = linkId ? this._findThumb(linkId) : null;
    if (!thumb) return;
    obj.setCoords();
    const topRight = obj.aCoords && obj.aCoords.tr ? obj.aCoords.tr : obj.getCenterPoint();
    thumb.set({ left: topRight.x + THUMB_GAP, top: topRight.y });
    thumb.setCoords();
    this.canvas.bringToFront(thumb);
  },
};
