# Set node.js image
FROM node:20.9.0-alpine

# Install pnpm globally
RUN npm install -g pnpm

# Set the working directory in the container.
WORKDIR /usr/src/app

# Copy code to container.
COPY . .

# Install Node.js dependencies using pnpm
RUN pnpm install

# Build the app.
RUN pnpm run build

# Remove dev dependencies (prune)
RUN pnpm prune --prod

# Expose the port your Node.js app runs on.
EXPOSE 3000

# Command to run the Node.js app.
CMD ["node", "build/index.js"]
