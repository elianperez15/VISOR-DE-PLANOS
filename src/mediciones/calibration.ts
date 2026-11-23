/* ──────────────────────────────────────────────────────────────────────
   calibration.ts — Calibración de la escala del plano (px ↔ unidad real)

   Dos modos en la misma modal:
     · Dos puntos — clic en dos puntos del plano + distancia real entre ellos.
     · Directo    — píxeles y distancia real tecleados.

   La escala es GLOBAL del plano: al calibrar se difunde a la sala y se
   AUTOGUARDA en el servidor, sin arrastrar las figuras que aún no se han
   guardado con «Guardar».
   ────────────────────────────────────────────────────────────────────── */
import { fabric } from 'fabric';
import { renderIcons } from '../compartido/ui/icons';
import { showSaveToast } from '../compartido/ui/save-toast';
import { setStatus } from '../compartido/ui/status-bar';
import type { MarkupLayer } from '../anotaciones/lienzo/markup-layer';
import type { ScaleManager, Point } from './scale-manager';

export interface CalibrationCtx {
  scaleManager: ScaleManager;
  getMarkup(): MarkupLayer | null;
  getSession(): { docId: string | null; scale: any };
  activateTool(tool: string): void;
  /** Difunde la escala a los colaboradores conectados (tiempo real). */
  broadcastScale(scale: any): void;
  /** Autoguarda SOLO la escala en el servidor. */
  saveScale(): Promise<boolean>;
}

export function createCalibration(ctx: CalibrationCtx) {
  const $ = (id: string) => document.getElementById(id) as any;
  const { scaleManager } = ctx;

  let mode: 'points' | 'direct' = 'points';
  let step = 0;                        // 1 = esperando 1.er punto · 2 = 2.º punto · 3 = distancia real
  let point1: Point | null = null;
  let point2: Point | null = null;
  let clickListener: ((opt: any) => void) | null = null;
  let guideLine: any = null;           // línea discontinua entre los dos puntos

  const measuredPx = () => Math.hypot(point2.x - point1.x, point2.y - point1.y);

  /* ── Escala ⇄ sesión ───────────────────────────────────────────────── */

  /** Escala parametrizada para persistir: píxeles medidos, distancia real y unidad. */
  function buildScaleObj() {
    if (!scaleManager.isCalibrated()) return null;
    return {
      pxPerUnit      : scaleManager.pxPerUnit,   // derivado (para los cálculos)
      pixeles        : scaleManager.pxDistance,  // píxeles medidos en el plano
      distancia_real : scaleManager.realValue,   // distancia real ingresada
      unidad         : scaleManager.unit,        // unidad de medida (m, cm, …)
      unit           : scaleManager.unit,        // alias inglés → lo lee el handler ORDS ($.scale.unit)
      ts             : Date.now(),               // hora de calibración → gana la más reciente
    };
  }

  /** Restaura la escala guardada (servidor o colaborador). */
  function applyScaleFromSession(scale: any) {
    if (!scale) return;
    const px   = scale.pixeles ?? null;
    const real = scale.distancia_real ?? null;
    const unit = scale.unidad || scale.unit || 'm';
    if (px > 0 && real > 0) {
      scaleManager.calibrate(px, real, unit);   // reconstruye desde los parámetros crudos
    } else if (scale.pxPerUnit) {
      scaleManager.pxPerUnit = scale.pxPerUnit; // compatibilidad con guardados antiguos
      scaleManager.unit      = unit;
    }
    updateScaleBadge();
  }

  /** Badge persistente con la escala calibrada (no se pierde al usar overlay). */
  function updateScaleBadge() {
    const el = $('scale-info');
    if (!el) return;
    if (scaleManager.isCalibrated()) {
      el.innerHTML = '<i data-lucide="ruler"></i> ';
      el.appendChild(document.createTextNode(`1 ${scaleManager.unit} = ${scaleManager.pxPerUnit.toFixed(1)} px`));
      renderIcons(el);
      el.style.display = '';
    } else {
      el.style.display = 'none';
    }
  }

  /* ── Modal ─────────────────────────────────────────────────────────── */

  /** Marca el chip de paso activo/completado (1..3) en el indicador visual. */
  function setStepChip(current: number) {
    const steps = $('cal-steps');
    if (!steps) return;
    steps.querySelectorAll('.cal-step-chip').forEach((chip: HTMLElement) => {
      const n = Number(chip.getAttribute('data-step'));
      chip.classList.toggle('is-active', n === current);
      chip.classList.toggle('is-done',   n <  current);
    });
  }

  function removeGuideLine() {
    const markup = ctx.getMarkup();
    if (!guideLine) return;
    markup && markup.canvas.remove(guideLine);
    guideLine = null;
    markup && markup.canvas.renderAll();
  }

  /** Reinicia el flujo de 2 puntos (sin cerrar la modal). */
  function resetPointsFlow() {
    step = 1; point1 = point2 = null;
    $('cal-step-1').style.display = 'block';
    $('cal-step-2').style.display = 'none';
    $('cal-step-3').style.display = 'none';
    $('cal-value').value = '';
    $('cal-result').style.display = 'none';
    $('btn-cal-apply').disabled = true;
    setStepChip(1);
    if (ctx.getMarkup()) removeGuideLine();
    addClickListener();
  }

  function switchTab(next: 'points' | 'direct') {
    mode = next;
    const isPoints = (next === 'points');
    $('cal-mode-points').style.display = isPoints ? 'block' : 'none';
    $('cal-mode-direct').style.display = isPoints ? 'none'  : 'block';
    $('btn-cal-tab-points').classList.toggle('cal-tab-active',  isPoints);
    $('btn-cal-tab-direct').classList.toggle('cal-tab-active', !isPoints);
    $('cal-result').style.display = 'none';

    // La modal queda anclada (clase modal-pick fija en el HTML): no salta al
    // cambiar de pestaña. En modo puntos el cursor es de mira sobre el canvas.
    if (isPoints) {
      resetPointsFlow();
    } else {
      removeClickListener();
      const markup = ctx.getMarkup();
      if (markup) markup.canvas.defaultCursor = 'default';
      $('btn-cal-apply').disabled = true;
      updateDirectPreview();
    }
  }

  function addClickListener() {
    const markup = ctx.getMarkup();
    if (clickListener || !markup) return;
    markup.canvas.defaultCursor = 'crosshair';
    clickListener = opt => {
      if (!step) return;
      const ptr = markup.canvas.getPointer(opt.e);
      if (step === 1) {
        point1 = ptr; step = 2;
        $('cal-step-1').style.display = 'none';
        $('cal-step-2').style.display = 'block';
        setStepChip(2);
      } else if (step === 2) {
        point2 = ptr; step = 3;
        $('cal-px-hint').innerHTML = `Distancia medida: <b>${measuredPx().toFixed(1)} px</b>`;
        $('cal-step-2').style.display = 'none';
        $('cal-step-3').style.display = 'block';
        setStepChip(3);
        $('cal-value').focus();
        updatePointsPreview();       // aún sin distancia real → Aplicar deshabilitado
        if (guideLine) markup.canvas.remove(guideLine);
        guideLine = new fabric.Line(
          [point1.x, point1.y, point2.x, point2.y],
          { stroke: '#facc15', strokeWidth: 2, strokeDashArray: [5, 3], selectable: false, evented: false },
        );
        markup.canvas.add(guideLine);
        markup.canvas.renderAll();
      }
    };
    markup.canvas.on('mouse:up', clickListener);
  }

  function removeClickListener() {
    const markup = ctx.getMarkup();
    if (clickListener && markup) { markup.canvas.off('mouse:up', clickListener); clickListener = null; }
  }

  function open() {
    point1 = point2 = null;
    $('cal-value').value = '';
    $('cal-px-direct').value = '';
    $('cal-val-direct').value = '';
    $('cal-result').style.display = 'none';
    $('btn-cal-apply').disabled = true;
    // Neutralizar la herramienta para que clicar puntos no dibuje ni seleccione
    if (ctx.getMarkup()) ctx.activateTool('select');
    switchTab('points');          // siempre abre en modo 2-puntos
    $('modal-calibrate').style.display = 'flex';
  }

  function close() {
    const markup = ctx.getMarkup();
    step = 0;
    $('modal-calibrate').style.display = 'none';
    removeClickListener();
    if (markup) markup.canvas.defaultCursor = 'default';
    removeGuideLine();
    markup && markup.setTool(markup.currentTool);
  }

  function isOpen() {
    return $('modal-calibrate').style.display === 'flex';
  }

  /** Muestra la escala resultante en la caja de resultado. */
  function showResult(pxPerUnit: number, unit: string) {
    $('cal-result-value').textContent = `1 ${unit} = ${pxPerUnit.toFixed(2)} px`;
    $('cal-result').style.display = 'flex';
  }

  function hideResult() {
    $('cal-result').style.display = 'none';
    $('btn-cal-apply').disabled = true;
  }

  /** Modo 2 puntos: recalcula la vista previa cuando cambia la distancia real. */
  function updatePointsPreview() {
    const real = parseFloat($('cal-value').value);
    if (point2 && real > 0) {
      showResult(measuredPx() / real, $('cal-unit').value);
      $('btn-cal-apply').disabled = false;
    } else {
      hideResult();
    }
  }

  function updateDirectPreview() {
    const px   = parseFloat($('cal-px-direct').value);
    const real = parseFloat($('cal-val-direct').value);
    if (px > 0 && real > 0) {
      showResult(px / real, $('cal-unit-direct').value);
      $('btn-cal-apply').disabled = false;
    } else {
      hideResult();
    }
  }

  /** Difunde la escala y la autoguarda (si el plano viene del servidor). */
  function persistScale() {
    const session = ctx.getSession();
    ctx.broadcastScale(session.scale);   // escala global → todos los colaboradores
    if (session.docId == null) return;   // archivo local: sin servidor donde guardar
    ctx.saveScale().then(ok => {
      showSaveToast(ok ? 'success' : 'error', ok ? 'Escala guardada' : 'No se pudo guardar la escala', 2500);
    });
  }

  function apply() {
    let px: number, real: number, unit: string;
    if (mode === 'direct') {
      px   = parseFloat($('cal-px-direct').value);
      real = parseFloat($('cal-val-direct').value);
      unit = $('cal-unit-direct').value;
      if (!px || px <= 0 || !real || real <= 0) { alert('Ingresa valores mayores a 0'); return; }
    } else {
      if (!point2) { alert('Haz clic en dos puntos del plano primero.'); return; }
      real = parseFloat($('cal-value').value);
      unit = $('cal-unit').value;
      if (!real || real <= 0) { alert('Ingresa un valor mayor a 0'); return; }
      px = measuredPx();
    }
    scaleManager.calibrate(px, real, unit);
    ctx.getSession().scale = buildScaleObj();
    persistScale();
    close();
    updateScaleBadge();
    setStatus(`Escala: 1 ${unit} = ${scaleManager.pxPerUnit.toFixed(2)} px  ✓`);
  }

  /** Enlaza la modal (una vez al inicio). */
  function init() {
    $('btn-calibrate').addEventListener('click', open);
    $('btn-cal-apply').addEventListener('click', apply);
    $('btn-cal-cancel').addEventListener('click', close);
    $('btn-cal-tab-points').addEventListener('click', () => switchTab('points'));
    $('btn-cal-tab-direct').addEventListener('click', () => switchTab('direct'));
    $('btn-cal-reset')?.addEventListener('click', resetPointsFlow);
    ['cal-px-direct', 'cal-val-direct', 'cal-unit-direct'].forEach(id =>
      $(id).addEventListener('input', updateDirectPreview));
    ['cal-value', 'cal-unit'].forEach(id =>
      $(id).addEventListener('input', updatePointsPreview));
    // Enter aplica (si es válido), Escape cierra la calibración.
    document.addEventListener('keydown', e => {
      if (!isOpen()) return;
      if (e.key === 'Escape') close();
      else if (e.key === 'Enter' && !$('btn-cal-apply').disabled) apply();
    });
  }

  return { init, isOpen, buildScaleObj, applyScaleFromSession, updateScaleBadge };
}
