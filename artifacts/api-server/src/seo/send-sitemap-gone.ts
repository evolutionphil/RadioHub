/**
 * Shared 410 Gone response for sitemap & SEO routes.
 *
 * The global SSR middleware in `index-web.ts` (and `index.ts`) sets a default
 * `X-Robots-Tag: index, follow, ...` on every non-auth response. When a
 * sitemap URL responds with HTTP 410 Gone, that default header survives
 * unless we explicitly overwrite it — producing the contradictory pair
 *   `410 + X-Robots-Tag: index, follow`
 * which Search Console flags as a soft-404 / contradictory-signal warning.
 *
 * This helper guarantees a single, consistent "drop me" signal for every
 * 410 emitted from sitemap/SEO routes: the header is removed and re-set to
 * `noindex, follow`, body is `Gone`, and Cache-Control is conservative.
 *
 * Use this for sitemap, robots, and any other crawler-facing 410 response.
 * For station-page junk 410s, use `sendJunkGone` (different body + cache).
 */

import type { Response } from 'express';

export function sendSitemapGone(res: Response, cacheMaxAgeSeconds: number = 86400): void {
  res.removeHeader('X-Robots-Tag');
  res
    .status(410)
    .set({
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': `public, max-age=${cacheMaxAgeSeconds}`,
      'X-Robots-Tag': 'noindex, follow',
    })
    .send('Gone');
}
