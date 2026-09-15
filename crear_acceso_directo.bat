@echo off
title Crear Acceso Directo - VALEVENTAS POS
color 0B
cls

echo ============================================================
echo   Creando Acceso Directo de VALEVENTAS en el Escritorio...
echo ============================================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0crear_acceso_directo.ps1"

echo.
echo ============================================================
echo  [LISTO] Ya puedes iniciar VALEVENTAS desde tu Escritorio.
echo ============================================================
echo.
pause
