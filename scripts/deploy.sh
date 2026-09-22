#!/usr/bin/env bash
#
# deploy.sh — Despliega el visor de planos a un entorno concreto.
#
#   Uso:   bash scripts/deploy.sh dev     # rama develop → planos.aicsacorp.com:8443
#          bash scripts/deploy.sh prod    # rama main    → planos.aicsacorp.com
#
# Pasos:
#   1. Valida entorno, rama de git y árbol limpio
#   2. Compila el frontend con el MODO del entorno (npm run build:dev|build:prod)
#   3. Copia dist/ al web root del entorno (nginx lo sirve en /)
#   4. Copia el microservicio de colaboración y reinicia su servicio systemd
#   5. Verifica el health del microservicio
#
# Ambos entornos viven en el MISMO servidor y bajo el MISMO nombre DNS,
# separados por puerto + carpeta + vhost + servicio systemd. Ver docs/ENTORNOS.md.
#
set -euo pipefail

# ── MATRIZ DE ENTORNOS (lo único que se edita al mover infraestructura) ──
SERVER="adminsafvsp@192.168.50.163"          # usuario SSH @ servidor (común a ambos)

# --- DESARROLLO ---
DEV_WEB_ROOT="/usr/share/nginx/html/planos-dev"
DEV_COLLAB_DIR="/var/www/saf/planos-dev/server/realtime"
DEV_SERVICE="saf-collab-dev"
DEV_PORT=3101
DEV_BUILD="npm run build:dev"
DEV_BRANCH="develop"
DEV_URL="https://planos.aicsacorp.com:8443"   # mismo DNS que prod, otro puerto

# --- PRODUCCIÓN ---
PROD_WEB_ROOT="/usr/share/nginx/html/planos"
PROD_COLLAB_DIR="/var/www/saf/planos/server/realtime"
PROD_SERVICE="saf-collab"
PROD_PORT=3100
PROD_BUILD="npm run build:prod"
PROD_BRANCH="main"
PROD_URL="https://planos.aicsacorp.com"
# ────────────────────────────────────────────────────────────────────────

ENV="${1:-}"
case "${ENV}" in
  dev)
    WEB_ROOT="${DEV_WEB_ROOT}";  COLLAB_DIR="${DEV_COLLAB_DIR}"
    SERVICE="${DEV_SERVICE}";    PORT="${DEV_PORT}"
    BUILD_CMD="${DEV_BUILD}";    WANT_BRANCH="${DEV_BRANCH}";  URL="${DEV_URL}"
    ;;
  prod)
    WEB_ROOT="${PROD_WEB_ROOT}"; COLLAB_DIR="${PROD_COLLAB_DIR}"
    SERVICE="${PROD_SERVICE}";   PORT="${PROD_PORT}"
    BUILD_CMD="${PROD_BUILD}";   WANT_BRANCH="${PROD_BRANCH}"; URL="${PROD_URL}"
    ;;
  *)
    echo "✗ Falta el entorno."
    echo "  Uso:  bash scripts/deploy.sh dev"
    echo "        bash scripts/deploy.sh prod"
    exit 2
    ;;
esac

cd "$(dirname "$0")/.."   # raíz del proyecto

# ── 0/5  Validaciones previas ───────────────────────────────────────────
BRANCH=$(git rev-parse --abbrev-ref HEAD)
COMMIT=$(git rev-parse --short HEAD)

echo "────────────────────────────────────────────────"
echo "  Entorno   : ${ENV}  (${URL})"
echo "  Rama      : ${BRANCH}  (esperada: ${WANT_BRANCH})"
echo "  Commit    : ${COMMIT}"
echo "  Web root  : ${WEB_ROOT}"
echo "  Servicio  : ${SERVICE}  (puerto ${PORT})"
echo "────────────────────────────────────────────────"

if [ "${BRANCH}" != "${WANT_BRANCH}" ]; then
  echo "⚠️  Estás en '${BRANCH}' pero ${ENV} se despliega desde '${WANT_BRANCH}'."
  read -r -p "   ¿Continuar de todos modos? (s/N) " ok
  [ "${ok}" = "s" ] || [ "${ok}" = "S" ] || { echo "Abortado."; exit 1; }
fi

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "⚠️  Hay cambios sin commitear. Lo desplegado NO coincidirá con ${COMMIT}."
  read -r -p "   ¿Continuar de todos modos? (s/N) " ok
  [ "${ok}" = "s" ] || [ "${ok}" = "S" ] || { echo "Abortado."; exit 1; }
fi

if [ "${ENV}" = "prod" ]; then
  echo "🔴 Vas a desplegar a PRODUCCIÓN (${URL})."
  read -r -p "   Escribe PRODUCCION para confirmar: " confirm
  [ "${confirm}" = "PRODUCCION" ] || { echo "Abortado."; exit 1; }
fi

# ── Multiplexación SSH: una sola autenticación para todo el script ───────
SSH_CP="${HOME}/.ssh/cm-saf-deploy-${ENV}.sock"
SSH_OPTS=(-o ControlMaster=auto -o "ControlPath=${SSH_CP}" -o ControlPersist=180)
cleanup() { ssh "${SSH_OPTS[@]}" -O exit "${SERVER}" 2>/dev/null || true; }
trap cleanup EXIT

echo "▶ 1/5  Compilando frontend… (${BUILD_CMD})"
rm -rf dist                      # evita arrastrar assets del entorno anterior
${BUILD_CMD}
[ -f dist/index.html ] || { echo "✗ El build no generó dist/. Abortando."; exit 1; }

echo "▶ 2/5  Conectando a ${SERVER} (contraseña SSH una sola vez)…"
ssh "${SSH_OPTS[@]}" "${SERVER}" true        # abre la conexión maestra

echo "▶ 3/5  Copiando dist/ → ${WEB_ROOT}"
# --exclude '/server/' como salvaguarda por si hubiera un server/ bajo el web root.
rsync -avz --delete --exclude '/server/' -e "ssh ${SSH_OPTS[*]}" \
  dist/ "${SERVER}:${WEB_ROOT}/"

echo "▶ 4/5  Copiando collab-server.js → ${COLLAB_DIR}"
ssh "${SSH_OPTS[@]}" "${SERVER}" "mkdir -p '${COLLAB_DIR}'"
rsync -avz -e "ssh ${SSH_OPTS[*]}" \
  server/realtime/collab-server.js "${SERVER}:${COLLAB_DIR}/"

echo "▶ 5/5  Reiniciando ${SERVICE} (pide clave de sudo)…"
ssh -t "${SSH_OPTS[@]}" "${SERVER}" "sudo systemctl restart '${SERVICE}'"

echo "▶ Verificando…"
sleep 1
ACTIVE=$(ssh "${SSH_OPTS[@]}" "${SERVER}" "systemctl is-active '${SERVICE}'" || true)
HEALTH=$(ssh "${SSH_OPTS[@]}" "${SERVER}" "curl -m 5 -s http://127.0.0.1:${PORT}/health" || true)

echo "   servicio : ${ACTIVE}"
echo "   health   : ${HEALTH:-<sin respuesta>}"

if [ "${ACTIVE}" = "active" ] && echo "${HEALTH}" | grep -q '"ok":true'; then
  echo "✅ ${ENV} desplegado (${COMMIT}) y microservicio sano → ${URL}"
else
  echo "⚠️  Desplegado, pero el microservicio no responde. Revisa:"
  echo "    ssh ${SERVER} 'journalctl -u ${SERVICE} -n 30 --no-pager'"
  exit 1
fi
