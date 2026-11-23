/* ──────────────────────────────────────────────────────────────────────
   bim-engine.ts — Motor 3D (That Open Engine sobre three.js)

   Núcleo del motor: escena, cámara, carga de modelos. Las herramientas
   viven al lado (bim-selection, bim-structure, bim-tools) y se crean aquí.

   Sólo los archivos bim-*.ts importan three / @thatopen. model-viewer.ts
   carga este con import() dinámico, así el chunk "bim" (varios MB) sólo se
   descarga cuando alguien abre un modelo (la página /modelo/ arranca ligera).

   El motor sólo abre fragments (.frag). Un IFC se convierte ANTES, en un
   Web Worker (ifc-converter.ts → bim-convert.worker.ts), para que la página
   no se congele; el .frag resultante se guarda en caché (model-cache.ts).

   El worker de fragments lo empaqueta Vite (import …?url, nombre con hash):
   nada sale a unpkg.
   ────────────────────────────────────────────────────────────────────── */
import * as THREE from 'three';
import * as OBC from '@thatopen/components';
import * as OBF from '@thatopen/components-front';
import fragmentsWorkerUrl from '@thatopen/fragments/worker?url';
import type { SelectionInfo, ToolId } from './bim-types';
import { createSelection, type BimSelection } from './bim-selection';
import { createStructure, type BimStructure } from './bim-structure';
import { createFinder, type BimFinder } from './bim-finder';
import { createViews, type BimViews } from './bim-views';
import { createViewpoints, type BimViewpoints } from './bim-viewpoints';
import { createMarkers, type BimMarkers } from './bim-markers';
import { createNavCube, type BimNavCube } from './bim-navcube';
import { SELECTION_COLOR } from './bim-selection';
import { createTools, type BimTools } from './bim-tools';

export type Projection = 'Perspective' | 'Orthographic';

/** Un modo de representación del modelo, como lo ve el usuario. */
export interface VisualStyle {
  id: string;
  label: string;
  aspect: number;
  outlines: boolean;
  /** Vuelve el modelo translúcido para ver lo que hay dentro. */
  ghost?: boolean;
}

/* Los dos efectos que se combinan:
     · oclusión ambiental — oscurece esquinas y rincones (sensación de relieve)
     · aristas            — línea en los bordes de cada elemento

   DEFAULT_STYLE es el de arranque: 'plano' no aplica ninguno, así que el
   visor abre igual que antes del postproceso y los efectos quedan a un clic
   en el menú de la barra. */
const STYLES: VisualStyle[] = [
  { id: 'realista', label: 'Realista', aspect: OBF.PostproductionAspect.COLOR_PEN_SHADOWS, outlines: true },
  { id: 'sombras',  label: 'Sombras',  aspect: OBF.PostproductionAspect.COLOR_SHADOWS,     outlines: false },
  { id: 'fantasma', label: 'Fantasma', aspect: OBF.PostproductionAspect.COLOR_PEN,         outlines: true, ghost: true },
  { id: 'dibujo',   label: 'Dibujo',   aspect: OBF.PostproductionAspect.PEN,               outlines: true },
  { id: 'plano',    label: 'Plano',    aspect: OBF.PostproductionAspect.COLOR,             outlines: false },
];
const DEFAULT_STYLE = 'plano';

/** Los modos, para que la interfaz pinte el menú sin conocer el motor. */
export const VISUAL_STYLES: readonly VisualStyle[] = STYLES;

/** Lo que comparten las herramientas del motor. */
export interface BimContext {
  components: OBC.Components;
  world: OBC.SimpleWorld<OBC.SimpleScene, OBC.OrthoPerspectiveCamera, OBF.PostproductionRenderer>;
  fragments: OBC.FragmentsManager;
}

export interface BimEngineHooks {
  /** Cambió la selección (null = nada seleccionado). */
  onSelection(info: SelectionInfo | null): void;
  /** Se creó o borró una medida o un corte. */
  onToolsChange(): void;
  /** La cámara se movió: ángulos en RADIANES, para girar el cubo de navegación. */
  onCameraMove(azimuth: number, polar: number): void;
}

export interface BimEngine {
  selection: BimSelection;
  structure: BimStructure;
  tools: BimTools;
  finder: BimFinder;
  views: BimViews;
  viewpoints: BimViewpoints;
  markers: BimMarkers;
  navcube: BimNavCube;
  /** Cambia la herramienta activa (sólo con "Seleccionar" el clic selecciona). */
  setTool(tool: ToolId): void;
  /** Encuadra los elementos dados (o todo el modelo si no hay ninguno visible). */
  fitItems(items: OBC.ModelIdMap): Promise<void>;
  /** Muestra un modelo en formato fragments (.frag). Devuelve el id del modelo. */
  loadFragments(bytes: Uint8Array, name: string): Promise<string>;
  /** El modelo cargado, como .frag (para descargarlo y guardarlo en el repositorio). */
  exportFragments(modelId: string): Promise<Uint8Array>;
  /** Descarta un modelo concreto. */
  remove(modelId: string): Promise<void>;
  /** Descarta todos los modelos cargados (libera la memoria del worker). */
  clear(): Promise<void>;
  /** Encuadra todos los modelos en la vista. */
  fit(): Promise<void>;
  toggleProjection(): Promise<Projection>;
  /** Cambia el modo de representación (id de VISUAL_STYLES). */
  setStyle(id: string): VisualStyle;
  /** El modo activo, para marcar el menú y la etiqueta del botón. */
  currentStyle(): VisualStyle;
  dispose(): void;
}

export async function createBimEngine(container: HTMLElement, hooks: BimEngineHooks): Promise<BimEngine> {
  const components = new OBC.Components();
  const world = components.get(OBC.Worlds)
    .create<OBC.SimpleScene, OBC.OrthoPerspectiveCamera, OBF.PostproductionRenderer>();

  world.scene = new OBC.SimpleScene(components);
  world.scene.setup();
  world.scene.three.background = null;   // transparente: el fondo lo pone el CSS
  // PostproductionRenderer HEREDA de RendererWith2D, así que conserva la capa
  // 2D que usan las mediciones para su etiqueta, y además añade los efectos
  // (oclusión ambiental y contornos). Ver setStyle() más abajo.
  world.renderer = new OBF.PostproductionRenderer(components, container);
  // Sin el logo de That Open sobre la vista: la licencia (MIT) no lo exige y el
  // propio componente lo permite. La atribución va en "Licencias" (THIRD_PARTY_LICENSES.txt).
  world.renderer.showLogo = false;
  world.camera = new OBC.OrthoPerspectiveCamera(components);
  await world.camera.controls.setLookAt(30, 20, 30, 0, 0, 0);
  components.init();
  const grid = components.get(OBC.Grids).create(world);

  // Postproceso: sin esto el modelo se ve plano, sin profundidad ni aristas.
  // Se activa DESPUÉS de components.init(), que es quien arranca el bucle de
  // render. Mientras el usuario orbita, el componente lo baja solo y lo
  // restaura al soltar (turnOffOnManualMode), así no cuesta fluidez.
  /* ── Modo Fantasma ────────────────────────────────────────────────────
     No hay un interruptor en That Open: se consigue volviendo translúcidos
     los materiales del modelo. Se guarda el valor original de cada uno para
     poder restaurarlo, y se omite el material del resaltado (mismo color que
     SELECTION_COLOR) para que lo seleccionado siga viéndose sólido. */
  const GHOST_OPACITY = 0.3;
  const ghostColor = new THREE.Color(SELECTION_COLOR);
  const ghostOriginals = new Map<any, { transparent: boolean; opacity: number; depthWrite: boolean }>();
  let ghostOn = false;

  function ghostMaterial(material: any, on: boolean) {
    // El resaltado de la selección no se difumina: es lo que se quiere ver
    if (material?.color?.equals?.(ghostColor)) return;
    if (on) {
      if (!ghostOriginals.has(material)) {
        ghostOriginals.set(material, {
          transparent: material.transparent,
          opacity: material.opacity,
          depthWrite: material.depthWrite,
        });
      }
      material.transparent = true;
      material.opacity = GHOST_OPACITY;
      // Sin esto las caras translúcidas se tapan entre sí y no se ve el interior
      material.depthWrite = false;
    } else {
      const previous = ghostOriginals.get(material);
      if (!previous) return;
      material.transparent = previous.transparent;
      material.opacity = previous.opacity;
      material.depthWrite = previous.depthWrite;
      ghostOriginals.delete(material);
    }
    material.needsUpdate = true;
  }

  function setGhost(on: boolean) {
    ghostOn = on;
    for (const material of fragments.core.models.materials.list.values()) ghostMaterial(material, on);
    fragments.core.update(true);
  }

  const postproduction = world.renderer.postproduction;
  postproduction.enabled = true;
  // La retícula queda FUERA del postproceso: sin esto, cada modo le aplicaba
  // sus efectos (contornos sobre las líneas, oclusión que las oscurece) y el
  // suelo cambiaba de aspecto al cambiar de modo. Debe verse siempre igual.
  postproduction.excludedObjectsEnabled = true;
  postproduction.excludedObjectsPass.addExcludedMaterial(grid.material);
  let style: VisualStyle = STYLES.find(s => s.id === DEFAULT_STYLE) || STYLES[0];

  function setStyle(id: string): VisualStyle {
    const chosen = STYLES.find(s => s.id === id);
    if (!chosen) return style;
    style = chosen;
    // "Plano" no aplica ningún efecto: apagar el postproceso entero evita
    // pagar el coste del composer para no dibujar nada encima.
    const plain = chosen.id === 'plano';
    postproduction.enabled = !plain;
    if (!plain) {
      postproduction.style = chosen.aspect;
      postproduction.outlinesEnabled = chosen.outlines;
    }
    if (Boolean(chosen.ghost) !== ghostOn) setGhost(Boolean(chosen.ghost));
    return chosen;
  }

  setStyle(DEFAULT_STYLE);

  // Fragments: el worker se inicializa UNA sola vez por motor
  const fragments = components.get(OBC.FragmentsManager);
  fragments.init(fragmentsWorkerUrl);
  // El worker decide qué geometría dibujar según la cámara: hay que avisarle al moverla
  world.camera.controls.addEventListener('update', () => {
    fragments.core.update();
    // El cubo de navegación refleja hacia dónde mira la cámara
    hooks.onCameraMove(world.camera.controls.azimuthAngle, world.camera.controls.polarAngle);
  });
  world.camera.controls.addEventListener('rest',   () => fragments.core.update(true));
  fragments.list.onItemSet.add(({ value: model }) => {
    model.useCamera(world.camera.three);
    // El worker recorta la geometría con los planos de corte activos (Clipper)
    model.getClippingPlanesEvent = () => Array.from(world.renderer!.three.clippingPlanes) || [];
    world.scene.three.add(model.object);
    fragments.core.update(true);
  });
  // Sin parpadeo entre caras coplanares (z-fighting), como en los ejemplos oficiales
  fragments.core.models.materials.list.onItemSet.add(({ value: material }) => {
    if (!('isLodMaterial' in material && material.isLodMaterial)) {
      material.polygonOffset = true;
      material.polygonOffsetUnits = 1;
      material.polygonOffsetFactor = Math.random();
    }
    // Un material creado con el modo Fantasma activo nace ya translúcido
    if (ghostOn) ghostMaterial(material, true);
  });
  // Selección, mediciones y cortes necesitan "apuntar" al modelo con el ratón
  components.get(OBC.Raycasters).get(world);
  // Resaltado bajo el cursor: muestra qué se va a seleccionar ANTES de hacer
  // clic. MOUSE_MOVE es el modo por defecto del componente y el que hay que
  // usar: su documentación dice que el picking es lo bastante rápido y que
  // MOUSE_STOP sólo sirve si se quiere esperar a que el cursor se detenga
  // (es decir, introduce latencia a propósito).
  const hoverer = components.get(OBF.Hoverer);
  hoverer.world = world;
  hoverer.mode = OBF.HovererMode.MOUSE_MOVE;
  hoverer.fadeDuration = 90;   // suave, pero sin que se note como retardo
  // El material por defecto es un velo BLANCO translúcido, que sobre elementos
  // claros casi no se ve. Se cambia por el rojo del visor a baja opacidad:
  // mismo color que la selección pero mucho más tenue, así se distingue "esto
  // se seleccionaría" de "esto está seleccionado".
  //   · DoubleSide  — igual que en la selección: sin esto, un elemento con las
  //                   normales invertidas no se pinta.
  //   · polygonOffset — lo dibuja justo delante de la geometría de origen, sin
  //                   parpadeo y sin atravesar lo que tenga delante.
  hoverer.material = new THREE.MeshBasicMaterial({
    color: new THREE.Color(SELECTION_COLOR),
    transparent: true,
    opacity: 0.3,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  hoverer.enabled = true;
  // Al cambiar perspectiva ↔ ortográfica, los modelos deben seguir a la cámara nueva
  world.camera.projection.onChanged.add(camera => {
    for (const model of fragments.list.values()) model.useCamera(camera);
    fragments.core.update(true);
  });

  const ctx: BimContext = { components, world, fragments };
  const selection = createSelection(ctx, hooks.onSelection);
  const structure = createStructure(ctx);
  const tools = createTools(ctx, hooks.onToolsChange);
  const finder = createFinder(ctx);
  const views = createViews(ctx);
  const viewpoints = createViewpoints(ctx, selection);
  const markers = createMarkers(ctx);
  const navcube = createNavCube(ctx);
  let tool: ToolId = 'select';

  let seq = 0;   // los ids de modelo deben ser únicos dentro del motor
  const modelId = (name: string) => `${++seq}:${name}`;

  async function clear() {
    await selection.clear();
    tools.clearAll();
    structure.reset();
    finder.reset();
    views.reset();
    viewpoints.reset();
    markers.clear();
    for (const id of [...fragments.list.keys()]) await fragments.core.disposeModel(id);
  }

  async function fitBox(box: THREE.Box3) {
    if (box.isEmpty()) return;
    await world.camera.controls.fitToSphere(box.getBoundingSphere(new THREE.Sphere()), true);
  }

  async function fit() {
    const box = new THREE.Box3();
    for (const model of fragments.list.values()) box.union(model.box);
    await fitBox(box);
  }

  async function fitItems(items: OBC.ModelIdMap) {
    const box = await structure.box(items);
    if (box.isEmpty()) await fit(); else await fitBox(box);
  }

  // Doble clic: con "Seleccionar" acerca al elemento seleccionado; con las demás, mide o corta
  container.addEventListener('dblclick', () => {
    if (tool !== 'select') { tools.dblclick(); return; }
    const current = selection.current();
    if (Object.values(current).some(ids => ids.size)) fitItems(current);
  });

  return {
    selection,
    structure,
    tools,
    finder,
    views,
    viewpoints,
    markers,
    navcube,
    setTool(next) {
      tool = next;
      tools.set(next);
      selection.setEnabled(next === 'select');
      // Con medición o corte activos, el resaltado al pasar el ratón distrae
      // y compite con el punto que el usuario está intentando señalar.
      hoverer.enabled = next === 'select';
      if (next !== 'select') hoverer.clear();
    },
    fitItems,
    async loadFragments(bytes, name) {
      const id = modelId(name);
      await fragments.core.load(bytes, { modelId: id });
      await fit();
      return id;
    },
    async exportFragments(id) {
      const model = fragments.list.get(id);
      if (!model) throw new Error('No hay un modelo cargado');
      return new Uint8Array(await model.getBuffer(false));
    },
    async remove(id) {
      if (fragments.list.has(id)) await fragments.core.disposeModel(id);
    },
    clear,
    fit,
    async toggleProjection() {
      await world.camera.projection.toggle();
      return world.camera.projection.current as Projection;
    },
    setStyle,
    currentStyle: () => style,
    dispose() {
      components.dispose();
    },
  };
}
