FROM node:20-slim

# Install system dependencies (Chrome + FFmpeg)
# We need these for Puppeteer and fluent-ffmpeg
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

# install deps
COPY package*.json ./
RUN npm install

# copy source
COPY . .

# 🔥 BUILD FRONTEND INSIDE CONTAINER
# This ensures server.js can serve the exact code Puppeteer sees
RUN npm run build

# Environment variables
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PORT=8080

EXPOSE 8080

CMD ["npm", "start"]
