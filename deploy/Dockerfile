# Build context is the REPO ROOT (packages/ lives outside apps/web).
#   docker build -f deploy/Dockerfile -t aura-app .

# ---- deps: install with the same lockfiles CI uses --------------------------
FROM node:20-alpine AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package-lock.json ./apps/web/
RUN npm ci --ignore-scripts \
 && cd apps/web && npm ci --ignore-scripts

# ---- build ------------------------------------------------------------------
FROM node:20-alpine AS build
WORKDIR /repo
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/web/node_modules ./apps/web/node_modules
COPY package.json tsconfig.json tsconfig.web.json ./
COPY packages ./packages
COPY apps/web ./apps/web
# Nothing queries the DB at build time (all data fetching is client-side or
# in route handlers), so placeholders are enough for `next build`.
ENV NEXT_TELEMETRY_DISABLED=1 \
    DATABASE_URL=postgresql://build:build@localhost:5432/build \
    AUTH_SECRET=build-placeholder
RUN cd apps/web && npx prisma generate && npm run build

# ---- runtime: only the standalone server output -----------------------------
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN addgroup -S aura && adduser -S aura -G aura
# standalone output mirrors the repo layout: /app/apps/web/server.js
COPY --from=build --chown=aura:aura /repo/apps/web/.next/standalone ./
COPY --from=build --chown=aura:aura /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=aura:aura /repo/apps/web/public ./apps/web/public
# migrations ship in the image so `deploy.sh` can apply them from a one-off container
COPY --from=build --chown=aura:aura /repo/apps/web/prisma/migrations ./migrations
USER aura
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "apps/web/server.js"]
