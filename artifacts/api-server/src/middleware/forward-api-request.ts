import type { RequestHandler } from 'express';

/** Express removes the mount prefix from req.url. Forward the exact original
 * path/query, including encoded characters and a bare mount with no slash.
 * Authentication, cookies, request headers and parsed-body forwarding remain
 * owned by the existing proxy and destination API service.
 */
export function forwardApiRequest(proxy: RequestHandler): RequestHandler {
  return (req, res, next) => {
    const mountedUrl = req.url;
    req.url = req.originalUrl || `${req.baseUrl}${mountedUrl}`;
    return proxy(req, res, error => { req.url = mountedUrl; next(error); });
  };
}
