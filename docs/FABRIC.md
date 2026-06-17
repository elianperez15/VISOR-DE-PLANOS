# Fabric.js v5 — Referencia Completa de API

> Versión documentada: **5.3.0** · Licencia: **MIT** (libre para producción comercial)
> Documentación oficial: https://fabricjs.com/docs

---

## Índice

1. [Canvas](#1-canvas)
2. [StaticCanvas](#2-staticcanvas)
3. [Objetos base — fabric.Object](#3-objetos-base--fabricobject)
4. [Formas primitivas](#4-formas-primitivas)
5. [Texto — Text / IText / Textbox](#5-texto--text--itext--textbox)
6. [Imágenes — fabric.Image](#6-imágenes--fabricimage)
7. [Grupos — fabric.Group](#7-grupos--fabricgroup)
8. [Path (trazados SVG)](#8-path-trazados-svg)
9. [Dibujo libre — Brushes](#9-dibujo-libre--brushes)
10. [Eventos](#10-eventos)
11. [Viewport — Zoom y Pan](#11-viewport--zoom-y-pan)
12. [Animaciones](#12-animaciones)
13. [Gradientes](#13-gradientes)
14. [Patrones (Pattern)](#14-patrones-pattern)
15. [Sombras (Shadow)](#15-sombras-shadow)
16. [Filtros de imagen](#16-filtros-de-imagen)
17. [Controles y Handles](#17-controles-y-handles)
18. [Clipping — clipPath](#18-clipping--clippath)
19. [Serialización y persistencia](#19-serialización-y-persistencia)
20. [Exportar — PNG, JPEG, SVG](#20-exportar--png-jpeg-svg)
21. [Utilities — fabric.util](#21-utilities--fabricutil)
22. [Interacciones del usuario](#22-interacciones-del-usuario)
23. [Rendimiento y optimización](#23-rendimiento-y-optimización)
24. [Patrones de uso para construcción](#24-patrones-de-uso-para-construcción)

---

## 1. Canvas

`fabric.Canvas` es la clase principal. Hereda de `StaticCanvas` y agrega interactividad.

### Crear un canvas

```javascript
const canvas = new fabric.Canvas('mi-canvas', {
  width              : 1200,
  height             : 800,
  backgroundColor    : '#fff',         // color o null
  selection          : true,           // habilita selección múltiple
  preserveObjectStacking: true,        // mantiene z-order al seleccionar
  stopContextMenu    : true,           // evita menú contextual del browser
  fireRightClick     : true,           // dispara eventos con clic derecho
  fireMiddleClick    : true,           // dispara eventos con clic medio
  enableRetinaScaling: true,           // renderiza a 2x en pantallas retina
  allowTouchScrolling: false,          // scroll táctil al no tocar objetos
  imageSmoothingEnabled: true,         // antialiasing de imágenes
  uniformScaling     : false,          // escala proporcional por defecto
  uniScaleKey        : 'shiftKey',     // tecla para forzar escala uniforme
  altActionKey       : 'altKey',       // tecla para acción alternativa
  centeredScaling    : false,          // escalar desde el centro
  centeredRotation   : true,           // rotar desde el centro
  snapAngle          : 0,              // ángulo de snap (0 = deshabilitado)
  snapThreshold      : 5,              // píxeles de threshold para snap
  rotationCursor     : 'crosshair',
  defaultCursor      : 'default',
  freeDrawingCursor  : 'crosshair',
  moveCursor         : 'move',
  hoverCursor        : 'move',
  notAllowedCursor   : 'not-allowed',
  renderOnAddRemove  : true,           // re-renderiza al add/remove
  controlsAboveOverlay: false,
  perPixelTargetFind : false,          // hit-test por píxel (más preciso, más lento)
  targetFindTolerance: 0,
});
```

### Propiedades dinámicas del Canvas

```javascript
canvas.selection         = true/false;     // habilita/deshabilita selección
canvas.isDrawingMode     = true/false;     // modo dibujo libre
canvas.interactive       = true/false;     // habilita/deshabilita toda interacción
canvas.backgroundColor   = '#f0f0f0';
canvas.overlayColor      = 'rgba(0,0,0,0.2)'; // capa encima de objetos
canvas.backgroundImage   = fabricImageObj;
canvas.overlayImage      = fabricImageObj;
canvas.viewportTransform = [1,0,0,1,0,0]; // [scaleX,0,0,scaleY,translateX,translateY]
canvas.clipPath          = fabricShape;    // clip de todo el canvas
```

### Gestión de objetos

```javascript
// Agregar
canvas.add(obj);
canvas.add(obj1, obj2, obj3);   // múltiples objetos

// Eliminar
canvas.remove(obj);
canvas.remove(obj1, obj2);

// Obtener
canvas.getObjects();             // array de todos los objetos
canvas.getObjects('rect');       // filtrar por tipo
canvas.item(0);                  // objeto por índice
canvas.size();                   // total de objetos

// Búsqueda
canvas.getActiveObject();        // objeto activo (1 seleccionado)
canvas.getActiveObjects();       // array (selección múltiple)
canvas.findTarget(e, skipGroup); // objeto bajo cursor del evento e

// Z-order
canvas.sendToBack(obj);
canvas.bringToFront(obj);
canvas.sendBackwards(obj, intersecting);
canvas.bringForward(obj, intersecting);
canvas.moveTo(obj, index);
canvas.insertAt(obj, index);     // insertar en posición específica

// Selección
canvas.setActiveObject(obj);
canvas.discardActiveObject();
canvas.requestRenderAll();       // re-renderizar async (batched)
canvas.renderAll();              // re-renderizar inmediato (sync)

// Limpiar
canvas.clear();                  // elimina objetos Y background
canvas.getObjects().forEach(o => canvas.remove(o)); // solo objetos
```

### Dimensiones y posición

```javascript
canvas.setWidth(800);
canvas.setHeight(600);
canvas.setDimensions({ width: 800, height: 600 });
canvas.setDimensions({ width: '100%', height: '100%' }, { cssOnly: true }); // solo CSS

canvas.width;   // ancho actual
canvas.height;  // alto actual

// Calcular bounding box de todos los objetos
const bound = canvas.getObjects().reduce((acc, obj) => {
  const b = obj.getBoundingRect();
  return {
    left  : Math.min(acc.left,  b.left),
    top   : Math.min(acc.top,   b.top),
    right : Math.max(acc.right,  b.left + b.width),
    bottom: Math.max(acc.bottom, b.top  + b.height),
  };
}, { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });
```

### Background e Imagen superpuesta

```javascript
// Background sólido
canvas.setBackgroundColor('#eeeeee', canvas.renderAll.bind(canvas));

// Background imagen (callback)
canvas.setBackgroundImage(fabricImg, canvas.renderAll.bind(canvas), {
  scaleX     : canvas.width  / fabricImg.width,
  scaleY     : canvas.height / fabricImg.height,
  originX    : 'left',
  originY    : 'top',
  crossOrigin: 'anonymous',
});

// Overlay (encima de los objetos, debajo de los controles)
canvas.setOverlayImage(fabricImg, canvas.renderAll.bind(canvas));
canvas.setOverlayColor('rgba(255,0,0,0.1)', canvas.renderAll.bind(canvas));

// Quitar background
canvas.setBackgroundImage(null, canvas.renderAll.bind(canvas));
```

### Destroy

```javascript
canvas.dispose(); // limpia event listeners y libera memoria
```

---

## 2. StaticCanvas

`fabric.StaticCanvas` — canvas sin interactividad. Ideal para renderizado offscreen o thumbnails.

```javascript
const staticCanvas = new fabric.StaticCanvas('mi-canvas', {
  width : 800,
  height: 600,
});
staticCanvas.add(obj);
staticCanvas.renderAll();

// Export
const dataUrl = staticCanvas.toDataURL({ format: 'png', multiplier: 2 });
```

Diferencias con Canvas:
- Sin selección de objetos
- Sin eventos de ratón
- Sin modo dibujo libre
- ~20% más rápido en renderizado

---

## 3. Objetos base — fabric.Object

Todas las formas heredan de `fabric.Object`. Estas propiedades son comunes a todos.

### Posición y dimensiones

```javascript
{
  left        : 100,      // coordenada X del origen (default: originX='left')
  top         : 100,      // coordenada Y del origen (default: originY='top')
  width       : 200,      // ancho base (no incluye strokeWidth)
  height      : 150,      // alto base
  scaleX      : 1.0,      // escala horizontal
  scaleY      : 1.0,      // escala vertical
  angle       : 0,        // rotación en grados (sentido horario)
  flipX       : false,    // espejo horizontal
  flipY       : false,    // espejo vertical
  skewX       : 0,        // sesgo horizontal en grados
  skewY       : 0,        // sesgo vertical en grados
  originX     : 'left',   // 'left' | 'center' | 'right'
  originY     : 'top',    // 'top'  | 'center' | 'bottom'
}
```

### Apariencia

```javascript
{
  fill            : '#ff0000',       // color relleno: string, gradient, pattern, null
  stroke          : '#000000',       // color trazo: string, gradient, null
  strokeWidth     : 1,               // grosor del trazo
  strokeDashArray : [5, 5],          // trazo discontinuo [dash, gap, ...]
  strokeDashOffset: 0,               // offset del patrón dash
  strokeLineCap   : 'butt',          // 'butt' | 'round' | 'square'
  strokeLineJoin  : 'miter',         // 'miter' | 'round' | 'bevel'
  strokeMiterLimit: 4,               // límite miter
  strokeUniform   : false,           // trazo de grosor constante al escalar
  opacity         : 1.0,             // 0.0 – 1.0
  visible         : true,
  backgroundColor : '',              // fondo del bounding box del objeto
  globalCompositeOperation: 'source-over', // blend mode
  shadow          : null,            // fabric.Shadow
  paintFirst      : 'fill',          // 'fill' | 'stroke' (orden de pintado)
}
```

### Interacción

```javascript
{
  selectable       : true,   // puede seleccionarse
  evented          : true,   // recibe eventos de ratón
  lockMovementX    : false,  // bloquea movimiento horizontal
  lockMovementY    : false,  // bloquea movimiento vertical
  lockRotation     : false,  // bloquea rotación
  lockScalingX     : false,  // bloquea escala horizontal
  lockScalingY     : false,  // bloquea escala vertical
  lockScalingFlip  : false,  // evita flip al escalar a negativo
  lockSkewingX     : false,
  lockSkewingY     : false,
  hasControls      : true,   // muestra handles de control
  hasBorders       : true,   // muestra borde de selección
  hasRotatingPoint : true,   // muestra handle de rotación
  perPixelTargetFind: false, // hit-test píxel a píxel
  transparentCorners: true,  // corners de control transparentes
  cornerColor      : '#1865f2',
  cornerStrokeColor: '',
  cornerStyle      : 'rect', // 'rect' | 'circle'
  cornerSize       : 13,
  rotatingPointOffset: 40,
  borderColor      : '#1865f2',
  borderDashArray  : null,
  borderScaleFactor: 1,
  padding          : 0,      // padding del bounding box
  hoverCursor      : null,   // cursor al hover (null = heredar del canvas)
  moveCursor       : null,
}
```

### Propiedades de Canvas asociadas

```javascript
{
  canvas   : null,   // referencia al canvas padre (se asigna al hacer add)
  clipPath : null,   // forma de recorte
  inverted : false,  // invertir clip
  absolutePositioned: false, // clipPath en coordenadas absolutas
}
```

### Métodos de Object

```javascript
// Posición y transformación
obj.set('left', 200);
obj.set({ left: 200, top: 100 });  // set múltiple
obj.get('fill');
obj.setCoords();                   // recalcular coordenadas bounding box (llamar tras move manual)

obj.centerH();                     // centrar horizontalmente en canvas
obj.centerV();                     // centrar verticalmente en canvas
obj.center();                      // centrar en canvas (H + V)
obj.viewportCenter();              // centrar en viewport (con zoom)
obj.viewportCenterH();
obj.viewportCenterV();

obj.clone(callback, propertiesToInclude); // clonar objeto
obj.cloneAsImage(callback, options);      // renderizar a fabric.Image

// Geometría
obj.getBoundingRect(absolute, calculate); // {left, top, width, height}
obj.getCoords(absolute, calculate);       // 4 esquinas del bounding box [{x,y}×4]
obj.containsPoint(point);                 // {x, y} → boolean
obj.intersectsWithRect(pointTL, pointBR, absolute, calculate);
obj.intersectsWithObject(other);
obj.isContainedWithinObject(other);
obj.isContainedWithinRect(pointTL, pointBR);
obj.isOnScreen();                          // visible en el viewport actual

// Dimensiones
obj.getScaledWidth();    // width * scaleX
obj.getScaledHeight();   // height * scaleY
obj.scaleToWidth(value);   // escala uniformemente a width
obj.scaleToHeight(value);  // escala uniformemente a height

// Transformaciones de punto
obj.toLocalPoint(point, originX, originY);   // punto absoluto → local
obj.toGlobalPoint(point);                    // punto local → absoluto
obj.getAbsolutePosition();                   // {x, y} posición absoluta del origen
obj.getCenterPoint();                        // {x, y} centro absoluto

// Z-order
obj.sendToBack();
obj.bringToFront();
obj.sendBackwards(intersecting);
obj.bringForward(intersecting);
obj.moveTo(index);

// Representación
obj.toObject(propertiesToInclude);  // serializar a plain object
obj.toDatalessObject(propertiesToInclude);
obj.toSVG(reviver);                 // serializar a SVG string
obj.toString();

// Animación
obj.animate('left', 300, {
  duration : 500,
  onChange : canvas.renderAll.bind(canvas),
  easing   : fabric.util.ease.easeOutQuart,
  onComplete: () => console.log('done'),
});

// Eventos en objeto
obj.on('selected',    handler);
obj.on('deselected',  handler);
obj.on('moving',      handler);
obj.on('scaling',     handler);
obj.on('rotating',    handler);
obj.on('modified',    handler);
obj.on('mousedown',   handler);
obj.on('mouseup',     handler);
obj.on('mouseover',   handler);
obj.on('mouseout',    handler);
obj.on('mousedblclick', handler);
obj.off('moving', handler);

// Datos personalizados (no afectan render)
obj.data = { tipo: 'medida', valor: '5.50 m' };
```

---

## 4. Formas primitivas

### fabric.Rect

```javascript
const rect = new fabric.Rect({
  left       : 50,
  top        : 50,
  width      : 200,
  height     : 100,
  fill       : 'rgba(59,130,246,0.2)',
  stroke     : '#3b82f6',
  strokeWidth: 2,
  rx         : 8,   // radio de esquinas redondeadas
  ry         : 8,
});
canvas.add(rect);
```

### fabric.Circle

```javascript
const circle = new fabric.Circle({
  left  : 100,
  top   : 100,
  radius: 50,      // radio
  startAngle: 0,   // ángulo de inicio (grados)
  endAngle  : 360, // ángulo de fin
  fill  : 'transparent',
  stroke: '#ef4444',
  strokeWidth: 2,
});
```

### fabric.Ellipse

```javascript
const ellipse = new fabric.Ellipse({
  left  : 100,
  top   : 100,
  rx    : 80,   // radio horizontal
  ry    : 50,   // radio vertical
  fill  : 'transparent',
  stroke: '#22c55e',
  strokeWidth: 2,
});
```

### fabric.Triangle

```javascript
const triangle = new fabric.Triangle({
  left  : 100,
  top   : 100,
  width : 60,
  height: 60,
  fill  : '#ef4444',
  angle : 45,   // rotado 45°
});
```

### fabric.Line

```javascript
// Constructor: [x1, y1, x2, y2]
const line = new fabric.Line([50, 100, 300, 200], {
  stroke         : '#3b82f6',
  strokeWidth    : 2,
  strokeDashArray: [8, 4],  // línea discontinua
  strokeLineCap  : 'round',
});

// Propiedades específicas
line.x1; line.y1; // punto inicio (en coordenadas canvas)
line.x2; line.y2; // punto fin
```

### fabric.Polygon

```javascript
const hexagon = new fabric.Polygon([
  { x: 200, y: 100 },
  { x: 250, y: 100 },
  { x: 275, y: 143 },
  { x: 250, y: 186 },
  { x: 200, y: 186 },
  { x: 175, y: 143 },
], {
  fill  : 'rgba(239,68,68,0.15)',
  stroke: '#ef4444',
  strokeWidth: 2,
});

// Acceder a puntos del polígono (en coordenadas locales)
polygon.points; // Array de {x,y}
```

### fabric.Polyline

```javascript
// Como Polygon pero no cierra la figura (abierta)
const polyline = new fabric.Polyline([
  { x: 50,  y: 50  },
  { x: 150, y: 100 },
  { x: 250, y: 80  },
  { x: 300, y: 150 },
], {
  fill       : 'transparent',
  stroke     : '#3b82f6',
  strokeWidth: 2,
});
```

---

## 5. Texto — Text / IText / Textbox

### fabric.Text — Texto estático (no editable)

```javascript
const text = new fabric.Text('Hola mundo', {
  left      : 100,
  top       : 100,
  fontSize  : 20,
  fontFamily: 'Arial',
  fontWeight: 'bold',      // 'normal' | 'bold' | número
  fontStyle : 'italic',    // 'normal' | 'italic' | 'oblique'
  fill      : '#ffffff',
  stroke    : '#000000',
  strokeWidth: 0.5,
  textAlign : 'left',      // 'left' | 'center' | 'right' | 'justify'
  lineHeight: 1.16,        // interlineado (multiplicador)
  charSpacing: 0,          // espaciado entre caracteres (en milésimas de em)
  underline : false,
  overline  : false,
  linethrough: false,
  backgroundColor: '',    // fondo del texto
  textBackgroundColor: '', // fondo por carácter
  direction : 'ltr',       // 'ltr' | 'rtl'
  pathSide  : 'left',      // posición al usar textPath
  pathStartOffset: 0,      // offset en textPath
});

// Propiedades calculadas (read-only)
text.width;        // ancho calculado del texto
text.height;       // alto calculado
text.getLineWidth(lineIndex);
text.getLineHeight(lineIndex);
text.get2dCharacterCoordinates(lineIndex, charIndex);
```

### fabric.IText — Texto interactivo (editable con doble clic)

Hereda todo de `fabric.Text` y agrega edición inline.

```javascript
const itext = new fabric.IText('Edítame', {
  left      : 100,
  top       : 100,
  fontSize  : 18,
  fontFamily: 'Arial',
  fill      : '#e2e8f0',
  editable  : true,          // permite edición
  cursorColor: '#3b82f6',    // color del cursor
  cursorWidth: 2,
  cursorDelay: 1000,         // ms para parpadeo del cursor
  cursorDuration: 600,
  selectionColor: 'rgba(59,130,246,0.3)',
  selectionStart: 0,         // posición inicio de selección
  selectionEnd  : 0,         // posición fin de selección
});

// Métodos de edición
itext.enterEditing();          // activar modo edición
itext.exitEditing();           // salir de modo edición
itext.selectAll();             // seleccionar todo
itext.selectWord();            // seleccionar palabra actual
itext.selectLine();            // seleccionar línea actual
itext.getSelectedText();       // texto seleccionado
itext.insertChars('texto', styles, selectionStart, selectionEnd);
itext.removeChars(start, end);
itext.setSelectionStart(index);
itext.setSelectionEnd(index);

// Eventos de edición
itext.on('editing:entered',  () => { /* modo edición activo */ });
itext.on('editing:exited',   () => { /* modo edición terminó */ });
itext.on('changed',          () => { /* texto cambió */ });
itext.on('selection:changed',() => { /* selección cambió */ });

// Estilos por carácter / línea
itext.setSelectionStyles({
  fill     : 'red',
  fontWeight: 'bold',
});
itext.getSelectionStyles();
itext.cleanStyle('fill');
```

### fabric.Textbox — Texto con ajuste de línea automático

Hereda de `IText`. Permite definir un `width` fijo y el texto se ajusta automáticamente.

```javascript
const textbox = new fabric.Textbox('Este es un texto largo que se ajusta automáticamente', {
  left       : 50,
  top        : 50,
  width      : 250,       // ancho fijo (puede redimensionarse)
  fontSize   : 16,
  fontFamily : 'Arial',
  fill       : '#fff',
  textAlign  : 'justify',
  splitByGrapheme: false, // separar por grafema en lugar de por palabra
  minWidth   : 20,        // ancho mínimo al redimensionar
});

// Métodos adicionales
textbox.initBehavior();
textbox.getMinWidth();
```

---

## 6. Imágenes — fabric.Image

### Crear desde URL (callback)

```javascript
fabric.Image.fromURL('https://ejemplo.com/foto.jpg', (img) => {
  img.set({
    left    : 100,
    top     : 100,
    scaleX  : 0.5,
    scaleY  : 0.5,
    opacity : 0.9,
  });
  canvas.add(img);
}, { crossOrigin: 'anonymous' });
```

### Crear desde elemento `<img>`

```javascript
const imgEl = document.getElementById('mi-imagen');
const img = new fabric.Image(imgEl, {
  left  : 0,
  top   : 0,
  angle : 15,
});
canvas.add(img);
```

### Crear desde Data URL

```javascript
fabric.Image.fromURL(dataUrl, img => {
  canvas.add(img);
  canvas.renderAll();
});
```

### Propiedades específicas de Image

```javascript
{
  cropX         : 0,     // crop desde la izquierda (px)
  cropY         : 0,     // crop desde arriba (px)
  filters       : [],    // array de filtros (ver sección 16)
  resizeFilter  : null,  // filtro al redimensionar
  minimumScaleTrigger: 0.5,
  cacheKey      : '',    // clave de caché para imagen rasterizada
}
```

### Métodos de Image

```javascript
img.getElement();          // elemento DOM <img> o <canvas>
img.setElement(element);   // reemplazar elemento subyacente
img.getSrc();              // URL de la imagen
img.setSrc(src, callback, options); // reemplazar source

// Filtros
img.filters.push(new fabric.Image.filters.Grayscale());
img.applyFilters();        // aplicar todos los filtros
canvas.renderAll();

// Crop
img.set({ cropX: 10, cropY: 10, width: 100, height: 80 });
```

---

## 7. Grupos — fabric.Group

Agrupa múltiples objetos en una sola entidad transformable.

```javascript
const rect  = new fabric.Rect({ ... });
const text  = new fabric.Text('Label', { ... });

const group = new fabric.Group([rect, text], {
  left  : 100,
  top   : 50,
  angle : 10,
});
canvas.add(group);

// Acceder a objetos del grupo
group.getObjects();           // array de objetos hijos
group.item(0);                // objeto por índice
group.size();                 // cantidad de objetos

// Agregar / quitar del grupo
group.addWithUpdate(nuevoObj);
group.removeWithUpdate(obj);

// Desagrupar — retorna array de objetos al canvas
const items = group._objects; // referencia directa
group.destroy();              // limpia referencias (usar antes de desechar grupo manualmente)
canvas.remove(group);
items.forEach(obj => canvas.add(obj));

// Alternativa: ungroup helper
function ungroup(grp, canvas) {
  grp.toActiveSelection();    // convierte a ActiveSelection
  canvas.discardActiveObject();
}
```

### ActiveSelection

Selección múltiple de objetos (subclase de Group sin persistencia).

```javascript
const sel = new fabric.ActiveSelection([obj1, obj2], { canvas });
canvas.setActiveObject(sel);
canvas.requestRenderAll();

// Agrupar la selección activa
sel.toGroup(); // retorna fabric.Group persistente
```

---

## 8. Path (trazados SVG)

`fabric.Path` acepta un string SVG path como primer argumento.

### Crear Path desde string SVG

```javascript
const path = new fabric.Path('M 100 100 L 200 100 L 150 50 Z', {
  fill       : 'rgba(59,130,246,0.2)',
  stroke     : '#3b82f6',
  strokeWidth: 2,
});
canvas.add(path);
```

### Comandos SVG soportados

| Comando | Descripción | Ejemplo |
|---------|-------------|---------|
| `M x y` | Move to (absoluto) | `M 100 200` |
| `m dx dy` | Move to (relativo) | `m 10 20` |
| `L x y` | Line to (absoluto) | `L 300 200` |
| `l dx dy` | Line to (relativo) | `l 50 0` |
| `H x` | Horizontal line (absoluto) | `H 300` |
| `h dx` | Horizontal line (relativo) | `h 50` |
| `V y` | Vertical line (absoluto) | `V 200` |
| `v dy` | Vertical line (relativo) | `v 50` |
| `C x1 y1 x2 y2 x y` | Bezier cúbico (absoluto) | `C 100 200 200 100 300 200` |
| `c ...` | Bezier cúbico (relativo) | |
| `S x2 y2 x y` | Bezier cúbico suavizado | |
| `Q x1 y1 x y` | Bezier cuadrático (absoluto) | `Q 200 100 300 200` |
| `q ...` | Bezier cuadrático (relativo) | |
| `T x y` | Bezier cuadrático suavizado | |
| `A rx ry rot laf sf x y` | Arco elíptico | `A 50 50 0 0 1 200 200` |
| `a ...` | Arco (relativo) | |
| `Z` / `z` | Cerrar path | `Z` |

### Arco — parámetros clave

```
A rx ry x-rotation large-arc-flag sweep-flag x y
         └──(grados) └──0|1 (arco pequeño/grande) └──0|1 (dirección: 0=anti, 1=horario)
```

### Crear paths complejos dinámicamente

```javascript
// Nube de revisión con arcos
function buildCloud(pts) {
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.sqrt(dx*dx + dy*dy);
    const n = Math.max(2, Math.round(len / 18));
    const r = len / n / 2;
    for (let j = 1; j <= n; j++) {
      const t = j / n;
      d += ` A ${r} ${r} 0 0 1 ${(a.x + dx*t).toFixed(1)} ${(a.y + dy*t).toFixed(1)}`;
    }
  }
  return d + ' Z';
}

const cloud = new fabric.Path(buildCloud(puntos), {
  fill: 'rgba(239,68,68,0.1)',
  stroke: '#ef4444',
  strokeWidth: 2,
});
canvas.add(cloud);
```

### Parsear un path SVG existente

```javascript
fabric.loadSVGFromString(svgString, (objects, options) => {
  const group = fabric.util.groupSVGElements(objects, options);
  canvas.add(group);
  canvas.renderAll();
});

fabric.loadSVGFromURL('https://servidor/icono.svg', (objects, options) => {
  const svg = fabric.util.groupSVGElements(objects, options);
  canvas.add(svg.set({ left: 100, top: 100 }));
  canvas.renderAll();
});
```

---

## 9. Dibujo libre — Brushes

Activar modo libre:

```javascript
canvas.isDrawingMode = true;
canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
canvas.freeDrawingBrush.color = '#ef4444';
canvas.freeDrawingBrush.width = 3;
```

### fabric.PencilBrush — Lápiz suave

```javascript
const brush = new fabric.PencilBrush(canvas);
brush.color       = '#3b82f6';
brush.width       = 4;
brush.decimate    = 8; // reducción de puntos (0=ninguna, más alto=menos puntos)
brush.drawStraightLine = false; // true = solo líneas rectas (shift)
canvas.freeDrawingBrush = brush;
```

### fabric.CircleBrush — Trazo con círculos

```javascript
const brush = new fabric.CircleBrush(canvas);
brush.color  = '#22c55e';
brush.width  = 20;
brush.density = 20; // número de círculos por zona
canvas.freeDrawingBrush = brush;
```

### fabric.SprayBrush — Aerógrafo

```javascript
const brush = new fabric.SprayBrush(canvas);
brush.color       = '#f59e0b';
brush.width       = 30;      // diámetro del spray
brush.density     = 20;      // puntos por zona
brush.dotWidth    = 1;       // tamaño de cada punto
brush.dotWidthVariance = 1;  // variación aleatoria de tamaño
brush.randomOpacity = false; // opacidad aleatoria
brush.optimizeOverlapping = true;
canvas.freeDrawingBrush = brush;
```

### fabric.PatternBrush — Pintura con patrón

```javascript
const patternBrush = new fabric.PatternBrush(canvas);
patternBrush.getPatternSrc = function () {
  const patternCanvas = document.createElement('canvas');
  patternCanvas.width = patternCanvas.height = 10;
  const ctx = patternCanvas.getContext('2d');
  ctx.fillStyle = this.color;
  ctx.fillRect(0, 0, 5, 5);
  ctx.fillRect(5, 5, 5, 5);
  return patternCanvas;
};
canvas.freeDrawingBrush = patternBrush;
```

### Evento al finalizar un trazo

```javascript
canvas.on('path:created', (opt) => {
  const path = opt.path;
  // path es un fabric.Path recién creado
  path.data = { tipo: 'freehand' };
  console.log('Trazo libre creado:', path.toObject());
});
```

### Brush personalizado

```javascript
fabric.MyBrush = fabric.util.createClass(fabric.BaseBrush, {
  initialize(canvas) {
    this.callSuper('initialize', canvas);
    this.points = [];
  },
  onMouseDown(pointer, options) {
    this.points = [pointer];
  },
  onMouseMove(pointer, options) {
    this.points.push(pointer);
    this._render();
  },
  onMouseUp(options) {
    this._finalizeAndAddPath();
  },
  _render() {
    const ctx = this.canvas.contextTop;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.beginPath();
    ctx.strokeStyle = this.color;
    ctx.lineWidth   = this.width;
    this.points.forEach((pt, i) => {
      i === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y);
    });
    ctx.stroke();
  },
});
canvas.freeDrawingBrush = new fabric.MyBrush(canvas);
```

---

## 10. Eventos

### Eventos del Canvas

```javascript
// ── Ratón ──────────────────────────────────────────────────────
canvas.on('mouse:down',       opt => { opt.e; opt.target; opt.pointer; });
canvas.on('mouse:move',       opt => { });
canvas.on('mouse:up',         opt => { });
canvas.on('mouse:dblclick',   opt => { });
canvas.on('mouse:over',       opt => { });
canvas.on('mouse:out',        opt => { });
canvas.on('mouse:wheel',      opt => { opt.e.deltaY; });

// ── Objetos ────────────────────────────────────────────────────
canvas.on('object:added',     opt => { opt.target; });
canvas.on('object:removed',   opt => { opt.target; });
canvas.on('object:modified',  opt => { opt.target; opt.action; });
canvas.on('object:moving',    opt => { opt.target; });
canvas.on('object:scaling',   opt => { opt.target; });
canvas.on('object:rotating',  opt => { opt.target; });
canvas.on('object:skewing',   opt => { opt.target; });
canvas.on('object:moved',     opt => { });  // después de soltar
canvas.on('object:scaled',    opt => { });
canvas.on('object:rotated',   opt => { });

// ── Selección ──────────────────────────────────────────────────
canvas.on('selection:created', opt => { opt.selected; });   // nuevos objetos seleccionados
canvas.on('selection:updated', opt => { opt.selected; opt.deselected; });
canvas.on('selection:cleared', opt => { opt.deselected; });
canvas.on('before:selection:cleared', opt => { });

// ── Dibujo libre ───────────────────────────────────────────────
canvas.on('path:created',     opt => { opt.path; });

// ── Texto ──────────────────────────────────────────────────────
canvas.on('text:editing:entered', opt => { opt.target; });
canvas.on('text:editing:exited',  opt => { opt.target; });
canvas.on('text:changed',         opt => { opt.target; });
canvas.on('text:selection:changed', opt => { opt.target; });

// ── Render ────────────────────────────────────────────────────
canvas.on('before:render',    () => { });
canvas.on('after:render',     () => { });

// ── Drag & Drop externo ───────────────────────────────────────
canvas.on('dragover',  opt => { opt.e; opt.target; });
canvas.on('dragenter', opt => { });
canvas.on('dragleave', opt => { });
canvas.on('drop',      opt => { opt.e; opt.target; });
```

### Obtener datos útiles del evento

```javascript
canvas.on('mouse:down', opt => {
  const e          = opt.e;               // MouseEvent original
  const target     = opt.target;          // objeto clicado (null si fondo)
  const pointer    = opt.pointer;         // {x, y} en coordenadas canvas
  const absoluteP  = canvas.getPointer(e, true); // {x, y} absolutos (sin viewport)
  const isAlt      = e.altKey;
  const isCtrl     = e.ctrlKey || e.metaKey;
  const isShift    = e.shiftKey;
  const button     = e.button;            // 0=izq, 1=medio, 2=derecho
});
```

### Remover listeners

```javascript
canvas.off('mouse:down');                 // quita todos los listeners del evento
canvas.off('mouse:down', miHandler);      // quita un handler específico
```

---

## 11. Viewport — Zoom y Pan

### Zoom

```javascript
// Zoom absoluto centrado en un punto
canvas.zoomToPoint({ x: 400, y: 300 }, 2.0);  // zoom 200% en el punto (400,300)

// Zoom relativo al centro del canvas
const cx = canvas.width  / 2;
const cy = canvas.height / 2;
canvas.zoomToPoint({ x: cx, y: cy }, 1.5);

// Zoom absoluto sin preservar el centro visual
canvas.setZoom(1.5);

// Obtener zoom actual
const zoom = canvas.getZoom();  // número

// Zoom con límites
canvas.on('mouse:wheel', opt => {
  let zoom = canvas.getZoom() * (0.999 ** opt.e.deltaY);
  zoom = Math.min(Math.max(zoom, 0.05), 20);
  canvas.zoomToPoint({ x: opt.e.offsetX, y: opt.e.offsetY }, zoom);
  opt.e.preventDefault();
});
```

### Pan

```javascript
// Pan relativo (desplazamiento incremental)
canvas.relativePan({ x: 50, y: 30 });

// Pan absoluto (coordenada absoluta de la viewport)
canvas.absolutePan({ x: 200, y: 100 });

// Transformación completa del viewport [a,b,c,d,e,f]
// [scaleX, skewY, skewX, scaleY, translateX, translateY]
canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);  // reset
canvas.viewportTransform; // acceder al array actual

// Pan con drag (botón medio o herramienta pan)
let isPanning = false, lastPos = null;
canvas.on('mouse:down', opt => {
  if (opt.e.button === 1 || myTool === 'pan') {
    isPanning = true;
    lastPos = { x: opt.e.clientX, y: opt.e.clientY };
  }
});
canvas.on('mouse:move', opt => {
  if (!isPanning || !lastPos) return;
  canvas.relativePan({
    x: opt.e.clientX - lastPos.x,
    y: opt.e.clientY - lastPos.y,
  });
  lastPos = { x: opt.e.clientX, y: opt.e.clientY };
});
canvas.on('mouse:up', () => { isPanning = false; lastPos = null; });
```

### Ajustar contenido a la pantalla (Fit to Screen)

```javascript
function fitToCanvas(canvas, pdfWidth, pdfHeight) {
  const zoom = Math.min(
    canvas.width  / pdfWidth,
    canvas.height / pdfHeight
  ) * 0.92;
  const offsetX = (canvas.width  - pdfWidth  * zoom) / 2;
  const offsetY = (canvas.height - pdfHeight * zoom) / 2;
  canvas.setViewportTransform([zoom, 0, 0, zoom, offsetX, offsetY]);
}
```

### Convertir coordenadas

```javascript
// Coordenadas de pantalla → canvas (con zoom/pan)
const ptr = canvas.getPointer(mouseEvent);

// Punto canvas → punto pantalla
const vpt = canvas.viewportTransform;
const screenX = canvasX * vpt[0] + vpt[4];
const screenY = canvasY * vpt[3] + vpt[5];
```

---

## 12. Animaciones

`fabric.Object.animate` — motor de interpolación incorporado.

```javascript
// Animar una propiedad
obj.animate('left', 500, {
  duration  : 800,           // ms
  easing    : fabric.util.ease.easeOutBounce,
  onChange  : () => canvas.renderAll(),
  onComplete: () => console.log('fin'),
  abort     : () => false,   // retornar true para cancelar
  startValue: null,          // valor de inicio (null = actual)
  by        : null,          // animar por este delta (relativo)
});

// Animar múltiples propiedades simultáneamente
obj.animate({ left: 300, top: 200, opacity: 0.5 }, {
  duration : 1000,
  easing   : fabric.util.ease.easeInOutCubic,
  onChange : () => canvas.renderAll(),
});

// Animar colores
obj.animate('fill', '#3b82f6', {
  duration : 600,
  onChange : () => canvas.renderAll(),
  colorMixin: true,   // habilita interpolación de color
});
```

### Funciones de easing disponibles

```javascript
fabric.util.ease.linear
fabric.util.ease.easeInQuad
fabric.util.ease.easeOutQuad
fabric.util.ease.easeInOutQuad
fabric.util.ease.easeInCubic
fabric.util.ease.easeOutCubic
fabric.util.ease.easeInOutCubic
fabric.util.ease.easeInQuart
fabric.util.ease.easeOutQuart
fabric.util.ease.easeInOutQuart
fabric.util.ease.easeInQuint
fabric.util.ease.easeOutQuint
fabric.util.ease.easeInOutQuint
fabric.util.ease.easeInSine
fabric.util.ease.easeOutSine
fabric.util.ease.easeInOutSine
fabric.util.ease.easeInExpo
fabric.util.ease.easeOutExpo
fabric.util.ease.easeInOutExpo
fabric.util.ease.easeInCirc
fabric.util.ease.easeOutCirc
fabric.util.ease.easeInOutCirc
fabric.util.ease.easeInElastic
fabric.util.ease.easeOutElastic
fabric.util.ease.easeInOutElastic
fabric.util.ease.easeInBack
fabric.util.ease.easeOutBack
fabric.util.ease.easeInOutBack
fabric.util.ease.easeInBounce
fabric.util.ease.easeOutBounce
fabric.util.ease.easeInOutBounce
```

---

## 13. Gradientes

### Gradiente lineal

```javascript
const gradient = new fabric.Gradient({
  type: 'linear',
  coords: { x1: 0, y1: 0, x2: obj.width, y2: 0 }, // horizontal
  colorStops: [
    { offset: 0,   color: '#3b82f6' },
    { offset: 0.5, color: '#8b5cf6' },
    { offset: 1,   color: '#ec4899' },
  ],
});
obj.set('fill', gradient);
canvas.renderAll();
```

### Gradiente radial

```javascript
const radial = new fabric.Gradient({
  type: 'radial',
  coords: {
    x1: obj.width / 2,   // centro del gradiente
    y1: obj.height / 2,
    x2: obj.width / 2,   // foco
    y2: obj.height / 2,
    r1: 10,              // radio interior
    r2: obj.width / 2,   // radio exterior
  },
  colorStops: [
    { offset: 0, color: 'white' },
    { offset: 1, color: '#3b82f6' },
  ],
});
obj.set('fill', radial);
```

---

## 14. Patrones (Pattern)

```javascript
// Patrón desde imagen
fabric.Image.fromURL('/textura.png', img => {
  const pattern = new fabric.Pattern({
    source     : img.getElement(),
    repeat     : 'repeat',   // 'repeat' | 'repeat-x' | 'repeat-y' | 'no-repeat'
    offsetX    : 0,
    offsetY    : 0,
    patternTransform: [1, 0, 0, 1, 0, 0], // transformación del patrón
  });
  rect.set('fill', pattern);
  canvas.renderAll();
});

// Patrón desde canvas
const patCanvas = document.createElement('canvas');
patCanvas.width = patCanvas.height = 10;
const ctx = patCanvas.getContext('2d');
ctx.fillStyle = '#3b82f6';
ctx.fillRect(0, 0, 5, 5);
ctx.fillRect(5, 5, 5, 5);

const pattern = new fabric.Pattern({ source: patCanvas, repeat: 'repeat' });
obj.set('fill', pattern);
```

---

## 15. Sombras (Shadow)

```javascript
const shadow = new fabric.Shadow({
  color  : 'rgba(0,0,0,0.5)',
  blur   : 10,
  offsetX: 5,
  offsetY: 5,
  affectStroke: false,  // aplicar sombra también al trazo
  nonScaling: false,    // sombra no escala con el objeto
});
obj.set('shadow', shadow);
canvas.renderAll();

// Quitar sombra
obj.set('shadow', null);

// String corto
obj.set('shadow', '5px 5px 10px rgba(0,0,0,0.5)');
```

---

## 16. Filtros de imagen

Todos los filtros se aplican con `img.applyFilters()` después de agregarlos al array `img.filters`.

```javascript
// Patrón de uso
img.filters.push(new fabric.Image.filters.NOMBRE({ ...opciones }));
img.applyFilters();
canvas.renderAll();
```

### Filtros disponibles

```javascript
// Escala de grises
new fabric.Image.filters.Grayscale({ mode: 'average' })  // 'average' | 'lightness' | 'luminosity'

// Invertir colores
new fabric.Image.filters.Invert()

// Brillo
new fabric.Image.filters.Brightness({ brightness: 0.1 }) // -1 a 1

// Contraste
new fabric.Image.filters.Contrast({ contrast: 0.2 })     // -1 a 1

// Saturación
new fabric.Image.filters.Saturation({ saturation: 0.5 }) // -1 a 1

// Vibrance
new fabric.Image.filters.Vibrance({ vibrance: 0.5 })

// Noise (ruido)
new fabric.Image.filters.Noise({ noise: 50 })             // 0-1000

// Blur (desenfoque)
new fabric.Image.filters.Blur({ blur: 0.1 })              // 0-1

// Pixelate
new fabric.Image.filters.Pixelate({ blocksize: 8 })       // tamaño del bloque

// Sepia
new fabric.Image.filters.Sepia()

// HueRotation
new fabric.Image.filters.HueRotation({ rotation: 0.5 })  // -1 a 1 (mapeado a 0-360°)

// Gamma
new fabric.Image.filters.Gamma({ gamma: [1.5, 0.8, 1.0] }) // [r, g, b]

// Color Matrix
new fabric.Image.filters.ColorMatrix({
  matrix: [1,0,0,0,0, 0,1,0,0,0, 0,0,1,0,0, 0,0,0,1,0] // 4×5
})

// Blend color
new fabric.Image.filters.BlendColor({
  color: '#ff0000',
  mode : 'multiply',  // blend mode
  alpha: 0.5,
})

// Blend image
new fabric.Image.filters.BlendImage({
  image: otroFabricImage,
  mode : 'multiply',
  alpha: 0.5,
})

// Composites
new fabric.Image.filters.Composed({
  subFilters: [
    new fabric.Image.filters.Grayscale(),
    new fabric.Image.filters.Brightness({ brightness: 0.1 }),
  ]
})

// Resize (con algoritmo mejorado, bueno para thumbnails)
new fabric.Image.filters.Resize({
  resizeType: 'lanczos',  // 'bilinear' | 'hermite' | 'sliceHack' | 'lanczos'
  scaleX    : 0.5,
  scaleY    : 0.5,
  lanczosLobes: 3,
})

// Sharpen (nítido) — via convolution
new fabric.Image.filters.Convolute({
  matrix: [0,-1,0, -1,5,-1, 0,-1,0]  // 3×3 sharpen
})

// Emboss
new fabric.Image.filters.Convolute({
  matrix: [1,1,1, 1,0.7,-1, -1,-1,-1]
})
```

### Limpiar todos los filtros

```javascript
img.filters = [];
img.applyFilters();
canvas.renderAll();
```

---

## 17. Controles y Handles

Los objetos tienen 8 handles (esquinas + lados) + 1 handle de rotación.

### Configurar controles globalmente

```javascript
// Desactivar todos los controles
fabric.Object.prototype.hasControls = false;

// Modificar handles de rotación
fabric.Object.prototype.rotatingPointOffset = 40;
fabric.Object.prototype.cornerSize    = 10;
fabric.Object.prototype.cornerColor   = '#3b82f6';
fabric.Object.prototype.cornerStyle   = 'circle';   // 'rect' | 'circle'
fabric.Object.prototype.transparentCorners = false;
fabric.Object.prototype.borderColor   = '#3b82f6';
fabric.Object.prototype.borderDashArray = [3, 3];
```

### Controles personalizados (v5)

```javascript
// Eliminar controles específicos
delete obj.controls.mtr;  // quitar handle de rotación
delete obj.controls.ml;   // quitar handle lado izquierdo
delete obj.controls.mr;   // quitar handle lado derecho
delete obj.controls.mt;   // quitar handle arriba
delete obj.controls.mb;   // quitar handle abajo

// Nombres de controles: tl tr br bl ml mr mt mb mtr
// tl=top-left, tr=top-right, br=bottom-right, bl=bottom-left
// ml=middle-left, mr=middle-right, mt=middle-top, mb=middle-bottom
// mtr=middle-top-rotate

// Control personalizado
obj.controls.eliminar = new fabric.Control({
  x          : 0.5,          // posición relativa al bounding box (-0.5 a 0.5)
  y          : -0.5,
  offsetX    : 16,
  offsetY    : -16,
  cursorStyle: 'pointer',
  mouseUpHandler: (eventData, transform) => {
    const target = transform.target;
    const canvas = target.canvas;
    canvas.remove(target);
    canvas.requestRenderAll();
    return true;
  },
  render: (ctx, left, top, styleOverride, fabricObject) => {
    // Dibujar icono personalizado
    ctx.save();
    ctx.translate(left, top);
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.arc(0, 0, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('✕', 0, 0);
    ctx.restore();
  },
  cornerSize: 20,
});
```

---

## 18. Clipping — clipPath

Recorta un objeto con la forma de otro.

```javascript
// Recortar un objeto con un círculo
const clip = new fabric.Circle({ radius: 50, left: -50, top: -50 });
obj.clipPath = clip;
canvas.renderAll();

// Recortar con path
const clipPath = new fabric.Path('M 0 0 L 100 0 L 50 100 Z', {
  left: -50, top: -50
});
obj.clipPath = clipPath;

// Clip absoluto (relativo al canvas, no al objeto)
clipPath.absolutePositioned = true;

// Clip invertido (recortar lo que está FUERA)
clipPath.inverted = true;

// Recortar todo el canvas
canvas.clipPath = new fabric.Rect({ left: 0, top: 0, width: 800, height: 600 });
```

---

## 19. Serialización y persistencia

### Serializar el canvas completo

```javascript
// JSON (incluye todos los objetos)
const json = canvas.toJSON();                    // objeto JS
const jsonStr = JSON.stringify(canvas.toJSON()); // string JSON

// Con propiedades adicionales
const json = canvas.toJSON(['data', 'name', 'myCustomProp']);

// Dataless JSON (sin imágenes en base64)
const json = canvas.toDatalessJSON(['data']);

// SVG del canvas completo
const svg = canvas.toSVG();
const svgWithOpts = canvas.toSVG({
  suppressPreamble: false,
  viewBox: { x: 0, y: 0, width: 800, height: 600 },
  encoding: 'UTF-8',
  width: '800px',
  height: '600px',
});
```

### Restaurar canvas desde JSON

```javascript
// Callback
canvas.loadFromJSON(jsonString, () => {
  canvas.renderAll();
});

// Con reviver (para cada objeto deserializado)
canvas.loadFromJSON(jsonString, () => {
  canvas.renderAll();
}, (jsonObj, fabricObj) => {
  // Llamado por cada objeto restaurado
  console.log('Objeto restaurado:', fabricObj.type);
});

// Solo restaurar objetos markup (sin background)
const objects = JSON.parse(jsonMarkupStr);
fabric.util.enlivenObjects(objects, (enlivened) => {
  enlivened.forEach(obj => canvas.add(obj));
  canvas.renderAll();
}, 'fabric');
```

### Serializar objetos individuales

```javascript
const jsonObj = obj.toObject(['data']); // plain object
const jsonStr = JSON.stringify(obj.toObject(['data']));

// Restaurar un objeto
fabric.util.enlivenObjects([jsonObj], ([enlivened]) => {
  canvas.add(enlivened);
  canvas.renderAll();
});
```

### Tipos de objetos en JSON

Al deserializar, Fabric usa `type` para instanciar la clase correcta:

| Valor `type` | Clase |
|---|---|
| `rect` | fabric.Rect |
| `circle` | fabric.Circle |
| `ellipse` | fabric.Ellipse |
| `triangle` | fabric.Triangle |
| `line` | fabric.Line |
| `polyline` | fabric.Polyline |
| `polygon` | fabric.Polygon |
| `path` | fabric.Path |
| `text` | fabric.Text |
| `i-text` | fabric.IText |
| `textbox` | fabric.Textbox |
| `image` | fabric.Image |
| `group` | fabric.Group |
| `activeSelection` | fabric.ActiveSelection |

---

## 20. Exportar — PNG, JPEG, SVG

### toDataURL

```javascript
const dataUrl = canvas.toDataURL({
  format    : 'png',       // 'png' | 'jpeg' | 'webp'
  quality   : 0.9,         // solo para jpeg/webp (0-1)
  multiplier: 2,           // factor de resolución (2 = doble resolución)
  left      : 0,           // coordenada de recorte
  top       : 0,
  width     : canvas.width,
  height    : canvas.height,
  enableRetinaScaling: false,
});

// Descargar
const a = document.createElement('a');
a.href = dataUrl;
a.download = 'markup.png';
a.click();
```

### toBlob (más eficiente para archivos grandes)

```javascript
canvas.getElement().toBlob((blob) => {
  // blob = Blob del canvas visible
}, 'image/png');
```

### toCanvasElement

```javascript
const domCanvas = canvas.toCanvasElement(multiplier = 1, {
  left: 0, top: 0, width: canvas.width, height: canvas.height
});
// domCanvas es un <canvas> DOM estándar
```

### Exportar solo objetos seleccionados

```javascript
// Crear un canvas temporal con solo los objetos deseados
const tempCanvas = new fabric.StaticCanvas(null, {
  width : 800,
  height: 600,
});

// Clonar objetos al canvas temporal
const objects = canvas.getObjects().filter(o => !o.isBackground);
fabric.util.enlivenObjects(
  objects.map(o => o.toObject(['data'])),
  (enlivened) => {
    enlivened.forEach(o => tempCanvas.add(o));
    tempCanvas.renderAll();
    const dataUrl = tempCanvas.toDataURL({ format: 'png', multiplier: 2 });
    tempCanvas.dispose();
    // usar dataUrl...
  }
);
```

### Exportar a SVG

```javascript
const svg = canvas.toSVG();
const blob = new Blob([svg], { type: 'image/svg+xml' });
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = 'plano.svg';
a.click();
URL.revokeObjectURL(url);
```

---

## 21. Utilities — fabric.util

### Matemáticas y geometría

```javascript
// Ángulo entre dos puntos (en grados)
fabric.util.calcVectorAngle(
  { x: 0, y: 0 },
  { x: 100, y: 100 }
);

// Conversiones de ángulo
fabric.util.degreesToRadians(45);   // → 0.785...
fabric.util.radiansToDegrees(0.785); // → 45

// Distancia euclidiana
const dist = Math.sqrt(
  fabric.util.cos(angle) ** 2 + fabric.util.sin(angle) ** 2
);

// Normalizar vector
const normalized = fabric.util.getUnitVector({ x: 3, y: 4 });
// → { x: 0.6, y: 0.8 }

// Rotar punto alrededor del origen
const rotated = fabric.util.rotateVector({ x: 100, y: 0 }, Math.PI / 2);
// → { x: 0, y: 100 } (aproximado)

// Intersección de dos líneas
const intersection = fabric.util.intersectLineLine(
  { x: 0, y: 0 },   { x: 100, y: 100 },  // línea 1
  { x: 0, y: 100 }, { x: 100, y: 0 }     // línea 2
); // → { x: 50, y: 50 }
```

### Creación de clases

```javascript
const MiClase = fabric.util.createClass(ClasePadre, {
  initialize(opciones) {
    this.callSuper('initialize', opciones);
    // inicialización propia
  },
  miMetodo() { ... },
});
```

### Arrays

```javascript
fabric.util.toArray(arrayLike);
fabric.util.removeFromArray(array, elemento);
fabric.util.indexOf(array, elemento, startIndex);
```

### DOM y canvas

```javascript
// Crear canvas
const el = fabric.util.createCanvasElement();

// Crear imagen
fabric.util.createImage();   // → <img> DOM

// BoundingBox de conjunto de puntos
const bounds = fabric.util.makeBoundingBoxFromPoints([
  { x: 10, y: 20 },
  { x: 50, y: 80 },
  { x: 100, y: 30 },
]);
// → { left, top, width, height }
```

### Cargar imagen

```javascript
fabric.util.loadImage(url, (img, error) => {
  if (error) { console.error(error); return; }
  const fabricImg = new fabric.Image(img);
  canvas.add(fabricImg);
}, null, 'anonymous');
```

### Enlivenamiento (deserialización)

```javascript
// Convertir plain objects → instancias Fabric
fabric.util.enlivenObjects(
  arrayOfPlainObjects,
  (enlivenedObjects) => {
    // callback con instancias Fabric
    enlivenedObjects.forEach(obj => canvas.add(obj));
    canvas.renderAll();
  },
  'fabric',         // namespace
  (obj, fabricObj) => { /* reviver */ }
);
```

### Transformaciones

```javascript
// Componer transformaciones
const transform = fabric.util.composeMatrix({
  scaleX    : 2,
  scaleY    : 2,
  angle     : 45,
  translateX: 100,
  translateY: 50,
});

// Descomponer una matriz
const decomposed = fabric.util.qrDecompose([2,0,0,2,100,50]);
// → { scaleX, scaleY, skewX, skewY, angle, translateX, translateY }

// Multiplicar matrices
const result = fabric.util.multiplyTransformMatrices(matA, matB);

// Invertir matriz
const inverse = fabric.util.invertTransform(matrix);
```

---

## 22. Interacciones del usuario

### Cursor del ratón

```javascript
canvas.defaultCursor  = 'crosshair';  // cursor por defecto
canvas.hoverCursor    = 'pointer';    // al pasar sobre un objeto
canvas.moveCursor     = 'grabbing';
canvas.freeDrawingCursor = 'pencil';
canvas.setCursor('wait');             // forzar cursor en un momento

// Por objeto
obj.hoverCursor = 'cell';
obj.moveCursor  = 'grabbing';
```

### Snap to grid

```javascript
// Snap al mover objetos
canvas.on('object:moving', opt => {
  const GRID = 20;
  opt.target.set({
    left: Math.round(opt.target.left / GRID) * GRID,
    top : Math.round(opt.target.top  / GRID) * GRID,
  });
});
```

### Snap angular

```javascript
canvas.snapAngle     = 45;  // snap cada 45°
canvas.snapThreshold = 5;   // threshold en grados
```

### Selección con borde de recuadro

```javascript
canvas.selectionColor      = 'rgba(59,130,246,0.1)';
canvas.selectionBorderColor= '#3b82f6';
canvas.selectionLineWidth  = 1;
canvas.selectionDashArray  = [5, 5];
canvas.selectionFullyContained = false; // true = solo selecciona objetos completamente dentro
```

### Teclado y accesibilidad

```javascript
// Mover con flechas del teclado
const STEP = 5;
document.addEventListener('keydown', e => {
  const obj = canvas.getActiveObject();
  if (!obj) return;
  const moves = {
    ArrowLeft : { left: obj.left - STEP },
    ArrowRight: { left: obj.left + STEP },
    ArrowUp   : { top : obj.top  - STEP },
    ArrowDown : { top : obj.top  + STEP },
  };
  if (moves[e.key]) {
    obj.set(moves[e.key]);
    obj.setCoords();
    canvas.renderAll();
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    canvas.remove(obj);
  }
});
```

### Copy/Paste de objetos

```javascript
let clipboard = null;

// Copiar
canvas.on('mouse:down', () => {
  const obj = canvas.getActiveObject();
  if (obj) {
    obj.clone(cloned => { clipboard = cloned; }, ['data']);
  }
});

// Pegar
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
    if (!clipboard) return;
    clipboard.clone(cloned => {
      cloned.set({ left: clipboard.left + 10, top: clipboard.top + 10 });
      canvas.add(cloned);
      canvas.setActiveObject(cloned);
      canvas.renderAll();
    }, ['data']);
  }
});
```

---

## 23. Rendimiento y optimización

### objectCaching

Cada objeto tiene un caché interno de canvas. Reduce re-renderizados pero usa más memoria.

```javascript
// Global
fabric.Object.prototype.objectCaching = true;  // default: true

// Por objeto
obj.objectCaching = false;  // deshabilitar caché (recomendado para objetos que cambian)

// Invalidar caché manualmente
obj.dirty = true;
canvas.renderAll();
```

### noScaleCache

```javascript
// Evitar recalcular caché al escalar (caché se estira)
obj.noScaleCache = true;
```

### statefullCache

```javascript
obj.statefullCache = false; // no detectar cambios automáticamente
```

### skipOffscreen

```javascript
canvas.skipOffscreen = true; // no renderizar objetos fuera de viewport (default: true)
```

### renderOnAddRemove

```javascript
// Desactivar para agregar muchos objetos sin re-renderizar
canvas.renderOnAddRemove = false;
// ... agregar todos los objetos ...
canvas.renderOnAddRemove = true;
canvas.renderAll(); // renderizar una sola vez al final
```

### requestRenderAll vs renderAll

```javascript
canvas.requestRenderAll(); // encola un renderizado (batched, async) — PREFERIDO
canvas.renderAll();        // renderiza inmediatamente (sync) — usar solo cuando necesario
```

### Reducir número de objetos con grouping

```javascript
// Agrupar objetos estáticos en un grupo reduce el número de iteraciones
const staticGroup = new fabric.Group(staticObjects, { selectable: false });
canvas.add(staticGroup);
```

---

## 24. Patrones de uso para construcción

### Flecha de anotación

```javascript
function crearFlecha(x1, y1, x2, y2, color = '#ef4444', grosor = 2) {
  const angulo = Math.atan2(y2 - y1, x2 - x1) * (180 / Math.PI);
  const size   = Math.max(10, grosor * 5);

  const linea = new fabric.Line([x1, y1, x2, y2], {
    stroke: color, strokeWidth: grosor, selectable: false,
  });
  const punta = new fabric.Triangle({
    left: x2, top: y2, width: size, height: size,
    fill: color, stroke: color,
    angle: angulo + 90, originX: 'center', originY: 'center',
    selectable: false,
  });
  const grupo = new fabric.Group([linea, punta]);
  grupo.data = { tipo: 'flecha' };
  canvas.add(grupo);
  return grupo;
}
```

### Línea de medida (cotas)

```javascript
function crearCota(x1, y1, x2, y2, etiqueta, color = '#3b82f6', grosor = 1) {
  const angulo  = Math.atan2(y2 - y1, x2 - x1) * (180 / Math.PI);
  const perpRad = (angulo + 90) * (Math.PI / 180);
  const tick    = 10;
  const dx = Math.cos(perpRad) * tick, dy = Math.sin(perpRad) * tick;

  const objetos = [
    // Línea principal
    new fabric.Line([x1,y1,x2,y2], { stroke:color, strokeWidth:grosor, selectable:false }),
    // Extensores en extremos
    new fabric.Line([x1-dx,y1-dy, x1+dx,y1+dy], { stroke:color, strokeWidth:grosor, selectable:false }),
    new fabric.Line([x2-dx,y2-dy, x2+dx,y2+dy], { stroke:color, strokeWidth:grosor, selectable:false }),
    // Cabezas de flecha
    new fabric.Triangle({ left:x1,top:y1, width:8,height:8, fill:color, stroke:color,
      angle:angulo-90, originX:'center',originY:'center', selectable:false }),
    new fabric.Triangle({ left:x2,top:y2, width:8,height:8, fill:color, stroke:color,
      angle:angulo+90, originX:'center',originY:'center', selectable:false }),
    // Etiqueta
    new fabric.Text(etiqueta, {
      left:(x1+x2)/2, top:(y1+y2)/2-16, fontSize:13, fontFamily:'Arial',
      fill:color, backgroundColor:'#11181f99', originX:'center', originY:'bottom',
      selectable:false,
    }),
  ];

  const grupo = new fabric.Group(objetos);
  grupo.data = { tipo: 'cota', etiqueta };
  canvas.add(grupo);
  return grupo;
}
```

### Nube de revisión (multi-clic + Enter)

```javascript
function buildCloudPath(pts) {
  const cerrado = [...pts, pts[0]];
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < cerrado.length - 1; i++) {
    const a = cerrado[i], b = cerrado[i+1];
    const dx = b.x-a.x, dy = b.y-a.y;
    const len = Math.sqrt(dx*dx + dy*dy);
    const n = Math.max(2, Math.round(len / 18));
    const r = len / n / 2;
    for (let j = 1; j <= n; j++) {
      const t = j/n;
      d += ` A ${r.toFixed(1)} ${r.toFixed(1)} 0 0 1 ${(a.x+dx*t).toFixed(1)} ${(a.y+dy*t).toFixed(1)}`;
    }
  }
  return d + ' Z';
}

const nube = new fabric.Path(buildCloudPath(puntos), {
  stroke: '#ef4444', strokeWidth: 2,
  fill  : 'rgba(239,68,68,0.08)',
});
nube.data = { tipo: 'nube' };
canvas.add(nube);
```

### Área con etiqueta calculada

```javascript
function calcularAreaPx(pts) {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i+1) % pts.length;
    area += pts[i].x * pts[j].y;
    area -= pts[j].x * pts[i].y;
  }
  return Math.abs(area) / 2;
}

function crearArea(pts, pxPorUnidad, unidad = 'm') {
  const pxArea = calcularAreaPx(pts);
  const area   = pxPorUnidad ? pxArea / (pxPorUnidad ** 2) : pxArea;
  const sufijo = pxPorUnidad ? `${unidad}²` : 'px²';
  const etiq   = `${area.toFixed(2)} ${sufijo}`;

  const cx = pts.reduce((s,p) => s+p.x, 0) / pts.length;
  const cy = pts.reduce((s,p) => s+p.y, 0) / pts.length;

  const poligono = new fabric.Polygon(pts, {
    stroke:'#22c55e', strokeWidth:2, fill:'rgba(34,197,94,0.1)',
  });
  const label = new fabric.Text(etiq, {
    left:cx, top:cy, fontSize:14, fontFamily:'Arial',
    fill:'#22c55e', backgroundColor:'#11181f99',
    originX:'center', originY:'center', selectable:false,
  });
  [poligono, label].forEach(o => { o.data = { tipo: 'area' }; canvas.add(o); });
  return { poligono, label, area: etiq };
}
```

### Sello de aprobación

```javascript
function crearSello(x, y, texto, color = '#16a34a', rotacion = -15) {
  const pad = 12;
  const txt = new fabric.Text(texto, {
    fontSize: 20, fontFamily: 'Arial Black, sans-serif',
    fontWeight: 'bold', fill: color, selectable: false,
  });
  const rect = new fabric.Rect({
    left: -pad, top: -pad,
    width: txt.width + pad*2, height: txt.height + pad*2,
    stroke: color, strokeWidth: 3,
    fill: `${color}18`, rx: 6, ry: 6, selectable: false,
  });
  const grupo = new fabric.Group([rect, txt], {
    left: x, top: y, angle: rotacion, originX: 'center', originY: 'center',
  });
  grupo.data = { tipo: 'sello', texto };
  canvas.add(grupo);
  return grupo;
}
```

### Undo / Redo robusto

```javascript
class UndoRedo {
  constructor(canvas, maxHistory = 50) {
    this.canvas = canvas;
    this.maxHistory = maxHistory;
    this.undoStack = [];
    this.redoStack = [];
    this._skipSnap = false;

    ['object:added','object:modified','object:removed','path:created'].forEach(ev => {
      canvas.on(ev, e => {
        if (!this._skipSnap && !e.target?.isBackground) this._snapshot();
      });
    });
  }

  _getMarkupObjects() {
    return this.canvas.getObjects().filter(o => !o.isBackground);
  }

  _snapshot() {
    if (this.undoStack.length >= this.maxHistory) this.undoStack.shift();
    const state = this._getMarkupObjects().map(o => o.toObject(['data']));
    this.undoStack.push(JSON.stringify(state));
    this.redoStack = [];
  }

  undo() {
    if (!this.undoStack.length) return;
    const current = this._getMarkupObjects().map(o => o.toObject(['data']));
    this.redoStack.push(JSON.stringify(current));
    this._restore(this.undoStack.pop());
  }

  redo() {
    if (!this.redoStack.length) return;
    const current = this._getMarkupObjects().map(o => o.toObject(['data']));
    this.undoStack.push(JSON.stringify(current));
    this._restore(this.redoStack.pop());
  }

  _restore(jsonStr) {
    this._skipSnap = true;
    this._getMarkupObjects().forEach(o => this.canvas.remove(o));
    fabric.util.enlivenObjects(JSON.parse(jsonStr || '[]'), enlivened => {
      enlivened.forEach(o => this.canvas.add(o));
      this.canvas.renderAll();
      this._skipSnap = false;
    });
  }
}
```

### Calibración de escala interactiva

```javascript
class ScaleCalibrator {
  constructor(canvas) {
    this.canvas = canvas;
    this.pts    = [];
    this.line   = null;
  }

  start() {
    this.pts = [];
    this._handler = opt => this._onMouseUp(opt);
    this.canvas.on('mouse:up', this._handler);
    this.canvas.defaultCursor = 'crosshair';
  }

  _onMouseUp(opt) {
    const p = this.canvas.getPointer(opt.e);
    this.pts.push(p);
    if (this.pts.length === 1) {
      // Dibuja punto inicial
    } else if (this.pts.length === 2) {
      const [p1, p2] = this.pts;
      const px = Math.sqrt((p2.x-p1.x)**2 + (p2.y-p1.y)**2);
      this.canvas.off('mouse:up', this._handler);
      // Visualizar la línea
      if (this.line) this.canvas.remove(this.line);
      this.line = new fabric.Line([p1.x,p1.y,p2.x,p2.y], {
        stroke:'#facc15', strokeWidth:2, strokeDashArray:[5,3],
        selectable:false, evented:false,
      });
      this.canvas.add(this.line);
      this.canvas.renderAll();
      this.onReady && this.onReady(px); // px entre los dos puntos
    }
  }

  clear() {
    if (this.line) { this.canvas.remove(this.line); this.line = null; }
    this.canvas.off('mouse:up', this._handler);
    this.canvas.renderAll();
  }
}

// Uso
const cal = new ScaleCalibrator(canvas);
cal.onReady = px => {
  const valorReal = parseFloat(prompt('Distancia real (en metros):'));
  scaleManager.calibrate(px, valorReal, 'm');
  cal.clear();
};
cal.start();
```

---

## Resumen rápido — Objetos y propiedades

| Clase | Propiedades clave | Editable |
|---|---|---|
| `fabric.Rect` | left, top, width, height, rx, ry | Sí |
| `fabric.Circle` | left, top, radius, startAngle, endAngle | Sí |
| `fabric.Ellipse` | left, top, rx, ry | Sí |
| `fabric.Triangle` | left, top, width, height | Sí |
| `fabric.Line` | x1,y1,x2,y2, strokeDashArray | Sí |
| `fabric.Polyline` | points[] | Sí |
| `fabric.Polygon` | points[] | Sí |
| `fabric.Path` | path (SVG string) | Sí |
| `fabric.Text` | text, fontSize, fontFamily, fontWeight | No* |
| `fabric.IText` | + cursorColor, selectionColor | Sí (doble clic) |
| `fabric.Textbox` | + width fijo, splitByGrapheme | Sí (doble clic) |
| `fabric.Image` | cropX,Y, filters[] | Sí |
| `fabric.Group` | objects[] | Sí (como grupo) |

*`fabric.Text` no tiene edición inline, solo se modifica con `.set('text', 'nuevo')`

## Herramientas de markup para planos de construcción

| Herramienta | Objeto Fabric | Interacción |
|---|---|---|
| Flecha | `Group([Line, Triangle])` | Drag |
| Cota / Medida | `Group([Line, Line×2, Triangle×2, Text])` | Drag |
| Nube de revisión | `Path` (arcos SVG) | Multi-clic + Enter |
| Rectángulo | `Rect` | Drag |
| Círculo | `Circle` | Drag |
| Texto libre | `IText` | Clic → editar |
| Dibujo libre | `Path` (PencilBrush) | Drag |
| Área | `Polygon + Text` | Multi-clic + Enter |
| Sello | `Group([Rect, Text])` | Clic + modal |
| Flecha con nota | `Group([Line, Triangle, IText])` | Drag + editar |
| Globo de texto | `Group([Circle, Line, IText])` | Clic |

## Licencias

| Librería | Versión | Licencia | Uso comercial |
|---|---|---|---|
| Fabric.js | 5.3.0 | **MIT** | ✅ Libre |
| PDF.js | 3.x | Apache 2.0 | ✅ Libre |
| Excalidraw | — | MIT | ⚠ Solo interno |
| tldraw | 3.x | Tldraw Commercial | ❌ Pagar para producción |
| Konva.js | — | MIT | ✅ Libre |
| Paper.js | — | MIT | ✅ Libre |
