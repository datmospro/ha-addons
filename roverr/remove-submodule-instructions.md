# Eliminar Submodule Roverr de HA-Addons

## Pasos para eliminar el submodule

Ejecuta estos comandos en PowerShell:

```powershell
# 1. Ir al repositorio ha-addons
cd C:\Users\Datmos\Documents\ha-addons

# 2. Desinicializar el submodule
git submodule deinit -f roverr

# 3. Eliminar el directorio del submodule del indice de git
git rm -f roverr

# 4. Eliminar la carpeta .git/modules/roverr
Remove-Item -Recurse -Force .git/modules/roverr -ErrorAction SilentlyContinue

# 5. Verificar que se elimino correctamente
git status

# 6. Commitear el cambio
git commit -m "Remove roverr submodule"

# 7. Pushear a GitHub
git push origin main
```

## Verificacion

Despues de hacer push, verifica en GitHub que:
- El folder `roverr` ya no aparece en el repositorio ha-addons
- El archivo `.gitmodules` ya no tiene la referencia a roverr

## Alternativa: Convertir a carpeta normal

Si quieres mantener el contenido de roverr pero sin ser submodule:

```powershell
cd C:\Users\Datmos\Documents\ha-addons

# 1. Eliminar el submodule
git submodule deinit -f roverr
git rm -f roverr
Remove-Item -Recurse -Force .git/modules/roverr -ErrorAction SilentlyContinue

# 2. Copiar el contenido de roverr como carpeta normal
Copy-Item -Recurse C:\Users\Datmos\Documents\roverr\* .\roverr\

# 3. Añadir como carpeta normal
git add roverr

# 4. Commitear
git commit -m "Convert roverr from submodule to regular folder"

# 5. Push
git push origin main
```
