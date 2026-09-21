@echo off
rem Doble click = corrida local del monitor de Reddit para lo que NO es Italia.
rem Cuenta u/ToursResearch, fase warmup (sin cifras ni marca hasta los 50 de karma).
rem Deja el reporte en output/reddit/daily-YYYY-MM-DD-world.md, lo commitea y lo abre.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-monitor-world.ps1"
echo.
pause
