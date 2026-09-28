# ---- deps stage: install only production dependencies ----
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund

# ---- test-deps stage: install ALL dependencies, including devDependencies
# (Jest, supertest, eslint, nodemon), completely separate from the `deps`
# stage above. Production's `npm ci --omit=dev` is untouched. ----
FROM node:20-alpine AS test-deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

# ---- test stage: image only carries node_modules (with devDependencies).
# The actual source (src/, tests/, jest.config.js, .env.test) is supplied at
# `docker compose run` time via a bind mount (see docker-compose.yml's
# backend-test service), so this stage never needs its own COPY . . and
# never needs .dockerignore's `tests`/`jest.config.js` exclusions changed. ----
FROM node:20-alpine AS test
WORKDIR /app
ENV NODE_ENV=test
COPY --from=test-deps /app/node_modules ./node_modules
COPY package.json package-lock.json* ./
CMD ["npm", "test"]

# ---- runtime stage ----
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=5000

# Run as a non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S expressjs -u 1001

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN chown -R expressjs:nodejs /app
USER expressjs

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:5000/api/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "src/server.js"]
