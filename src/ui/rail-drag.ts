/* ──────────────────────────────────────────────────────────────────────
   rail-drag.ts — Riel de herramientas flotante, arrastrable y orientable

   Permite mover el riel desde su asa (#rail-drag) y alternar su orientación
   (vertical / horizontal) con #rail-orient. Fija left/top explícitos (sin
   transform, que rompería el position:fixed de los flyouts), lo mantiene
   dentro del área visible y recuerda posición + orientación en localStorage.
   ────────────────────────────────────────────────────────────────────── */

import { renderIcons } from './icons';

const STORAGE_KEY = 'saf_rail_pos';

export function initRailDrag(): void {
  const rail   = document.getElementById('tool-rail');
  const handle = document.getElementById('rail-drag');
  const orient = document.getElementById('rail-orient');
  if (!rail || !handle) return;
  const container = rail.parentElement;   // .saf-main (position: relative)
  if (!container) return;

  // Aplica una posición explícita y la acota al área visible.
  const positionRail = (left: number, top: number) => {
    const maxLeft = Math.max(0, container.clientWidth  - rail.offsetWidth);
    const maxTop  = Math.max(0, container.clientHeight - rail.offsetHeight);
    left = Math.min(Math.max(0, left), maxLeft);
    top  = Math.min(Math.max(0, top),  maxTop);
    rail.style.left = left + 'px';
    rail.style.top  = top  + 'px';
    rail.style.transform = 'none';
    return { left, top };
  };

  const isHorizontal = () => rail.classList.contains('rail-horizontal');

  // Refleja la orientación en el icono del botón (y del asa vía CSS).
  const setOrientIcon = (horizontal: boolean) => {
    if (!orient) return;
    orient.innerHTML = `<i data-lucide="${horizontal ? 'arrow-up-down' : 'arrow-left-right'}"></i>`;
    renderIcons(orient);
  };

  const save = (left: number, top: number, horizontal: boolean) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ left, top, horizontal }));
    } catch (err) {}
  };

  // Estado inicial: posición + orientación guardadas (o vertical a la izquierda).
  let savedPosition: any = null;
  try { savedPosition = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch (err) {}
  if (savedPosition && savedPosition.horizontal) rail.classList.add('rail-horizontal');
  setOrientIcon(isHorizontal());
  requestAnimationFrame(() => {
    if (savedPosition && typeof savedPosition.left === 'number') positionRail(savedPosition.left, savedPosition.top);
    else positionRail(12, Math.max(12, (container.clientHeight - rail.offsetHeight) / 2));
  });

  // Alternar orientación: cambia la clase, actualiza icono, re-encaja y guarda.
  orient && orient.addEventListener('click', event => {
    event.stopPropagation();
    const horizontal = rail.classList.toggle('rail-horizontal');
    setOrientIcon(horizontal);
    requestAnimationFrame(() => {
      const pos = positionRail(parseFloat(rail.style.left) || 0, parseFloat(rail.style.top) || 0);
      save(pos.left, pos.top, horizontal);
    });
  });

  let dragging = false, grabOffsetX = 0, grabOffsetY = 0;

  handle.addEventListener('pointerdown', event => {
    event.preventDefault();
    const containerRect = container.getBoundingClientRect();
    const railRect = rail.getBoundingClientRect();
    grabOffsetX = event.clientX - railRect.left;
    grabOffsetY = event.clientY - railRect.top;
    positionRail(railRect.left - containerRect.left, railRect.top - containerRect.top);
    dragging = true;
    rail.classList.add('rail-dragging');
    handle.setPointerCapture(event.pointerId);
  });

  handle.addEventListener('pointermove', event => {
    if (!dragging) return;
    const containerRect = container.getBoundingClientRect();
    positionRail(event.clientX - containerRect.left - grabOffsetX, event.clientY - containerRect.top - grabOffsetY);
  });

  const end = (event: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    rail.classList.remove('rail-dragging');
    try { handle.releasePointerCapture(event.pointerId); } catch (err) {}
    save(parseFloat(rail.style.left), parseFloat(rail.style.top), isHorizontal());
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);

  // Re-encajar dentro del área al cambiar el tamaño de la ventana.
  window.addEventListener('resize', () => {
    if (rail.style.transform === 'none')
      positionRail(parseFloat(rail.style.left) || 0, parseFloat(rail.style.top) || 0);
  });
}
