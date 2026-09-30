@echo off
setlocal EnableExtensions
title Salvadiux Host
cd /d "%~dp0"
if not exist ".env" if exist ".env.example" copy /y ".env.example" ".env" >nul

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "try { $r = Invoke-RestMethod -Uri 'http://127.0.0.1:3210/api/health' -TimeoutSec 2; if ($r.ok -and $r.data.api -eq 'ready' -and $r.data.agent -eq 'ready') { exit 0 } } catch {}; exit 1" >nul 2>nul
if not errorlevel 1 (
  echo Salvadiux Host ya esta en ejecucion.
  echo Panel: http://127.0.0.1:5173
  if /i not "%~1"=="--no-open" start "" "http://127.0.0.1:5173"
  echo.
  echo El proceso principal sigue activo en la otra ventana.
  echo Presiona una tecla para cerrar este aviso.
  pause >nul
  exit /b 0
)

echo.
echo  ========================================
echo           SALVADIUX HOST
echo  ========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  set "CODEX_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin"
  if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" (
    set "PATH=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;%PATH%"
    echo Usando el runtime Node.js incluido con Codex.
  ) else (
    echo [ERROR] No se encontro Node.js global ni el runtime incluido con Codex.
    echo.
    echo Instala Node.js 22 LTS o superior desde:
    echo https://nodejs.org/
    echo.
    pause
    exit /b 1
  )
)

set "PNPM_CMD=pnpm"
set "PNPM_PREFIX="
where pnpm >nul 2>nul
if errorlevel 1 (
  if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd" (
    set PNPM_CMD="%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd"
    set "PATH=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback;%PATH%"
    echo Usando pnpm incluido con Codex.
  ) else (
    where corepack >nul 2>nul
    if errorlevel 1 (
      echo [ERROR] pnpm no esta instalado y Corepack no esta disponible.
      echo Ejecuta: npm install -g pnpm
      echo Despues vuelve a abrir este archivo.
      echo.
      pause
      exit /b 1
    )
    set "PNPM_CMD=corepack"
    set "PNPM_PREFIX=pnpm"
  )
)

for /f %%A in ('node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))"') do set "SALVADIUX_AGENT_TOKEN=%%A"
for /f %%A in ('node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))"') do set "SALVADIUX_SESSION_TOKEN=%%A"

set "VITE_SALVADIUX_SESSION_TOKEN=%SALVADIUX_SESSION_TOKEN%"
set "SALVADIUX_DATA_DIR=%CD%\data"
set "SALVADIUX_API_PORT=3210"
set "SALVADIUX_AGENT_PORT=3211"
set "SALVADIUX_DASHBOARD_ORIGIN=http://127.0.0.1:5173"

if not exist "node_modules\.modules.yaml" (
  echo [1/2] Instalando dependencias por primera vez...
  call %PNPM_CMD% %PNPM_PREFIX% install
  if errorlevel 1 (
    echo.
    echo [ERROR] No se pudieron instalar las dependencias.
    pause
    exit /b 1
  )
) else (
  echo [1/2] Dependencias listas.
)

echo [2/2] Iniciando Salvadiux Host...
echo.
echo El panel se abrira en: http://127.0.0.1:5173
echo Para cerrar Salvadiux Host, vuelve a esta ventana y pulsa Ctrl+C.
echo.

if /i not "%~1"=="--no-open" start "" /b powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0scripts\open-dashboard.ps1"
call %PNPM_CMD% %PNPM_PREFIX% dev

echo.
echo Salvadiux Host se ha detenido.
pause
