// convertir-ifc.mjs — Convierte un IFC a .frag (el formato que el visor 3D abre en segundos)
//
//   npm run convertir-ifc -- <archivo.ifc> [salida.frag]
//
// Convertir la geometría de un IFC grande lleva minutos; abrir el .frag
// resultante, segundos. La idea (igual que hace Autodesk con sus modelos):
// convertir UNA vez, al subir el IFC, y que el visor reciba siempre el .frag.
// Este script es esa conversión: se puede correr a mano o desde un proceso
// del servidor cada vez que se sube un modelo.
//
// Usa el mismo importador que el visor (@thatopen/fragments + web-ifc), así
// el .frag es idéntico al que genera el navegador.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname } from 'node:path';
import { IfcImporter } from '@thatopen/fragments';

const require = createRequire(import.meta.url);
const [input, output = input?.replace(/\.ifc$/i, '') + '.frag'] = process.argv.slice(2);
if (!input || !/\.ifc$/i.test(input)) {
  console.error('Uso: npm run convertir-ifc -- <archivo.ifc> [salida.frag]');
  process.exit(1);
}

const started = Date.now();
const seconds = () => Math.round((Date.now() - started) / 1000);
const bytes = new Uint8Array(readFileSync(input));
console.log(`Convirtiendo ${basename(input)} (${(bytes.length / 1048576).toFixed(1)} MB)…`);

const importer = new IfcImporter();
importer.wasm = { path: dirname(require.resolve('web-ifc')) + '/', absolute: true };
importer.webIfcSettings = { COORDINATE_TO_ORIGIN: true };   // igual que el visor

let lastStage = '';
const frag = await importer.process({
  bytes,
  progressCallback: (progress, data) => {
    if (data.process === lastStage) return;
    lastStage = data.process;
    console.log(`  ${String(seconds()).padStart(4)} s · ${Math.round(progress * 100)} % · ${data.process}`);
  },
});

writeFileSync(output, frag);
console.log(`Listo en ${seconds()} s → ${output} (${(frag.length / 1048576).toFixed(1)} MB)`);
