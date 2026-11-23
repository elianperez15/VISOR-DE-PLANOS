/* ──────────────────────────────────────────────────────────────────────
   stamp-picker.ts — Modal de sellos y etiquetas

   La herramienta "Sello" guarda el punto clicado (markup._pendingStampPos) y
   abre esta modal; al elegir se coloca:
     .stamp-opt   → sello clásico (inclinado)
     .stamp-label → etiqueta profesional (borde doble, recto; 'hatch' = con trama)
   ────────────────────────────────────────────────────────────────────── */
import type { MarkupLayer } from './lienzo/markup-layer';

export interface StampPickerCtx {
  getMarkup(): MarkupLayer | null;
  activateTool(tool: string): void;
}

export function createStampPicker(ctx: StampPickerCtx) {
  const modal = () => document.getElementById('modal-stamp')!;

  function open() { modal().style.display = 'flex'; }
  function isOpen() { return modal().style.display === 'flex'; }

  function init() {
    document.querySelectorAll<HTMLElement>('.stamp-opt, .stamp-label').forEach(btn => {
      btn.addEventListener('click', () => {
        modal().style.display = 'none';
        const markup = ctx.getMarkup();
        if (!markup || !markup._pendingStampPos) return;
        const { x, y } = markup._pendingStampPos;
        const style = btn.dataset.style || 'stamp';
        if (style === 'label' || style === 'hatch') {
          markup.addLabel(x, y, btn.dataset.stamp, btn.dataset.color, style);
        } else {
          markup.addStamp(x, y, btn.dataset.stamp, btn.dataset.color);
        }
        markup._pendingStampPos = null;
        // Volver a select para poder mover/redimensionar el sello recién colocado
        ctx.activateTool('select');
      });
    });
    document.getElementById('btn-stamp-cancel')!.addEventListener('click', () => {
      modal().style.display = 'none';
      const markup = ctx.getMarkup();
      if (markup) markup._pendingStampPos = null;
      ctx.activateTool('select');   // cancelar también vuelve a select
    });
  }

  return { init, open, isOpen };
}
