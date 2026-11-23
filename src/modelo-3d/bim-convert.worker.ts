/* ──────────────────────────────────────────────────────────────────────
   bim-convert.worker.ts — Convierte un IFC a fragments (.frag) en segundo plano

   Convertir la geometría de un IFC grande lleva minutos (web-ifc, un solo
   hilo). Hecho en un Web Worker, la página sigue respondiendo y el loader
   avanza; el resultado (.frag) lo abre el motor en segundos y se guarda en
   caché (model-cache.ts). Lo crea ifc-converter.ts.

     entrada  { bytes: Uint8Array }            (transferido, no copiado)
     salida   { type: 'progress', progress, stage }
              { type: 'done', frag: Uint8Array }
              { type: 'error', message }
   ────────────────────────────────────────────────────────────────────── */
import { IfcImporter } from '@thatopen/fragments';
import * as WEBIFC from 'web-ifc';

/* web-ifc SIEMPRE en un solo hilo. Con COOP/COEP (los pone el visor por
   pdf.js) el contexto queda "crossOriginIsolated" y web-ifc elige su variante
   multihilo, cuyos hilos (pthreads de Emscripten) cargan un script aparte que
   no existe una vez empaquetado: el proceso se cuelga en "0 %". El importador
   llama a Init() sin opciones, así que se fuerza aquí. */
const webIfcInit = WEBIFC.IfcAPI.prototype.Init;
WEBIFC.IfcAPI.prototype.Init = function (customLocateFileHandler?: WEBIFC.LocateFileHandlerFn) {
  return webIfcInit.call(this, customLocateFileHandler, true);
};

const WASM_PATH = `${import.meta.env.BASE_URL}web-ifc/${__WEB_IFC_VERSION__}/`;

self.onmessage = async (event: MessageEvent<{ bytes: Uint8Array }>) => {
  try {
    const importer = new IfcImporter();
    importer.wasm = { path: WASM_PATH, absolute: true };
    importer.webIfcSettings = { COORDINATE_TO_ORIGIN: true };   // como el IfcLoader de That Open
    const frag = await importer.process({
      bytes: event.data.bytes,
      progressCallback: (progress, data) => self.postMessage({ type: 'progress', progress, stage: data.process }),
    });
    (self as unknown as Worker).postMessage({ type: 'done', frag }, [frag.buffer]);
  } catch (e) {
    self.postMessage({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
};
