/* ──────────────────────────────────────────────────────────────────────
   bim-viewpoints.ts — Puntos de vista guardados (Viewpoints)

   Guarda la cámara actual, los elementos seleccionados y una miniatura, para
   volver a ese encuadre más tarde. Es el formato de punto de vista del
   estándar BCF, así que lo guardado aquí es lo que viajaría en un .bcf si
   algún día se añade el intercambio de incidencias (BCFTopics).

   Los elementos se guardan por GUID (el identificador del IFC), no por su
   número interno: así el punto de vista sigue valiendo aunque el modelo se
   vuelva a convertir.

   DURACIÓN: viven en memoria mientras el visor está abierto, como las
   mediciones y los cortes. Al cerrar el modelo se pierden.
   ────────────────────────────────────────────────────────────────────── */
import * as OBC from '@thatopen/components';
import type { BimContext } from './bim-engine';
import type { ViewpointItem } from './bim-types';

/** Lo que el motor necesita de la selección para guardarla y restaurarla. */
export interface ViewpointSelection {
  current(): OBC.ModelIdMap;
  select(items: OBC.ModelIdMap): Promise<void>;
}

export interface BimViewpoints {
  /** Guarda cámara + selección + miniatura. */
  save(): Promise<ViewpointItem[]>;
  list(): ViewpointItem[];
  /** Vuelve al encuadre guardado y restaura su selección. */
  go(guid: string): Promise<void>;
  remove(guid: string): void;
  reset(): void;
}

const countItems = (map: OBC.ModelIdMap) =>
  Object.values(map).reduce((n, ids) => n + ids.size, 0);

export function createViewpoints(ctx: BimContext, selection: ViewpointSelection): BimViewpoints {
  const viewpoints = ctx.components.get(OBC.Viewpoints);
  viewpoints.world = ctx.world;

  /** guid → URL de la miniatura. Se liberan al borrar: son objetos en memoria. */
  const thumbnails = new Map<string, string>();
  /** guid → cuántos elementos tenía la selección al guardar. */
  const counts = new Map<string, number>();
  let seq = 0;

  /** Crea (una vez) la URL de la miniatura de un punto de vista. */
  function thumbnail(guid: string): string | null {
    const cached = thumbnails.get(guid);
    if (cached) return cached;
    const viewpoint = viewpoints.list.get(guid);
    if (!viewpoint?.snapshot) return null;
    const bytes = viewpoints.snapshots.get(viewpoint.snapshot);
    if (!bytes) return null;
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/png' }));
    thumbnails.set(guid, url);
    return url;
  }

  function release(guid: string) {
    const url = thumbnails.get(guid);
    if (!url) return;
    URL.revokeObjectURL(url);
    thumbnails.delete(guid);
  }

  const list = (): ViewpointItem[] =>
    [...viewpoints.list.values()].map(viewpoint => ({
      guid: viewpoint.guid,
      title: viewpoint.title || 'Punto de vista',
      thumbnail: thumbnail(viewpoint.guid),
      count: counts.get(viewpoint.guid) || 0,
    }));

  return {
    async save() {
      const viewpoint = viewpoints.create();
      viewpoint.title = `Punto de vista ${++seq}`;

      // Elementos seleccionados → GUIDs (lo que entiende el estándar BCF)
      const items = selection.current();
      const count = countItems(items);
      if (count) {
        const guids = await ctx.fragments.modelIdMapToGuids(items);
        viewpoint.selectionComponents.add(...guids);
      }
      counts.set(viewpoint.guid, count);

      // true: además de la cámara, toma la miniatura
      await viewpoint.updateCamera(true);
      return list();
    },

    list,

    async go(guid) {
      const viewpoint = viewpoints.list.get(guid);
      if (!viewpoint) return;
      await viewpoint.go();
      // Los GUIDs vuelven a ser elementos del modelo que está cargado ahora
      const items = await viewpoint.getSelectionMap();
      await selection.select(items);
    },

    remove(guid) {
      release(guid);
      counts.delete(guid);
      viewpoints.list.delete(guid);
    },

    reset() {
      for (const guid of [...thumbnails.keys()]) release(guid);
      counts.clear();
      viewpoints.list.clear();
      seq = 0;
    },
  };
}
