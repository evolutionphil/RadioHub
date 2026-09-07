import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import type { ServerResponse } from 'node:http';

// HTML contains the current deployment's hashed asset URLs. Caches may retain
// it for conditional requests, but must validate before reuse after a deploy.
// Immutable caching remains appropriate for the existing hashed assets only.
export const HTML_CACHE_CONTROL = 'public, no-cache, max-age=0, must-revalidate';

// These public brand images are referenced by the site's favicon/Organization
// markup. The non-SEO SPA fallback's noindex must not leak onto their responses.
// Keep this exact: unrelated assets, private routes and missing files retain
// their existing indexing policy.
const PUBLIC_BRAND_IMAGES = new Set([
  'favicon.png', 'apple-touch-icon.png', 'header-logo-80w.webp',
  'logo-icon.webp', 'images/logo-icon.webp',
]);

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
      if (PUBLIC_BRAND_IMAGES.has(path.relative(distPath, filePath).split(path.sep).join('/'))) {
        res.removeHeader('X-Robots-Tag');
      }
    },
  }));

  // Browsers and older notification payloads still request the conventional
  // ICO URL. Point it to the existing PNG instead of serving a 200 HTML shell.
  app.get('/favicon.ico', (_req, res) => {
    res.removeHeader('Expires');
    res.removeHeader('X-Robots-Tag');
    res.set('Cache-Control', 'public, max-age=86400');
    res.redirect(301, '/favicon.png');
  });

  // A removed build chunk is not an SPA navigation. Never return/cache HTML
  // under its immutable JS/CSS URL, which could poison that URL for a year.
  app.use('/assets', (_req, res) => {
    res.removeHeader('Expires');
    res.status(404).set({
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    }).type('text/plain').send('Not found');
  });

  // Unknown sitemap probes are files, not client-side page routes. Registered
  // manifests (including their intentional 503/410 responses) run before this.
  app.get(/\/(?:[^/]*sitemap[^/]*)\.xml$/i, (_req, res) => {
    res.status(404).set({
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    }).type('text/plain').send('Sitemap not found');
  });

  app.use("/*splat", (_req, res) => {
    revalidateSuccessfulHtml(res);
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
