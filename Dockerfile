FROM node:20

# Install system dependencies (Chrome + FFmpeg)
RUN apt-get update && apt-get install -y \
    chromium \
    ffmpeg \
    fonts-liberation \
    libnss3 \
    libxss1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package info
COPY package*.json ./
RUN npm install

# Copy source code
COPY . .

# Build the frontend (Vite -> dist/)
# This allows server.js to serve the app locally to Puppeteer
RUN npm run build

# Environment variables
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PORT=8080

EXPOSE 8080

CMD ["node", "server.js"]
