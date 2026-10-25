# WTM core + escritorio web, en una sola imagen.
FROM node:20-bookworm-slim AS build

WORKDIR /app
COPY package.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/core/package.json packages/core/
COPY packages/desktop/package.json packages/desktop/
RUN npm install

COPY . .
RUN npm run build

# --- Imagen final ---
FROM node:20-bookworm-slim
WORKDIR /app

# Copiamos solo lo necesario para correr.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages ./packages

ENV WTM_DATA_DIR=/data
ENV WTM_PORT=4000
VOLUME /data
EXPOSE 4000

CMD ["node", "packages/core/dist/index.js"]
