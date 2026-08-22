@echo off
rem Doble click = corrida local del monitor de QUORA (no toca Reddit).
rem Busca preguntas via Brave, redacta con el corpus y deja
rem output\quora\daily-YYYY-MM-DD-local.md, lo commitea y lo abre.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-quora.ps1"
echo.
pause
