/* ──────────────────────────────────────────────────────────────────────
   ifc-converter.ts — Lanza la conversión IFC → .frag en un Web Worker

   El worker (bim-convert.worker.ts) trae su propia copia del importador y de
   web-ifc: se descarga sólo cuando hay que convertir un IFC. Se puede
   cancelar (otra apertura más reciente): terminar el worker libera la CPU.
   ────────────────────────────────────────────────────────────────────── */

/** Fase de la conversión, en palabras para el usuario. */
const STAGES: Record<string, string> = {
  geometries: 'geometría',
  attributes: 'propiedades',
  relations : 'relaciones',
  conversion: 'empaquetando',
};

export interface IfcConversion {
  done: Promise<Uint8Array>;
  cancel(): void;
}

export function convertIfc(bytes: Uint8Array, onProgress: (progress: number, stage: string) => void): IfcConversion {
  const worker = new Worker(new URL('./bim-convert.worker.ts', import.meta.url), { type: 'module', name: 'convertir-ifc' });
  let finish: (frag: Uint8Array) => void;
  let fail: (error: Error) => void;
  const done = new Promise<Uint8Array>((resolve, reject) => { finish = resolve; fail = reject; });

  worker.onmessage = ({ data }) => {
    if (data.type === 'progress') onProgress(data.progress, STAGES[data.stage] || data.stage);
    else if (data.type === 'done') { worker.terminate(); finish(data.frag); }
    else if (data.type === 'error') { worker.terminate(); fail(new Error(data.message)); }
  };
  worker.onerror = event => { worker.terminate(); fail(new Error(event.message || 'Falló la conversión del IFC')); };
  worker.postMessage({ bytes }, [bytes.buffer]);   // se transfiere: no se duplican cientos de MB

  return {
    done,
    cancel() { worker.terminate(); fail(new Error('Conversión cancelada')); },
  };
}
