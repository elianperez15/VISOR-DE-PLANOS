# SAF Visor de Planos — Consideraciones Técnicas

Documento de referencia para desarrolladores. Cubre decisiones de diseño,
puntos de integración con Oracle APEX, variables de configuración, y
comportamientos no obvios del sistema.

---

## 1. APIs externas consumidas

### 1.1 Usuario conectado

| Dato        | Valor |
|-------------|-------|
| Método      | `GET` |
| URL         | `https://saf.aicsacorp.com/ords/safws/api_pdf/usuario_conectado` |
| Parámetro   | `usuario_conectado` → ID numérico del usuario en Oracle |
| Respuesta   | `{ "items": [{ "nombre_persona": "CARLOS ALBERTO RAMIREZ MENDOZA" }], ... }` |
| Campo usado | `items[0].nombre_persona` |

**Dónde está en el código:**

```
js/app.js  →  const API_USUARIO = '...'          (línea ~457)
           →  async function fetchAndSetUser(userId)
           →  const nombre = data?.items?.[0]?.nombre_persona;
```

**Si el endpoint cambia:**
- Actualizar `API_USUARIO` en `app.js`.
- Si cambia el nombre del campo, ajustar la línea `data?.items?.[0]?.nombre_persona`.

**Nota SSL:** El servidor usa certificado auto-firmado. El navegador lo acepta
dentro del mismo dominio APEX. Si el visor se sirve desde un dominio distinto,
puede requerir añadir el certificado como confiable en el servidor web o
activar `credentials: 'include'` (ya está activado en el `fetch`).

---

## 2. Integración con Oracle APEX

El visor está diseñado para correr dentro de un `<iframe>` embebido en una
página APEX. La identidad del usuario se pasa al cargar, de tres formas
posibles (en orden de prioridad):

### Forma 1 — Parámetro en la URL del iframe (recomendada)

```sql
-- Región Static HTML en APEX
<iframe
  src="https://planos.aicsacorp.com?usuario_conectado=&USUARIO_ID."
  style="width:100%; height:calc(100vh - 120px); border:none;"
  allow="fullscreen">
</iframe>
```

`&USUARIO_ID.` es un Application Item que contiene el ID numérico del usuario
de la sesión. El visor detecta el parámetro al arrancar, llama al API de
usuario, y establece el nombre automáticamente.

### Forma 2 — PostMessage (para cambios en caliente o carga dinámica)

```javascript
// Dynamic Action en APEX — ejecutar tras cargar el iframe
const iframe = document.querySelector('iframe[src*="planos"]');

// Opción A: pasar el ID numérico (resuelve nombre via API)
iframe.contentWindow.postMessage(
  { action: 'setUserId', userId: :USUARIO_ID },
  '*'
);

// Opción B: pasar el nombre directamente (sin llamar al API)
iframe.contentWindow.postMessage(
  { action: 'setUser', name: 'CARLOS ALBERTO RAMIREZ MENDOZA' },
  '*'
);
```

### Forma 3 — Parámetro de nombre directo en URL

```
https://planos.aicsacorp.com?usuario=Carlos%20Ramirez
```

Solo útil para pruebas o integraciones sin APEX. En producción siempre
usar `usuario_conectado` (forma 1) para que el nombre venga de la BD.

### Abrir un PDF automáticamente desde APEX

```javascript
// Dynamic Action en APEX
const iframe = document.querySelector('iframe[src*="planos"]');
iframe.contentWindow.postMessage({
  action : 'openPDF',
  pdfUrl : '/pdfs/plano-123.pdf',
  docId  : 123
}, '*');
```

---

## 3. Sistema de usuarios y atribución de anotaciones

### 3.1 Cómo se almacena el autor

Cada objeto de Fabric.js tiene una propiedad `data` con al menos:

```json
{
  "autor": "CARLOS ALBERTO RAMIREZ MENDOZA",
  "fecha": "2026-05-28T14:35:00.000Z",
  "type":  "rect"
}
```

Esta propiedad se serializa dentro del JSON de sesión y dentro del XFDF
(campo `title` del elemento). Sobrevive recargas, exportaciones e
importaciones siempre que se use `toObject(['data','name'])`.

**Dónde se inyecta el autor:**
- `markup-layer.js → _place(obj)` — todos los objetos colocados
- `markup-layer.js → path:created` — trazos de dibujo libre

### 3.2 Colores de usuarios

El color de cada usuario se deriva determinísticamente de su nombre con un
hash simple y una paleta de 12 colores fija. El mismo nombre siempre produce
el mismo color en cualquier sesión o navegador.

```javascript
// js/app.js → USER_COLORS[]  y  _hashUser(name)
```

Si se quiere cambiar la paleta, editar el array `USER_COLORS` en `app.js`.

### 3.3 Filtro de visibilidad por autor

El botón 👁 en el panel de usuarios llama a:

```javascript
markup.filterByAutor(nombre, visible)  // markup-layer.js
```

Solo oculta visualmente en Fabric.js. Los objetos siguen existiendo y se
guardan normalmente. Al recargar la página la visibilidad se restaura.

### 3.4 Tooltip de autor

Al pasar el cursor sobre cualquier anotación se muestra el nombre del autor
y la fecha. Implementado en `app.js → initAnnotTooltip()` vía el callback
`markup.onAnnotHover`.

---

## 4. Almacenamiento del markup

### 4.1 Modo localStorage (desarrollo / demo)

```javascript
// js/storage.js — línea 6
const USE_API = false;   // ← modo localStorage
```

El markup se guarda en `localStorage` con clave `saf_planos_session`.
Límite práctico ≈ 5 MB. Suficiente para planos con pocas anotaciones.

### 4.2 Modo Oracle API (producción)

```javascript
// src/data/storage.ts — línea 6-7
const USE_API  = true;
const API_BASE = '/api/markup';   // ← proxy Nginx → Node.js :3000
```

El backend Node.js escucha en `:3000` y guarda en Oracle mediante
`node-oracledb`. Las tablas y el package PL/SQL están en:

```
server/sql/saf_planos_fabricjs.sql
```

Tablas involucradas:

| Tabla                    | Contenido |
|--------------------------|-----------|
| `SAF_PLANO_DOCS`         | Registro de documentos PDF |
| `SAF_PLANO_MARKUP`       | Markup Fabric.js por página (CLOB JSON) |
| `SAF_PLANO_MARKUP_XFDF`  | XFDF completo por documento (CLOB XML) |

Package PL/SQL: `PKG_PLANO_MARKUP`

### 4.3 Preferencia de nombre de usuario

El nombre del usuario activo se guarda en `localStorage` con clave `saf_user`
para persistir entre sesiones de navegador. Si el visor arranca con
`?usuario_conectado=ID`, el nombre resuelto sobreescribe este valor.

---

## 5. Variables de configuración rápida

Todas las variables que un programador puede necesitar cambiar están
marcadas aquí con su archivo y línea aproximada.

| Variable | Archivo | Línea aprox. | Descripción |
|----------|---------|-------------|-------------|
| `API_USUARIO` | `js/app.js` | 457 | URL del endpoint de usuario |
| `USE_API` | `js/storage.js` | 6 | `false` = localStorage, `true` = Oracle |
| `API_BASE` | `js/storage.js` | 7 | Base URL del backend Node.js |
| `USER_COLORS` | `js/app.js` | 460 | Paleta de colores por usuario (12 colores) |
| `USE_API` (XFDF) | `api/xfdf-store.js` | — | `XFDF_USE_DB=true` en env para guardar en Oracle |
| `_maxHistory` | `js/markup-layer.js` | 47 | Máximo de pasos de undo/redo (default 60) |

---

## 6. Formatos de guardado y portabilidad

### JSON interno (`.json`)

- Formato Fabric.js nativo. Guarda posición, estilos, texto, y `data.autor`.
- Solo compatible con este visor.
- Ideal para trabajo interno y sesiones largas.

### XFDF (`.xfdf`)

- Estándar Adobe. Abre en Acrobat, Bluebeam, Foxit, etc.
- El autor se guarda en el atributo `title=""` de cada elemento XFDF.
- La escala calibrada se guarda como comentario `<!-- SAF-SCALE ... -->`.
- Conversión en `js/xfdf.js` → `XFDFConverter.toXFDF()` / `fromXFDF()`.

---

## 7. Calibración de escala

El visor soporta dos modos de calibración (modal 📐):

**Modo 2 puntos:** El usuario hace clic en dos puntos del plano cuya
distancia real conoce. El sistema calcula `px/unidad`.

**Modo directo:** El programador o usuario ingresa directamente
`N px = M unidades`. Útil cuando se conoce la resolución del PDF
(p.ej. 96 DPI → 1 pulgada = 96 px).

La escala se guarda en la sesión como `{ pxPerUnit, unit }` y se
serializa tanto en JSON como en XFDF.

---

## 8. Herramientas disponibles

### Grupo Anotaciones

| Herramienta | Tecla | Notas |
|-------------|-------|-------|
| Seleccionar | `V`   | Mover y redimensionar |
| Mover vista | `H`   | Pan; también Rueda del ratón |
| Borrador    | `E`   | Clic sobre objeto para borrar |
| Flecha      | `A`   | Drag para dibujar |
| Rectángulo  | `R`   | Drag |
| Elipse      | `O`   | Drag |
| Resaltado   | —     | Rectángulo amarillo semitransparente |
| Dibujo libre| `D`   | Trazo a mano alzada |
| Nube        | —     | Drag (clic simple = nube 200×100 por defecto) |
| Texto       | `T`   | Clic para insertar IText editable |
| Nota post-it| `N`   | Clic |
| Globo       | `C`   | Clic |
| Sello       | —     | Abre modal: APROBADO / RECHAZADO / NCI / RFI / … |

### Grupo Medición (requiere calibración previa)

| Herramienta | Tecla | Notas |
|-------------|-------|-------|
| Cota lineal | —     | Drag; muestra distancia real |
| Ángulo      | —     | 3 clics: vértice + brazo A + brazo B |
| Área        | —     | Multi-clic + Enter para cerrar |
| Perímetro   | —     | Multi-clic + Enter para cerrar |

### Atajos globales

| Acción       | Tecla       |
|--------------|-------------|
| Deshacer     | `Ctrl+Z`    |
| Rehacer      | `Ctrl+Y`    |
| Ajustar vista| `F`         |
| Abrir PDF    | `Ctrl+O`    |
| Guardar JSON | `Ctrl+S`    |
| Página ant.  | `← / PgUp`  |
| Página sig.  | `→ / PgDn`  |
| Zoom +       | `Ctrl+=`    |
| Zoom −       | `Ctrl+−`    |
| Cerrar menú  | `Esc`       |

---

## 9. Arquitectura de módulos

Frontend en TypeScript (bundled por Vite); `fabric` y `pdfjs-dist` se importan
como dependencias npm (chunk `vendor`), ya no como `lib/*.min.js`.

```
src/
  main.ts                  ← Orquestador: UI, eventos, integración, usuarios
  core/
    pdf-renderer.ts        ← Wrapper de PDF.js: carga y renderiza páginas a canvas
    markup-layer.ts        ← MarkupLayer: todas las herramientas de anotación
    scale-manager.ts       ← Cálculos de escala y unidades (px ↔ m/cm/mm/ft/in)
  data/
    storage.ts             ← Persistencia: localStorage ↔ Oracle API
    xfdf.ts                ← XFDFConverter: serializar/deserializar XFDF ↔ Fabric JSON
  ui/
    icons.ts               ← Iconos line-style embebidos (sin dependencia ni CDN)
  styles/
    viewer.css             ← Estilos (importado por main.ts; Vite lo extrae en build)

server/                    ← Backend Node/Express + Oracle (CommonJS)
  routes/
    markup.js              ← Rutas Express: GET/POST markup Fabric.js ↔ Oracle
    xfdf.js                ← Rutas Express: GET/PUT/DELETE XFDF ↔ disco + Oracle
  xfdf-store.js            ← Módulo de almacenamiento XFDF (dual: disco + Oracle)
  sql/
    saf_planos_fabricjs.sql  ← Schema Oracle completo (tablas + PKG_PLANO_MARKUP)
```

---

## 10. Dropdowns y posición en toolbar

Los menús desplegables usan `position: fixed` (no `absolute`) porque el
toolbar tiene `overflow-y: hidden` y recorta cualquier hijo con
`position: absolute`. La posición se calcula en JS con `getBoundingClientRect()`
cada vez que se abre el dropdown.

```javascript
// js/app.js → openDropdown(dd, anchorBtn)
```

Si se agrega un nuevo dropdown al toolbar, seguir el mismo patrón:
estructura `.tb-dropdown-wrap > .tb-dropdown-btn + .tb-dropdown` en el HTML,
y el `initDropdowns()` lo detecta automáticamente.

---

## 11. Certificado SSL y CORS

El servidor `saf.aicsacorp.com` usa un certificado auto-firmado (no verificable
por CA pública). Esto impide hacer `fetch` desde dominios externos sin antes
confiar en el certificado.

**Solución en producción:** servir el visor desde el mismo dominio
(`saf.aicsacorp.com`) para que el navegador considere las llamadas
`same-origin` y no aplique restricciones CORS.

**En desarrollo local:** el `fetch` puede fallar con `SSL_ERROR`. Opciones:
- Usar `http://` si el servidor lo soporta en desarrollo.
- Confiar manualmente en el certificado en el navegador.
- Agregar `--ignore-certificate-errors` al lanzar Chrome (solo para pruebas).

---

## 12. Etiquetas de estado (borde doble)

Además de los sellos clásicos (inclinados, con emoji), el modal 🔖 incluye una
segunda sección con **etiquetas profesionales** de borde doble, similares a
las de Bluebeam Revu.

### Tipos de etiqueta

| Etiqueta   | Color    | Estilo | Descripción |
|------------|----------|--------|-------------|
| ORIGINAL   | Azul     | solid  | Documento original |
| RECEIVED   | Verde    | solid  | Recibido conforme |
| ISSUED     | Cyan     | solid  | Emitido |
| FINAL      | Violeta  | solid  | Versión final |
| FOR REVIEW | Ámbar    | solid  | Para revisión |
| SUPERSEDED | Gris     | solid  | Versión superada |
| PAST DUE   | Rojo     | hatch  | Plazo vencido |
| VOID       | Gris     | hatch  | Nulo / sin validez |
| CANCELLED  | Rojo osc.| hatch  | Cancelado |
| REJECTED   | Marrón   | hatch  | Rechazado |

**Estilo `solid`:** borde doble con relleno semitransparente del mismo color.
**Estilo `hatch`:** borde doble + trama de líneas diagonales (patrón `canvas`
generado en `_makeHatchCanvas()`).

### Dónde está el código

```
js/markup-layer.js →  _makeHatchCanvas(color)    — genera el canvas de trama
                   →  addLabel(x, y, text, color, style)  — crea el objeto Fabric.js
js/app.js          →  handler '.stamp-opt, .stamp-label' — rutea a addStamp o addLabel
index.html         →  sección "Etiquetas de estado" en #modal-stamp
css/viewer.css     →  .stamp-label, .label-grid, .stamp-section-title
```

### Agregar una nueva etiqueta

1. Agregar un `<button class="stamp-label">` en `index.html` con
   `data-stamp`, `data-color` y `data-style` (`label` o `hatch`).
2. Agregar la regla CSS en `viewer.css`:
   ```css
   .stamp-label[data-color="#HEXHEX"] { color:#HEXHEX; border:2px solid #HEXHEX; }
   ```
3. No requiere cambios en JS.

### Personalizar el aspecto de la etiqueta en el lienzo

El aspecto (tamaño de fuente, grosor de borde, espacio interior) se controla
en `addLabel()` en `markup-layer.js`. Variables clave:

| Variable | Valor default | Descripción |
|----------|--------------|-------------|
| `PAD_H`  | 18           | Padding horizontal |
| `PAD_V`  | 11           | Padding vertical |
| `SW`     | 3            | Grosor borde exterior |
| `GAP`    | 4            | Espacio entre borde ext. e int. |
| `fontSize` | 22         | Tamaño de letra |
| `charSpacing` | 80     | Separación entre letras |

## 13. Panel de propiedades de anotación

Los sellos disponibles se definen en `index.html` dentro del modal `#modal-stamp`:

```html
<button class="stamp-opt s-aprobado"
        data-stamp="APROBADO"
        data-color="#16a34a">✅ APROBADO</button>
```

Añadir un nuevo botón con `data-stamp` (texto del sello) y `data-color` (color
HEX) es suficiente. El sistema lo detecta automáticamente con
`document.querySelectorAll('.stamp-opt')`.

Agregar también la clase de color correspondiente en `viewer.css`:

```css
.s-nuevo { border-color: #HEXHEX40; color: #HEXHEX; }
```

---

## 13. Panel de propiedades de anotación

Al hacer clic en cualquier anotación con la herramienta **Seleccionar (V)**,
se abre un panel lateral derecho con formulario completo.

### 13.1 Tipos de anotación disponibles

| ID      | Etiqueta      | Descripción completa |
|---------|---------------|----------------------|
| `RFI`   | RFI           | Request for Information |
| `NCR`   | NCR           | Non-Conformance Report |
| `OBS`   | Observación   | Observación / Incidencia |
| `AC`    | AC            | Aprobación de Cambio |
| `PCN`   | PCN/ECR       | Solicitud de cambio |
| `COM`   | Comentario    | Comentario general |
| `DUDA`  | Duda          | Duda de constructibilidad |
| `COORD` | Coordinación  | Nota de coordinación entre disciplinas |
| `MED`   | Medición      | Anotación de medición / cantidad |
| `HITO`  | Hito calidad  | Hito de calidad / control |
| `CHECK` | Checklist     | Checklist / verificación |

Para **agregar un nuevo tipo** editar el array `ANNOT_TYPES` en `app.js` —
ningún otro archivo requiere cambio.

### 13.2 Datos almacenados en `obj.data`

Campos añadidos por el panel (sobre los campos base `autor`, `fecha`, `type`):

```json
{
  "tipoAnnot"      : "RFI",
  "prioridad"      : "Alto",
  "critico"        : true,
  "afectaCosto"    : false,
  "requiereCliente": true,
  "descripcion"    : "Revisar detalles de armadura según plano E-12",
  "referencias"    : {
    "numeroRfi"        : "RFI-042",
    "docOrigen"        : "RFI-042_rev1.pdf",
    "itemMatriz"       : "COM-123",
    "codEspecificacion": "03 30 00"
  }
}
```

### 13.3 Comportamiento del panel

- **Apertura:** al seleccionar cualquier objeto con la herramienta Select.
- **Cierre:** solo vía botón ✕ o Cancelar (no cierra al hacer clic fuera).
  Esto evita pérdida accidental de datos en el formulario.
- **Guardar:** actualiza `obj.data` en el objeto Fabric.js en memoria.
  El cambio se persiste al guardar la sesión (JSON o XFDF).
- **Tooltip:** al pasar el cursor sobre una anotación ya clasificada,
  el tooltip muestra autor · fecha · tipo · prioridad.
- **Teclas:** el panel bloquea la propagación de `keydown` para que los
  atajos de teclado globales no interfieran mientras se escribe en el formulario.

### 13.4 Extender con campos adicionales

1. Agregar `<input>` / `<select>` en `index.html` dentro de `.ap-body`.
2. Leer su valor en `saveAnnotProps()` en `app.js`.
3. Escribirlo en `_apObj.data.nuevoCampo`.
4. Documentar el campo aquí y en la sección 5 (variables de configuración).

### 13.5 Integración con Oracle

Los campos del panel se guardan como parte del CLOB JSON en
`SAF_PLANO_MARKUP` (campo `MARKUP_JSON`). Si en el futuro se quieren
consultar estos campos desde PL/SQL, se puede hacer con
`JSON_VALUE` / `JSON_TABLE` sobre el CLOB:

```sql
SELECT JSON_VALUE(markup_json, '$[*].data.tipoAnnot') AS tipo
FROM   saf_plano_markup
WHERE  doc_id = :doc_id;
```

## 14. Toggle del panel de propiedades

El panel de propiedades (RFI, NCR, prioridad, referencias) se puede
mostrar u ocultar sin perder el plano de vista.

### Comportamiento por defecto

El panel está **desactivado** al arrancar (`_panelEnabled = false`).
El canvas ocupa todo el ancho de pantalla. El usuario lo activa cuando
necesita editar propiedades de anotaciones.

### Controles

| Control | Acción |
|---------|--------|
| Botón `◧` en la toolbar | Toggle mostrar/ocultar |
| Tecla `P` | Mismo toggle (fuera de inputs) |

### Estados del botón

- **Sin highlight** → panel desactivado; hacer clic en una anotación no abre el panel
- **Azul / activo** → panel activado; hacer clic en una anotación abre el panel a la derecha

### Lógica en el código

```javascript
// js/app.js
let _panelEnabled = false;        // ← estado global

function toggleAnnotPanel() {
  _panelEnabled = !_panelEnabled;
  // actualiza botón, cierra panel si se desactiva,
  // o reabre para el objeto activo si se activa
}

function openAnnotPanel(obj) {
  if (!_panelEnabled) return;     // ← guard: panel desactivado = pantalla completa
  // ... rellena y muestra el panel
}
```

### Cambiar el estado inicial

Para que el panel arranque **abierto por defecto**, cambiar en `app.js`:
```javascript
let _panelEnabled = true;
```
Y agregar la clase activa inicial al botón en el HTML:
```html
<button ... id="btn-toggle-panel" class="tb-btn tb-icon tb-btn-active">◧</button>
```

## 15. Comportamiento post-colocación de herramientas de un solo clic

Las herramientas que se activan con un clic (sello, etiqueta, nota, callout,
texto) deben volver automáticamente al modo **Seleccionar** después de colocar
el objeto. Si no lo hacen, el siguiente clic en el plano intenta colocar otro
objeto en lugar de seleccionar el que se acaba de crear.

### Herramientas que hacen auto-select

| Herramienta | Dónde se implementa |
|-------------|---------------------|
| Nube        | `markup-layer.js → _addCloudFromRect()` → `onAutoSelect` callback |
| Sello       | `app.js` → handler `.stamp-opt, .stamp-label` → `activateTool('select')` |
| Etiqueta    | `app.js` → mismo handler |
| Cancelar sello | `app.js` → `ui.btnStampCancel` → `activateTool('select')` |

### Patrón a seguir al agregar nuevas herramientas de un solo clic

Después de colocar el objeto, llamar siempre:
```javascript
activateTool('select');
```

Para herramientas dentro de `markup-layer.js` que no tienen acceso directo
a `activateTool`, usar el callback `onAutoSelect`:
```javascript
if (this.onAutoSelect) {
  requestAnimationFrame(() => {
    this.setTool('select');
    this.onAutoSelect();
  });
}
```

## 16. Texto en nubes de revisión

Las nubes permiten agregar texto interior con doble-clic.

### Cómo funciona

| Acción | Resultado |
|--------|-----------|
| **Doble-clic** en la nube | Abre cursor de texto centrado dentro de la nube |
| Escribir y hacer clic fuera | Guarda el texto y sale del modo edición |
| Dejar el campo vacío y salir | El texto desaparece (no se guarda un IText vacío) |
| Mover / escalar / rotar la nube | El texto sigue el centro de la nube automáticamente |
| Borrar la nube (borrador o Supr) | También elimina el texto asociado |

### Implementación técnica

- La nube (`fabric.Path`) recibe `data.cloudId = 'cld-<timestamp36>'` al crearse.
- El texto (`fabric.IText`) se crea como **objeto separado** en el canvas con:
  - `data.type = 'cloud-label'`
  - `data.cloudId` = mismo ID que la nube
  - `originX/originY = 'center'`, posicionado en `cloudObj.getCenterPoint()`
- El tamaño de fuente se calcula dinámicamente:
  ```javascript
  fontSize = Math.round(Math.min(cloudObj.width, cloudObj.height) * 0.14 + 10)
  ```
- Los métodos relevantes en `markup-layer.js`:
  - `_editCloudLabel(cloudObj)` — crea o abre el IText para edición
  - `_syncCloudLabel(cloudObj)` — reposiciona el label al mover la nube
  - `_removeCloudLabel(cloudId)` — elimina el label al borrar la nube
- Los eventos en `_bindCanvasEvents`:
  - `mouse:dblclick` → dispara `_editCloudLabel`
  - `object:moving / scaling / rotating / modified` → dispara `_syncCloudLabel`
- El `cloudId` se serializa en `data` y sobrevive `getMarkupJSON()` / `setMarkupJSON()`.
- Al restaurar markup desde JSON, el evento `editing:exited` se reconfigura la
  siguiente vez que el usuario hace doble-clic (usando bandera `_exitHandlerBound`
  para no duplicar listeners).

### Por qué objeto separado y no grupo

Fabric.js no permite editar texto dentro de un `Group` directamente (el IText
pierde interactividad). Al mantener el label como objeto independiente y sincronizar
su posición, se obtiene edición nativa de Fabric sin ningún workaround.

---

## 15. Historial de cambios importantes

| Fecha       | Cambio |
|-------------|--------|
| 2026-05-28  | Texto en nubes: doble-clic abre IText centrado, se sincroniza al mover, se borra con la nube |
| 2026-05-28  | Toggle panel de propiedades: botón ◧ + tecla P; apagado por defecto para pantalla completa |
| 2026-05-28  | Fix: sello/etiqueta vuelve a select tras colocarse (antes quedaba bloqueado en modo stamp) |
| 2026-05-28  | Etiquetas de estado: borde doble, trama diagonal, 10 etiquetas (ORIGINAL, PAST DUE, etc.) |
| 2026-05-28  | Panel de propiedades: tipo, prioridad/impacto, referencias cruzadas, descripción |
| 2026-05-28  | Multi-usuario: atribución por autor, colores, filtro por autor, tooltip |
| 2026-05-28  | Integración API `usuario_conectado` para resolver ID → nombre completo |
| 2026-05-28  | Nube de revisión con curvas Bézier cúbicas (3 o 4 bumps según proporción) |
| 2026-05-28  | Calibración modo directo (px = unidades sin clic en plano) |
| 2026-05-28  | Dropdowns con `position:fixed` para escapar overflow del toolbar |
| 2026-05-28  | XFDF API (GET/PUT/DELETE/meta) + tabla `SAF_PLANO_MARKUP_XFDF` en Oracle |
