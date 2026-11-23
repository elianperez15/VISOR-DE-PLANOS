import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Versión instalada de web-ifc: el visor 3D pide su .wasm a /web-ifc/<versión>/
// (lo copia allí scripts/copy-web-ifc.mjs), así un .wasm en caché nunca se
// mezcla con un bundle de otra versión.
const WEB_IFC_VERSION = JSON.parse(readFileSync('node_modules/web-ifc/package.json', 'utf8')).version;
// Versión del formato .frag: invalida los modelos guardados en la caché del navegador al actualizar
const FRAGMENTS_VERSION = JSON.parse(readFileSync('node_modules/@thatopen/fragments/package.json', 'utf8')).version;

// PDF.js Worker requiere estos headers (mismos que pide el Nginx de producción)
const ISOLATION_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

// Visor estático con DOS páginas (código en src/, organizado por dominio):
//   /          visor de planos (PDF, 2D)   → index.html        + src/main.ts
//   /modelo/   visor del modelo (IFC, 3D)  → modelo/index.html + src/main-modelo.ts
export default defineConfig({
  root: '.',
  base: '/',               // sirve en la raíz → assets quedan como /assets/...
  define: {
    __WEB_IFC_VERSION__: JSON.stringify(WEB_IFC_VERSION),
    __FRAGMENTS_VERSION__: JSON.stringify(FRAGMENTS_VERSION),
  },
  // El worker de conversión IFC (modelo-3d/bim-convert.worker.ts) es un módulo ES
  worker: { format: 'es' },
  server: {
    port: 8080,
    host: '127.0.0.1',
    headers: ISOLATION_HEADERS,
  },
  // `npm run preview` sirve dist/ con los mismos headers que producción
  preview: {
    host: '127.0.0.1',
    headers: ISOLATION_HEADERS,
  },
  build: {
    outDir: 'dist',
    // 'hidden': los .map se generan en dist/ (para descifrar un error de
    // producción en local) pero los bundles NO los referencian y deploy.sh no
    // los sube. Con `true`, DevTools mostraba el código y las carpetas de src/.
    sourcemap: 'hidden',
    target: 'es2020',
    // vendor (fabric+pdfjs) y bim (three + That Open) son legítimamente grandes;
    // no es código de la app
    chunkSizeWarningLimit: 6000,
    rollupOptions: {
      input: {
        planos: resolve(__dirname, 'index.html'),
        modelo: resolve(__dirname, 'modelo/index.html'),
      },
      output: {
        // Librerías que cambian poco → chunks cacheables aparte del código de la app.
        // 'bim' sólo se descarga al abrir un modelo 3D (import dinámico).
        // Función (no objeto): con la forma objeto, Rollup mete también las
        // dependencias de esas librerías —incluido el ayudante de precarga de
        // Vite— y la página de planos acababa descargando todo el motor 3D.
        // Comprobar tras tocar esto: dist/index.html NO debe precargar bim-*.js.
        manualChunks(id) {
          // Ayudantes de Vite/Rollup que usan las dos páginas: en su propio chunk
          // (si no, Rollup los mete en el de la primera librería que los pide)
          if (id.includes('vite/preload-helper') || id.includes('commonjsHelpers')) return 'runtime';
          if (/node_modules\/(fabric|pdfjs-dist)\//.test(id)) return 'vendor';
          if (/node_modules\/(three|web-ifc|camera-controls|three-mesh-bvh|earcut|@thatopen)\//.test(id)) return 'bim';
        },
      },
    },
  },
});
