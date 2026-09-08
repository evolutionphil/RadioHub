/**
 * Shared 410 Gone response for junk station URLs.
 *
 * Called from BOTH bot handlers:
 *   - `server/index-web.ts` (split-deploy frontend-web service)
 *   - `server/index.ts`     (dev/embedded monolith)
 *
 * Architect P0: when the unified indexability gate
 * (`getIndexableLanguagesForStation`) returns empty because the station is
 * excluded by the catalog policy, the handler returns HTTP 410 Gone. Google
 * treats 404 and 410 alike for indexing; neither guarantees immediate removal
 * or an end to recrawling. Recovery must update the catalog decision itself.
 */

import type { Response } from 'express';

// R-A2 FIX (2026-05-08): minimal text/plain body for 410 Gone. The
// previous HTML body was content-rich enough that Googlebot occasionally
// scored it as a soft-404 candidate based on similarity to other low-
// content pages. text/plain "410 Gone" is the most explicit drop signal.
const JUNK_BODY = '410 Gone';

export function sendJunkGone(res: Response): void {
  // CRITICAL: the global SSR middleware in `server/index-web.ts` (and
  // `server/index.ts`) sets `X-Robots-Tag: index, follow, ...` on every
  // response by default. For a 410 Gone we MUST overwrite that header to
  // `noindex, follow` so Google sees a single, consistent "drop me" signal
  // instead of the contradictory pair `410 + index, follow` which surfaces
  // as a "Soft 404 / contradictory signal" warning in Search Console.
  res.removeHeader('X-Robots-Tag');
  res
    .status(410)
    .set({
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
      'X-SEO-Cache': 'JUNK-410',
      'X-Robots-Tag': 'noindex, follow',
    })
    .send(JUNK_BODY);
}
