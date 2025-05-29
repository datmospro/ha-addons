#!/bin/bash

cd /app/app
DB_NAME="$DB_NAME"
DB_USER="$DB_USER"
DB_PASSWORD="$DB_PASSWORD"
DB_HOST="$DB_HOST"
DB_PORT="$DB_PORT"

# Mostrar las variables de entorno
echo "Base de datos: $DB_NAME"
echo "Usuario: $DB_USER"
echo "Contraseña: $DB_PASSWORD"
echo "Host: $DB_HOST"
echo "Puerto: $DB_PORT"

# Intentar iniciar la app, pero si falla, mantener el contenedor vivo para que la UI de configuración funcione
exec uvicorn main:app --host 0.0.0.0 --port 8000 || {
  echo "No se pudo iniciar la app. Revisa la configuración de la base de datos.";
  tail -f /dev/null
} 