FROM python:3.11-slim

# Establecer el directorio de trabajo para la aplicación backend y los archivos estáticos
WORKDIR /app/app

# Copiar el archivo de requisitos del backend e instalar dependencias
# Asume que requirements.txt está en la carpeta 'app' del contexto de compilación
COPY app/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copiar el código de la aplicación backend
# Asume que el código de FastAPI (main.py, etc.) está en la carpeta 'app' del contexto de compilación
COPY app/ .

# Copiar los archivos estáticos (frontend compilado)
# Asume que la carpeta 'static' existe en la raíz del contexto de compilación después de 'npm run build'
COPY static ./static

# Copiar el script de inicio y hacerlo ejecutable
COPY run.sh /run.sh
RUN chmod +x /run.sh

EXPOSE 8000

# El script run.sh hace 'cd /app/app' antes de ejecutar uvicorn
CMD ["/run.sh"] 