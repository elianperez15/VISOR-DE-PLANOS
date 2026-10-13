# Manual Técnico

**Visor de Planos SAF · AICSA**

| Campo | Valor |
|---|---|
| Producto | Visor de Planos SAF |
| Tipo | SPA embebida en Oracle APEX (iframe) |
| Versión doc. | 2.0 |
| Actualizado | 2026-09-22 |
| Público | Equipo de desarrollo / operaciones |

## 1. Introducción

El Visor de Planos SAF permite visualizar planos en PDF y anotarlos (marcas) con colaboración en tiempo real. Se integra en el portal APEX de AICSA mediante un iframe. El PDF original no se modifica: las anotaciones se guardan aparte, por usuario y por plano.

## 2. Stack y estructura del proyecto

| Tecnología | Uso |
|---|---|
| Vite 5 + TypeScript | Build y bundling de la SPA. |
| Fabric.js 5.3 | Capa de anotaciones sobre el plano. |
| PDF.js 3.11 | Render del PDF. |
| WebSocket nativo | Colaboración en vivo (cliente y servidor, sin dependencias npm). |
| Node.js + systemd | Microservicio de colaboración. |
| nginx | Sirve los estáticos y hace de proxy hacia ORDS y el WebSocket. |
| Oracle APEX + ORDS | Portal anfitrión y API REST. |

### Estructura

```
src/main.ts                         Orquestador
src/core/pdf-renderer.ts            Render PDF.js + diagnóstico de fallos
src/core/markup-layer.ts            Anotaciones Fabric.js
src/core/collab.ts                  Cliente WebSocket
src/core/scale-manager.ts           Calibración de escala
src/config.ts                       Endpoints (VITE_*)
src/ui/icons.ts                     Iconos embebidos
src/styles/viewer.css               Tema tokenizado
server/realtime/collab-server.js    Microservicio WS
server/realtime/saf-collab.service  Unidad systemd
server/nginx-prod.conf              vhost de nginx
server/sql/ords_markup.sql          Handlers ORDS (marcas)
server/sql/ords_planos_lov.sql      Handler ORDS (listado de planos)
scripts/deploy.sh                   Despliegue
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

### 4.1 Parámetros de la URL del iframe

Alternativa al `postMessage`, útil para pruebas.

| Parámetro | Significado |
|---|---|
| `usuario_conectado` | Nombre del usuario. Alternativas: `usuario`, `user`, `nombreUsuario`. |
| `codigo_usuario` | Id numérico → `USUARIO_GRABACION`. Alternativas: `usuario_id`, `id_usuario`. |
| `repoId` | `id_en_repositorio` del PDF (sala de colaboración y clave de guardado). |
| `nombre` | `nombre_archivo` del PDF. |
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
| `openPDF` | `repoId` o `pdfUrl`, `docId`, `name` | Abrir un plano sin tocar la identidad. |
| `setLinkTarget` | `repoId`, `name`, `file` | Respuesta de APEX al selector "elegir plano destino" de un hipervínculo. |

`codigo_proyecto` y `P0_PERMISO_COLABORADOR` se aplican desde **cualquier** mensaje, no solo desde `init`.

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
| `GET planos-hub/documento` | Devuelve el PDF (BLOB). El `id` y el `nombre` van como **HTTP HEADERS**, no en la URL. |
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

Esta es la confusión más cara del proyecto, porque el nombre de los archivos engaña:

| Módulo | Transporte | Qué hace |
|---|---|---|
| `core/collab.ts` | WebSocket | **Solo efímero**: cursores, deltas en vivo, presencia, difusión inmediata de la escala. No persiste nada. |
| `features/collab-sync.ts` | HTTP → ORDS | **La capa de persistencia**: `saveNow`, `saveScaleNow`, `saveObjectsNow`, `loadFromServer`. Pese al nombre, es lo que hace que las marcas y la escala sobrevivan. |

Consecuencia práctica: **la calibración de escala no depende del WebSocket**. Al calibrar se disparan dos caminos independientes — `broadcastScale()` por WebSocket (para quien esté mirando ahora) y `saveScaleNow()` por HTTP contra ORDS (lo que la hace perdurar). Al abrir un plano, la escala se restaura desde ORDS.

Con el flag apagado se pierde solo: cursores ajenos, ver marcas de otros mientras dibujan, propagación instantánea de la escala y el panel de colaboradores. Se conserva todo lo persistente.

**Si algún día se decide eliminar la colaboración, NO se debe borrar `collab-sync.ts`**: dejaría el visor sin guardado ni carga. Lo que se quitaría es `core/collab.ts`, el microservicio y el `location /rt/` de nginx.

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

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

El vhost completo está en `server/nginx-prod.conf`.

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

### 10.2 Otros síntomas

| Síntoma | Causa / Solución |
|---|---|
| El visor se queda vacío, sin ningún error | Los orígenes no están emparejados (§4.3). Revisa `VISOR_ORIGIN` en APEX y `VITE_APEX_ORIGIN` en el visor. |
| El `init` nunca llega | `frame.src` se asignó el mismo valor que ya tenía: el iframe no recarga y el evento `load` no se dispara. Usa el `?t=` con timestamp. |
| `USUARIO_GRABACION` llega 0 | `codigo_usuario` no llegó. Pásalo por la URL o por `postMessage`. |
| Se sirve una versión vieja | `WEB_ROOT` equivocado, o caché del navegador (Ctrl+Shift+R). |
| `saf-collab` no arranca | `ssh ... 'journalctl -u saf-collab -n 30 --no-pager'` |
| Puerto 3100 ocupado (EADDRINUSE) | Proceso node huérfano: matarlo y reiniciar el servicio. |
| Pide la contraseña varias veces | Multiplexación SSH (`ControlPath` en `~/.ssh`). |
| `npm run typecheck` falla | Conocido y preexistente: `markup-layer.ts` y `main.ts` son JavaScript en archivos `.ts` sin campos de clase declarados. No bloquea el build. |
