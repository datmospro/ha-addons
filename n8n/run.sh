#!/bin/sh

# Leer y procesar las opciones de Home Assistant usando Node.js
if [ -f /data/options.json ]; then
  eval $(node -e "
  const fs = require('fs');
  try {
    const options = JSON.parse(fs.readFileSync('/data/options.json', 'utf8'));
    
    if (options.timezone) {
      console.log('export GENERIC_TIMEZONE=\"' + options.timezone + '\";');
    }
    
    if (options.ssl && options.certfile && options.keyfile) {
      console.log('export N8N_PROTOCOL=\"https\";');
      console.log('export N8N_SSL_CERT=\"/ssl/' + options.certfile + '\";');
      console.log('export N8N_SSL_KEY=\"/ssl/' + options.keyfile + '\";');
    }
    
    if (options.env_vars_list && Array.isArray(options.env_vars_list)) {
      options.env_vars_list.forEach(item => {
        const idx = item.indexOf('=');
        if (idx > -1) {
          const key = item.substring(0, idx).trim();
          const val = item.substring(idx + 1).trim();
          console.log('export ' + key + '=\"' + val.replace(/\"/g, '\\\"') + '\";');
        }
      });
    }
  } catch (e) {
    console.error('Error parsing /data/options.json:', e.message);
  }
  ")
fi

# Configurar persistencia en /data para Home Assistant
export N8N_USER_FOLDER="/data"
export N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS="false"

# Parchear dinámicamente base-path.js para soportar Ingress y acceso directo
BASE_PATH_JS=$(find /usr/local/lib/node_modules/n8n /usr/lib/node_modules/n8n -name "base-path.js" 2>/dev/null | head -n 1)

if [ -n "$BASE_PATH_JS" ]; then
  echo "Aplicando parche dinámico para base-path.js en: $BASE_PATH_JS"
  echo 'const match = window.location.pathname.match(/^\/api\/hassio_ingress\/[^/]+\//); window.BASE_PATH = match ? match[0] : "/";' > "$BASE_PATH_JS"
else
  echo "ADVERTENCIA: No se pudo localizar el archivo base-path.js para aplicar el parche dinámico."
fi

# Ejecutar el entrypoint oficial de n8n
exec /docker-entrypoint.sh n8n
