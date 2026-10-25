@echo off
REM ============================================================
REM  WTM - Construye el .exe del cliente nativo en Windows.
REM
REM  Puedes ejecutar este .bat directamente desde la carpeta de
REM  red (X:\...). El script copia SOLO el codigo fuente a una
REM  carpeta LOCAL temporal (porque npm y Rust no pueden crear
REM  enlaces simbolicos sobre unidades de red), compila el .exe
REM  alli, y copia el instalador de vuelta junto a esta carpeta.
REM
REM  Requisitos en Windows (una sola vez):
REM    - Node.js 18+        https://nodejs.org
REM    - Rust (rustup)      https://www.rust-lang.org/tools/install
REM    - C++ Build Tools    (Desktop development with C++)
REM    - WebView2           (ya viene en Windows 10/11 actuales)
REM ============================================================

setlocal EnableDelayedExpansion

REM Raiz del proyecto = carpeta padre de \scripts
set "SRC=%~dp0.."
pushd "%SRC%"
set "SRC=%CD%"
popd

REM Carpeta de build LOCAL (no de red).
set "BUILD=%LOCALAPPDATA%\WTM-build"

echo.
echo   WTM - build del cliente nativo (.exe)
echo   Origen:  %SRC%
echo   Build:   %BUILD%
echo.

REM --- Comprobaciones ---
where node >nul 2>nul || (echo [ERROR] Falta Node.js ^(https://nodejs.org^) & pause & exit /b 1)
where npm  >nul 2>nul || (echo [ERROR] Falta npm & pause & exit /b 1)
where cargo >nul 2>nul || (echo [ERROR] Falta Rust/cargo ^(https://www.rust-lang.org/tools/install^) & pause & exit /b 1)

REM --- Copiar solo el codigo fuente a la carpeta local ---
echo   Copiando codigo fuente a carpeta local...
robocopy "%SRC%" "%BUILD%" /E /PURGE /XD node_modules target .git dist dist-exe /NFL /NDL /NJH /NJS /NP >nul
REM robocopy: codigos 0-7 son exito; 8+ es error.
if %ERRORLEVEL% GEQ 8 (
  echo   [ERROR] Fallo la copia de archivos.
  pause
  exit /b 1
)

cd /d "%BUILD%"

echo   Instalando dependencias...
call npm install || (echo [ERROR] npm install fallo & pause & exit /b 1)

echo   Compilando el escritorio...
call npm run build:desktop || (echo [ERROR] build:desktop fallo & pause & exit /b 1)

echo   Compilando el cliente nativo (.exe). Esto tarda varios minutos la primera vez...
cd client-native
call npm install || (echo [ERROR] npm install del cliente nativo fallo & pause & exit /b 1)
call npm run tauri:build || (echo [ERROR] tauri build fallo & pause & exit /b 1)

REM --- Copiar el instalador de vuelta junto al proyecto original ---
set "BUNDLE=%BUILD%\client-native\src-tauri\target\release\bundle"
set "OUT=%SRC%\dist-exe"
if not exist "%OUT%" mkdir "%OUT%"

echo   Copiando instaladores a: %OUT%
if exist "%BUNDLE%\msi"  robocopy "%BUNDLE%\msi"  "%OUT%" *.msi /NFL /NDL /NJH /NJS /NP >nul
if exist "%BUNDLE%\nsis" robocopy "%BUNDLE%\nsis" "%OUT%" *.exe /NFL /NDL /NJH /NJS /NP >nul
robocopy "%BUILD%\client-native\src-tauri\target\release" "%OUT%" WTM.exe /NFL /NDL /NJH /NJS /NP >nul

echo.
echo   ============================================================
echo   Listo. Instaladores y ejecutable en:
echo     %OUT%
echo   ============================================================
echo.
pause
endlocal
