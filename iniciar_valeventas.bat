@echo off
title VALEVENTAS by VT VALETEC - Iniciador POS
color 0A
cls

echo ============================================================
echo      VALEVENTAS by VT VALETEC - Sistema POS & Fiados
echo ============================================================
echo.
echo  Iniciando servicios y base de datos en segundo plano...
echo.

docker compose up -d

if %errorlevel% neq 0 (
    echo.
    echo  [ERROR] No se pudo conectar con Docker Desktop. 
    echo  Asegurese de que Docker Desktop este abierto y en ejecucion.
    echo.
    pause
    exit /b %errorlevel%
)

echo.
echo ============================================================
echo  [EXITO] Servicios activos y base de datos conectada.
echo  Abriendo VALEVENTAS en Modo Aplicacion de Escritorio...
echo ============================================================
echo.

timeout /t 2 >nul

set "APP_URL=http://localhost:3005"
set "LAUNCHED=0"

:: 1. Intentar abrir con Microsoft Edge en Modo App (Estándar en Windows 10/11)
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" (
    start "" "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" --app="%APP_URL%"
    set "LAUNCHED=1"
) else if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" (
    start "" "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" --app="%APP_URL%"
    set "LAUNCHED=1"
)

:: 2. Si no se encontró Edge, intentar Google Chrome en Modo App
if "%LAUNCHED%"=="0" (
    if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
        start "" "%ProgramFiles%\Google\Chrome\Application\chrome.exe" --app="%APP_URL%"
        set "LAUNCHED=1"
    ) else if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" (
        start "" "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" --app="%APP_URL%"
        set "LAUNCHED=1"
    ) else if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" (
        start "" "%LocalAppData%\Google\Chrome\Application\chrome.exe" --app="%APP_URL%"
        set "LAUNCHED=1"
    )
)

:: 3. Si no se encuentran rutas específicas, abrir con el navegador predeterminado
if "%LAUNCHED%"=="0" (
    start "" "%APP_URL%"
)

exit
