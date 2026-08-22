# Modo local del monitor de Quora (doble click en run-quora.bat).
#
# Hermano de run-monitor.ps1, con dos diferencias:
#   - No hay cron en Actions para Quora: esta corrida ES la unica.
#   - Las preguntas salen de la API de Brave (site:quora.com), no de Quora
#     directamente: Quora devuelve 403 a todo y su robots.txt prohibe usar su
#     contenido para alimentar sistemas de IA. Al buscador si se le puede
#     preguntar, porque tiene Quora indexado legitimamente.
#
# Escribe output\quora\daily-YYYY-MM-DD-local.md (flag --label local), con nombre
# propio para no pisarse con nada que venga del repo.

$ErrorActionPreference = 'Continue'
Set-Location $PSScriptRoot

Write-Host "=== Quora monitor - corrida local ===" -ForegroundColor Cyan

Write-Host "`n[1/4] Trayendo commits del repo (git pull --rebase --autostash)..."
git pull --rebase --autostash

Write-Host "`n[2/4] Buscando preguntas y eligiendo facts (consultas a Brave)..."
# --sin-borrador: el script entrega pregunta + facts, la respuesta la escribe
# Mario con Claude. El porque esta explicado arriba de SIN_BORRADOR en el .mjs.
node scripts/quora-monitor.mjs --label local --sin-borrador
if ($LASTEXITCODE -ne 0) {
    Write-Host "`nEl monitor termino con error (codigo $LASTEXITCODE). Revisar arriba." -ForegroundColor Red
    exit 1
}

$daily = Get-ChildItem "output\quora\daily-*-local.md" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $daily) {
    Write-Host "`nNo se encontro el daily local. Revisar la salida del monitor." -ForegroundColor Red
    exit 1
}

Write-Host "`n[3/4] Commiteando $($daily.Name)..."
git add output/quora/*-local.md
git add data/quora-ledger.json 2>$null
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
    git commit -m "Quora monitor local: $($daily.BaseName -replace '^daily-','' -replace '-local$','')"
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
