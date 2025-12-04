# Build frontend
FROM node:18-alpine as frontend-build
WORKDIR /app
COPY web/package.json ./
RUN npm install
COPY web/ ./
RUN npm run build

# Build backend dependencies
FROM node:18-alpine as backend-build
WORKDIR /app
COPY server/package.json ./
RUN npm install --production

# Production stage
FROM node:18-alpine

# Install nginx
RUN apk add --no-cache nginx bash

# Copy frontend build
COPY --from=frontend-build /app/dist /usr/share/nginx/html

# Copy backend
WORKDIR /app
COPY --from=backend-build /app/node_modules ./node_modules
COPY server/ ./

# Copy nginx configuration
COPY nginx.conf /etc/nginx/nginx.conf

# Create data directory for SQLite
RUN mkdir -p /data && chown -R node:node /data
ENV DB_PATH=/data/game_counter.db

# Copy and set up startup script
COPY run.sh /usr/local/bin/run.sh
RUN chmod +x /usr/local/bin/run.sh

EXPOSE 80

CMD ["/usr/local/bin/run.sh"]
