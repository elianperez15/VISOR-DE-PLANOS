/* ──────────────────────────────────────────────────────────────────────
   properties-panel.ts — Panel lateral de propiedades de la anotación

   Muestra/edita la figura seleccionada: identidad (autor/fecha/tipo),
   apariencia, etiqueta, hipervínculo, descripción y adjuntos. Bloquea la
   edición si la figura es de otro usuario (solo lectura).

   El objeto activo (_apObj) vive en el orquestador y se accede por getters
   del `ctx`; el panel posee su propio flag de habilitado.
   ────────────────────────────────────────────────────────────────────── */
import { getUserColor } from '../core/user-colors';
import { ANNOT_TYPES } from '../ui/tool-defs';
import { colorToHex } from '../ui/color-utils';
import { renderIcons } from '../ui/icons';

export interface PropertiesPanelCtx {
  getMarkup: () => any;
  getActiveObj: () => any;
  setActiveObj: (o: any) => void;
  btnToggle: HTMLElement | null;   // botón de la toolbar para mostrar/ocultar el panel
}

export function createPropertiesPanel(ctx: PropertiesPanelCtx) {
  const $ = (id: string) => document.getElementById(id) as any;
  let enabled = true;   // el panel se abre al seleccionar una figura

  /** Estilo representativo de una figura (resuelve grupos como flecha/cota). */
  function readStyle(obj: any) {
    const first = (obj.getObjects && obj.getObjects()[0]) || obj;
    return {
      stroke     : obj.stroke || first.stroke || '#ef4444',
      fill       : (obj.fill && obj.fill !== 'transparent') ? obj.fill : (first.fill || 'rgba(239,68,68,0.15)'),
      strokeWidth: obj.strokeWidth || first.strokeWidth || 2,
      opacity    : obj.opacity != null ? obj.opacity : 1,
    };
  }

  /** Línea de meta (fecha · tipo · prioridad). */
  function refreshMeta(d: any) {
    const tipo  = ANNOT_TYPES.find(t => t.id === (d.tipoAnnot || ''));
    const fecha = d.fecha
      ? new Date(d.fecha).toLocaleString('es', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' })
      : '';
    const parts = [fecha];
    if (tipo)        parts.push(`${tipo.icon} ${tipo.label}`);
    if (d.prioridad) parts.push(d.prioridad);
    $('ap-id-meta').textContent = parts.filter(Boolean).join('  ·  ');
  }

  /** Modo solo-lectura (figura de otro usuario). */
  function setReadonly(ro: boolean) {
    ['ap-label','ap-stroke','ap-fill','ap-stroke-w','ap-opacity','ap-desc','ap-link-page',
     'btn-ap-pick-plano','btn-ap-clear-plano','btn-ap-pick-rfi','btn-ap-clear-rfi']
      .forEach(id => { const el = $(id); if (el) el.disabled = ro; });
    const attach = $('btn-ap-attach'); if (attach) attach.style.display = ro ? 'none' : '';
    const panel  = $('annot-panel');   if (panel)  panel.classList.toggle('ap-readonly', ro);
    const banner = $('ap-readonly-banner'); if (banner) banner.style.display = ro ? 'flex' : 'none';
  }

  /** Pinta la grilla de adjuntos de la figura activa. */
  function refreshAttachments() {
    const grid = $('ap-att-grid');
    if (!grid) return;
    const obj = ctx.getActiveObj();
    const list = (obj && obj.data && obj.data.adjuntos) || [];
    $('ap-att-count').textContent = list.length ? `(${list.length})` : '';
    grid.innerHTML = list.map((a: any, i: number) => {
      const isImg = (a.type || '').startsWith('image/');
      const thumb = isImg
        ? `<img src="${a.dataUrl}" alt="">`
        : `<span class="ap-att-fileicon"><i data-lucide="file"></i></span>`;
      return `<div class="ap-att-item" title="${a.name}">
        <button class="ap-att-thumb" data-act="open" data-i="${i}">${thumb}</button>
        <span class="ap-att-name">${a.name}</span>
        <button class="ap-att-del" data-act="del" data-i="${i}" title="Quitar">✕</button>
      </div>`;
    }).join('');
    renderIcons();
  }

  /** Abre un adjunto (imagen en lightbox, otro tipo se descarga). */
  function openAttachment(a: any) {
    if ((a.type || '').startsWith('image/')) {
      $('att-lightbox-img').src = a.dataUrl;
      $('att-lightbox').style.display = 'flex';
    } else {
      const link = document.createElement('a');
      link.href = a.dataUrl; link.download = a.name; link.click();
    }
  }

  /** Abre el panel y lo llena con los datos de `obj`. */
  function open(obj: any) {
    const panel = $('annot-panel');
    if (!panel || !enabled || !obj) return;
    ctx.setActiveObj(obj);
    const markup = ctx.getMarkup();
    const d = obj.data || {};

    // Identidad
    $('ap-id-dot').style.background = getUserColor(d.autor || 'Anónimo');
    $('ap-id-autor').textContent = d.autor || 'Anónimo';
    refreshMeta(d);

    // Apariencia + etiqueta
    const st = readStyle(obj);
    $('ap-stroke').value = colorToHex(st.stroke);
    $('ap-fill').value   = colorToHex(st.fill);
    $('ap-stroke-w').value = st.strokeWidth;
    $('ap-stroke-w-val').textContent = Math.round(st.strokeWidth);
    $('ap-opacity').value = Math.round(st.opacity * 100);
    $('ap-opacity-val').textContent = Math.round(st.opacity * 100);
    $('ap-label').value = markup ? markup.getLabelText(obj) : '';

    // Hipervínculo (solo enlaces)
    const isLink = (d.type === 'link');
    $('ap-link-section').style.display = isLink ? 'block' : 'none';
    if (isLink) {
      const tn = $('ap-link-target-name');
      if (tn) tn.textContent = d.targetRepoId ? (d.targetName || `Plano ${d.targetRepoId}`) : '— sin destino —';
    }

    // Descripción
    $('ap-desc').value = d.descripcion || '';
    $('ap-desc-count').textContent = ($('ap-desc').value).length;

    // RFI (solo el sello RFI) → muestra el RFI vinculado; se elige con el picker
    const isRfi = d.type === 'stamp' && String(d.label || '').toUpperCase() === 'RFI';
    const rfiSec = $('ap-rfi-section');
    if (rfiSec) rfiSec.style.display = isRfi ? 'block' : 'none';
    if (isRfi) {
      const nm = $('ap-rfi-name');
      if (nm) nm.textContent = d.rfiLabel || (d.rfiId ? `RFI ${d.rfiId}` : '— sin RFI —');
    }

    // Adjuntos (solo el pin de cámara)
    const isPhotoPin = (d.type === 'photo-pin');
    $('ap-att-section').style.display = isPhotoPin ? 'block' : 'none';
    if (isPhotoPin) refreshAttachments();

    // Solo lectura si es de otro usuario
    setReadonly(!!d.remoto);

    panel.style.display = 'flex';
  }

  /** Cierra el panel y descarta la selección. */
  function close() {
    ctx.setActiveObj(null);
    const panel = $('annot-panel');
    if (panel) panel.style.display = 'none';
    const markup = ctx.getMarkup();
    if (markup) { markup.canvas.discardActiveObject(); markup.canvas.renderAll(); }
  }

  /** Cierra el panel si estaba abierto (al navegar de página o abrir otro PDF). */
  function closeIfOpen() {
    if ($('annot-panel')?.style.display !== 'none') close();
  }

  /** Muestra/oculta el panel globalmente (botón de la toolbar / tecla P). */
  function toggle() {
    enabled = !enabled;
    if (ctx.btnToggle) {
      ctx.btnToggle.classList.toggle('tb-btn-active', enabled);
      ctx.btnToggle.title = enabled ? 'Ocultar panel de propiedades  (P)' : 'Mostrar panel de propiedades  (P)';
    }
    if (!enabled) {
      const panel = $('annot-panel');
      if (panel) panel.style.display = 'none';
    } else {
      const obj = ctx.getActiveObj();
      if (obj) open(obj);
    }
  }

  return { open, close, closeIfOpen, toggle, refreshAttachments, openAttachment, refreshMeta };
}
