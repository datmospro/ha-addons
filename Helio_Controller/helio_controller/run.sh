#!/bin/sh

echo "=================================================="
echo " Starting HelioController Add-on"
echo " Database location: $DB_PATH"
echo " Port: $PORT"
echo " Node version: $(node -v)"
echo "=================================================="

# Run the Node.js Express server
exec node server.js
