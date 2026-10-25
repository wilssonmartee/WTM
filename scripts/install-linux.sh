#!/usr/bin/env sh
# ============================================================
#  WTM - Instalador para Linux (contenedor).
#
#  Levanta WTM en un contenedor con un solo comando. Funciona con
#  Docker o con Podman (lo que tengas). Por defecto usa el puerto 4000.
#
#  Uso:
#    ./scripts/install-linux.sh            # puerto 4000
#    WTM_PORT=5000 ./scripts/install-linux.sh   # otro puerto
# ============================================================
set -e

cd "$(dirname "$0")/.."

PORT="${WTM_PORT:-4000}"

# Detectar motor de contenedores.
if command -v docker >/dev/null 2>&1; then
  ENGINE="docker"
  if docker compose version >/dev/null 2>&1; then
    COMPOSE="docker compose"
  elif command -v docker-compose >/dev/null 2>&1; then
    COMPOSE="docker-compose"
  fi
elif command -v podman >/dev/null 2>&1; then
  ENGINE="podman"
  if command -v podman-compose >/dev/null 2>&1; then
    COMPOSE="podman-compose"
  fi
else
  echo "No se encontro Docker ni Podman."
  echo "Instala uno:"
  echo "  Docker: https://docs.docker.com/engine/install/"
  echo "  Podman: https://podman.io/docs/installation"
  exit 1
fi

echo "  Motor: $ENGINE"
echo "  Puerto: $PORT"
echo "  Construyendo e iniciando WTM..."

if [ -n "${COMPOSE:-}" ]; then
  WTM_PORT="$PORT" $COMPOSE up -d --build
else
  # Sin compose: build + run directo.
  "$ENGINE" build -t wtm:latest .
  "$ENGINE" rm -f wtm 2>/dev/null || true
  "$ENGINE" run -d --name wtm \
    -p "$PORT:4000" \
    -v wtm-data:/data \
    --restart unless-stopped \
    wtm:latest
fi

echo ""
echo "  WTM esta corriendo."
echo "  Accede en:  http://localhost:$PORT"
echo "  Usuario:    admin / admin  (cambialo tras entrar)"
echo ""
echo "  Ver logs:   $ENGINE logs -f wtm"
echo "  Detener:    $ENGINE stop wtm"
