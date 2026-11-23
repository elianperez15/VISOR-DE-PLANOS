/* ──────────────────────────────────────────────────────────────────────
   shapes.ts — Creación y estilo de las figuras de anotación (métodos de MarkupLayer)

   Flecha · línea · rectángulo · elipse · resaltado · hipervínculo · texto ·
   nota · globo · sello · etiqueta profesional · pin de foto.
   ────────────────────────────────────────────────────────────────────── */
import { fabric } from 'fabric';
import type { MarkupLayer } from './markup-layer';

export const shapeMethods = {
  /* ── Flecha ─────────────────────────────────────────────────────────── */
  _addArrow(this: MarkupLayer, x1,y1,x2,y2) {
    const angle = Math.atan2(y2-y1,x2-x1)*(180/Math.PI);
    const size  = Math.max(10,this.strokeWidth*5);
    const group = new fabric.Group([
      new fabric.Line([x1,y1,x2,y2],{stroke:this.strokeColor,strokeWidth:this.strokeWidth,selectable:false}),
      new fabric.Triangle({left:x2,top:y2,width:size,height:size,fill:this.strokeColor,stroke:this.strokeColor,angle:angle+90,originX:'center',originY:'center',selectable:false}),
    ]);
    group.data = { type:'arrow' };
    this._place(group);
  },

  /* ── Línea (recta, sin punta) ───────────────────────────────────────── */
  _addLine(this: MarkupLayer, x1,y1,x2,y2) {
    const line = new fabric.Line([x1,y1,x2,y2], {
      stroke: this.strokeColor, strokeWidth: this.strokeWidth,
      strokeLineCap: 'round',
    });
    line.data = { type:'line' };
    this._place(line);
  },

  /* ── Rectángulo ─────────────────────────────────────────────────────── */
  _addRect(this: MarkupLayer, x1,y1,x2,y2) {
    const obj = new fabric.Rect({
      left:Math.min(x1,x2), top:Math.min(y1,y2),
      width:Math.abs(x2-x1), height:Math.abs(y2-y1),
      stroke:this.strokeColor, strokeWidth:this.strokeWidth, fill:this.fillColor,
    });
    obj.data = { type:'rect' };
    this._place(obj);
  },

  /* ── Elipse ─────────────────────────────────────────────────────────── */
  _addEllipse(this: MarkupLayer, x1,y1,x2,y2) {
    const rx = Math.abs(x2-x1)/2, ry = Math.abs(y2-y1)/2;
    const obj = new fabric.Ellipse({
      left:Math.min(x1,x2)+rx, top:Math.min(y1,y2)+ry, rx, ry,
      stroke:this.strokeColor, strokeWidth:this.strokeWidth, fill:this.fillColor,
      originX:'center', originY:'center',
    });
    obj.data = { type:'ellipse' };
    this._place(obj);
  },

  /* ── Highlight ──────────────────────────────────────────────────────── */
  _addHighlight(this: MarkupLayer, x1,y1,x2,y2) {
    const obj = new fabric.Rect({
      left:Math.min(x1,x2), top:Math.min(y1,y2),
      width:Math.abs(x2-x1), height:Math.abs(y2-y1),
      fill:'rgba(250,204,21,0.35)', stroke:'transparent', strokeWidth:0,
    });
    obj.data = { type:'highlight' };
    this._place(obj);
  },

  /* ── Hipervínculo a otra hoja (salta a una página al doble-clic) ─────── */
  _addLink(this: MarkupLayer, x1,y1,x2,y2) {
    const obj = new fabric.Rect({
      left:Math.min(x1,x2), top:Math.min(y1,y2),
      width:Math.abs(x2-x1), height:Math.abs(y2-y1),
      fill:'rgba(14,165,233,0.12)', stroke:'#0ea5e9', strokeWidth:1.5,
      strokeDashArray:[6,3], rx:3, ry:3,
      hoverCursor:'pointer',
    });
    // targetPage  → salto a una hoja del MISMO documento
    // targetRepoId→ salto a OTRO plano (id_en_repositorio); APEX maneja la navegación
    obj.data = { type:'link', targetPage:null, targetRepoId:null, targetName:null, targetFile:null };
    this._place(obj);
    this.onLinkCreated && this.onLinkCreated(obj);
  },

  /* ── Texto IText ────────────────────────────────────────────────────── */
  _addText(this: MarkupLayer, pos) {
    const obj = new fabric.IText('Texto',{
      left:pos.x, top:pos.y, fontSize:this.fontSize, fontFamily:'Arial',
      fill:this.strokeColor, editable:true,
    });
    obj.data = { type:'text' };
    this._place(obj);
    if (this.onAutoSelect) this.onAutoSelect();   // herramienta vuelve a "seleccionar"
    // El texto se sigue pudiendo editar aunque estemos en modo seleccionar
    setTimeout(()=>{ this.canvas.setActiveObject(obj); obj.enterEditing(); obj.selectAll(); this.canvas.renderAll(); },40);
  },

  /* ── Nota (post-it) ─────────────────────────────────────────────────── */
  _addNote(this: MarkupLayer, pos) {
    // La caja escala con el tamaño de texto (a 16px → 160×80, como antes).
    const fs = this.fontSize, PAD = Math.round(fs*0.6);
    const WIDTH = fs*10, HEIGHT = fs*5;
    const background = new fabric.Rect({width:WIDTH,height:HEIGHT,rx:6,ry:6,fill:'#fef3c7',stroke:'#d97706',strokeWidth:1.5,left:0,top:0,selectable:false});
    const textObj = new fabric.Textbox('Nota',{left:PAD,top:PAD,width:WIDTH-PAD*2,fontSize:fs,fontFamily:'Arial',fill:'#92400e',editable:false,selectable:false,splitByGrapheme:true});
    textObj._pad = PAD;
    const group = new fabric.Group([background,textObj],{left:pos.x,top:pos.y});
    group.data = { type:'note', _fullText:'Nota' };
    this._place(group);
    this._fitFigureText(group);
    if (this.onAutoSelect) this.onAutoSelect();
  },

  /* ── Callout (globo con línea de apunte) ─────────────────────────────── */
  _addCallout(this: MarkupLayer, pos) {
    // La caja escala con el tamaño de texto (a 16px → 160×60, como antes).
    const fs = this.fontSize, PAD = Math.round(fs*0.6);
    const WIDTH = fs*10, HEIGHT = Math.round(fs*3.75);
    const bubbleX=30, bubbleY=-70;
    const background = new fabric.Rect({left:bubbleX,top:bubbleY,width:WIDTH,height:HEIGHT,rx:8,ry:8,fill:'#eff6ff',stroke:'#3b82f6',strokeWidth:1.5,selectable:false});
    const tip        = new fabric.Triangle({left:bubbleX+WIDTH/2-6,top:bubbleY+HEIGHT,width:12,height:14,fill:'#3b82f6',selectable:false});
    const line       = new fabric.Line([bubbleX+WIDTH/2,bubbleY+HEIGHT+14,0,0],{stroke:'#3b82f6',strokeWidth:1.5,selectable:false});
    const textObj    = new fabric.Textbox('Comentario',{left:bubbleX+PAD,top:bubbleY+PAD,width:WIDTH-PAD*2,fontSize:fs,fontFamily:'Arial',fill:'#1e40af',editable:false,selectable:false,splitByGrapheme:true});
    textObj._pad = PAD;
    const group      = new fabric.Group([line,background,tip,textObj],{left:pos.x,top:pos.y,originX:'center',originY:'bottom'});
    group.data       = { type:'callout', _fullText:'Comentario' };
    this._place(group);
    this._fitFigureText(group);
    if (this.onAutoSelect) this.onAutoSelect();
  },

  /* ── Sello (rubber stamp — texto inclinado) ─────────────────────────── */
  addStamp(this: MarkupLayer, x, y, label, color) {
    const stampColor = color || this.strokeColor;
    const PAD = 12;
    const textObj = new fabric.Text(label, {
      fontSize:18, fontFamily:'Arial Black,sans-serif', fontWeight:'bold',
      fill:stampColor, left:0, top:0, selectable:false,
    });
    const box = new fabric.Rect({
      left:-PAD, top:-PAD, width:textObj.width+PAD*2, height:textObj.height+PAD*2,
      stroke:stampColor, strokeWidth:3, fill:`${stampColor}18`, rx:6, ry:6, selectable:false,
    });
    const group = new fabric.Group([box, textObj], {
      left:x, top:y, angle:-15, originX:'center', originY:'center',
    });
    group.data = { type:'stamp', label };
    this._place(group);
  },

  /* ── Pin de foto estilo Procore: ícono clavado en el plano ──────────────
     La imagen no se ve grande sobre el plano (vista limpia); se guarda como
     adjunto del pin. Clic = seleccionar (barra flotante con ojo + ampliar);
     doble clic = abrir en grande. El ojo muestra/oculta una previa de 120px. */
  placePendingImage(this: MarkupLayer, dataUrl, name, type) {
    let centerX, centerY;
    if (this._pendingImagePos) {
      centerX = this._pendingImagePos.x;
      centerY = this._pendingImagePos.y;
    } else {
      const rect = this._visibleLogicalRect();
      centerX = rect.x + rect.w / 2;
      centerY = rect.y + rect.h / 2;
    }
    this._pendingImagePos = null;

    const ACCENT = '#e1251b';   // rojo AICSA (coherente con la app)
    // Glifo de IMAGEN (marco + sol + montaña) en el espacio 24×24 del set de iconos
    const IMG = 'M5 3 H19 A2 2 0 0 1 21 5 V19 A2 2 0 0 1 19 21 H5 A2 2 0 0 1 3 19 V5 A2 2 0 0 1 5 3 Z'
              + ' M10.2 8.6 A1.8 1.8 0 1 1 6.6 8.6 A1.8 1.8 0 1 1 10.2 8.6 Z'
              + ' M4 17.5 L9 11.5 L13.5 16 L17 12 L21 16';
    const glyph = new fabric.Path(IMG, {
      fill: '', stroke: '#fff', strokeWidth: 2,
      strokeLineJoin: 'round', strokeLineCap: 'round',
      originX: 'center', originY: 'center',
    });
    const GLYPH_TARGET_HEIGHT = 20;
    const glyphScale = GLYPH_TARGET_HEIGHT / (glyph.height || GLYPH_TARGET_HEIGHT);
    glyph.scale(glyphScale);
    glyph.set({ left: 0, top: 0 });   // centrar exactamente sobre el badge (origen centro)
    // Badge redondeado con sombra sutil (aro claro exterior + relleno de acento)
    const halo = new fabric.Rect({
      width: 44, height: 38, rx: 12, ry: 12,
      fill: 'rgba(0,0,0,0.18)', originX: 'center', originY: 'center', top: 1.5,
    });
    const badge = new fabric.Rect({
      width: 42, height: 36, rx: 11, ry: 11,
      fill: ACCENT, stroke: '#fff', strokeWidth: 2.5,
      originX: 'center', originY: 'center',
    });
    const tip = new fabric.Triangle({
      width: 15, height: 11, fill: ACCENT, stroke: '#fff', strokeWidth: 1.5,
      angle: 180, originX: 'center', originY: 'center', top: 22,
    });
    const group = new fabric.Group([halo, tip, badge, glyph], {
      left: centerX, top: centerY, originX: 'center', originY: 'bottom',
      hoverCursor: 'pointer',
    });
    group.data = {
      type: 'photo-pin',
      name: name || 'imagen',
      attShown: true,                                    // la imagen se muestra por defecto
      adjuntos: [{
        name: name || 'imagen',
        type: (type || '').startsWith('image/') ? type : 'image/png',
        size: dataUrl.length,
        dataUrl,
      }],
    };
    this._place(group);
    this.refreshThumb(group);   // mostrar la imagen de inmediato (visible por defecto)
  },

  /** Genera un canvas pequeño con líneas diagonales para usar como patrón */
  _makeHatchCanvas(this: MarkupLayer, color) {
    const size = 9;
    const canvasEl  = document.createElement('canvas');
    canvasEl.width  = size;
    canvasEl.height = size;
    const ctx = canvasEl.getContext('2d');
    ctx.strokeStyle = color;
    ctx.lineWidth   = 1.2;
    ctx.globalAlpha = 0.42;
    // Diagonal ↘ continua a tile
    ctx.beginPath();
    ctx.moveTo(size, 0); ctx.lineTo(0, size);
    ctx.moveTo(size * 2, 0); ctx.lineTo(size, size);
    ctx.moveTo(0, 0); ctx.lineTo(-size, size);
    ctx.stroke();
    return canvasEl;
  },

  /**
   * addLabel — etiqueta rectangular con borde doble
   * @param {string} style  'solid' | 'hatch'
   */
  addLabel(this: MarkupLayer, x, y, text, color, style = 'solid') {
    const labelColor = color || this.strokeColor;
    const PAD_H = 18, PAD_V = 11;
    const OUTER_BORDER_WIDTH = 3;   // grosor borde exterior
    const BORDER_GAP         = 4;   // espacio entre borde exterior e interior

    // Medir texto antes de construir el grupo
    const probe = new fabric.Text(text, {
      fontSize:22, fontFamily:'Arial Black, Impact, sans-serif',
      fontWeight:'bold', charSpacing:80,
    });
    const textWidth = probe.width, textHeight = probe.height;
    const width  = textWidth + PAD_H * 2;
    const height = textHeight + PAD_V * 2;

    const objs = [];

    // Trama diagonal (solo para estilo 'hatch')
    if (style === 'hatch') {
      const pattern = new fabric.Pattern({
        source  : this._makeHatchCanvas(labelColor),
        repeat  : 'repeat',
      });
      objs.push(new fabric.Rect({
        left:0, top:0, width, height,
        fill: pattern, stroke:'transparent', strokeWidth:0,
        selectable:false, evented:false,
      }));
    }

    // Borde exterior (más grueso)
    objs.push(new fabric.Rect({
      left:0, top:0, width, height,
      stroke:labelColor, strokeWidth:OUTER_BORDER_WIDTH,
      fill: style === 'hatch' ? 'transparent' : `${labelColor}15`,
      rx:2, ry:2, selectable:false,
    }));

    // Borde interior (línea fina)
    const inset = OUTER_BORDER_WIDTH + BORDER_GAP;
    objs.push(new fabric.Rect({
      left:inset, top:inset,
      width:width - inset * 2, height:height - inset * 2,
      stroke:labelColor, strokeWidth:1.2, fill:'transparent',
      rx:1, ry:1, selectable:false,
    }));

    // Texto centrado
    objs.push(new fabric.Text(text, {
      left: PAD_H, top: PAD_V,
      fontSize:22, fontFamily:'Arial Black, Impact, sans-serif',
      fontWeight:'bold', fill:labelColor, charSpacing:80, selectable:false,
    }));

    const group = new fabric.Group(objs, {
      left:x, top:y, originX:'center', originY:'center',
    });
    group.data = { type:'label', label:text, style };
    this._place(group);
  },

  /* ── Estilo en vivo de una figura (desde el panel de propiedades) ────── */
  setObjProp(this: MarkupLayer, obj, prop, val) {
    if (!obj) return;
    if (prop === 'opacity') {
      obj.set('opacity', val);
    } else {
      // Para grupos (flecha, cota…) aplicar a los hijos y marcarlos sucios para
      // que se refresque el bitmap cacheado del grupo (si no, no se ve en vivo).
      const targets = obj.type === 'group' && obj.getObjects ? obj.getObjects() : [obj];
      targets.forEach(o => { o.set(prop, val); o.dirty = true; });
      obj.set(prop, val);
    }
    obj.dirty = true;
    this.canvas.renderAll();   // render síncrono → cambio visible al instante
  },

  /** Tamaño de texto EFECTIVO de una figura de texto (texto/nota/globo). */
  getObjFontSize(this: MarkupLayer, obj) {
    if (!obj) return 16;
    const t = obj.data?.type;
    if (t === 'text') return Math.round((obj.fontSize || 16) * (obj.scaleY || 1));
    if (t === 'note' || t === 'callout') {
      const txt = this._figureTextObj(obj);
      return Math.round((txt ? txt.fontSize : 16) * (obj.scaleY || 1));
    }
    return 16;
  },

  /** Cambia el tamaño del texto de una figura de texto. Para nota/globo escala
      toda la figura, de modo que la caja se adapta al contenido. */
  setObjFontSize(this: MarkupLayer, obj, px) {
    if (!obj) return;
    px = Math.max(6, parseInt(px, 10) || 16);
    const t = obj.data?.type;
    if (t === 'text') {
      obj.set({ fontSize: px, scaleX: 1, scaleY: 1 });
    } else if (t === 'note' || t === 'callout') {
      const txt = this._figureTextObj(obj);
      const curFs = (txt && txt.fontSize) || 16;
      const s = px / curFs;                 // la caja + el texto escalan juntos
      obj.set({ scaleX: s, scaleY: s });
    } else {
      return;
    }
    obj.dirty = true;
    obj.setCoords();
    this.canvas.renderAll();
    this._snapshot();
    this._notifyLocalChange && this._notifyLocalChange();
  },
};
