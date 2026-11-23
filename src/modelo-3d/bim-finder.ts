/* ──────────────────────────────────────────────────────────────────────
   bim-finder.ts — Búsqueda de elementos en el modelo (ItemsFinder)

   Busca por NOMBRE (atributo Name del IFC) y/o por tipo de elemento, y
   devuelve los resultados listos para seleccionar, encuadrar o aislar.

   Complementa al árbol (bim-structure): el árbol navega el edificio por
   niveles y tipos; esto responde "¿dónde está la puerta P-07?".

   Lo que el usuario escribe se trata como TEXTO LITERAL: se escapa antes de
   armar la expresión regular, porque ItemsFinder consulta con regex y un
   carácter suelto como "(" reventaría la búsqueda.

   Los tipos que comparten nombre en español (IFCWALL + IFCWALLSTANDARDCASE
   = "Muros") se ofrecen como una sola opción, igual que en el árbol.
   ────────────────────────────────────────────────────────────────────── */
import * as OBC from '@thatopen/components';
import type { ItemData, ItemsQueryParams } from '@thatopen/fragments';
import type { BimContext } from './bim-engine';
import type { FindCategory, FindGroup, FindResult } from './bim-types';
import { categoryName } from './ifc-names';

/** Cuántos elementos se leen para agruparlos por nombre. Más alto que antes
    porque ahora el nombre hace falta para AGRUPAR, no sólo para listar: 3000
    elementos suelen caber en unas pocas decenas de grupos. El resto cuenta en
    el total y se avisa de que quedó fuera. */
const NAMES_LIMIT = 3000;

const OFF = { attributes: false, relations: false };

export interface BimFinder {
  /** Tipos de elemento presentes en el modelo, para el desplegable. */
  categories(): Promise<FindCategory[]>;
  /** Busca por nombre y/o tipo. Sin ningún criterio devuelve vacío. */
  search(text: string, category: string | null): Promise<FindResult>;
  /** Todos los elementos de la última búsqueda. */
  items(): OBC.ModelIdMap;
  /** Los elementos de un grupo (todos los que comparten ese nombre). */
  group(id: string): OBC.ModelIdMap;
  reset(): void;
}

const attr = (item: ItemData | undefined, name: string): any => (item?.[name] as any)?.value;

/** El texto del usuario es literal, no una expresión regular. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const countItems = (map: OBC.ModelIdMap) =>
  Object.values(map).reduce((n, ids) => n + ids.size, 0);

export function createFinder(ctx: BimContext): BimFinder {
  const finder = ctx.components.get(OBC.ItemsFinder);
  let last: OBC.ModelIdMap = {};
  /** id de grupo → sus elementos. Se rehace en cada búsqueda. */
  const groups = new Map<string, OBC.ModelIdMap>();
  let seq = 0;   // una búsqueda nueva descarta el resultado de la anterior

  return {
    async categories() {
      // Varios tipos IFC comparten nombre en español: se agrupan bajo una
      // sola opción y la consulta se arma con todos sus tipos.
      const byLabel = new Map<string, string[]>();
      for (const model of ctx.fragments.list.values()) {
        for (const category of await model.getCategories()) {
          const label = categoryName(category);
          let ids = byLabel.get(label);
          if (!ids) byLabel.set(label, ids = []);
          if (!ids.includes(category)) ids.push(category);
        }
      }
      return [...byLabel]
        .map(([label, ids]): FindCategory => ({ id: ids.join('|'), label }))
        .sort((a, b) => a.label.localeCompare(b.label, 'es'));
    },

    async search(text, category) {
      const term = text.trim();
      const mine = ++seq;
      if (!term && !category) { last = {}; groups.clear(); return { total: 0, groups: [], truncated: false }; }

      const query: ItemsQueryParams = {};
      if (category) {
        query.categories = category.split('|').map(c => new RegExp(`^${escapeRegExp(c)}$`, 'i'));
      }
      if (term) {
        query.attributes = { queries: [{ name: /^Name$/, value: new RegExp(escapeRegExp(term), 'i') }] };
      }

      const map = await finder.getItems([query]);
      if (mine !== seq) return { total: 0, groups: [], truncated: false };   // llegó otra búsqueda
      last = map;

      // Se leen los nombres (sin relaciones: basta el nombre y la clase) y se
      // agrupan: los elementos que comparten nombre son una sola fila.
      groups.clear();
      const byName = new Map<string, { name: string; category: string; items: OBC.ModelIdMap }>();
      let budget = NAMES_LIMIT;
      let read = 0;
      for (const [modelId, ids] of Object.entries(map)) {
        const model = ctx.fragments.list.get(modelId);
        if (!model || budget <= 0) continue;
        const slice = [...ids].slice(0, budget);
        budget -= slice.length;
        read += slice.length;
        const items = await model.getItemsData(slice, { attributesDefault: true, relationsDefault: OFF });
        if (mine !== seq) return { total: 0, groups: [], truncated: false };
        items.forEach((item, i) => {
          const category = categoryName(attr(item, '_category'));
          const name = String(attr(item, 'Name') || attr(item, 'ObjectType') || '').trim() || category;
          // Dos categorías podrían compartir nombre: la clave lleva ambas
          const key = `${category}\u0000${name}`;
          let entry = byName.get(key);
          if (!entry) byName.set(key, entry = { name, category, items: {} });
          (entry.items[modelId] || (entry.items[modelId] = new Set<number>())).add(slice[i]);
        });
      }

      let n = 0;
      const result: FindGroup[] = [...byName.values()]
        .sort((a, b) => a.category.localeCompare(b.category, 'es')
                     || a.name.localeCompare(b.name, 'es', { numeric: true }))
        .map(entry => {
          const id = `g${++n}`;
          groups.set(id, entry.items);
          return { id, name: entry.name, category: entry.category, count: countItems(entry.items) };
        });

      const total = countItems(map);
      return { total, groups: result, truncated: total > read };
    },

    items: () => last,
    group: id => groups.get(id) || {},
    reset() { last = {}; groups.clear(); seq++; },
  };
}
