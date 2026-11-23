/* ──────────────────────────────────────────────────────────────────────
   download.ts — Entrega de un archivo generado (PNG / PDF) al usuario

   Embebido en APEX el iframe va en sandbox y no puede disparar descargas:
   se le pasa el archivo al padre (postMessage downloadDoc) y él la dispara.
   Fuera de APEX, descarga directa.
   ────────────────────────────────────────────────────────────────────── */
import { isEmbedded, postToApex } from '../integracion-apex/apex-bridge';
import { showHint } from '../compartido/ui/hint';

export function downloadFile(dataUrl: string, filename: string): void {
  if (!dataUrl) return;
  if (isEmbedded()) {
    postToApex({ action: 'downloadDoc', filename, dataUrl });
    showHint('Descargando…');
  } else {
    const a = document.createElement('a');
    a.href = dataUrl; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
  }
}
