import express, { type Express, type RequestHandler } from 'express';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const ASSET_DIRECTORIES = ['/assets/', '/fonts/', '/images/', '/icons/', '/radio/', '/lotties/', '/~partytown/'];
const ROOT_ASSETS = new Set([
  '/manifest.json', '/favicon.png', '/favicon.svg', '/apple-touch-icon.png',
  '/header-logo-80w.webp', '/logo-icon.webp', '/no-image.webp', '/opengraph.jpg', '/equalizer.svg',
]);

/** The API image contains Vite's whole public directory, not just /assets.
 * Mount only public asset paths: never expose the SPA, build manifests or API
 * routes through a catch-all file server. Missing assets must not become HTML.
 */
export function registerAdminAssets(app: Express, publicDirectory: string): void {
  const serve = express.static(publicDirectory, {
    index: false, redirect: false, dotfiles: 'deny',
    setHeaders(res, filePath) {
      const relative = path.relative(publicDirectory, filePath).split(path.sep).join('/');
      const cacheControl = relative === 'manifest.json'
        ? 'no-cache, no-store, must-revalidate, max-age=0'
        : relative.startsWith('assets/')
          ? 'public, max-age=31536000, immutable'
          : 'public, max-age=86400, must-revalidate';
      res.setHeader('Cache-Control', cacheControl);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (relative === 'manifest.json') res.setHeader('Content-Type', 'application/manifest+json');
    },
  });
  app.use((req, res, next) => {
    if (!ROOT_ASSETS.has(req.path) && !ASSET_DIRECTORIES.some(prefix => req.path.startsWith(prefix))) return next();
    const notFound = () => {
      res.removeHeader('Expires');
      res.status(404).set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
        .type('text/plain').send('Not found');
    };
    // The allowlist must still hold after express.static decodes the URL.
    // Otherwise /assets/%2e%2e/index.html could expose an unrelated root file.
    try {
      const decoded = decodeURIComponent(req.path);
      if (decoded.includes('\\') || /(?:^|\/)\.{1,2}(?:\/|$)/.test(decoded)) return void notFound();
    } catch { return void notFound(); }
    serve(req, res, notFound);
  });
  app.get('/favicon.ico', (_req, res) => {
    res.set('Cache-Control', 'public, max-age=86400').redirect(301, '/favicon.png');
  });
}

/** Explicit source markers survive the Vite build. Public pages retain all
 * of these tags; only the private admin shell drops public hero/analytics work.
 * Cast remains available because the shared player can be used by admins.
 */
export function buildAdminShell(html: string): string {
  return html
    .replace(/<link\b(?=[^>]*\bdata-public-preload(?:\s|=|>))[^>]*>/gi, '')
    .replace(/<script\b(?=[^>]*\bdata-public-runtime(?:\s|=|>))[^>]*>[\s\S]*?<\/script\s*>/gi, '');
}

export function createAdminSpaHandler(publicDirectory: string): RequestHandler {
  let shell: Promise<string> | undefined;
  return async (_req, res) => {
    res.set({
      'X-Robots-Tag': 'noindex, nofollow',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    try {
      shell ??= readFile(path.join(publicDirectory, 'index.html'), 'utf8').then(buildAdminShell);
      res.type('html').send(await shell);
    } catch {
      shell = undefined;
      res.status(503).set('Retry-After', '30').type('text/plain').send('Admin shell unavailable');
    }
  };
}
