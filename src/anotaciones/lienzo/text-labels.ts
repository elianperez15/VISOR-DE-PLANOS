/* ──────────────────────────────────────────────────────────────────────
   text-labels.ts — Texto de las figuras (métodos de MarkupLayer)

     · Texto / nota / globo: su propio texto, ajustado al recuadro.
     · Resto de figuras: una etiqueta (Textbox) enlazada por labelId, que se
       envuelve al ancho de la figura y se recorta con "…" si no cabe.
   ────────────────────────────────────────────────────────────────────── */
import { fabric } from 'fabric';
import type { MarkupLayer } from './markup-layer';

export const textLabelMethods = {
  /** ¿La figura admite etiqueta de texto? (excluye textos, notas, callouts, fondos) */
  _isLabelable(this: MarkupLayer, obj) {
    const type = obj?.data?.type;
    return ['rect','ellipse','arrow','highlight','measure','area','perimeter','angle'].includes(type);
  },

  /** Busca la IText enlazada a una figura por su labelId */
  _findLabel(this: MarkupLayer, labelId) {
    return this.canvas.getObjects().find(
      o => o.data?.type === 'shape-label' && o.data?.labelId === labelId
    );
  },

  /** Texto actual de la etiqueta de una figura ('' si no tiene) */
  getLabelText(this: MarkupLayer, obj) {
    const labelObj = obj?.data?.labelId ? this._findLabel(obj.data.labelId) : null;
    return labelObj ? labelObj.text : '';
  },

  /** Devuelve el objeto de texto (IText/Textbox) de una figura o grupo (o null). */
  _figureTextObj(this: MarkupLayer, obj) {
    if (!obj) return null;
    const isT = o => o && (o.type === 'i-text' || o.type === 'text' || o.type === 'textbox');
    if (isT(obj)) return obj;
    if (obj.getObjects) return obj.getObjects().find(isT) || null;
    return null;
  },

  /** Ajusta el texto de una nota/globo a su recuadro: lo envuelve al ANCHO y, si
      no cabe en ALTO, lo recorta con "…". El texto completo vive en data._fullText. */
  _fitFigureText(this: MarkupLayer, figure) {
    if (!figure || !figure._objects) return;
    const t = figure.data?.type;
    if (t !== 'note' && t !== 'callout') return;
    const rect = figure._objects.find(o => o.type === 'rect');
    const txt  = this._figureTextObj(figure);
    if (!rect || !txt || typeof txt.initDimensions !== 'function') return;

    const PAD  = txt._pad || Math.round((txt.fontSize || 16) * 0.6);
    const maxW = Math.max(12, rect.width  - PAD * 2);
    const maxH = Math.max(txt.fontSize || 16, rect.height - PAD * 2);
    const full = (figure.data._fullText != null) ? figure.data._fullText : (txt.text || '');
    figure.data._fullText = full;

    if (txt.type === 'textbox') txt.set('width', maxW);   // envuelve al ancho del recuadro
    txt.set('text', full);
    txt.initDimensions();

    // Si sobrepasa el alto, recortar con "…" (búsqueda binaria)
    if (txt.height > maxH && full.length) {
      let lo = 0, hi = full.length, best = '…';
      while (lo <= hi) {
        const mid  = (lo + hi) >> 1;
        const cand = full.slice(0, mid).replace(/\s+$/, '') + '…';
        txt.set('text', cand);
        txt.initDimensions();
        if (txt.height <= maxH) { best = cand; lo = mid + 1; } else hi = mid - 1;
      }
      txt.set('text', best);
      txt.initDimensions();
    }
    txt.dirty = true;
    figure.dirty = true;
    this.canvas.renderAll();
  },

  /** Texto que se MUESTRA en la figura: para texto/nota/globo es su propio texto;
      para el resto, la etiqueta separada (comportamiento clásico). */
  getAnnotText(this: MarkupLayer, obj) {
    const t = obj?.data?.type;
    if (t === 'note' || t === 'callout')
      return (obj.data._fullText != null) ? obj.data._fullText : ((this._figureTextObj(obj)?.text) || '');
    if (t === 'text') { const tx = this._figureTextObj(obj); return tx ? (tx.text || '') : ''; }
    return this.getLabelText(obj);
  },

  /** Edita el texto propio de la figura (texto/nota/globo); para el resto usa etiqueta. */
  setAnnotText(this: MarkupLayer, obj, text) {
    const t = obj?.data?.type;
    if (t === 'note' || t === 'callout') {
      if (!obj.data) obj.data = {};
      obj.data._fullText = text || '';
      this._fitFigureText(obj);        // envuelve + recorta al recuadro
      this._snapshot();
      this._notifyLocalChange && this._notifyLocalChange();
      return;
    }
    if (t === 'text') {
      const tx = this._figureTextObj(obj);
      if (!tx) return;
      tx.set('text', text || '');
      tx.dirty = true; obj.dirty = true; obj.setCoords && obj.setCoords();
      this.canvas.renderAll();
      this._snapshot();
      this._notifyLocalChange && this._notifyLocalChange();
      return;
    }
    this.setLabelText(obj, text);
  },

  /** Crea/actualiza/elimina la etiqueta de texto de una figura (desde el panel) */
  setLabelText(this: MarkupLayer, obj, text) {
    if (!obj) return;
    text = (text || '').trim();
    if (!obj.data) obj.data = {};
    if (!obj.data.labelId) obj.data.labelId = `lbl-${Date.now().toString(36)}`;
    let labelObj = this._findLabel(obj.data.labelId);

    if (!text) {
      if (labelObj) { this.canvas.remove(labelObj); this.canvas.renderAll(); this._notifyLocalChange(); }
      return;
    }

    if (!labelObj) {
      labelObj = this._makeLabel(obj);
      this._skipSnap = true; this.canvas.add(labelObj); this._skipSnap = false;
    }
    if (labelObj.data) labelObj.data._fullText = text;   // guardar el texto completo
    this._syncLabel(obj);                                 // envuelve + recorta a la figura
    this.canvas.renderAll();
    this._notifyLocalChange();   // sincronizar la etiqueta/título en tiempo real
  },

  /** Construye la Textbox centrada en la figura (se envuelve a su ancho) */
  _makeLabel(this: MarkupLayer, obj) {
    const center = obj.getCenterPoint();
    const PAD = 8;
    const w = Math.max(24, (obj.getScaledWidth ? obj.getScaledWidth() : (obj.width || 120)) - PAD * 2);
    const labelObj = new fabric.Textbox('', {
      left: center.x, top: center.y, originX:'center', originY:'center',
      width: w, fontSize: 16, fontFamily:'Arial', fill: obj.stroke || this.strokeColor,
      textAlign:'center', editable:true, selectable:true, splitByGrapheme:true,
    });
    labelObj.data = {
      type:'shape-label', labelId: obj.data.labelId, _fullText: '',
      autor:this.currentUser, fecha:new Date().toISOString(),
    };
    this._bindLabelExit(labelObj);
    return labelObj;
  },

  _bindLabelExit(this: MarkupLayer, labelObj) {
    if (labelObj._exitHandlerBound) return;
    labelObj._exitHandlerBound = true;
    labelObj.on('editing:exited', () => {
      const raw = labelObj.text || '';
      if (!raw.trim()) { this.canvas.remove(labelObj); this.canvas.renderAll(); this._notifyLocalChange(); return; }
      if (labelObj.data) labelObj.data._fullText = raw;    // el texto tecleado es el completo
      const shape = this._shapeOfLabel(labelObj);
      if (shape) this._syncLabel(shape);                    // envolver + recortar a la figura
      this.canvas.renderAll();
      this._snapshot();
      this._notifyLocalChange();
    });
    // Mientras se escribe (doble clic in-situ) → sincronizar en tiempo real
    labelObj.on('changed', () => this._notifyLocalChange());
  },

  /** Localiza la figura dueña de una etiqueta por su labelId. */
  _shapeOfLabel(this: MarkupLayer, labelObj) {
    const id = labelObj?.data?.labelId;
    if (!id) return null;
    return this.canvas.getObjects().find(o => o.data?.labelId === id && o.data?.type !== 'shape-label') || null;
  },

  /** Doble-clic: edita la etiqueta in-situ (mostrando el texto completo) */
  _editLabel(this: MarkupLayer, obj) {
    if (!obj.data) obj.data = {};
    if (!obj.data.labelId) obj.data.labelId = `lbl-${Date.now().toString(36)}`;
    let labelObj = this._findLabel(obj.data.labelId);
    if (!labelObj) {
      labelObj = this._makeLabel(obj);
      this._skipSnap = true; this.canvas.add(labelObj); this._skipSnap = false;
    } else {
      this._bindLabelExit(labelObj);
      // Editar el texto COMPLETO (no la versión recortada con "…")
      if (labelObj.data && labelObj.data._fullText != null) {
        labelObj.set({ width: Math.max(24, (obj.getScaledWidth ? obj.getScaledWidth() : (obj.width || 120)) - 16), text: labelObj.data._fullText });
        labelObj.initDimensions && labelObj.initDimensions();
        const c = obj.getCenterPoint(); labelObj.set({ left: c.x, top: c.y }); labelObj.setCoords();
      }
    }
    this.canvas.setActiveObject(labelObj);
    labelObj.enterEditing();
    labelObj.selectAll();
    this.canvas.renderAll();
  },

  /** Ajusta la etiqueta al tamaño de su figura y la centra (envuelve + recorta con "…"). */
  _syncLabel(this: MarkupLayer, obj) {
    const labelObj = obj?.data?.labelId ? this._findLabel(obj.data.labelId) : null;
    if (!labelObj) return;
    if (labelObj.type === 'textbox' && typeof labelObj.initDimensions === 'function') {
      const PAD  = Math.round((labelObj.fontSize || 16) * 0.5);
      const sw   = obj.getScaledWidth  ? obj.getScaledWidth()  : (obj.width  || 120);
      const sh   = obj.getScaledHeight ? obj.getScaledHeight() : (obj.height || 60);
      const maxW = Math.max(16, sw - PAD * 2);
      const maxH = Math.max(labelObj.fontSize || 16, sh - PAD * 2);
      const full = (labelObj.data && labelObj.data._fullText != null) ? labelObj.data._fullText : (labelObj.text || '');
      if (labelObj.data) labelObj.data._fullText = full;
      // Solo re-envolver/recortar si cambió el tamaño de la figura o el texto (no al mover)
      if (labelObj._fitW !== maxW || labelObj._fitH !== maxH || labelObj._fitText !== full) {
        labelObj._fitW = maxW; labelObj._fitH = maxH; labelObj._fitText = full;
        labelObj.set({ width: maxW, text: full });
        labelObj.initDimensions();
        if (labelObj.height > maxH && full.length) {        // recortar al alto con "…"
          let lo = 0, hi = full.length, best = '…';
          while (lo <= hi) {
            const mid  = (lo + hi) >> 1;
            const cand = full.slice(0, mid).replace(/\s+$/, '') + '…';
            labelObj.set('text', cand);
            labelObj.initDimensions();
            if (labelObj.height <= maxH) { best = cand; lo = mid + 1; } else hi = mid - 1;
          }
          labelObj.set('text', best);
          labelObj.initDimensions();
        }
        labelObj.dirty = true;
      }
    }
    const center = obj.getCenterPoint();
    labelObj.set({ left: center.x, top: center.y });
    labelObj.setCoords();
  },

  _removeLabel(this: MarkupLayer, labelId) {
    const labelObj = this._findLabel(labelId);
    if (labelObj) this.canvas.remove(labelObj);
  },
};
