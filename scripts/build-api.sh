#!/bin/bash
set -e
echo "📦 Building backend-api..."
npx esbuild server/index-api.ts --platform=node --packages=external --bundle --format=esm --outdir=dist
echo "✅ Backend API build complete → dist/index-api.js"
