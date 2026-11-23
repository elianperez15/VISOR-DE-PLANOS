/* ──────────────────────────────────────────────────────────────────────
   rfi-cloud-stamp.ts — Nube RFI en el lienzo (métodos de MarkupLayer)

   Una nube RFI vinculada lleva un sello "RFI n" encima, queda bloqueada
   (no se mueve, no se redimensiona, no se borra) y se autoguarda sola.
   Los flags de bloqueo no se serializan: se reaplican al cargar.
   ────────────────────────────────────────────────────────────────────── */
import { fabric } from 'fabric';
import type { MarkupLayer } from '../anotaciones/lienzo/markup-layer';

export const rfiCloudMethods = {
  /** Reaplica el bloqueo a las etiquetas RFI tras cargar de JSON (selectable/evented no se serializan). */
  _relockCloudLabels(this: MarkupLayer, objs) {
    (objs || this._markupObjs()).forEach(o => {
      if (o.data?.type === 'cloud-label' && o.data?.locked) {
        o.set({ editable:false, selectable:false, evented:false, hasControls:false, hoverCursor:'default' });
      }
      // Nube RFI: tamaño/posición/rotación bloqueados (los flags no se serializan → se reaplican)
      if (o.data?.type === 'cloud' && o.data?.isRfi) {
        o.set({ lockScalingX:true, lockScalingY:true, lockMovementX:true, lockMovementY:true, lockRotation:true, hasControls:false });
        o.setCoords();
      }
    });
  },

  /** ¿Es una nube RFI ya vinculada? (color rojo + rfiId) → no se puede eliminar. */
  _isLockedRfiCloud(this: MarkupLayer, obj) {
    return !!(obj && obj.data && obj.data.type === 'cloud' && obj.data.isRfi && obj.data.rfiId != null && String(obj.data.rfiId).trim() !== '');
  },

  /** Coloca dentro de la nube RFI el SELLO de RFI (mismo estilo, SIN inclinación).
      Es fijo (no editable/seleccionable) y se enlaza a la nube por cloudId. */
  setRfiCloudStamp(this: MarkupLayer, cloudObj, text) {
    const cloudId = cloudObj?.data?.cloudId;
    if (!cloudId) return;
    const color = cloudObj.stroke || this.strokeColor;
    this._removeCloudLabel(cloudId);           // reemplaza cualquier etiqueta previa
    const center = cloudObj.getCenterPoint();
    const PAD = 10;
    const textObj = new fabric.Text(text, {
      fontSize: 16, fontFamily: 'Arial Black,sans-serif', fontWeight: 'bold',
      fill: color, left: 0, top: 0, selectable: false, evented: false,
    });
    const box = new fabric.Rect({
      left: -PAD, top: -PAD, width: textObj.width + PAD * 2, height: textObj.height + PAD * 2,
      stroke: color, strokeWidth: 2.5, fill: `${color}18`, rx: 5, ry: 5, selectable: false, evented: false,
    });
    const group = new fabric.Group([box, textObj], {
      left: center.x, top: center.y, originX: 'center', originY: 'center',
      angle: 0,                                // SIN inclinación (a diferencia del sello normal)
      selectable: false, evented: false, hasControls: false, hoverCursor: 'default',
    });
    group.data = { type: 'cloud-label', cloudId, locked: true, isRfiStamp: true, autor: this.currentUser };
    // Anclar en la parte superior de la nube
    const pos = this._rfiStampTop(cloudObj, group);
    group.set({ left: pos.left, top: pos.top });
    this._skipSnap = true;
    this.canvas.add(group);
    this._skipSnap = false;
    group.setCoords();
    this.canvas.renderAll();
    this._snapshot();
    this._notifyLocalChange();
  },

  /** Posición (centro del sello) para anclarlo AFUERA de la nube, justo ARRIBA. */
  _rfiStampTop(this: MarkupLayer, cloudObj, stampObj) {
    const c  = cloudObj.getCenterPoint();
    const ch = cloudObj.getScaledHeight ? cloudObj.getScaledHeight() : (cloudObj.height * (cloudObj.scaleY || 1));
    const sh = stampObj.getScaledHeight ? stampObj.getScaledHeight() : (stampObj.height || 0);
    const MARGIN = 10;
    return { left: c.x, top: c.y - ch / 2 - sh / 2 - MARGIN };
  },

  /** Serializa los objetos ligados a un cloudId (la nube + su sello/etiqueta RFI).
      Se usa para autoguardar SOLO esa figura sin arrastrar las demás marcas. */
  getObjectsJSONByCloudId(this: MarkupLayer, cloudId) {
    if (!cloudId) return [];
    return this._markupObjs()
      .filter(o => !o.isThumb && o.data?.cloudId === cloudId)
      .map(o => o.toObject(['data','name']));
  },
};
