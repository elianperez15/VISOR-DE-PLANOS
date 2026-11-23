/* ──────────────────────────────────────────────────────────────────────
   toolbar.ts — Herramientas de anotación: riel, estilo, deshacer y marcas

     · activar herramienta (riel + submenús de grupo)
     · estilo de las próximas figuras (trazo, relleno, grosor, texto)
     · deshacer / rehacer
     · mostrar / ocultar todas las marcas
     · eliminar MIS marcas de la página
   ────────────────────────────────────────────────────────────────────── */
import { closeAllDropdowns } from '../compartido/ui/dropdowns';
import { renderIcons } from '../compartido/ui/icons';
import { showHint } from '../compartido/ui/hint';
import type { ConfirmDialog } from '../compartido/ui/confirm';
import type { MarkupLayer } from './lienzo/markup-layer';
import { ANNOT_TOOLS, MEASURE_TOOLS, TOOL_HINTS } from './tool-defs';

export interface ToolbarCtx {
  getMarkup(): MarkupLayer | null;
  confirm: ConfirmDialog;
  /** Se va a cambiar de herramienta (p.ej. cancelar el modo Nube RFI). */
  onBeforeActivate(): void;
  /** Se eliminaron mis marcas de la página actual. */
  onMyMarksCleared(): void;
}

export function createToolbar(ctx: ToolbarCtx) {
  const $ = (id: string) => document.getElementById(id) as any;
  let markupVisible = true;

  function activateTool(tool: string) {
    const markup = ctx.getMarkup();
    if (!markup) return;
    ctx.onBeforeActivate();
    markup.setTool(tool);
    closeAllDropdowns();

    document.querySelectorAll('.tb-tool, .tb-tool-group-btn').forEach(b => b.classList.remove('tb-btn-active'));
    // Marcar el/los botones directos con esta herramienta (barra o items de menú)
    document.querySelectorAll(`.tb-tool[data-tool="${tool}"]`).forEach(b => b.classList.add('tb-btn-active'));

    // Si la herramienta vive dentro de un grupo (submenú del riel), reflejarla en
    // el botón del grupo: icono + nombre + estado activo.
    const info = ANNOT_TOOLS[tool] || MEASURE_TOOLS[tool];
    if (info) {
      document.querySelectorAll(`.tb-dropdown .tb-tool[data-tool="${tool}"]`).forEach(item => {
        const groupBtn = item.closest('.tb-dropdown-wrap')?.querySelector<HTMLElement>('.rail-group');
        if (!groupBtn) return;
        const icon = groupBtn.querySelector('.tool-gicon');
        const name = groupBtn.querySelector('.tool-gname');
        if (icon) icon.innerHTML = `<i data-lucide="${info.lc}"></i>`;
        if (name) name.textContent = info.name;
        // Recordar la herramienta elegida: al hacer clic en el cuerpo del grupo
        // (no en el caret) se vuelve a activar esta misma.
        groupBtn.dataset.tool = tool;
        groupBtn.classList.add('tb-btn-active');
        renderIcons(groupBtn);
      });
    }

    showHint(TOOL_HINTS[tool] || '', true);
  }

  /** Refleja en los botones si hay algo que deshacer / rehacer. */
  function updateUndoButtons(undoCount: number, redoCount: number) {
    $('btn-undo').disabled = !undoCount;
    $('btn-redo').disabled = !redoCount;
  }

  /** Relleno = color + opacidad del deslizador. */
  function syncFill() {
    const hex = $('fill-color').value, alpha = parseInt($('fill-alpha').value, 10) / 100;
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    ctx.getMarkup()?.setFillColor(`rgba(${r},${g},${b},${alpha.toFixed(2)})`);
    const echo = $('fill-alpha-val');
    if (echo) echo.textContent = $('fill-alpha').value + '%';
  }

  function toggleMarkupVisibility() {
    const markup = ctx.getMarkup();
    if (!markup) return;
    const btn = $('btn-toggle-markup');
    markupVisible = !markupVisible;
    markup.setMarkupVisible(markupVisible);
    btn.classList.toggle('tb-btn-active', !markupVisible);
    btn.innerHTML = markupVisible
      ? '<i data-lucide="eye"></i> Mostrar / ocultar todas las marcas'
      : '<i data-lucide="eye-off"></i> Marcas ocultas — mostrar';
    renderIcons(btn);
    // El botón del menú (layers) indica si hay algo oculto
    $('btn-markup-menu')?.classList.toggle('tb-btn-active', markupVisible);
  }

  function confirmClearMyMarks() {
    if (!ctx.getMarkup()) return;
    ctx.confirm.open({
      title  : 'Eliminar mis marcas',
      message: '¿Seguro que quieres eliminar todas tus marcas de esta página? Esta acción no se puede deshacer.',
      okText : 'Eliminar',
      danger : true,
      onConfirm: () => {
        ctx.getMarkup().clearMyMarkup();   // borra solo lo del usuario actual
        ctx.onMyMarksCleared();
        showHint('Tus marcas de esta página fueron eliminadas');
      },
    });
  }

  /** Enlaza el riel y los controles de estilo (una vez al inicio). */
  function init() {
    document.querySelectorAll<HTMLElement>('.tb-tool').forEach(btn => {
      btn.addEventListener('click', () => activateTool(btn.dataset.tool));
    });
    // Botón de grupo del riel: el cuerpo activa la herramienta actual del grupo;
    // el caret (>) despliega el resto de opciones (lo abre dropdowns.ts).
    document.querySelectorAll<HTMLElement>('.rail-group').forEach(btn => {
      btn.addEventListener('click', e => {
        if ((e.target as HTMLElement).closest('.tb-caret')) return;
        const tool = btn.dataset.tool;
        if (tool) activateTool(tool);
      });
    });

    $('stroke-color').addEventListener('input', (e: any) => { ctx.getMarkup()?.setStrokeColor(e.target.value); syncFill(); });
    $('fill-color')  .addEventListener('input', syncFill);
    $('fill-alpha')  .addEventListener('input', syncFill);
    $('stroke-width').addEventListener('change', (e: any) => ctx.getMarkup()?.setStrokeWidth(e.target.value));
    $('font-size')?.addEventListener('change', (e: any) => ctx.getMarkup()?.setFontSize(e.target.value));

    $('btn-toggle-markup')?.addEventListener('click', toggleMarkupVisibility);
    $('btn-undo').addEventListener('click', () => ctx.getMarkup()?.undo());
    $('btn-redo').addEventListener('click', () => ctx.getMarkup()?.redo());
    $('btn-clear')?.addEventListener('click', confirmClearMyMarks);
  }

  return { init, activateTool, updateUndoButtons };
}

export type Toolbar = ReturnType<typeof createToolbar>;
