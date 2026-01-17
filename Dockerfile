# Use official lightweight Node.js image
FROM node:18-slim

# Set working directory
WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./

# Install dependencies (only production to save space)
RUN npm install --production

# Copy all application files
COPY . .

# Cloud Run expects the container to listen on key-value of PORT env var
ENV PORT=8080

# Expose the port (communicates to Docker that the container listens on this port)
EXPOSE 8080

# Start the application
CMD ["npm", "start"]
