# WTM - imagen todo-en-uno (core + escritorio web).
#
# Incluye git y el codigo fuente completo para que la AUTOACTUALIZACION por
# GitHub funcione dentro del contenedor (git pull + rebuild + reinicio).
# El core se ejecuta bajo un supervisor que lo reinicia cuando el updater
# hace exit(0) tras aplicar/revertir una version.

FROM node:20-bookworm-slim

# git es necesario para la autoactualizacion. tini para manejar senales.
RUN apt-get update \
  && apt-get install -y --no-install-recommends git tini ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Instalar dependencias primero (capa cacheable).
COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY packages/core/package.json packages/core/
COPY packages/desktop/package.json packages/desktop/
RUN npm install

# Copiar el resto del codigo y compilar.
COPY . .
RUN npm run build

# La raiz del repo para el updater (evita resolver rutas a ciegas).
ENV WTM_REPO_ROOT=/app
ENV WTM_DATA_DIR=/data
ENV WTM_PORT=4000

VOLUME /data
EXPOSE 4000

# tini como PID 1 + supervisor que reinicia el core tras self-update.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/app/scripts/docker-entrypoint.sh"]
