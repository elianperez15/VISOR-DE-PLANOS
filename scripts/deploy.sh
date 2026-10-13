#!/usr/bin/env bash
#
# deploy.sh — Despliega el visor de planos al servidor desde la Mac.
#
#   Uso:   bash scripts/deploy.sh      (o:  npm run deploy)
#
# Pasos:
#   1. Abre la conexión SSH (una sola autenticación para todo el script)
#   2. Verifica que las carpetas destino existan y sean escribibles
#   3. Compila el frontend (npm run build → dist/)
#   4. Copia dist/ al web root y collab-server.js a su carpeta
#   5. Reinicia el servicio de colaboración y verifica el health
#
# Hay UN solo entorno: producción. Ver docs/DESPLIEGUE.md.
#
set -euo pipefail

# ── CONFIGURA ESTO (una sola vez) ───────────────────────────────────────
SERVER="adminsafvsp@192.168.50.163"              # usuario SSH @ servidor
WEB_ROOT="/usr/share/nginx/html/planos"          # carpeta física del visor; nginx la sirve en /
COLLAB_DIR="/var/www/saf/planos/server/realtime" # WorkingDirectory del systemd (fuera del web root)
SERVICE="saf-collab"                             # nombre del servicio systemd
PORT=3100                                        # puerto del microservicio (healthcheck)
URL="https://planos.aicsacorp.com"               # dónde queda publicado
# ────────────────────────────────────────────────────────────────────────

cd "$(dirname "$0")/.."   # raíz del proyecto

COMMIT=$(git rev-parse --short HEAD)
BRANCH=$(git rev-parse --abbrev-ref HEAD)

echo "────────────────────────────────────────────────"
echo "  Destino  : ${URL}"
echo "  Rama     : ${BRANCH}"
echo "  Commit   : ${COMMIT}"
echo "  Web root : ${WEB_ROOT}"
echo "  Servicio : ${SERVICE}  (puerto ${PORT})"
echo "────────────────────────────────────────────────"

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "⚠️  Hay cambios sin commitear: lo desplegado NO coincidirá con ${COMMIT}."
fi

# Confirmación mínima. Si te estorba, borra estas tres líneas.
read -r -p "¿Desplegar? (s/N) " ok
[ "${ok}" = "s" ] || [ "${ok}" = "S" ] || { echo "Abortado."; exit 1; }

# ── Multiplexación SSH: una sola autenticación para todo el script ───────
SSH_CP="${HOME}/.ssh/cm-saf-deploy.sock"
SSH_OPTS=(-o ControlMaster=auto -o "ControlPath=${SSH_CP}" -o ControlPersist=180)
cleanup() { ssh "${SSH_OPTS[@]}" -O exit "${SERVER}" 2>/dev/null || true; }
trap cleanup EXIT

echo "▶ 1/4  Conectando a ${SERVER} (contraseña SSH una sola vez)…"
ssh "${SSH_OPTS[@]}" "${SERVER}" true        # abre la conexión maestra

# ── Verificar el destino ANTES de compilar ──────────────────────────────
# rsync falla con un "mkdir ... Permission denied (13)" bastante críptico si la
# carpeta no existe o no es del usuario SSH. Mejor detectarlo aquí y explicarlo.
echo "▶ 2/4  Verificando destino en el servidor…"
for DIR in "${WEB_ROOT}" "${COLLAB_DIR}"; do
  STATE=$(ssh "${SSH_OPTS[@]}" "${SERVER}" \
    "if [ ! -d '${DIR}' ]; then echo missing; elif [ ! -w '${DIR}' ]; then echo readonly; else echo ok; fi")
  case "${STATE}" in
    ok)       echo "   ✓ ${DIR}" ;;
    missing)  echo "   ✗ ${DIR} — NO EXISTE" ;;
    readonly) echo "   ✗ ${DIR} — existe pero no puedes escribir en ella" ;;
  esac
  [ "${STATE}" = "ok" ] || {
    echo
    echo "   El usuario SSH (${SERVER%%@*}) no puede escribir ahí:"
    echo "   /usr/share/nginx/html y /var/www son de root. Créala así:"
    echo
    echo "     ssh ${SERVER}"
    echo "     sudo mkdir -p '${DIR}'"
    echo "     sudo chown ${SERVER%%@*} '${DIR}'"
    echo "     sudo restorecon -Rv '${DIR}'      # Oracle Linux: SELinux"
    exit 1
  }
done

echo "▶ 3/4  Compilando frontend… (npm run build)"
rm -rf dist                      # evita arrastrar assets de builds anteriores
npm run build
[ -f dist/index.html ] || { echo "✗ El build no generó dist/. Abortando."; exit 1; }

echo "   Copiando dist/ → ${WEB_ROOT}"
# --exclude '/server/' como salvaguarda por si hubiera un server/ bajo el web root.
rsync -avz --delete --exclude '/server/' -e "ssh ${SSH_OPTS[*]}" \
  dist/ "${SERVER}:${WEB_ROOT}/"

echo "   Copiando collab-server.js → ${COLLAB_DIR}"
rsync -avz -e "ssh ${SSH_OPTS[*]}" \
  server/realtime/collab-server.js "${SERVER}:${COLLAB_DIR}/"

echo "▶ 4/4  Reiniciando ${SERVICE} (pide clave de sudo)…"
ssh -t "${SSH_OPTS[@]}" "${SERVER}" "sudo systemctl restart '${SERVICE}'"

echo "▶ Verificando…"
sleep 1
ACTIVE=$(ssh "${SSH_OPTS[@]}" "${SERVER}" "systemctl is-active '${SERVICE}'" || true)
HEALTH=$(ssh "${SSH_OPTS[@]}" "${SERVER}" "curl -m 5 -s http://127.0.0.1:${PORT}/health" || true)

echo "   servicio : ${ACTIVE}"
echo "   health   : ${HEALTH:-<sin respuesta>}"

if [ "${ACTIVE}" = "active" ] && echo "${HEALTH}" | grep -q '"ok":true'; then
  echo "✅ Desplegado (${COMMIT}) y microservicio sano → ${URL}"
else
  echo "⚠️  Desplegado, pero el microservicio no responde. Revisa:"
  echo "    ssh ${SERVER} 'journalctl -u ${SERVICE} -n 30 --no-pager'"
  exit 1
fi
