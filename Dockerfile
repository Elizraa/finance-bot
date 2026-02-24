# Use official Node.js image
FROM node:22-alpine

# Set working directory inside the container
WORKDIR /app

# Copy package.json and package-lock.json first
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy the rest of the source code
COPY . .

# Set environment variable for production
ENV NODE_ENV=production

# Run the bot
CMD ["node", "src/index.js"]
