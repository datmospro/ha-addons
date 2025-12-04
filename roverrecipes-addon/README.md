# Rover Recipes Addon

Este addon de Home Assistant incluye un backend en FastAPI y un frontend moderno (SPA) construido con Vite, React y TailwindCSS, inspirado en el proyecto Builder-zenith-studio.

## Estructura

- `/app` - Backend FastAPI (API REST, base de datos, lógica de negocio)
- `/static` - Frontend compilado (archivos estáticos generados por Vite)
- `/frontend` - Código fuente del frontend moderno (desarrollo)

## Desarrollo del Frontend

1. Entra en la carpeta `frontend`:
   ```bash
   cd frontend
   ```
2. Instala dependencias:
   ```bash
   npm install
   ```
3. Lanza el servidor de desarrollo:
   ```bash
   npm run dev
   ```
4. Cuando termines, compila para producción:
   ```bash
   npm run build
   # Esto generará la carpeta 'dist' con los archivos estáticos
   # Copia el contenido de 'dist' a '../static'
   cp -r dist/* ../static/
   ```

## Desarrollo del Backend

El backend expone la API en `/api/` y sirve el frontend desde `/`.

- Para desarrollo local, puedes usar Uvicorn:
  ```bash
  uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
  ```

## Despliegue

El Dockerfile ya copia la carpeta `static` al contenedor para servir el frontend.

## Inspiración

- [Builder-zenith-studio](https://github.com/datmospro/Builder-zenith-studio)

---

¡Disfruta creando y gestionando recetas con una experiencia moderna y visual! 