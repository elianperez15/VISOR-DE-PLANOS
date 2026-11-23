/* ──────────────────────────────────────────────────────────────────────
   bim-selection.ts — Seleccionar elementos y leer sus datos del IFC

   Clic → se resalta el elemento (Highlighter) y se traducen sus datos a
   filas legibles: nombre, tipo, código, nivel, material, conjuntos de
   propiedades y cantidades. Mayús+clic suma a la selección.

   Los datos del IFC forman un grafo con ciclos (un conjunto de propiedades
   apunta de vuelta a los elementos que define; un material, a todos los que
   lo usan). Por eso se piden SÓLO las relaciones necesarias (ITEM_DATA) y se
   recorren por nombre, nunca a ciegas.
   ────────────────────────────────────────────────────────────────────── */
import * as THREE from 'three';
import * as OBC from '@thatopen/components';
import * as OBF from '@thatopen/components-front';
import { RenderedFaces } from '@thatopen/fragments';
import type { ItemData, ItemsDataConfig } from '@thatopen/fragments';
import type { BimContext } from './bim-engine';
import type { ElementInfo, PropertyGroup, PropertyRow, SelectionInfo } from './bim-types';
import { categoryName } from './ifc-names';
import { numero } from '../compartido/utils/formato';

const SELECT = 'select';
/** Rojo AICSA, el mismo acento del visor. Lo usa también el modo Fantasma,
    que deja sólido lo seleccionado mientras el resto se vuelve translúcido. */
export const SELECTION_COLOR = '#e1251b';
const SUMMARY_LIMIT = 2000;          // con selecciones enormes, el resumen por categoría usa sólo estas

const ON  = { attributes: true, relations: true };
const OFF = { attributes: false, relations: false };
const ITEM_DATA: Partial<ItemsDataConfig> = {
  attributesDefault: true,
  relationsDefault: OFF,
  relations: {
    IsDefinedBy         : ON,                                     // conjuntos de propiedades, cantidades y el tipo
    HasProperties       : { attributes: true, relations: false },
    Quantities          : { attributes: true, relations: false },
    HasPropertySets     : ON,                                     // propiedades del tipo
    HasAssociations     : ON,                                     // material (en el elemento o en su tipo)
    ForLayerSet         : ON,
    MaterialLayers      : ON,
    Material            : { attributes: true, relations: false },
    ContainedInStructure: { attributes: true, relations: false }, // nivel
  },
};

export interface BimSelection {
  /** Activa/desactiva la selección con clic (las mediciones y los cortes usan el clic). */
  setEnabled(on: boolean): void;
  select(items: OBC.ModelIdMap): Promise<void>;
  clear(): Promise<void>;
  current(): OBC.ModelIdMap;
}

const attr = (item: ItemData | undefined, name: string): any => (item?.[name] as any)?.value;
const rel  = (item: ItemData | undefined, name: string): ItemData[] =>
  Array.isArray(item?.[name]) ? (item[name] as ItemData[]) : [];

function formatValue(value: any): string | null {
  if (value == null || value === '') return null;
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  if (typeof value === 'number') return numero(value);
  return String(value);
}

function pushRow(rows: PropertyRow[], label: string, value: any) {
  const text = formatValue(value);
  if (text != null) rows.push({ label, value: text });
}

/** Valor de una cantidad IFC (IfcQuantityLength / Area / Volume / Count / Weight / Time). */
function quantityValue(q: ItemData): any {
  for (const key of ['LengthValue', 'AreaValue', 'VolumeValue', 'CountValue', 'WeightValue', 'TimeValue']) {
    const v = attr(q, key);
    if (v != null) return v;
  }
  return null;
}

/** Conjunto de propiedades (IfcPropertySet) o de cantidades (IfcElementQuantity) → grupo de filas. */
function toGroup(set: ItemData, suffix = ''): PropertyGroup | null {
  const rows: PropertyRow[] = [];
  for (const p of rel(set, 'HasProperties')) pushRow(rows, attr(p, 'Name') ?? '—', attr(p, 'NominalValue'));
  for (const q of rel(set, 'Quantities'))    pushRow(rows, attr(q, 'Name') ?? '—', quantityValue(q));
  return rows.length ? { name: (attr(set, 'Name') || 'Propiedades') + suffix, rows } : null;
}

const MATERIAL_PATH = ['HasAssociations', 'ForLayerSet', 'MaterialLayers', 'Material'];

/** Nombres de material (IfcMaterial directo o dentro de un conjunto de capas). */
function materialNames(item: ItemData, out = new Set<string>(), depth = 0): Set<string> {
  if (!item || depth > 4) return out;
  for (const name of MATERIAL_PATH) {
    for (const child of rel(item, name)) {
      if (attr(child, '_category') === 'IFCMATERIAL' && attr(child, 'Name')) out.add(attr(child, 'Name'));
      materialNames(child, out, depth + 1);
    }
  }
  return out;
}

/** Datos crudos del IFC → lo que muestra el panel de propiedades. */
export function describeElement(data: ItemData): ElementInfo {
  const category = String(attr(data, '_category') || '');
  const definitions = rel(data, 'IsDefinedBy');
  const typeObject = definitions.find(d => /TYPE$/.test(String(attr(d, '_category') || '')));
  const materials = materialNames(data);
  if (typeObject) materialNames(typeObject, materials);

  const general: PropertyRow[] = [];
  pushRow(general, 'Tipo de elemento', categoryName(category));
  pushRow(general, 'Nombre', attr(data, 'Name'));
  pushRow(general, 'Tipo', attr(data, 'ObjectType') ?? attr(typeObject, 'Name'));
  pushRow(general, 'Código', attr(data, 'Tag'));
  pushRow(general, 'Nivel', attr(rel(data, 'ContainedInStructure')[0], 'Name'));
  pushRow(general, 'Material', [...materials].join(' · '));
  pushRow(general, 'Clase IFC', category);
  pushRow(general, 'GUID', attr(data, '_guid'));

  const groups: PropertyGroup[] = [];
  for (const def of definitions) {
    if (def === typeObject) continue;
    const group = toGroup(def);
    if (group) groups.push(group);
  }
  for (const set of rel(typeObject, 'HasPropertySets')) {
    const group = toGroup(set, ' (tipo)');
    if (group) groups.push(group);
  }

  return {
    title: attr(data, 'Name') || attr(data, 'ObjectType') || categoryName(category),
    category: categoryName(category),
    general,
    groups,
  };
}

const countItems = (map: OBC.ModelIdMap) => Object.values(map).reduce((n, ids) => n + ids.size, 0);

/** Coordenadas del modelo, en metros y con 2 decimales: "X 12,34 · Y 5,67 · Z 2,10". */
function formatPoint(point: THREE.Vector3): string {
  const n = (v: number) => numero(v, 2, true);
  return `X ${n(point.x)} · Y ${n(point.y)} · Z ${n(point.z)}`;
}

export function createSelection(ctx: BimContext, onChange: (info: SelectionInfo | null) => void): BimSelection {
  const highlighter = ctx.components.get(OBF.Highlighter);
  highlighter.setup({
    world: ctx.world,
    selectMaterialDefinition: {
      color: new THREE.Color(SELECTION_COLOR),
      opacity: 1,
      transparent: false,
      // TWO (ambas caras), no ONE: con una sola cara, un elemento con las
      // normales invertidas o visto desde dentro se selecciona pero NO se
      // pinta — pasaba con losas vistas desde abajo y muros desde el interior.
      renderedFaces: RenderedFaces.TWO,
    },
  });
  highlighter.multiple = 'shiftKey';   // Mayús+clic suma (igual en Mac y Windows)
  highlighter.zoomToSelection = false;

  let requestSeq = 0;   // una selección nueva descarta la lectura de datos de la anterior

  async function describe(map: OBC.ModelIdMap): Promise<SelectionInfo> {
    const count = countItems(map);
    if (count === 1) {
      const [modelId, ids] = Object.entries(map).find(([, ids]) => ids.size)!;
      const model = ctx.fragments.list.get(modelId);
      const [data] = model ? await model.getItemsData([...ids], ITEM_DATA) : [];
      const element = data ? describeElement(data) : null;
      // Dónde está el elemento: centro de la caja que lo envuelve. No viene en
      // los datos del IFC (ahí la posición es relativa a su contenedor), sale
      // de la geometría ya colocada en el modelo.
      if (element) {
        const box = new THREE.Box3();
        for (const b of await ctx.fragments.getBBoxes(map)) box.union(b);
        if (!box.isEmpty()) {
          pushRow(element.general, 'Coordenadas', formatPoint(box.getCenter(new THREE.Vector3())));
        }
      }
      return { count, element, categories: element ? [{ category: element.category, count: 1 }] : [] };
    }
    // Varios: resumen por categoría (sin relaciones: sólo hace falta la clase)
    const byCategory = new Map<string, number>();
    let budget = SUMMARY_LIMIT;
    for (const [modelId, ids] of Object.entries(map)) {
      const model = ctx.fragments.list.get(modelId);
      if (!model || budget <= 0) continue;
      const slice = [...ids].slice(0, budget);
      budget -= slice.length;
      const items = await model.getItemsData(slice, { attributesDefault: true, relationsDefault: OFF });
      for (const item of items) {
        const name = categoryName(attr(item, '_category'));
        byCategory.set(name, (byCategory.get(name) || 0) + 1);
      }
    }
    const categories = [...byCategory].map(([category, n]) => ({ category, count: n })).sort((a, b) => b.count - a.count);
    return { count, element: null, categories };
  }

  highlighter.events[SELECT].onHighlight.add(async map => {
    const seq = ++requestSeq;
    try {
      const info = await describe(map);
      if (seq === requestSeq) onChange(info);
    } catch (e) {
      console.error('Datos del elemento:', e);
    }
  });
  highlighter.events[SELECT].onClear.add(() => { requestSeq++; onChange(null); });

  return {
    setEnabled(on) { highlighter.enabled = on; },
    async select(items) {
      if (countItems(items)) await highlighter.highlightByID(SELECT, items, true, false);
      else await highlighter.clear(SELECT);
    },
    async clear() { await highlighter.clear(SELECT); },
    current: () => highlighter.selection[SELECT] || {},
  };
}
