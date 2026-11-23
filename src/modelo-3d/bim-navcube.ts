/* ──────────────────────────────────────────────────────────────────────
   bim-navcube.ts — Vistas ortogonales del cubo de navegación

   Lleva la cámara a una de las seis caras del modelo. El cálculo lo hace
   BoundingBoxer.getCameraOrientation(): encuadra la caja que envuelve todo
   lo cargado y devuelve dónde poner la cámara y hacia dónde mirar.

   La caja se recalcula en cada salto: si el usuario ocultó o aisló parte del
   modelo, la vista debe encuadrar lo que hay ahora, no lo que había al abrir.
   ────────────────────────────────────────────────────────────────────── */
import * as OBC from '@thatopen/components';
import type { BimContext } from './bim-engine';

/** Las seis caras, tal como las nombra BoundingBoxer. */
export type CubeFace = 'top' | 'bottom' | 'left' | 'right' | 'front' | 'back';

export interface BimNavCube {
  /** Mueve la cámara a esa cara, con animación. */
  go(face: CubeFace): Promise<void>;
}

export function createNavCube(ctx: BimContext): BimNavCube {
  const boxer = ctx.components.get(OBC.BoundingBoxer);

  return {
    async go(face) {
      if (!ctx.fragments.list.size) return;
      // dispose() limpia la caja anterior; sin esto se acumularían las cajas
      // de todos los saltos y la vista se iría alejando.
      boxer.dispose();
      boxer.addFromModels();
      const { position, target } = await boxer.getCameraOrientation(face);
      await ctx.world.camera.controls.setLookAt(
        position.x, position.y, position.z,
        target.x, target.y, target.z,
        true,                                   // con transición
      );
    },
  };
}
