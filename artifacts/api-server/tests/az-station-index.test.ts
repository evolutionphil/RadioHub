/**
 * Task #11 (2026-07-03): A-Z station index pages.
 *
 * Three layers must agree on what an A-Z letter URL is, or the pages are
 * unreachable in production:
 *
 *   1. `url-redirect-middleware` must NOT collapse /en/stations/a onto the
 *      station-detail singular (/en/station/a) — the pre-existing Step 6
 *      behaviour for every other 3-segment station path — and must instead
 *      canonicalize detail-form letter URLs onto the plural LIST segment.
 *   2. `slug-shape-404` must NOT 404 the letter key for human visitors
 *      (letters are not in the station slug-existence set).
 *   3. `buildLocalizedUrl` / hreflang must translate the `stations` segment
 *      but never the letter key, so canonical == sitemap == hreflang.
 *
 * All three are exercised here without a DB: the redirect middleware's DB
 * translation lookup has a 2s race-timeout that falls back to the static
 * URL_TRANSLATIONS table, and slug-shape-404 takes injected existence stubs.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response, NextFunction } from 'express';

import {
  AZ_INDEX_KEYS,
  AZ_KEY_RE,
  azDisplayLabel,
  azSlugBounds,
  matchAzIndexPath,
} from '../src/seo/az-station-index';

// ---------------------------------------------------------------------------
// Pure helper coverage
// ---------------------------------------------------------------------------

test('AZ_INDEX_KEYS is the 26 letters plus the 0-9 bucket', () => {
  assert.equal(AZ_INDEX_KEYS.length, 27);
  assert.equal(new Set(AZ_INDEX_KEYS).size, 27);
  for (const k of AZ_INDEX_KEYS) {
    assert.match(k, AZ_KEY_RE, `key ${k} must match AZ_KEY_RE`);
  }
  assert.ok(AZ_INDEX_KEYS.includes('0-9'));
});

test('azSlugBounds produces contiguous, non-overlapping half-open ranges', () => {
  assert.deepEqual(azSlugBounds('a'), { gte: 'a', lt: 'b' });
  assert.deepEqual(azSlugBounds('z'), { gte: 'z', lt: '{' }); // '{' follows 'z' in ASCII
  assert.deepEqual(azSlugBounds('0-9'), { gte: '0', lt: ':' }); // ':' follows '9' in ASCII
  // Every lowercase-ASCII slug lands in exactly one bucket.
  for (const slug of ['abba-radio', 'zz-top-fm', '0nline', '95-9-fm', 'q']) {
    const buckets = AZ_INDEX_KEYS.filter((k) => {
      const { gte, lt } = azSlugBounds(k);
      return slug >= gte && slug < lt;
    });
    assert.equal(buckets.length, 1, `${slug} must fall into exactly one bucket, got [${buckets}]`);
  }
});

test('azDisplayLabel uppercases letters and passes 0-9 through', () => {
  assert.equal(azDisplayLabel('a'), 'A');
  assert.equal(azDisplayLabel('0-9'), '0-9');
});

test('matchAzIndexPath accepts singular/plural letter paths only', () => {
  assert.equal(matchAzIndexPath('/stations/a'), 'a');
  assert.equal(matchAzIndexPath('/station/z'), 'z');
  assert.equal(matchAzIndexPath('/stations/0-9'), '0-9');
  assert.equal(matchAzIndexPath('/stations'), null);
  assert.equal(matchAzIndexPath('/stations/ab'), null);
  assert.equal(matchAzIndexPath('/stations/a/b'), null);
  assert.equal(matchAzIndexPath('/station/glamradio'), null);
  assert.equal(matchAzIndexPath('/genres/a'), null);
});

// ---------------------------------------------------------------------------
// URL builders: letter key is never translated, `stations` segment is
// ---------------------------------------------------------------------------

test('buildLocalizedUrl localizes the stations segment but not the letter', async () => {
  const { buildLocalizedUrl } = await import('../src/seo/url-helpers');
  // Static-table fallback path (empty DB map) — mirrors production fallback.
  const emptyMap = new Map<string, string>();
  assert.equal(buildLocalizedUrl('/stations/a', 'tr', undefined, emptyMap), '/tr/istasyonlar/a');
  assert.equal(buildLocalizedUrl('/stations/0-9', 'de', undefined, emptyMap), '/de/sender/0-9');
  assert.equal(buildLocalizedUrl('/stations/m', 'en', undefined, emptyMap), '/en/stations/m');
});

test('hreflang alternates keep the letter key raw in every language', async () => {
  const { generateLanguageUrls } = await import('@workspace/seo-shared/seo-config');
  const alternates = generateLanguageUrls('/stations/b', 'https://themegaradio.com', 'en');
  assert.ok(alternates.length > 0, 'expected at least one hreflang alternate');
  for (const alt of alternates) {
    assert.match(
      alt.url,
      /\/b$/,
      `alternate ${alt.hreflang} (${alt.url}) must end with the untranslated letter`,
    );
  }
});

// ---------------------------------------------------------------------------
// Redirect middleware: A-Z exemption + regression on normal detail collapse
// ---------------------------------------------------------------------------

type RedirectOutcome = { redirected: false } | { redirected: true; code: number; target: string };

function makeRedirectReq(url: string): Request {
  const qIdx = url.indexOf('?');
  const path = qIdx >= 0 ? url.slice(0, qIdx) : url;
  const query: Record<string, string> = {};
  if (qIdx >= 0) {
    for (const [k, v] of new URLSearchParams(url.slice(qIdx + 1))) query[k] = v;
  }
  return {
    path,
    originalUrl: url,
    url,
    query,
    headers: {},
    get: () => undefined,
  } as unknown as Request;
}

async function runRedirect(url: string): Promise<RedirectOutcome> {
  const { urlRedirectMiddleware } = await import('../src/url-redirect-middleware');
  let outcome: RedirectOutcome = { redirected: false };
  const res = {
    redirect(code: number, target: string) {
      outcome = { redirected: true, code, target };
    },
    setHeader() {
      return res;
    },
  } as unknown as Response;
  let fellThrough = false;
  await urlRedirectMiddleware(makeRedirectReq(url), res, (() => {
    fellThrough = true;
  }) as NextFunction);
  assert.ok(fellThrough || outcome.redirected, 'middleware must either redirect or call next()');
  return outcome;
}

test('A-Z: canonical letter URL /en/stations/a serves (no redirect)', async () => {
  const out = await runRedirect('/en/stations/a');
  assert.equal(out.redirected, false, `expected pass-through, got ${JSON.stringify(out)}`);
});

test('A-Z: /en/stations/0-9 serves (no redirect)', async () => {
  const out = await runRedirect('/en/stations/0-9');
  assert.equal(out.redirected, false, `expected pass-through, got ${JSON.stringify(out)}`);
});

test('A-Z: detail-form /en/station/a 301s to the list canonical /en/stations/a', async () => {
  const out = await runRedirect('/en/station/a');
  assert.ok(out.redirected, 'expected a 301');
  assert.equal(out.code, 301);
  assert.equal(out.target, '/en/stations/a');
});

test('A-Z: /en/radios/q 301s to /en/stations/q', async () => {
  const out = await runRedirect('/en/radios/q');
  assert.ok(out.redirected, 'expected a 301');
  assert.equal(out.target, '/en/stations/q');
});

test('A-Z: localized detail-form /tr/istasyon/m 301s to /tr/istasyonlar/m', async () => {
  const out = await runRedirect('/tr/istasyon/m');
  assert.ok(out.redirected, 'expected a 301');
  assert.equal(out.target, '/tr/istasyonlar/m');
});

test('A-Z: old-English /tr/station/b 301s straight to /tr/istasyonlar/b (single hop)', async () => {
  const out = await runRedirect('/tr/station/b');
  assert.ok(out.redirected, 'expected a 301');
  assert.equal(out.target, '/tr/istasyonlar/b');
});

test('regression: multi-char slugs still collapse onto the detail singular', async () => {
  const out = await runRedirect('/en/stations/glamradio');
  assert.ok(out.redirected, 'expected a 301');
  assert.equal(out.target, '/en/station/glamradio');
});

test('regression: 2-segment list pages are untouched by the A-Z branch', async () => {
  const out = await runRedirect('/en/stations');
  assert.equal(out.redirected, false, `expected pass-through, got ${JSON.stringify(out)}`);
});

// ---------------------------------------------------------------------------
// slug-shape-404: letters must not hit the station-existence gate
// ---------------------------------------------------------------------------

const stubState = {
  ready: true,
  stationSlugs: new Set<string>(['glamradio']),
};

let shapeMiddleware: (req: Request, res: Response, next: NextFunction) => void;

before(async () => {
  const mod = await import('../src/middleware/slug-shape-404');
  shapeMiddleware = mod.createSlugShape404Middleware(
    {
      regionsAlts: ['regions'],
      genresAlts: ['genres'],
      stationSingularAlts: ['station', 'istasyon'],
      stationsPluralAlts: ['stations', 'istasyonlar'],
    },
    {
      isSlugExistenceReady: () => stubState.ready,
      hasStationSlug: (s: string) => stubState.stationSlugs.has(s),
      hasGenreSlug: () => false,
      hasCountrySlug: () => false,
      hasCitySlug: () => false,
      hasCityDataForCountry: () => false,
    },
  );
});

function runShape(path: string): { fellThrough: boolean; status?: number } {
  const outcome: { fellThrough: boolean; status?: number } = { fellThrough: false };
  const req = {
    method: 'GET',
    path,
    get: () => undefined,
  } as unknown as Request;
  const res = {
    status(code: number) {
      outcome.status = code;
      return res;
    },
    set() {
      return res;
    },
    send() {
      return res;
    },
  } as unknown as Response;
  shapeMiddleware(req, res, () => {
    outcome.fellThrough = true;
  });
  return outcome;
}

test('slug-shape-404: /en/stations/a falls through for human visitors', () => {
  const out = runShape('/en/stations/a');
  assert.equal(out.fellThrough, true, 'letter page must not 404');
});

test('slug-shape-404: /tr/istasyonlar/0-9 falls through (localized plural)', () => {
  const out = runShape('/tr/istasyonlar/0-9');
  assert.equal(out.fellThrough, true);
});

test('slug-shape-404: unknown multi-char station slug still 404s', () => {
  const out = runShape('/en/stations/definitely-not-a-station');
  assert.equal(out.fellThrough, false);
  assert.equal(out.status, 404);
});

test('slug-shape-404: known station slug still falls through', () => {
  const out = runShape('/en/station/glamradio');
  assert.equal(out.fellThrough, true);
});
