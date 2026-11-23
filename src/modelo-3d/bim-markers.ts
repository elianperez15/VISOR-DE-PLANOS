/* ──────────────────────────────────────────────────────────────────────
   bim-markers.ts — Etiquetas ancladas al modelo (Marker)

   Pone un rótulo flotante sobre unos elementos: se queda pegado a ese punto
   del modelo y sigue a la cámara. Sirve para dejar anotado "esto es la
   columna C-12" mientras se revisa el plano con alguien.

   El punto es el centro de la caja que envuelve los elementos, así que una
   etiqueta sobre una selección múltiple cae en medio de todos.

   DURACIÓN: viven mientras el visor está abierto, como las mediciones y los
   cortes. El botón de limpiar de la barra las borra junto con ellos.
   ────────────────────────────────────────────────────────────────────── */
import * as THREE from 'three';
import * as OBC from '@thatopen/components';
import * as OBF from '@thatopen/components-front';
import type { BimContext } from './bim-engine';

export interface BimMarkers {
  /** Etiqueta en el centro de `items`. Devuelve false si no hay dónde ponerla. */
  add(items: OBC.ModelIdMap, text: string): Promise<boolean>;
  count(): number;
  clear(): void;
}

export function createMarkers(ctx: BimContext): BimMarkers {
  const marker = ctx.components.get(OBF.Marker);
  // Agrupa las etiquetas que quedan muy juntas en un solo globo con el número,
  // para que al alejarse no se conviertan en una maraña ilegible.
  marker.autoCluster = true;

  const ids = new Set<string>();

  /** El rótulo es DOM propio: el texto entra como texto, nunca como HTML. */
  function label(text: string): HTMLElement {
    const node = document.createElement('div');
    node.className = 'model-marker';
    node.textContent = text;
    return node;
  }

  return {
    async add(items, text) {
      const box = new THREE.Box3();
      for (const b of await ctx.fragments.getBBoxes(items)) box.union(b);
      if (box.isEmpty()) return false;
      const id = marker.create(ctx.world, label(text), box.getCenter(new THREE.Vector3()));
      if (id) ids.add(id);
      return Boolean(id);
    },

    count: () => ids.size,

    clear() {
      for (const id of ids) marker.delete(id);
      ids.clear();
    },
  };
}
