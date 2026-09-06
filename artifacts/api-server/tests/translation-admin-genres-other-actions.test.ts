/**
 * Regression tests for the rest of the admin Genre actions on
 * `translation-admin-routes.ts` (Task #291). Task #215 already covers
 * `POST /api/admin/genres/:id/merge-into-winner`; this file mirrors the
 * same native SQL transport fixture pattern for the remaining one-button-in-production
 * actions on the same route file:
 *
 *   - `GET  /api/admin/genres`        — list with pagination, search,
 *                                       demoted-only filter, sort options,
 *                                       and the empty-collection bootstrap
 *                                       that auto-populates from station
 *                                       tags.
 *   - `GET  /api/admin/genres/:id/merge-preview` — read-only preview of
 *                                       the stations a merge-into-winner
 *                                       call would re-tag, plus its 404 /
 *                                       400 / 409 guard rails.
 *   - `POST /api/admin/populate-genres` — manual re-derivation of Genre
 *                                       rows from station `tags` / `genre`
 *                                       fields, including the safe-slug
 *                                       guard (Task #110 / #161) that
 *                                       skips empty / malformed slugs.
 *
 * Each test asserts both the happy-path side effects (rows returned /
 * created, sort + filter applied, upsert payload shape) and at least one
 * relevant 4xx / no-op error shape so a future regression in the route
 * handler fails the suite instead of production.
 *
 * Runner: requires `--experimental-test-module-mocks` (wired up in
 * `artifacts/api-server/package.json#scripts.test`).
 */
import { test, mock, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { genreAdminPgFixture } from './helpers/genre-admin-pg-fixture';
import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from 'express';
import type { AddressInfo } from 'node:net';
import type { Server as HttpServer } from 'node:http';

// ---------------------------------------------------------------------------
// In-memory records behind the native PostgreSQL transport fixture.
// ---------------------------------------------------------------------------

interface FakeGenreRow {
  _id: string;
  name: string;
  slug: string;
  stationCount?: number;
  isDiscoverable?: boolean;
  cleanupDemotion?: {
    reason?: string;
    demotedAt?: Date;
    collisionWinnerId?: string | null;
  };
  createdAt?: Date;
  updatedAt?: Date;
}

interface FakeStationRow {
  _id: string;
  slug: string;
  name?: string;
  country?: string;
  genre?: string;
  tags?: string;
}

let genres: FakeGenreRow[] = [];
let stations: FakeStationRow[] = [];

interface UpsertCall {
  filter: { slug?: string };
  payload: Partial<FakeGenreRow>;
}
let upsertCalls: UpsertCall[] = [];

// ---------------------------------------------------------------------------
const fixtureAudits:any[]=[];
const nativeFixture=genreAdminPgFixture({genres:()=>genres,stations:()=>stations,audits:()=>fixtureAudits,upsert:payload=>upsertCalls.push({filter:{slug:payload.slug},payload})});
mock.module('../src/postgres-runtime',{namedExports:{getPostgresPool: () => nativeFixture.pool, getPostgresCoordinationPool: () => nativeFixture.pool,closePostgres:async()=>{}}});
mock.module('../src/data/postgres-catalog-store',{namedExports:{
  pgCatalog:()=>nativeFixture.catalog,pgSyncLogs:async()=>[],PostgresCatalogStore:class {},
}});
// The real native genre-admin store executes its merge transaction against the
// fixture transport; no Mongoose models or fake merge business logic are used.

mock.module(new URL('../src/performance-cache.ts', import.meta.url).href, {
  namedExports: {
    performanceCache: {
      invalidateStationCache: () => {},
    },
  },
});

mock.module(new URL('../src/services/precomputed-genres.ts', import.meta.url).href, {
  namedExports: {
    PrecomputedGenresService: {
      refreshAll: async () => {},
    },
  },
});

mock.module(new URL('../src/seo/sitemap-manifest-builder.ts', import.meta.url).href, {
  namedExports: {
    buildAllSitemapManifests: async () => ({}),
  },
});

mock.module(new URL('../src/cache.ts', import.meta.url).href, {
  defaultExport: { invalidate: async () => {} },
  namedExports: {
    CacheKeys: {},
    invalidateSocialCacheForUser: async () => {},
  },
});

mock.module(new URL('../src/services/sync.ts', import.meta.url).href, {
  namedExports: {
    syncService: {},
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
// Boot Express app with the real route registration + mocked deps.
// ---------------------------------------------------------------------------

let server: HttpServer;
let baseUrl: string;

before(async () => {
  process.env.NODE_ENV = 'test';

  const mod = (await import('../src/routes/translation-admin-routes.ts')) as {
    registerTranslationAdminRoutes: (
      app: Express,
      deps: {
        requireAuth: (req: Request, res: Response, next: NextFunction) => void;
        requireAdmin: (req: Request, res: Response, next: NextFunction) => void;
      },
    ) => void;
  };

  const app = express();
  app.use(express.json());
  mod.registerTranslationAdminRoutes(app, {
    requireAuth: (_req, _res, next) => next(),
    requireAdmin: (_req, _res, next) => next(),
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
  fixtureAudits.length=0;
  genres = [];
  stations = [];
  upsertCalls = [];
});

// ---------------------------------------------------------------------------
// GET /api/admin/genres
// ---------------------------------------------------------------------------

test('GET /api/admin/genres paginates, sorts by stationCount desc by default', async () => {
  for (let i = 1; i <= 5; i++) {
    genres.push({
      _id: `g-${i}`,
      name: `Genre ${i}`,
      slug: `genre-${i}`,
      stationCount: i * 10,
    });
  }

  const res = await fetch(`${baseUrl}/api/admin/genres?page=1&limit=2`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    data: FakeGenreRow[];
    total: number;
    currentPage: number;
    totalPages: number;
  };

  assert.equal(body.total, 5);
  assert.equal(body.currentPage, 1);
  assert.equal(body.totalPages, 3);
  assert.equal(body.data.length, 2);
  // Default sort = stationCount desc → Genre 5 (50), Genre 4 (40)
  assert.deepEqual(
    body.data.map((g) => g.slug),
    ['genre-5', 'genre-4'],
  );
});

test('GET /api/admin/genres applies case-insensitive name search', async () => {
  genres.push(
    { _id: 'g-rock', name: 'Rock', slug: 'rock', stationCount: 10 },
    { _id: 'g-pop', name: 'Pop', slug: 'pop', stationCount: 5 },
    { _id: 'g-rmusic', name: 'Rock Music', slug: 'rock-music', stationCount: 3 },
  );

  const res = await fetch(`${baseUrl}/api/admin/genres?search=ROCK`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { data: FakeGenreRow[]; total: number };
  assert.equal(body.total, 2);
  assert.deepEqual(
    body.data.map((g) => g.slug).sort(),
    ['rock', 'rock-music'],
  );
});

test('GET /api/admin/genres?demoted=1 only returns slug-cleanup demoted rows', async () => {
  genres.push(
    {
      _id: 'g-plain',
      name: 'Plain',
      slug: 'plain',
      stationCount: 10,
    },
    {
      _id: 'g-empty',
      name: 'Empty',
      slug: 'empty',
      cleanupDemotion: { reason: 'empty-slug' },
    },
    {
      _id: 'g-coll',
      name: 'Collided',
      slug: 'collided',
      cleanupDemotion: { reason: 'collision', collisionWinnerId: 'g-plain' },
    },
    {
      _id: 'g-other',
      name: 'Manual',
      slug: 'manual',
      cleanupDemotion: { reason: 'manual-hide' },
    },
  );

  const res = await fetch(`${baseUrl}/api/admin/genres?demoted=true`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { data: FakeGenreRow[]; total: number };
  // Only `empty-slug` and `collision` reasons are surfaced — `manual-hide`
  // and rows without cleanupDemotion are filtered out.
  assert.equal(body.total, 2);
  assert.deepEqual(
    body.data.map((g) => g.slug).sort(),
    ['collided', 'empty'],
  );
});

test('GET /api/admin/genres?sortBy=name returns rows alphabetically A→Z', async () => {
  genres.push(
    { _id: 'g-1', name: 'Zeta', slug: 'zeta', stationCount: 1 },
    { _id: 'g-2', name: 'Alpha', slug: 'alpha', stationCount: 99 },
    { _id: 'g-3', name: 'Mu', slug: 'mu', stationCount: 50 },
  );

  const res = await fetch(`${baseUrl}/api/admin/genres?sortBy=name`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { data: FakeGenreRow[] };
  assert.deepEqual(
    body.data.map((g) => g.slug),
    ['alpha', 'mu', 'zeta'],
  );
});

test('GET /api/admin/genres?sortBy=demotedAt orders most recently demoted first', async () => {
  genres.push(
    {
      _id: 'g-old',
      name: 'Old',
      slug: 'old',
      cleanupDemotion: {
        reason: 'collision',
        demotedAt: new Date('2024-01-01T00:00:00Z'),
      },
    },
    {
      _id: 'g-new',
      name: 'New',
      slug: 'new',
      cleanupDemotion: {
        reason: 'collision',
        demotedAt: new Date('2025-06-01T00:00:00Z'),
      },
    },
  );

  const res = await fetch(`${baseUrl}/api/admin/genres?demoted=1&sortBy=demotedAt`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { data: FakeGenreRow[] };
  assert.deepEqual(
    body.data.map((g) => g.slug),
    ['new', 'old'],
  );
});

test('GET /api/admin/genres bootstraps from station tags when collection is empty', async () => {
  stations.push(
    { _id: 's1', slug: 's1', tags: 'rock,pop' },
    { _id: 's2', slug: 's2', tags: 'rock' },
    { _id: 's3', slug: 's3', genre: 'Jazz' },
  );

  const res = await fetch(`${baseUrl}/api/admin/genres?page=1&limit=50`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    data: FakeGenreRow[];
    total: number;
    populated?: boolean;
  };

  assert.equal(body.populated, true, 'response should flag the bootstrap path');
  // rock (2), pop (1), jazz (1)
  const slugs = body.data.map((g) => g.slug).sort();
  assert.deepEqual(slugs, ['jazz', 'pop', 'rock']);
  assert.equal(body.total, 3);
  // Verify the upsert payload shape: discoverable iff station count >= 2.
  const rockUpsert = upsertCalls.find((c) => c.filter.slug === 'rock');
  assert.ok(rockUpsert, 'rock should have been upserted');
  assert.equal(rockUpsert!.payload.stationCount, 2);
  assert.equal(rockUpsert!.payload.isDiscoverable, true);
  const popUpsert = upsertCalls.find((c) => c.filter.slug === 'pop');
  assert.ok(popUpsert);
  assert.equal(popUpsert!.payload.isDiscoverable, false, 'single-station tag is not discoverable');
});

// ---------------------------------------------------------------------------
// POST /api/admin/populate-genres
// ---------------------------------------------------------------------------

test('POST /api/admin/populate-genres upserts a Genre per unique tag with capitalized name', async () => {
  stations.push(
    { _id: 's1', slug: 's1', tags: 'rock,pop' },
    { _id: 's2', slug: 's2', tags: 'rock,indie' },
    { _id: 's3', slug: 's3', genre: 'Jazz' },
  );

  const res = await fetch(`${baseUrl}/api/admin/populate-genres`, {
    method: 'POST',
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    success: boolean;
    genresCreated: number;
    tagsProcessed: number;
  };
  assert.equal(body.success, true);
  // 4 unique normalized tags: rock, pop, indie, jazz
  assert.equal(body.tagsProcessed, 4);
  assert.equal(body.genresCreated, 4);

  const upsertedSlugs = upsertCalls.map((c) => c.filter.slug).sort();
  assert.deepEqual(upsertedSlugs, ['indie', 'jazz', 'pop', 'rock']);

  // Capitalized name + correct stationCount surface in the upsert payload.
  const rock = upsertCalls.find((c) => c.filter.slug === 'rock')!;
  assert.equal(rock.payload.name, 'Rock');
  assert.equal(rock.payload.stationCount, 2);
  assert.equal(rock.payload.isDiscoverable, true);

  const indie = upsertCalls.find((c) => c.filter.slug === 'indie')!;
  assert.equal(indie.payload.stationCount, 1);
  assert.equal(indie.payload.isDiscoverable, false);
});

test('POST /api/admin/populate-genres skips tags whose normalized slug is unsafe', async () => {
  stations.push(
    // Real tag → safe slug.
    { _id: 's1', slug: 's1', tags: 'rock' },
    // Pure punctuation → normalizes to empty → must be skipped, not upserted.
    { _id: 's2', slug: 's2', tags: '!!!' },
    // Whitespace-only segment after split → empty → skipped.
    { _id: 's3', slug: 's3', tags: '   ' },
  );

  const res = await fetch(`${baseUrl}/api/admin/populate-genres`, {
    method: 'POST',
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { genresCreated: number };

  // Only the safe-slug 'rock' should make it through.
  assert.equal(body.genresCreated, 1);
  assert.equal(upsertCalls.length, 1);
  assert.equal(upsertCalls[0].filter.slug, 'rock');
});

// ---------------------------------------------------------------------------
// GET /api/admin/genres/:id/merge-preview
// ---------------------------------------------------------------------------

test('merge-preview returns matched count + sorted sample for a demoted genre', async () => {
  genres.push(
    { _id: 'winner-1', name: 'Rock', slug: 'rock' },
    {
      _id: 'demoted-1',
      name: 'Rock Music',
      slug: 'rock-music',
      cleanupDemotion: { reason: 'collision', collisionWinnerId: 'winner-1' },
    },
  );
  stations.push(
    { _id: 's1', slug: 'station-z', name: 'Z Station', country: 'US', genre: 'Rock Music' },
    { _id: 's2', slug: 'station-a', name: 'A Station', country: 'UK', tags: 'rock music,indie' },
    { _id: 's3', slug: 'station-m', name: 'M Station', country: 'DE', tags: 'rock,ROCK MUSIC' },
    // Non-matching station — must be excluded.
    { _id: 's4', slug: 'station-x', name: 'X Station', country: 'FR', genre: 'Jazz' },
  );

  const res = await fetch(
    `${baseUrl}/api/admin/genres/demoted-1/merge-preview?targetGenreId=winner-1&limit=2`,
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    demotedGenreId: string;
    demotedGenreName: string;
    demotedGenreSlug: string;
    targetGenreId: string | null;
    targetGenreName: string | null;
    targetGenreSlug: string | null;
    stationsMatched: number;
    sampleLimit: number;
    sampleStations: Array<{ _id: string; name: string; slug: string }>;
  };

  assert.equal(body.demotedGenreId, 'demoted-1');
  assert.equal(body.demotedGenreName, 'Rock Music');
  assert.equal(body.demotedGenreSlug, 'rock-music');
  assert.equal(body.targetGenreId, 'winner-1');
  assert.equal(body.targetGenreName, 'Rock');
  assert.equal(body.targetGenreSlug, 'rock');
  assert.equal(body.stationsMatched, 3, 'only the three matching stations should be counted');
  assert.equal(body.sampleLimit, 2, 'caller-supplied limit should round-trip');
  // Sample is sorted by name asc and clipped to the limit.
  assert.equal(body.sampleStations.length, 2);
  assert.deepEqual(
    body.sampleStations.map((s) => s.slug),
    ['station-a', 'station-m'],
  );
});

test('merge-preview omits target fields when no targetGenreId supplied', async () => {
  genres.push({
    _id: 'demoted-only',
    name: 'Rock Music',
    slug: 'rock-music',
    cleanupDemotion: { reason: 'empty-slug' },
  });
  stations.push({ _id: 's1', slug: 's1', name: 'S1', genre: 'Rock Music' });

  const res = await fetch(`${baseUrl}/api/admin/genres/demoted-only/merge-preview`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    targetGenreId: string | null;
    targetGenreName: string | null;
    targetGenreSlug: string | null;
    stationsMatched: number;
    sampleLimit: number;
  };
  assert.equal(body.targetGenreId, null);
  assert.equal(body.targetGenreName, null);
  assert.equal(body.targetGenreSlug, null);
  assert.equal(body.stationsMatched, 1);
  // Default sample limit is 50 when no `limit` query param is supplied.
  assert.equal(body.sampleLimit, 50);
});

test('merge-preview returns 404 when the demoted genre id is unknown', async () => {
  const res = await fetch(`${baseUrl}/api/admin/genres/missing-id/merge-preview`);
  assert.equal(res.status, 404);
  const body = (await res.json()) as { error?: string };
  assert.match(body.error ?? '', /demoted genre not found/i);
});

test('merge-preview returns 400 when the genre is not a slug-cleanup demoted row', async () => {
  genres.push({ _id: 'plain-1', name: 'Rock', slug: 'rock' });

  const res = await fetch(`${baseUrl}/api/admin/genres/plain-1/merge-preview`);
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error?: string };
  assert.match(body.error ?? '', /not a slug-cleanup demoted row/i);
});

test('merge-preview returns 400 on self-merge attempts', async () => {
  genres.push({
    _id: 'demoted-self',
    name: 'Rock Music',
    slug: 'rock-music',
    cleanupDemotion: { reason: 'collision' },
  });

  const res = await fetch(
    `${baseUrl}/api/admin/genres/demoted-self/merge-preview?targetGenreId=demoted-self`,
  );
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error?: string };
  assert.match(body.error ?? '', /cannot merge a demoted genre into itself/i);
});

test('merge-preview returns 409 when the picked target genre no longer exists', async () => {
  genres.push({
    _id: 'demoted-orphan',
    name: 'Rock Music',
    slug: 'rock-music',
    cleanupDemotion: { reason: 'collision' },
  });

  const res = await fetch(
    `${baseUrl}/api/admin/genres/demoted-orphan/merge-preview?targetGenreId=ghost`,
  );
  assert.equal(res.status, 409);
  const body = (await res.json()) as { error?: string };
  assert.match(body.error ?? '', /picked target genre no longer exists/i);
});

// ---------------------------------------------------------------------------
// POST /api/admin/populate-genres (continued)
// ---------------------------------------------------------------------------

test('POST /api/admin/populate-genres is a safe no-op when there are no stations', async () => {
  // No stations seeded.
  const res = await fetch(`${baseUrl}/api/admin/populate-genres`, {
    method: 'POST',
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    success: boolean;
    genresCreated: number;
    tagsProcessed: number;
  };
  assert.equal(body.success, true);
  assert.equal(body.genresCreated, 0);
  assert.equal(body.tagsProcessed, 0);
  assert.equal(upsertCalls.length, 0);
  assert.equal(genres.length, 0);
});
