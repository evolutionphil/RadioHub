/**
 * Task #268: regression coverage for the slug-shape 404 middleware.
 *
 * The middleware at `src/middleware/slug-shape-404.ts` is the only thing
 * that turns junk genre/station URLs into a real HTTP 404 for human
 * (non-bot) visitors. Without it, those URLs fall through to the SPA
 * shell with HTTP 200 and Google logs them as soft-404s. There were no
 * automated tests covering it before — a future refactor could silently
 * regress the behaviour and we'd only find out from a Search Console
 * traffic drop weeks later.
 *
 * These tests exercise the middleware end-to-end with the slug-existence
 * lookups injected via the `deps` parameter so we can flip the "ready"
 * flag and the known-slug sets deterministically. This avoids depending
 * on `--experimental-test-module-mocks`, which means the tests run under
 * a plain `tsx --test` invocation.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response, NextFunction } from 'express';

// ---------------------------------------------------------------------------
// Controllable stubs for the slug-existence module.
// ---------------------------------------------------------------------------

const stubState = {
  ready: false,
  stationSlugs: new Set<string>(),
  genreSlugs: new Set<string>(),
  countrySlugs: new Set<string>(),
  citySlugsByCountry: new Map<string, Set<string>>(),
};

const stubDeps = {
  isSlugExistenceReady: () => stubState.ready,
  hasStationSlug: (s: string) => stubState.stationSlugs.has(s),
  hasGenreSlug: (s: string) => stubState.genreSlugs.has(s),
  hasCountrySlug: (s: string) => stubState.countrySlugs.has(s),
  hasCitySlug: (country: string, city: string) =>
    stubState.citySlugsByCountry.get(country)?.has(city) ?? false,
  hasCityDataForCountry: (country: string) => {
    const set = stubState.citySlugsByCountry.get(country);
    return !!set && set.size > 0;
  },
};

// ---------------------------------------------------------------------------
// Helpers — drive the middleware with a synthetic req/res/next.
// ---------------------------------------------------------------------------

interface Outcome {
  /** True when the middleware called next() (i.e. the URL fell through). */
  fellThrough: boolean;
  /** HTTP status the middleware set. Only meaningful when fellThrough=false. */
  status?: number;
  /** Headers the middleware set on the response. */
  headers: Record<string, string>;
  /** Response body the middleware sent. */
  body?: string;
}

function makeReq(opts: {
  path: string;
  method?: string;
  userAgent?: string;
}): Request {
  const headers: Record<string, string> = {};
  if (opts.userAgent) headers['user-agent'] = opts.userAgent;
  return {
    method: opts.method ?? 'GET',
    path: opts.path,
    get(name: string): string | undefined {
      return headers[name.toLowerCase()];
    },
  } as unknown as Request;
}

function makeRes(): { res: Response; outcome: Outcome } {
  const outcome: Outcome = { fellThrough: false, headers: {} };
  const res = {
    status(code: number) {
      outcome.status = code;
      return res;
    },
    set(h: Record<string, string>) {
      Object.assign(outcome.headers, h);
      return res;
    },
    send(body: string) {
      outcome.body = body;
      return res;
    },
  } as unknown as Response;
  return { res, outcome };
}

type Middleware = (req: Request, res: Response, next: NextFunction) => void;

function run(mw: Middleware, req: Request): Outcome {
  const { res, outcome } = makeRes();
  mw(req, res, () => {
    outcome.fellThrough = true;
  });
  return outcome;
}

// ---------------------------------------------------------------------------
// Boot the middleware once with a representative slot of localized aliases.
// ---------------------------------------------------------------------------

let middleware: Middleware;

before(async () => {
  const mod = await import('../src/middleware/slug-shape-404.ts');
  middleware = mod.createSlugShape404Middleware(
    {
      regionsAlts: ['regions', 'regionen', "regio's"],
      genresAlts: ['genres', 'genres-de'],
      stationSingularAlts: ['station', 'sender'],
      stationsPluralAlts: ['stations', 'sendern'],
    },
    stubDeps,
  );
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('cold-start grace period: unknown genre slug falls through when existence set is not ready', () => {
  stubState.ready = false;
  stubState.genreSlugs = new Set();
  stubState.stationSlugs = new Set();

  const out = run(middleware, makeReq({ path: '/genres/totally-unknown' }));
  assert.equal(out.fellThrough, true, 'cold start must fall through to avoid false 404 storm');
});

test('cold-start grace period: unknown station slug falls through when existence set is not ready', () => {
  stubState.ready = false;
  stubState.stationSlugs = new Set();

  const out = run(middleware, makeReq({ path: '/station/totally-unknown' }));
  assert.equal(out.fellThrough, true);
});

test('unknown genre slug → 404 once existence set is loaded', () => {
  stubState.ready = true;
  stubState.genreSlugs = new Set(['pop', 'rock']);

  const out = run(middleware, makeReq({ path: '/genres/totally-unknown' }));
  assert.equal(out.fellThrough, false, 'unknown genre slug must be 404');
  assert.equal(out.status, 404);
  assert.match(out.headers['Content-Type'] ?? '', /text\/html/);
  assert.equal(out.headers['X-Robots-Tag'], 'noindex, follow');
});

test('valid genre slug falls through to the SPA', () => {
  stubState.ready = true;
  stubState.genreSlugs = new Set(['pop', 'rock']);

  const out = run(middleware, makeReq({ path: '/genres/pop' }));
  assert.equal(out.fellThrough, true);
});

test('unknown station slug → 404 once existence set is loaded (singular family)', () => {
  stubState.ready = true;
  stubState.stationSlugs = new Set(['known-fm']);

  const out = run(middleware, makeReq({ path: '/station/who-dis' }));
  assert.equal(out.fellThrough, false);
  assert.equal(out.status, 404);
});

test('unknown station slug → 404 once existence set is loaded (plural family)', () => {
  stubState.ready = true;
  stubState.stationSlugs = new Set(['known-fm']);

  const out = run(middleware, makeReq({ path: '/stations/who-dis' }));
  assert.equal(out.fellThrough, false);
  assert.equal(out.status, 404);
});

test('valid station slug falls through (singular and plural families, including alias localization)', () => {
  stubState.ready = true;
  stubState.stationSlugs = new Set(['known-fm']);

  for (const path of ['/station/known-fm', '/stations/known-fm', '/de/sender/known-fm']) {
    const out = run(middleware, makeReq({ path }));
    assert.equal(out.fellThrough, true, `${path} should fall through`);
  }
});

test('ObjectId-shaped /stations/<id> falls through even when slug is unknown', () => {
  stubState.ready = true;
  stubState.stationSlugs = new Set(); // intentionally empty

  // 24-char hex MongoDB ObjectId.
  const out = run(
    middleware,
    makeReq({ path: '/stations/507f1f77bcf86cd799439011' }),
  );
  assert.equal(out.fellThrough, true, 'by-id station URL must bypass the existence gate');
});

test('singular /station/<24-hex> stays gated (not a documented by-id route)', () => {
  stubState.ready = true;
  stubState.stationSlugs = new Set();

  const out = run(
    middleware,
    makeReq({ path: '/station/507f1f77bcf86cd799439011' }),
  );
  assert.equal(out.fellThrough, false);
  assert.equal(out.status, 404);
});

test('malformed percent-encoding → 404', () => {
  stubState.ready = true;

  const out = run(middleware, makeReq({ path: '/genres/%E0%A4%A' }));
  assert.equal(out.fellThrough, false);
  assert.equal(out.status, 404);
});

test('bot user-agents fall through to the SSR catch-all even on junk URLs', () => {
  stubState.ready = true;
  stubState.genreSlugs = new Set(['pop']);
  stubState.stationSlugs = new Set();

  const out = run(
    middleware,
    makeReq({
      path: '/genres/totally-unknown',
      userAgent:
        'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    }),
  );
  assert.equal(out.fellThrough, true, 'bots must skip the SPA-shell 404 and reach the SSR layer');
});

test('non-GET/HEAD requests fall through unchanged', () => {
  stubState.ready = true;

  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const out = run(middleware, makeReq({ path: '/genres/anything', method }));
    assert.equal(out.fellThrough, true, `${method} must fall through`);
  }
});

test('skip prefixes (/api, /assets, /healthz, …) always fall through', () => {
  stubState.ready = true;
  for (const path of [
    '/api/foo',
    '/api',
    '/healthz',
    '/admin',
    '/admin-login/anything',
    '/assets/main.js',
    '/fonts/ubuntu.woff2',
    '/station-images/x.png',
  ]) {
    const out = run(middleware, makeReq({ path }));
    assert.equal(out.fellThrough, true, `${path} must fall through (skip prefix)`);
  }
});

test('asset-extension URLs fall through regardless of family', () => {
  stubState.ready = true;
  for (const path of ['/genres/pop.css', '/regions/europe/whatever.svg', '/foo/bar.json']) {
    const out = run(middleware, makeReq({ path }));
    assert.equal(out.fellThrough, true, `${path} must fall through (asset)`);
  }
});

test('unknown 2-letter language prefix → 404 immediately', () => {
  stubState.ready = true;
  const out = run(middleware, makeReq({ path: '/xx/genres/pop' }));
  assert.equal(out.fellThrough, false);
  assert.equal(out.status, 404);
});

test('known language prefix is stripped before slug shape validation', () => {
  stubState.ready = true;
  stubState.genreSlugs = new Set(['pop']);

  const valid = run(middleware, makeReq({ path: '/de/genres/pop' }));
  assert.equal(valid.fellThrough, true, 'valid /de/genres/pop must fall through');

  const invalid = run(middleware, makeReq({ path: '/de/genres/totally-unknown' }));
  assert.equal(invalid.fellThrough, false);
  assert.equal(invalid.status, 404);
});

test('regions: unknown continent → 404', () => {
  stubState.ready = true;
  const out = run(middleware, makeReq({ path: '/regions/atlantis' }));
  assert.equal(out.fellThrough, false);
  assert.equal(out.status, 404);
});

test('regions: known continent → falls through', () => {
  stubState.ready = true;
  const out = run(middleware, makeReq({ path: '/regions/europe' }));
  assert.equal(out.fellThrough, true);
});

test('regions: malformed country slug → 404', () => {
  stubState.ready = true;
  const out = run(
    middleware,
    makeReq({ path: '/regions/europe/germany!!' }),
  );
  assert.equal(out.fellThrough, false);
  assert.equal(out.status, 404);
});

test('country: malformed slug → 404, well-formed known slug falls through', () => {
  stubState.ready = true;
  stubState.countrySlugs = new Set(['germany']);
  stubState.citySlugsByCountry = new Map();

  const bad = run(middleware, makeReq({ path: "/country/regio's" }));
  assert.equal(bad.fellThrough, false);
  assert.equal(bad.status, 404);

  const good = run(middleware, makeReq({ path: '/country/germany' }));
  assert.equal(good.fellThrough, true);
});

// ---------------------------------------------------------------------------
// Task #357: city slug existence gate.
// Mirrors the genre/station gates — shape-valid but DB-unknown city slugs
// under `/country/<country>/<city>` and `/regions/<continent>/<country>/<city>`
// must 404 once the existence set is loaded, while a known city or any city
// in a country we don't precompute cities for must still fall through.
// ---------------------------------------------------------------------------

test('cold-start grace period: unknown city slug falls through when existence set is not ready', () => {
  stubState.ready = false;
  stubState.countrySlugs = new Set(['germany']);
  stubState.citySlugsByCountry = new Map([
    ['germany', new Set(['berlin'])],
  ]);

  for (const path of [
    '/country/germany/who-dis',
    '/regions/europe/germany/who-dis',
  ]) {
    const out = run(middleware, makeReq({ path }));
    assert.equal(out.fellThrough, true, `${path} must fall through during cold start`);
  }
});

test('country: unknown city slug → 404 once existence set is loaded', () => {
  stubState.ready = true;
  stubState.countrySlugs = new Set(['germany']);
  stubState.citySlugsByCountry = new Map([
    ['germany', new Set(['berlin', 'munich'])],
  ]);

  const out = run(middleware, makeReq({ path: '/country/germany/who-dis' }));
  assert.equal(out.fellThrough, false, 'unknown city slug must be 404');
  assert.equal(out.status, 404);
  assert.equal(out.headers['X-Robots-Tag'], 'noindex, follow');
});

test('country: known city slug falls through to the SPA', () => {
  stubState.ready = true;
  stubState.countrySlugs = new Set(['germany']);
  stubState.citySlugsByCountry = new Map([
    ['germany', new Set(['berlin'])],
  ]);

  const out = run(middleware, makeReq({ path: '/country/germany/berlin' }));
  assert.equal(out.fellThrough, true);
});

test('country: /<country>/stations sentinel still falls through (not treated as city)', () => {
  stubState.ready = true;
  stubState.countrySlugs = new Set(['germany']);
  stubState.citySlugsByCountry = new Map([
    ['germany', new Set(['berlin'])],
  ]);

  const out = run(middleware, makeReq({ path: '/country/germany/stations' }));
  assert.equal(out.fellThrough, true);
});

test('country: city slug in a country with no precomputed city data falls through', () => {
  stubState.ready = true;
  stubState.countrySlugs = new Set(['germany', 'tuvalu']);
  stubState.citySlugsByCountry = new Map([
    ['germany', new Set(['berlin'])],
    // tuvalu intentionally omitted — no precomputed cities for it.
  ]);

  const out = run(middleware, makeReq({ path: '/country/tuvalu/anywhere' }));
  assert.equal(out.fellThrough, true, 'cities in countries we do not list must not false-404');
});

test('regions: unknown city slug under known country → 404 once existence set is loaded', () => {
  stubState.ready = true;
  stubState.countrySlugs = new Set(['germany']);
  stubState.citySlugsByCountry = new Map([
    ['germany', new Set(['berlin'])],
  ]);

  const out = run(
    middleware,
    makeReq({ path: '/regions/europe/germany/who-dis' }),
  );
  assert.equal(out.fellThrough, false);
  assert.equal(out.status, 404);
});

test('regions: known city slug falls through to the SPA', () => {
  stubState.ready = true;
  stubState.countrySlugs = new Set(['germany']);
  stubState.citySlugsByCountry = new Map([
    ['germany', new Set(['berlin'])],
  ]);

  const out = run(
    middleware,
    makeReq({ path: '/regions/europe/germany/berlin' }),
  );
  assert.equal(out.fellThrough, true);
});

test('regions: /<continent>/<country>/stations sentinel still falls through', () => {
  stubState.ready = true;
  stubState.countrySlugs = new Set(['germany']);
  stubState.citySlugsByCountry = new Map([
    ['germany', new Set(['berlin'])],
  ]);

  const out = run(
    middleware,
    makeReq({ path: '/regions/europe/germany/stations' }),
  );
  assert.equal(out.fellThrough, true);
});

test('root path falls through', () => {
  stubState.ready = true;
  const out = run(middleware, makeReq({ path: '/' }));
  assert.equal(out.fellThrough, true);
});

// ---------------------------------------------------------------------------
// Task #364: country/city existence gate fires for localized regions aliases
// too — `/de/regionen/europa/<unknown>` and `/nl/regio's/europe/<unknown>`
// must 404 the same way `/regions/europe/<unknown>` does.
// ---------------------------------------------------------------------------

test('regions: unknown country slug → 404 once existence set is loaded', () => {
  stubState.ready = true;
  stubState.countrySlugs = new Set(['germany']);
  stubState.citySlugsByCountry = new Map();

  const out = run(middleware, makeReq({ path: '/regions/europe/atlantis' }));
  assert.equal(out.fellThrough, false);
  assert.equal(out.status, 404);
});

test('regions: known country slug falls through', () => {
  stubState.ready = true;
  stubState.countrySlugs = new Set(['germany']);
  stubState.citySlugsByCountry = new Map();

  const out = run(middleware, makeReq({ path: '/regions/europe/germany' }));
  assert.equal(out.fellThrough, true);
});

test('localized regions alias: unknown country slug → 404 (German /regionen)', () => {
  stubState.ready = true;
  stubState.countrySlugs = new Set(['germany']);
  stubState.citySlugsByCountry = new Map();

  const out = run(
    middleware,
    makeReq({ path: '/de/regionen/europa/atlantis' }),
  );
  assert.equal(out.fellThrough, false, 'unknown country under /regionen must 404');
  assert.equal(out.status, 404);
});

test("localized regions alias: unknown country slug → 404 (Dutch /regio's)", () => {
  stubState.ready = true;
  stubState.countrySlugs = new Set(['germany']);
  stubState.citySlugsByCountry = new Map();

  const out = run(
    middleware,
    makeReq({ path: "/nl/regio's/europa/atlantis" }),
  );
  assert.equal(out.fellThrough, false);
  assert.equal(out.status, 404);
});

test('localized regions alias: valid country slug falls through (German /regionen)', () => {
  stubState.ready = true;
  stubState.countrySlugs = new Set(['germany']);
  stubState.citySlugsByCountry = new Map();

  const out = run(
    middleware,
    makeReq({ path: '/de/regionen/europa/germany' }),
  );
  assert.equal(out.fellThrough, true, 'valid country under /regionen must fall through');
});

test('localized regions alias: unknown city slug → 404 when country has city data', () => {
  stubState.ready = true;
  stubState.countrySlugs = new Set(['germany']);
  stubState.citySlugsByCountry = new Map([
    ['germany', new Set(['berlin', 'munich'])],
  ]);

  const out = run(
    middleware,
    makeReq({ path: '/de/regionen/europa/germany/atlantis-city' }),
  );
  assert.equal(out.fellThrough, false);
  assert.equal(out.status, 404);
});

test('localized regions alias: known city slug falls through', () => {
  stubState.ready = true;
  stubState.countrySlugs = new Set(['germany']);
  stubState.citySlugsByCountry = new Map([
    ['germany', new Set(['berlin', 'munich'])],
  ]);

  const out = run(
    middleware,
    makeReq({ path: '/de/regionen/europa/germany/berlin' }),
  );
  assert.equal(out.fellThrough, true);
});
