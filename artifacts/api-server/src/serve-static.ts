import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import type { ServerResponse } from 'node:http';

// HTML contains the current deployment's hashed asset URLs. Caches may retain
// it for conditional requests, but must validate before reuse after a deploy.
// Immutable caching remains appropriate for the existing hashed assets only.
export const HTML_CACHE_CONTROL = 'public, no-cache, max-age=0, must-revalidate';

function revalidateSuccessfulHtml(res: Pick<ServerResponse, 'statusCode' | 'getHeader' | 'setHeader' | 'removeHeader'>) {
  if (res.statusCode >= 400 || /\bno-store\b/i.test(String(res.getHeader('Cache-Control') || ''))) return;
  res.setHeader('Cache-Control', HTML_CACHE_CONTROL);
  res.removeHeader('Expires');
}

export function log(message: string, source = "express") {
  if (process.env.NODE_ENV === 'production') return;
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  console.log(`${formattedTime} [${source}] ${message}`);
}

export function serveStatic(app: Express, distPath = path.resolve(import.meta.dirname, "public")) {

  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(express.static(distPath, {
    setHeaders(res, filePath) {
      if (filePath.endsWith('.html')) revalidateSuccessfulHtml(res);
    },
  }));

  // A removed build chunk is not an SPA navigation. Never return/cache HTML
  // under its immutable JS/CSS URL, which could poison that URL for a year.
  app.use('/assets', (_req, res) => {
    res.removeHeader('Expires');
    res.status(404).set({
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    }).type('text/plain').send('Not found');
  });

  app.use("/*splat", (_req, res) => {
    revalidateSuccessfulHtml(res);
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
