@echo off
REM ============================================================
REM  WTM - Arranca el SERVIDOR (core) en Windows.
REM
REM  Puedes ejecutar este .bat directamente desde la carpeta de
REM  red (X:\...). Si detecta que estas en una unidad de red,
REM  copia el codigo a una carpeta LOCAL y arranca desde ahi
REM  automaticamente (npm no puede crear enlaces simbolicos en
REM  unidades de red). Asi no tienes que copiar nada a mano.
REM
REM  Requisito: Node.js 18+  (https://nodejs.org)
REM ============================================================

setlocal EnableDelayedExpansion

set "SRC=%~dp0.."
pushd "%SRC%"
set "SRC=%CD%"
popd

where node >nul 2>nul || (echo [ERROR] Falta Node.js ^(https://nodejs.org^) & pause & exit /b 1)

REM --- Detectar unidad de red ---
set "RUNDIR=%SRC%"
set "CURDRIVE=%SRC:~0,2%"
set "ISREMOTE="
fsutil fsinfo drivetype %CURDRIVE% 2>nul | find /i "Remote" >nul && set "ISREMOTE=1"

if defined ISREMOTE (
  set "RUNDIR=%LOCALAPPDATA%\WTM-server"
  echo   Detectada unidad de red. Copiando a carpeta local:
  echo     !RUNDIR!
  robocopy "%SRC%" "!RUNDIR!" /E /XD node_modules target .git dist "client-native" /NFL /NDL /NJH /NJS /NP >nul
  if !ERRORLEVEL! GEQ 8 (echo [ERROR] Fallo la copia de archivos. & pause & exit /b 1)
)

cd /d "!RUNDIR!"

echo.
echo   WTM - iniciando servidor desde: !RUNDIR!
echo.

if not exist "node_modules" (
  echo   Instalando dependencias ^(solo la primera vez^)...
  call npm install || (echo [ERROR] npm install fallo & pause & exit /b 1)
)

if not exist "packages\core\dist\index.js" (
  echo   Compilando...
  call npm run build || (echo [ERROR] La compilacion fallo & pause & exit /b 1)
)

REM Los datos (SQLite) se guardan en disco LOCAL. SQLite usa bloqueos de
REM archivo que no funcionan bien sobre unidades de red, asi que SIEMPRE van
REM a una carpeta local persistente, independiente de la carpeta temporal.
set "WTM_DATA_DIR=%LOCALAPPDATA%\WTM-data"
if not exist "%WTM_DATA_DIR%" mkdir "%WTM_DATA_DIR%"

echo.
echo   Servidor en http://localhost:4000
echo   Desde otros equipos de la red: http://%COMPUTERNAME%:4000
echo   Datos en: %WTM_DATA_DIR%
echo.

call npm run start --workspace @wtm/core

endlocal
