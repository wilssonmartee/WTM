# Instaladores de WTM

## Linux (un comando, contenedor)

```bash
./scripts/install-linux.sh
```

Levanta el core y la base de datos en contenedores con Docker Compose.
Requiere Docker instalado.

## Windows (servidor local)

> IMPORTANTE: ejecuta WTM desde un DISCO LOCAL (p. ej. `C:\WTM`), NO desde una
> unidad de red ni una carpeta compartida mapeada (como `X:` apuntando al Mac).
> `npm install` crea enlaces simbolicos en `node_modules\.bin\` que NO funcionan
> sobre carpetas de red SMB. Eso produce el error:
> `npm error EINVAL: invalid argument, lstat ...node_modules\.bin\...`

### Pasos

1. Instala Node.js 18+ (https://nodejs.org).
2. Copia el proyecto al disco local **sin** `node_modules` ni `target` ni `dist`.
   Desde la carpeta de red (ajusta la letra de unidad):
   ```
   robocopy X:\Projects\WTM C:\WTM /E /XD node_modules target .git dist data
   ```
3. Entra a la copia local y arranca:
   ```
   cd C:\WTM
   scripts\start-windows.bat
   ```

El core arranca en el puerto 4000 y sirve el escritorio web. En la misma maquina
entra a `http://localhost:4000`; desde otros equipos de la red,
`http://NOMBRE-SERVIDOR:4000`.

El script `start-windows.bat` detecta si lo ejecutas por error desde una unidad
de red y te avisa antes de fallar.

### Nota sobre carpetas compartidas

Puedes *guardar/servir* el proyecto en una carpeta compartida para acceder al
escritorio por web desde otros equipos, pero el servidor (Node) debe
**ejecutarse en el disco local** de la maquina que hace de servidor. Los clientes
se conectan por red al puerto 4000, no ejecutan los archivos directamente.
