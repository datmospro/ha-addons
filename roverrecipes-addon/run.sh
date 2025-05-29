#!/bin/bash

cd /app/app
DB_NAME="$DB_NAME"
DB_USER="$DB_USER"
DB_PASSWORD="$DB_PASSWORD"

# Usa estas variables para iniciar tu base de datos o aplicación
echo "Base de datos: $DB_NAME"
echo "Usuario: $DB_USER"
echo "Contraseña: $DB_PASSWORD"

exec uvicorn main:app --host 0.0.0.0 --port 8000 