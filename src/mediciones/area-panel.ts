/* ──────────────────────────────────────────────────────────────────────
   area-panel.ts — Resultado de la última medición de área / perímetro
   ────────────────────────────────────────────────────────────────────── */

export function showAreaResult(label: string): void {
  document.getElementById('area-value')!.textContent = label;
  document.getElementById('area-panel')!.style.display = 'flex';
}

export function hideAreaResult(): void {
  document.getElementById('area-panel')!.style.display = 'none';
}

export function initAreaPanel(): void {
  document.getElementById('btn-area-close')!.addEventListener('click', hideAreaResult);
}
