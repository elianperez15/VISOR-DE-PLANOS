# SAF Visor de Planos — Fabric.js + PDF.js
## Guía de Instalación en Linux

---

## Requisitos

- Nginx (o cualquier servidor HTTP estático)
- `curl` para descargar librerías
- Acceso a internet la primera vez (solo para descargar las librerías)

No requiere Node.js, npm, ni build step para el frontend.

---

## Estructura del proyecto

```
planos-fabricjs/
├── index.html                  ← punto de entrada (carga /src/main.ts)
├── package.json · vite.config.ts · tsconfig.json
├── src/                        ← código frontend (TypeScript, bundled por Vite)
│   ├── main.ts                 ← orquestador: UI, eventos, integración
│   ├── core/                   ← motor del visor
│   │   ├── pdf-renderer.ts     ← renderizado PDF.js
│   │   ├── markup-layer.ts     ← herramientas de anotación (Fabric.js)
│   │   └── scale-manager.ts    ← calibración de escala y medidas
│   ├── data/                   ← persistencia y serialización
│   │   ├── storage.ts          ← localStorage / API REST
│   │   └── xfdf.ts             ← serializar/deserializar XFDF
│   ├── ui/
│   │   └── icons.ts            ← iconos line-style embebidos (sin CDN)
│   ├── styles/
│   │   └── viewer.css          ← estilos (importado por main.ts)
│   └── vite-env.d.ts
├── server/                     ← backend Node/Express + Oracle (CommonJS)
│   ├── routes/
│   │   ├── markup.js           ← rutas REST markup Fabric.js (Oracle)
│   │   └── xfdf.js             ← rutas REST XFDF (disco + Oracle)
│   ├── xfdf-store.js           ← almacenamiento XFDF (disco + Oracle)
│   └── sql/
│       └── saf_planos_fabricjs.sql  ← schema Oracle completo
├── public/                     ← assets estáticos servidos tal cual
├── scripts/
│   └── download-libs.sh
└── docs/                       ← CONSIDERACIONES · FABRIC · INSTALACION
```

> **Build:** `npm run build` genera `dist/` (HTML + JS + CSS con hash, listo
> para servir estáticamente). En desarrollo, `npm run dev` levanta Vite con HMR.

---

## Paso 1 — Copiar archivos al servidor

```bash
rsync -avz --progress \
  /Users/carlosramirez/Projects/saf/planos-fabricjs/ \
  usuario@servidor:/var/www/saf/planos/

# O con scp
scp -r /Users/carlosramirez/Projects/saf/planos-fabricjs/ \
    usuario@servidor:/var/www/saf/planos/
```

---

## Paso 2 — Descargar librerías

```bash
cd /var/www/saf/planos/
bash download-libs.sh
```

Descarga en `lib/`:
- `fabric.min.js` (Fabric.js v5.3.0, MIT)
- `pdf.min.js` (PDF.js v3, Apache 2.0)
- `pdf.worker.min.js`

> ⚠️ Sin internet en el servidor:
> ```bash
> bash download-libs.sh   # en local
> scp lib/*.js usuario@servidor:/var/www/saf/planos/lib/
> ```

---

## Paso 3 — Configurar Nginx

```nginx
server {
    listen 80;
    server_name planos.tudominio.com;

    root /var/www/saf/planos;
    index index.html;

    location / {
        try_files $uri $uri/ =404;

        # Requerido para PDF.js Worker
        add_header Cross-Origin-Opener-Policy   "same-origin";
        add_header Cross-Origin-Embedder-Policy "require-corp";

        location ~* \.(js|css)$ {
            expires 7d;
            add_header Cache-Control "public, immutable";
        }
    }

    # PDFs servidos desde el mismo servidor
    location /pdfs/ {
        alias /var/www/saf/pdfs/;
        add_header Access-Control-Allow-Origin "*";
    }

    # Proxy inverso para la API Node.js (markup + XFDF)
    location /api/ {
        proxy_pass         http://127.0.0.1:3000;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        client_max_body_size 10m;   # XFDF/JSON grandes
    }
}
```

```bash
nginx -t && systemctl reload nginx
```

---

## Paso 4 — Verificar (solo frontend)

Abre en el navegador: `http://planos.tudominio.com`

Deberías ver la pantalla inicial con el botón "Abrir PDF".
Las anotaciones se guardan en **localStorage** hasta activar la API.

---

## Paso 5 — Activar Oracle + API Node.js

### 5.1 — Ejecutar el schema SQL

```bash
sqlplus saf/password@SAFDB @server/sql/saf_planos_fabricjs.sql
```

Crea:
- `SAF_PLANO_DOCS` — registro de documentos PDF
- `SAF_PLANO_MARKUP` — markup Fabric.js por página (CLOB JSON)
- `SAF_PLANO_MARKUP_XFDF` — archivo XFDF completo por documento (CLOB XML)
- `PKG_PLANO_MARKUP` — package PL/SQL con `GUARDAR_MARKUP`, `OBTENER_SESION`,
  `GUARDAR_XFDF`, `OBTENER_XFDF`, `ELIMINAR_XFDF`

### 5.2 — Crear el directorio XFDF en disco

```bash
mkdir -p /var/www/saf/xfdf
chown www-data:www-data /var/www/saf/xfdf   # o el usuario de Node.js
chmod 755 /var/www/saf/xfdf
```

### 5.3 — Configurar variables de entorno

```bash
# /etc/saf/planos.env  (o en tu systemd unit)
ORACLE_USER=saf
ORACLE_PASSWORD=tu_password
ORACLE_CONNSTR=localhost/SAFDB

XFDF_DIR=/var/www/saf/xfdf    # directorio de archivos XFDF en disco
XFDF_USE_DB=true               # false para omitir Oracle y usar solo disco
```

### 5.4 — Montar las rutas en Express

```javascript
// server.js
const express     = require('express');
const app         = express();

// Body parsers — ANTES de montar las rutas
app.use(express.json({ limit: '10mb' }));

// Parsear XML crudo para PUT /api/xfdf/:docId (Content-Type: application/xml)
app.use('/api/xfdf', require('express').text({ type: ['application/xml','text/xml'], limit: '10mb' }));

// Rutas
const markupRouter = require('./api/markup');
const xfdfRouter   = require('./api/xfdf');

app.use('/api/markup', markupRouter);
app.use('/api/xfdf',   xfdfRouter);

app.listen(3000, () => console.log('SAF API corriendo en :3000'));
```

### 5.5 — Activar la API en el frontend

En `js/storage.js` cambiar:

```javascript
const USE_API = true;        // ← de false a true
const API_BASE = '/api/markup';
```

---

## Paso 6 — API XFDF (referencia rápida)

| Método | Ruta                       | Descripción |
|--------|----------------------------|-------------|
| GET    | `/api/xfdf/:docId`         | Descargar el XFDF XML del documento |
| PUT    | `/api/xfdf/:docId`         | Guardar/reemplazar el XFDF (XML crudo o JSON `{xfdfContent}`) |
| DELETE | `/api/xfdf/:docId`         | Eliminar XFDF de disco y Oracle |
| GET    | `/api/xfdf/:docId/meta`    | Metadata: ¿existe?, fecha, usuario (sin CLOB) |

### Ejemplos cURL

```bash
# Verificar si existe XFDF para documento 42
curl http://localhost:3000/api/xfdf/42/meta

# Descargar XFDF
curl http://localhost:3000/api/xfdf/42 -o plano-42.xfdf

# Subir XFDF (XML crudo)
curl -X PUT http://localhost:3000/api/xfdf/42 \
  -H "Content-Type: application/xml" \
  --data-binary @plano-42.xfdf

# Subir XFDF (JSON)
curl -X PUT http://localhost:3000/api/xfdf/42 \
  -H "Content-Type: application/json" \
  -d '{"xfdfContent": "<?xml version...", "usuario": "jperez"}'

# Eliminar XFDF
curl -X DELETE http://localhost:3000/api/xfdf/42
```

### Flujo típico de uso

```
Usuario A abre plano-42.pdf → anota → [📄 XFDF] → PUT /api/xfdf/42
Usuario B abre plano-42.pdf → visor hace GET /api/xfdf/42/meta → existe
                             → visor hace GET /api/xfdf/42 → carga .xfdf
                             → XFDFConverter.fromXFDF() pinta markup sobre PDF
```

---

## Integración en Oracle APEX

```html
<!-- Región Static Content en APEX -->
<iframe
  src="https://planos.tudominio.com"
  style="width:100%; height:calc(100vh - 120px); border:none;"
  allow="fullscreen"
></iframe>
```

Pasar parámetros desde APEX con PostMessage:

```javascript
// Dynamic Action en APEX
const iframe = document.querySelector('iframe[src*="planos"]');
iframe.contentWindow.postMessage({
  action : 'openPDF',
  pdfUrl : '/pdfs/plano-123.pdf',
  docId  : 123
}, '*');
```

El visor escucha el mensaje, descarga el PDF y automáticamente
intenta cargar el XFDF desde `/api/xfdf/123` si está configurado.

---

## Actualizar la aplicación

```bash
# Solo archivos JS/CSS (no sobreescribir lib/ ni sql/)
rsync -avz --progress --exclude='lib/' --exclude='sql/' \
  /Users/carlosramirez/Projects/saf/planos-fabricjs/ \
  usuario@servidor:/var/www/saf/planos/
```

---

## Herramientas disponibles

### Selección y vista

| Herramienta   | Tecla | Descripción |
|---------------|-------|-------------|
| Seleccionar   | `V`   | Mover, redimensionar y editar objetos |
| Mover vista   | `H`   | Arrastrar el plano con el cursor |
| Borrador      | `E`   | Clic en un objeto para eliminarlo |

### Anotaciones

| Herramienta   | Tecla | Descripción |
|---------------|-------|-------------|
| Flecha        | `A`   | Flecha de señalización con punta |
| Rectángulo    | `R`   | Área rectangular con trazo y relleno |
| Elipse        | `O`   | Círculo / elipse |
| Resaltado     | —     | Rectángulo semitransparente amarillo |
| Dibujo libre  | `D`   | Trazo a mano alzada |
| Nube          | —     | Nube de revisión (multi-clic + Enter) |
| Texto         | `T`   | Texto editable directamente en el plano |
| Nota post-it  | `N`   | Nota amarilla con texto |
| Globo/Callout | `C`   | Bocadillo con flecha y texto |
| Sello         | —     | APROBADO / RECHAZADO / NCI / RFI / ... |

### Medición (requiere calibración de escala)

| Herramienta   | Tecla | Descripción |
|---------------|-------|-------------|
| Cota          | —     | Línea con distancia real etiquetada |
| Ángulo        | —     | 3 clics: vértice + 2 brazos → ángulo en grados |
| Área          | —     | Polígono cerrado con área calculada (Enter cierra) |
| Perímetro     | —     | Polilínea con longitud total (Enter cierra) |

### Acciones globales

| Acción        | Tecla      | Descripción |
|---------------|------------|-------------|
| Deshacer      | `Ctrl+Z`   | Revertir última acción |
| Rehacer       | `Ctrl+Y`   | Reaplicar acción deshecha |
| Ajustar vista | `F`        | Centrar y escalar el plano a pantalla |
| Calibrar      | —          | Definir escala real (2 puntos de referencia) |

### Formatos de guardado

| Formato | Botón    | Descripción |
|---------|----------|-------------|
| JSON    | 💾 JSON  | Sesión interna Fabric.js (exacta, propietaria) |
| XFDF    | 📄 XFDF  | Adobe XFDF portable — abre en Acrobat, Bluebeam, etc. |

---

## Licencias

- **Fabric.js v5**: MIT — libre para uso comercial y producción
- **PDF.js v3**: Apache 2.0 — libre para uso comercial y producción
- Sin costo de licencia, sin servidor externo, sin telemetría
