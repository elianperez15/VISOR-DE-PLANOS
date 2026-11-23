/* ──────────────────────────────────────────────────────────────────────
   model-properties-panel.ts — Panel "Propiedades" del elemento seleccionado

   Un elemento: sus datos generales (tipo, nombre, código, nivel, material…)
   y, plegados, los conjuntos de propiedades y cantidades del IFC.
   Varios: cuántos y de qué tipo. Todo como texto (los valores vienen del IFC).
   ────────────────────────────────────────────────────────────────────── */
import type { PropertyRow, SelectionInfo } from './bim-types';
import { numero } from '../compartido/utils/formato';

const EMPTY_HINT = 'Haz clic en un elemento del modelo para ver sus datos. Mayús+clic suma más elementos.';

export function createPropertiesPanel() {
  const root = () => document.getElementById('model-props') as HTMLElement;

  function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) {
    const node = document.createElement(tag);
    node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function table(rows: PropertyRow[]) {
    const dl = el('dl', 'props-table');
    for (const row of rows) dl.append(el('dt', '', row.label), el('dd', '', row.value));
    return dl;
  }

  /** Sección con etiqueta (mismo formato que las del panel de propiedades del plano). */
  function section(label: string, rows: PropertyRow[]) {
    const box = el('div', 'props-section');
    box.append(el('div', 'model-section-label', label), table(rows));
    return box;
  }

  function head(category: string | null, title: string) {
    const box = el('div', 'props-head');
    if (category) box.append(el('span', 'props-category', category));
    box.append(el('h3', 'props-title', title));
    return box;
  }

  function render(info: SelectionInfo | null) {
    const body = root();
    body.replaceChildren();
    if (!info || !info.count) {
      body.append(el('p', 'model-panel-empty', EMPTY_HINT));
      return;
    }
    if (info.element) {
      const { element } = info;
      body.append(head(element.category, element.title), section('Datos generales', element.general));
      element.groups.forEach((group, i) => {
        const details = el('details', 'props-group');
        details.open = i === 0;   // el primero abierto; el resto, a un clic
        details.append(el('summary', '', group.name), table(group.rows));
        body.append(details);
      });
      if (!element.groups.length) body.append(el('p', 'model-panel-empty', 'El IFC no trae más propiedades para este elemento.'));
      return;
    }
    body.append(head(null, `${numero(info.count, 0)} elementos seleccionados`));
    body.append(section('Por tipo de elemento', info.categories.map(c => ({ label: c.category, value: numero(c.count, 0) }))));
    body.append(el('p', 'model-panel-empty', 'Selecciona un solo elemento para ver todos sus datos.'));
  }

  return { render };
}
