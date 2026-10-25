@echo off
REM ============================================================
REM  WTM - Instalador para Windows con Docker (contenedor).
REM
REM  Levanta WTM en un contenedor con un solo comando. Requiere
REM  Docker Desktop instalado y corriendo.
REM  Por defecto usa el puerto 4000.
REM
REM  Uso:
REM    scripts\install-windows-docker.bat
REM    set WTM_PORT=5000 ^& scripts\install-windows-docker.bat
REM ============================================================

setlocal
cd /d "%~dp0\.."

if "%WTM_PORT%"=="" set "WTM_PORT=4000"

where docker >nul 2>nul || (
  echo [ERROR] No se encontro Docker.
  echo Instala Docker Desktop: https://www.docker.com/products/docker-desktop/
  pause
  exit /b 1
)

echo   Puerto: %WTM_PORT%
echo   Construyendo e iniciando WTM...

docker compose up -d --build
if errorlevel 1 (
  echo [ERROR] Fallo el arranque. Revisa que Docker Desktop este corriendo.
  pause
  exit /b 1
)

echo.
echo   WTM esta corriendo.
echo   Accede en:  http://localhost:%WTM_PORT%
echo   Usuario:    admin / admin  (cambialo tras entrar)
echo.
echo   Ver logs:   docker logs -f wtm
echo   Detener:    docker stop wtm
echo.
pause
endlocal
