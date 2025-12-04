#!/bin/sh

echo "Starting Rover Counter..."

# Start Node.js backend in background
echo "Starting backend server..."
cd /app
node index.js &

# Wait a moment for backend to start
sleep 2

# Start Nginx
echo "Starting nginx..."
exec nginx -g "daemon off;"
