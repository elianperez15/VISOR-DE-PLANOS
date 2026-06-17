import { defineConfig } from 'vite';

// Visor estático: index.html en la raíz, código en src/, assets vendoreados en public/
export default defineConfig({
  root: '.',
  publicDir: 'public',
  server: {
    port: 8080,
    host: '127.0.0.1',
    // PDF.js Worker requiere estos headers (mismos que pide el Nginx de producción)
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'es2020',
    // vendor (fabric+pdfjs) es legítimamente grande; no es código de la app
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        // fabric y pdfjs cambian poco → chunk vendor cacheable aparte del código de la app
        manualChunks: {
          vendor: ['fabric', 'pdfjs-dist'],
        },
      },
    },
  },
});
