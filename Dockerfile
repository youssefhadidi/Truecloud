# truecloud Dockerfile
FROM node:20-alpine

WORKDIR /app

# Install dependencies for sharp and video processing
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    ffmpeg \
    sqlite \
    openssl

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install pnpm
RUN npm install -g pnpm

# Install dependencies
RUN pnpm install --frozen-lockfile

# Set environment variables for Prisma
ENV PRISMA_CLIENT_ENGINE_TYPE=binary
ENV NODE_ENV=production

# Copy application files
COPY . .

# Generate Prisma client
RUN pnpm run db:generate

# Build Next.js app
RUN pnpm build

# Expose port
EXPOSE 3000

# Environment to bind to all interfaces
ENV HOSTNAME=0.0.0.0

# Run migrations and start the application
CMD ["sh", "-c", "pnpm run setup && pnpm start"]
