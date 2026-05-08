/**
 * Genre slug whitelist — gates which `/genres/:slug` URLs MegaRadio publishes
 * to search engines.
 *
 * Background (task #104, Agent C investigation §3.2 + §4.1):
 * The historical genre URL set was built from raw station `tags`, which
 * produced ~8,824 slugs per language — ~80% of them were FM frequencies
 * (`/genres/100-1-fm`), city names (`/genres/berkshire`), station/brand names
 * (`/genres/tagesschau24`) or random tag noise (`/genres/0`, `/genres/00`).
 * A 25-URL random sample showed 19/25 (76%) were thin (<600 words, 0 <h2>,
 * no popular-stations grid) — Google was rightly classifying the entire
 * /genres/ template as low quality.
 *
 * The static seed lives in `genre-whitelist-seed.ts` (split out so the
 * runtime override store can import it without forming a cycle with this
 * module). URLs whose slug is NOT on the merged whitelist are:
 *   - dropped from sitemaps (sitemap-manifest-builder.ts)
 *   - 301-redirected to the closest real genre when a matching alias exists
 *   - otherwise served with `<meta name="robots" content="noindex, follow">`
 *     so Google can stop reporting them as soft-404s
 *
 * Even whitelisted genres are suppressed (noindex + dropped from sitemap)
 * when fewer than `MIN_STATIONS_FOR_GENRE_INDEX` indexable stations back
 * them — a thin genre page is still a thin genre page.
 *
 * Task #114: lookups consult the merged runtime store (static seed +
 * admin overrides from MongoDB) so admins can add/remove slugs and
 * aliases without a code deploy. The static seed remains the safety
 * floor — if Mongo is unreachable, the merged snapshot stays equal to
 * the seed.
 */

import { getMergedWhitelist, getMergedAliases } from './genre-whitelist-store';

// Re-export the static seed under the historical names for any caller
// that wants to read the seed directly (e.g. admin routes that compare
// "is this in the seed or admin-added?"). Lookup callers should always
// go through `isWhitelistedGenreSlug` / `getCanonicalGenreSlug` so they
// pick up admin overrides automatically.
export {
  GENRE_WHITELIST_SEED as GENRE_WHITELIST,
  GENRE_ALIASES_SEED as GENRE_ALIASES,
  MIN_STATIONS_FOR_GENRE_INDEX,
} from './genre-whitelist-seed';

/** Returns true when `slug` (case-insensitive) is on the merged genre whitelist. */
export function isWhitelistedGenreSlug(slug: string | undefined | null): boolean {
  if (!slug) return false;
  return getMergedWhitelist().has(slug.toLowerCase());
}

/**
 * Resolve a request slug to its canonical whitelisted slug.
 *   - Whitelisted slug → returned as-is (lowercased)
 *   - Aliased slug → returns the canonical whitelisted target
 *   - Otherwise → undefined (caller should noindex / drop from sitemap)
 */
export function getCanonicalGenreSlug(slug: string | undefined | null): string | undefined {
  if (!slug) return undefined;
  const lower = slug.toLowerCase();
  const whitelist = getMergedWhitelist();
  if (whitelist.has(lower)) return lower;
  const aliased = getMergedAliases().get(lower);
  if (aliased && whitelist.has(aliased)) return aliased;
  return undefined;
}
