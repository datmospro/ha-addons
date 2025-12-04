#!/usr/bin/with-contenv bashio

bashio::log.info "Starting Roverr Add-on..."

# Start Python Application
bashio::log.info "Starting Web UI and Background Service..."
cd /app
uvicorn main:app --host 0.0.0.0 --port 8000
