/* ──────────────────────────────────────────────────────────────────────
   attachments.ts — Imágenes y archivos adjuntos a las figuras

     · Herramienta "Imagen": pin de foto clavado en el plano.
     · Adjuntos del pin (panel de propiedades): agregar, imagen principal,
       quitar, ampliar.
     · Mini-toolbar flotante sobre la figura: mostrar/ocultar la previa y
       ampliarla en el lightbox.

   Las imágenes se optimizan antes de guardarse (máx. 1920 px, recomprimidas):
   una foto de varios MB queda en ~200 KB.
   ────────────────────────────────────────────────────────────────────── */
import { renderIcons } from '../compartido/ui/icons';
import { downscaleImage } from '../compartido/utils/image-utils';
import type { ConfirmDialog } from '../compartido/ui/confirm';
import type { MarkupLayer } from './lienzo/markup-layer';
import type { PropertiesPanel } from './properties-panel';

const MAX_ATTACHMENT_BYTES         = 25 * 1024 * 1024;  // 25 MB por adjunto
const ATTACHMENT_MAX_DIM           = 1920;              // px máximos al redimensionar imágenes
const ATTACHMENT_JPEG_QUALITY      = 0.82;              // calidad al adjuntar al pin
const ATTACHMENT_JPEG_QUALITY_FILE = 0.85;              // calidad al colocar una imagen nueva

export interface AttachmentsCtx {
  getMarkup(): MarkupLayer | null;
  panel: PropertiesPanel;
  activateTool(tool: string): void;
  confirm: ConfirmDialog;
}

export function createAttachments(ctx: AttachmentsCtx) {
  const $ = (id: string) => document.getElementById(id) as any;

  /** Abre una imagen en grande. */
  function showImage(src: string) {
    $('att-lightbox-img').src = src;
    $('att-lightbox').style.display = 'flex';
  }

  /** La herramienta "Imagen" pide el archivo a colocar. */
  function pickImageToPlace() {
    const input = $('img-place-input');
    input.value = '';
    input.click();
  }

  /** Posiciona la mini-toolbar sobre la figura seleccionada (si tiene imagen adjunta). */
  function updateFigToolbar() {
    const toolbar = $('fig-toolbar');
    const markup = ctx.getMarkup();
    if (!toolbar || !markup) return;
    const obj = markup.canvas.getActiveObject();
    if (!obj || !obj.data || !markup._firstImageAttachment(obj)) {
      if (toolbar.style.display !== 'none') { toolbar.style.display = 'none'; toolbar.dataset.shown = ''; }
      return;
    }
    obj.setCoords();
    const tl = obj.aCoords.tl, tr = obj.aCoords.tr;
    const sx = (tl.x + tr.x) / 2, sy = Math.min(tl.y, tr.y);
    const v = markup.canvas.viewportTransform;                 // [zoom,0,0,zoom,tx,ty]
    const px = v[0] * sx + v[2] * sy + v[4];
    const py = v[1] * sx + v[3] * sy + v[5];
    const r = markup.canvas.upperCanvasEl.getBoundingClientRect();
    toolbar.style.left = (r.left + px) + 'px';
    toolbar.style.top  = (r.top + py - 40) + 'px';
    toolbar.style.display = 'flex';
    const shown = obj.data.attShown !== false;
    if (toolbar.dataset.shown !== String(shown)) {             // solo redibuja el icono si cambió
      toolbar.dataset.shown = String(shown);
      const btn = $('fig-toggle-att');
      btn.classList.toggle('on', shown);
      btn.title = shown ? 'Ocultar adjunto en el plano' : 'Mostrar adjunto en el plano';
      btn.innerHTML = `<i data-lucide="${shown ? 'eye-off' : 'eye'}"></i>`;
      renderIcons();
    }
  }

  /** Lee y adjunta los archivos elegidos a la figura activa. */
  function attachFiles(files: File[]) {
    const markup = ctx.getMarkup();
    const target = ctx.panel.getActive();   // figura fija aunque cambie la selección durante la lectura
    if (!target || !files.length) return;
    if (!target.data) target.data = {};
    if (!target.data.adjuntos) target.data.adjuntos = [];
    let pending = files.length;
    const done = () => {
      if (--pending !== 0) return;
      ctx.panel.refreshAttachments();
      markup && markup.refreshThumb(target);
      markup && markup._snapshot();
    };
    files.forEach(file => {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        alert(`"${file.name}" supera 25 MB. Adjunta un archivo más liviano.`);
        done(); return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const raw = reader.result;
        if ((file.type || '').startsWith('image/')) {
          downscaleImage(raw, file.type, ATTACHMENT_MAX_DIM, ATTACHMENT_JPEG_QUALITY, (outUrl, outType) => {
            target.data.adjuntos.push({ name: file.name, type: outType, size: outUrl.length, dataUrl: outUrl, optimizada: true });
            done();
          });
        } else {
          target.data.adjuntos.push({ name: file.name, type: file.type, size: file.size, dataUrl: raw });
          done();
        }
      };
      reader.onerror = done;
      reader.readAsDataURL(file);
    });
  }

  /** Coloca la imagen elegida como pin de foto en el plano. */
  function placeImage(file: File | undefined) {
    const markup = ctx.getMarkup();
    if (!file || !markup) { ctx.activateTool('select'); return; }
    if (!file.type.startsWith('image/')) { alert('Selecciona un archivo de imagen.'); ctx.activateTool('select'); return; }
    if (file.size > MAX_ATTACHMENT_BYTES) { alert(`"${file.name}" supera 25 MB. Elige una imagen más liviana.`); ctx.activateTool('select'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      downscaleImage(reader.result, file.type, ATTACHMENT_MAX_DIM, ATTACHMENT_JPEG_QUALITY_FILE, (outUrl, outType) => {
        markup.placePendingImage(outUrl, file.name, outType);
        ctx.activateTool('select');
      });
    };
    reader.onerror = () => { alert('No se pudo leer la imagen.'); ctx.activateTool('select'); };
    reader.readAsDataURL(file);
  }

  /** Acciones del carrusel de adjuntos del panel. */
  function onCarouselAction(btn: HTMLElement) {
    const markup = ctx.getMarkup();
    const obj = ctx.panel.getActive();
    if (!obj) return;
    const act = btn.dataset.act;
    if (act === 'prev') { ctx.panel.navAtt(-1); return; }
    if (act === 'next') { ctx.panel.navAtt(1);  return; }
    if (act === 'goto') { ctx.panel.gotoAtt(parseInt(btn.dataset.i, 10)); return; }

    const list = obj.data?.adjuntos || [];
    const i = parseInt(btn.dataset.i, 10);
    const attachment = list[i];
    if (!attachment) return;

    // Marcar como imagen principal (la que se muestra en el plano)
    if (act === 'principal') {
      obj.data.principal = i;
      ctx.panel.refreshAttachments();
      markup && markup.refreshThumb(obj);
      markup?.commitChange();
      return;
    }
    if (act === 'del') {
      ctx.confirm.open({
        title: 'Quitar adjunto', message: `¿Quitar "${attachment.name}" de esta figura?`,
        okText: 'Quitar', danger: true,
        onConfirm: () => {
          obj.data.adjuntos.splice(i, 1);
          // Reajustar el índice de la imagen principal tras el borrado
          let principal = (typeof obj.data.principal === 'number') ? obj.data.principal : 0;
          if (i < principal) principal--; else if (i === principal) principal = 0;
          obj.data.principal = Math.max(0, Math.min(principal, obj.data.adjuntos.length - 1));
          ctx.panel.refreshAttachments();
          markup && markup.refreshThumb(obj);
          markup?.commitChange();
        },
      });
      return;
    }
    // 'open' → ampliar en el lightbox
    ctx.panel.openAttachment(attachment);
  }

  function init() {
    $('btn-ap-attach')?.addEventListener('click', () => $('ap-att-input').click());
    $('ap-att-input')?.addEventListener('change', (e: any) => {
      const files = Array.from(e.target.files || []) as File[];
      e.target.value = '';
      attachFiles(files);
    });
    $('img-place-input')?.addEventListener('change', (e: any) => {
      const file = (e.target.files || [])[0];
      e.target.value = '';
      placeImage(file);
    });
    $('ap-att-grid')?.addEventListener('click', (e: any) => {
      const btn = e.target.closest('[data-act]');
      if (btn) onCarouselAction(btn);
    });
    $('att-lightbox')?.addEventListener('click', () => { $('att-lightbox').style.display = 'none'; });

    // Mini-toolbar: mostrar/ocultar el adjunto sobre la figura
    $('fig-toggle-att')?.addEventListener('click', () => {
      const markup = ctx.getMarkup();
      const obj = markup && markup.canvas.getActiveObject();
      if (!obj || !obj.data || obj.data.remoto) return;   // no modificar figuras ajenas
      obj.data.attShown = obj.data.attShown === false;    // alterna
      markup.refreshThumb(obj);
      markup._snapshot();
      $('fig-toolbar').dataset.shown = '';                // fuerza refresco del icono
      updateFigToolbar();
    });
    // Mini-toolbar: ampliar la imagen en el lightbox
    $('fig-enlarge-att')?.addEventListener('click', () => {
      const markup = ctx.getMarkup();
      const obj = markup && markup.canvas.getActiveObject();
      const attachment = obj && markup._firstImageAttachment(obj);
      if (attachment) showImage(attachment.dataUrl);
    });
  }

  return { init, showImage, pickImageToPlace, updateFigToolbar };
}
