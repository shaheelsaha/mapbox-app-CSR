# Use Puppeteer base image which comes with Chrome installed
FROM ghcr.io/puppeteer/puppeteer:21.5.2

# Switch to root to install system dependencies
USER root

# Install FFMPEG
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (including devDependencies if needed, or just production)
# Note: Puppeteer is already in the base image, but we might need other deps
RUN npm install

# Copy application files
COPY . .

# Create frames directory if it doesn't exist
RUN mkdir -p frames && chown -R pptruser:pptruser frames

# Switch back to pptruser for security (and to use the bundled chrome)
USER pptruser

# Environment variables
ENV PORT=8080
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

# Expose port
EXPOSE 8080

# Start server
CMD ["npm", "start"]
