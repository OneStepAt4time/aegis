# ── Stage 1: Build ───────────────────────────────────────────
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Install root dependencies (including devDependencies for build tooling)
COPY package*.json ./
RUN npm ci

# Copy dashboard manifest and install its dependencies separately
# This ensures dashboard/node_modules exists before the source arrives
COPY dashboard/package*.json dashboard/
RUN cd dashboard && npm ci

# Copy all source
COPY . .

# Build: tsc + openapi + dashboard + copy-dashboard
RUN npm run build

# Verify dashboard was built and copied correctly
RUN test -f dist/dashboard/index.html || \
    (echo "ERROR: dist/dashboard/index.html not found after build" && exit 1)

# ── Stage 2: Production ─────────────────────────────────────
FROM node:22-bookworm-slim AS production

WORKDIR /app

# Install only production dependencies for runtime
COPY package*.json ./
<<<<<<< HEAD
=======
COPY scripts/ scripts/
>>>>>>> docs/changelog-may-7
RUN npm ci --omit=dev

# Create non-root user
RUN groupadd --gid 1001 aegis && \
    useradd --uid 1001 --gid aegis --shell /bin/bash --create-home aegis

# Copy built artifacts from builder
COPY --from=builder --chown=aegis:aegis /app/dist ./dist
COPY --from=builder --chown=aegis:aegis /app/openapi.yaml ./

USER aegis

ENV NODE_ENV=production
EXPOSE 9100

ENTRYPOINT ["node", "dist/server.js"]
