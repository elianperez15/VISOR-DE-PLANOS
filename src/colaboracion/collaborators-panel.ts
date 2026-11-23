/* ──────────────────────────────────────────────────────────────────────
   collaborators-panel.ts — Lista de colaboradores del plano (menú Marcas)

   Une los usuarios conectados en vivo (presencia por WebSocket) con los
   autores que tienen marcas en la página. Marca quién está en línea y
   permite ocultar/mostrar las marcas de cada autor.
   ────────────────────────────────────────────────────────────────────── */
import { renderIcons } from '../compartido/ui/icons';
import { escapeHtml } from '../compartido/utils/html';
import { getUserColor } from '../usuario/user-colors';
import type { MarkupLayer } from '../anotaciones/lienzo/markup-layer';
import type { Peer } from './collab';

export interface CollaboratorsPanelCtx {
  getMarkup(): MarkupLayer | null;
  getUser(): string;
  presence: Map<string, Peer>;
}

export function createCollaboratorsPanel(ctx: CollaboratorsPanelCtx) {
  /** Reconstruye la lista (al abrir el menú, al cambiar de página o la presencia). */
  function render() {
    const list = document.getElementById('authors-list');
    if (!list) return;
    const markup = ctx.getMarkup();
    const me = ctx.getUser();
    const authors = markup ? markup.getAuthors() : [];   // [{ name, count }]
    const countByName: Record<string, number> = {};
    authors.forEach(a => { countByName[a.name] = a.count; });

    // Conectados: yo siempre + los peers presentes en la sala
    const online = new Set<string>([me]);
    ctx.presence.forEach(p => p && p.user && online.add(p.user));

    // Lista final: conectados + autores con marcas (sin duplicados)
    const names = [...new Set([...online, ...authors.map(a => a.name)])];
    if (!names.length) {
      list.innerHTML = '<div class="author-empty">Sin colaboradores aún</div>';
      return;
    }

    list.innerHTML = names.map(name => {
      const safe      = escapeHtml(name);
      const isCurrent = (name === me);
      const isOnline  = online.has(name);
      const count     = countByName[name] || 0;
      const hidden    = markup ? markup.isAuthorHidden(name) : false;
      return `<div class="author-row${isCurrent ? ' author-current' : ''}${isOnline ? ' author-online' : ''}${hidden ? ' author-hidden' : ''}" data-author="${safe}">
        <span class="author-dot" style="background:${getUserColor(name)}"></span>
        <span class="author-name">${safe}${isCurrent ? ' (tú)' : ''}</span>
        ${isOnline ? '<span class="author-presence-badge"><span class="live-dot"></span> en línea</span>' : ''}
        ${count ? `<span class="author-count">${count}</span>` : ''}
        <button class="author-toggle" data-author="${safe}" title="${hidden ? 'Mostrar anotaciones' : 'Ocultar anotaciones'}"><i data-lucide="${hidden ? 'eye-off' : 'eye'}"></i></button>
      </div>`;
    }).join('');
    renderIcons(list);

    // Ojo: alterna la visibilidad de las marcas del autor (el estado vive en el
    // lienzo, así sobrevive a las reconstrucciones de la lista).
    list.querySelectorAll<HTMLElement>('.author-toggle').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const markup = ctx.getMarkup();
        if (!markup) return;
        const name      = btn.dataset.author;
        const nowHidden = !markup.isAuthorHidden(name);
        markup.filterByAutor(name, !nowHidden);
        btn.closest('.author-row').classList.toggle('author-hidden', nowHidden);
        btn.title = nowHidden ? 'Mostrar anotaciones' : 'Ocultar anotaciones';
        btn.innerHTML = `<i data-lucide="${nowHidden ? 'eye-off' : 'eye'}"></i>`;
        renderIcons(btn);
      });
    });
  }

  /** Al abrir el menú de Marcas, refrescar la lista. */
  function init() {
    document.getElementById('btn-markup-menu')?.addEventListener('click', render);
  }

  return { init, render };
}
