/* ──────────────────────────────────────────────────────────────────────
   bim-types.ts — Lo que el motor 3D le entrega a la interfaz

   Sólo tipos (sin imports): la interfaz (model-*.ts) los usa sin arrastrar
   three / That Open, que viven en el chunk diferido (bim-*.ts).
   ────────────────────────────────────────────────────────────────────── */

/** Herramienta activa: sólo una a la vez (el doble clic hace algo distinto en cada una). */
export type ToolId = 'select' | 'length' | 'area-face' | 'area-free' | 'volume' | 'clip';

export interface PropertyRow { label: string; value: string }
export interface PropertyGroup { name: string; rows: PropertyRow[] }

/** Datos de un elemento seleccionado, listos para mostrar. */
export interface ElementInfo {
  title: string;              // nombre del elemento (o su tipo, si no tiene)
  category: string;           // en español: "Muros", "Columnas"…
  general: PropertyRow[];     // nombre, tipo, código, nivel, material…
  groups: PropertyGroup[];    // conjuntos de propiedades y cantidades del IFC
}

export interface SelectionInfo {
  count: number;
  /** Detalle completo sólo con un elemento; con varios, el resumen por categoría. */
  element: ElementInfo | null;
  categories: { category: string; count: number }[];
}

/** Árbol del edificio: secciones (niveles, tipos de elemento) con sus grupos. */
export interface TreeGroup {
  id: string;
  label: string;
  count: number;
  /** Qué sale al desplegarlo. Sin esto, el grupo es una hoja.
      Un nivel se abre por tipo de elemento, y cada tipo por subtipo. */
  children?: 'categories' | 'subtypes';
}
export interface TreeSection { id: string; label: string; groups: TreeGroup[] }
export type Visibility = 'visible' | 'hidden' | 'partial';

/* ── Búsqueda de elementos (ver bim-finder.ts) ──────────────────────── */

/** Opción del desplegable de tipos. `id` puede traer varias clases IFC
    separadas por "|" cuando comparten nombre en español ("Muros"). */
export interface FindCategory { id: string; label: string }

/** Resultados con el MISMO nombre, agrupados en una sola fila.

    Buscar "sueloAPI" devolvía 88 filas idénticas, una por elemento; agrupadas
    son una fila con su cantidad, y las acciones operan sobre las 88 a la vez. */
export interface FindGroup {
  /** Id interno del grupo, para pedirle sus elementos al motor. */
  id: string;
  name: string;       // Name del IFC (o su tipo, si no tiene)
  category: string;   // en español
  count: number;
}

export interface FindResult {
  /** Elementos encontrados en total. */
  total: number;
  groups: FindGroup[];
  /** Había más elementos de los que se pudieron agrupar (ver NAMES_LIMIT). */
  truncated: boolean;
}

/* ── Vistas (ver bim-views.ts y bim-viewpoints.ts) ──────────────────── */

/** Una vista 2D generada del modelo: planta, alzado o sección. */
export interface ViewItem {
  id: string;
  label: string;
  kind: 'storey' | 'elevation' | 'section';
}

/** Un encuadre guardado: cámara, selección y miniatura. */
export interface ViewpointItem {
  guid: string;
  title: string;
  /** URL de la miniatura (o null si no se pudo tomar). */
  thumbnail: string | null;
  /** Elementos que estaban seleccionados al guardarlo. */
  count: number;
}
