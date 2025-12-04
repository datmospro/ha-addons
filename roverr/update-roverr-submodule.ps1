# Script para actualizar roverr y su submodule en ha-addons
# Uso: .\update-roverr-submodule.ps1 "Mensaje del commit"

param(
    [Parameter(Mandatory=$false)]
    [string]$CommitMessage = "Update roverr"
)

$ErrorActionPreference = "Stop"

Write-Host "=== Actualizando Roverr ===" -ForegroundColor Cyan

# Paso 1: Commit y push en roverr
Write-Host "`n[1/4] Commiteando cambios en roverr..." -ForegroundColor Yellow
Set-Location "C:\Users\Datmos\Documents\roverr"

git add .
$changes = git status --porcelain
if ($changes) {
    git commit -m $CommitMessage
    Write-Host "OK Cambios commiteados en roverr" -ForegroundColor Green
} else {
    Write-Host "! No hay cambios para commitear en roverr" -ForegroundColor Yellow
}

# Paso 2: Push a GitHub
Write-Host "`n[2/4] Pusheando roverr a GitHub..." -ForegroundColor Yellow
try {
    git push origin main
    Write-Host "OK Roverr pusheado a GitHub" -ForegroundColor Green
} catch {
    Write-Host "! Ya esta actualizado en GitHub o hubo un error" -ForegroundColor Yellow
}

# Paso 3: Actualizar submodule en ha-addons
Write-Host "`n[3/4] Actualizando submodule en ha-addons..." -ForegroundColor Yellow
Set-Location "C:\Users\Datmos\Documents\ha-addons"

git submodule update --remote roverr
Write-Host "OK Submodule actualizado" -ForegroundColor Green

# Paso 4: Commit y push del submodule
Write-Host "`n[4/4] Commiteando submodule en ha-addons..." -ForegroundColor Yellow
git add roverr
$submoduleChanges = git status --porcelain
if ($submoduleChanges) {
    git commit -m "Update roverr submodule: $CommitMessage"
    git push origin main
    Write-Host "OK Submodule pusheado a GitHub" -ForegroundColor Green
} else {
    Write-Host "! Submodule ya esta actualizado" -ForegroundColor Yellow
}

Write-Host "`n=== Actualizacion Completa ===" -ForegroundColor Cyan
Write-Host "OK Proceso completado" -ForegroundColor Green
Write-Host "`nHome Assistant detectara la nueva version en breve." -ForegroundColor White
