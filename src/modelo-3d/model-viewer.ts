/* ──────────────────────────────────────────────────────────────────────
   model-viewer.ts — Visor del modelo 3D (IFC / .frag) — página /modelo/

   Un modelo llega del repositorio (APEX) o de la computadora del usuario
   ("Abrir IFC…" o arrastrando el archivo a la página; no se sube a ningún
   sitio). La vista tiene su propio loader, aviso de error y estado vacío.

   Herramientas (una a la vez): Seleccionar · Medir (distancia, área, volumen)
   · Corte. Paneles: Edificio (model-tree-panel) y Propiedades
   (model-properties-panel). Las herramientas van en el riel flotante, el
   mismo del visor de planos. Teclas: V selecciona, F encuadra, Esc vuelve a Seleccionar,
   Enter cierra un área/volumen, Supr borra la medida o el corte bajo el cursor.

   El motor (bim-engine.ts, three + That Open) se carga con import() la
   primera vez que se abre un modelo y luego se reutiliza.
   ────────────────────────────────────────────────────────────────────── */
import { API_MODELO, API_MODELO_FRAG, FRAGMENTS_VERSION } from '../app/config';
import { setStatus } from '../compartido/ui/status-bar';
import { downloadFile } from '../exportacion/download';
import type { LoadError } from '../plano/pdf-renderer';
import { documentHeaders } from '../plano/plans-api';
import type { BimEngine } from './bim-engine';
import type { SelectionInfo, ToolId } from './bim-types';
import { createPropertiesPanel } from './model-properties-panel';
import { createTreePanel } from './model-tree-panel';
import { createSearchPanel } from './model-search-panel';
import { createViewsPanel } from './model-views-panel';
import { createNavCube } from './model-navcube';
import { convertIfc, type IfcConversion } from './ifc-converter';
import { cacheKey, getCached, putCached } from './model-cache';
import { detectFormat, fetchModel, isModelFile, uploadFragments } from './models-api';

/** Lo que se muestra mientras se convierte un IFC (sólo pasa la primera vez). */
const CONVERT_NOTE = 'La primera vez un modelo grande tarda unos minutos. Después abrirá en segundos.';

/** Lo que hay que abrir: de dónde salen los bytes y con qué clave se guarda en caché. */
interface ModelSource {
  label: string;
  key: string | null;               // null → sin caché (URL directa de pruebas)
  /** id_en_repositorio, si viene del repositorio: permite devolverle el .frag. */
  repoId?: string | number;
  getBytes(): Promise<Uint8Array>;
}

const elapsed = (since: number) => {
  const s = Math.floor((Date.now() - since) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Qué hacer con cada herramienta (se muestra abajo mientras está activa). */
const TOOL_HINTS: Record<ToolId, string> = {
  'select'   : '',
  'length'   : 'Distancia: doble clic en el primer punto y doble clic en el segundo.',
  'area-face': 'Área de una cara: doble clic sobre una superficie del modelo.',
  'area-free': 'Área por puntos: doble clic en cada vértice y Enter para cerrar.',
  'volume'   : 'Volumen: doble clic en uno o varios elementos y Enter para calcular.',
  'clip'     : 'Corte: doble clic sobre una superficie para cortar ahí. Arrastra las flechas para moverlo.',
};
const TOOL_FOOTER = 'Supr borra lo que está bajo el cursor · Esc vuelve a Seleccionar';
const MEASURE_TOOLS: ToolId[] = ['length', 'area-face', 'area-free', 'volume'];

/** Botones que sólo tienen sentido con un modelo cargado. */
const MODEL_CONTROLS = ['btn-download-frag', 'btn-3d-fit', 'btn-3d-projection', 'btn-3d-style',
                        'btn-toggle-tree', 'btn-toggle-search', 'btn-toggle-views', 'btn-toggle-props',
                        'btn-tool-select', 'btn-measure-group', 'btn-tool-clip'];

/** Paneles laterales: id del panel y del botón que lo abre. */
type PanelId = 'tree' | 'search' | 'views' | 'props';
const PANELS: Record<PanelId, { panel: string; button: string }> = {
  tree  : { panel: 'model-tree-panel',   button: 'btn-toggle-tree'   },
  search: { panel: 'model-search-panel', button: 'btn-toggle-search' },
  views : { panel: 'model-views-panel',  button: 'btn-toggle-views'  },
  props : { panel: 'model-props-panel',  button: 'btn-toggle-props'  },
};
/** Los de la izquierda ocupan el mismo sitio: abrir uno cierra los otros. */
const LEFT: PanelId[] = ['tree', 'search', 'views'];

export function createModelViewer() {
  const $ = (id: string) => document.getElementById(id) as any;
  let enginePromise: Promise<BimEngine> | null = null;
  let engine: BimEngine | null = null;   // el motor ya creado (para la interfaz)
  let hasModel = false;
  let loading  = false;
  let openSeq  = 0;   // si llegan dos aperturas seguidas, sólo cuenta la última
  let tool: ToolId = 'select';
  let current: { id: string; name: string } | null = null;   // modelo mostrado (para descargarlo)
  let conversion: IfcConversion | null = null;                // conversión IFC en curso
  let selected: SelectionInfo | null = null;                  // lo seleccionado ahora (para etiquetarlo)

  const tree   = createTreePanel(() => engine);
  const search = createSearchPanel(() => engine);
  const views  = createViewsPanel(() => engine);
  const props  = createPropertiesPanel();
  const navcube = createNavCube(() => engine);

  /** Crea el motor la primera vez (descarga el chunk 3D). Si falla, se reintenta en la próxima apertura. */
  function getEngine(): Promise<BimEngine> {
    if (!enginePromise) {
      enginePromise = import('./bim-engine')
        .then(m => m.createBimEngine($('model-canvas'), {
          onSelection: info => {
            selected = info;
            props.render(info);
            if (info) setPanel('props', true);
            render();            // habilita o deshabilita "Etiquetar"
          },
          onToolsChange: render,
          onCameraMove: (azimuth, polar) => navcube.setAngles(azimuth, polar),
        }))
        .then(created => (engine = created))
        .catch(e => { enginePromise = null; throw e; });
    }
    return enginePromise;
  }

  /** Estado vacío y controles según haya modelo, carga en curso o aviso. */
  function render() {
    $('model-empty').hidden = hasModel || loading || !$('model-notice').hidden;
    MODEL_CONTROLS.forEach(id => { $(id).disabled = !hasModel; });
    navcube.setVisible(hasModel);
    $('btn-3d-mark').disabled = !hasModel || !selected;
    $('btn-3d-clear-tools').disabled = !engine?.tools.hasContent() && !engine?.markers.count();
  }

  /* ── Paneles y herramientas ────────────────────────────────────────── */

  function setPanel(which: PanelId, open: boolean) {
    const { panel, button } = PANELS[which];
    $(panel).hidden = !open;
    $(button).classList.toggle('tb-btn-active', open);
    // Árbol y búsqueda comparten el lado izquierdo: sólo uno a la vez
    if (open && LEFT.includes(which)) {
      for (const other of LEFT) if (other !== which) setPanel(other, false);
    }
    if (open && which === 'search') $('model-search-text').focus();
    // Ocultar o aislar también se hace desde Buscar, así que al volver al
    // árbol sus ojos podrían estar desactualizados: se repintan al abrirlo.
    if (open && which === 'tree') tree.refreshVisibility();
  }

  /** Deja la barra y el menú coherentes con el modo de representación activo. */
  function showStyle(style: { id: string; label: string }) {
    $('btn-3d-style-label').textContent = style.label;
    document.querySelectorAll<HTMLElement>('[data-style3d]').forEach(item =>
      item.classList.toggle('tb-btn-active', item.dataset.style3d === style.id));
  }

  function setTool(next: ToolId) {
    tool = next;
    engine?.setTool(next);
    document.querySelectorAll<HTMLElement>('[data-tool3d]').forEach(b =>
      b.classList.toggle('tb-btn-active', b.dataset.tool3d === next));
    // Grupo "Medir" del riel: recuerda la última medición y muestra su icono (como los grupos del plano)
    const group = $('btn-measure-group');
    group.classList.toggle('tb-btn-active', MEASURE_TOOLS.includes(next));
    if (MEASURE_TOOLS.includes(next) && group.dataset.tool3dGroup !== next) {
      group.dataset.tool3dGroup = next;
      const item = document.querySelector<HTMLElement>(`.tb-drop-item[data-tool3d="${next}"]`);
      group.querySelector('.tool-gicon').innerHTML = item?.querySelector('svg')?.outerHTML || '';
    }
    const hint = TOOL_HINTS[next];
    $('model-hint').hidden = !hint;
    if (hint) {
      $('model-hint-text').textContent = hint;
      $('model-hint-footer').textContent = TOOL_FOOTER;
    }
  }

  function setLoader(text: string | null, note = '') {
    $('model-loader').hidden = text == null;
    if (text == null) return;
    $('model-loader-text').textContent = text;
    $('model-loader-note').textContent = note;
    $('model-loader-note').hidden = !note;
  }

  /** Convierte un IFC en el worker mostrando fase y tiempo; la página sigue respondiendo. */
  function convert(bytes: Uint8Array, label: string, superseded: () => boolean): Promise<Uint8Array> {
    const started = Date.now();
    let stage = 'geometría', progress = 0;
    const paint = () => {
      if (superseded()) return;
      const pct = progress > 0 ? ` ${Math.round(progress * 100)} %` : '';
      setLoader(`Convirtiendo ${label} · ${stage}${pct} · ${elapsed(started)}`, CONVERT_NOTE);
    };
    paint();
    const timer = setInterval(paint, 1000);
    conversion = convertIfc(bytes, (p, s) => { progress = p; stage = s; paint(); });
    return conversion.done.finally(() => { clearInterval(timer); conversion = null; });
  }

  function showNotice(reason: string, technical = '') {
    $('model-notice-text').textContent = reason;
    $('model-notice-tech').textContent = technical;
    $('model-notice-details').hidden = !technical;
    $('model-notice').hidden = false;
    render();
  }

  /* ── Abrir ─────────────────────────────────────────────────────────── */

  /**
   * Abre un modelo: 1) el .frag de la caché, si ya se convirtió antes;
   * 2) si no, lo descarga / lee; un IFC se convierte en el worker y se guarda
   * en caché; 3) el motor abre el .frag.
   */
  async function load(source: ModelSource) {
    const seq = ++openSeq;
    const superseded = () => seq !== openSeq;
    conversion?.cancel();   // una conversión de una apertura anterior ya no sirve
    const { label } = source;
    loading = true;
    $('model-notice').hidden = true;
    render();
    setLoader(`Cargando ${label}…`);
    setStatus('Cargando modelo…');
    try {
      const enginePromise = getEngine();   // se prepara mientras llegan los datos
      let frag = source.key ? await getCached(source.key) : null;
      const fromCache = !!frag;
      if (!frag) {
        const bytes = await source.getBytes();
        if (superseded()) return;
        if (detectFormat(bytes) === 'ifc') {
          frag = await convert(bytes, label, superseded);
          if (superseded()) return;
          if (source.key) {
            setLoader('Guardando el modelo convertido para la próxima vez…');
            await putCached(source.key, label, frag);
          }
          // Devolver el .frag al repositorio: la caché de IndexedDB sólo sirve
          // a ESTE navegador, así que sin esto cada usuario reconvertiría. No
          // se espera el resultado — el modelo ya se puede abrir.
          if (source.repoId != null) {
            void uploadFragments(API_MODELO_FRAG, source.repoId, label, frag, FRAGMENTS_VERSION);
          }
        } else {
          frag = bytes;
        }
      }
      console.info(`[SAF] modelo 3D «${label}» desde ${fromCache ? 'la caché del navegador' : 'el archivo de origen'} · .frag ${(frag.byteLength / 1048576).toFixed(1)} MB`);
      setLoader(fromCache ? `Abriendo ${label} (ya convertido antes)…` : `Abriendo ${label}…`);
      const engine = await enginePromise;
      if (superseded()) return;
      await engine.clear();
      hasModel = false;
      current = null;
      tree.render([]);
      selected = null;
      search.reset();
      views.reset();
      props.render(null);
      const modelId = await engine.loadFragments(frag, label);
      // Otra apertura más reciente tomó el visor mientras se abría: fuera este modelo
      if (superseded()) { await engine.remove(modelId); return; }
      hasModel = true;
      current = { id: modelId, name: label };
      $('model-name').textContent = label;
      setLoader('Organizando niveles y tipos de elemento…');
      const sections = await engine.structure.build();
      if (superseded()) return;
      tree.render(sections);
      showStyle(engine.currentStyle());
      await search.load();
      setPanel('tree', true);
      setTool('select');
      setStatus('');
    } catch (e) {
      if (superseded()) return;
      console.error('Abrir modelo 3D:', e instanceof Error ? `${e.name}: ${e.message}\n${e.stack || ''}` : e);
      const err: LoadError = e instanceof Error ? e : new Error(String(e));
      const reason = err.pista || 'No se pudo mostrar el modelo 3D. El archivo puede estar dañado o no ser un IFC válido.';
      setStatus('Error: ' + reason);
      showNotice(reason, err.tecnico || err.message);
    } finally {
      if (!superseded()) { loading = false; setLoader(null); render(); }
    }
  }

  /** Descarga el modelo abierto como .frag: es lo que conviene guardar en el repositorio. */
  async function downloadFragments() {
    if (!engine || !current) return;
    const button = $('btn-download-frag');
    button.disabled = true;
    try {
      const frag = await engine.exportFragments(current.id);
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(new Blob([frag as Uint8Array<ArrayBuffer>], { type: 'application/octet-stream' }));
      });
      downloadFile(dataUrl, current.name.replace(/\.(ifc|frag)$/i, '') + '.frag');
    } catch (e) {
      console.error('Descargar .frag:', e);
      setStatus('Error: no se pudo preparar el .frag');
    } finally {
      button.disabled = !hasModel;
    }
  }

  /** Abre un modelo desde una URL (IFC o .frag; el formato se detecta por el contenido). */
  function openFromUrl(url: string, name?: string | null, headers: Record<string, string> | null = null) {
    if (!url) return;
    load({ label: name || url.split('/').pop() || 'modelo 3D', key: null, getBytes: () => fetchModel(url, headers) });
  }

  /** Abre un modelo del repositorio por su id (mismo esquema de headers que el PDF). */
  function openFromRepo(repoId: unknown, name?: string | null) {
    if (repoId == null || repoId === '') return;
    load({
      label: name || `Modelo ${repoId}`,
      key: cacheKey.repo(repoId, name),   // ya convertido antes → ni siquiera se descarga
      repoId: repoId as string,
      getBytes: () => fetchModel(API_MODELO, documentHeaders(repoId as string, name)),
    });
  }

  /** Abre un IFC / .frag de la computadora del usuario (no se sube al servidor). */
  function openFile(file: File | null | undefined) {
    if (!file) return;
    if (!isModelFile(file.name)) {
      showNotice(`«${file.name}» no es un modelo 3D. Elige un archivo .ifc o .frag.`);
      return;
    }
    load({ label: file.name, key: cacheKey.file(file), getBytes: async () => new Uint8Array(await file.arrayBuffer()) });
  }

  function fit() {
    if (hasModel) engine?.fit();
  }

  /** Teclado de la vista 3D (salvo escribiendo en un campo). */
  function onKey(e: KeyboardEvent) {
    const tag = (document.activeElement as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (!hasModel || !engine || e.ctrlKey || e.metaKey || e.altKey) return;
    if (engine.tools.key(e.key)) { e.preventDefault(); return; }
    if (e.key === 'Escape') {
      // Primero sacar de la vista 2D: si el panel está cerrado, es la única salida
      if (engine.views.openId()) { engine.views.close(); views.reset2d(); return; }
      if (tool !== 'select') setTool('select');
      else engine.selection.clear();
      return;
    }
    if (e.key === 'f' || e.key === 'F') fit();
    if (e.key === 'v' || e.key === 'V') setTool('select');
  }

  /** Enlaza la barra (Abrir IFC, controles 3D) y el arrastre de archivos. */
  function init() {
    const input = $('ifc-file-input') as HTMLInputElement;
    const pickFile = () => input.click();
    input.addEventListener('change', () => {
      openFile(input.files?.[0]);
      input.value = '';   // permite volver a elegir el mismo archivo
    });
    $('btn-open-ifc').addEventListener('click', pickFile);
    $('btn-model-empty-open').addEventListener('click', pickFile);

    $('btn-3d-fit').addEventListener('click', fit);
    $('btn-3d-projection').addEventListener('click', async () => {
      if (!hasModel || !engine) return;
      const projection = await engine.toggleProjection();
      $('btn-3d-projection-label').textContent = projection === 'Orthographic' ? 'Ortográfica' : 'Perspectiva';
    });

    // Modo de representación: se elige en el desplegable (dropdowns.ts lo abre)
    document.querySelectorAll<HTMLElement>('[data-style3d]').forEach(item =>
      item.addEventListener('click', () => {
        if (!hasModel || !engine) return;
        showStyle(engine.setStyle(item.dataset.style3d!));
      }));

    for (const [id, { panel }] of Object.entries(PANELS)) {
      $(PANELS[id as PanelId].button).addEventListener('click', () => setPanel(id as PanelId, $(panel).hidden));
    }
    document.querySelectorAll<HTMLElement>('[data-close-panel]').forEach(b =>
      b.addEventListener('click', () => setPanel(b.dataset.closePanel as PanelId, false)));
    document.querySelectorAll<HTMLElement>('[data-tool3d]').forEach(b =>
      b.addEventListener('click', () => { if (hasModel) setTool(b.dataset.tool3d as ToolId); }));
    // Botón del grupo "Medir": el cuerpo activa la última medición; el caret abre el menú (dropdowns.ts)
    $('btn-measure-group').addEventListener('click', (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('.tb-caret') || !hasModel) return;
      setTool($('btn-measure-group').dataset.tool3dGroup as ToolId);
    });
    // Etiquetar: un rótulo con el nombre del elemento, o con cuántos hay
    $('btn-3d-mark').addEventListener('click', async () => {
      if (!engine || !selected) return;
      const text = selected.element?.title
        || `${selected.count} ${selected.count === 1 ? 'elemento' : 'elementos'}`;
      await engine.markers.add(engine.selection.current(), text);
      render();
    });

    $('btn-3d-clear-tools').addEventListener('click', () => {
      engine?.tools.clearAll();
      engine?.markers.clear();
      render();
    });
    $('btn-download-frag').addEventListener('click', downloadFragments);
    tree.init();
    search.init();
    views.init();
    props.render(null);
    document.addEventListener('keydown', onKey);

    // Arrastrar un .ifc a cualquier parte de la página. Sin esto, soltar un
    // archivo haría que el navegador lo abriera y saliera del visor.
    const wrapper = $('model-wrapper');
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    document.addEventListener('dragover', (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      wrapper.classList.add('is-dragover');
    });
    document.addEventListener('dragleave', (e: DragEvent) => {
      if (!e.relatedTarget) wrapper.classList.remove('is-dragover');   // salió de la ventana
    });
    document.addEventListener('drop', (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      wrapper.classList.remove('is-dragover');
      openFile(e.dataTransfer.files[0]);
    });

    render();
  }

  return {
    hasModel: () => hasModel,
    openFromUrl, openFromRepo, openFile, fit, init,
  };
}

export type ModelViewer = ReturnType<typeof createModelViewer>;
