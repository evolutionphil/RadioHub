#!/bin/bash
set -e
echo "📦 Building stream-proxy..."
npx esbuild server/index-proxy.ts --platform=node --packages=external --bundle --format=esm --outdir=dist
echo "✅ Stream Proxy build complete → dist/index-proxy.js"
