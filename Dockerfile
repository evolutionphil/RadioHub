FROM node:20-slim AS base

RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./

RUN npm ci --include=dev

COPY . .

RUN npm run build

FROM node:20-slim AS production

RUN apt-get update && apt-get install -y \
    ca-certificates \
    libjemalloc2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./

RUN npm ci --omit=dev

COPY --from=base /app/dist ./dist
COPY --from=base /app/public ./public
COPY --from=base /app/attached_assets ./attached_assets

ENV NODE_ENV=production
ENV LD_PRELOAD=/usr/lib/x86_64-linux-gnu/libjemalloc.so.2
ENV MALLOC_CONF=background_thread:true,dirty_decay_ms:1000,muzzy_decay_ms:1000

EXPOSE ${PORT:-5000}

CMD ["node", "--max-old-space-size=4096", "--max-semi-space-size=64", "--expose-gc", "dist/index.js"]
