/**
 * Shared slug utilities — used by both the API server and the React frontend.
 *
 * The key fix (Phase B.1): slugifyStationName() now transliterates non-Latin
 * scripts (Arabic, Cyrillic, Thai, CJK, Hangul, …) via the `transliteration`
 * package instead of silently stripping them.  The old regex-only approach
 * produced empty strings for names like "إذاعة" or "라디오", which then
 * became `-<id>` numeric-only slugs that the junk-detection rules noindex'd.
 *
 * Both Node.js (server) and browser (Vite bundle) environments are supported:
 * the `transliteration` package ships separate ESM bundles for each via its
 * `exports` map.  No Node.js-only modules are imported here.
 */

import { slugify as transliterateSlugify } from 'transliteration';

/**
 * Generate an ASCII slug from any station name, including names written in
 * Arabic, Cyrillic, Thai, CJK, Hangul, and other non-Latin scripts.
 *
 * @param name        The raw station name.
 * @param idFallback  Optional station ID used as the final fallback when the
 *                    transliterated result is still empty or numeric-only
 *                    (e.g. a name consisting entirely of emoji or symbols).
 *                    When omitted, falls back to the string `'unknown'`.
 * @returns A non-empty, lowercase, hyphen-separated ASCII slug.
 */
export function slugifyStationName(name: string, idFallback?: string): string {
  if (!name || typeof name !== 'string') {
    return `station-${idFallback ?? 'unknown'}`;
  }

  // 1) Transliterate Unicode → ASCII (handles Arabic, Cyrillic, Thai, CJK,
  //    accented Latin, etc.).  The library lowercases and replaces separators.
  let slug = transliterateSlugify(name, {
    lowercase: true,
    separator: '-',
    trim: true,
  });

  // 2) Belt-and-braces sanitisation: keep only [a-z0-9-], collapse repeated
  //    hyphens, and trim edge hyphens.  The transliteration library is usually
  //    correct, but some upstream characters slip through.
  slug = slug
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

  // 3) If the result is empty or purely numeric (e.g. a name like "2516"),
  //    use the station ID as a disambiguating prefix so the slug never looks
  //    like a bare number.
  if (!slug || /^\d+$/.test(slug)) {
    return `station-${idFallback ?? 'unknown'}`;
  }

  return slug;
}
