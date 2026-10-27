#!/usr/bin/env bash
# Supervisor del core dentro del contenedor.
# Reinicia el core cuando el updater hace exit(0) tras aplicar/revertir una
# version, de modo que el contenedor toma el codigo nuevo sin recrearse.
set -u

cd /app

# Marcar el repo como seguro para git (propietario distinto en el volumen).
git config --global --add safe.directory /app 2>/dev/null || true

# Auto-reparacion: si el codigo quedo con dependencias nuevas sin instalar o sin
# compilar (p.ej. tras un git pull que trajo paquetes nuevos y el updater viejo
# no los instalo), instalamos y compilamos antes de arrancar. Idempotente.
ensure_built() {
  if [ ! -f /app/packages/core/dist/index.js ] || [ ! -f /app/packages/desktop/dist/index.html ]; then
    echo "[entrypoint] Falta el build. Instalando dependencias y compilando..."
    npm install --no-audit --no-fund || true
    npm run build || echo "[entrypoint] ADVERTENCIA: el build fallo; se intenta arrancar igual."
  fi
}
ensure_built

while true; do
  echo "[entrypoint] iniciando WTM core..."
  node /app/packages/core/dist/index.js
  code=$?
  echo "[entrypoint] el core termino (code=$code); reiniciando en 2s..."
  sleep 2
done
