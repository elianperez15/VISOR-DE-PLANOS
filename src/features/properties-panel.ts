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
    // fecha (Date) y prioridad (enum) son valores controlados → seguro como HTML.
    const parts = [];
    if (fecha)       parts.push(fecha);
    if (tipo)        parts.push(`<i data-lucide="${tipo.icon}"></i> ${tipo.label}`);
    if (d.prioridad) parts.push(String(d.prioridad));
    const el = $('ap-id-meta');
    el.innerHTML = parts.join('  ·  ');
    renderIcons(el);
  }

  /** Modo solo-lectura (figura de otro usuario). */
  function setReadonly(ro: boolean) {
    ['ap-label','ap-stroke','ap-fill','ap-stroke-w','ap-font-size','ap-opacity','ap-desc','ap-link-page',
     'btn-ap-pick-plano','btn-ap-clear-plano','btn-ap-pick-rfi','btn-ap-clear-rfi']
      .forEach(id => { const el = $(id); if (el) el.disabled = ro; });
    const attach = $('btn-ap-attach'); if (attach) attach.style.display = ro ? 'none' : '';
    const panel  = $('annot-panel');   if (panel)  panel.classList.toggle('ap-readonly', ro);
    const banner = $('ap-readonly-banner'); if (banner) banner.style.display = ro ? 'flex' : 'none';
  }

  let carIndex = 0;   // imagen/adjunto actual del carrusel

  /** Navega el carrusel (dir: -1 / +1) de forma circular. */
  function navAtt(dir: number) {
    const obj = ctx.getActiveObj();
    const n = ((obj && obj.data && obj.data.adjuntos) || []).length;
    if (!n) return;
    carIndex = (carIndex + dir + n) % n;
    refreshAttachments();
  }
  /** Salta a un adjunto concreto del carrusel. */
  function gotoAtt(i: number) { carIndex = i; refreshAttachments(); }
  /** Reinicia el carrusel (al abrir otra figura): muestra la principal. */
  function resetCarousel() {
    const obj = ctx.getActiveObj();
    const p = obj?.data?.principal;
    carIndex = (typeof p === 'number' && p >= 0) ? p : 0;
  }

  /** Pinta el CARRUSEL de adjuntos de la figura activa (con imagen principal). */
  function refreshAttachments() {
    const grid = $('ap-att-grid');
    if (!grid) return;
    const obj = ctx.getActiveObj();
    const list = (obj && obj.data && obj.data.adjuntos) || [];
    $('ap-att-count').textContent = list.length ? `(${list.length})` : '';

    if (!list.length) { grid.innerHTML = '<div class="ap-car-empty">Sin adjuntos aún</div>'; return; }
    if (carIndex >= list.length) carIndex = list.length - 1;
    if (carIndex < 0) carIndex = 0;

    const principal = (typeof obj.data.principal === 'number') ? obj.data.principal : 0;
    const a = list[carIndex];
    const isImg = (a.type || '').startsWith('image/');
    const isPrincipal = carIndex === principal;
    const preview = isImg
      ? `<img class="ap-car-img" src="${a.dataUrl}" alt="">`
      : `<span class="ap-car-fileicon"><i data-lucide="file"></i></span>`;
    const many = list.length > 1;

    grid.innerHTML = `
      <div class="ap-carousel">
        <div class="ap-car-stage">
          ${many ? `<button class="ap-car-nav ap-car-prev" data-act="prev" title="Anterior"><i data-lucide="chevron-left"></i></button>` : ''}
          <button class="ap-car-viewport" data-act="open" data-i="${carIndex}" title="Ampliar">${preview}</button>
          ${many ? `<button class="ap-car-nav ap-car-next" data-act="next" title="Siguiente"><i data-lucide="chevron-right"></i></button>` : ''}
          ${isPrincipal && isImg ? `<span class="ap-car-badge"><i data-lucide="star"></i> Principal</span>` : ''}
        </div>
        <div class="ap-car-meta">
          <span class="ap-car-name" title="${a.name}">${a.name}</span>
          <span class="ap-car-count">${carIndex + 1} / ${list.length}</span>
        </div>
        <div class="ap-car-actions">
          <button class="ap-car-btn" data-act="principal" data-i="${carIndex}" ${(!isImg || isPrincipal) ? 'disabled' : ''} title="Marcar como imagen principal">
            <i data-lucide="star"></i> ${isPrincipal ? 'Es principal' : 'Hacer principal'}
          </button>
          <button class="ap-car-btn" data-act="open" data-i="${carIndex}" title="Ampliar"><i data-lucide="maximize"></i></button>
          <button class="ap-car-btn ap-car-btn-del" data-act="del" data-i="${carIndex}" title="Quitar"><i data-lucide="trash-2"></i></button>
        </div>
        ${many ? `<div class="ap-car-dots">${list.map((_: any, i: number) =>
          `<button class="ap-car-dot${i === carIndex ? ' on' : ''}${i === principal ? ' principal' : ''}" data-act="goto" data-i="${i}" title="Ir a ${i + 1}"></button>`
        ).join('')}</div>` : ''}
      </div>`;
    renderIcons(grid);
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
    $('ap-label').value = markup ? markup.getAnnotText(obj) : '';

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

    // RFI (sello RFI o nube RFI) → muestra el RFI vinculado; se elige con el picker
    const isRfiStamp = d.type === 'stamp' && String(d.label || '').toUpperCase() === 'RFI';
    const isRfiCloud = d.type === 'cloud' && d.isRfi;
    const isRfi = isRfiStamp || isRfiCloud;
    const rfiSec = $('ap-rfi-section');
    if (rfiSec) rfiSec.style.display = isRfi ? 'block' : 'none';
    if (isRfi) {
      const linked = d.rfiId != null && String(d.rfiId).trim() !== '';
      const nm = $('ap-rfi-name');
      if (nm) nm.textContent = d.rfiLabel || (linked ? `RFI ${d.rfiId}` : '— sin RFI —');
      // Nube RFI ya vinculada: no se puede cambiar ni quitar el RFI (bloqueado)
      const lockRfi = isRfiCloud && linked;
      const pickBtn = $('btn-ap-pick-rfi'), clearBtn = $('btn-ap-clear-rfi');
      if (pickBtn)  pickBtn.style.display  = lockRfi ? 'none' : '';
      if (clearBtn) clearBtn.style.display = lockRfi ? 'none' : '';
    }

    // "Texto en la figura": no aplica a la nube RFI ni a la imagen (pin de foto).
    const isPhotoPin = (d.type === 'photo-pin');
    $('ap-text-section').style.display       = (isRfiCloud || isPhotoPin) ? 'none' : 'block';
    $('ap-appearance-section').style.display = isRfiCloud ? 'none' : 'block';

    // Figuras de texto (texto/nota/globo): sin "grosor", con "tamaño de texto".
    const isTextType = ['text', 'note', 'callout'].includes(d.type);
    const fStroke = $('ap-field-stroke-w'), fFont = $('ap-field-font-size');
    if (fStroke) fStroke.style.display = isTextType ? 'none' : '';
    if (fFont)   fFont.style.display   = isTextType ? '' : 'none';
    if (isTextType && markup) {
      const fs = markup.getObjFontSize(obj);
      $('ap-font-size').value = fs;
      $('ap-font-size-val').textContent = fs;
    }

    // Adjuntos (solo el pin de foto)
    $('ap-att-section').style.display = isPhotoPin ? 'block' : 'none';
    if (isPhotoPin) { resetCarousel(); refreshAttachments(); }

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

  return { open, close, closeIfOpen, toggle, refreshAttachments, openAttachment, refreshMeta, navAtt, gotoAtt };
}
