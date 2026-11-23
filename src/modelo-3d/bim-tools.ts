/* ──────────────────────────────────────────────────────────────────────
   bim-tools.ts — Herramientas sobre el modelo: medir y cortar

   Una sola herramienta activa a la vez; el doble clic hace algo distinto
   en cada una (con "Seleccionar", lo resuelve el visor: acercarse al
   elemento). Las medidas salen en unidades reales (m, m², m³): el modelo
   ya viene a escala, no hay que calibrar como en el PDF.

     length     distancia entre dos puntos (se "imanta" a vértices y aristas)
     area-face  área de una cara (doble clic sobre una superficie)
     area-free  área por puntos (doble clic en cada vértice, Enter para cerrar)
     volume     volumen de elementos (doble clic en uno o varios, Enter)
     clip       plano de corte sobre la superficie (se arrastra con sus flechas)
   ────────────────────────────────────────────────────────────────────── */
import * as THREE from 'three';
import * as OBC from '@thatopen/components';
import * as OBF from '@thatopen/components-front';
import { SnappingClass } from '@thatopen/fragments';
import type { BimContext } from './bim-engine';
import type { ToolId } from './bim-types';

const MEASURE_COLOR = '#1d4ed8';   // azul: se distingue del rojo de la selección

export interface BimTools {
  set(tool: ToolId): void;
  /** Doble clic en el lienzo con la herramienta activa. */
  dblclick(): void;
  /** Teclas de la herramienta: Enter cierra, Supr borra lo que está bajo el cursor.
      (Escape lo resuelve el visor: vuelve a Seleccionar, y set() cancela lo que esté a medias.) */
  key(key: string): boolean;
  /** ¿Hay medidas o cortes que borrar? */
  hasContent(): boolean;
  clearAll(): void;
}

export function createTools(ctx: BimContext, onChange: () => void): BimTools {
  const { components, world } = ctx;
  const color = new THREE.Color(MEASURE_COLOR);

  const length = components.get(OBF.LengthMeasurement);
  length.world = world;
  length.color = color;
  length.snappings = [SnappingClass.POINT, SnappingClass.LINE];

  const area = components.get(OBF.AreaMeasurement);
  area.world = world;
  area.color = color;
  area.snappings = [SnappingClass.POINT];

  const volume = components.get(OBF.VolumeMeasurement);
  volume.world = world;
  volume.color = color;

  const clipper = components.get(OBC.Clipper);
  clipper.enabled = true;   // siempre: apagarlo desactivaría también los cortes ya hechos

  const measurers = [length, area, volume];
  for (const m of measurers) {
    m.enabled = false;
    m.list.onItemAdded.add(onChange);
    m.list.onItemDeleted.add(onChange);
  }
  clipper.onAfterCreate.add(onChange);
  clipper.onAfterDelete.add(onChange);

  let tool: ToolId = 'select';

  /** La medición de la herramienta activa (o null si es seleccionar / cortar). */
  function activeMeasurer() {
    if (tool === 'length') return length;
    if (tool === 'area-face' || tool === 'area-free') return area;
    if (tool === 'volume') return volume;
    return null;
  }

  return {
    set(next) {
      activeMeasurer()?.cancelCreation();   // una medida a medias no sobrevive al cambio
      tool = next;
      for (const m of measurers) m.enabled = false;
      if (tool === 'area-face') area.mode = 'face';
      if (tool === 'area-free') area.mode = 'free';
      const measurer = activeMeasurer();
      if (measurer) measurer.enabled = true;
    },
    dblclick() {
      if (tool === 'clip') { clipper.create(world); return; }
      activeMeasurer()?.create();
    },
    key(key) {
      const measurer = activeMeasurer();
      if (key === 'Enter' && (tool === 'area-free' || tool === 'volume')) { measurer.endCreation(); return true; }
      if (key === 'Delete' || key === 'Backspace') {
        if (tool === 'clip') { clipper.delete(world); return true; }
        if (measurer) { measurer.delete(); return true; }
      }
      return false;
    },
    hasContent: () => measurers.some(m => m.list.size > 0) || clipper.list.size > 0,
    clearAll() {
      for (const m of measurers) { m.cancelCreation(); m.list.clear(); }
      clipper.deleteAll();
      onChange();
    },
  };
}
