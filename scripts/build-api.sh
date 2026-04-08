#!/bin/bash
set -e
echo "📦 Building backend-api..."
npx esbuild server/index-api.ts --platform=node --packages=external --bundle --format=esm --outdir=dist
echo "✅ Backend API server build complete → dist/index-api.js"

echo "📦 Building frontend (for admin panel)..."
npx vite build
echo "✅ Frontend build complete → dist/public/"
