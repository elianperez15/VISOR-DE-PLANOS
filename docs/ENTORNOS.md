# Entornos: desarrollo y producción

Dos entornos sobre **el mismo servidor** (`192.168.50.163`) y, por ahora, bajo
**el mismo nombre DNS**. Se separan en cinco planos: rama de git, modo de build,
puerto+vhost de nginx, carpeta y servicio systemd.

|                     | Desarrollo                        | Producción                    |
|---------------------|-----------------------------------|-------------------------------|
| Rama de git         | `develop`                         | `main`                        |
| Archivo de entorno  | `.env.development`                | `.env.production`             |
| Build               | `npm run build:dev`               | `npm run build:prod`          |
| Despliegue          | `npm run deploy:dev`              | `npm run deploy:prod`         |
| URL                 | `planos.aicsacorp.com:8443`       | `planos.aicsacorp.com`        |
| Puerto nginx        | `8443`                            | `443` (`default_server`)      |
| Web root (nginx)    | `/usr/share/nginx/html/planos-dev`| `/usr/share/nginx/html/planos`|
| vhost               | `server/nginx-dev.conf`           | `server/nginx-prod.conf`      |
| ORDS (proxy nginx)  | `dev.aicsacorp.com`               | `prod.aicsacorp.com`          |
| Servicio colab.     | `saf-collab-dev` (puerto 3101)    | `saf-collab` (puerto 3100)    |
| Origen APEX         | `dev.aicsacorp.com`               | `saf.aicsacorp.com`           |

## Por qué los separa el puerto y no el nombre

nginx elige el vhost comparando el header `Host` contra `server_name`. **Dos
`server {}` con el mismo `server_name` en el mismo `listen` son un conflicto**:
nginx arranca igual, avisa `conflicting server name "..." ignored` y sirve
siempre el primero que carga (`conf.d/*.conf` se lee en orden alfabético, así
que ganaría `default.conf` y el vhost de dev quedaría muerto **sin que nada
falle de forma visible**).

Con puertos distintos son sockets distintos y no hay ambigüedad posible.

Esto no obliga a tocar el frontend: el visor usa rutas relativas (`/ords/safws`)
y `window.location.origin` para el WebSocket, y **el origin incluye el puerto**.
Desde `https://planos.aicsacorp.com:8443`, `/ords/` y `/rt/ws` resuelven solos
contra `:8443`. El código es idéntico en ambos entornos.

### Cuando tengas DNS propio para dev

Migrar es un cambio de dos líneas en `server/nginx-dev.conf`:

```nginx
listen 443 ssl;                          # en vez de 8443
server_name planos-dev.aicsacorp.com;    # en vez de planos.aicsacorp.com
```

Más `COLLAB_ORIGINS=https://planos-dev.aicsacorp.com` (sin puerto) en
`saf-collab-dev.service` y `DEV_URL` en `scripts/deploy.sh`. El certificado
wildcard `*.aicsacorp.com` ya cubre ese nombre.

## Principio de diseño

El bundle **no lleva dominios quemados**. `VITE_ORDS_BASE` es la ruta relativa
`/ords/safws` en ambos entornos, y es *nginx* quien decide a qué ORDS reenvía.
Consecuencia práctica: si mañana mueven el ORDS de producción, se cambia el
`proxy_pass` del vhost y se recarga nginx — **no hay que recompilar ni redesplegar
el visor**.

Lo único que sí cambia entre builds es `VITE_APEX_ORIGIN` (el origen del portal
APEX que se acepta en `postMessage`), y por eso existen los dos `.env`.

---

## Flujo de trabajo diario

### 1. Cambiar algo y probarlo en desarrollo

```bash
git checkout develop
# ...editas código...
npm run typecheck                 # opcional pero recomendado
git add -A && git commit -m "feat: descripción del cambio"
git push origin develop

bash scripts/deploy.sh dev        # compila en modo development y sube a dev
```

Verificas en `https://planos.aicsacorp.com:8443`. Si algo falla, repites el ciclo:
producción **no se entera de nada**, porque vive en otra carpeta y otro vhost.

### 2. Promover a producción

Cuando lo de `develop` ya está validado:

```bash
git checkout main
git merge --no-ff develop -m "release: v1.1.0"
git tag -a v1.1.0 -m "Descripción de lo que entra en esta versión"
git push origin main --tags

bash scripts/deploy.sh prod       # pide escribir PRODUCCION para confirmar
git checkout develop              # vuelves a la rama de trabajo
```

El `--no-ff` deja un commit de merge explícito: en el historial de `main` se ve
cada release como un solo punto, no como 20 commits sueltos.

### 3. Volver atrás si un release sale mal

```bash
git checkout main
git reset --hard v1.0.0           # el tag de la versión anterior que sí servía
bash scripts/deploy.sh prod
```

Y luego arreglas con calma en `develop`. Por eso los tags importan: sin ellos no
hay a dónde volver.

### 4. Arreglo urgente en producción (hotfix)

Cuando no puedes esperar al ciclo normal:

```bash
git checkout main
git checkout -b hotfix/descripcion
# ...arreglas...
git commit -am "fix: descripción"
git checkout main && git merge --no-ff hotfix/descripcion
git tag -a v1.1.1 -m "hotfix: descripción"
git push origin main --tags
bash scripts/deploy.sh prod

# IMPORTANTE: devolver el arreglo a develop para no perderlo en el próximo release
git checkout develop && git merge main && git push origin develop
```

---

## Protecciones del script de despliegue

`scripts/deploy.sh` **no** te deja meter la pata en silencio:

- Exige el entorno como argumento (`dev` o `prod`); sin él, no hace nada.
- Avisa si la rama actual no es la esperada para ese entorno.
- Avisa si hay cambios sin commitear (lo desplegado no coincidiría con el commit).
- Para producción, exige escribir literalmente `PRODUCCION`.
- Borra `dist/` antes de compilar, para no arrastrar assets del entorno anterior.
- Imprime el commit desplegado al terminar: así sabes siempre qué hay en cada URL.

---

## Puesta en marcha (una sola vez, del lado servidor)

El entorno de producción ya existe físicamente — es el que hoy está en
`/usr/share/nginx/html/planos`. Lo que hay que crear es el de **desarrollo**.

```bash
ssh adminsafvsp@192.168.50.163

# 1. Carpetas del entorno dev
sudo mkdir -p /usr/share/nginx/html/planos-dev
sudo mkdir -p /var/www/saf/planos-dev/server/realtime
sudo chown -R planos:planos /var/www/saf/planos-dev
```

```bash
# 2. Abrir el puerto 8443 en el firewall del servidor
sudo firewall-cmd --permanent --add-port=8443/tcp
sudo firewall-cmd --reload
```

No hace falta DNS nuevo: dev reutiliza `planos.aicsacorp.com` en el puerto 8443,
y el certificado wildcard ya lo cubre porque es el mismo nombre.

Si el tráfico pasa por el **proxy de Cloudflare** (nube naranja), 8443 está en la
lista de puertos HTTPS que Cloudflare sí proxea (443, 2053, 2083, 2087, 2096,
8443). Si el acceso es interno o la nube está en gris, no hay nada que revisar.

Desde tu Mac, copia las configuraciones y actívalas:

```bash
scp server/nginx-dev.conf server/nginx-prod.conf \
    server/realtime/saf-collab-dev.service server/realtime/saf-collab.service \
    adminsafvsp@192.168.50.163:/tmp/

ssh adminsafvsp@192.168.50.163 '
  sudo cp /tmp/nginx-dev.conf   /etc/nginx/conf.d/planos-dev.conf
  sudo cp /tmp/nginx-prod.conf  /etc/nginx/conf.d/default.conf
  sudo cp /tmp/saf-collab-dev.service /tmp/saf-collab.service /etc/systemd/system/
  sudo systemctl daemon-reload
  sudo systemctl enable --now saf-collab-dev
  sudo systemctl restart saf-collab
  sudo nginx -t && sudo systemctl reload nginx
'
```

Y ya puedes desplegar los dos entornos:

```bash
git checkout develop && npm run deploy:dev    # → https://planos.aicsacorp.com:8443
git checkout main    && npm run deploy:prod   # → https://planos.aicsacorp.com
```

### Antes de recargar nginx, verifica

1. **El ORDS de producción.** El vhost estaba reenviando `/ords/` a
   `dev.aicsacorp.com` — es decir, producción consumía datos de desarrollo.
   `server/nginx-prod.conf` ahora apunta a `prod.aicsacorp.com` (el valor que
   documenta `.env.example`); **confirma con el DBA** que es el host correcto.
2. **El nombre de host de producción.** El vhost pasó de `server_name _` a
   `server_name planos.aicsacorp.com`, conservando `default_server` para que las
   peticiones por IP sigan cayendo ahí.
3. **Que `nginx -t` no reporte `conflicting server name`.** Si aparece, es que
   los dos vhosts acabaron en el mismo puerto: revisa que dev tenga `listen 8443`.

---

## Desarrollo local (`npm run dev`)

`npm run dev` levanta Vite en `http://127.0.0.1:8080` con `.env.development`, que
usa `VITE_ORDS_BASE=/ords/safws` — una ruta relativa que en local **no existe**,
porque ahí no hay nginx delante. Dos salidas:

- Apuntar al ORDS de dev creando un `.env.local` (ignorado por git, es solo tuyo):
  ```
  VITE_ORDS_BASE=https://dev.aicsacorp.com/ords/safws
  ```
  Requiere que ese ORDS acepte CORS desde `http://127.0.0.1:8080`.
- O añadir un `server.proxy` en `vite.config.ts` que replique lo que hace nginx.

Para la mayoría del trabajo diario basta con `deploy.sh dev`.
