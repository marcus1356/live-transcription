# ── Stage 1: deps ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app

# better-sqlite3 needs build tools
RUN apk add --no-cache python3 make g++

COPY package.json ./
RUN npm install --omit=dev

# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app

RUN apk add --no-cache tini

# Copy deps from stage 1
COPY --from=deps /app/node_modules ./node_modules

# Copy app source
COPY . .

# SQLite database lives in a named volume (persists across restarts)
RUN mkdir -p /data
ENV DB_PATH=/data/data.sqlite

# Non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
RUN chown -R appuser:appgroup /app /data
USER appuser

EXPOSE 3001

# tini handles PID 1 / signal forwarding properly
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "index.js"]
