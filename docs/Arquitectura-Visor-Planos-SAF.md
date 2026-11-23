# Visor de Planos SAF

**Documento de Arquitectura · AICSA**

Sistema de visualización y anotación de planos (PDF) y de modelos BIM en 3D (IFC), con colaboración en tiempo real, embebido en Oracle APEX y con persistencia en Oracle vía ORDS.

*Versión 2.2 · actualizado 2026-10-21*

## 1. Visión general

El visor es una SPA (Vite + TypeScript) que se ejecuta dentro de un iframe del portal APEX. Renderiza el PDF con PDF.js y permite anotarlo con Fabric.js. Las marcas se sincronizan en vivo entre usuarios mediante un microservicio WebSocket y se persisten en Oracle a través de ORDS. El archivo PDF original nunca se modifica: las marcas se guardan por separado. Los modelos IFC se ven en 3D con That Open Engine (three.js + web-ifc) en **otra URL del mismo visor**: `/` es el visor de planos (PDF) y `/modelo/` el visor del modelo (IFC). Comparten código, despliegue e integración con APEX, pero cada página carga sólo lo suyo.

## 2. Capas

| Capa | Componente | Responsabilidad |
|---|---|---|
| 1 Usuario | Navegador | Accede al portal APEX. |
| 2 APEX (padre) | Página APEX + iframe | Arma el mensaje `init` (identidad, plano, proyecto, permisos); puente `postMessage`. |
| 3 Visor (iframe) | Vite + TS + Fabric + PDF.js · That Open | Render del PDF, herramientas de marcado, colaboración, descarga. Modelo 3D (IFC / .frag). |
| 4 nginx | 192.168.50.163 | Sirve el build en `/`, proxy hacia ORDS en `/ords/` y proxy WebSocket en `/rt/`. |
| 5 Colaboración | `collab-server.js` (Node) | Relay WebSocket: cursores, deltas de capa y presencia. Sin persistencia. **Actualmente desactivada** en el cliente (`VITE_COLLAB_ENABLED=false`). |
| 6 ORDS | Base path `planos-hub/` | REST: PDF y modelos IFC, marcas, listados de planos y de RFI. |
| 7 Datos | Oracle DB + File Server | Marcas (JSON), revisiones, repositorio documental y PDF originales. |

## 3. Principio de diseño: el bundle no conoce ningún dominio

`VITE_ORDS_BASE` es la ruta **relativa** `/ords/safws`. El navegador ve el visor y la API en el mismo origen, así que no hay CORS ni preflight, y el build no queda acoplado a ningún entorno.

Quien decide el ORDS real es **exclusivamente** el `proxy_pass` de nginx. La consecuencia práctica es que mover ORDS es editar una línea de configuración y recargar nginx: **no hay que recompilar ni redesplegar el visor**.

La contrapartida es que el visor no sabe —ni puede saber— contra qué base está trabajando. Esa información vive solo en el servidor.

## 4. Módulos del visor (frontend)

El código está organizado por **dominio** (*screaming architecture*): las carpetas de `src/` dicen qué hace el visor, no con qué tecnología está hecho. Cada dominio expone una función `createX(ctx)` que recibe sus dependencias por un `ctx`, y `main.ts` sólo los compone.

| Carpeta | Responsabilidad | Piezas principales |
|---|---|---|
| `main.ts` · `main-modelo.ts` | Puntos de entrada de las dos páginas (`/` planos, `/modelo/` modelo 3D): crean los dominios, los conectan y arrancan. Sin lógica de negocio. | — |
| `plano/` | Abrir, renderizar, navegar, rotar y hacer zoom sobre el PDF. Diagnostica los fallos de carga traduciendo los mensajes opacos de pdf.js a la causa HTTP real. | `pdf-renderer` · `plan-viewer` · `plans-api` · `detail-tiles` · `viewer-notice` |
| `anotaciones/` | Lienzo de marcas (Fabric.js v5), herramientas, panel de propiedades, sellos y adjuntos. | `lienzo/markup-layer` (núcleo) · `lienzo/shapes` · `lienzo/clouds` · `lienzo/text-labels` · `toolbar` · `properties-panel` · `attachments` |
| `mediciones/` | Escala (px ↔ unidad real), calibración y figuras de medición. | `scale-manager` · `calibration` · `measure-shapes` · `area-panel` |
| `rfi/` | Nubes y sellos RFI, selector de RFI y drawer en APEX. | `rfi` · `rfi-api` · `rfi-cloud-stamp` |
| `hipervinculos/` | Enlaces de un plano a otro del repositorio. | `plan-links` |
| `revisiones/` | Comparación de revisiones (overlay y diff de alta resolución). | `compare-revisions` · `compare-overlay` |
| `modelo-3d/` | Visor del modelo BIM (IFC o `.frag`) con That Open Engine — página `/modelo/`: abrir un IFC local o del repositorio; seleccionar y ver propiedades; árbol por niveles y tipos (ocultar, aislar); medir distancia, área y volumen; cortes. El motor se descarga sólo al abrir un modelo (chunk `bim`). | Interfaz: `model-viewer` · `model-tree-panel` · `model-properties-panel` · `models-api` · `ifc-names`. Motor (únicos que importan three / @thatopen): `bim-engine` · `bim-selection` · `bim-structure` · `bim-tools`. Puente: `bim-types` (sólo tipos). |
| `colaboracion/` | Colaboración en vivo por WebSocket: capas de otros autores, cursores, presencia, autoría. | `collab` (cliente) · `collab-sync` · `canvas-collab` · `collaborators-panel` · `author-tooltip` |
| `persistencia/` | Marcas, escala y rotación en Oracle vía ORDS; exportación de la sesión a JSON. | `markup-store` · `save-marks` · `session-file` |
| `exportacion/` | Descarga en PDF (con/sin marcas), captura por selección y entrega del archivo. | `export-pdf` · `region-snapshot` · `canvas-export` · `download` |
| `integracion-apex/` | Puente `postMessage` con la página APEX (entrada y salida, validando el origen). | `apex-bridge` · `close-viewer` |
| `usuario/` | Identidad, permiso de colaborador y color determinístico por autor. | `identity` · `user-colors` |
| `compartido/` | UI y utilidades sin dominio, usadas por los dos visores. | `ui/` (iconos, menús, riel flotante de herramientas, modales, selector con buscador, toast) · `utils/` · `ords` |
| `app/` | Configuración (`VITE_*`), rutas de las dos páginas y traspaso entre ellas, atajos de teclado y orden de la cascada CSS. | `config` · `viewer-routes` · `keyboard-shortcuts` · `styles.css` · `styles-modelo.css` |

`MarkupLayer` es una sola clase, pero cada dominio aporta sus métodos de lienzo desde su carpeta (*mixins* sobre el prototipo, con la interfaz de TypeScript fusionada para conservar el tipado). El CSS también vive junto a cada dominio; `app/styles.css` sólo fija el orden de la cascada.

## 5. Flujos principales

- **Carga del plano.** APEX manda `postMessage {action:'init', repoId, nombre, ...}` al iframe → el visor pide `GET /ords/safws/planos-hub/documento` con `id` y `nombre` como **headers HTTP** → nginx reenvía a ORDS → PDF.js renderiza y Fabric monta la capa de marcas.

- **Modelo 3D.** Llega de dos formas:
  - **Local:** en `/modelo/`, el usuario pulsa **Abrir IFC** o arrastra un `.ifc` a la página. El archivo se lee en el navegador y **no se sube al servidor**.
  - **Repositorio:** APEX carga el iframe con `/modelo/` y manda el `init` con el `repoId` / `nombre` del `.ifc` (ver `actualizarFrameModelo` en `Apex-Configuracion.js`). El visor lo pide al mismo endpoint `documento` (ver `API_MODELO`).

  El motor 3D (chunk `bim`, ~0,5 MB comprimido) sólo abre fragments (`.frag`). Un IFC se convierte antes en un Web Worker con web-ifc (WebAssembly, servido desde `/web-ifc/<versión>/`; el worker sólo se descarga si hay que convertir) y el `.frag` resultante se guarda en la caché del navegador (IndexedDB). Convertir un IFC grande lleva minutos y abrir su `.frag`, segundos: lo recomendable es convertir al subir el modelo (`npm run convertir-ifc`) y que la API entregue el `.frag`.

- **Traspaso entre páginas.** Si al visor de planos le llega un `.ifc` (o al 3D un PDF), navega a la otra página pasando por la URL el documento, el usuario, el proyecto y el permiso (`app/viewer-routes.ts`). Hace falta porque APEX manda el `init` una sola vez.

- **Tiempo real** *(desactivado actualmente)*. El visor se conecta por WebSocket (`/rt/ws`) al microservicio → cursores en vivo, deltas de capa por autor y presencia entre usuarios del mismo plano. Es la única parte que se apaga con `VITE_COLLAB_ENABLED=false`; todo lo demás es independiente.

- **Persistencia.** Al dibujar, POST a `markup` (MERGE por usuario + plano) → Oracle. Al abrir, GET `markup` carga las capas: las propias editables, las ajenas bloqueadas.

- **Hipervínculo a otro plano.** El visor avisa a APEX con `postMessage openPlano` → APEX abre el plano destino. El iframe está en sandbox y no puede abrir pestañas por sí mismo.

- **Descargar documento.** El visor genera el PNG (con o sin marcas según visibilidad) y lo pasa a APEX por `postMessage downloadDoc`, porque el sandbox le impide disparar la descarga.

- **RFI.** Doble clic en un sello RFI → `postMessage openRfi` → APEX abre su drawer (página 87490).

## 5.1 Efímero vs. persistente

La distinción más importante del sistema. Antes los nombres de los archivos sugerían lo contrario (la persistencia vivía en `collab-sync`); desde la v2.1 cada camino está en su carpeta:

| | `colaboracion/` (`collab.ts` + `collab-sync.ts`) | `persistencia/markup-store.ts` |
|---|---|---|
| Transporte | WebSocket | HTTP → ORDS |
| Qué lleva | Cursores, deltas en vivo, presencia | Marcas, escala calibrada, rotación |
| Sobrevive a recargar | No | Sí |
| Se apaga con el flag | Sí | **No** |

La calibración de escala viaja por AMBOS caminos: se difunde por WebSocket para quien esté mirando en ese momento, y se guarda en ORDS para que perdure. Apagar la colaboración no la afecta.

## 6. Seguridad de la integración

APEX y el visor viven en orígenes distintos y no pueden leerse el DOM: todo pasa por `postMessage`, y cada lado valida el origen del otro.

| Lado | Variable | Debe contener |
|---|---|---|
| APEX | `VISOR_ORIGIN` | El origen del visor |
| Visor | `VITE_APEX_ORIGIN` | El origen de la página APEX |

Si no están emparejados, los mensajes se descartan **en silencio**: el visor se queda vacío sin ningún error visible. Es el modo de fallo más costoso de diagnosticar del sistema, y conviene descartarlo antes que cualquier otra hipótesis.

La única excepción es el mensaje `close`, que el visor envía con `targetOrigin '*'` porque desde dentro del iframe no conoce el origen real del padre. No lleva datos sensibles; el padre sí valida `e.origin` al recibirlo.

## 7. Modos de fallo conocidos

| Fallo | Síntoma | Causa |
|---|---|---|
| Orígenes desemparejados | El visor se queda vacío, sin error | `VISOR_ORIGIN` / `VITE_APEX_ORIGIN` no coinciden |
| `proxy_pass` con variable sin `$request_uri` | "Invalid PDF structure" | nginx manda solo `/ords/` al upstream y ORDS redirige a su landing page |
| ORDS equivocado | Planos que no existen o son otros | `$ords_upstream` apunta a una base distinta de la de APEX |
| Headers con guion bajo descartados | `codigo_proyecto` NULL en los handlers | Falta `underscores_in_headers on;` |
| Contexto SELinux incorrecto | 403 de nginx con permisos POSIX correctos | Falta `restorecon` tras crear el web root |
| `iframe.src` sin cambiar | El `init` nunca llega | Asignar el mismo valor no recarga: el evento `load` no se dispara |
| `.wasm` / `.mjs` con Content-Type incorrecto | El modelo 3D no carga (error de MIME en consola) | nginx no mapea `wasm` → `application/wasm` ni `mjs` → `application/javascript` |
| CSP sin `'wasm-unsafe-eval'` | `WebAssembly.instantiate(): Refused to compile` | La política de `security-headers.inc` bloquea WebAssembly |

## 8. Stack tecnológico

Vite 5 · TypeScript · Fabric.js 5.3 · PDF.js 3.11 · three.js 0.184 · That Open Engine 3.4 (components, components-front, fragments) · web-ifc 0.0.77 · WebSocket nativo · Node.js (systemd) · nginx · Oracle APEX · ORDS · Oracle Database.

## 9. Documentos relacionados

| Documento | Contenido |
|---|---|
| `Manual-Tecnico-Visor-Planos-SAF.docx` | Referencia técnica completa: configuración, API, modelo de datos, despliegue, troubleshooting. |
| `DESPLIEGUE.md` | Guía operativa del despliegue y del cambio de entorno. |
| `Apex-Configuracion.js` | Código de integración del lado APEX, comentado. |
