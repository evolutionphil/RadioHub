/**
 * Regression tests for the Genre.stationCount recompute service (Task #250).
 *
 * Locks in the freshness guarantee admins rely on after bulk imports,
 * deletes, coverage backfills and tag re-checks:
 *
 *   1. `recomputeGenreStationCounts` rewrites `Genre.stationCount` from
 *      the live Station collection — including the genre field AND the
 *      comma-separated tags string, lowercased and de-duplicated, exactly
 *      the way `precomputed-genres.ts` computes the public listing.
 *
 *   2. Concurrent calls (e.g. a finishing bulk import + an admin clicking
 *      "Refresh counts") are coalesced — only one aggregation runs at a
 *      time and both callers see the same in-flight promise.
 *
 *   3. `POST /api/admin/genre-whitelist/recompute-counts` returns the
 *      updated status payload (lastRecomputedAt, lastUpdatedSlugs, …).
 *
 * Runner: requires `--experimental-test-module-mocks` (wired up in
 * artifacts/api-server/package.json#scripts.test).
 */
import { test, mock, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createNativePostgresFixture } from './helpers/native-postgres-fixture';
import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from 'express';
import type { AddressInfo } from 'node:net';
import type { Server as HttpServer } from 'node:http';

// ---------------------------------------------------------------------------
// Seeded in-memory Station + Genre collections.
// ---------------------------------------------------------------------------

interface FakeStation {
  genre?: string | null;
  tags?: string | null;
}

interface FakeGenre {
  _id: string;
  slug: string;
  stationCount: number;
}

let stations: FakeStation[] = [];
let genres: FakeGenre[] = [];

let fixture: Awaited<ReturnType<typeof createNativePostgresFixture>>;
async function seedFixtures(){
  for(const [index,station] of stations.entries())await fixture.insert('stations',{_id:'s'+index,stationuuid:'uuid-'+index,name:'Station '+index,url:'https://example.invalid/'+index,...station});
  for(const genre of genres)await fixture.insert('genres',{name:genre.slug,...genre});
}
async function storedCounts(){return new Map<string,number>((await fixture.pool.query('SELECT id,station_count FROM genres')).rows.map(row=>[row.id,row.station_count]));}
async function recomputeRuns(){return Number((await fixture.pool.query('SELECT count(*) AS count FROM genre_station_counts_runs')).rows[0].count);}

mock.module(new URL('../src/utils/logger.ts', import.meta.url).href, {
  namedExports: {
    logger: { log: () => {}, error: () => {}, warn: () => {}, info: () => {} },
  },
});

// Stubs needed by admin-genre-whitelist-routes.ts so we can mount it for
// the route-level test.
mock.module(new URL('../src/seo/genre-whitelist.ts', import.meta.url).href, {
  namedExports: {
    GENRE_WHITELIST: new Set<string>(['rock']),
    GENRE_ALIASES: new Map<string, string>(),
    MIN_STATIONS_FOR_GENRE_INDEX: 3,
  },
});
mock.module(new URL('../src/seo/genre-whitelist-store.ts', import.meta.url).href, {
  namedExports: {
    getMergedWhitelist: () => new Set<string>(['rock']),
    getMergedAliases: () => new Map<string, string>(),
    refreshGenreWhitelistFromDb: async () => {},
    getLastRefreshAt: () => new Date('2026-01-01T00:00:00Z'),
  },
});
mock.module(new URL('../src/services/indexnow.ts', import.meta.url).href, {
  namedExports: {
    IndexNowService: {
      submitSitemaps: async () => ({}),
      submitToIndexNow: async () => ({}),
      submitGenreUrls: async () => ({}),
    },
  },
});
mock.module(new URL('../src/seo/sitemap-manifest-builder.ts', import.meta.url).href, {
  namedExports: { buildAllSitemapManifests: async () => ({}) },
});
mock.module(new URL('../src/seo/qualified-languages.ts', import.meta.url).href, {
  namedExports: { getCachedQualifiedLanguages: async () => ['en'] },
});
mock.module(new URL('../src/seo/url-helpers.ts', import.meta.url).href, {
  namedExports: {
    buildLocalizedUrl: (path: string, lang: string) => `/${lang}${path}`,
  },
});
mock.module(new URL('../src/performance-cache.ts', import.meta.url).href, {
  namedExports: {
    performanceCache: { getUrlTranslations: async () => new Map<string, string>() },
  },
});
mock.module(new URL('../src/seo/genre-whitelist-push-status.ts', import.meta.url).href, {
  namedExports: {
    startPushStatus: () => {},
    updatePushStep: () => {},
    completePushStatus: () => {},
    getLastPushStatus: () => null,
    getRecentPushHistory: async () => [],
  },
});

// ---------------------------------------------------------------------------
// Boot: import the service AFTER mocks are installed.
// ---------------------------------------------------------------------------

let recomputeGenreStationCounts: (trigger: string) => Promise<void>;
let getGenreStationCountsStatus: () => {
  lastRecomputedAt: Date | null;
  lastDurationMs: number | null;
  lastUpdatedSlugs: number;
  lastTotalGenres: number;
  inFlight: boolean;
  lastTrigger: string | null;
};

let server: HttpServer;
let baseUrl: string;

before(async () => {
  process.env.NODE_ENV = 'test';
  fixture=await createNativePostgresFixture('genre_counts');
  const svc = await import('../src/services/genre-station-counts.ts');
  recomputeGenreStationCounts = svc.recomputeGenreStationCounts;
  getGenreStationCountsStatus = svc.getGenreStationCountsStatus;

  const routes = await import('../src/routes/admin-genre-whitelist-routes.ts');
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as { session: { adminAuth: { username: string } } }).session = {
      adminAuth: { username: 'test-admin' },
    };
    next();
  });
  routes.registerAdminGenreWhitelistRoutes(app, {
    requireAdmin: (_req: Request, _res: Response, next: NextFunction) => next(),
  });
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if(fixture) await fixture.close();
});

async function resetState() {
  await fixture.clear('stations','genres','genre_station_counts_runs');
  stations = [];
  genres = [];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('recomputeGenreStationCounts rewrites Genre.stationCount from genre + comma-split tags (lowercased, deduped)', async () => {
  await resetState();
  // Seed: a mix of `genre` field, `tags` strings (mixed case, surrounding
  // whitespace, duplicates across the two fields), and noise that should
  // NOT count (empty / unwhitelisted slugs).
  stations = [
    // rock: hits via genre on s1, via tags on s2 (lowercased), via genre
    // on s3 with mixed case. s4 lists "Rock" in tags AND in genre — must
    // de-dupe to a single +1 thanks to $setUnion in the pipeline.
    { genre: 'rock', tags: 'guitar, live' },
    { genre: 'pop', tags: 'Rock, Indie' },
    { genre: 'ROCK', tags: '' },
    { genre: 'Rock', tags: ' rock , indie ' },
    // jazz: genre only on s5, tag-only on s6 with surrounding whitespace.
    { genre: 'jazz', tags: null },
    { genre: null, tags: '  Jazz  , Smooth ' },
    // empty / null station — must contribute nothing.
    { genre: '', tags: '' },
  ];
  genres = [
    { _id: 'g-rock', slug: 'rock', stationCount: 999 }, // stale
    { _id: 'g-jazz', slug: 'jazz', stationCount: 0 },   // stale
    { _id: 'g-pop', slug: 'pop', stationCount: 7 },     // stale
    { _id: 'g-empty', slug: 'metal', stationCount: 4 }, // no matching tag → 0
  ];

  await seedFixtures();
  await recomputeGenreStationCounts('test');

  const byId = await storedCounts();
  // s1 (genre rock) + s2 (tag rock) + s3 (genre rock) + s4 (genre+tag rock, deduped) = 4
  assert.equal(byId.get('g-rock'), 4, 'rock should count each station once even if both genre & tag say rock');
  // s5 (genre jazz) + s6 (tag jazz) = 2
  assert.equal(byId.get('g-jazz'), 2, 'jazz should pick up genre AND comma-split, trimmed, lowercased tag');
  // pop only on s2 (genre)
  assert.equal(byId.get('g-pop'), 1, 'pop should count s2 via the genre field');
  // metal: nothing seeded
  assert.equal(byId.get('g-empty'), 0, 'unmatched genre must be reset to 0');

  const status = getGenreStationCountsStatus();
  assert.equal(status.lastTotalGenres, 4);
  assert.equal(
    status.lastUpdatedSlugs,
    4,
    'every seeded genre changed (3 stale + 1 reset to 0), so all 4 should be in the bulkWrite ops',
  );
  assert.equal(status.lastTrigger, 'test');
  assert.ok(status.lastRecomputedAt instanceof Date);
  assert.ok((status.lastDurationMs ?? -1) >= 0);
  assert.equal(status.inFlight, false);
});

test('recomputeGenreStationCounts coalesces concurrent callers into a single aggregation', async () => {
  await resetState();
  stations = [{ genre: 'rock', tags: '' }];
  genres = [{ _id: 'g-rock', slug: 'rock', stationCount: 0 }];
  // Hold the aggregation open long enough that the second caller arrives
  // while the first is still running.
  await seedFixtures();

  const p1 = recomputeGenreStationCounts('first');
  const p2 = recomputeGenreStationCounts('second');
  // Returns the same in-flight promise for the duration of the run.
  assert.equal(p1, p2, 'concurrent callers must share the same in-flight promise');

  // The status should report inFlight while we're awaiting.
  assert.equal(getGenreStationCountsStatus().inFlight, true);

  await Promise.all([p1, p2]);

  assert.equal(
    await recomputeRuns(),
    1,
    'The durable SQL recompute must run exactly once even with two overlapping callers',
  );
  // The *first* trigger label wins — coalescing returns the original.
  assert.equal(getGenreStationCountsStatus().lastTrigger, 'first');
  assert.equal(getGenreStationCountsStatus().inFlight, false);

  // After the in-flight promise resolves, a new call must start a fresh
  // aggregation rather than reusing the stale one.
  await recomputeGenreStationCounts('third');
  assert.equal(await recomputeRuns(), 2, 'a post-completion call must trigger a new aggregation');
  assert.equal(getGenreStationCountsStatus().lastTrigger, 'third');
});

test('POST /api/admin/genre-whitelist/recompute-counts returns the updated status payload', async () => {
  await resetState();
  stations = [
    { genre: 'rock', tags: '' },
    { genre: null, tags: 'rock, jazz' },
  ];
  genres = [
    { _id: 'g-rock', slug: 'rock', stationCount: 0 },
    { _id: 'g-jazz', slug: 'jazz', stationCount: 99 },
  ];

  await seedFixtures();
  const res = await fetch(`${baseUrl}/api/admin/genre-whitelist/recompute-counts`, {
    method: 'POST',
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    ok?: boolean;
    status?: {
      lastRecomputedAt?: string | null;
      lastUpdatedSlugs?: number;
      lastTotalGenres?: number;
      inFlight?: boolean;
      lastTrigger?: string | null;
      lastDurationMs?: number | null;
    };
  };
  assert.equal(body.ok, true, 'endpoint must report success');
  assert.ok(body.status, 'response must include the recompute status payload');
  assert.equal(body.status?.lastTrigger, 'admin-manual', 'route must tag the trigger as admin-manual');
  assert.equal(body.status?.inFlight, false, 'recompute must have settled by the time we respond');
  assert.equal(body.status?.lastTotalGenres, 2);
  assert.equal(body.status?.lastUpdatedSlugs, 2, 'both seeded genres changed');
  assert.equal(typeof body.status?.lastRecomputedAt, 'string', 'lastRecomputedAt should serialize to an ISO string');
  assert.ok((body.status?.lastDurationMs ?? -1) >= 0);

  // And the underlying Genre rows actually reflect the recompute.
  const byId = await storedCounts();
  assert.equal(byId.get('g-rock'), 2);
  assert.equal(byId.get('g-jazz'), 1);
});
