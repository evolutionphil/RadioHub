/**
 * Shared 410 Gone response for junk station URLs.
 *
 * Called from BOTH bot handlers:
 *   - `server/index-web.ts` (split-deploy frontend-web service)
 *   - `server/index.ts`     (dev/embedded monolith)
 *
 * Architect P0: when the unified indexability gate
 * (`getIndexableLanguagesForStation`) returns empty because the station is
 * junk or noIndex:true, the handler MUST return HTTP 410 Gone so Google drops
 * the URL from the index aggressively. 200/noindex lets the URL linger for
 * months in "Crawled - currently not indexed".
 */

import type { Response } from 'express';

const JUNK_BODY =
  '<!doctype html><html><head>' +
  '<meta charset="utf-8">' +
  '<meta name="robots" content="noindex">' +
  '<title>Gone</title>' +
  '</head><body><h1>410 Gone</h1>' +
  '<p>This resource is permanently unavailable.</p>' +
  '</body></html>';

export function sendJunkGone(res: Response): void {
  res
    .status(410)
    .set({
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
      'X-SEO-Cache': 'JUNK-410',
    })
    .send(JUNK_BODY);
}
