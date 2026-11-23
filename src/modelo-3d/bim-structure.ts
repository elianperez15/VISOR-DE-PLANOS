/* ──────────────────────────────────────────────────────────────────────
   bim-structure.ts — Árbol del edificio: niveles y tipos de elemento

   Agrupa los elementos por nivel (IfcBuildingStorey) y por tipo (muros,
   losas, columnas…) con el Classifier, y permite ocultar, aislar y encuadrar
   cada grupo (Hider). Las clases IFC que comparten nombre en español
   (IFCWALL + IFCWALLSTANDARDCASE = "Muros") se juntan en un solo grupo.

   Cada grupo guarda SÓLO los elementos con geometría: el Classifier también
   trae contenedores sin forma propia (un techo compuesto, un antepecho…)
   que nunca se "ven", y con ellos un grupo parecería oculto a medias.

   Nota: un nivel contiene los elementos asignados DIRECTAMENTE a él; las
   piezas de un elemento compuesto (montantes de un muro cortina…) cuelgan
   de su elemento, no del nivel.

   DESPLIEGUE: un grupo se abre en subgrupos leyendo los datos de SUS
   elementos. Un nivel se abre por tipo de elemento y cada tipo por subtipo
   del IFC ("Nivel 2" → "Losas" → "sueloAPI:-01"); en la pestaña de tipos se
   empieza directamente por el tipo.

   Se calcula SÓLO al desplegar: hacerlo para todo el modelo al abrirlo lo
   volvería lento. El resultado queda en caché mientras el modelo esté abierto.
   ────────────────────────────────────────────────────────────────────── */
import * as THREE from 'three';
import * as OBC from '@thatopen/components';
import type { ItemsDataConfig } from '@thatopen/fragments';
import type { BimContext } from './bim-engine';
import type { TreeGroup, TreeSection, Visibility } from './bim-types';
import { categoryName } from './ifc-names';

const LEVELS = 'Niveles';
const CATEGORIES = 'Tipos de elemento';

export interface BimStructure {
  /** (Re)arma el árbol del modelo cargado. */
  build(): Promise<TreeSection[]>;
  setVisible(groupId: string, visible: boolean): Promise<void>;
  isolate(groupId: string): Promise<void>;
  /** Aísla una selección cualquiera (la usa la búsqueda, que no tiene grupo). */
  isolateItems(items: OBC.ModelIdMap): Promise<void>;
  showAll(): Promise<void>;
  /** Despliega un grupo por tipo de elemento o por subtipo. Los subgrupos
      quedan registrados como grupos normales: se ocultan y se aíslan igual. */
  children(groupId: string, kind: 'categories' | 'subtypes'): Promise<TreeGroup[]>;
  /** Estado de visibilidad de cada grupo (para los ojos del árbol). */
  visibility(): Promise<Record<string, Visibility>>;
  items(groupId: string): OBC.ModelIdMap;
  /** Caja que envuelve los elementos visibles del grupo (para encuadrarlo). */
  box(items: OBC.ModelIdMap): Promise<THREE.Box3>;
  reset(): void;
}

/** Deja en `map` sólo los elementos de `keep` (por modelo). */
function intersect(map: OBC.ModelIdMap, keep: Record<string, Set<number>>): OBC.ModelIdMap {
  const out: OBC.ModelIdMap = {};
  for (const [modelId, ids] of Object.entries(map)) {
    const allowed = keep[modelId];
    if (!allowed) continue;
    const set = new Set([...ids].filter(id => allowed.has(id)));
    if (set.size) out[modelId] = set;
  }
  return out;
}

/** Une dos selecciones (ModelIdMap) en una nueva. */
function merge(a: OBC.ModelIdMap, b: OBC.ModelIdMap): OBC.ModelIdMap {
  const out: OBC.ModelIdMap = {};
  for (const map of [a, b]) {
    for (const [modelId, ids] of Object.entries(map)) {
      const set = out[modelId] || (out[modelId] = new Set<number>());
      ids.forEach(id => set.add(id));
    }
  }
  return out;
}

const countItems = (map: OBC.ModelIdMap) => Object.values(map).reduce((n, ids) => n + ids.size, 0);

/** Lo mínimo para saber el tipo de un elemento: sus atributos y el objeto
    *TYPE que cuelga de IsDefinedBy. Sin esto se leería el IFC entero. */
const TYPE_DATA: Partial<ItemsDataConfig> = {
  attributesDefault: true,
  relationsDefault: { attributes: false, relations: false },
  relations: { IsDefinedBy: { attributes: true, relations: false } },
};

const value = (item: any, name: string): any => item?.[name]?.value;

/** "sueloAPI:-01" — el tipo del elemento, como lo muestra el panel de propiedades. */
function typeLabel(item: any): string {
  const direct = value(item, 'ObjectType');
  if (direct != null && String(direct).trim()) return String(direct).trim();
  const definitions = Array.isArray(item?.IsDefinedBy) ? item.IsDefinedBy : [];
  const typeObject = definitions.find((d: any) => /TYPE$/.test(String(value(d, '_category') || '')));
  const name = value(typeObject, 'Name');
  return name != null && String(name).trim() ? String(name).trim() : 'Sin tipo';
}
const toSets = (map: Record<string, number[]>) =>
  Object.fromEntries(Object.entries(map).map(([modelId, ids]) => [modelId, new Set(ids)]));

export function createStructure(ctx: BimContext): BimStructure {
  const classifier = ctx.components.get(OBC.Classifier);
  const hider = ctx.components.get(OBC.Hider);
  const groups = new Map<string, OBC.ModelIdMap>();   // id del grupo → elementos
  /** Despliegues ya calculados: "grupo|tipo" → sus subgrupos (no se recalculan). */
  const childCache = new Map<string, TreeGroup[]>();

  async function build(): Promise<TreeSection[]> {
    reset();
    await classifier.byIfcBuildingStorey({ classificationName: LEVELS });
    await classifier.byCategory({ classificationName: CATEGORIES });
    // Recién cargado todo está visible: lo visible es justo lo que tiene geometría
    const withGeometry = toSets(await hider.getVisibilityMap(true));

    const sections: TreeSection[] = [];
    for (const [sectionId, label, translate] of [
      [LEVELS, 'Niveles', (name: string) => name],
      [CATEGORIES, 'Tipos de elemento', categoryName],
    ] as const) {
      const byLabel = new Map<string, OBC.ModelIdMap>();
      for (const [name, data] of classifier.list.get(sectionId) || []) {
        const items = intersect(await data.get(), withGeometry);
        if (!countItems(items)) continue;
        const groupLabel = translate(name);
        byLabel.set(groupLabel, merge(byLabel.get(groupLabel) || {}, items));
      }
      const entries = [...byLabel];
      if (sectionId === CATEGORIES) entries.sort(([a], [b]) => a.localeCompare(b, 'es'));
      sections.push({
        id: sectionId,
        label,
        groups: entries.map(([groupLabel, items]) => {
          const id = `${sectionId}/${groupLabel}`;
          groups.set(id, items);
          // Un nivel se abre por tipo de elemento; un tipo, directo por subtipo
          return { id, label: groupLabel, count: countItems(items),
                   children: sectionId === LEVELS ? 'categories' : 'subtypes' };
        }),
      });
    }
    return sections.filter(s => s.groups.length);
  }

  function reset() {
    groups.clear();
    childCache.clear();
    classifier.list.clear();
  }

  let childSeq = 0;   // ids opacos: un nombre de nivel o de tipo podría colisionar

  /** Agrupa los elementos de `groupId` por la clave que diga `key`. */
  async function children(groupId: string, kind: 'categories' | 'subtypes'): Promise<TreeGroup[]> {
    const cacheId = `${groupId}|${kind}`;
    const cached = childCache.get(cacheId);
    if (cached) return cached;
    const items = groups.get(groupId);
    if (!items) return [];

    const key = kind === 'categories'
      ? (item: any) => categoryName(value(item, '_category'))
      : typeLabel;

    // Un subgrupo por clave, conservando a qué modelo pertenece cada elemento
    const byKey = new Map<string, OBC.ModelIdMap>();
    for (const [modelId, ids] of Object.entries(items)) {
      const model = ctx.fragments.list.get(modelId);
      if (!model) continue;
      const localIds = [...ids];
      const data = await model.getItemsData(localIds, TYPE_DATA);
      data.forEach((item, i) => {
        const label = key(item);
        const map = byKey.get(label) || byKey.set(label, {}).get(label)!;
        (map[modelId] || (map[modelId] = new Set<number>())).add(localIds[i]);
      });
    }

    const result = [...byKey]
      .sort(([a], [b]) => a.localeCompare(b, 'es', { numeric: true }))
      .map(([label, map]): TreeGroup => {
        const id = `#${++childSeq}`;
        groups.set(id, map);
        // Un tipo de elemento todavía se abre por subtipo; un subtipo ya es hoja
        return { id, label, count: countItems(map),
                 ...(kind === 'categories' ? { children: 'subtypes' as const } : {}) };
      });
    childCache.set(cacheId, result);
    return result;
  }

  async function visibility(): Promise<Record<string, Visibility>> {
    const visibleSets = toSets(await hider.getVisibilityMap(true));
    const out: Record<string, Visibility> = {};
    for (const [id, items] of groups) {
      let shown = 0, total = 0;
      for (const [modelId, ids] of Object.entries(items)) {
        const set = visibleSets[modelId];
        ids.forEach(localId => { total++; if (set?.has(localId)) shown++; });
      }
      out[id] = shown === total ? 'visible' : shown === 0 ? 'hidden' : 'partial';
    }
    return out;
  }

  return {
    build,
    async setVisible(id, visible) {
      const items = groups.get(id);
      if (items) await hider.set(visible, items);
    },
    async isolate(id) {
      const items = groups.get(id);
      if (items) await hider.isolate(items);
    },
    async isolateItems(items) {
      if (countItems(items)) await hider.isolate(items);
    },
    async showAll() { await hider.set(true); },
    children,
    visibility,
    items: id => groups.get(id) || {},
    async box(items) {
      const box = new THREE.Box3();
      for (const b of await ctx.fragments.getBBoxes(items)) box.union(b);
      return box;
    },
    reset,
  };
}
