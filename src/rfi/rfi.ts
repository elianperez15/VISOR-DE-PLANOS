/* ──────────────────────────────────────────────────────────────────────
   rfi.ts — RFIs (Request for Information) vinculados al plano

     · Nube RFI: nube roja, bloqueada, que al colocarse pide el RFI a vincular.
       Es la ÚNICA figura que se autoguarda (sólo ella y su sello).
     · Sello RFI: sello con un RFI elegido desde el panel de propiedades.
     · Doble clic en un sello / nube RFI → APEX abre su drawer (página 87490).
     · "Crear" en el selector → APEX abre la misma página en modo alta.
   ────────────────────────────────────────────────────────────────────── */
import { APEX_RFI_PAGE } from '../app/config';
import { postToApex } from '../integracion-apex/apex-bridge';
import { createListPicker } from '../compartido/ui/list-picker';
import { showHint } from '../compartido/ui/hint';
import { showSaveToast } from '../compartido/ui/save-toast';
import type { ConfirmDialog } from '../compartido/ui/confirm';
import type { MarkupLayer } from '../anotaciones/lienzo/markup-layer';
import { fetchRfis, rfiRow } from './rfi-api';

const RFI_CLOUD_COLOR = '#e1251b';   // rojo fijo de las nubes RFI

/* Los dos modos de la Nube RFI, igual que la nube normal:
     'cloud'      → dos puntos (arrastrar de esquina a esquina)
     'cloud-poly' → múltiples puntos (clic en cada vértice, doble clic cierra) */
const RFI_CLOUD_HINTS: Record<string, string> = {
  'cloud'     : 'Arrastra para dibujar la nube RFI · luego elige el RFI a vincular',
  'cloud-poly': 'Clic en cada punto de la nube RFI · doble clic para cerrar · luego elige el RFI',
};

export interface RfiCtx {
  getMarkup(): MarkupLayer | null;
  getActive(): any;                     // figura abierta en el panel de propiedades
  getSession(): { docId: string | null };
  getCurrentPage(): number;
  getProjectCode(): string | null;
  activateTool(tool: string): void;
  confirm: ConfirmDialog;
  /** Sincroniza en vivo la capa propia (y la vuelca a la sesión). */
  pushLocalLayer(): void;
  /** Autoguarda SOLO los objetos indicados de la página. */
  saveObjectsNow(page: number, objs: any[]): Promise<boolean>;
}

export function createRfi(ctx: RfiCtx) {
  const $ = (id: string) => document.getElementById(id) as any;
  // Activo → la próxima nube colocada abrirá el selector para vincular un RFI.
  let pendingRfiCloud = false;

  const picker = createListPicker({
    ids: { modal: 'modal-rfi', search: 'rfi-search', list: 'rfi-list', close: 'btn-rfi-close' },
    loadingText: 'Cargando RFIs…',
    fetchItems: () => fetchRfis(ctx.getProjectCode()),
    toRow: rfiRow,
    onPick: (target, id, label) => linkRfi(target, id, label),
    // Se cerró el selector SIN elegir → si era una nube RFI sin vincular, eliminarla
    onCancel: (target) => {
      if (target && target.data?.type === 'cloud' && target.data?.isRfi
          && (target.data?.rfiId == null || String(target.data.rfiId).trim() === '')) {
        ctx.getMarkup()?.removeCloud(target);
      }
    },
  });

  function linkRfi(target: any, id: string, label: string) {
    const markup = ctx.getMarkup();
    if (!target) return;
    target.data = Object.assign(target.data || {}, { rfiId: id, rfiLabel: label });
    if (ctx.getActive() === target) $('ap-rfi-name').textContent = label;
    if (target.data?.type === 'cloud' && markup) {
      // Nube RFI: colocar el SELLO de RFI (sin inclinación) junto a la nube
      markup.setRfiCloudStamp(target, `RFI ${id}`);
      ctx.pushLocalLayer();
      // Se persiste SOLO esta nube (+ su sello), sin arrastrar las demás figuras
      // que el usuario aún no ha guardado con el botón Guardar.
      const objs = markup.getObjectsJSONByCloudId(target.data.cloudId);
      ctx.saveObjectsNow(ctx.getCurrentPage(), objs).then(ok => {
        showSaveToast(ok ? 'success' : 'error', ok ? 'Nube RFI guardada' : 'No se pudo guardar la nube RFI', 3000);
      });
    } else {
      markup?.commitChange();
    }
    openRfiDrawer(id);   // al elegir, abre el drawer
  }

  /** Pide a APEX que abra el drawer del RFI. */
  function openRfiDrawer(rfiId: unknown) {
    if (rfiId == null || String(rfiId).trim() === '') return;
    postToApex({
      action  : 'openRfi',
      rfiId,                              // id del RFI elegido → lo recibe el drawer
      apexPage: APEX_RFI_PAGE,
      repoId  : ctx.getSession().docId,   // id_en_repositorio del plano (por si lo necesita)
      page    : ctx.getCurrentPage(),
    });
    showHint('Abriendo RFI…');
  }

  /** Abre la MISMA página de APEX pero para CREAR un RFI: va sin rfiId, sólo con
      el contexto del plano (el drawer decide que es alta al no recibir el id). */
  function openRfiCreate() {
    postToApex({
      action  : 'openRfi',
      apexPage: APEX_RFI_PAGE,
      mode    : 'create',
      repoId  : ctx.getSession().docId,
      page    : ctx.getCurrentPage(),
    });
    showHint('Abriendo creación de RFI…');
  }

  /** Doble clic en un sello RFI o en una nube RFI → abrir el RFI vinculado. */
  function onStampDblClick(data: any) {
    const d = data || {};
    const isRfi = String(d.label || '').toUpperCase() === 'RFI' || (d.type === 'cloud' && d.isRfi);
    if (!isRfi) return;
    if (d.rfiId) openRfiDrawer(d.rfiId);
    else showHint('Selecciona el RFI en el panel de propiedades');
  }

  /** Se colocó una nube: si estaba en modo Nube RFI, la convierte y pide el RFI.
      Se difiere al siguiente frame para que primero termine la colocación y el
      auto-select de la nube; así el selector abre limpio. */
  function onCloudCreated(cloud: any) {
    if (!pendingRfiCloud) return;
    pendingRfiCloud = false;
    cloud.data = Object.assign(cloud.data || {}, { isRfi: true });
    cloud.set({
      stroke: RFI_CLOUD_COLOR,
      lockScalingX: true, lockScalingY: true,     // tamaño protegido
      lockMovementX: true, lockMovementY: true,   // posición fija
      lockRotation: true,
      hasControls: false,
    });
    ctx.getMarkup().canvas.renderAll();
    requestAnimationFrame(() => picker.open(cloud));
  }

  /** Activa la nube normal y marca que, al colocarla, se vincule un RFI.
      OJO: activateTool() cancela el modo, por eso se activa DESPUÉS. */
  function activateRfiCloud(tool: string) {
    ctx.activateTool(tool);
    pendingRfiCloud = true;
    // El resaltado va en el botón Nube RFI, no en la herramienta de nube normal
    document.querySelectorAll(`.tb-tool[data-tool="${tool}"]`).forEach(b => b.classList.remove('tb-btn-active'));
    $('btn-cloud-group')?.classList.remove('tb-btn-active');
    const rfiBtn = $('btn-tool-cloud-rfi');
    if (rfiBtn) {
      rfiBtn.classList.add('tb-btn-active');
      rfiBtn.dataset.rfiTool = tool;   // el cuerpo del botón repite el último modo elegido
    }
    document.querySelectorAll<HTMLElement>('#dropdown-cloud-rfi .tb-drop-item')
      .forEach(item => item.classList.toggle('tb-btn-active', item.dataset.rfiTool === tool));
    showHint(RFI_CLOUD_HINTS[tool] || '', true);
  }

  /** Cualquier cambio de herramienta cancela el modo Nube RFI. */
  function onToolChange() {
    pendingRfiCloud = false;
    $('btn-tool-cloud-rfi')?.classList.remove('tb-btn-active');
    document.querySelectorAll('#dropdown-cloud-rfi .tb-drop-item').forEach(b => b.classList.remove('tb-btn-active'));
  }

  function init() {
    picker.init();
    $('btn-tool-cloud-rfi')?.addEventListener('click', (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('.tb-caret')) return;   // el caret abre el submenú
      activateRfiCloud($('btn-tool-cloud-rfi').dataset.rfiTool || 'cloud');
    });
    document.querySelectorAll<HTMLElement>('#dropdown-cloud-rfi .tb-drop-item').forEach(item => {
      item.addEventListener('click', () => activateRfiCloud(item.dataset.rfiTool));
    });

    // Panel de propiedades: elegir / quitar el RFI de un sello
    $('btn-ap-pick-rfi')?.addEventListener('click', () => {
      const active = ctx.getActive();
      if (active) picker.open(active);
    });
    $('btn-ap-clear-rfi')?.addEventListener('click', () => {
      const active = ctx.getActive();
      if (!active) return;
      ctx.confirm.open({
        title: 'Quitar RFI', message: '¿Desvincular el RFI de este sello?',
        okText: 'Quitar', danger: true,
        onConfirm: () => {
          active.data = Object.assign(active.data || {}, { rfiId: null, rfiLabel: null });
          $('ap-rfi-name').textContent = '— sin RFI —';
          ctx.getMarkup()?.commitChange();
        },
      });
    });

    // "Crear" (primera línea del selector): se cierra con dismiss() para NO
    // disparar onCancel — la nube RFI en curso se conserva y se puede vincular
    // después con "Elegir RFI…" en el panel.
    $('btn-rfi-create')?.addEventListener('click', () => {
      picker.dismiss();
      picker.refresh();   // el RFI nuevo debe aparecer la próxima vez que se abra
      openRfiCreate();
    });
  }

  return { init, onStampDblClick, onCloudCreated, onToolChange };
}
