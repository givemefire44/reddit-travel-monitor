# Modo local del monitor de Reddit (doble click en run-monitor.bat).
# Los feeds RSS dan 403 desde las IPs de Actions pero abren desde IP residencial,
# asi que la corrida con datos reales es esta. El cron de Actions sigue andando:
# si Reddit desbloquea o llega OAuth, revive solo y el embudo lo muestra.
#
# La corrida local escribe daily-YYYY-MM-DD-local.md (flag --label local): nombre
# propio para que el commit del bot (que agrega output/reddit entero sin mirar)
# nunca pise el reporte local ni al reves.

$ErrorActionPreference = 'Continue'
Set-Location $PSScriptRoot

Write-Host "=== Reddit monitor - corrida local ===" -ForegroundColor Cyan

Write-Host "`n[1/4] Trayendo commits del bot (git pull --rebase --autostash)..."
git pull --rebase --autostash

Write-Host "`n[2/4] Corriendo el monitor (pausas anti rate-limit: 5-8 min)..."
node scripts/reddit-monitor.mjs --label local
if ($LASTEXITCODE -ne 0) {
    Write-Host "`nEl monitor termino con error (codigo $LASTEXITCODE). Revisar arriba." -ForegroundColor Red
    exit 1
}

$daily = Get-ChildItem "output\reddit\daily-*-local.md" |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $daily) {
    Write-Host "`nNo se encontro el daily local. Revisar la salida del monitor." -ForegroundColor Red
    exit 1
}

Write-Host "`n[3/4] Commiteando $($daily.Name)..."
# Solo los archivos del modo local: el resto de output/reddit es del bot
git add output/reddit/*-local.md
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
    git commit -m "Reddit monitor local: $($daily.BaseName -replace '^daily-','' -replace '-local$','')"
    git push
    if ($LASTEXITCODE -ne 0) {
        # Carrera con el bot: rebase y un reintento. Si vuelve a fallar, el
        # commit queda local y se pushea en la proxima corrida.
        git pull --rebase --autostash
        git push
    }
} else {
    Write-Host "Sin cambios que commitear."
}

Write-Host "`n[4/4] Abriendo el reporte..."
try { Invoke-Item $daily.FullName } catch { notepad $daily.FullName }

Write-Host "`nListo: $($daily.Name)" -ForegroundColor Green
Write-Host "El reporte trae la pregunta, el material y la forma. La respuesta la escribis vos con Claude: pegale el reporte." -ForegroundColor Yellow
