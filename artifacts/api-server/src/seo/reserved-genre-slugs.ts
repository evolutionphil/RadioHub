/**
 * Reserved genre slugs — slugs that must not be admitted to the genre
 * whitelist (or used as alias sources) because they would conflict with
 * existing top-level routes / region pages, or are otherwise meaningless
 * as a "genre".
 *
 * Source of truth: every first path segment served by the SPA today plus
 * the static region children. Mirrored to the admin UI via the
 * GET /api/admin/genre-whitelist response so the same set is enforced
 * client-side for an instant error rather than a round-trip.
 *
 * Keep this list in sync with the PAGES list in sitemap-manifest-builder.ts
 * (buildMainChunks) — that's the canonical "what main pages do we ship?"
 * set. The matching test there imports from here.
 */
export const RESERVED_GENRE_SLUGS: ReadonlySet<string> = new Set<string>([
  // top-level SPA routes
  'stations',
  'genres',
  'about',
  'regions',
  'faq',
  'contact',
  'privacy-policy',
  'terms-and-conditions',
  'applications',
  // /regions/* children — also reserved so a /genres/europe slug can't
  // exist alongside /regions/europe and confuse internal linking/SEO
  'europe',
  'asia',
  'africa',
  'north-america',
  'south-america',
  'oceania',
  // misc system paths under /api or otherwise reserved
  'api',
  'sitemap',
  'sitemap.xml',
  'robots.txt',
  'admin',
  'auth',
  'login',
  'logout',
  'register',
  'search',
]);

export function isReservedGenreSlug(slug: string | null | undefined): boolean {
  if (!slug) return false;
  return RESERVED_GENRE_SLUGS.has(slug.toLowerCase());
}
