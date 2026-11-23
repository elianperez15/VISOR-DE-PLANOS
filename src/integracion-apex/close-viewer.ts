/* ──────────────────────────────────────────────────────────────────────
   close-viewer.ts — Botón "Cerrar visor": confirma y pide a APEX que cierre
   el iframe / diálogo que lo contiene.
   ────────────────────────────────────────────────────────────────────── */
import { closeAllDropdowns } from '../compartido/ui/dropdowns';
import type { ConfirmDialog } from '../compartido/ui/confirm';
import { requestClose } from './apex-bridge';

export function initCloseViewer(
  confirm: ConfirmDialog,
  message = 'Se cerrará el visor de planos. Asegúrate de haber guardado tus cambios.',
): void {
  document.getElementById('btn-close-viewer')?.addEventListener('click', () => {
    closeAllDropdowns();
    // Siempre pedir confirmación antes de cerrar (evita cierres accidentales).
    confirm.open({
      title: '¿Cerrar el visor?',
      message,
      okText: 'Cerrar',
      cancelText: 'Cancelar',
      danger: true,
      onConfirm: requestClose,
    });
  });
}
