#!/bin/sh
export NODE_ENV=production
exec node --max-old-space-size=4096 --max-semi-space-size=64 --expose-gc dist/index.js
