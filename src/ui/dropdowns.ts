/* ──────────────────────────────────────────────────────────────────────
   dropdowns.ts — Menús desplegables / flyouts de la barra y el riel

   Los desplegables usan position:fixed y se posicionan con JS respecto al
   botón activador, para escapar del overflow de la barra/riel. Sin estado
   de aplicación: operan solo sobre el DOM.
   ────────────────────────────────────────────────────────────────────── */

/** Cierra todos los desplegables abiertos. */
export function closeAllDropdowns(): void {
  document.querySelectorAll('.tb-dropdown.open').forEach(d => d.classList.remove('open'));
}

/** Abre `dd` posicionado respecto a su botón activador `anchorBtn`. */
export function openDropdown(dd: HTMLElement, anchorBtn: HTMLElement): void {
  closeAllDropdowns();
  const r      = anchorBtn.getBoundingClientRect();
  const inRail = !!anchorBtn.closest('.tool-rail');
  if (inRail) {
    // Flyout a la derecha del riel
    dd.style.top  = r.top + 'px';
    dd.style.left = (r.right + 6) + 'px';
  } else {
    // Desplegable debajo del botón (barra superior)
    dd.style.top  = (r.bottom + 4) + 'px';
    dd.style.left = r.left + 'px';
  }
  dd.classList.add('open');

  // Reajustar si se sale por los bordes del viewport
  requestAnimationFrame(() => {
    const dr = dd.getBoundingClientRect();
    if (dr.right > window.innerWidth - 8)
      dd.style.left = Math.max(8, window.innerWidth - dr.width - 8) + 'px';
    if (dr.bottom > window.innerHeight - 8)
      dd.style.top = Math.max(8, window.innerHeight - dr.height - 8) + 'px';
  });
}

/** Enlaza apertura/cierre de todos los desplegables (llamar una vez al inicio). */
export function initDropdowns(): void {
  // Toggle al hacer clic en el botón activador
  document.querySelectorAll('.tb-dropdown-wrap').forEach(wrap => {
    const btn = wrap.querySelector('.tb-dropdown-btn') as HTMLElement | null;
    const dd  = wrap.querySelector('.tb-dropdown') as HTMLElement | null;
    if (!btn || !dd) return;
    btn.addEventListener('click', e => {
      e.stopPropagation();
      if (dd.classList.contains('open')) closeAllDropdowns();
      else                               openDropdown(dd, btn);
    });
  });

  // Cerrar al hacer clic en cualquier ítem
  document.querySelectorAll('.tb-drop-item').forEach(item => {
    item.addEventListener('click', () => closeAllDropdowns());
  });

  // Cerrar al hacer clic fuera / con Escape
  document.addEventListener('click', e => {
    if (!(e.target as HTMLElement).closest('.tb-dropdown-wrap')) closeAllDropdowns();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeAllDropdowns();
  });
}
