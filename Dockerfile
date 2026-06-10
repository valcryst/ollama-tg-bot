FROM node:24-bookworm-slim AS build

WORKDIR /app

# devDependencies (typescript, vite) required for npm run build
ENV NODE_ENV=development

COPY package.json package-lock.json* ./
COPY server/package.json ./server/
COPY dashboard/package.json ./dashboard/

RUN npm ci

COPY server ./server
COPY dashboard ./dashboard

RUN npm run build -w dashboard && npm run build -w server

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
