/* ──────────────────────────────────────────────────────────────────────
   model-views-panel.ts — Panel "Vistas"

   Dos cosas distintas que se miran juntas:

   · Vistas 2D del modelo — plantas (una por nivel del IFC) y alzados.
     Abrir una pone la cámara mirando ese plano; "Volver al 3D" la cierra.

   · Puntos de vista — encuadres guardados a mano, con los elementos que
     estaban seleccionados y una miniatura. Viven mientras el visor está
     abierto (como las mediciones).

   Los nombres vienen del IFC: se insertan como texto, nunca como HTML.
   ────────────────────────────────────────────────────────────────────── */
import { renderIcons } from '../compartido/ui/icons';
import type { BimEngine } from './bim-engine';
import type { ViewItem, ViewpointItem } from './bim-types';

const KIND_LABEL: Record<ViewItem['kind'], string> = {
  storey   : 'Plantas',
  elevation: 'Alzados',
  section  : 'Secciones',
};
const KIND_ORDER: ViewItem['kind'][] = ['storey', 'elevation', 'section'];

export function createViewsPanel(getEngine: () => BimEngine | null) {
  const $ = (id: string) => document.getElementById(id) as any;

  function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) {
    const node = document.createElement(tag);
    node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function icon(name: string) {
    const i = document.createElement('i');
    i.setAttribute('data-lucide', name);
    return i;
  }

  /* ── Vistas 2D ──────────────────────────────────────────────────── */

  function renderViews(items: ViewItem[]) {
    const root = $('model-views-2d');
    root.replaceChildren();
    const engine = getEngine();
    const openId = engine?.views.openId() || null;

    $('btn-views-back-3d').hidden = !openId;
    $('btn-views-generate').textContent = items.length ? 'Regenerar' : 'Generar plantas y alzados';

    if (!items.length) {
      root.append(el('p', 'model-panel-empty',
        'Genera las vistas para obtener una planta por cada nivel del modelo y los cuatro alzados.'));
      return;
    }

    for (const kind of KIND_ORDER) {
      const group = items.filter(v => v.kind === kind);
      if (!group.length) continue;
      root.append(el('p', 'views-group-title', KIND_LABEL[kind]));
      for (const view of group) {
        const row = el('button', 'views-row');
        row.title = 'Abrir esta vista';
        if (view.id === openId) row.classList.add('is-open');
        row.append(icon(kind === 'storey' ? 'layers' : 'square'), el('span', 'views-name', view.label));
        row.addEventListener('click', () => {
          const current = getEngine();
          if (!current) return;
          // Pulsar la vista abierta la cierra: así se alterna sin buscar el botón
          if (current.views.openId() === view.id) current.views.close();
          else current.views.open(view.id);
          renderViews(items);
        });
        root.append(row);
      }
    }
    renderIcons(root);
  }

  /* ── Puntos de vista ────────────────────────────────────────────── */

  function renderViewpoints(items: ViewpointItem[]) {
    const root = $('model-viewpoints');
    root.replaceChildren();

    if (!items.length) {
      root.append(el('p', 'model-panel-empty',
        'Encuadra el modelo como quieras y guárdalo para volver luego. Si hay elementos seleccionados, se guardan con él.'));
      return;
    }

    for (const item of items) {
      const row = el('div', 'viewpoint-row');

      const go = el('button', 'viewpoint-go');
      go.title = 'Volver a este encuadre';
      if (item.thumbnail) {
        const img = document.createElement('img');
        img.className = 'viewpoint-thumb';
        img.src = item.thumbnail;
        img.alt = '';
        go.append(img);
      } else {
        go.append(el('span', 'viewpoint-thumb viewpoint-thumb-empty'));
      }
      const text = el('span', 'viewpoint-text');
      text.append(
        el('span', 'viewpoint-name', item.title),
        el('span', 'viewpoint-count',
          item.count ? `${item.count} ${item.count === 1 ? 'elemento' : 'elementos'}` : 'Sin selección'),
      );
      go.append(text);
      go.addEventListener('click', async () => {
        const engine = getEngine();
        if (!engine) return;
        row.classList.add('is-busy');
        try { await engine.viewpoints.go(item.guid); } finally { row.classList.remove('is-busy'); }
      });

      const remove = el('button', 'viewpoint-remove');
      remove.title = 'Borrar';
      remove.append(icon('trash-2'));
      remove.addEventListener('click', () => {
        const engine = getEngine();
        if (!engine) return;
        engine.viewpoints.remove(item.guid);
        renderViewpoints(engine.viewpoints.list());
      });

      row.append(go, remove);
      root.append(row);
    }
    renderIcons(root);
  }

  /** Vacía el panel (al abrir otro modelo o cerrar el actual). */
  function reset() {
    renderViews([]);
    renderViewpoints([]);
  }

  /** Repinta sólo las vistas 2D: lo usa el atajo Escape, que cierra la vista
      abierta desde fuera del panel y deja la fila marcada como activa. */
  function reset2d() {
    const engine = getEngine();
    renderViews(engine ? engine.views.list() : []);
  }

  function init() {
    $('btn-views-generate').addEventListener('click', async () => {
      const engine = getEngine();
      if (!engine) return;
      const button = $('btn-views-generate');
      button.disabled = true;
      const previous = button.textContent;
      button.textContent = 'Generando…';
      try {
        renderViews(await engine.views.generate());
      } catch (e) {
        console.error('Generar vistas 2D:', e);
        $('model-views-2d').replaceChildren(
          el('p', 'model-panel-empty', 'No se pudieron generar las vistas de este modelo.'));
        button.textContent = previous;
      } finally {
        button.disabled = false;
      }
    });

    $('btn-views-back-3d').addEventListener('click', () => {
      const engine = getEngine();
      if (!engine) return;
      engine.views.close();
      renderViews(engine.views.list());
    });

    $('btn-viewpoint-save').addEventListener('click', async () => {
      const engine = getEngine();
      if (!engine) return;
      const button = $('btn-viewpoint-save');
      button.disabled = true;
      try {
        renderViewpoints(await engine.viewpoints.save());
      } catch (e) {
        console.error('Guardar punto de vista:', e);
      } finally {
        button.disabled = false;
      }
    });

    reset();
  }

  return { init, reset, reset2d };
}
