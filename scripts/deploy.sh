#!/usr/bin/env bash
#
# deploy.sh — Despliega el visor de planos al servidor desde la Mac.
#
#   1. Compila el frontend (npm run build → dist/)
#   2. Copia dist/ a la carpeta física del visor (nginx la sirve en /)   (protege server/ del borrado)
#   3. Copia el microservicio de colaboración (collab-server.js)
#   4. Reinicia el servicio de colaboración (systemd) y verifica el health
#
# Pide la contraseña SSH UNA sola vez (multiplexa la conexión). El reinicio usa
# sudo remoto con TTY, así que te pedirá la clave de sudo una vez.
#
# Uso:   bash scripts/deploy.sh
#
set -euo pipefail

# ── CONFIGURA ESTO (una sola vez) ───────────────────────────────────────
SERVER="adminsafvsp@192.168.50.163"                   # usuario SSH @ servidor
WEB_ROOT="/usr/share/nginx/html/planos"               # carpeta física del visor; nginx la sirve en / (root → esta carpeta)
COLLAB_DIR="/var/www/saf/planos/server/realtime"      # WorkingDirectory del systemd (fuera del web root)
COLLAB_SERVICE="saf-collab"                            # nombre del servicio systemd
BUILD_CMD="npm run build:dev"                          # dev → dev.aicsacorp.com | "npm run build" → prod (saf.aicsacorp.com)
# ────────────────────────────────────────────────────────────────────────

cd "$(dirname "$0")/.."   # raíz del proyecto

# ── Multiplexación SSH: una sola autenticación para todo el script ───────
SSH_CP="${HOME}/.ssh/cm-saf-deploy.sock"
SSH_OPTS=(-o ControlMaster=auto -o "ControlPath=${SSH_CP}" -o ControlPersist=180)
cleanup() { ssh "${SSH_OPTS[@]}" -O exit "${SERVER}" 2>/dev/null || true; }
trap cleanup EXIT

echo "▶ 1/4  Compilando frontend… (${BUILD_CMD})"
${BUILD_CMD}
[ -f dist/index.html ] || { echo "✗ El build no generó dist/. Abortando."; exit 1; }

echo "▶ Conectando a ${SERVER} (contraseña SSH una sola vez)…"
ssh "${SSH_OPTS[@]}" "${SERVER}" true        # abre la conexión maestra

echo "▶ 2/4  Copiando dist/ → ${WEB_ROOT}"
# --exclude '/server/' como salvaguarda por si hubiera un server/ bajo el web root.
rsync -avz --delete --exclude '/server/' -e "ssh ${SSH_OPTS[*]}" \
  dist/ "${SERVER}:${WEB_ROOT}/"

echo "▶ 3/4  Copiando collab-server.js → ${COLLAB_DIR}"
ssh "${SSH_OPTS[@]}" "${SERVER}" "mkdir -p '${COLLAB_DIR}'"
rsync -avz -e "ssh ${SSH_OPTS[*]}" \
  server/realtime/collab-server.js "${SERVER}:${COLLAB_DIR}/"

echo "▶ 4/4  Reiniciando ${COLLAB_SERVICE} (pide clave de sudo)…"
ssh -t "${SSH_OPTS[@]}" "${SERVER}" "sudo systemctl restart '${COLLAB_SERVICE}'"

echo "▶ Verificando…"
sleep 1
ACTIVE=$(ssh "${SSH_OPTS[@]}" "${SERVER}" "systemctl is-active '${COLLAB_SERVICE}'" || true)
HEALTH=$(ssh "${SSH_OPTS[@]}" "${SERVER}" "curl -m 5 -s http://127.0.0.1:3100/health" || true)

echo "   servicio : ${ACTIVE}"
echo "   health   : ${HEALTH:-<sin respuesta>}"

if [ "${ACTIVE}" = "active" ] && echo "${HEALTH}" | grep -q '"ok":true'; then
  echo "✅ Despliegue completo y microservicio sano."
else
  echo "⚠️  Desplegado, pero el microservicio no responde. Revisa:"
  echo "    ssh ${SERVER} 'journalctl -u ${COLLAB_SERVICE} -n 30 --no-pager'"
  exit 1
fi
