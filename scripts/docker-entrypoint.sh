#!/usr/bin/env bash
# Supervisor del core dentro del contenedor.
# Reinicia el core cuando el updater hace exit(0) tras aplicar/revertir una
# version, de modo que el contenedor toma el codigo nuevo sin recrearse.
set -u

cd /app

# Marcar el repo como seguro para git (propietario distinto en el volumen).
git config --global --add safe.directory /app 2>/dev/null || true

while true; do
  echo "[entrypoint] iniciando WTM core..."
  node /app/packages/core/dist/index.js
  code=$?
  echo "[entrypoint] el core termino (code=$code); reiniciando en 2s..."
  sleep 2
done
