/* ──────────────────────────────────────────────────────────────────────
   clouds.ts — Nubes de revisión (métodos de MarkupLayer)

   Dos formas de dibujarlas (dos puntos o múltiples puntos), con el MISMO
   festón para que el trazo se vea idéntico. Doble clic → texto de la nube.
   ────────────────────────────────────────────────────────────────────── */
import { fabric } from 'fabric';
import type { MarkupLayer } from './markup-layer';

// Separación entre festones, en px lógicos. La MISMA para los dos modos (dos
// puntos y múltiples puntos), para que el trazo se vea idéntico sin importar
// cómo se dibujó la nube ni de qué tamaño sea.
const SCALLOP_SPACING = 18;

export const cloudMethods = {
  /* ── Nube de revisión ───────────────────────────────────────────────── */
  _addCloud(this: MarkupLayer, pts) {
    const closed = [...pts, pts[0]];
    let pathData = `M ${pts[0].x} ${pts[0].y}`;
    for (let i=0;i<closed.length-1;i++) {
      const from=closed[i], to=closed[i+1];
      const dx=to.x-from.x, dy=to.y-from.y;
      const len=Math.sqrt(dx*dx+dy*dy), scallopCount=Math.max(2,Math.round(len/SCALLOP_SPACING)), radius=len/scallopCount/2;
      for (let j=1;j<=scallopCount;j++){
        const fraction=j/scallopCount;
        pathData+=` A ${radius.toFixed(1)} ${radius.toFixed(1)} 0 0 1 ${(from.x+dx*fraction).toFixed(1)} ${(from.y+dy*fraction).toFixed(1)}`;
      }
    }
    const obj = new fabric.Path(pathData+' Z',{
      stroke:this.strokeColor, strokeWidth:this.strokeWidth, fill:this.fillColor,
      strokeLineJoin:'round', strokeLineCap:'round',
    });
    obj.data = { type:'cloud', points: pts, cloudId: `cld-${Date.now().toString(36)}` };
    this._place(obj);
    this.onCloudCreated && this.onCloudCreated(obj);
  },

  /* ── Nube natural (drag o clic simple) ─────────────────────────────── */
  _addCloudFromRect(this: MarkupLayer, x1, y1, x2, y2) {
    const left = Math.min(x1,x2), top = Math.min(y1,y2);
    const width = Math.abs(x2-x1), height = Math.abs(y2-y1);

    const cloudPath = this._revisionCloudPath(left, top, width, height);
    const obj = new fabric.Path(cloudPath, {
      stroke         : this.strokeColor,
      strokeWidth    : this.strokeWidth,
      fill           : this.fillColor,
      strokeLineJoin : 'round',
      strokeLineCap  : 'round',
    });
    const cloudId = `cld-${Date.now().toString(36)}`;
    obj.data = { type: 'cloud', cloudId };
    this._place(obj);
    this.onCloudCreated && this.onCloudCreated(obj);

    // Auto-volver a selección para poder moverla de inmediato
    if (this.onAutoSelect) {
      requestAnimationFrame(() => {
        this.setTool('select');
        this.onAutoSelect();
      });
    }
  },

  /* ── Path de nube natural con curvas Bézier ─────────────────────────── */
  /**
   * Nube de revisión estilo Procore/Bluebeam: festones (arcos) uniformes
   * recorriendo el perímetro del rectángulo, todos bombeados hacia afuera.
   *
   * El festón mide lo mismo que en la nube de múltiples puntos (_addCloud):
   * SCALLOP_SPACING px por festón, con el radio ajustado para que encaje exacto
   * en cada lado. Antes el radio era proporcional al tamaño (hasta 20 px), por
   * lo que una nube grande arrastrada tenía un trazo más grueso que la de puntos.
   */
  _revisionCloudPath(this: MarkupLayer, left, top, width, height) {
    const corners = [
      [left,         top         ],   // sup-izq
      [left + width, top         ],   // sup-der
      [left + width, top + height],   // inf-der
      [left,         top + height],   // inf-izq   (sentido horario, y hacia abajo)
    ];
    let pathData = `M ${left.toFixed(1)} ${top.toFixed(1)} `;
    for (let i = 0; i < 4; i++) {
      const [x1, y1] = corners[i];
      const [x2, y2] = corners[(i + 1) % 4];
      const len = Math.hypot(x2 - x1, y2 - y1);
      const scallopCount = Math.max(2, Math.round(len / SCALLOP_SPACING));   // nº de festones en este lado
      const radius       = (len / scallopCount) / 2;                          // radio que encaja exacto
      const unitX = (x2 - x1) / len, unitY = (y2 - y1) / len;
      for (let k = 1; k <= scallopCount; k++) {
        const px = x1 + unitX * (len * k / scallopCount);
        const py = y1 + unitY * (len * k / scallopCount);
        // sweep=1 → el arco bomba hacia afuera al recorrer en sentido horario
        pathData += `A ${radius.toFixed(1)} ${radius.toFixed(1)} 0 0 1 ${px.toFixed(1)} ${py.toFixed(1)} `;
      }
    }
    return pathData + 'Z';
  },

  /* ── Texto de nube (doble-clic) ─────────────────────────────────────── */
  _editCloudLabel(this: MarkupLayer, cloudObj) {
    const cloudId = cloudObj.data?.cloudId;
    if (!cloudId) return;

    // Buscar etiqueta existente
    let labelObj = this.canvas.getObjects().find(
      o => o.data?.type === 'cloud-label' && o.data?.cloudId === cloudId
    );

    const center = cloudObj.getCenterPoint();

    if (!labelObj) {
      // Tamaño de fuente proporcional al tamaño de la nube
      const FONT_SIZE_RATIO = 0.14;
      const FONT_SIZE_BASE  = 10;
      // Crear IText centrado en la nube
      labelObj = new fabric.IText('', {
        left      : center.x,
        top       : center.y,
        originX   : 'center',
        originY   : 'center',
        fontSize  : Math.round(Math.min(cloudObj.width, cloudObj.height) * FONT_SIZE_RATIO + FONT_SIZE_BASE),
        fontFamily: 'Arial',
        fill      : cloudObj.stroke || this.strokeColor,
        editable  : true,
        textAlign : 'center',
        selectable: true,
      });
      labelObj.data = {
        type    : 'cloud-label',
        cloudId : cloudId,
        autor   : this.currentUser,
        fecha   : new Date().toISOString(),
      };
      this._skipSnap = true;
      this.canvas.add(labelObj);
      this._skipSnap = false;

      // Al salir del modo edición: si está vacío, eliminar
      // (bandera para no agregar el listener más de una vez)
      labelObj._exitHandlerBound = true;
      labelObj.on('editing:exited', () => {
        if (!labelObj.text.trim()) {
          this.canvas.remove(labelObj);
          this.canvas.renderAll();
        } else {
          this._snapshot();
        }
        this._notifyLocalChange();
      });
      labelObj.on('changed', () => this._notifyLocalChange());   // en tiempo real al escribir
    }

    // Si la etiqueta ya existía (cargada de JSON), asegurar que el listener
    // de salida esté enlazado (solo una vez).
    if (!labelObj._exitHandlerBound) {
      labelObj._exitHandlerBound = true;
      labelObj.on('editing:exited', () => {
        if (!labelObj.text.trim()) {
          this.canvas.remove(labelObj);
          this.canvas.renderAll();
        } else {
          this._snapshot();
        }
        this._notifyLocalChange();
      });
      labelObj.on('changed', () => this._notifyLocalChange());   // en tiempo real al escribir
    }

    this.canvas.setActiveObject(labelObj);
    labelObj.enterEditing();
    labelObj.selectAll();
    this.canvas.renderAll();
  },

  /** Elimina una nube y su etiqueta/sello (uso: cancelar Nube RFI sin vincular). */
  removeCloud(this: MarkupLayer, cloudObj) {
    if (!cloudObj) return;
    if (cloudObj.data?.cloudId) this._removeCloudLabel(cloudObj.data.cloudId);
    this.canvas.remove(cloudObj);
    this.canvas.discardActiveObject();
    this.canvas.renderAll();
    this._snapshot();
    this._notifyLocalChange();
  },

  /* ── Sincronizar etiqueta al mover / escalar / rotar la nube ─────────── */
  _syncCloudLabel(this: MarkupLayer, cloudObj) {
    const cloudId = cloudObj.data?.cloudId;
    if (!cloudId) return;
    const labelObj = this.canvas.getObjects().find(
      o => o.data?.type === 'cloud-label' && o.data?.cloudId === cloudId
    );
    if (!labelObj) return;
    const pos = labelObj.data?.isRfiStamp
      ? this._rfiStampTop(cloudObj, labelObj)   // sello RFI → parte superior
      : cloudObj.getCenterPoint();              // etiqueta normal → centro
    labelObj.set({ left: pos.x ?? pos.left, top: pos.y ?? pos.top });
    labelObj.setCoords();
    this.canvas.renderAll();
  },

  /* ── Eliminar etiqueta de nube (al borrar la nube) ───────────────────── */
  _removeCloudLabel(this: MarkupLayer, cloudId) {
    const labelObj = this.canvas.getObjects().find(
      o => o.data?.type === 'cloud-label' && o.data?.cloudId === cloudId
    );
    if (labelObj) this.canvas.remove(labelObj);
  },
};
