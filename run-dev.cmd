@echo off
REM Ejecuta el pipeline 'dev' con un clic (Windows)
setlocal
cd /d %~dp0
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0dev.ps1" dev
pause
