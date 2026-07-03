/**
 * A-Z station index pages (Task #11, radio.at parity, 2026-07-03).
 *
 * URL shape: /{lang}/{stations-localized}/{key} where key is a single
 * letter `a`–`z` or the literal bucket `0-9`. Examples:
 *   /en/stations/a   /tr/istasyonlar/m   /de/sender/0-9
 *
 * The letter key itself is NEVER translated — it occupies the same path
 * position as a station slug, and both `buildLocalizedUrl` and hreflang's
 * `generateLanguageUrls` already skip translation for the second segment
 * of /station|/stations paths. That makes canonical, hreflang and sitemap
 * agree on the letter URLs with zero changes to the URL builders.
 *
 * Kept side-effect-free (no Mongoose, no renderer import) so the
 * middleware, the SSR renderer, the sitemap builders and the test suite
 * can all share these definitions without booting anything heavy.
 */

/** Every A-Z index key, in display order. `0-9` buckets digit-led slugs. */
export const AZ_INDEX_KEYS: readonly string[] = [
  ...'abcdefghijklmnopqrstuvwxyz'.split(''),
  '0-9',
];

/** Matches exactly one A-Z index key (already-lowercased input expected). */
export const AZ_KEY_RE = /^(?:0-9|[a-z])$/;

/** Human-facing label: `a` → `A`, `0-9` → `0-9`. */
export function azDisplayLabel(key: string): string {
  return key === '0-9' ? '0-9' : key.toUpperCase();
}

/**
 * Half-open slug range [gte, lt) for a key. Slugs are lowercase ASCII, so
 * plain string bounds turn the letter filter into a pure b-tree range on
 * the unique `{slug:1}` index — no regex, no in-memory sort (the
 * 2026-05-14 incident rule). `:` is the ASCII character after `9`, `{`
 * the one after `z`.
 */
export function azSlugBounds(key: string): { gte: string; lt: string } {
  if (key === '0-9') return { gte: '0', lt: ':' };
  return { gte: key, lt: String.fromCharCode(key.charCodeAt(0) + 1) };
}

/**
 * Detect an A-Z index path on the ALREADY-ENGLISH cleanPath the SSR
 * pipeline produces (localized segments are reverse-translated upstream).
 * Accepts both singular and plural because some languages share one word
 * for station/stations and the reverse map may yield either.
 * Returns the key, or null when the path is not an A-Z index page.
 */
export function matchAzIndexPath(cleanPath: string): string | null {
  const m = /^\/(?:station|stations)\/(0-9|[a-z])$/.exec(cleanPath);
  return m ? m[1] : null;
}
