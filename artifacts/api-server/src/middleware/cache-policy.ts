import type { RequestHandler, Response } from 'express';

/** Operational state must reach the origin, including cached success/failure
 * transitions. These headers do not change the health-check status or body. */
export function setHealthCacheHeaders(res: Response): void {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('CDN-Cache-Control', 'no-store');
  res.setHeader('Cloudflare-CDN-Cache-Control', 'no-store');
}

/** Set before authentication so rejected and unavailable responses are as
 * private as successful ones. Public catalog responses never use this helper. */
export function setPrivateCacheHeaders(res: Response): void {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('CDN-Cache-Control', 'no-store');
  res.setHeader('Cloudflare-CDN-Cache-Control', 'no-store');
}

// Mount only on the existing auth/admin namespaces. This covers their unknown
// routes and early middleware errors without caching-policy guesses by cookie.
export const privateApiCachePolicy: RequestHandler = (_req, res, next) => {
  setPrivateCacheHeaders(res);
  next();
};
