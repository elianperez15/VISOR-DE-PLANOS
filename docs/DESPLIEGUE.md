# Despliegue

Hay **un solo entorno**: producción. El visor se compila en la Mac y se copia al
servidor por SSH.

| | |
|---|---|
| Rama | `main` |
| Variables | `.env.production` |
| Origen APEX | **`dev.aicsacorp.com`** (temporal) |
| Build | `npm run build` |
| Despliegue | `npm run deploy` |
| URL | `https://planos.aicsacorp.com` |
| Servidor | `adminsafvsp@192.168.50.163` |
| Web root | `/usr/share/nginx/html/planos` |
| vhost | `server/nginx-prod.conf` → `/etc/nginx/conf.d/default.conf` |
| ORDS (proxy nginx) | `$ords_upstream` → **`dev.aicsacorp.com`** (temporal) |
| Colaboración | `saf-collab` (systemd, puerto 3100) — **desactivada en el cliente** |

## Desplegar

```bash
git commit -am "descripción del cambio"
npm run deploy
```

El script conecta por SSH, verifica que las carpetas destino existan, compila,
copia `dist/` y `collab-server.js`, reinicia `saf-collab` y comprueba su health.
Avisa si hay cambios sin commitear y pide confirmación antes de tocar nada. Al
terminar imprime el commit desplegado, para que siempre sepas qué hay arriba.

## Volver atrás

```bash
git log --oneline -10      # localiza el commit que sí servía
git reset --hard <commit>
npm run deploy
```

Conviene etiquetar los despliegues buenos para no tener que buscar el hash:

```bash
git tag -a v1.0.0 -m "descripción"
git push origin main --tags
```

---

## Los tres hostnames

Es la fuente de confusión más común de este proyecto. Son papeles distintos:

| Host | Papel | Dónde se configura |
|---|---|---|
| `planos.aicsacorp.com` | Donde vive **el visor** | vhost de nginx |
| `saf.aicsacorp.com` | Donde vive **ORDS/APEX** — de aquí salen los PDFs | `proxy_pass` de `location /ords/` |
| `saf.aicsacorp.com` | El **portal APEX** que embebe el visor en un iframe | `VITE_APEX_ORIGIN` |

Los dos últimos son el mismo host **y tienen que serlo**: APEX corre sobre ORDS,
y es APEX quien manda los `id_en_repositorio` al visor por `postMessage`. Si
nginx reenviara `/ords/` a otro ORDS, estarías buscando IDs de una base dentro
de otra: unos no existirían y otros devolverían el plano equivocado.

`VITE_APEX_ORIGIN` **no** sirve para traer planos; solo valida el origen del
`postMessage` por seguridad.

### Cómo averiguar el host de ORDS

Abre la página de APEX que embebe el visor y mira la barra de direcciones: ese
hostname es tu ORDS, porque APEX se sirve como `https://<host>/ords/r/...` y los
servicios REST como `https://<host>/ords/safws/...` en ese mismo host.

Para comprobarlo sin dudas:

```bash
for H in saf.aicsacorp.com dev.aicsacorp.com; do
  printf "%-22s " "$H"
  curl -s -o /dev/null -m 8 -w "%{http_code}  %{content_type}\n" \
    -H "id: 12345" -H "nombre: plano.pdf" \
    "https://$H/ords/safws/Reportes/planos-hub/documento"
done
```

El que devuelva `200  application/pdf` es el correcto.

### Cambiar de entorno: SIEMPRE son dos cambios

Apuntar a otro entorno toca **dos sitios distintos**, y hacer solo uno deja el
visor buscando IDs de una base dentro de la otra:

| | Dónde | Efecto | ¿Redespliegue? |
|---|---|---|---|
| **1. De dónde salen los planos** | `set $ords_upstream` en nginx | Cambia la base de datos | No — `nginx -t && reload` |
| **2. Quién puede hablarle al visor** | `VITE_APEX_ORIGIN` en `.env.production` | Valida el `postMessage` de APEX | **Sí** — `npm run deploy` |

Si solo cambias el 2 y no el 1, verás planos equivocados o "Invalid PDF
structure". Si solo cambias el 1 y no el 2, **no pasará nada en absoluto**: el
visor descarta en silencio el mensaje de APEX y nunca recibe el ID del plano.
Ese segundo síntoma despista mucho porque no hay ningún error visible.

Estado actual (2026-09-22): ambos en **dev**.

Para volver a producción:

```bash
# 1. nginx, en el servidor
sudo sed -i 's/set \$ords_upstream .*/set $ords_upstream      "saf.aicsacorp.com";/' \
  /etc/nginx/conf.d/default.conf
sudo nginx -t && sudo systemctl reload nginx

# 2. el visor, desde la Mac
#    edita .env.production → VITE_APEX_ORIGIN=https://saf.aicsacorp.com
npm run deploy
```

### Cambiar de ORDS es una línea, y no requiere recompilar

`VITE_ORDS_BASE` es la ruta **relativa** `/ords/safws`. El bundle no sabe —ni
puede saber— a qué ORDS apunta: eso lo decide **solo** nginx. El bloque
`location /ords/` usa una variable, así que cambiar de entorno es editar un
único valor:

```nginx
set $ords_upstream "dev.aicsacorp.com";     # o saf.aicsacorp.com
proxy_pass         https://$ords_upstream/ords/;
proxy_set_header   Host $ords_upstream;     # la MISMA variable, para que no
                                            # puedan desincronizarse
```

Para cambiarlo en el servidor:

```bash
sudo cp /etc/nginx/conf.d/default.conf /etc/nginx/conf.d/default.conf.bak

# dev → prod  (invierte los hosts para ir en el otro sentido)
sudo sed -i 's/set \$ords_upstream .*/set $ords_upstream      "saf.aicsacorp.com";/' \
  /etc/nginx/conf.d/default.conf

sudo grep -n "ords_upstream\|Host " /etc/nginx/conf.d/default.conf   # revisa ANTES
sudo nginx -t && sudo systemctl reload nginx
```

### Saber a qué ORDS apunta ahora mismo

La respuesta no está en el código, sino en el servidor:

```bash
ssh adminsafvsp@192.168.50.163 \
  'sudo grep -n "ords_upstream" /etc/nginx/conf.d/default.conf'
```

Sin SSH, comparando hashes: el que coincida con `planos.aicsacorp.com` delata el
destino.

```bash
for H in planos.aicsacorp.com saf.aicsacorp.com dev.aicsacorp.com; do
  printf "%-24s " "$H"
  curl -s -m 10 "https://$H/ords/safws/Reportes/planos-hub/planos-listado" | md5
done
```

---

## Colaboración en vivo: apagada

`.env.production` tiene `VITE_COLLAB_ENABLED=false`, así que el visor no abre el
WebSocket: sin cursores ajenos, sin ver marcas de otros en vivo, sin panel de
colaboradores, y sin el bucle de reintentos que si no correría cada 8 segundos.

**No afecta a la persistencia.** Guardar y cargar marcas, la calibración de
escala y la rotación van por HTTP contra ORDS (`src/persistencia/markup-store.ts`),
que es independiente del WebSocket (`src/colaboracion/`).

El microservicio `saf-collab` sigue instalado y corriendo en el servidor. Para
reactivar la colaboración:

```bash
# .env.production → VITE_COLLAB_ENABLED=true
npm run deploy
```

---

## Cabeceras de seguridad (una vez, en el servidor)

`server/security-headers.inc` es el archivo del servidor (`/etc/nginx/conf.d/`)
con lo que le faltaba: la **CSP** (qué puede cargar el visor y que **sólo APEX**
pueda embeberlo) y el **404 para los `.map`**. Es autocontenido: no requiere
cambios en `nginx.conf`. HSTS sigue en el `server :443`, como antes.

```bash
sudo cp /etc/nginx/conf.d/security-headers.inc /etc/nginx/conf.d/security-headers.inc.bak
# copiar server/security-headers.inc → /etc/nginx/conf.d/security-headers.inc
sudo nginx -t && sudo systemctl reload nginx
# Comprobar
curl -sI https://planos.aicsacorp.com/ | grep -i content-security
curl -s -o /dev/null -w "%{http_code}\n" https://planos.aicsacorp.com/assets/x.js.map   # 404
```

`frame-ancestors` permite embeber el visor sólo desde `dev.aicsacorp.com` y
`saf.aicsacorp.com`. Si APEX se sirve desde otro dominio, agregarlo en la línea
`Content-Security-Policy` de security-headers.inc; si no, el iframe quedará en blanco.

---

## Source maps: no se publican

El build genera los `.map` en `dist/` (`sourcemap: 'hidden'`), pero los bundles
no los referencian y `deploy.sh` no los sube, y borra los de despliegues
anteriores. Así DevTools no muestra el código original ni las carpetas de `src/`.
Si hace falta descifrar un error de producción, los `.map` están en tu `dist/` local.

---

## Modelo 3D (IFC): una sola vez en el servidor

El visor 3D es otra página del mismo despliegue: **`https://planos.aicsacorp.com/modelo/`**
(el de planos sigue en `/`). `deploy.sh` sube las dos y el `location /` actual
(`try_files $uri $uri/ /index.html`) ya sirve `/modelo/`: no hay reglas nuevas.

El visor 3D descarga dos archivos más que hay que servir con el tipo correcto.
`deploy.sh` los sube solos (van dentro de `dist/`), pero **nginx** necesita
saber qué son. Una sola vez, en `/etc/nginx/conf.d/default.conf` (los bloques
ya están en `server/nginx-prod.conf`):

| Archivo | Content-Type | Dónde está |
|---|---|---|
| `web-ifc.wasm` | `application/wasm` | `/web-ifc/<versión>/` (lo copia `scripts/copy-web-ifc.mjs` en cada build) |
| `worker-*.mjs` | `application/javascript` | `/assets/` (nombre con hash) |

```bash
ssh adminsafvsp@192.168.50.163 'cat /etc/nginx/conf.d/security-headers.inc'
```

Si ese archivo define una `Content-Security-Policy`, añade `'wasm-unsafe-eval'`
a `script-src` y `worker-src 'self' blob:`; sin eso el navegador se niega a
compilar el WebAssembly.

Comprobar tras desplegar (el número de versión es el de `web-ifc` en `package.json`):

```bash
curl -sI https://planos.aicsacorp.com/web-ifc/0.0.77/web-ifc.wasm | grep -i content-type   # application/wasm
curl -s  https://planos.aicsacorp.com/ | grep -o '/assets/index-[^"]*\.js'                # y luego, en Network,
                                                                                          # worker-*.mjs → application/javascript
```

El modelo se pide al mismo endpoint `documento` que el PDF: el handler ORDS
debe devolver el archivo tal cual, sea del tipo que sea. Si los IFC grandes
tardan, el límite que importa es el de Cloudflare (100 s hasta el primer byte).

---

## Diagnosticar "no carga el PDF"

`pdf.js` hace el fetch por dentro y solo devuelve su propio mensaje, ocultando el
HTTP real. Los mensajes significan cosas muy distintas:

| Mensaje | Qué pasó de verdad |
|---|---|
| `Invalid PDF structure` | HTTP **200** con un cuerpo que no es PDF (HTML de login, JSON de error) |
| `UnexpectedResponseException: 404` | El endpoint no existe en ese ORDS |
| `Missing PDF` | No llegó respuesta |

Para ver lo que pdf.js esconde — status, `Content-Type` y primeros bytes:

```bash
bash scripts/diag-ords.sh <ID_EN_REPOSITORIO>
```

Un PDF real empieza con `%PDF-`. Si sale otra cosa, el script imprime el cuerpo
de la respuesta, que suele contener la explicación literal.

Causas frecuentes de un 200 que no es PDF:

- nginx reenvía `/ords/` al host equivocado.
- Falta `underscores_in_headers on;` en el `server {}`: el `id` viaja como header
  HTTP, y si nginx lo descarta el handler recibe `:id` NULL y devuelve un cuerpo
  vacío **con status 200**.
- Ese ID no existe en la base de ese ORDS.

---

## Permisos en el servidor

`/usr/share/nginx/html` y `/var/www` son de **root**. Si el usuario SSH no puede
escribir en el destino, rsync falla con `mkdir ... Permission denied (13)`.
`deploy.sh` lo detecta antes de compilar y te imprime los comandos para crearla.

En Oracle Linux, además de los permisos POSIX hace falta el contexto SELinux
correcto — sin él nginx devuelve **403 aunque `ls -l` se vea perfecto**:

```bash
sudo restorecon -Rv /usr/share/nginx/html/planos
```

---

## Desarrollo local (`npm run dev`)

Levanta Vite en `http://127.0.0.1:8080`. Sin nginx delante, la ruta relativa
`/ords/safws` no resuelve. Si necesitas datos reales, crea un `.env.local`
(ignorado por git, es solo tuyo):

```
VITE_ORDS_BASE=https://saf.aicsacorp.com/ords/safws
```

Requiere que ese ORDS acepte CORS desde `http://127.0.0.1:8080`.

## Nota: `npm run typecheck`

Pasa sin errores. Vite no hace typecheck al compilar, así que conviene
correrlo antes de desplegar: `npm run typecheck && npm run deploy`.
