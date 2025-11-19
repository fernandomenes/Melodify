@echo off
REM Ejecuta el pipeline 'dev' con un clic (Windows)
setlocal
cd /d %~dp0

REM Fuerza modo desarrollo para que Django sirva estáticos automáticamente
set DJANGO_DEBUG=1
set PYTHONUTF8=1

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0dev.ps1" dev
pause
