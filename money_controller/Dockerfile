FROM node:22-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies
RUN npm install --omit=dev

# Copy all application files
COPY . .

# Set environment variables
# In Home Assistant, /data is the persistent directory where data is saved across add-on restarts
ENV DB_PATH=/data/moneycontroller.db
ENV PORT=8080
ENV NODE_ENV=production

# Expose server port
EXPOSE 8080

# Make run.sh executable and start
RUN chmod +x run.sh
CMD ["./run.sh"]
