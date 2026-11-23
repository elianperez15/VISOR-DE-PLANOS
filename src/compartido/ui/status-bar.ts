/* ──────────────────────────────────────────────────────────────────────
   status-bar.ts — Texto de estado de la barra superior (#tb-status)
   ────────────────────────────────────────────────────────────────────── */

export function setStatus(msg: string): void {
  const el = document.getElementById('tb-status');
  if (el) el.textContent = msg;
}
