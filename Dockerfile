FROM node:20-slim

# Install system deps for Chromium + FFmpeg
RUN apt-get update && apt-get install -y \
    chromium \
    ffmpeg \
    fonts-liberation \
    libnss3 \
    libxss1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    libgl1-mesa-glx \
    libgl1-mesa-dri \
    xvfb \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps (skip Puppeteer Chrome download)
COPY package*.json ./
RUN PUPPETEER_SKIP_DOWNLOAD=true npm install

# Copy source
COPY . .

# Build frontend
RUN npm run build

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PORT=8080

EXPOSE 8080

CMD ["xvfb-run", "--auto-servernum", "--server-args=-screen 0 1920x1080x24", "npm", "start"]
