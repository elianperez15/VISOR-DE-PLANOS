/* ──────────────────────────────────────────────────────────────────────
   keyboard-shortcuts.ts — Atajos de teclado globales del visor

     Ctrl/Cmd + Z / Y (o Shift+Z)   deshacer / rehacer
     Ctrl/Cmd + S                   exportar la sesión a JSON
     Ctrl/Cmd + = / + / -           zoom
     Ctrl/Cmd + 0 / 1               ajustar a pantalla / 100 %
     V · H · E                      seleccionar · mover vista · borrador
     F                              ajustar a pantalla
     P                              mostrar / ocultar el panel de propiedades
   Las FIGURAS no tienen atajo. Los atajos se ignoran mientras se escribe en un
   campo o con una modal abierta.
   ────────────────────────────────────────────────────────────────────── */
import type { MarkupLayer } from '../anotaciones/lienzo/markup-layer';

export interface KeyboardShortcutsCtx {
  getMarkup(): MarkupLayer | null;
  isModalOpen(): boolean;
  activateTool(tool: string): void;
  togglePanel(): void;
  exportSession(): void;
}

const TOOL_KEYS: Record<string, string> = { v: 'select', h: 'pan', e: 'eraser' };

export function initKeyboardShortcuts(ctx: KeyboardShortcutsCtx): void {
  document.addEventListener('keydown', e => {
    const tag = document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (ctx.isModalOpen()) return;
    const markup = ctx.getMarkup();

    if (e.ctrlKey || e.metaKey) {
      const actions: Record<string, () => void> = {
        z  : () => markup?.undo(),
        y  : () => markup?.redo(),
        s  : () => ctx.exportSession(),
        '=': () => markup?.zoomStep(1),
        '+': () => markup?.zoomStep(1),
        '-': () => markup?.zoomStep(-1),
        '0': () => markup?.fitToCanvas(),
        '1': () => markup?.zoomTo(1),
      };
      const key = (e.shiftKey && e.key === 'Z') ? 'y' : e.key;
      if (actions[key]) { actions[key](); e.preventDefault(); }
      return;
    }

    const tool = TOOL_KEYS[e.key.toLowerCase()];
    if (tool) { ctx.activateTool(tool); return; }

    switch (e.key) {
      case 'f': case 'F': markup?.fitToCanvas(); break;
      case 'p': case 'P': ctx.togglePanel(); break;
    }
  });
}
