/**
 * Regression tests for the demoted-genre merge endpoint (Task #215).
 *
 * The route under test rewrites the `genre` and `tags` fields on every
 * station attached to a collision-demoted Genre row, deletes the demoted
 * row, and triggers a downstream cache + sitemap re-warm. A regression
 * in the tag-rewrite / dedupe / matching logic would only surface in
 * production today, so this suite locks in:
 *
 *   - happy path: stations whose `genre` field equals the demoted name are
 *     updated to the winner name; stations whose comma-separated `tags`
 *     contain the demoted name have it replaced and deduped against an
 *     existing winner tag; the demoted Genre row is deleted.
 *   - 404 when the demoted genre id does not exist.
 *   - 400 when the genre is not a collision-demoted row with a recorded
 *     winner.
 *   - 409 when the recorded collision winner has been deleted (orphan
 *     winner).
 *
 * Runner: requires `--experimental-test-module-mocks` (wired up in
 * artifacts/api-server/package.json#scripts.test).
 */
import { test, mock, before, after, beforeEach } from 'node:test';
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
// In-memory state used by the mocked Mongo models.
// ---------------------------------------------------------------------------

interface FakeGenreRow {
  _id: string;
  name: string;
  slug: string;
  stationCount?: number;
  cleanupDemotion?: {
    reason?: string;
    collisionWinnerId?: string | null;
  };
  updatedAt?: Date;
}

interface FakeStationRow {
  _id: string;
  slug: string;
  genre?: string;
  tags?: string;
}

let genres: FakeGenreRow[] = [];
let stations: FakeStationRow[] = [];
const invalidatedStationCacheSlugs: string[] = [];
let precomputedRefreshCalls = 0;
let sitemapRebuildCalls = 0;

function fakeQuery<T>(value: T) {
  const q: {
    select: () => typeof q;
    lean: <U = T>() => Promise<U>;
    then: <R>(onFulfilled?: (v: T) => R) => Promise<R>;
  } = {
    select: () => q,
    lean: async () => value as unknown as never,
    then: (resolve) => Promise.resolve(value).then(resolve as (v: T) => unknown) as Promise<never>,
  };
  return q;
}

const FakeGenreModel = {
  findById: (id: string) => {
    const row = genres.find((g) => g._id === String(id)) ?? null;
    return fakeQuery(row);
  },
  updateOne: async (
    filter: { _id?: string },
    update: { $set?: Partial<FakeGenreRow> },
  ) => {
    const row = genres.find((g) => g._id === String(filter._id));
    if (row && update.$set) Object.assign(row, update.$set);
    return { matchedCount: row ? 1 : 0, modifiedCount: row ? 1 : 0 };
  },
  deleteOne: async (filter: { _id?: string }) => {
    const idx = genres.findIndex((g) => g._id === String(filter._id));
    if (idx >= 0) genres.splice(idx, 1);
    return { deletedCount: idx >= 0 ? 1 : 0 };
  },
};

interface OrFilter {
  $or: Array<
    | { tags: { $regex: RegExp } }
    | { genre: { $regex: RegExp } }
  >;
}

function matchStationAgainstOr(st: FakeStationRow, filter: OrFilter): boolean {
  return filter.$or.some((clause) => {
    if ('tags' in clause) {
      return typeof st.tags === 'string' && clause.tags.$regex.test(st.tags);
    }
    return typeof st.genre === 'string' && clause.genre.$regex.test(st.genre);
  });
}

const FakeStationModel = {
  find: (filter: OrFilter) => {
    const matches = stations.filter((s) => matchStationAgainstOr(s, filter));
    return fakeQuery(matches);
  },
  updateOne: async (
    filter: { _id?: string },
    update: { $set?: Partial<FakeStationRow> },
  ) => {
    const row = stations.find((s) => s._id === String(filter._id));
    if (row && update.$set) Object.assign(row, update.$set);
    return { matchedCount: row ? 1 : 0, modifiedCount: row ? 1 : 0 };
  },
  countDocuments: async (filter: OrFilter) => {
    return stations.filter((s) => matchStationAgainstOr(s, filter)).length;
  },
};

// ---------------------------------------------------------------------------
// Module mocks — installed BEFORE the route module is imported.
// ---------------------------------------------------------------------------

mock.module(new URL('../src/shared/mongo-schemas.ts', import.meta.url).href, {
  namedExports: {
    Genre: FakeGenreModel,
    Station: FakeStationModel,
    // The route module destructures a number of other models at the top of
    // the file. They go unused for these tests — exporting empty stubs
    // keeps the destructure from blowing up at import time.
    TranslationKey: {},
    Translation: {},
    TranslationLanguage: {},
    User: {},
    Language: {},
    UserFavorite: {},
    UserNotification: {},
    UserFollow: {},
    AuthToken: {},
    StationRating: {},
    SyncLog: {},
    BlacklistedStation: {},
    SAFE_GENRE_SLUG_RE: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    normalizeGenreSlug: (s: string) => String(s ?? '').toLowerCase(),
  },
});

mock.module(new URL('../src/performance-cache.ts', import.meta.url).href, {
  namedExports: {
    performanceCache: {
      invalidateStationCache: (slug: string) => {
        invalidatedStationCacheSlugs.push(slug);
      },
    },
  },
});

mock.module(new URL('../src/services/precomputed-genres.ts', import.meta.url).href, {
  namedExports: {
    PrecomputedGenresService: {
      refreshAll: async () => {
        precomputedRefreshCalls += 1;
      },
    },
  },
});

mock.module(new URL('../src/seo/sitemap-manifest-builder.ts', import.meta.url).href, {
  namedExports: {
    buildAllSitemapManifests: async () => {
      sitemapRebuildCalls += 1;
      return {};
    },
  },
});

// Heavyweight modules pulled in by other (unrelated) routes in the same
// file — neutered to keep the import light and side-effect-free.
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
  genres = [];
  stations = [];
  invalidatedStationCacheSlugs.length = 0;
  precomputedRefreshCalls = 0;
  sitemapRebuildCalls = 0;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('merge-into-winner rewrites genre + tags, dedupes, deletes the demoted row', async () => {
  genres.push(
    {
      _id: 'winner-1',
      name: 'Rock',
      slug: 'rock',
      stationCount: 0,
    },
    {
      _id: 'demoted-1',
      name: 'Rock Music',
      slug: 'rock-music',
      cleanupDemotion: { reason: 'collision', collisionWinnerId: 'winner-1' },
    },
  );

  stations.push(
    // Singular `genre` field on the demoted name → must flip to winner name.
    {
      _id: 's-genre-only',
      slug: 'station-genre-only',
      genre: 'Rock Music',
      tags: 'guitar,bass',
    },
    // `tags` contains demoted (case-insensitive) AND already contains the
    // winner — the rewrite must dedupe so only one "Rock" survives.
    {
      _id: 's-tags-dupe',
      slug: 'station-tags-dupe',
      genre: 'Indie',
      tags: 'rock,ROCK MUSIC,indie',
    },
    // `tags` contains demoted but NOT the winner → straight replacement.
    {
      _id: 's-tags-replace',
      slug: 'station-tags-replace',
      genre: 'Pop',
      tags: 'pop,Rock Music',
    },
    // No match at all — must remain untouched and not show up in the
    // matched count.
    {
      _id: 's-untouched',
      slug: 'station-untouched',
      genre: 'Jazz',
      tags: 'jazz,blues',
    },
  );

  const res = await fetch(
    `${baseUrl}/api/admin/genres/demoted-1/merge-into-winner`,
    { method: 'POST' },
  );
  const rawBody = await res.text();
  assert.equal(res.status, 200, rawBody);
  const body = JSON.parse(rawBody) as {
    success: boolean;
    demotedGenreId: string;
    demotedGenreName: string;
    winnerGenreId: string;
    winnerGenreName: string;
    stationsMatched: number;
    stationsRetagged: number;
  };

  assert.equal(body.success, true);
  assert.equal(body.demotedGenreId, 'demoted-1');
  assert.equal(body.demotedGenreName, 'Rock Music');
  assert.equal(body.winnerGenreId, 'winner-1');
  assert.equal(body.winnerGenreName, 'Rock');
  assert.equal(body.stationsMatched, 3, 'only the three matching stations should be counted');
  assert.equal(body.stationsRetagged, 3, 'all three matched stations should be re-tagged');

  // Singular genre field flipped to winner name.
  const sGenreOnly = stations.find((s) => s._id === 's-genre-only')!;
  assert.equal(sGenreOnly.genre, 'Rock');
  // Tags untouched on this row (no demoted entry in tags).
  assert.equal(sGenreOnly.tags, 'guitar,bass');

  // Tag-replacement path: demoted entry replaced with winner, deduped
  // against the pre-existing winner tag (case-insensitive).
  const sTagsDupe = stations.find((s) => s._id === 's-tags-dupe')!;
  const dupeTags = (sTagsDupe.tags ?? '').split(',');
  assert.equal(dupeTags.length, 2, 'duplicate winner tag must be removed');
  assert.deepEqual(
    dupeTags.map((t) => t.toLowerCase()),
    ['rock', 'indie'],
    'first occurrence wins; demoted entry collapses into existing winner tag',
  );

  // Straight replacement: no pre-existing winner tag, so demoted entry
  // is rewritten in place.
  const sTagsReplace = stations.find((s) => s._id === 's-tags-replace')!;
  assert.equal(sTagsReplace.tags, 'pop,Rock');

  // Non-matching station must not be touched.
  const sUntouched = stations.find((s) => s._id === 's-untouched')!;
  assert.equal(sUntouched.genre, 'Jazz');
  assert.equal(sUntouched.tags, 'jazz,blues');

  // Demoted row deleted.
  assert.equal(
    genres.find((g) => g._id === 'demoted-1'),
    undefined,
    'demoted Genre row must be deleted',
  );
  // Winner row preserved with refreshed station count.
  const winner = genres.find((g) => g._id === 'winner-1');
  assert.ok(winner, 'winner row must still exist');
  assert.equal(
    winner!.stationCount,
    3,
    'winner stationCount must be refreshed to reflect retagged stations',
  );

  // Per-station cache invalidation fired for every retagged station.
  assert.deepEqual(
    [...invalidatedStationCacheSlugs].sort(),
    ['station-genre-only', 'station-tags-dupe', 'station-tags-replace'].sort(),
  );

  // Downstream re-warm fired exactly once each.
  assert.equal(precomputedRefreshCalls, 1);
  assert.equal(sitemapRebuildCalls, 1);
});

test('merge-into-winner returns 404 when the demoted genre id is unknown', async () => {
  // No genres seeded.
  const res = await fetch(
    `${baseUrl}/api/admin/genres/does-not-exist/merge-into-winner`,
    { method: 'POST' },
  );
  assert.equal(res.status, 404);
  const body = (await res.json()) as { error?: string };
  assert.match(body.error ?? '', /demoted genre not found/i);
  assert.equal(precomputedRefreshCalls, 0);
  assert.equal(sitemapRebuildCalls, 0);
});

test('merge-into-winner returns 400 when the genre is not a collision-demoted row', async () => {
  genres.push({
    _id: 'plain-1',
    name: 'Rock',
    slug: 'rock',
    // No cleanupDemotion at all — this row was never demoted.
  });

  const res = await fetch(
    `${baseUrl}/api/admin/genres/plain-1/merge-into-winner`,
    { method: 'POST' },
  );
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error?: string };
  assert.match(body.error ?? '', /not a collision-demoted row/i);
  // Genre must still exist — 400 must be a no-op.
  assert.ok(genres.find((g) => g._id === 'plain-1'));
});

test('merge-into-winner returns 400 when cleanupDemotion has a non-collision reason', async () => {
  genres.push({
    _id: 'demoted-empty',
    name: 'Empty Genre',
    slug: 'empty-genre',
    cleanupDemotion: { reason: 'empty-slug', collisionWinnerId: null },
  });

  const res = await fetch(
    `${baseUrl}/api/admin/genres/demoted-empty/merge-into-winner`,
    { method: 'POST' },
  );
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error?: string };
  assert.match(body.error ?? '', /not a collision-demoted row/i);
});

test('merge-into-winner returns 409 when the recorded collision winner is missing', async () => {
  genres.push({
    _id: 'demoted-orphan',
    name: 'Rock Music',
    slug: 'rock-music',
    cleanupDemotion: { reason: 'collision', collisionWinnerId: 'winner-gone' },
  });
  stations.push({
    _id: 's-orphan',
    slug: 'station-orphan',
    genre: 'Rock Music',
    tags: 'rock music',
  });

  const res = await fetch(
    `${baseUrl}/api/admin/genres/demoted-orphan/merge-into-winner`,
    { method: 'POST' },
  );
  assert.equal(res.status, 409);
  const body = (await res.json()) as { error?: string };
  assert.match(body.error ?? '', /winner no longer exists/i);

  // Station rows must not have been touched on the orphan path.
  const orphanStation = stations.find((s) => s._id === 's-orphan')!;
  assert.equal(orphanStation.genre, 'Rock Music');
  assert.equal(orphanStation.tags, 'rock music');
  // Demoted row also untouched so the admin can retry.
  assert.ok(genres.find((g) => g._id === 'demoted-orphan'));
  // No downstream re-warm.
  assert.equal(precomputedRefreshCalls, 0);
  assert.equal(sitemapRebuildCalls, 0);
});
