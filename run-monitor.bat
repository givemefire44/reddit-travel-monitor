@echo off
rem Doble click = corrida local del monitor de Reddit.
rem Deja output\reddit\daily-YYYY-MM-DD-local.md, lo commitea y lo abre.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-monitor.ps1"
echo.
pause
