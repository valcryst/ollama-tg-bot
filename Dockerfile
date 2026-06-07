FROM node:24-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json* ./
COPY server/package.json ./server/
COPY dashboard/package.json ./dashboard/

RUN npm ci 2>/dev/null || npm install

COPY server ./server
COPY dashboard ./dashboard

RUN npm run build

FROM node:24-bookworm-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libvips42 \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
COPY server/package.json ./server/

RUN npm ci --workspace=server --omit=dev 2>/dev/null || \
    npm install --workspace=server --omit=dev

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npx playwright install --with-deps chromium

COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/dashboard/dist ./dashboard/dist

ENV NODE_ENV=production
ENV DATABASE_PATH=/app/data/bot.db

VOLUME ["/app/data"]

EXPOSE 3000

CMD ["node", "server/dist/index.js"]
