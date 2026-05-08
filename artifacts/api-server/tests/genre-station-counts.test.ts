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

// Mirrors the documented behavior of the aggregation pipeline:
//   genre + tags → lowercased → comma-split + trimmed → de-duplicated → grouped.
function aggregateTagCounts(): Array<{ _id: string; count: number }> {
  const counts = new Map<string, number>();
  for (const s of stations) {
    const tags = new Set<string>();
    if (s.genre != null && s.genre !== '') {
      tags.add(String(s.genre).toLowerCase());
    }
    if (s.tags != null && s.tags !== '') {
      for (const raw of String(s.tags).split(',')) {
        const t = raw.trim().toLowerCase();
        if (t !== '') tags.add(t);
      }
    }
    for (const t of tags) {
      if (t === '') continue;
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }
  return [...counts.entries()].map(([_id, count]) => ({ _id, count }));
}

let aggregateCallCount = 0;
let aggregateDelayMs = 0;

const FakeStationModel = {
  aggregate: (_pipeline: unknown) => {
    aggregateCallCount += 1;
    const result = aggregateTagCounts();
    const exec = async () => {
      if (aggregateDelayMs > 0) {
        await new Promise<void>((r) => setTimeout(r, aggregateDelayMs));
      }
      return result;
    };
    // Mongoose Aggregate has `.option()` chainable returning a thenable.
    const aggregate = {
      option(_opts: unknown) {
        return aggregate;
      },
      then<TResult1 = typeof result, TResult2 = never>(
        onfulfilled?: ((value: typeof result) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ) {
        return exec().then(onfulfilled, onrejected);
      },
    };
    return aggregate;
  },
};

interface FakeQuery<T> extends PromiseLike<T> {
  select: () => FakeQuery<T>;
  sort: () => FakeQuery<T>;
  limit: () => FakeQuery<T>;
  lean: <U = T>() => Promise<U>;
}
function fakeQuery<T>(value: T): FakeQuery<T> {
  const q: FakeQuery<T> = {
    select: () => q,
    sort: () => q,
    limit: () => q,
    lean: async () => value as unknown as never,
    then: (resolve, reject) => Promise.resolve(value).then(resolve, reject),
  };
  return q;
}

const FakeGenreModel = {
  find: (_query?: unknown) => fakeQuery(genres.map((g) => ({ ...g }))),
  findOne: (query: { slug?: string }) =>
    fakeQuery(
      query?.slug
        ? genres.find((g) => g.slug === query.slug) ?? null
        : null,
    ),
  bulkWrite: async (
    ops: Array<{
      updateOne: {
        filter: { _id: string };
        update: { $set: { stationCount: number; updatedAt: Date } };
      };
    }>,
  ) => {
    for (const op of ops) {
      const target = genres.find((g) => g._id === op.updateOne.filter._id);
      if (target) target.stationCount = op.updateOne.update.$set.stationCount;
    }
    return { modifiedCount: ops.length };
  },
};

// Track override rows for the admin route mock (unused by the recompute
// endpoint itself but other handlers in the same module touch them).
const overrideRows: unknown[] = [];
const FakeOverrideModel = {
  find: () => fakeQuery([...overrideRows]),
  findOneAndUpdate: async () => ({}),
  deleteOne: async () => ({ deletedCount: 0 }),
  deleteMany: async () => ({ deletedCount: 0 }),
};

// ---------------------------------------------------------------------------
// Module mocks — must run BEFORE the service / routes module is imported.
// ---------------------------------------------------------------------------

mock.module('@workspace/db-shared/mongo-schemas', {
  namedExports: {
    Station: FakeStationModel,
    Genre: FakeGenreModel,
    GenreWhitelistOverride: FakeOverrideModel,
    SAFE_GENRE_SLUG_RE: /^[a-z0-9-]+$/,
    normalizeGenreSlug: (slug: string) =>
      String(slug ?? '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, ''),
  },
});

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
  if (!server) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function resetState() {
  stations = [];
  genres = [];
  aggregateCallCount = 0;
  aggregateDelayMs = 0;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('recomputeGenreStationCounts rewrites Genre.stationCount from genre + comma-split tags (lowercased, deduped)', async () => {
  resetState();
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

  await recomputeGenreStationCounts('test');

  const byId = new Map(genres.map((g) => [g._id, g.stationCount] as const));
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
  resetState();
  stations = [{ genre: 'rock', tags: '' }];
  genres = [{ _id: 'g-rock', slug: 'rock', stationCount: 0 }];
  // Hold the aggregation open long enough that the second caller arrives
  // while the first is still running.
  aggregateDelayMs = 50;

  const p1 = recomputeGenreStationCounts('first');
  const p2 = recomputeGenreStationCounts('second');
  // Returns the same in-flight promise for the duration of the run.
  assert.equal(p1, p2, 'concurrent callers must share the same in-flight promise');

  // The status should report inFlight while we're awaiting.
  assert.equal(getGenreStationCountsStatus().inFlight, true);

  await Promise.all([p1, p2]);

  assert.equal(
    aggregateCallCount,
    1,
    'Station.aggregate must run exactly once even with two overlapping callers',
  );
  // The *first* trigger label wins — coalescing returns the original.
  assert.equal(getGenreStationCountsStatus().lastTrigger, 'first');
  assert.equal(getGenreStationCountsStatus().inFlight, false);

  // After the in-flight promise resolves, a new call must start a fresh
  // aggregation rather than reusing the stale one.
  await recomputeGenreStationCounts('third');
  assert.equal(aggregateCallCount, 2, 'a post-completion call must trigger a new aggregation');
  assert.equal(getGenreStationCountsStatus().lastTrigger, 'third');
});

test('POST /api/admin/genre-whitelist/recompute-counts returns the updated status payload', async () => {
  resetState();
  stations = [
    { genre: 'rock', tags: '' },
    { genre: null, tags: 'rock, jazz' },
  ];
  genres = [
    { _id: 'g-rock', slug: 'rock', stationCount: 0 },
    { _id: 'g-jazz', slug: 'jazz', stationCount: 99 },
  ];

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
  const byId = new Map(genres.map((g) => [g._id, g.stationCount] as const));
  assert.equal(byId.get('g-rock'), 2);
  assert.equal(byId.get('g-jazz'), 1);
});
