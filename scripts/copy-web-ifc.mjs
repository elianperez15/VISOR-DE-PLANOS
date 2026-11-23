// copy-web-ifc.mjs — Copia el WebAssembly de web-ifc (lector IFC del visor 3D)
// a public/web-ifc/<versión>/. Desde public/ lo sirve Vite en desarrollo y entra
// tal cual en dist/ al compilar.
//
// La carpeta lleva la versión instalada para que la caché del navegador nunca
// mezcle un .wasm viejo con el código nuevo: el .wasm DEBE coincidir con la
// versión de web-ifc del bundle (ver __WEB_IFC_VERSION__ en vite.config.ts).
//
// Se ejecuta solo antes de `npm run dev` y `npm run build` (predev / prebuild).
import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root    = join(dirname(fileURLToPath(import.meta.url)), '..');
const src     = join(root, 'node_modules', 'web-ifc');
const version = JSON.parse(readFileSync(join(src, 'package.json'), 'utf8')).version;
const outBase = join(root, 'public', 'web-ifc');
const out     = join(outBase, version);

rmSync(outBase, { recursive: true, force: true });   // fuera las versiones anteriores
mkdirSync(out, { recursive: true });
// Sólo la variante de un hilo: la multihilo no funciona empaquetada (ver bim-engine.ts)
cpSync(join(src, 'web-ifc.wasm'), join(out, 'web-ifc.wasm'));

console.log(`web-ifc ${version} → public/web-ifc/${version}/`);
