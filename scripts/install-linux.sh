#!/usr/bin/env sh
# ============================================================
#  WTM - Instalador para Linux (contenedor)
#  Levanta el core de WTM con Docker Compose.
# ============================================================
set -e

cd "$(dirname "$0")/.."

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker no esta instalado."
  echo "Instalalo desde: https://docs.docker.com/engine/install/"
  exit 1
fi

echo "Construyendo e iniciando WTM..."
docker compose up -d --build

echo ""
echo "  WTM esta corriendo."
echo "  Accede en: http://localhost:4000"
echo "  Logs:      docker compose logs -f"
echo "  Detener:   docker compose down"
