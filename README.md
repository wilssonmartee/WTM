# WTM

Plataforma modular de gestion empresarial. Un **escritorio** (estilo sistema operativo ligero) que corre sobre Windows y Linux, donde cada tarea de negocio (facturacion, inventario, contabilidad, etc.) es un **modulo** que se instala dentro del sistema.

- **Core / servidor**: contiene los datos y la logica. Corre nativo en Windows y Linux.
- **Cliente**: la interfaz grafica tipo escritorio. Funciona por navegador web y como app nativa (Windows/Linux via Tauri).
- **Multiempresa / multiusuario**: un servidor atiende varias empresas y usuarios. Cada modulo decide si sus datos son aislados por empresa o compartidos entre empresas.

## Arquitectura del monorepo

```
WTM/
├─ packages/
│  ├─ shared/     Tipos y contratos compartidos (TypeScript)
│  ├─ core/       Servidor: API REST + WebSocket, DB, auth, modulos, terminal
│  └─ desktop/    Cliente: escritorio en React + Vite
├─ client-native/ Envoltorio Tauri para generar el .exe de Windows/Linux
└─ scripts/       Instaladores (Linux / Windows)
```

## Requisitos

- Node.js 18 o superior
- npm 9 o superior

## Arranque en desarrollo

```bash
npm install
npm run dev
```

- Core (API): http://localhost:4000
- Escritorio (web): http://localhost:5173

## Usuario de prueba

Al iniciar por primera vez, el core crea un superadministrador:

- Usuario: `admin`
- Contrasena: `admin`

Cambiala despues del primer inicio.

## Base de datos

Por defecto usa **SQLite embebido** (un solo archivo, cero instalacion), ideal para Windows "copiar carpeta y listo". Para produccion o VPS se puede cambiar a **PostgreSQL** via variable de entorno sin tocar los modulos.

## Empaquetado

- **Windows / Linux nativo**: ver `client-native/README.md` (Tauri).
- **Instaladores**: ver `scripts/`.

## Terminal del sistema

El escritorio incluye una terminal con comandos estilo Linux acotados a WTM: `ls`, `cd`, `wtm pkg ...`, `wtm db ...`, `wtm status`, `wtm logs`, etc.
