#!/usr/bin/env bash
# SAF Planos — descarga librerías locales (sin npm)
# Ejecutar una sola vez: bash download-libs.sh

set -e
mkdir -p lib
echo "📦 Descargando Fabric.js v5.3.0..."
curl -L -o lib/fabric.min.js \
  "https://cdnjs.cloudflare.com/ajax/libs/fabric.js/5.3.0/fabric.min.js"

echo "📦 Descargando PDF.js v3.11.174..."
curl -L -o lib/pdf.min.js \
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"
curl -L -o lib/pdf.worker.min.js \
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"

echo "✅ Listo. Archivos en lib/"
ls -lh lib/
