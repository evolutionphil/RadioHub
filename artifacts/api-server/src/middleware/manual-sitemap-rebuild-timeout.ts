import type { RequestHandler } from 'express';

// Installed AFTER requireAdmin, only on the synchronous manual rebuild. Stay
// below the web proxy's existing 60-second limit; ordinary API requests keep 30s.
export const MANUAL_SITEMAP_REBUILD_TIMEOUT_MS = 55_000;
export const manualSitemapRebuildTimeout: RequestHandler = (req, _res, next) => {
  req.setTimeout(MANUAL_SITEMAP_REBUILD_TIMEOUT_MS);
  next();
};
