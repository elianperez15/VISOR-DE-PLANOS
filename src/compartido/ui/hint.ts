/* ──────────────────────────────────────────────────────────────────────
   hint.ts — Leyenda flotante sobre el lienzo (#draw-hint)

   Las leyendas de acción se ocultan solas; las de herramienta (persist)
   quedan visibles hasta que otra las reemplaza.
   ────────────────────────────────────────────────────────────────────── */
import { renderIcons } from './icons';

const HINT_AUTO_HIDE_MS = 5000;
let hintTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Muestra `msg` (vacío → oculta). Admite un icono opcional con la sintaxis
 * `[[icon:nombre]] texto…`. El texto se inserta SIEMPRE como nodo de texto
 * (nunca como HTML) → seguro con datos de usuario.
 */
export function showHint(msg: string, persist = false): void {
  const el = document.getElementById('draw-hint');
  if (!el) return;
  clearTimeout(hintTimer);
  if (!msg) { el.style.display = 'none'; return; }
  el.innerHTML = '';
  let text = msg;
  const iconMatch = /^\s*\[\[icon:([a-z0-9-]+)\]\]\s*/i.exec(msg);
  if (iconMatch) {
    const icon = document.createElement('i');
    icon.setAttribute('data-lucide', iconMatch[1]);
    el.appendChild(icon);
    text = msg.slice(iconMatch[0].length);
  }
  el.appendChild(document.createTextNode(text));
  renderIcons(el);
  el.style.display = 'block';
  if (!persist) hintTimer = setTimeout(() => { el.style.display = 'none'; }, HINT_AUTO_HIDE_MS);
}
