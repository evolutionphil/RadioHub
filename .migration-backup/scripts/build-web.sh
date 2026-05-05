#!/bin/bash
set -e
echo "📦 Building frontend-web (client + server)..."
export VITE_API_BASE_URL="${VITE_API_BASE_URL:-https://api.themegaradio.com}"
export VITE_STREAM_PROXY_URL="${VITE_STREAM_PROXY_URL:-https://stream.themegaradio.com}"
echo "🔗 VITE_API_BASE_URL=$VITE_API_BASE_URL"
echo "🔗 VITE_STREAM_PROXY_URL=$VITE_STREAM_PROXY_URL"
npx vite build
npx esbuild server/index-web.ts --platform=node --packages=external --bundle --format=esm --outdir=dist
echo "✅ Frontend Web build complete → dist/index-web.js + dist/public/"
