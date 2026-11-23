/* ──────────────────────────────────────────────────────────────────────
   bim-views.ts — Vistas 2D generadas del modelo (Views)

   Genera plantas a partir de los niveles del IFC (IfcBuildingStorey) y los
   cuatro alzados a partir de la caja que envuelve el modelo. Abrir una vista
   pone la cámara en ortográfica mirando ese plano; cerrarla devuelve al 3D.

   OJO: no son puntos de vista guardados (eso es bim-viewpoints.ts). Son
   cortes del modelo, el equivalente a una lámina de planta o alzado.

   `createFromIfcStoreys` asume esquema IFC: con otro esquema no encuentra
   niveles y sólo salen los alzados.
   ────────────────────────────────────────────────────────────────────── */
import * as OBC from '@thatopen/components';
import type { BimContext } from './bim-engine';
import type { ViewItem } from './bim-types';

/** Nombres en español de los cuatro alzados (el componente los pone en inglés). */
const ELEVATION_NAMES = {
  front: 'Alzado frontal',
  back : 'Alzado posterior',
  left : 'Alzado izquierdo',
  right: 'Alzado derecho',
};

export interface BimViews {
  /** Crea las plantas y los alzados del modelo cargado. */
  generate(): Promise<ViewItem[]>;
  list(): ViewItem[];
  /** Abre una vista 2D (cierra la que estuviera abierta). */
  open(id: string): void;
  /** Vuelve al 3D. */
  close(): void;
  /** Id de la vista abierta, o null si estamos en 3D. */
  openId(): string | null;
  reset(): void;
}

export function createViews(ctx: BimContext): BimViews {
  const views = ctx.components.get(OBC.Views);
  views.world = ctx.world;
  // Al cerrar una vista 2D, la cámara vuelve donde estaba en 3D
  views.restoreCameraOnClose = true;

  /** Tipo de cada vista: el componente no lo guarda y sirve para agrupar. */
  const kinds = new Map<string, ViewItem['kind']>();
  let current: string | null = null;

  const list = (): ViewItem[] =>
    [...views.list.keys()].map(id => ({ id, label: id, kind: kinds.get(id) || 'section' }));

  function reset() {
    views.close();      // sin condición: `current` podría estar desincronizado
    current = null;
    kinds.clear();
    views.list.clear();
  }

  function close() {
    if (current === null) return;
    views.close();
    current = null;
  }

  return {
    async generate() {
      reset();
      // Plantas: una por nivel del IFC
      const storeys = await views.createFromIfcStoreys();
      for (const view of storeys) kinds.set(view.id, 'storey');
      // Alzados: de la caja que envuelve TODOS los modelos (combine)
      views.createElevations({
        combine: true,
        namingCallback: () => ELEVATION_NAMES,
      });
      // createElevations no devuelve las vistas: lo nuevo en la lista es alzado
      for (const id of views.list.keys()) if (!kinds.has(id)) kinds.set(id, 'elevation');
      return list();
    },

    list,

    open(id) {
      if (!views.list.has(id)) return;
      close();                 // sólo una vista 2D a la vez
      views.open(id);
      current = id;
    },

    close,
    openId: () => current,
    reset,
  };
}
