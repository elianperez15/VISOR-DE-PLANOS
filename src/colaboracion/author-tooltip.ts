/* ──────────────────────────────────────────────────────────────────────
   author-tooltip.ts — Tooltip flotante con el autor de la marca bajo el cursor
   ────────────────────────────────────────────────────────────────────── */
import { fechaHora } from '../compartido/utils/formato';
import { renderIcons } from '../compartido/ui/icons';
import { escapeHtml } from '../compartido/utils/html';
import { getUserColor } from '../usuario/user-colors';
import { ANNOT_TYPES } from '../anotaciones/tool-defs';

/** Muestra el autor/fecha de la marca (`data` = obj.data) o lo oculta (data = null). */
export function showAuthorTooltip(data: any, evt: MouseEvent | null): void {
  const tip = document.getElementById('annot-tooltip');
  if (!tip) return;
  if (!data) { tip.style.display = 'none'; return; }

  const author = data.autor || 'Anónimo';
  const date = data.fecha
    ? fechaHora(data.fecha)
    : '';
  const type = ANNOT_TYPES.find(t => t.id === (data.tipoAnnot || ''));
  const priority = data.prioridad ? escapeHtml(data.prioridad) : '';

  tip.innerHTML =
    `<span class="tip-dot" style="background:${getUserColor(author)}"></span>` +
    `<span class="tip-autor">${escapeHtml(author)}</span>` +
    (date     ? `<span class="tip-fecha">${date}</span>` : '') +
    (type     ? `<span class="tip-type"><i data-lucide="${type.icon}"></i> ${type.label}</span>` : '') +
    (priority ? `<span class="tip-fecha tip-prio-${priority}"><i data-lucide="flag"></i> ${priority}</span>` : '');
  renderIcons(tip);

  // Al lado del cursor, sin salirse del viewport
  tip.style.left    = ((evt?.clientX || 0) + 16) + 'px';
  tip.style.top     = ((evt?.clientY || 0) - 12) + 'px';
  tip.style.display = 'flex';
  requestAnimationFrame(() => {
    const r = tip.getBoundingClientRect();
    if (r.right  > window.innerWidth  - 8) tip.style.left = (window.innerWidth  - r.width  - 8) + 'px';
    if (r.bottom > window.innerHeight - 8) tip.style.top  = (window.innerHeight - r.height - 8) + 'px';
  });
}
