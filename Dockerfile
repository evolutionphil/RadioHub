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
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./

RUN npm ci --omit=dev

COPY --from=base /app/dist ./dist
COPY --from=base /app/public ./public
COPY --from=base /app/attached_assets ./attached_assets

ENV NODE_ENV=production

EXPOSE ${PORT:-5000}

CMD ["node", "dist/index.js"]
