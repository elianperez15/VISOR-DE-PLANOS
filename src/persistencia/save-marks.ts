/* ──────────────────────────────────────────────────────────────────────
   save-marks.ts — Botón «Guardar»: persiste explícitamente las marcas
   propias, la rotación y la escala del plano (sólo con permiso de colaborador).
   ────────────────────────────────────────────────────────────────────── */
import { showSaveToast } from '../compartido/ui/save-toast';

export interface SaveMarksCtx {
  hasDocument(): boolean;
  canSave(): boolean;
  /** Vuelca a la sesión el estado actual (página, rotación, escala). */
  syncSession(): { docId: string | null };
  saveNow(): Promise<boolean>;
}

export function initSaveMarks(ctx: SaveMarksCtx): void {
  const btn = document.getElementById('btn-save-marks') as HTMLButtonElement | null;
  btn?.addEventListener('click', async () => {
    if (!ctx.hasDocument()) return;
    if (!ctx.canSave()) { showSaveToast('error', 'No tienes permiso para guardar', 3000); return; }
    const session = ctx.syncSession();
    if (session.docId == null) {     // archivo local (sin sala): no hay servidor donde guardar
      showSaveToast('error', 'Sin servidor: usa Descargar para exportar', 3000);
      return;
    }
    btn.disabled = true;             // evita doble clic durante el guardado
    showSaveToast('loading', 'Guardando…');
    const ok = await ctx.saveNow();
    btn.disabled = false;
    if (ok) showSaveToast('success', 'Cambios guardados', 3000);
    else    showSaveToast('error',   'No se pudo guardar. Reintenta.', 3000);
  });
}
