# ----------------------------------------------------------------------
# Stage 1: Builder - Install Node.js dependencies
# ----------------------------------------------------------------------
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files first for efficient caching
COPY package.json package-lock.json ./

# Install dependencies, skipping development dependencies
RUN npm install --omit=dev

# Copy the application code
COPY addon.js ./

# ----------------------------------------------------------------------
# Stage 2: Final - Small, Stable ALPINE Runtime
# ----------------------------------------------------------------------
# We switch the final stage to the same Alpine image used for the build 
# to ensure runtime stability and avoid the uv_thread_create errors common
# with the GCR distroless images on certain hosts.
FROM node:20-alpine

WORKDIR /app

# Copy the dependencies and application code from the builder stage
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/addon.js ./

# The addon runs on port 7000
EXPOSE 7000

# Set the entry point to run the addon
CMD ["node", "addon.js"]
