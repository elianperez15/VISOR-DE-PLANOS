/* ──────────────────────────────────────────────────────────────────────
   model-tree-panel.ts — Panel "Edificio": niveles y tipos de elemento

   Dos pestañas sobre los mismos elementos, agrupados de otra forma:

     Niveles            Nivel 2 → Losas → sueloAPI:-01
     Tipos de elemento  Losas   → sueloAPI:-01

   Cada fila —del nivel al subtipo— tiene: ojo (ocultar / mostrar), nombre
   (clic: seleccionar y encuadrar) y aislar (ver sólo eso). "Mostrar todo"
   lo restaura.

   Los subgrupos se piden al motor la primera vez que se abre la fila: hay
   que leer los datos de esos elementos y no conviene hacerlo de golpe.

   Los nombres vienen del IFC: se insertan como texto, nunca como HTML.
   ────────────────────────────────────────────────────────────────────── */
import { renderIcons } from '../compartido/ui/icons';
import type { BimEngine } from './bim-engine';
import type { TreeGroup, TreeSection, Visibility } from './bim-types';

export function createTreePanel(getEngine: () => BimEngine | null) {
  const $ = (id: string) => document.getElementById(id) as HTMLElement;
  const rows = new Map<string, HTMLElement>();   // id del grupo → fila (de la pestaña visible)
  let sections: TreeSection[] = [];
  let active = 0;                                // pestaña abierta

  function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) {
    const node = document.createElement(tag);
    node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function icon(name: string) {
    const i = document.createElement('i');
    i.setAttribute('data-lucide', name);
    return i;
  }

  /** Repinta los ojos según lo que de verdad está visible en el modelo. */
  async function refreshVisibility() {
    const engine = getEngine();
    if (!engine || !rows.size) return;
    const states = await engine.structure.visibility();
    for (const [id, row] of rows) {
      const state: Visibility = states[id] || 'visible';
      row.dataset.visibility = state;
      const eye = row.querySelector('.tree-eye') as HTMLElement;
      eye.replaceChildren(icon(state === 'hidden' ? 'eye-off' : 'eye'));
      eye.title = state === 'hidden' ? 'Mostrar' : 'Ocultar';
    }
    renderIcons($('model-tree'));
  }

  /** Ejecuta una acción del árbol con la fila marcada como "trabajando". */
  async function run(row: HTMLElement, action: (engine: BimEngine) => Promise<void>) {
    const engine = getEngine();
    if (!engine) return;
    row.classList.add('is-busy');
    try { await action(engine); } finally { row.classList.remove('is-busy'); }
    await refreshVisibility();
  }

  /** Una fila: ojo · nombre · aislar. Vale para nivel, tipo y subtipo. */
  function groupRow(group: TreeGroup, depth: number): HTMLElement {
    const row = el('div', depth ? 'tree-row tree-row-sub' : 'tree-row');
    row.dataset.visibility = 'visible';

    const eye = el('button', 'tree-eye');
    eye.append(icon('eye'));
    eye.addEventListener('click', () => run(row, engine =>
      engine.structure.setVisible(group.id, row.dataset.visibility === 'hidden')));

    const label = el('button', 'tree-label');
    label.title = 'Seleccionar y encuadrar';
    label.append(el('span', 'tree-name', group.label), el('span', 'tree-count', String(group.count)));
    label.addEventListener('click', () => run(row, async engine => {
      const items = engine.structure.items(group.id);
      await engine.selection.select(items);
      await engine.fitItems(items);
    }));

    const isolate = el('button', 'tree-isolate');
    isolate.title = 'Ver sólo esto';
    isolate.setAttribute('aria-label', 'Aislar');
    isolate.append(icon('focus'));
    isolate.addEventListener('click', () => run(row, async engine => {
      await engine.structure.isolate(group.id);
      await engine.fitItems(engine.structure.items(group.id));
    }));

    row.append(eye, label, isolate);
    rows.set(group.id, row);
    return row;
  }

  /** Fila con sus subgrupos. Se piden al motor la primera vez que se abre. */
  function node(group: TreeGroup, depth: number): HTMLElement {
    const row = groupRow(group, depth);
    if (!group.children) return row;
    const kind = group.children;

    const box = el('div', 'tree-expandable');
    const toggle = el('button', 'tree-toggle');
    toggle.title = kind === 'categories' ? 'Ver tipos de elemento' : 'Ver subtipos';
    toggle.append(icon('chevron-right'));
    row.prepend(toggle);

    const kids = el('div', 'tree-children');
    kids.hidden = true;
    let loaded = false;

    toggle.addEventListener('click', async () => {
      const engine = getEngine();
      if (!engine) return;
      if (!kids.hidden) {                       // plegar
        kids.hidden = true;
        box.classList.remove('is-open');
        return;
      }
      box.classList.add('is-open');
      kids.hidden = false;
      if (loaded) return;
      loaded = true;
      kids.append(el('p', 'tree-loading', 'Leyendo…'));
      try {
        const children = await engine.structure.children(group.id, kind);
        kids.replaceChildren();
        if (!children.length) kids.append(el('p', 'tree-loading', 'Sin subgrupos.'));
        else for (const child of children) kids.append(node(child, depth + 1));
        await refreshVisibility();
      } catch (e) {
        console.error('Desplegar grupo del árbol:', e);
        kids.replaceChildren(el('p', 'tree-loading', 'No se pudo leer este grupo.'));
        loaded = false;                          // permite reintentar
      }
      renderIcons(kids);
    });

    box.append(row, kids);
    return box;
  }

  /** Pinta la pestaña abierta. Cambiar de pestaña repliega, pero los subgrupos
      ya calculados siguen en caché del motor: volver a abrirlos es inmediato. */
  function renderActive() {
    const root = $('model-tree');
    rows.clear();
    root.replaceChildren();
    const section = sections[active];
    if (!section || !section.groups.length) {
      root.append(el('p', 'model-panel-empty', 'El modelo no trae niveles ni tipos de elemento.'));
      return;
    }
    for (const group of section.groups) root.append(node(group, 0));
    renderIcons(root);
    refreshVisibility();
  }

  function renderTabs() {
    const bar = $('model-tree-tabs');
    bar.replaceChildren();
    sections.forEach((section, i) => {
      const tab = el('button', 'model-tab', section.label);
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(i === active));
      tab.classList.toggle('is-active', i === active);
      tab.addEventListener('click', () => {
        if (active === i) return;
        active = i;
        renderTabs();
        renderActive();
      });
      bar.append(tab);
    });
    bar.hidden = sections.length < 2;
  }

  function render(next: TreeSection[]) {
    sections = next;
    active = 0;
    renderTabs();
    renderActive();
  }

  function init() {
    $('btn-tree-show-all').addEventListener('click', async () => {
      const engine = getEngine();
      if (!engine) return;
      await engine.structure.showAll();
      await refreshVisibility();
    });
  }

  return { render, init, refreshVisibility };
}
