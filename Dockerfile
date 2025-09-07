# Use Node 18 Alpine
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Build Vite project
RUN npm run build

# Install serve globally to serve static files
RUN npm install -g serve

# Expose port 3000 (CapRover default HTTP port)
EXPOSE 5000

# Start the app
CMD ["serve", "-s", "dist", "-l", "3000"]
