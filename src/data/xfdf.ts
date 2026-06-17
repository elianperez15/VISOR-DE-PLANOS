/* ═══════════════════════════════════════════════════════════════════════
   XFDFConverter — Serializa markup de Fabric.js ↔ XFDF (Adobe XML)

   XFDF es el estándar de Adobe para anotaciones portátiles:
   · El PDF y el .xfdf viajan juntos pero separados.
   · Cualquier visor compatible (Acrobat, Foxit, PDF.js + capa) pinta las
     anotaciones encima del PDF.
   · SAF extiende XFDF con atributos saf:* para datos de medidas/escala y
     saf:j (base64 del JSON Fabric) para round-trip exacto.

   Coordenadas:
   · Fabric.js: origen top-left, Y hacia abajo, unidades = puntos PDF (lógicos)
   · XFDF/PDF:  origen bottom-left, Y hacia arriba, mismas unidades
   · Conversión: xfdf_y = logicalPageHeight − fabric_y
   ═══════════════════════════════════════════════════════════════════════ */

const XFDF_NS = 'http://ns.adobe.com/xfdf/';
const SAF_NS  = 'http://btsolution.com/saf/1.0';

export class XFDFConverter {

  /* ═══════════════════════════════════════════════════════════════
     EXPORTAR: session Fabric.js → string XFDF

     pages       : { "1": "[fabricObjJSON,...]", "2": "...", ... }
     docFilename : nombre del PDF  (ej: "plano-01.pdf")
     scale       : { pxPerUnit, unit } | null
     pageHeights : { "1": 792, "2": 792, ... }  (puntos lógicos por página)
     ═══════════════════════════════════════════════════════════════ */
  static toXFDF(pages, docFilename, scale, pageHeights) {
    const e = s => String(s ?? '')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;');

    let annots = '';

    for (const [pageNum, jsonStr] of Object.entries(pages)) {
      if (!jsonStr) continue;
      let objects;
      try { objects = JSON.parse(jsonStr); } catch { continue; }
      if (!Array.isArray(objects) || !objects.length) continue;

      const pageH = parseFloat(pageHeights[pageNum] || 792);
      const page  = parseInt(pageNum, 10) - 1; // XFDF usa índice 0

      for (const obj of objects) {
        annots += this._objToXFDF(obj, page, pageH, e);
      }
    }

    const scaleAttr = scale
      ? `\n     saf:scale-px="${scale.pxPerUnit}" saf:scale-unit="${e(scale.unit)}"` : '';

    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      `<xfdf xmlns="${XFDF_NS}"`,
      `      xmlns:saf="${SAF_NS}"`,
      `      xml:space="preserve"${scaleAttr}>`,
      `  <f href="${e(docFilename)}"/>`,
      `  <annots>`,
      annots.trimEnd(),
      `  </annots>`,
      `</xfdf>`,
    ].join('\n');
  }

  /* ═══════════════════════════════════════════════════════════════
     IMPORTAR: string XFDF → objetos Fabric.js por página

     Retorna: { pages: { "1": [plainFabricObj,...] }, scale: {...}|null }
     ═══════════════════════════════════════════════════════════════ */
  static fromXFDF(xfdfStr, pageHeights) {
    const parser = new DOMParser();
    const doc    = parser.parseFromString(xfdfStr, 'text/xml');
    if (doc.querySelector('parsererror')) {
      throw new Error('XFDF inválido: error de parseo XML');
    }

    // Leer escala SAF guardada en el elemento raíz
    const root = doc.documentElement;
    let scale  = null;
    const spx  = root.getAttributeNS(SAF_NS, 'scale-px');
    if (spx) scale = {
      pxPerUnit: parseFloat(spx),
      unit: root.getAttributeNS(SAF_NS, 'scale-unit') || 'm',
    };

    const annotsEl = doc.querySelector('annots');
    if (!annotsEl) return { pages: {}, scale };

    const pages = {}; // { pageNum: [fabricObj,...] }

    for (const el of Array.from(annotsEl.children)) {
      const page  = parseInt(el.getAttribute('page') || '0', 10) + 1; // → 1-indexed
      const pageH = parseFloat(pageHeights[page] || 792);

      if (!pages[page]) pages[page] = [];
      const obj = this._xfdfElToFabric(el, pageH);
      if (obj) pages[page].push(obj);
    }

    return { pages, scale };
  }

  /* ═══════════════════════════════════════════════════════════════
     HELPERS DE ARCHIVO
     ═══════════════════════════════════════════════════════════════ */

  /** Descarga un string XFDF como archivo .xfdf */
  static downloadXFDF(xfdfStr, filename) {
    const blob = new Blob([xfdfStr], { type: 'application/vnd.adobe.xfdf' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = filename || 'markup.xfdf'; a.click();
    URL.revokeObjectURL(url);
  }

  /** Lee un archivo .xfdf / .xml del disco */
  static readFile(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload  = e => res(e.target.result);
      r.onerror = () => rej(new Error('Error al leer archivo XFDF'));
      r.readAsText(file, 'UTF-8');
    });
  }

  /* ═══════════════════════════════════════════════════════════════
     PRIVADO: Fabric → XFDF
     ═══════════════════════════════════════════════════════════════ */

  static _objToXFDF(obj, page, pageH, e) {
    const id   = (obj.name || 'saf-' + Math.random().toString(36).slice(2,9));
    const j64  = this._b64(JSON.stringify(obj));          // round-trip exacto
    const type = obj.data?.type || obj.type || '';
    const c    = this._hex(obj.stroke);
    const ic   = this._hex(obj.fill);
    const w    = obj.strokeWidth || 2;
    const op   = obj.opacity ?? 1;

    switch (obj.type) {

      /* ── Rectángulo / Highlight ──────────────────────────────── */
      case 'rect': {
        const r = this._rect(obj.left, obj.top, obj.width*(obj.scaleX||1), obj.height*(obj.scaleY||1), pageH);
        return `    <square page="${page}" name="${e(id)}" rect="${r}" color="${c}" interior-color="${ic}" opacity="${op}" width="${w}" saf:type="${e(type)}" saf:j="${j64}"/>\n`;
      }

      /* ── Elipse / Círculo ──────────────────────────────────────── */
      case 'ellipse': {
        const rw = (obj.rx||50)*2*(obj.scaleX||1), rh = (obj.ry||50)*2*(obj.scaleY||1);
        const r = this._rect(obj.left, obj.top, rw, rh, pageH);
        return `    <circle page="${page}" name="${e(id)}" rect="${r}" color="${c}" interior-color="${ic}" opacity="${op}" width="${w}" saf:type="ellipse" saf:j="${j64}"/>\n`;
      }

      /* ── Polígono (área, nube-aprox) ──────────────────────────── */
      case 'polygon': {
        const pts  = (obj.points||[]).map(p => `${this._n(p.x)},${this._n(pageH-p.y)}`).join(';');
        const bbox = this._polyBBox(obj.points||[], pageH);
        const areaLabel = obj.data?.areaLabel || '';
        const cloudEffect = type === 'cloud' ? ' border-effect="C" border-effect-intensity="2"' : '';
        const contents = areaLabel ? `\n      <contents>${e(areaLabel)}</contents>` : '';
        return `    <polygon page="${page}" name="${e(id)}" rect="${bbox}" vertices="${pts}" color="${c}" interior-color="${ic}" opacity="${op}" width="${w}"${cloudEffect} saf:type="${e(type)}" saf:j="${j64}">${contents}\n    </polygon>\n`;
      }

      /* ── Polilínea (perímetro) ─────────────────────────────────── */
      case 'polyline': {
        const pts  = (obj.points||[]).map(p => `${this._n(p.x)},${this._n(pageH-p.y)}`).join(';');
        const bbox = this._polyBBox(obj.points||[], pageH);
        const lbl  = obj.data?.label || '';
        return `    <polyline page="${page}" name="${e(id)}" rect="${bbox}" vertices="${pts}" color="${c}" opacity="${op}" width="${w}" saf:type="${e(type)}" saf:j="${j64}">\n      <contents>${e(lbl)}</contents>\n    </polyline>\n`;
      }

      /* ── Path: nube de revisión o dibujo libre ─────────────────── */
      case 'path': {
        if (type === 'cloud') {
          const rawPts = obj.data?.points || [];
          if (rawPts.length >= 2) {
            const pts  = rawPts.map(p => `${this._n(p.x)},${this._n(pageH-p.y)}`).join(';');
            const bbox = this._polyBBox(rawPts, pageH);
            return `    <polygon page="${page}" name="${e(id)}" rect="${bbox}" vertices="${pts}" color="${c}" interior-color="${ic}" opacity="${op}" width="${w}" border-effect="C" border-effect-intensity="2" saf:type="cloud" saf:j="${j64}">\n      <contents>Nube de revisión</contents>\n    </polygon>\n`;
          }
        }
        // Dibujo libre → <ink>
        const inkPts = this._pathPts(obj, pageH);
        if (!inkPts.length) return '';
        const bbox    = this._inkBBox(inkPts);
        const gesture = inkPts.map(p => `${this._n(p.x)},${this._n(p.y)}`).join(';');
        return `    <ink page="${page}" name="${e(id)}" rect="${bbox}" color="${c}" width="${w}" opacity="${op}" saf:type="freehand" saf:j="${j64}">\n      <inklist>\n        <gesture>${gesture}</gesture>\n      </inklist>\n    </ink>\n`;
      }

      /* ── Texto (IText, Text, Textbox) ──────────────────────────── */
      case 'i-text':
      case 'text':
      case 'textbox': {
        const tw = (obj.width||120)*(obj.scaleX||1);
        const th = (obj.fontSize||14)*1.6*(obj.scaleY||1);
        const r  = this._rect(obj.left, obj.top, tw, th, pageH);
        const fs = obj.fontSize||14;
        const rgb= this._hexToRgbFloat(obj.fill||'#000');
        return `    <freetext page="${page}" name="${e(id)}" rect="${r}" color="${this._hex(obj.fill)}" interior-color="#1C2130" opacity="1" width="0" saf:type="${e(type||'text')}" saf:j="${j64}">\n      <contents>${e(obj.text||'')}</contents>\n      <defaultappearance>/Helvetica ${fs} Tf ${rgb} rg</defaultappearance>\n    </freetext>\n`;
      }

      /* ── Group (flecha, cota, sello, nota, ángulo, callout) ────── */
      case 'group':
        return this._groupToXFDF(obj, page, pageH, e, id, j64, type);

      default: return '';
    }
  }

  static _groupToXFDF(obj, page, pageH, e, id, j64, type) {
    const bbox = this._groupBBox(obj, pageH);
    const c    = this._hex(this._groupProp(obj,'stroke','#ef4444'));
    const w    = obj.strokeWidth || this._groupProp(obj,'strokeWidth',2);

    switch (type) {

      case 'arrow': {
        const line = this._findInGroup(obj,'line');
        if (!line) break;
        const {x1,y1,x2,y2} = this._lineAbsPts(line, obj);
        const l = `${this._n(x1)},${this._n(pageH-y1)},${this._n(x2)},${this._n(pageH-y2)}`;
        return `    <line page="${page}" name="${e(id)}" rect="${bbox}" l="${l}" color="${c}" width="${w}" head="ClosedArrow" tail="None" saf:type="arrow" saf:j="${j64}"/>\n`;
      }

      case 'dimension': {
        const line  = this._findInGroup(obj,'line');
        const label = obj.data?.label || '';
        const [val='', unit=''] = label.split(' ');
        if (!line) break;
        const {x1,y1,x2,y2} = this._lineAbsPts(line, obj);
        const l = `${this._n(x1)},${this._n(pageH-y1)},${this._n(x2)},${this._n(pageH-y2)}`;
        return `    <line page="${page}" name="${e(id)}" rect="${bbox}" l="${l}" color="${c}" width="1" head="OpenArrow" tail="OpenArrow" saf:type="dimension" saf:measure-value="${e(val)}" saf:measure-unit="${e(unit)}" saf:j="${j64}">\n      <contents>${e(label)}</contents>\n    </line>\n`;
      }

      case 'stamp': {
        const lbl      = obj.data?.label || 'STAMP';
        const std      = this._stdStamp(lbl);
        return `    <stamp page="${page}" name="${e(id)}" rect="${bbox}" name="${std}" color="${c}" opacity="0.9" saf:type="stamp" saf:label="${e(lbl)}" saf:j="${j64}"/>\n`;
      }

      case 'note':
      case 'callout': {
        const txt = this._findInGroup(obj,'i-text') || this._findInGroup(obj,'text');
        return `    <text page="${page}" name="${e(id)}" rect="${bbox}" color="${c}" saf:type="${type}" saf:j="${j64}">\n      <contents>${e(txt?.text||'')}</contents>\n    </text>\n`;
      }

      case 'angle': {
        const lbl = obj.data?.label || '';
        return `    <square page="${page}" name="${e(id)}" rect="${bbox}" color="${c}" width="1" saf:type="angle" saf:angle="${e(lbl)}" saf:j="${j64}">\n      <contents>${e(lbl)}</contents>\n    </square>\n`;
      }

      default:
        return `    <square page="${page}" name="${e(id)}" rect="${bbox}" color="${c}" width="1" saf:type="${e(type)}" saf:j="${j64}"/>\n`;
    }
    return '';
  }

  /* ═══════════════════════════════════════════════════════════════
     PRIVADO: XFDF → Fabric
     ═══════════════════════════════════════════════════════════════ */

  static _xfdfElToFabric(el, pageH) {
    // Prioridad 1: round-trip exacto desde saf:j
    const j64 = el.getAttributeNS(SAF_NS,'j') || el.getAttribute('saf:j');
    if (j64) {
      try { return JSON.parse(this._fromb64(j64)); } catch { /* fallback */ }
    }

    // Prioridad 2: reconstruir desde atributos XFDF estándar
    const tag  = el.localName || el.tagName.replace(/.*:/,'');
    const type = el.getAttributeNS(SAF_NS,'type') || el.getAttribute('saf:type') || '';
    const col  = el.getAttribute('color') || '#ef4444';
    const ic   = el.getAttribute('interior-color') || 'transparent';
    const w    = parseFloat(el.getAttribute('width') || '2');
    const op   = parseFloat(el.getAttribute('opacity') || '1');
    const parseRect = attr => (el.getAttribute(attr)||'0,0,100,100').split(',').map(parseFloat);

    switch (tag) {
      case 'square': {
        const [l,b,r,t] = parseRect('rect');
        return { type:'rect', left:l, top:pageH-t, width:r-l, height:t-b,
          stroke:col, fill:ic, strokeWidth:w, opacity:op, data:{type:type||'rect'} };
      }
      case 'circle': {
        const [l,b,r,t] = parseRect('rect');
        return { type:'ellipse', left:l, top:pageH-t, rx:(r-l)/2, ry:(t-b)/2,
          stroke:col, fill:ic, strokeWidth:w, opacity:op, data:{type:'ellipse'} };
      }
      case 'polygon': {
        const vPairs = (el.getAttribute('vertices')||'').split(';')
          .map(s => { const [x,y] = s.split(',').map(parseFloat); return {x, y:pageH-y}; });
        const contents = el.querySelector('contents')?.textContent || '';
        const isCloud  = el.getAttribute('border-effect') === 'C' || type === 'cloud';
        return { type:'polygon', points:vPairs, stroke:col, fill:ic,
          strokeWidth:w, opacity:op, data:{type:isCloud?'cloud':(type||'area'), areaLabel:contents} };
      }
      case 'polyline': {
        const vPairs = (el.getAttribute('vertices')||'').split(';')
          .map(s => { const [x,y] = s.split(',').map(parseFloat); return {x, y:pageH-y}; });
        const lbl = el.querySelector('contents')?.textContent || '';
        return { type:'polyline', points:vPairs, stroke:col, strokeWidth:w,
          fill:'transparent', opacity:op, data:{type:'perimeter', label:lbl} };
      }
      case 'line': {
        const [x1,y1,x2,y2] = (el.getAttribute('l')||'0,0,100,100').split(',').map(parseFloat);
        const lbl = el.querySelector('contents')?.textContent || '';
        return { type:'line', x1, y1:pageH-y1, x2, y2:pageH-y2,
          stroke:col, strokeWidth:w, data:{type:type||'line', label:lbl} };
      }
      case 'freetext': {
        const [l,b,r,t] = parseRect('rect');
        const txt = el.querySelector('contents')?.textContent || '';
        return { type:'i-text', left:l, top:pageH-t, text:txt,
          fill:col, fontSize:14, fontFamily:'Arial', data:{type:'text'} };
      }
      case 'ink': {
        const pts = Array.from(el.querySelectorAll('gesture')).flatMap(g =>
          g.textContent.split(';').map(s => { const [x,y]=s.split(',').map(parseFloat); return {x,y:pageH-y}; })
        );
        if (!pts.length) return null;
        const d = pts.map((p,i)=>`${i?'L':'M'} ${p.x} ${p.y}`).join(' ');
        return { type:'path', path:d, stroke:col, strokeWidth:w, fill:'transparent',
          opacity:op, data:{type:'freehand'} };
      }
      case 'stamp': {
        const [l,b,r,t] = parseRect('rect');
        const lbl = el.getAttributeNS(SAF_NS,'label')||el.getAttribute('saf:label')||'STAMP';
        return { type:'group', left:l, top:pageH-t, data:{type:'stamp',label:lbl}, _xfdf_incomplete:true };
      }
      case 'text': {
        const [l,b,r,t] = parseRect('rect');
        const txt = el.querySelector('contents')?.textContent || '';
        return { type:'i-text', left:l, top:pageH-t, text:txt,
          fill:col, fontSize:14, fontFamily:'Arial', data:{type:type||'note'} };
      }
      default: return null;
    }
  }

  /* ═══════════════════════════════════════════════════════════════
     UTILIDADES INTERNAS
     ═══════════════════════════════════════════════════════════════ */

  /** "left,bottom,right,top" en espacio PDF (Y flipped) */
  static _rect(left, top, width, height, pageH) {
    return [
      this._n(left),
      this._n(pageH - top - height),
      this._n(left + width),
      this._n(pageH - top),
    ].join(',');
  }

  /** BBox de una lista de puntos Fabric {x,y} → string XFDF */
  static _polyBBox(pts, pageH) {
    if (!pts.length) return '0,0,100,100';
    const xs = pts.map(p=>p.x), ys = pts.map(p=>p.y);
    return this._rect(Math.min(...xs), Math.min(...ys),
                      Math.max(...xs)-Math.min(...xs),
                      Math.max(...ys)-Math.min(...ys), pageH);
  }

  /** BBox de puntos ink (ya en PDF Y-up) → string XFDF */
  static _inkBBox(pts) {
    const xs=pts.map(p=>p.x), ys=pts.map(p=>p.y), PAD=4;
    return `${this._n(Math.min(...xs)-PAD)},${this._n(Math.min(...ys)-PAD)},${this._n(Math.max(...xs)+PAD)},${this._n(Math.max(...ys)+PAD)}`;
  }

  /** BBox aproximado de un Group */
  static _groupBBox(obj, pageH) {
    const w = (obj.width||100)*(obj.scaleX||1);
    const h = (obj.height||50)*(obj.scaleY||1);
    return this._rect(obj.left||0, obj.top||0, w, h, pageH);
  }

  /** Extrae puntos de un fabric.Path (serializado) para <ink> */
  static _pathPts(obj, pageH) {
    const cmds = Array.isArray(obj.path) ? obj.path : [];
    const local = [];
    cmds.forEach(c => {
      switch ((c[0]||'').toUpperCase()) {
        case 'M': case 'L': local.push({x:c[1],y:c[2]}); break;
        case 'Q': local.push({x:c[3],y:c[4]}); break;
        case 'C': local.push({x:c[5],y:c[6]}); break;
      }
    });
    if (!local.length) return [];
    // Aplicar transformación simple (sin rotación) para obtener coordenadas canvas
    const ox = obj.left||0, oy = obj.top||0;
    const sx = obj.scaleX||1, sy = obj.scaleY||1;
    return local.map(p => ({
      x: this._n(ox + p.x * sx),
      y: this._n(pageH - (oy + p.y * sy)), // Y flip
    }));
  }

  /** Puntos absolutos canvas de una Line dentro de un Group */
  static _lineAbsPts(line, group) {
    const gx = group.left||0, gy = group.top||0;
    const gw = (group.width||0)/2, gh = (group.height||0)/2;
    return {
      x1: gx + gw + (line.x1||0),
      y1: gy + gh + (line.y1||0),
      x2: gx + gw + (line.x2||0),
      y2: gy + gh + (line.y2||0),
    };
  }

  /** Busca el primer objeto de un tipo dentro de un Group serializado */
  static _findInGroup(group, typeName) {
    return (group.objects||[]).find(o => o.type === typeName);
  }

  /** Busca una propiedad dentro del primer hijo del Group */
  static _groupProp(group, prop, fallback) {
    return (group.objects||[]).reduce((v,o) => v || o[prop], null) ?? fallback;
  }

  /** Color → #RRGGBB hex */
  static _hex(color) {
    if (!color || color==='transparent'||color==='none') return '#000000';
    const s = String(color);
    if (s.startsWith('#')) {
      return s.length===4
        ? '#'+[s[1],s[2],s[3]].map(c=>c+c).join('').toUpperCase()
        : s.toUpperCase();
    }
    const m = s.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (m) return '#'+[m[1],m[2],m[3]].map(v=>parseInt(v).toString(16).padStart(2,'0')).join('').toUpperCase();
    return '#000000';
  }

  /** Color → "r g b" float string para defaultappearance */
  static _hexToRgbFloat(color) {
    const hex = this._hex(color).slice(1);
    const r = parseInt(hex.slice(0,2),16)/255;
    const g = parseInt(hex.slice(2,4),16)/255;
    const b = parseInt(hex.slice(4,6),16)/255;
    return `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)}`;
  }

  /** Redondear a 2 decimales */
  static _n(v) { return Math.round((v||0)*100)/100; }

  /** Nombre estándar XFDF para sellos SAF */
  static _stdStamp(label) {
    return ({
      'APROBADO':'Approved','RECHAZADO':'NotApproved',
      'EN REVISIÓN':'ForComment','BORRADOR':'Draft',
      'PRECAUCIÓN':'AsIs','INFORMACIÓN':'ForPublicRelease',
      'NCI':'Confidential','RFI':'Departmental',
    })[label.toUpperCase()] || label;
  }

  /** Base64 UTF-8 seguro */
  static _b64(str) {
    try { return btoa(unescape(encodeURIComponent(str))); } catch { return btoa(str); }
  }
  static _fromb64(b64) {
    try { return decodeURIComponent(escape(atob(b64))); } catch { return atob(b64); }
  }
}
