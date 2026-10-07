@echo off
rem Doble click = corrida local del monitor de Reddit para lo que NO es Italia.
rem Cuenta u/ToursResearch, fase attribution desde el 7 oct 2026 (ver _phase en la config).
rem Deja el reporte en output/reddit/daily-YYYY-MM-DD-world.md, lo commitea y lo abre.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-monitor-world.ps1"
echo.
pause
