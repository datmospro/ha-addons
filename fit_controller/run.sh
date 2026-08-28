#!/bin/sh

echo "=================================================="
echo " Starting FitController Add-on"
echo " Database location: ${DB_PATH:-/data/fitcontroller.db}"
echo " Port: ${PORT:-8099}"
echo " Node version: $(node -v)"
echo "=================================================="

# Run Node.js server
exec node server.js
