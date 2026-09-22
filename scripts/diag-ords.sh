#!/usr/bin/env bash
#
# diag-ords.sh — Diagnostica por qué el visor no carga un PDF.
#
# pdf.js hace el fetch por dentro y solo devuelve "Invalid PDF structure",
# ocultando el HTTP real. Este script hace la MISMA petición que hace el visor
# y te enseña lo que pdf.js no te enseña: status, Content-Type y primeros bytes.
#
#   Uso:  bash scripts/diag-ords.sh <ID_EN_REPOSITORIO> [NOMBRE] [ORIGEN]
#
#   ej.   bash scripts/diag-ords.sh 12345
#         bash scripts/diag-ords.sh 12345 plano.pdf https://planos.aicsacorp.com
#
set -uo pipefail

ID="${1:-}"
NOMBRE="${2:-plano.pdf}"
ORIGEN="${3:-https://planos.aicsacorp.com}"

[ -n "${ID}" ] || { echo "✗ Falta el ID_EN_REPOSITORIO."; echo "  Uso: bash scripts/diag-ords.sh <id> [nombre] [origen]"; exit 2; }

URL="${ORIGEN}/ords/safws/Reportes/planos-hub/documento"
OUT="$(mktemp)"
HDR="$(mktemp)"
trap 'rm -f "${OUT}" "${HDR}"' EXIT

echo "▶ GET ${URL}"
echo "   headers:  id: ${ID}   nombre: ${NOMBRE}"
echo "────────────────────────────────────────────────"

# curl ya imprime 000 si no hubo respuesta; un `|| echo 000` duplicaría el valor.
CODE=$(curl -s -o "${OUT}" -D "${HDR}" -w '%{http_code}' \
         -H "id: ${ID}" -H "nombre: ${NOMBRE}" "${URL}")

SIZE=$(wc -c < "${OUT}" | tr -d ' ')
CTYPE=$(grep -i '^content-type:' "${HDR}" | tail -1 | tr -d '\r' || true)
MAGIC=$(head -c 8 "${OUT}" | tr -d '\0')

echo "  HTTP status  : ${CODE}"
echo "  ${CTYPE:-content-type: <ausente>}"
echo "  Tamaño       : ${SIZE} bytes"
echo "  Primeros byt.: ${MAGIC}"
echo "────────────────────────────────────────────────"

if [ "${CODE}" = "000" ]; then
  echo "✗ No hubo respuesta. El host no resuelve, no responde o el TLS falló."
  echo "  → Revisa el proxy_pass de location /ords/ en el vhost de nginx."
  exit 1
fi

case "${MAGIC}" in
  %PDF*)
    echo "✅ Es un PDF válido (${SIZE} bytes). El problema NO está en ORDS."
    echo "   → Si el visor igual falla, mira la consola del navegador:"
    echo "     probablemente sea el worker de pdf.js o los headers COOP/COEP."
    exit 0
    ;;
esac

echo "✗ La respuesta NO es un PDF. Esto es lo que devolvió el servidor:"
echo "────────────────────────────────────────────────"
head -c 600 "${OUT}"; echo
echo "────────────────────────────────────────────────"

if [ "${CODE}" = "200" ]; then
  echo "⚠️  Status 200 con cuerpo que no es PDF → esto es justo lo que pdf.js"
  echo "    reporta como 'Invalid PDF structure'. Causas típicas:"
  echo "      · nginx reenvía /ords/ al HOST equivocado (¿dev vs prod?)"
  echo "        → grep -A3 'location /ords/' /etc/nginx/conf.d/default.conf"
  echo "      · ORDS devolvió un login/error de APEX en vez del BLOB"
  echo "      · el handler recibió :id NULL → nginx comió el header"
  echo "        → comprueba 'underscores_in_headers on;' en el server{}"
  echo "      · ese ID no existe en la BD de ESTE entorno (dev≠prod)"
elif [ "${CODE}" = "404" ]; then
  echo "⚠️  404 → el módulo/endpoint ORDS no está publicado en este entorno."
elif [ "${CODE}" = "401" ] || [ "${CODE}" = "403" ]; then
  echo "⚠️  ${CODE} → ORDS pide autenticación. El handler no es público aquí."
elif [ "${CODE}" = "502" ] || [ "${CODE}" = "504" ]; then
  echo "⚠️  ${CODE} → nginx no logró hablar con el upstream de ORDS."
fi
exit 1
