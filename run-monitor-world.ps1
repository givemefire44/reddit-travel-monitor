# Modo local del monitor de Reddit para lo que NO es Italia (doble click en
# run-monitor-world.bat). Mismo script que el de Italia, otra config.
#
# La cuenta es u/ToursResearch y arranca en fase warmup: hasta los 50 de karma el
# validador rechaza cualquier borrador que mencione la marca, asi que lo unico
# que produce son comentarios del carril karma. Es lo esperado, no un error.
#
# El --label world es lo que evita que los dos monitores escriban el mismo
# daily-YYYY-MM-DD-local.md y se pisen: este deja daily-YYYY-MM-DD-world.md.

$ErrorActionPreference = 'Continue'
Set-Location $PSScriptRoot

Write-Host "=== Reddit monitor - fuera de Italia (u/ToursResearch) ===" -ForegroundColor Cyan

Write-Host "`n[1/4] Trayendo commits del bot (git pull --rebase --autostash)..."
git pull --rebase --autostash

Write-Host "`n[2/4] Corriendo el monitor (pausas anti rate-limit: 5-8 min)..."
node scripts/reddit-monitor.mjs --config config/reddit-monitor-world.json --label world
if ($LASTEXITCODE -ne 0) {
    Write-Host "`nEl monitor termino con error (codigo $LASTEXITCODE). Revisar arriba." -ForegroundColor Red
    exit 1
}

$daily = Get-ChildItem "output\reddit\daily-*-world.md" |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $daily) {
    Write-Host "`nNo se encontro el daily de world. Revisar la salida del monitor." -ForegroundColor Red
    exit 1
}

Write-Host "`n[3/4] Commiteando $($daily.Name)..."
# Solo los reportes de este modo: el resto de output/reddit es del bot y del
# monitor de Italia.
git add output/reddit/*-world.md
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
    git commit -m "Reddit monitor world: $($daily.BaseName -replace '^daily-','' -replace '-world$','')"
    git push
    if ($LASTEXITCODE -ne 0) {
        git pull --rebase --autostash
        git push
    }
} else {
    Write-Host "Sin cambios que commitear."
}

Write-Host "`n[4/4] Abriendo el reporte..."
try { Invoke-Item $daily.FullName } catch { notepad $daily.FullName }

Write-Host "`nListo: $($daily.Name)" -ForegroundColor Green
Write-Host "Ojo: en warmup los comentarios van SIN cifras y SIN marca. Son para juntar karma hasta 50." -ForegroundColor Yellow
