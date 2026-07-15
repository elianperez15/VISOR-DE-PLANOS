/* ──────────────────────────────────────────────────────────────────────
   list-picker.ts — Modal genérico de selección con buscador

   Reutilizable para cualquier listado (planos, RFIs, …): muestra un modal
   con buscador y una lista filtrable. El contexto define de dónde salen los
   ítems, cómo mostrarlos y qué hacer al elegir uno. Comparte el estilo CSS
   del selector de planos (.plano-pick-card / .plano-search / .plano-list).
   ────────────────────────────────────────────────────────────────────── */
import { renderIcons } from '../ui/icons';

export interface ListPickerCtx {
  ids: { modal: string; search: string; list: string; close: string };
  fetchItems: () => Promise<any[]>;                 // carga (se cachea)
  toRow: (item: any) => { value: string; label: string };
  onPick: (target: any, value: string, label: string, item: any) => void;
  icon?: string;            // icono Lucide de cada fila (def. file-text)
  loadingText?: string;
  emptyText?: string;
}

export function createListPicker(ctx: ListPickerCtx) {
  const $ = (id: string) => document.getElementById(id) as any;
  const icon = ctx.icon || 'file-text';
  let cache: any[] | null = null;
  let target: any = null;

  function close() { const m = $(ctx.ids.modal); if (m) m.style.display = 'none'; }

  /** Abre el modal para asignar al objeto `t`. */
  async function open(t: any) {
    target = t;
    const modal = $(ctx.ids.modal);
    if (!modal) return;
    $(ctx.ids.search).value = '';
    modal.style.display = 'flex';
    $(ctx.ids.search).focus();
    if (cache) { render(); return; }
    $(ctx.ids.list).innerHTML = `<div class="plano-empty">${ctx.loadingText || 'Cargando…'}</div>`;
    try {
      cache = await ctx.fetchItems();
    } catch (e: any) {
      $(ctx.ids.list).innerHTML = `<div class="plano-empty">No se pudo cargar (${e.message})</div>`;
      return;
    }
    render();
  }

  function render() {
    const cont = $(ctx.ids.list);
    if (!cont) return;
    const q = ($(ctx.ids.search).value || '').toLowerCase().trim();
    const rows = (cache || [])
      .map(it => ({ it, ...ctx.toRow(it) }))
      .filter(r => !q || String(r.label).toLowerCase().includes(q));
    if (!rows.length) { cont.innerHTML = `<div class="plano-empty">${ctx.emptyText || 'Sin resultados'}</div>`; return; }
    cont.innerHTML = rows.map(r => {
      const label = String(r.label).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
      const value = String(r.value).replace(/"/g, '&quot;');
      return `<button class="plano-row" data-value="${value}"><i data-lucide="${icon}"></i><span>${label}</span></button>`;
    }).join('');
    renderIcons();
  }

  /** Enlaza los eventos del modal (una vez al inicio). */
  function init() {
    $(ctx.ids.close)?.addEventListener('click', close);
    $(ctx.ids.modal)?.addEventListener('click', (e: any) => {
      if (e.target.id === ctx.ids.modal) close();
    });
    $(ctx.ids.search)?.addEventListener('input', render);
    $(ctx.ids.list)?.addEventListener('click', (e: any) => {
      const row = e.target.closest('.plano-row');
      if (!row) return;
      const value = row.dataset.value;
      const item = (cache || []).find(it => String(ctx.toRow(it).value) === value);
      const label = row.querySelector('span')?.textContent || value;
      if (target) ctx.onPick(target, value, label, item);
      close();
    });
  }

  return { open, init };
}
