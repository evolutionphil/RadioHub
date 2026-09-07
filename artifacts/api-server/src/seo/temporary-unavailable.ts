import type { Response } from 'express';

/** A temporary render/database failure is not a permanent indexing decision.
 * Keep the normal SPA response body usable, but ask crawlers to retry instead
 * of serving an HTTP 200 shell with a noindex directive (or a synthetic 410).
 * The subsequent send/sendFile call preserves this status and these headers. */
export function markSeoTemporarilyUnavailable(res: Response): void {
  res.status(503);
  res.removeHeader('X-Robots-Tag');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Retry-After', '60');
}
