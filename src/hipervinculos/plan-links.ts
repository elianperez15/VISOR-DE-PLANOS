/* ──────────────────────────────────────────────────────────────────────
   plan-links.ts — Hipervínculos de un plano a otro plano del repositorio

   Al colocar un enlace se abre el selector del plano destino (o APEX lo
   devuelve con { action:'setLinkTarget' }). Doble clic en el enlace → se
   pide a APEX que abra ese plano: el iframe va en sandbox y no puede abrir
   pestañas ni usar apex.server.process, el padre sí.
   ────────────────────────────────────────────────────────────────────── */
import { postToApex } from '../integracion-apex/apex-bridge';
import { createListPicker } from '../compartido/ui/list-picker';
import { showHint } from '../compartido/ui/hint';
import type { ConfirmDialog } from '../compartido/ui/confirm';
import type { MarkupLayer } from '../anotaciones/lienzo/markup-layer';
import { fetchPlanos, planoRow } from '../plano/plans-api';

const NO_TARGET = '— sin destino —';

export interface PlanLinksCtx {
  getMarkup(): MarkupLayer | null;
  getActive(): any;                     // figura abierta en el panel de propiedades
  getSession(): { docId: string | null };
  getProjectCode(): string | null;
  getUserName(): string;
  getUserId(): string | number | null;
  confirm: ConfirmDialog;
}

const isLink = (obj: any) => !!obj && obj.data?.type === 'link';

export function createPlanLinks(ctx: PlanLinksCtx) {
  const $ = (id: string) => document.getElementById(id) as any;
  let pickTarget: any = null;   // enlace al que se asignará el destino (también vía APEX)

  /** Asigna el plano destino a un enlace y lo refleja en el panel. */
  function setTarget(link: any, repoId: unknown, name: string, file?: string | null) {
    link.data.targetRepoId = repoId;
    link.data.targetName   = name;
    if (file !== undefined) link.data.targetFile = file;
    if (ctx.getActive() === link) $('ap-link-target-name').textContent = name;
    ctx.getMarkup()?.commitChange();
    showHint(`Enlace → ${name}`);
  }

  // El id del plano actual va como header `id` para excluirlo del listado.
  const picker = createListPicker({
    ids: { modal: 'modal-plano', search: 'plano-search', list: 'plano-list', close: 'btn-plano-close' },
    loadingText: 'Cargando planos…',
    fetchItems: () => fetchPlanos(ctx.getSession().docId, ctx.getProjectCode()),
    toRow: planoRow,
    onPick: (link, repo, name, item) => {
      if (!isLink(link)) return;
      setTarget(link, repo, name, item?.nombre_archivo || null);
    },
  });

  /** Al colocar un enlace se abre de una vez el selector del plano destino
      (diferido un frame para que primero termine la colocación). */
  function onLinkCreated(link: any) {
    pickTarget = link;
    requestAnimationFrame(() => picker.open(link));
  }

  /** Doble clic en un enlace: pide a APEX que abra el plano destino. */
  function follow(data: any) {
    const d = data || {};
    if (d.targetRepoId == null || String(d.targetRepoId).trim() === '') {
      showHint('Este enlace no tiene plano destino — selecciónalo y elige uno con "Elegir plano…"');
      return;
    }
    // Se pasa también una URL lista por si APEX decide abrirla directo.
    const params = new URLSearchParams();
    params.set('repoId', String(d.targetRepoId));
    if (d.targetFile) params.set('nombre', d.targetFile);
    const user = ctx.getUserName(), userId = ctx.getUserId();
    if (user && user !== 'Anónimo') params.set('usuario_conectado', user);
    if (userId != null) params.set('codigo_usuario', String(userId));
    const url = window.location.origin + window.location.pathname + '?' + params.toString();

    const msg = { action: 'openPlano', repoId: d.targetRepoId, name: d.targetName || null, file: d.targetFile || null, url };
    console.info('[SAF] openPlano →', msg);   // diagnóstico: qué se envía a APEX
    // UN solo envío (dos causaban doble modal). El padre valida e.origin.
    postToApex(msg);
    showHint(`Abriendo ${d.targetName || ('plano ' + d.targetRepoId)}…`);
  }

  /** APEX devuelve el plano elegido para el enlace pendiente (o el seleccionado). */
  function setTargetFromApex(target: { repoId: unknown; name?: string; file?: string }) {
    const link = pickTarget || ctx.getMarkup()?.canvas.getActiveObject();
    if (isLink(link) && target.repoId != null) {
      setTarget(link, target.repoId, target.name || `Plano ${target.repoId}`, target.file || undefined);
    }
    pickTarget = null;
  }

  function init() {
    picker.init();
    // Panel de propiedades: elegir / quitar el plano destino
    $('btn-ap-pick-plano')?.addEventListener('click', () => {
      const active = ctx.getActive();
      if (!isLink(active)) return;
      pickTarget = active;
      picker.open(active);
    });
    $('btn-ap-clear-plano')?.addEventListener('click', () => {
      const active = ctx.getActive();
      if (!isLink(active)) return;
      ctx.confirm.open({
        title: 'Quitar destino', message: '¿Quitar el plano destino de este enlace?',
        okText: 'Quitar', danger: true,
        onConfirm: () => {
          active.data.targetRepoId = null;
          active.data.targetName   = null;
          $('ap-link-target-name').textContent = NO_TARGET;
          ctx.getMarkup()?.commitChange();
        },
      });
    });
  }

  return { init, follow, onLinkCreated, setTargetFromApex };
}
