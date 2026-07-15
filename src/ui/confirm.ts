/* ──────────────────────────────────────────────────────────────────────
   confirm.ts — Modal de confirmación propia (reemplaza window.confirm)

   El confirm() nativo está bloqueado en iframes sandbox sin 'allow-modals',
   así que usamos un modal HTML. Reutilizable para cualquier acción que
   requiera confirmación (p.ej. eliminar marcas).
   ────────────────────────────────────────────────────────────────────── */
import { renderIcons } from './icons';

export interface ConfirmOpts {
  title?: string;
  message?: string;
  okText?: string;
  cancelText?: string;
  danger?: boolean;        // botón de confirmar en rojo (acción destructiva)
  onConfirm: () => void;
}

export function createConfirm() {
  const $ = (id: string) => document.getElementById(id) as any;
  let pendingCallback: (() => void) | null = null;

  function close() {
    const modal = $("modal-confirm");
    if (modal) modal.style.display = 'none';
    pendingCallback = null;
  }

  function open(opts: ConfirmOpts) {
    const modal = $("modal-confirm");
    if (!modal) return;
    $('confirm-title').textContent = opts.title || '¿Confirmar?';
    $('confirm-msg').textContent   = opts.message || '';
    const okButton = $('confirm-ok');
    okButton.textContent = opts.okText || 'Aceptar';
    okButton.classList.toggle('confirm-danger', opts.danger !== false);
    $('confirm-cancel').textContent = opts.cancelText || 'Cancelar';
    pendingCallback = opts.onConfirm;
    modal.style.display = "flex";
    renderIcons();
    okButton.focus();
  }

  /** Enlaza los eventos del modal (una vez al inicio). */
  function init() {
    $('confirm-cancel')?.addEventListener('click', close);
    $('modal-confirm')?.addEventListener('click', (e: any) => {
      if (e.target.id === 'modal-confirm') close();
    });
    $('confirm-ok')?.addEventListener('click', () => {
      const callback = pendingCallback;
      close();
      if (callback) callback();
    });
    document.addEventListener('keydown', e => {
      const modal = $("modal-confirm");
      if (e.key === 'Escape' && modal && modal.style.display !== 'none') close();
    });
  }

  return { open, init };
}
