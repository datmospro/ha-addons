# Script para convertir roverr de submodule a carpeta normal en ha-addons
# Ejecutar desde cualquier ubicacion

$ErrorActionPreference = "Stop"

Write-Host "=== Convirtiendo roverr a carpeta normal ===" -ForegroundColor Cyan

# Navegar a ha-addons
Set-Location "C:\Users\Datmos\Documents\ha-addons"

# Paso 1: Eliminar submodule
Write-Host "`n[1/5] Eliminando configuracion de submodule..." -ForegroundColor Yellow
try {
    git submodule deinit -f roverr
    Write-Host "OK Submodule desinicializado" -ForegroundColor Green
} catch {
    Write-Host "! Submodule ya estaba desinicializado" -ForegroundColor Yellow
}

# Paso 2: Remover del git index
Write-Host "`n[2/5] Removiendo del indice de git..." -ForegroundColor Yellow
try {
    git rm -f roverr
    Write-Host "OK Removido del indice" -ForegroundColor Green
} catch {
    Write-Host "! Ya estaba removido o no existe" -ForegroundColor Yellow
}

# Paso 3: Limpiar .git/modules
Write-Host "`n[3/5] Limpiando carpeta .git/modules..." -ForegroundColor Yellow
if (Test-Path ".git/modules/roverr") {
    Remove-Item -Recurse -Force ".git/modules/roverr"
    Write-Host "OK Carpeta .git/modules/roverr eliminada" -ForegroundColor Green
} else {
    Write-Host "! Carpeta .git/modules/roverr no existe" -ForegroundColor Yellow
}

# Paso 4: Copiar contenido de roverr como carpeta normal
Write-Host "`n[4/5] Copiando roverr como carpeta normal..." -ForegroundColor Yellow

# Asegurarse de que la carpeta roverr no existe
if (Test-Path "roverr") {
    Remove-Item -Recurse -Force "roverr"
}

# Crear la carpeta y copiar todo el contenido
New-Item -ItemType Directory -Path "roverr" -Force | Out-Null

# Copiar todos los archivos y carpetas EXCEPTO .git
Get-ChildItem "C:\Users\Datmos\Documents\roverr" -Recurse | Where-Object {
    $_.FullName -notlike "*\.git\*" -and $_.FullName -notlike "*\.git"
} | ForEach-Object {
    $targetPath = $_.FullName.Replace("C:\Users\Datmos\Documents\roverr", "roverr")
    if ($_.PSIsContainer) {
        New-Item -ItemType Directory -Path $targetPath -Force -ErrorAction SilentlyContinue | Out-Null
    } else {
        Copy-Item $_.FullName -Destination $targetPath -Force
    }
}

Write-Host "OK Contenido copiado" -ForegroundColor Green

# Paso 5: Añadir, commitear y pushear
Write-Host "`n[5/5] Commiteando cambios..." -ForegroundColor Yellow
git add roverr
git add .gitmodules -ErrorAction SilentlyContinue

$status = git status --porcelain
if ($status) {
    git commit -m "Convert roverr from submodule to regular folder"
    git push origin main
    Write-Host "OK Cambios pusheados a GitHub" -ForegroundColor Green
} else {
    Write-Host "! No hay cambios para commitear" -ForegroundColor Yellow
}

Write-Host "`n=== Conversion Completa ===" -ForegroundColor Cyan
Write-Host "OK roverr es ahora una carpeta normal en ha-addons" -ForegroundColor Green
Write-Host "`nVerifica en GitHub: https://github.com/datmospro/ha-addons" -ForegroundColor White
