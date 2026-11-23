/* ──────────────────────────────────────────────────────────────────────
   session-file.ts — Exporta la sesión de marcado a un archivo JSON (Ctrl+S)

   Copia local de TODAS las marcas del documento (todas las páginas, escala y
   rotación). No sustituye al guardado en el servidor (botón «Guardar»).
   ────────────────────────────────────────────────────────────────────── */
import { setStatus } from '../compartido/ui/status-bar';
import type { PlanSession } from '../plano/plan-viewer';

/** Descarga `data` como archivo JSON. */
function downloadJson(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportSessionFile(session: PlanSession): void {
  const data = {
    version    : 3,
    docName    : session.docName,
    pages      : session.pages,
    pageHeights: session.pageHeights,
    scale      : session.scale,
    rotation   : session.rotation || 0,
  };
  downloadJson(data, `saf-markup-${session.docName.replace(/\.pdf$/i, '')}-${Date.now()}.json`);
  setStatus('Sesión JSON guardada ✓');
}
