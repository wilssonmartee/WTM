#!/usr/bin/env bash
# ============================================================
#  WTM - Instalador para VPS (Linux).
#
#  Hace todo con un solo comando:
#    1. Instala Docker + Compose si no estan.
#    2. Clona (o actualiza) el repositorio de WTM.
#    3. Construye y levanta WTM en un contenedor.
#
#  Uso tipico (en el VPS):
#    curl -fsSL https://raw.githubusercontent.com/wilssonmartee/WTM/main/scripts/vps-install.sh | sudo bash
#
#  Variables opcionales:
#    WTM_PORT=4000           puerto publico (por defecto 4000)
#    WTM_DIR=/opt/wtm        carpeta de instalacion
#    WTM_BRANCH=main         rama a usar
#    WTM_ADMIN_PASSWORD=...  contrasena inicial del admin
# ============================================================
set -euo pipefail

REPO_URL="https://github.com/wilssonmartee/WTM.git"
WTM_DIR="${WTM_DIR:-/opt/wtm}"
WTM_PORT="${WTM_PORT:-4000}"
WTM_BRANCH="${WTM_BRANCH:-main}"

say() { echo ""; echo "  >> $*"; echo ""; }

# --- Debe correr como root (o con sudo) ---
if [ "$(id -u)" -ne 0 ]; then
  echo "Ejecuta como root o con sudo:"
  echo "  curl -fsSL $REPO_URL/raw/main/scripts/vps-install.sh | sudo bash"
  exit 1
fi

# --- 1. git ---
if ! command -v git >/dev/null 2>&1; then
  say "Instalando git..."
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -y && apt-get install -y git curl ca-certificates
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y git curl
  elif command -v yum >/dev/null 2>&1; then
    yum install -y git curl
  elif command -v pacman >/dev/null 2>&1; then
    pacman -Sy --noconfirm git curl
  else
    echo "No reconozco el gestor de paquetes. Instala git manualmente."
    exit 1
  fi
fi

# --- 2. Docker ---
if ! command -v docker >/dev/null 2>&1; then
  say "Instalando Docker (script oficial)..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker >/dev/null 2>&1 || true
  systemctl start docker >/dev/null 2>&1 || true
else
  say "Docker ya esta instalado."
fi

# --- 3. Compose (plugin) ---
if docker compose version >/dev/null 2>&1; then
  COMPOSE="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE="docker-compose"
else
  say "Instalando el plugin de Docker Compose..."
  if command -v apt-get >/dev/null 2>&1; then
    apt-get install -y docker-compose-plugin || true
  fi
  if docker compose version >/dev/null 2>&1; then
    COMPOSE="docker compose"
  else
    echo "No se pudo instalar Docker Compose automaticamente."
    exit 1
  fi
fi

# --- 4. Clonar o actualizar el repo ---
if [ -d "$WTM_DIR/.git" ]; then
  say "Actualizando WTM en $WTM_DIR..."
  git -C "$WTM_DIR" fetch origin "$WTM_BRANCH"
  git -C "$WTM_DIR" checkout "$WTM_BRANCH"
  git -C "$WTM_DIR" reset --hard "origin/$WTM_BRANCH"
else
  say "Clonando WTM en $WTM_DIR..."
  git clone -b "$WTM_BRANCH" "$REPO_URL" "$WTM_DIR"
fi

cd "$WTM_DIR"

# --- 5. Levantar ---
say "Construyendo e iniciando WTM (puerto $WTM_PORT)..."
WTM_PORT="$WTM_PORT" \
WTM_ADMIN_PASSWORD="${WTM_ADMIN_PASSWORD:-admin}" \
  $COMPOSE up -d --build

# --- Info final ---
IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
cat <<EOF

  ============================================================
  WTM instalado y corriendo.

  Acceso:
    http://localhost:$WTM_PORT        (en el propio VPS)
    http://${IP:-IP-DEL-VPS}:$WTM_PORT   (desde fuera)

  Usuario inicial:  admin / ${WTM_ADMIN_PASSWORD:-admin}
  (cambialo tras entrar)

  Comandos utiles (desde $WTM_DIR):
    docker logs -f wtm        ver logs
    $COMPOSE restart          reiniciar
    $COMPOSE down             detener

  Si usas firewall, abre el puerto:
    ufw allow $WTM_PORT/tcp      (Ubuntu/Debian)
  ============================================================

EOF
