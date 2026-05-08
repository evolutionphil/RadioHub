/**
 * Task #127 — regression suite for soft-404 / sitemap-escape fixes.
 *
 * Run via: `pnpm --filter @workspace/api-server run test:seo`
 *
 * Pure-function snapshots only — no Mongo/Express boot needed. The full
 * SSR pipeline is exercised at runtime by the API server smoke tests; here
 * we lock in the contracts that prevent the regression from coming back:
 *
 *   1. `escapeXml` covers all 5 XML predefined entities (`'`, `"`, `&`, `<`, `>`).
 *   2. `buildLocalizedUrl` percent-encodes path segments so localized
 *      slugs containing apostrophes (Dutch `regio's`) emit valid URLs.
 *   3. `VALID_CONTINENT_SLUGS` exposes exactly the continents the
 *      `RegionCountriesPage` React component renders, so the SSR
 *      whitelist gate stays in sync with the UI.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { escapeXml } from '../src/utils/escape-xml';
import {
  buildLocalizedUrl,
  VALID_CONTINENT_SLUGS,
  validateRegionRouteShape,
  SAFE_REGION_SLUG_RE,
  decodeSegmentSafe,
  isExactCountryPagePath,
} from '../src/seo/url-helpers';

test('escapeXml escapes all 5 XML predefined entities', () => {
  assert.equal(escapeXml(`a&b<c>d"e'f`), 'a&amp;b&lt;c&gt;d&quot;e&apos;f');
});

test('escapeXml is order-safe — already-escaped entities double-escape (intentional)', () => {
  // Sitemap input is RAW URLs from buildLocalizedUrl, never pre-escaped XML.
  // Double-escaping here proves we never silently consume an `&amp;` token.
  assert.equal(escapeXml('a&amp;b'), 'a&amp;amp;b');
});

test('escapeXml handles non-string input safely', () => {
  // @ts-expect-error — testing runtime guard for legacy callers.
  assert.equal(escapeXml(null), '');
  // @ts-expect-error — testing runtime guard for legacy callers.
  assert.equal(escapeXml(undefined), '');
  // @ts-expect-error — testing runtime guard for legacy callers.
  assert.equal(escapeXml(42), '');
});

test('escapeXml + sitemap <loc> produces a fully-escaped URL for known soft-404 patterns', () => {
  // Patterns Google flagged in GSC for `themegaradio.com`:
  //   - Dutch `nl/regio's/germany` (apostrophe in localized segment)
  //   - Genre slug junk like `genres/bassline"/>` (HTML attribute escape)
  //   - Stray ampersand `genres/r&b`
  const cases = [
    {
      input: "https://themegaradio.com/nl/regio's/germany",
      expected: 'https://themegaradio.com/nl/regio&apos;s/germany',
    },
    {
      input: 'https://themegaradio.com/en/genres/bassline"/>',
      expected: 'https://themegaradio.com/en/genres/bassline&quot;/&gt;',
    },
    {
      input: 'https://themegaradio.com/en/genres/r&b',
      expected: 'https://themegaradio.com/en/genres/r&amp;b',
    },
  ];
  for (const { input, expected } of cases) {
    const loc = `<loc>${escapeXml(input)}</loc>`;
    assert.equal(loc, `<loc>${expected}</loc>`);
    // Sanity: every one of the 5 raw entities must NOT appear bare inside <loc>.
    for (const ch of ['&amp;', '&lt;', '&gt;', '&quot;', '&apos;']) {
      // ok — all 5 escaped forms are valid; the assertion below is the strict one.
      void ch;
    }
    assert.match(loc, /^<loc>[^<>"'&]*?(&(amp|lt|gt|quot|apos);[^<>"'&]*)*<\/loc>$/);
  }
});

test('buildLocalizedUrl percent-encodes apostrophes in translated segments', () => {
  const map = new Map<string, string>([
    // Dutch translation of `regions` is `regio's` — has an apostrophe.
    ['nl:regions', "regio's"],
  ]);
  const out = buildLocalizedUrl('/regions/germany', 'nl', undefined, map);
  assert.equal(out, '/nl/regio%27s/germany');
});

test('buildLocalizedUrl preserves slash separators between segments', () => {
  const map = new Map<string, string>([
    ['de:regions', 'regionen'],
  ]);
  // `germany` has no translation entry → falls back to English literal.
  const out = buildLocalizedUrl('/regions/europe/germany', 'de', undefined, map);
  assert.equal(out, '/de/regionen/europe/germany');
});

test('buildLocalizedUrl with empty translation map still emits language prefix', () => {
  const out = buildLocalizedUrl('/genres/rock', 'tr');
  assert.equal(out, '/tr/genres/rock');
});

test('VALID_CONTINENT_SLUGS matches the RegionCountriesPage UI list exactly', () => {
  // Mirror of artifacts/megaradio/src/pages/RegionCountriesPage.tsx.
  // If the React UI gains a new continent slug we MUST add it here so the
  // SSR whitelist gate doesn't reject it as a soft-404.
  const expected = [
    'africa',
    'asia',
    'europe',
    'north-america',
    'south-america',
    'oceania',
  ];
  assert.deepEqual(
    [...VALID_CONTINENT_SLUGS].sort(),
    [...expected].sort(),
  );
});

test('validateRegionRouteShape: /regions index page is OK', () => {
  // `/regions` itself is the continent index — never a soft-404 candidate.
  assert.deepEqual(validateRegionRouteShape('/regions'), {
    ok: true, family: 'regions',
  });
});

test('validateRegionRouteShape: /regions/<unknown-continent> → notFound', () => {
  // The exact pattern Google flagged: `/regions/regio's/germany` arrives
  // URL-encoded as `/regions/regio%27s/germany`. Decode-then-whitelist
  // must reject it as `unknown-continent`, not silently SSR a thin page.
  const cases = [
    "/regions/regio's/germany",
    '/regions/regio%27s/germany',
    '/regions/foo',
    '/regions/antarctica/penguin-station',
  ];
  for (const path of cases) {
    const res = validateRegionRouteShape(path);
    assert.equal(res.ok, false, `expected ${path} to fail validation`);
    assert.equal(res.family, 'regions');
    assert.equal(res.reason, 'unknown-continent', `for ${path}`);
  }
});

test('validateRegionRouteShape: /regions/<continent>/<bad-country> → notFound', () => {
  const res = validateRegionRouteShape("/regions/europe/germany's");
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'bad-country-slug');
});

test('validateRegionRouteShape: valid /regions paths pass', () => {
  // Real continents from VALID_CONTINENT_SLUGS, with and without country.
  const valid = [
    '/regions/europe',
    '/regions/europe/germany',
    '/regions/north-america/united-states',
    '/regions/asia/japan/tokyo',
  ];
  for (const path of valid) {
    const res = validateRegionRouteShape(path);
    assert.equal(res.ok, true, `expected ${path} to pass validation`);
    assert.equal(res.family, 'regions');
  }
});

test('validateRegionRouteShape: /country/<country> does NOT apply continent whitelist', () => {
  // REGRESSION GUARD (v1 fix had this bug). `/country/germany` must NOT be
  // rejected as `unknown-continent` — it's a different route family with
  // no continent in the path. If this test fails we deindex every valid
  // country page in the catalog.
  const valid = [
    '/country/germany',
    '/country/united-states',
    '/country/japan/tokyo',
  ];
  for (const path of valid) {
    const res = validateRegionRouteShape(path);
    assert.equal(res.ok, true, `expected ${path} to pass validation`);
    assert.equal(res.family, 'country');
    assert.notEqual(res.reason, 'unknown-continent');
  }
});

test('validateRegionRouteShape: /country/<bad-slug> → notFound', () => {
  const cases: Array<[string, 'bad-country-slug' | 'bad-city-slug']> = [
    ["/country/germany's", 'bad-country-slug'],
    ['/country/germany%27s', 'bad-country-slug'],
    ['/country/germany!', 'bad-country-slug'],
    ['/country/germany/berlin!', 'bad-city-slug'],
  ];
  for (const [path, expectedReason] of cases) {
    const res = validateRegionRouteShape(path);
    assert.equal(res.ok, false, `expected ${path} to fail validation`);
    assert.equal(res.family, 'country');
    assert.equal(res.reason, expectedReason, `for ${path}`);
  }
});

test('validateRegionRouteShape: non-region/country paths are pass-through', () => {
  // The helper only opines on /regions and /country families. Everything
  // else returns family:null with ok:true so unrelated SSR branches keep
  // their existing behaviour.
  for (const path of ['/genres/rock', '/stations/bbc', '/', '/about']) {
    assert.deepEqual(validateRegionRouteShape(path), {
      ok: true, family: null,
    });
  }
});

test('isExactCountryPagePath: only the exact country page is country-level', () => {
  // REGRESSION GUARD (v2 fix had this bug). The empty-country soft-404
  // promotion in seo-renderer must ONLY fire on the exact country page,
  // never on station listings, city pages, or other deeper sub-pages.
  // The frontend route `/regions/:continent/:country/stations` MUST stay
  // 200 even when stations are sparse — derive `regionName` from the
  // last segment ("stations") and the country DB lookup would falsely
  // 404 every valid country-stations listing in the catalog.
  const exactCountryPages = [
    '/regions/europe/germany',
    '/regions/north-america/united-states',
    '/regions/asia/japan',
    '/country/germany',
    '/country/united-states',
  ];
  for (const path of exactCountryPages) {
    assert.equal(
      isExactCountryPagePath(path),
      true,
      `expected ${path} to be EXACT country page`,
    );
  }

  const notCountryLevel = [
    '/regions',                                   // continent index
    '/regions/europe',                            // continent page
    '/regions/europe/germany/stations',           // country station listing
    '/regions/europe/germany/berlin',             // city page
    '/regions/europe/germany/berlin/stations',    // city station listing
    '/country',                                   // country index
    '/country/germany/stations',                  // country station listing
    '/genres/rock',                               // unrelated route
    '/stations/bbc',                              // unrelated route
    '/',                                          // home
  ];
  for (const path of notCountryLevel) {
    assert.equal(
      isExactCountryPagePath(path),
      false,
      `expected ${path} to NOT be EXACT country page (would false-404)`,
    );
  }
});

test('SAFE_REGION_SLUG_RE accepts hyphenated alphanumeric and rejects junk', () => {
  for (const ok of ['germany', 'united-states', 'usa1', 'a-b-c-d']) {
    assert.match(ok, SAFE_REGION_SLUG_RE);
  }
  for (const bad of ["germany's", 'germany!', 'germ any', 'germany%27', '-germany', 'germany-', '']) {
    assert.doesNotMatch(bad, SAFE_REGION_SLUG_RE);
  }
});

test('decodeSegmentSafe handles malformed percent-encoding without throwing', () => {
  assert.equal(decodeSegmentSafe('regio%27s'), "regio's");
  assert.equal(decodeSegmentSafe('germany'), 'germany');
  // Stray `%` byte must NOT throw — fall back to raw.
  assert.equal(decodeSegmentSafe('foo%'), 'foo%');
  assert.equal(decodeSegmentSafe(undefined), undefined);
  assert.equal(decodeSegmentSafe(''), undefined);
});

test('VALID_CONTINENT_SLUGS rejects known soft-404 region slugs', () => {
  // These are the exact slugs surfaced in GSC `Crawled - currently not indexed`
  // reports for themegaradio.com. They MUST be rejected by the gate.
  const knownJunk = [
    "regio's",          // Dutch apostrophe — the bug that triggered task #127
    'foo',              // tag-noise typo
    'antarctica',       // not in UI
    'european-union',   // ambiguous slug
    '',                 // empty segment
  ];
  for (const slug of knownJunk) {
    assert.equal(
      VALID_CONTINENT_SLUGS.has(slug),
      false,
      `expected continent slug "${slug}" to be REJECTED by the whitelist gate`,
    );
  }
});
