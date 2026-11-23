/* ──────────────────────────────────────────────────────────────────────
   model-search-panel.ts — Panel "Buscar": encontrar elementos por nombre

   Escribe un nombre (o parte) y, si quieres, acota por tipo de elemento.

   Los resultados se AGRUPAN por nombre: buscar "sueloAPI" no devuelve 88
   filas iguales, sino una con su cantidad. Pulsar la fila selecciona y
   encuadra las 88; el icono de la derecha las aísla. Con los botones de
   arriba se actúa sobre todos los resultados a la vez.

   Los nombres vienen del IFC: se insertan como texto, nunca como HTML.
   ────────────────────────────────────────────────────────────────────── */
import { renderIcons } from '../compartido/ui/icons';
import type { BimEngine } from './bim-engine';
import type { FindGroup, FindResult } from './bim-types';

/** Espera tras la última tecla antes de buscar: evita una consulta por letra. */
const TYPING_DELAY = 300;

export function createSearchPanel(getEngine: () => BimEngine | null) {
  const $ = (id: string) => document.getElementById(id) as any;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let last: FindResult = { total: 0, groups: [], truncated: false };
  let seq = 0;   // una búsqueda nueva descarta el resultado de la anterior

  function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) {
    const node = document.createElement(tag);
    node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  /** Pinta el aviso de la cabecera y habilita las acciones según haya resultados. */
  function renderSummary(message: string) {
    $('model-search-summary').textContent = message;
    const none = last.total === 0;
    $('btn-search-select-all').disabled = none;
    $('btn-search-isolate').disabled = none;
  }


  /** Ejecuta una acción con la fila marcada como "trabajando".
      (`run` sin argumentos es otra cosa: la que lanza la búsqueda.) */
  async function withBusy(row: HTMLElement, action: (engine: BimEngine) => Promise<void>) {
    const engine = getEngine();
    if (!engine) return;
    row.classList.add('is-busy');
    try { await action(engine); } finally { row.classList.remove('is-busy'); }
  }

  /** Una fila por nombre: nombre · tipo · cuántos hay · aislar. */
  function groupRow(group: FindGroup): HTMLElement {
    const row = el('div', 'search-row');

    const label = el('button', 'search-label');
    label.title = `Seleccionar y encuadrar ${group.count === 1 ? 'el elemento' : `los ${group.count} elementos`}`;
    const text = el('span', 'search-text');
    text.append(el('span', 'search-name', group.name), el('span', 'search-category', group.category));
    label.append(text, el('span', 'search-count', String(group.count)));
    label.addEventListener('click', () => withBusy(row, async engine => {
      const items = engine.finder.group(group.id);
      await engine.selection.select(items);
      await engine.fitItems(items);
    }));

    const isolate = el('button', 'search-isolate');
    isolate.title = 'Ver sólo estos';
    isolate.setAttribute('aria-label', 'Aislar');
    const i = document.createElement('i');
    i.setAttribute('data-lucide', 'focus');
    isolate.append(i);
    isolate.addEventListener('click', () => withBusy(row, async engine => {
      const items = engine.finder.group(group.id);
      await engine.structure.isolateItems(items);
      await engine.fitItems(items);
    }));

    row.append(label, isolate);
    return row;
  }

  function renderResults(result: FindResult) {
    last = result;
    const root = $('model-search-results');
    root.replaceChildren();

    if (!result.total) {
      renderSummary('');
      root.append(el('p', 'model-panel-empty', 'Sin resultados. Prueba con otra parte del nombre.'));
      return;
    }

    renderSummary(result.total === 1 ? '1 elemento' : `${result.total} elementos`);

    for (const group of result.groups) root.append(groupRow(group));
    renderIcons(root);

    if (result.truncated) {
      root.append(el('p', 'model-panel-note',
        'Hay más elementos de los que se pudieron agrupar. Acota la búsqueda para verlos todos.'));
    }
  }

  async function run() {
    const engine = getEngine();
    if (!engine) return;
    const text = $('model-search-text').value as string;
    const category = ($('model-search-category').value as string) || null;
    const mine = ++seq;

    if (!text.trim() && !category) {
      last = { total: 0, groups: [], truncated: false };
      $('model-search-results').replaceChildren();
      renderSummary('');
      return;
    }

    renderSummary('Buscando…');
    try {
      const result = await engine.finder.search(text, category);
      if (mine !== seq) return;   // llegó otra búsqueda mientras tanto
      renderResults(result);
    } catch (e) {
      if (mine !== seq) return;
      console.error('Buscar en el modelo:', e);
      last = { total: 0, groups: [], truncated: false };
      $('model-search-results').replaceChildren(
        el('p', 'model-panel-empty', 'No se pudo completar la búsqueda.'));
      renderSummary('');
    }
  }

  /** Busca tras una pausa al escribir (el desplegable y Enter buscan ya). */
  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, TYPING_DELAY);
  }

  /** Llena el desplegable de tipos con lo que trae el modelo recién abierto. */
  async function load() {
    const engine = getEngine();
    const select = $('model-search-category') as HTMLSelectElement;
    select.replaceChildren(new Option('Todos los tipos', ''));
    if (!engine) return;
    try {
      for (const category of await engine.finder.categories()) {
        select.append(new Option(category.label, category.id));
      }
    } catch (e) {
      console.error('Tipos de elemento para buscar:', e);
    }
  }

  /** Vacía el panel (al abrir otro modelo o cerrar el actual). */
  function reset() {
    if (timer) { clearTimeout(timer); timer = null; }
    seq++;   // descarta cualquier búsqueda en vuelo del modelo anterior
    last = { total: 0, groups: [], truncated: false };
    $('model-search-text').value = '';
    ($('model-search-category') as HTMLSelectElement).replaceChildren(new Option('Todos los tipos', ''));
    $('model-search-results').replaceChildren();
    renderSummary('');
  }

  function init() {
    $('model-search-text').addEventListener('input', schedule);
    $('model-search-text').addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key !== 'Enter') return;
      if (timer) { clearTimeout(timer); timer = null; }
      run();
    });
    $('model-search-category').addEventListener('change', run);

    $('btn-search-select-all').addEventListener('click', async () => {
      const engine = getEngine();
      if (!engine) return;
      const items = engine.finder.items();
      await engine.selection.select(items);
      await engine.fitItems(items);
    });

    // Deshacer el aislado sin tener que ir al panel Edificio
    $('btn-search-show-all').addEventListener('click', async () => {
      const engine = getEngine();
      if (!engine) return;
      await engine.structure.showAll();
    });

    $('btn-search-isolate').addEventListener('click', async () => {
      const engine = getEngine();
      if (!engine) return;
      const items = engine.finder.items();
      await engine.structure.isolateItems(items);
      await engine.fitItems(items);
    });

    renderSummary('');
  }

  return { init, load, reset };
}
