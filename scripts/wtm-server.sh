#!/usr/bin/env bash
# ============================================================
#  WTM - Control del servidor (core) en macOS / Linux.
#
#  Mantiene el core corriendo de forma PERSISTENTE, independiente
#  de cualquier terminal. Se reinicia solo si se cae.
#
#  Uso:
#    ./scripts/wtm-server.sh start     arranca el core en segundo plano
#    ./scripts/wtm-server.sh stop      lo detiene
#    ./scripts/wtm-server.sh restart   lo reinicia
#    ./scripts/wtm-server.sh status    dice si esta corriendo
#    ./scripts/wtm-server.sh logs      muestra el log en vivo
# ============================================================
set -euo pipefail

# Raiz del proyecto = carpeta padre de /scripts
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PID_FILE="$ROOT/data/wtm-server.pid"
LOG_FILE="$ROOT/data/wtm-server.log"
PORT="${WTM_PORT:-4000}"

mkdir -p "$ROOT/data"

is_running() {
  [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null
}

build_if_needed() {
  # Instalar dependencias si faltan (p.ej. tras un git pull con paquetes
  # nuevos). Si node_modules no existe o el core no esta compilado, instalamos.
  if [ ! -d "$ROOT/node_modules" ] || [ ! -f "$ROOT/packages/core/dist/index.js" ] || [ ! -f "$ROOT/packages/desktop/dist/index.html" ]; then
    echo "  Instalando dependencias (npm install)..."
    npm install --no-audit --no-fund
  fi
  if [ ! -f "$ROOT/packages/core/dist/index.js" ]; then
    echo "  Compilando el core..."
    npm run build:core
  fi
  if [ ! -f "$ROOT/packages/desktop/dist/index.html" ]; then
    echo "  Compilando el escritorio..."
    npm run build:desktop
  fi
}

start() {
  if is_running; then
    echo "  WTM ya esta corriendo (pid $(cat "$PID_FILE"))."
    status
    return 0
  fi

  # Liberar el puerto por si quedo algo colgado.
  if lsof -ti:"$PORT" >/dev/null 2>&1; then
    echo "  Liberando puerto $PORT..."
    lsof -ti:"$PORT" | xargs kill -9 2>/dev/null || true
    sleep 1
  fi

  build_if_needed

  echo "  Arrancando WTM (con reinicio automatico)..."
  # Bucle supervisor: si el core se cae, lo vuelve a levantar.
  (
    while true; do
      node "$ROOT/packages/core/dist/index.js" >>"$LOG_FILE" 2>&1 || true
      echo "[$(date '+%Y-%m-%d %H:%M:%S')] el core se detuvo; reiniciando en 2s..." >>"$LOG_FILE"
      sleep 2
    done
  ) &
  echo $! >"$PID_FILE"
  sleep 2
  status
}

stop() {
  if is_running; then
    PID="$(cat "$PID_FILE")"
    # Matar el supervisor y sus hijos (el node).
    pkill -P "$PID" 2>/dev/null || true
    kill "$PID" 2>/dev/null || true
    lsof -ti:"$PORT" | xargs kill -9 2>/dev/null || true
    rm -f "$PID_FILE"
    echo "  WTM detenido."
  else
    echo "  WTM no estaba corriendo."
    lsof -ti:"$PORT" | xargs kill -9 2>/dev/null || true
    rm -f "$PID_FILE"
  fi
}

status() {
  if curl -s -m 3 "http://localhost:$PORT/api/health" >/dev/null 2>&1; then
    echo "  Estado: EN LINEA  ->  http://localhost:$PORT"
    # Mostrar las IPs de red para acceder desde otros equipos / VM.
    for ip in $(ifconfig 2>/dev/null | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}'); do
      echo "          red:       http://$ip:$PORT"
    done
  else
    echo "  Estado: DETENIDO"
  fi
}

case "${1:-status}" in
  start) start ;;
  stop) stop ;;
  restart) stop; sleep 1; start ;;
  status) status ;;
  logs) tail -f "$LOG_FILE" ;;
  *)
    echo "Uso: $0 {start|stop|restart|status|logs}"
    exit 1
    ;;
esac
