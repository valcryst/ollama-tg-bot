FROM node:24-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json* ./
COPY server/package.json ./server/
COPY dashboard/package.json ./dashboard/

RUN npm ci --workspace=server --workspace=dashboard 2>/dev/null || \
    npm install --workspace=server --workspace=dashboard

COPY server ./server
COPY dashboard ./dashboard

RUN npm run build -w dashboard && npm run build -w server

FROM node:24-bookworm-slim

WORKDIR /app

# sharp prebuilt binaries; slim image may need glibc compat for some archs
RUN apt-get update && apt-get install -y --no-install-recommends \
    libvips42 \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
COPY server/package.json ./server/

RUN npm ci --workspace=server --omit=dev 2>/dev/null || \
    npm install --workspace=server --omit=dev

COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/dashboard/dist ./dashboard/dist

ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_PATH=/app/data/bot.db
ENV DASHBOARD_DIST=/app/dashboard/dist

EXPOSE 3000

VOLUME ["/app/data"]

CMD ["node", "server/dist/index.js"]
