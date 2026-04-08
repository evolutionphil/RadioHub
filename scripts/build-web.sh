#!/bin/bash
set -e
echo "📦 Building frontend-web (client + server)..."
npx vite build
npx esbuild server/index-web.ts --platform=node --packages=external --bundle --format=esm --outdir=dist
echo "✅ Frontend Web build complete → dist/index-web.js + dist/public/"
