@echo off
setlocal EnableExtensions
title Compilar Salvadiux Network Core
cd /d "%~dp0"

set "JAVA_HOME="
for /d %%D in ("%~dp0data\runtimes\java21-windows-x64\jdk-*") do if exist "%%~D\bin\javac.exe" set "JAVA_HOME=%%~D"
if defined JAVA_HOME set "PATH=%JAVA_HOME%\bin;%PATH%"

if not defined JAVA_HOME (
  where javac >nul 2>nul
  if errorlevel 1 (
    echo [ERROR] JDK 21 is required to compile the Paper plugin.
    echo Create a Paper 1.21 server in Salvadiux Host first so it downloads its managed Java 21 runtime,
    echo or install JDK 21 and set JAVA_HOME, then run this file again.
    echo.
    pause
    exit /b 1
  )
)

call "%~dp0server-plugin\gradlew.bat" --no-daemon -p "%~dp0server-plugin" build
if errorlevel 1 (
  echo.
  echo [ERROR] The plugin could not be compiled. Check your Internet connection and the Java 21 runtime.
  pause
  exit /b 1
)

echo.
echo Plugin ready: server-plugin\build\libs\SalvadiuxNetworkCore-0.1.0.jar
pause
