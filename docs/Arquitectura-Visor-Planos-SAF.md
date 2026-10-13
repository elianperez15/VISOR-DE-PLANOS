# Visor de Planos SAF

**Documento de Arquitectura · AICSA**

Sistema de visualización y anotación de planos (PDF) con colaboración en tiempo real, embebido en Oracle APEX y con persistencia en Oracle vía ORDS.

*Versión 2.0 · actualizado 2026-09-22*

## 1. Visión general

El visor es una SPA (Vite + TypeScript) que se ejecuta dentro de un iframe del portal APEX. Renderiza el PDF con PDF.js y permite anotarlo con Fabric.js. Las marcas se sincronizan en vivo entre usuarios mediante un microservicio WebSocket y se persisten en Oracle a través de ORDS. El archivo PDF original nunca se modifica: las marcas se guardan por separado.

## 2. Capas

| Capa | Componente | Responsabilidad |
|---|---|---|
| 1 Usuario | Navegador | Accede al portal APEX. |
| 2 APEX (padre) | Página APEX + iframe | Arma el mensaje `init` (identidad, plano, proyecto, permisos); puente `postMessage`. |
| 3 Visor (iframe) | Vite + TS + Fabric + PDF.js | Render del PDF, herramientas de marcado, colaboración, descarga. |
| 4 nginx | 192.168.50.163 | Sirve el build en `/`, proxy hacia ORDS en `/ords/` y proxy WebSocket en `/rt/`. |
| 5 Colaboración | `collab-server.js` (Node) | Relay WebSocket: cursores, deltas de capa y presencia. Sin persistencia. **Actualmente desactivada** en el cliente (`VITE_COLLAB_ENABLED=false`). |
| 6 ORDS | Base path `planos-hub/` | REST: PDF, marcas, listados de planos y de RFI. |
| 7 Datos | Oracle DB + File Server | Marcas (JSON), revisiones, repositorio documental y PDF originales. |

## 3. Principio de diseño: el bundle no conoce ningún dominio

`VITE_ORDS_BASE` es la ruta **relativa** `/ords/safws`. El navegador ve el visor y la API en el mismo origen, así que no hay CORS ni preflight, y el build no queda acoplado a ningún entorno.

Quien decide el ORDS real es **exclusivamente** el `proxy_pass` de nginx. La consecuencia práctica es que mover ORDS es editar una línea de configuración y recargar nginx: **no hay que recompilar ni redesplegar el visor**.

La contrapartida es que el visor no sabe —ni puede saber— contra qué base está trabajando. Esa información vive solo en el servidor.

## 4. Módulos del visor (frontend)

| Archivo | Función |
|---|---|
| `main.ts` | Orquestador: estado, navegación, paneles, identidad, descarga, integración APEX. |
| `core/pdf-renderer.ts` | PDF.js v3: render con supersample y tiles de detalle. Diagnostica los fallos de carga traduciendo los mensajes opacos de pdf.js a la causa HTTP real. |
| `core/markup-layer.ts` | Fabric.js v5: herramientas, capas por autor, undo/redo, escala, colaboración. |
| `core/collab.ts` | Cliente WebSocket nativo (sin dependencias): cursores, deltas, presencia. |
| `core/scale-manager.ts` | Calibración de escala (px ↔ unidad real). |
| `config.ts` | Endpoints configurables por variables `VITE_*`. |
| `ui/icons.ts` · `styles/viewer.css` | Iconos embebidos (offline) y tema tokenizado (gris AICSA). |

## 5. Flujos principales

- **Carga del plano.** APEX manda `postMessage {action:'init', repoId, nombre, ...}` al iframe → el visor pide `GET /ords/safws/planos-hub/documento` con `id` y `nombre` como **headers HTTP** → nginx reenvía a ORDS → PDF.js renderiza y Fabric monta la capa de marcas.

- **Tiempo real** *(desactivado actualmente)*. El visor se conecta por WebSocket (`/rt/ws`) al microservicio → cursores en vivo, deltas de capa por autor y presencia entre usuarios del mismo plano. Es la única parte que se apaga con `VITE_COLLAB_ENABLED=false`; todo lo demás es independiente.

- **Persistencia.** Al dibujar, POST a `markup` (MERGE por usuario + plano) → Oracle. Al abrir, GET `markup` carga las capas: las propias editables, las ajenas bloqueadas.

- **Hipervínculo a otro plano.** El visor avisa a APEX con `postMessage openPlano` → APEX abre el plano destino. El iframe está en sandbox y no puede abrir pestañas por sí mismo.

- **Descargar documento.** El visor genera el PNG (con o sin marcas según visibilidad) y lo pasa a APEX por `postMessage downloadDoc`, porque el sandbox le impide disparar la descarga.

- **RFI.** Doble clic en un sello RFI → `postMessage openRfi` → APEX abre su drawer (página 87490).

## 5.1 Efímero vs. persistente

La distinción más importante del sistema, y la que más confusión ha causado, porque los nombres de los archivos sugieren lo contrario:

| | `core/collab.ts` | `features/collab-sync.ts` |
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

## 8. Stack tecnológico

Vite 5 · TypeScript · Fabric.js 5.3 · PDF.js 3.11 · WebSocket nativo · Node.js (systemd) · nginx · Oracle APEX · ORDS · Oracle Database.

## 9. Documentos relacionados

| Documento | Contenido |
|---|---|
| `Manual-Tecnico-Visor-Planos-SAF.docx` | Referencia técnica completa: configuración, API, modelo de datos, despliegue, troubleshooting. |
| `DESPLIEGUE.md` | Guía operativa del despliegue y del cambio de entorno. |
| `Apex-Configuracion.js` | Código de integración del lado APEX, comentado. |
