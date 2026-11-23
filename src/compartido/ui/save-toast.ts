/* ──────────────────────────────────────────────────────────────────────
   save-toast.ts — Aviso flotante del resultado de un guardado (#save-toast)
   ────────────────────────────────────────────────────────────────────── */
import { renderIcons } from './icons';

export type ToastState = 'loading' | 'success' | 'error';

let hideTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Muestra el toast de guardado.
 * @param hideAfter ms hasta ocultarlo (0 = no se oculta solo; para 'loading').
 */
export function showSaveToast(state: ToastState, msg: string, hideAfter = 0): void {
  const toast = document.getElementById('save-toast');
  if (!toast) return;
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  toast.classList.remove('is-loading', 'is-success', 'is-error');
  toast.classList.add('is-' + state, 'is-visible');
  document.getElementById('save-toast-msg')!.textContent = msg;
  const icon = document.getElementById('save-toast-ic')!;
  // El spinner de 'loading' es puramente CSS (sin SVG)
  if (state === 'loading') {
    icon.innerHTML = '';
  } else {
    icon.innerHTML = `<i data-lucide="${state === 'success' ? 'check' : 'alert-triangle'}"></i>`;
    renderIcons(icon);
  }
  if (hideAfter > 0) hideTimer = setTimeout(hideSaveToast, hideAfter);
}

export function hideSaveToast(): void {
  document.getElementById('save-toast')?.classList.remove('is-visible');
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
}
