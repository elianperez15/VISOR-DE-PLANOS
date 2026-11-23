# Manual Técnico

**Visor de Planos SAF · AICSA**

| Campo | Valor |
|---|---|
| Producto | Visor de Planos SAF |
| Tipo | SPA embebida en Oracle APEX (iframe) |
| Versión doc. | 2.2 |
| Actualizado | 2026-10-21 |
| Público | Equipo de desarrollo / operaciones |

## 1. Introducción

El Visor de Planos SAF permite visualizar planos en PDF y anotarlos (marcas) con colaboración en tiempo real, y ver modelos BIM en 3D (IFC). Se integra en el portal APEX de AICSA mediante un iframe. El PDF original no se modifica: las anotaciones se guardan aparte, por usuario y por plano.

## 2. Stack y estructura del proyecto

| Tecnología | Uso |
|---|---|
| Vite 5 + TypeScript | Build y bundling de la SPA. |
| Fabric.js 5.3 | Capa de anotaciones sobre el plano. |
| PDF.js 3.11 | Render del PDF. |
| That Open Engine 3.4 + three.js 0.184 | Visor del modelo 3D (`@thatopen/components`, `@thatopen/components-front`, `@thatopen/fragments`). |
| web-ifc 0.0.77 | Lector de IFC (WebAssembly). Versión fija: debe coincidir con la que espera `@thatopen/components`. |
| WebSocket nativo | Colaboración en vivo (cliente y servidor, sin dependencias npm). |
| Node.js + systemd | Microservicio de colaboración. |
| nginx | Sirve los estáticos y hace de proxy hacia ORDS y el WebSocket. |
| Oracle APEX + ORDS | Portal anfitrión y API REST. |

### Estructura

```
src/main.ts                         Entrada del visor de planos (/): compone los dominios
src/main-modelo.ts                  Entrada del visor del modelo 3D (/modelo/)
modelo/index.html                   Página del visor 3D
src/plano/                          Abrir, renderizar, navegar y rotar el PDF (pdf-renderer, plan-viewer)
src/anotaciones/                    Lienzo Fabric.js (lienzo/markup-layer + mixins), herramientas, panel, adjuntos
src/mediciones/                     Escala, calibración, cotas/áreas
src/rfi/                            Nubes y sellos RFI
src/hipervinculos/                  Enlaces entre planos
src/revisiones/                     Comparación de revisiones
src/modelo-3d/                      Visor del modelo 3D (model-viewer, bim-engine = That Open, models-api)
src/colaboracion/                   Colaboración en vivo (cliente WebSocket, capas ajenas, presencia)
src/persistencia/                   Marcas/escala/rotación en ORDS, exportación JSON
src/exportacion/                    PDF con/sin marcas, captura por selección
src/integracion-apex/               Puente postMessage con APEX
src/usuario/                        Identidad, permisos, color por autor
src/compartido/                     UI y utilidades sin dominio
src/app/                            Configuración (VITE_*), atajos, orden del CSS
server/realtime/collab-server.js    Microservicio WS
server/realtime/saf-collab.service  Unidad systemd
server/nginx-prod.conf              vhost de nginx
server/sql/ords_markup.sql          Handlers ORDS (marcas)
server/sql/ords_planos_lov.sql      Handler ORDS (listado de planos)
scripts/deploy.sh                   Despliegue
scripts/copy-web-ifc.mjs            Copia el .wasm de web-ifc a public/web-ifc/<versión>/ (predev/prebuild)
scripts/diag-ords.sh                Diagnóstico de la API
docs/Apex-Configuracion.js          Código de integración del lado APEX
docs/DESPLIEGUE.md                  Guía operativa de despliegue
```

## 3. Configuración (variables de entorno)

Hay **un solo entorno**. `npm run build` compila en modo production y carga `.env.production`, que está versionado en git porque no contiene secretos: solo URLs públicas que de todos modos acaban dentro del bundle.

| Variable | Descripción |
|---|---|
| `VITE_ORDS_BASE` | Base de ORDS. **Déjala relativa (`/ords/safws`)**: nginx reenvía `/ords/` al host real, así no hay CORS ni dominios quemados en el bundle. |
| `VITE_APEX_ORIGIN` | Origen del portal APEX que embebe el visor. Valida el `postMessage`. |
| `VITE_COLLAB_URL` | URL del microservicio. Por defecto el mismo origen, que es lo correcto. |
| `VITE_COLLAB_ENABLED` | `false` apaga la colaboración **en vivo**. No toca la persistencia. Actualmente: **`false`**. |

Las sobrescrituras locales de cada máquina van en `.env.local`, ignorado por git.

### 3.1 Los tres hostnames

Es la fuente de confusión más común del proyecto. Son papeles distintos:

| Host | Papel | Dónde se configura |
|---|---|---|
| `planos.aicsacorp.com` | Donde vive **el visor** | vhost de nginx |
| `saf.aicsacorp.com` | Donde vive **ORDS/APEX** — de aquí salen los PDFs | `set $ords_upstream` en nginx |
| `saf.aicsacorp.com` | El **portal APEX** que embebe el visor | `VITE_APEX_ORIGIN` |

Los dos últimos **tienen que ser el mismo host**: APEX corre sobre ORDS y es APEX quien manda los `id_en_repositorio`. Apuntar a ORDS distintos significa buscar IDs de una base dentro de otra.

`VITE_APEX_ORIGIN` no sirve para traer planos; solo valida el origen del `postMessage`.

### 3.2 Cambiar de entorno son SIEMPRE dos cambios

| | Dónde | ¿Redespliegue? |
|---|---|---|
| De dónde salen los planos | `set $ords_upstream` en nginx | No — `nginx -t && reload` |
| Quién puede hablarle al visor | `VITE_APEX_ORIGIN` en `.env.production` | **Sí** — `npm run deploy` |

Cambiar solo el primero produce planos equivocados o "Invalid PDF structure". Cambiar solo el segundo hace que **no pase nada en absoluto**: el visor descarta en silencio el mensaje de APEX.

## 4. Integración con APEX

El código completo del lado APEX, comentado y listo para pegar, está en **`docs/Apex-Configuracion.js`**. Va en la página APEX → JavaScript → *Function and Global Variable Declaration*.

### 4.0 Dos páginas: planos (2D) y modelo (3D)

| URL | Qué muestra | Entrada |
|---|---|---|
| `/` | Visor de planos (PDF): marcas, RFI, hipervínculos, comparación… | `index.html` → `src/main.ts` |
| `/modelo/` | Visor del modelo 3D (IFC / `.frag`) | `modelo/index.html` → `src/main-modelo.ts` |

Las dos aceptan los mismos parámetros de URL y el mismo `init` de APEX. En `/modelo/` el modelo llega:

| Cómo | Qué hace |
|---|---|
| **Abrir IFC** (o el botón del estado vacío) | Abre un `.ifc` / `.frag` de la computadora. Se procesa en el navegador; **no se sube al servidor**. |
| Arrastrar un `.ifc` a la página | Lo mismo. |
| APEX (`init` / `openModel` con el `repoId` del `.ifc`) | Lo pide al endpoint `documento` del repositorio. |

**Herramientas del visor 3D.** La interfaz sigue la del visor de planos: la barra superior tiene las acciones (Abrir IFC, paneles, vistas, Cerrar) y el **riel flotante** —el mismo componente, arrastrable y con orientación vertical u horizontal— las herramientas.

| Herramienta | Uso |
|---|---|
| **Edificio** (panel izquierdo) | Elementos por **nivel** y por **tipo** (muros, losas, columnas…). Ojo: ocultar/mostrar · nombre: seleccionar y encuadrar · **Aislar**: ver sólo ese grupo · **Mostrar todo**. |
| **Propiedades** (panel derecho) | Al seleccionar un elemento: tipo, nombre, código, nivel, material y los conjuntos de propiedades y cantidades del IFC. |
| **Seleccionar** (V) | Clic: un elemento · Mayús+clic: sumar · doble clic: acercarse · Esc: limpiar. |
| **Medir** (grupo del riel) | Distancia · área de una cara · área por puntos (Enter cierra) · volumen de elementos (Enter calcula). En metros reales, sin calibrar. El botón repite la última medición; el triángulo abre el menú. Esc vuelve a Seleccionar. |
| **Corte** | Doble clic sobre una superficie corta el modelo ahí; las flechas del plano lo mueven. |
| Papelera | Borra todas las medidas y cortes. Supr borra sólo el que está bajo el cursor. |

**Rendimiento: IFC frente a .frag.** El visor abre el formato fragments (`.frag`). Un IFC hay que convertirlo antes, y eso es lo lento: un modelo de Revit de 126 MB tarda ~5 min en convertirse y su `.frag` (37 MB) abre en ~4 s. Como hace Autodesk con sus modelos, lo recomendable es **convertir una vez al subir el IFC** y que la API entregue el `.frag`:

```bash
npm run convertir-ifc -- modelo.ifc            # genera modelo.frag al lado
```

Cuando el visor sí recibe un IFC (archivo local, o un IFC del repositorio):

| Qué hace | Para qué |
|---|---|
| Lo convierte en un Web Worker (`bim-convert.worker.ts`) | La página no se congela; muestra fase y tiempo transcurrido. |
| Guarda el `.frag` en la caché del navegador (IndexedDB, los 5 más recientes) | La siguiente vez el mismo archivo abre en segundos (y del repositorio ni se descarga). |
| Botón **.frag** de la barra | Descarga el modelo ya convertido, para guardarlo en el repositorio. |

**Licencias de terceros.** `scripts/third-party-licenses.mjs` genera `public/THIRD_PARTY_LICENSES.txt` antes de cada `dev` y `build`, con el aviso y el texto de licencia de cada dependencia de producción (MIT, ISC, Apache-2.0, MPL-2.0…). Los dos visores lo muestran con el enlace **Licencias** de la esquina inferior derecha. El logo de That Open sobre la vista 3D está apagado (`showLogo = false`): su licencia MIT no lo exige.

La consola indica de dónde salió cada modelo: `[SAF] modelo 3D «…» desde la caché del navegador` / `desde el archivo de origen`.

Los números de las propiedades se muestran tal como vienen en el IFC, en las unidades del modelo (un largo de 3800 suele ser milímetros). Las mediciones, en cambio, siempre salen en metros.

Si una página recibe un archivo de la otra (un `.ifc` en `/`, un PDF en `/modelo/`), navega sola a la correcta y conserva usuario, proyecto y permiso. nginx no necesita reglas nuevas: `try_files $uri $uri/ /index.html` ya sirve `/modelo/`.

### 4.1 Parámetros de la URL del iframe

Alternativa al `postMessage`, útil para pruebas.

| Parámetro | Significado |
|---|---|
| `usuario_conectado` | Nombre del usuario. Alternativas: `usuario`, `user`, `nombreUsuario`. |
| `codigo_usuario` | Id numérico → `USUARIO_GRABACION`. Alternativas: `usuario_id`, `id_usuario`. |
| `repoId` | `id_en_repositorio` del PDF (sala de colaboración y clave de guardado) o del modelo 3D. |
| `nombre` | `nombre_archivo`. Un `.ifc` / `.frag` en `/` se pasa solo a `/modelo/`. |
| `modelo` | En `/modelo/`: URL directa de un modelo 3D (pruebas). |
| `codigo_proyecto` | Filtra los listados de planos y de RFI. |
| `id_revision` | Revisión del plano. |
| `P0_PERMISO_COLABORADOR` | `1` → puede guardar marcas y descargar. |

Ejemplo:

```
https://planos.aicsacorp.com/?usuario_conectado=CARLOS&codigo_usuario=173&repoId=0001007793&nombre=plano.pdf
```

`repoId` es **texto** y puede llevar ceros a la izquierda: el visor lo conserva como cadena. `codigo_usuario` viaja por la URL porque el `localStorage` de APEX no es accesible desde el iframe (distinto origen).

### 4.2 Protocolo postMessage

**APEX → Visor**

| Acción | Datos | Efecto |
|---|---|---|
| `init` | `usuario_conectado`, `codigo_usuario`, `repoId`, `nombre`, `codigo_proyecto`, `id_revision`, `P0_PERMISO_COLABORADOR` | Mensaje consolidado: identidad, proyecto, permisos y abrir el plano. **Es el que se usa.** |
| `setUser` | `name`, `codigo` | Solo identidad (alternativa a la URL). |
| `openPDF` | `repoId` o `pdfUrl`, `docId`, `name` | Abrir un plano sin tocar la identidad. Un `name` `.ifc` / `.frag` pasa a `/modelo/`. |
| `openModel` | `repoId` o `modelUrl`, `nombre` | Abrir un modelo 3D (en `/` pasa a `/modelo/`). |
| `setLinkTarget` | `repoId`, `name`, `file` | Respuesta de APEX al selector "elegir plano destino" de un hipervínculo. |

`codigo_proyecto` y `P0_PERMISO_COLABORADOR` se aplican desde **cualquier** mensaje, no solo desde `init`. `init` también acepta `modelUrl`; con un `nombre` `.ifc` en `/`, el visor pasa a `/modelo/`.

**Visor → APEX**

| Acción | Datos | Qué hace APEX |
|---|---|---|
| `openPlano` | `repoId`, `name`, `file`, `url` | Abre el plano destino de un hipervínculo (pestaña o ajax callback). |
| `downloadDoc` | `filename`, `dataUrl` | Dispara la descarga (el iframe está en sandbox y no puede). |
| `openRfi` | `rfiId`, `apexPage`, `mode`, `repoId`, `page` | Abre el drawer de RFI. Sin `rfiId` y con `mode:'create'` → alta. |
| `close` | `source:'visor-planos'` | Cierra el visor. Se envía con `targetOrigin '*'` porque el iframe no conoce el origen real del padre. |

### 4.3 Seguridad: la regla de los dos orígenes

Cada lado acepta solo mensajes del otro. En APEX, `VISOR_ORIGIN` debe ser el origen del visor; en el visor, `VITE_APEX_ORIGIN` debe ser el origen de la página APEX. **Si no coinciden, el mensaje se descarta en silencio**: no hay error, el visor simplemente se queda vacío. Es el fallo más difícil de diagnosticar de toda la integración.

En el listener de APEX, valida `e.origin` **antes** de procesar cualquier acción — incluidas `downloadDoc` y `close`, que manipulan archivos y la sesión.

### 4.4 iframe — sandbox recomendado

```
sandbox="allow-scripts allow-same-origin allow-popups allow-downloads allow-modals"
```

## 5. API REST (ORDS)

Base: `/ords/safws` (relativa; nginx la reenvía al ORDS real).

**El nombre del módulo ORDS no va en la URL.** Lo que va es su *base path*, que en este ORDS es `planos-hub/`. Verificado el 2026-09-22 contra `dev.aicsacorp.com`:

```
/ords/safws/planos-hub/documento            → 200 application/pdf
/ords/safws/Reportes/planos-hub/documento   → 404 NotFound
```

| Método / Ruta | Descripción |
|---|---|
| `GET planos-hub/documento` | Devuelve el archivo (BLOB): el PDF o el modelo IFC / `.frag`. El `id` y el `nombre` van como **HTTP HEADERS**, no en la URL. Para los modelos se usa el mismo endpoint (`API_MODELO` en `app/config.ts`): el handler debe entregar el archivo tal cual, sin forzar `application/pdf` ni convertirlo. |
| `POST planos-hub/markup` | Guarda (MERGE) la capa del usuario. Header `id`; body `{usuario, usuario_id, id_revision, sesion}`. |
| `GET planos-hub/markup` | Devuelve `{ capas: [{usuario, usuario_id, sesion}] }`. Header `id`. |
| `GET planos-hub/planos-listado` | Listado de planos para el hipervínculo. Header `id` para excluir el plano actual. |
| `GET planos-hub/rfi-listado` | Listado de RFIs para el sello RFI. |
| `GET usuario_conectado` | Resuelve id de usuario → nombre completo. |

Que los parámetros viajen como headers y no en la URL tiene una consecuencia operativa: **nginx elimina por defecto los headers con guion bajo**. Sin `underscores_in_headers on;` en el bloque `server`, `codigo_proyecto` llega NULL al handler.

Los scripts PL/SQL están en `server/sql/`. Sus comentarios mencionan rutas con `/Reportes/` que **están obsoletos**.

## 6. Modelo de datos

Tabla principal de anotaciones (una fila por `id_en_repositorio` + `usuario_grabacion`):

```
DRW_REVISIONES_PLANO_ANOTACION
  ID                     NUMBER (PK)
  ID_EN_REPOSITORIO      VARCHAR2(100)   -- FK al PDF en gestión documental
  ID_REVISIONES_PLANO    NUMBER          -- FK a la revisión
  ANOTACION_JSON         CLOB (is json)  -- {usuario, usuario_id, sesion}
  ESCALA_PIXELES         NUMBER(12,4)
  ESCALA_DISTANCIA_REAL  NUMBER(12,4)
  ESCALA_UNIDAD_MEDIDA   VARCHAR2(10)
  USUARIO_GRABACION      NUMBER(8)       -- codigo_usuario
  FECHA_GRABACION        DATE
  USUARIO_MODIFICACION   NUMBER(8)
  FECHA_MODIFICACION     DATE
```

Tablas relacionadas: `DRW_REVISIONES_PLANO` (revisiones) y `GESTION_DOCUMENTAL_CORPORATIVA` (`id_en_repositorio`, `nombre_archivo`). El PDF original vive en el File Server.

## 7. Colaboración en tiempo real

> **Estado actual: DESACTIVADA** (`VITE_COLLAB_ENABLED=false` en `.env.production`).
> El microservicio sigue instalado y corriendo; solo el cliente no se conecta.
> Para reactivarla: `VITE_COLLAB_ENABLED=true` + `npm run deploy`.

### 7.1 Qué es y qué NO es

Fue la confusión más cara del proyecto (la persistencia vivía en un archivo llamado `collab-sync`). Desde la v2.1 cada camino está en su carpeta:

| Módulo | Transporte | Qué hace |
|---|---|---|
| `colaboracion/collab.ts` + `collab-sync.ts` | WebSocket | **Solo efímero**: cursores, deltas en vivo, presencia, difusión inmediata de la escala. No persiste nada. |
| `persistencia/markup-store.ts` | HTTP → ORDS | **La capa de persistencia**: `saveNow`, `saveScaleNow`, `saveObjectsNow`, `loadFromServer`. Es lo que hace que las marcas y la escala sobrevivan. |

Consecuencia práctica: **la calibración de escala no depende del WebSocket**. Al calibrar se disparan dos caminos independientes — `broadcastScale()` por WebSocket (para quien esté mirando ahora) y `saveScaleNow()` por HTTP contra ORDS (lo que la hace perdurar). Al abrir un plano, la escala se restaura desde ORDS.

Con el flag apagado se pierde solo: cursores ajenos, ver marcas de otros mientras dibujan, propagación instantánea de la escala y el panel de colaboradores. Se conserva todo lo persistente.

**Si algún día se decide eliminar la colaboración**, se quita la carpeta `colaboracion/`, el microservicio y el `location /rt/` de nginx. `persistencia/` no depende del WebSocket y sigue funcionando.

### 7.2 El microservicio

Microservicio `collab-server.js` (Node, WebSocket nativo, cero dependencias) en el puerto 3100, expuesto por nginx en `/rt/`. Servicio systemd: `saf-collab`.

- Salas por `id_en_repositorio`: cada plano es una sala.
- Mensajes: `join` (presencia), `delta` (capa de un autor por página), `cursor` (posición en vivo).
- Cada usuario es dueño de SUS objetos; las marcas ajenas se ven bloqueadas.
- El relay **no persiste nada**: la durabilidad es de ORDS/Oracle. Si el proceso se reinicia no se pierde nada; al reconectar, el visor relee.
- `COLLAB_ORIGINS` en la unidad systemd debe ser el origen del visor **incluyendo el puerto** si no es 443.

Con `VITE_COLLAB_ENABLED=false`, el cliente ni siquiera abre la conexión: tampoco arranca el bucle de reintentos, que si no reintentaría cada 8 s indefinidamente y llenaría la consola de errores.

## 8. Persistencia de marcas

**No hay autoguardado general.** Dibujar, mover o borrar figuras NO las envía al servidor: solo actualiza la copia en memoria de la sesión. Lo que persiste es esto y nada más:

| Qué | Cuándo | Función |
|---|---|---|
| Todas las marcas propias + escala + rotación | Al pulsar **Guardar** | `saveNow()` |
| **Nube RFI** (+ su sello) | Automático, al vincular un RFI | `saveObjectsNow()` |
| **Escala calibrada** | Automático, al calibrar | `saveScaleNow()` |

Las dos automáticas persisten **solo su propio objeto**, partiendo del baseline ya guardado: no arrastran las figuras que el usuario todavía no confirmó con Guardar.

Consecuencia práctica que conviene conocer: si el usuario dibuja y cierra sin pulsar Guardar, **pierde el trabajo**. Lo mismo al usar "Eliminar mis marcas": el borrado no se persiste hasta pulsar Guardar, así que al recargar las marcas reaparecen.

Otros puntos:

- El handler ORDS **reemplaza** toda la capa del usuario con lo enviado (no hace merge por objeto), así que el POST debe contener exactamente lo que debe quedar persistido.
- Al abrir un plano, GET `markup` trae las capas de todos los usuarios: las propias editables, las ajenas bloqueadas.
- Se guarda solo la capa del usuario actual, nunca las de otros.
- Sin `codigo_usuario`, `USUARIO_GRABACION` se graba como 0 y las marcas quedan huérfanas. El visor lo avisa con un `console.warn`.
- Nada de esto depende del WebSocket: todas las rutas son HTTP contra ORDS y funcionan con la colaboración en vivo apagada.

## 9. Despliegue

### 9.1 Subir cambios con deploy.sh

```bash
git commit -am "descripción del cambio"
npm run deploy
```

Requisitos (una sola vez): acceso SSH a `adminsafvsp@192.168.50.163`, Node y npm en la Mac, y permiso `sudo` en el servidor para reiniciar el servicio.

| Paso | Acción | Detalle |
|---|---|---|
| 1 | Conectar | Abre la conexión SSH maestra (multiplexación: la contraseña se pide una vez). |
| 2 | Verificar destino | Comprueba que el web root y la carpeta del microservicio existan y sean escribibles. Falla aquí con instrucciones claras en vez de con un error críptico de rsync. |
| 3 | Compilar | `rm -rf dist && npm run build`. Aborta si no se generó `dist/index.html`. |
| 4 | Publicar | `rsync dist/ → /usr/share/nginx/html/planos` (con `--delete`, excluyendo `/server/`) y `collab-server.js → /var/www/saf/planos/server/realtime`. |
| 5 | Reiniciar | `sudo systemctl restart saf-collab` y verificación del health. |

Antes de empezar avisa si hay cambios sin commitear, pide confirmación, y al terminar imprime el commit desplegado.

### 9.2 Parámetros del script

```bash
SERVER="adminsafvsp@192.168.50.163"
WEB_ROOT="/usr/share/nginx/html/planos"
COLLAB_DIR="/var/www/saf/planos/server/realtime"
SERVICE="saf-collab"
PORT=3100
URL="https://planos.aicsacorp.com"
```

El web root real de nginx es `/usr/share/nginx/html/planos`, **no** `/var/www`. Publicar en la carpeta equivocada hace que se sirva una versión vieja del JS.

### 9.3 Volver atrás

```bash
git log --oneline -10
git reset --hard <commit>
npm run deploy
```

Conviene etiquetar los despliegues buenos (`git tag -a v1.0.0`) para no tener que buscar el hash.

### 9.4 nginx — requisitos

El visor se sirve en la **raíz** `/`, no en `/planos/`.

```nginx
server {
    listen 443 ssl default_server;
    server_name planos.aicsacorp.com;
    root /usr/share/nginx/html/planos;

    # Los parámetros de ORDS viajan como headers; sin esto los que llevan
    # guion bajo (codigo_proyecto) llegan NULL.
    underscores_in_headers on;

    location /ords/ {
        set $ords_upstream "saf.aicsacorp.com";
        proxy_pass_request_headers on;

        # $request_uri NO es opcional: con una VARIABLE en proxy_pass, nginx
        # deja de sustituir el prefijo del location y manda la URI del
        # directivo tal cual. Con ".../ords/" el upstream recibía solo "/ords/"
        # y ORDS respondía 302 a /ords/_/landing.
        proxy_pass            https://$ords_upstream$request_uri;
        proxy_set_header      Host $ords_upstream;
        proxy_ssl_server_name on;
        proxy_read_timeout    120s;
        client_max_body_size  20m;
    }

    location /rt/ {                      # WebSocket → microservicio
        proxy_pass         http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection $connection_upgrade;
        proxy_read_timeout 3600s;
    }

    # Modelo 3D: WebAssembly de web-ifc y worker de fragments. Con el tipo
    # equivocado el navegador los rechaza y el modelo no carga.
    location ~* \.wasm$ {
        types { application/wasm wasm; }
        gzip on; gzip_types application/wasm;
        expires 1y;                       # la carpeta lleva la versión: /web-ifc/0.0.77/
        add_header Cache-Control "public, max-age=31536000, immutable" always;
        include /etc/nginx/conf.d/security-headers.inc;
    }
    location ~* \.mjs$ {
        types { application/javascript mjs; }
        expires 30d;
        add_header Cache-Control "public, max-age=2592000" always;
        include /etc/nginx/conf.d/security-headers.inc;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

El vhost completo está en `server/nginx-prod.conf`.

**Modelo 3D.** Además de los tipos de `.wasm` y `.mjs`, si `security-headers.inc` define una `Content-Security-Policy`, debe incluir `'wasm-unsafe-eval'` en `script-src` y `worker-src 'self' blob:`. El worker y el `.wasm` se sirven desde el propio visor (nunca desde unpkg), así que son compatibles con `Cross-Origin-Embedder-Policy: require-corp`.

### 9.5 Permisos y SELinux

`/usr/share/nginx/html` y `/var/www` son de root. Si el usuario SSH no puede escribir, rsync falla con `mkdir ... Permission denied (13)`. En Oracle Linux, además de los permisos POSIX hace falta el contexto SELinux correcto — sin él nginx devuelve **403 aunque `ls -l` se vea perfecto**:

```bash
sudo restorecon -Rv /usr/share/nginx/html/planos
```

### 9.6 Verificación post-despliegue

- En Network, confirma que carga el JS nuevo (hash de `index-XXXX.js`).
- `ssh adminsafvsp@192.168.50.163 'systemctl is-active saf-collab'`
- Health: `curl http://127.0.0.1:3100/health` → `{"ok":true,...}`
- Colaboración: abre el mismo plano con dos usuarios y verifica cursores y marcas en vivo.

## 10. Resolución de problemas

### 10.1 No carga el PDF

`pdf.js` hace el fetch por dentro y oculta el HTTP real, pero el visor ahora añade un bloque `── Diagnóstico ──` con el status, el `Content-Type`, los primeros bytes y los headers enviados.

| Mensaje de pdf.js | Qué pasó de verdad |
|---|---|
| `Invalid PDF structure` | HTTP **200** con un cuerpo que no es PDF (login o error de ORDS). |
| `UnexpectedResponseException: 404` | El endpoint no existe en ese ORDS. |
| `Missing PDF` | No llegó respuesta. |

Desde la terminal, el mismo diagnóstico:

```bash
bash scripts/diag-ords.sh <ID_EN_REPOSITORIO>
```

Causas frecuentes de un 200 que no es PDF:

- `proxy_pass` con variable **sin `$request_uri`**: el upstream recibe solo `/ords/` y ORDS redirige a su landing page.
- nginx reenvía `/ords/` al ORDS equivocado.
- Falta `underscores_in_headers on;` → el handler recibe `:id` NULL y devuelve cuerpo vacío con status 200.
- Ese ID no existe en la base de ese ORDS.

### 10.2 No carga el modelo 3D

| Síntoma (consola del navegador) | Causa / Solución |
|---|---|
| `Incorrect response MIME type. Expected 'application/wasm'` | nginx no mapea `.wasm` (§9.4). |
| `Failed to load module script … MIME type` en `worker-*.mjs` | nginx no mapea `.mjs` (§9.4). |
| `WebAssembly.instantiate(): Refused to compile` | La CSP no permite WebAssembly: falta `'wasm-unsafe-eval'`. |
| 404 en `/web-ifc/<versión>/web-ifc.wasm` | El build no copió el `.wasm`: `npm run build` lo hace solo (prebuild); revisa que `dist/web-ifc/` se suba. |
| Aviso "no devolvió un modelo, sino una página de error" | El endpoint `documento` devolvió HTML (login de APEX, error de ORDS) en vez del archivo. |
| El proceso se queda en "Procesando… 0 %" | web-ifc arrancó en modo multihilo. `bim-engine.ts` lo fuerza a un solo hilo; si se actualiza web-ifc o That Open, comprobar que ese parche sigue aplicando. |

### 10.3 Otros síntomas

| Síntoma | Causa / Solución |
|---|---|
| El visor se queda vacío, sin ningún error | Los orígenes no están emparejados (§4.3). Revisa `VISOR_ORIGIN` en APEX y `VITE_APEX_ORIGIN` en el visor. |
| El `init` nunca llega | `frame.src` se asignó el mismo valor que ya tenía: el iframe no recarga y el evento `load` no se dispara. Usa el `?t=` con timestamp. |
| `USUARIO_GRABACION` llega 0 | `codigo_usuario` no llegó. Pásalo por la URL o por `postMessage`. |
| Se sirve una versión vieja | `WEB_ROOT` equivocado, o caché del navegador (Ctrl+Shift+R). |
| `saf-collab` no arranca | `ssh ... 'journalctl -u saf-collab -n 30 --no-pager'` |
| Puerto 3100 ocupado (EADDRINUSE) | Proceso node huérfano: matarlo y reiniciar el servicio. |
| Pide la contraseña varias veces | Multiplexación SSH (`ControlPath` en `~/.ssh`). |
