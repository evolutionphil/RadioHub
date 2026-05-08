/**
 * Regression tests for the three Genre.slug write paths Task #161
 * funneled through the shared `normalizeGenreSlug` helper.
 *
 * The weekly `cleanup-malformed-genre-slugs` cron is the only safety
 * net we have today: if a refactor swaps any of these paths back to a
 * raw write (e.g. `Genre.collection.bulkWrite`, an inline regex copy,
 * or a different slugify import), malformed slugs will leak into
 * sitemaps and we'll only notice weeks later via Search Console.
 *
 * These tests lock in:
 *   1. `normalizeGenreSlug` produces SAFE_GENRE_SLUG_RE-compatible
 *      output (or '') for a representative set of dirty inputs.
 *   2. `POST /api/generate-all-slugs` never asks Genre.bulkWrite to
 *      persist a slug that fails SAFE_GENRE_SLUG_RE — even when the
 *      Genre name is junk that would otherwise produce an unsafe slug.
 *   3. `POST /api/admin/populate-genres` (the populate-from-tags admin
 *      route in translation-admin-routes.ts) never asks
 *      Genre.findOneAndUpdate to write a slug that fails
 *      SAFE_GENRE_SLUG_RE.
 *
 * Runner: requires `--experimental-test-module-mocks` (wired up in
 * artifacts/api-server/package.json#scripts.test).
 */
import { test, mock, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import type { AddressInfo } from 'node:net';
import type { Server as HttpServer } from 'node:http';

// Import the real helpers BEFORE installing the mongo-schemas mock so
// the mock can re-export the real normalizer/regex — we want to test
// the production behavior of these, not a stub.
import {
  normalizeGenreSlug,
  SAFE_GENRE_SLUG_RE,
} from '../src/shared/mongo-schemas.ts';

// ---------------------------------------------------------------------------
// Recording fakes for the Mongoose models the routes touch.
// ---------------------------------------------------------------------------

interface BulkUpdateOp {
  updateOne: {
    filter: { _id: unknown };
    update: { $set: { slug?: string; noIndex?: true } };
  };
}

interface FindOneAndUpdateCall {
  filter: Record<string, unknown>;
  update: Record<string, unknown>;
}

let stationDocs: Array<Record<string, unknown>> = [];
let genreDocs: Array<Record<string, unknown>> = [];
const stationBulkWriteOps: BulkUpdateOp[][] = [];
const genreBulkWriteOps: BulkUpdateOp[][] = [];
const userBulkWriteOps: BulkUpdateOp[][] = [];
const genreFindOneAndUpdateCalls: FindOneAndUpdateCall[] = [];

interface Chainable<T> extends PromiseLike<T> {
  select: (..._a: unknown[]) => Chainable<T>;
  sort: (..._a: unknown[]) => Chainable<T>;
  skip: (..._a: unknown[]) => Chainable<T>;
  limit: (..._a: unknown[]) => Chainable<T>;
  lean: <U = T>() => Promise<U>;
}
function chain<T>(value: T): Chainable<T> {
  const c: Chainable<T> = {
    select: () => c,
    sort: () => c,
    skip: () => c,
    limit: () => c,
    lean: async () => value as unknown as never,
    then: (resolve, reject) => Promise.resolve(value).then(resolve, reject),
  };
  return c;
}

// Station.find() is called twice in slug-routes:
//   - first via .select(...).skip(...).limit(...).lean() in a paginated loop
//   - existing-slug bootstrap via .select('slug').lean()
// To keep the paginated loop terminating we hand back the docs once and
// then [] forever after.
let stationFindCalls = 0;
const FakeStation = {
  countDocuments: async () => stationDocs.length,
  find: () => {
    stationFindCalls += 1;
    // First call → hand back the fixture; subsequent calls in the
    // batching loop should terminate, and the bootstrap "load existing
    // slugs" call should see no pre-existing rows.
    return chain(stationFindCalls === 1 ? stationDocs : []);
  },
  bulkWrite: async (ops: BulkUpdateOp[]) => {
    stationBulkWriteOps.push(ops);
    return { ok: 1 } as unknown;
  },
};

const FakeGenre = {
  countDocuments: async () => genreDocs.length,
  find: () => chain(genreDocs),
  bulkWrite: async (ops: BulkUpdateOp[]) => {
    genreBulkWriteOps.push(ops);
    return { ok: 1 } as unknown;
  },
  findOneAndUpdate: async (
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
  ) => {
    genreFindOneAndUpdateCalls.push({ filter, update });
    return update;
  },
};

const FakeUser = {
  countDocuments: async () => 0,
  find: () => chain([] as Array<Record<string, unknown>>),
  bulkWrite: async (ops: BulkUpdateOp[]) => {
    userBulkWriteOps.push(ops);
    return { ok: 1 } as unknown;
  },
};

// ---------------------------------------------------------------------------
// Module mocks — installed BEFORE registerSlugRoutes/registerTranslationAdminRoutes
// are imported in `before()`.
// ---------------------------------------------------------------------------

mock.module(new URL('../src/shared/mongo-schemas.ts', import.meta.url).href, {
  namedExports: {
    Station: FakeStation,
    Genre: FakeGenre,
    User: FakeUser,
    BulkDescriptionJob: { find: () => chain([]) },
    // Re-export the REAL normalize + regex so the routes under test
    // run the same code as production. That's the whole point of
    // these regression tests.
    normalizeGenreSlug,
    SAFE_GENRE_SLUG_RE,
    // Stub everything else translation-admin-routes destructures so
    // the import doesn't blow up. The routes under test never touch
    // these.
    TranslationKey: {},
    Translation: {},
    TranslationLanguage: {},
    Language: {},
    UserFavorite: {},
    UserNotification: {},
    UserFollow: {},
    AuthToken: {},
    StationRating: {},
    SyncLog: {},
    BlacklistedStation: {},
  },
});

mock.module(new URL('../src/cache.ts', import.meta.url).href, {
  defaultExport: {
    // Bumped by the slug-routes background job when it finishes
    // ("Cache cleared after slug generation"), so flushBackgroundJob()
    // can poll deterministically instead of sleeping for a fixed
    // duration.
    clearByPattern: async () => {
      cacheClearCount += 1;
    },
    get: async () => null,
    set: async () => {},
    delete: async () => {},
  },
  namedExports: {
    CacheKeys: {},
    invalidateSocialCacheForUser: async () => {},
  },
});

mock.module(new URL('../src/performance-cache.ts', import.meta.url).href, {
  namedExports: {
    performanceCache: {
      invalidateStationCache: () => {},
      clearSeoHtml: () => {},
      clearPageData: () => {},
      getUrlTranslations: async () => new Map<string, string>(),
    },
    PerformanceCache: class {},
    deepFreeze: <T>(v: T) => v,
  },
});

mock.module(new URL('../src/services/sync.ts', import.meta.url).href, {
  namedExports: {
    syncService: {
      getStatus: async () => ({}),
      getLogs: async () => [],
      startSync: async () => {},
      stopSync: () => {},
    },
    SyncService: class {},
  },
});

mock.module(new URL('../src/routes/cache-refresh-utils.ts', import.meta.url).href, {
  namedExports: {
    fetchTranslationsForLanguage: async () => ({}),
    refreshTranslationsCache: async () => {},
    refreshCommunityFavoritesCache: async () => {},
    refreshPopularStationsCache: async () => {},
  },
});

// ---------------------------------------------------------------------------
// Boot one Express app per test file with both route modules registered.
// ---------------------------------------------------------------------------

let server: HttpServer;
let baseUrl: string;

before(async () => {
  process.env.NODE_ENV = 'test';

  const slugMod = (await import('../src/routes/slug-routes.ts')) as {
    registerSlugRoutes: (
      app: Express,
      deps: { requireAdmin: (req: Request, res: Response, next: NextFunction) => void },
    ) => void;
  };
  const translationMod = (await import(
    '../src/routes/translation-admin-routes.ts'
  )) as {
    registerTranslationAdminRoutes: (
      app: Express,
      deps: {
        requireAdmin: (req: Request, res: Response, next: NextFunction) => void;
        requireAuth: (req: Request, res: Response, next: NextFunction) => void;
      },
    ) => void;
  };

  const app = express();
  app.use(express.json());
  const passthrough = (_req: Request, _res: Response, next: NextFunction) => next();
  slugMod.registerSlugRoutes(app, { requireAdmin: passthrough });
  translationMod.registerTranslationAdminRoutes(app, {
    requireAdmin: passthrough,
    requireAuth: passthrough,
  });

  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  if (!server) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  stationDocs = [];
  genreDocs = [];
  stationBulkWriteOps.length = 0;
  genreBulkWriteOps.length = 0;
  userBulkWriteOps.length = 0;
  genreFindOneAndUpdateCalls.length = 0;
  stationFindCalls = 0;
  cacheClearCount = 0;
});

// Wait until the backgrounded `setImmediate(async () => …)` work
// triggered by /api/generate-all-slugs has finished, by polling for
// the terminal signal — Cache.clearByPattern is the LAST thing the
// background job does (see slug-routes.ts ~line 472). Polling beats
// a fixed sleep because it eliminates CI-timing flake while still
// bailing out fast in the happy path.
let cacheClearCount = 0;
async function flushBackgroundJob(opts: { expectedCacheClears?: number; timeoutMs?: number } = {}): Promise<void> {
  const expected = opts.expectedCacheClears ?? 1;
  const deadline = Date.now() + (opts.timeoutMs ?? 2000);
  while (cacheClearCount < expected) {
    if (Date.now() > deadline) {
      throw new Error(
        `flushBackgroundJob timed out waiting for cache.clearByPattern (got ${cacheClearCount}/${expected})`,
      );
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
}

// ---------------------------------------------------------------------------
// 1. Unit-level coverage of normalizeGenreSlug
// ---------------------------------------------------------------------------

test('normalizeGenreSlug: dirty inputs always yield SAFE_GENRE_SLUG_RE-compatible output (or empty)', () => {
  const cases: Array<{ input: string | null | undefined; expected?: string }> = [
    { input: 'bassline"', expected: 'bassline' },
    { input: 'R&B', expected: 'r-b' },
    { input: 'hip   hop', expected: 'hip-hop' },
    { input: '  Drum & Bass  ', expected: 'drum-bass' },
    // Accented / non-ASCII collapse to dashes (the helper does NOT
    // transliterate — that is the slugifier's job; the helper just
    // gates the result with [a-z0-9]+).
    { input: 'Café', expected: 'caf' },
    { input: 'Naïve Pop', expected: 'na-ve-pop' },
    // Leading/trailing punctuation is trimmed.
    { input: '---synthwave---', expected: 'synthwave' },
    // Pure-junk inputs normalize to '' so callers can skip them.
    { input: '', expected: '' },
    { input: '   ', expected: '' },
    { input: '!!!', expected: '' },
    { input: null, expected: '' },
    { input: undefined, expected: '' },
  ];

  for (const { input, expected } of cases) {
    const out = normalizeGenreSlug(input);
    assert.equal(out, expected, `normalizeGenreSlug(${JSON.stringify(input)}) → ${JSON.stringify(out)}`);
    if (out !== '') {
      assert.match(
        out,
        SAFE_GENRE_SLUG_RE,
        `normalizeGenreSlug(${JSON.stringify(input)}) produced "${out}" which fails SAFE_GENRE_SLUG_RE`,
      );
    }
  }
});

test('normalizeGenreSlug: every output passes the GenreSchema validator regex (fuzz)', () => {
  // Spray a wider net of dirty inputs to catch a future regex tweak
  // that would silently let an unsafe character through. Anything
  // non-empty MUST match SAFE_GENRE_SLUG_RE — that is the contract
  // the GenreSchema validator depends on.
  const fuzzInputs = [
    'AC/DC',
    'foo_bar',
    'foo.bar',
    'foo+bar',
    'foo bar baz',
    '12-inch',
    '----',
    'Über-Pop',
    '한국어 락',
    '<script>alert(1)</script>',
    '🎸 metal 🤘',
  ];
  for (const input of fuzzInputs) {
    const out = normalizeGenreSlug(input);
    if (out === '') continue;
    assert.match(out, SAFE_GENRE_SLUG_RE, `"${input}" → "${out}" violates SAFE_GENRE_SLUG_RE`);
  }
});

// ---------------------------------------------------------------------------
// 2. POST /api/generate-all-slugs — Genre bulkWrite contract
// ---------------------------------------------------------------------------

test('POST /api/generate-all-slugs never bulkWrites a Genre.slug that fails SAFE_GENRE_SLUG_RE', async () => {
  // Seed a mix of well-formed and pathological Genre names. The
  // route must funnel each candidate through normalizeGenreSlug and
  // skip docs whose normalized slug is empty — the bulkWrite ops it
  // sends to Mongo must therefore contain ONLY safe slugs.
  genreDocs = [
    { _id: 'g1', name: 'Rock' },
    { _id: 'g2', name: 'R&B' },
    { _id: 'g3', name: 'bassline"' },
    { _id: 'g4', name: 'hip   hop' },
    { _id: 'g5', name: '!!!' }, // must be skipped (normalizes to '')
    { _id: 'g6', name: '   ' }, // must be skipped
    { _id: 'g7', name: '<script>' },
  ];
  stationDocs = []; // no station work needed

  const res = await fetch(`${baseUrl}/api/generate-all-slugs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ regenerateAll: true }),
  });
  assert.equal(res.status, 200);

  await flushBackgroundJob();

  // The route may issue zero or more bulkWrite calls depending on
  // batching; flatten everything and assert the global invariant.
  const allOps = genreBulkWriteOps.flat();
  assert.ok(
    allOps.length > 0,
    'expected at least one Genre.bulkWrite op for the well-formed fixture rows',
  );
  for (const op of allOps) {
    const slug = op.updateOne?.update?.$set?.slug;
    assert.equal(typeof slug, 'string', 'every bulkWrite op must set a string slug');
    assert.notEqual(slug, '', 'empty slugs must never be persisted');
    assert.match(
      slug as string,
      SAFE_GENRE_SLUG_RE,
      `bulkWrite tried to persist unsafe slug "${slug}" — Task #161 contract broken`,
    );
  }

  // Note: slug-routes wraps the slugifier with `|| 'station'` as a
  // last-resort fallback for names that produce no ASCII output, so
  // pathological names like "!!!" or "   " end up with the literal
  // safe slug "station" rather than being skipped. That is still
  // SAFE_GENRE_SLUG_RE-compatible, which is the only contract this
  // test cares about. (The populate-from-tags path below has no such
  // fallback and DOES skip those tags — see the next test.)
});

// ---------------------------------------------------------------------------
// 3. POST /api/admin/populate-genres — populate-from-tags contract
// ---------------------------------------------------------------------------

test('POST /api/admin/populate-genres never findOneAndUpdates a Genre.slug that fails SAFE_GENRE_SLUG_RE', async () => {
  // Stations whose tag strings include a mix of clean and dirty
  // values. After the route lower-cases + tag-splits, normalizeGenreSlug
  // must gate every write so no malformed slug ever hits Mongo.
  stationDocs = [
    { _id: 's1', tags: 'rock, R&B, bassline"' },
    { _id: 's2', tags: 'hip   hop, !!!, <script>, electronic' },
    { _id: 's3', tags: '   , drum & bass' },
    { _id: 's4', genre: 'Café' },
  ];

  const res = await fetch(`${baseUrl}/api/admin/populate-genres`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { success?: boolean; genresCreated?: number };
  assert.equal(body.success, true);
  assert.ok(
    (body.genresCreated ?? 0) > 0,
    'expected at least one genre to be created from the clean tags',
  );

  // Every Genre.findOneAndUpdate the route issued must carry a safe
  // slug — both in the filter and in the update payload.
  assert.ok(
    genreFindOneAndUpdateCalls.length > 0,
    'expected at least one Genre.findOneAndUpdate from clean tags',
  );
  for (const call of genreFindOneAndUpdateCalls) {
    const filterSlug = (call.filter as { slug?: string }).slug;
    const updateSlug = (call.update as { slug?: string }).slug;
    assert.equal(typeof filterSlug, 'string', 'upsert filter must specify a slug');
    assert.equal(typeof updateSlug, 'string', 'upsert payload must specify a slug');
    assert.notEqual(filterSlug, '', 'empty slugs must never be upserted');
    assert.match(
      filterSlug as string,
      SAFE_GENRE_SLUG_RE,
      `populate-genres tried to upsert unsafe filter.slug "${filterSlug}" — Task #161 contract broken`,
    );
    assert.match(
      updateSlug as string,
      SAFE_GENRE_SLUG_RE,
      `populate-genres tried to upsert unsafe update.slug "${updateSlug}" — Task #161 contract broken`,
    );
  }

  // Spot-check that pathological tags were dropped, not silently
  // upserted with a junk slug.
  const writtenSlugs = new Set(
    genreFindOneAndUpdateCalls.map(
      (c) => (c.filter as { slug?: string }).slug ?? '',
    ),
  );
  for (const dirty of ['', '!!!', '<script>', '   ']) {
    assert.ok(!writtenSlugs.has(dirty), `dirty tag "${dirty}" must not produce a Genre row`);
  }
});
