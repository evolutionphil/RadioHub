/**
 * Side-effect-free URL helpers used by the SEO renderer AND its
 * regression tests. Kept in a separate module so the test suite can
 * import them without booting the full renderer (which registers
 * setInterval handles for event-loop monitoring and pulls in Mongoose).
 *
 * Task #127: extracted from `seo-renderer.ts` for soft-404 fixes.
 */

/**
 * Build localized URL path using URL translations from the database.
 *
 * @param englishPath    English path (e.g. `/genres/pop` or `/stations`).
 * @param languageCode   Target language code (e.g. `de`, `sq`).
 * @param countryCode    Optional country code prefix override.
 * @param translationMap Map of `${languageCode}:${englishSegment}` → translated segment.
 * @returns Localized URL path (e.g. `/de/genres` or `/sq/zhanret`).
 */
export function buildLocalizedUrl(
  englishPath: string,
  languageCode: string,
  countryCode?: string,
  translationMap?: Map<string, string>,
): string {
  // UPDATED: All languages (including English) use /{lang}/* format for consistency.
  if (!translationMap) {
    const prefix = countryCode ? `/${countryCode}` : `/${languageCode}`;
    return `${prefix}${englishPath}`;
  }

  const segments = englishPath.split('/').filter(Boolean);

  // Task #127: percent-encode unsafe URL characters in each path segment so
  // localized routes that contain apostrophes / ampersands / spaces (e.g.
  // Dutch `regio's`) emit valid URLs in canonical / hreflang / sitemap output.
  // Without this, Google fetches `/nl/regio's/germany` literally, which the
  // CDN sometimes rewrites or fragments — surfaced in GSC as soft-404s.
  // We encode at the per-segment level so `/` separators are preserved; the
  // result is idempotent for safe characters since they encode to themselves.
  const translatedSegments = segments.map((segment) => {
    const key = `${languageCode}:${segment}`;
    const translated = translationMap.get(key) || segment;
    // `encodeURIComponent` does NOT encode the URL "mark" characters
    // (`!*'()`), but Google's URL parser, our XML escaper, and the CDN
    // all treat apostrophes inconsistently — leaving `regio's` raw in a
    // <loc> double-encodes when it round-trips. Encode those marks
    // explicitly so the final URL only contains safe path characters.
    return encodeURIComponent(translated).replace(
      /[!*'()]/g,
      (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
    );
  });

  const translatedPath =
    translatedSegments.length > 0 ? '/' + translatedSegments.join('/') : '';
  const prefix = countryCode ? `/${countryCode}` : `/${languageCode}`;

  return `${prefix}${translatedPath}`;
}

/**
 * Continents recognized as valid `/regions/<continent>` slugs.
 * Anything else (e.g. `/regions/regio's`, `/regions/foo`) is a Google
 * soft-404 source and must be served as HTTP 404 by the SSR layer.
 *
 * Mirrors the list rendered by the `RegionCountriesPage` React component
 * at `artifacts/megaradio/src/pages/RegionCountriesPage.tsx`.
 */
export const VALID_CONTINENT_SLUGS: ReadonlySet<string> = new Set([
  'africa',
  'asia',
  'europe',
  'north-america',
  'south-america',
  'oceania',
]);

/**
 * Slug-shape regex used for region/country/city slugs. Mirrors the
 * SAFE_GENRE_SLUG_RE gate. Lowercase letters / digits separated by single
 * hyphens. Rejects apostrophes, spaces, percent-encoded garbage, etc.
 */
export const SAFE_REGION_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/i;

/**
 * Decode a URL path segment safely. Falls back to the raw value if the
 * segment is malformed (e.g. a stray `%` byte).
 */
export function decodeSegmentSafe(s: string | undefined): string | undefined {
  if (!s) return undefined;
  try { return decodeURIComponent(s); } catch { return s; }
}

/**
 * Result of route-shape validation for the /regions and /country families.
 * `ok=false` means the SSR layer should emit notFound:true → HTTP 404.
 */
export interface RouteShapeResult {
  /** True when the route-shape is acceptable for SSR. */
  ok: boolean;
  /** Which family the path belongs to. `null` when neither matches. */
  family: 'regions' | 'country' | null;
  /** Diagnostic reason when `ok=false`. Useful for tests + logs. */
  reason?: 'unknown-continent' | 'bad-country-slug' | 'bad-city-slug' | 'empty';
}

/**
 * Task #127: validate the slug shape of a `/regions/...` or `/country/...`
 * path BEFORE running the expensive Mongoose lookups. Splits cleanly so
 * the continent whitelist applies ONLY to `/regions/<continent>/...` —
 * applying it to `/country/<country>` would false-404 every valid country
 * page (the original v1 fix had this regression).
 *
 * Pure function: no I/O, no module-level side effects. Safe to unit-test.
 *
 * @param cleanPath URL path with the language prefix already stripped.
 *                  Examples: `/regions/europe/germany`, `/country/germany`.
 */
export function validateRegionRouteShape(cleanPath: string): RouteShapeResult {
  const isRegionsRoute = cleanPath.startsWith('/regions');
  const isCountryRoute = cleanPath.startsWith('/country');
  if (!isRegionsRoute && !isCountryRoute) {
    return { ok: true, family: null };
  }

  const family: 'regions' | 'country' = isRegionsRoute ? 'regions' : 'country';
  const pathParts = cleanPath.split('/');
  // Index pages `/regions` and `/country` (or trailing slash) — let SSR
  // handle them; they're never soft-404 candidates.
  if (pathParts.length <= 2) return { ok: true, family };

  const slug2 = decodeSegmentSafe(pathParts[2]);
  const slug3 = decodeSegmentSafe(pathParts[3]);

  if (isRegionsRoute) {
    const continentSlug = (slug2 || '').toLowerCase();
    if (!VALID_CONTINENT_SLUGS.has(continentSlug)) {
      return { ok: false, family, reason: 'unknown-continent' };
    }
    if (slug3 && !SAFE_REGION_SLUG_RE.test(slug3)) {
      return { ok: false, family, reason: 'bad-country-slug' };
    }
    return { ok: true, family };
  }

  // /country/<country>[/<city>]
  if (!slug2 || !SAFE_REGION_SLUG_RE.test(slug2)) {
    return { ok: false, family, reason: 'bad-country-slug' };
  }
  if (slug3 && !SAFE_REGION_SLUG_RE.test(slug3)) {
    return { ok: false, family, reason: 'bad-city-slug' };
  }
  return { ok: true, family };
}

/**
 * Task #127: returns true when `cleanPath` is the EXACT country-level page —
 * i.e. the only place where an empty-results soft-404 promotion is safe.
 *
 *   /regions/<continent>/<country>      → true
 *   /country/<country>                  → true
 *
 *   /regions/<continent>                → false (continent index)
 *   /regions/<continent>/<country>/stations → false (station listing)
 *   /regions/<continent>/<country>/<city>   → false (city page)
 *   /country/<country>/stations             → false (station listing)
 *
 * The SSR pipeline derives `regionName` from `pathParts[pathParts.length-1]`
 * — for any deeper path that segment is NOT the country, so doing a
 * country-name DB lookup at deeper levels would falsely 404 valid pages
 * (e.g. `/regions/europe/germany/stations` would query country="Stations").
 */
export function isExactCountryPagePath(cleanPath: string): boolean {
  const pathParts = cleanPath.split('/');
  if (cleanPath.startsWith('/regions')) {
    return pathParts.length === 4;
  }
  if (cleanPath.startsWith('/country')) {
    return pathParts.length === 3;
  }
  return false;
}
