import type { RequestHandler } from 'express';

// Native/cache deadlines bound origin data age. Do not start another browser
// or CDN freshness window after serving an almost-expired origin payload.
export const publicStationResponseCache: RequestHandler = (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.path.endsWith('/batch')) {
    res.setHeader('Cache-Control', 'no-cache, max-age=0, must-revalidate');
    res.setHeader('CDN-Cache-Control', 'no-store');
    res.setHeader('Cloudflare-CDN-Cache-Control', 'no-store');
  }
  next();
};
