# ============================================
# security-headers.inc — cabeceras de seguridad comunes
# ============================================
# Va en: /etc/nginx/conf.d/security-headers.inc
# Se incluye con `include /etc/nginx/conf.d/security-headers.inc;` en el
# server y en cada location que necesite las cabeceras.
#
# ¿Por qué repetirlo en cada location?
#   En nginx, si una location define SU PROPIO add_header, deja de heredar
#   los add_header del bloque padre. Por eso el snippet se incluye en cada
#   location que añade sus propias cabeceras (cache, CORS, etc.).
#
# Se usa "always" para que las cabeceras se envíen también en respuestas de
# error (4xx/5xx), no solo en 2xx/3xx.
#
# NOTA: la cabecera HSTS (Strict-Transport-Security) NO va aquí; se define
# solo en el server :443, porque no tiene sentido (y puede confundir) sobre
# HTTP plano. Cloudflare también puede gestionar HSTS desde su panel.

# Evita que el navegador "adivine" el MIME type (anti MIME-sniffing).
add_header X-Content-Type-Options "nosniff" always;

# Anti clickjacking: lo cubre frame-ancestors de la CSP (abajo).
# X-Frame-Options NO sirve aquí: SAMEORIGIN impediría que APEX (otro dominio)
# embeba el visor, y no admite una lista de dominios permitidos.
#add_header X-Frame-Options "SAMEORIGIN" always;

# Controla cuánta info de referer se envía a otros sitios.
add_header Referrer-Policy "strict-origin-when-cross-origin" always;

# Restringe APIs sensibles del navegador (el visor no usa ninguna).
add_header Permissions-Policy "geolocation=(), microphone=(), camera=(), payment=(), usb=()" always;

# ============================================
# Content-Security-Policy (CSP) — ajustada al visor y PROBADA con los dos
# visores (planos 2D y modelo 3D): sin violaciones.
# ============================================
#   script-src 'wasm-unsafe-eval'  el lector de IFC (web-ifc) es WebAssembly.
#                                  Sin 'unsafe-eval': además bloquea el ataque
#                                  de PDFs maliciosos contra pdf.js (CVE-2024-4367).
#   worker-src blob:               pdf.js y That Open crean workers.
#   img/connect data: blob:        imágenes del plano, adjuntos, descargas.
#   style-src 'unsafe-inline'      atributos style="" del HTML del visor.
#   frame-ancestors                SÓLO APEX puede embeber el visor. Si APEX se
#                                  sirve desde otro dominio, agregarlo aquí o el
#                                  iframe quedará en blanco.
add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self' data: blob:; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; media-src 'self' data: blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-src 'self'; frame-ancestors https://dev.aicsacorp.com https://saf.aicsacorp.com" always;

# ============================================
# Source maps: nunca se sirven (con ellos, DevTools muestra el código original
# y la estructura de carpetas). deploy.sh ya no los sube; esto es la segunda
# barrera por si alguno se sube por error.
# ============================================
if ($uri ~* \.map$) {
    return 404;
}
