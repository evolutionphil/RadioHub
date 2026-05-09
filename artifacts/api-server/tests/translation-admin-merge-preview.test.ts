/**
 * Regression tests for the demoted-genre merge-PREVIEW endpoint (Task #288).
 *
 * The preview endpoint mirrors the same regex matching rules used by the
 * POST /api/admin/genres/:id/merge-into-winner route. If the two ever drift
 * apart, the dialog will silently disagree with what the merge actually
 * does. This suite locks in:
 *
 *   - happy path: `stationsMatched` and the `sampleStations` list are
 *     exactly the stations the merge would re-tag (singular `genre` field
 *     equal to demoted name, OR comma-separated `tags` containing the
 *     demoted entry — case-insensitive — and excluding partial substring
 *     matches like "Rock Music Hall" that share a prefix).
 *   - 404 when the demoted genre id does not exist.
 *   - 400 when the genre is not a collision-demoted row.
 *   - 400 when `targetGenreId` equals the demoted row (self-merge).
 *   - 409 when the supplied `targetGenreId` does not resolve to a row.
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
  cleanupDemotion?: {
    reason?: string;
    collisionWinnerId?: string | null;
  };
}

interface FakeStationRow {
  _id: string;
  name: string;
  slug: string;
  genre?: string;
  tags?: string;
  country?: string;
}

let genres: FakeGenreRow[] = [];
let stations: FakeStationRow[] = [];

function fakeFindByIdQuery<T>(value: T) {
  const q: {
    select: () => typeof q;
    lean: <U = T>() => Promise<U>;
  } = {
    select: () => q,
    lean: async () => value as unknown as never,
  };
  return q;
}

const FakeGenreModel = {
  findById: (id: string) => {
    const row = genres.find((g) => g._id === String(id)) ?? null;
    return fakeFindByIdQuery(row);
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
  countDocuments: async (filter: OrFilter) => {
    return stations.filter((s) => matchStationAgainstOr(s, filter)).length;
  },
  updateOne: async (
    filter: { _id?: string },
    update: { $set?: Partial<FakeStationRow> },
  ) => {
    const row = stations.find((s) => s._id === String(filter._id));
    if (row && update.$set) Object.assign(row, update.$set);
    return { matchedCount: row ? 1 : 0, modifiedCount: row ? 1 : 0 };
  },
  find: (filter: OrFilter) => {
    let matches = stations.filter((s) => matchStationAgainstOr(s, filter));
    const q: {
      select: () => typeof q;
      sort: (spec: { name?: number }) => typeof q;
      limit: (n: number) => typeof q;
      lean: <U = FakeStationRow[]>() => Promise<U>;
    } = {
      select: () => q,
      sort: (spec) => {
        if (spec.name === 1) {
          matches = [...matches].sort((a, b) => a.name.localeCompare(b.name));
        }
        return q;
      },
      limit: (n) => {
        matches = matches.slice(0, n);
        return q;
      },
      lean: async () => matches as unknown as never,
    };
    return q;
  },
};

// ---------------------------------------------------------------------------
// Module mocks — installed BEFORE the route module is imported.
// ---------------------------------------------------------------------------

mock.module('@workspace/db-shared/mongo-schemas', {
  namedExports: {
    Genre: FakeGenreModel,
    Station: FakeStationModel,
    // Other models pulled in by the route file but unused here.
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
    GenreMergeAuditLog: {
      create: async () => ({}),
      estimatedDocumentCount: async () => 0,
      find: () => ({
        sort: () => ({ limit: () => ({ lean: async () => [] }) }),
      }),
      deleteMany: async () => ({ deletedCount: 0 }),
    },
    SAFE_GENRE_SLUG_RE: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    normalizeGenreSlug: (s: string) => String(s ?? '').toLowerCase(),
  },
});

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
  genres = [];
  stations = [];
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('merge-preview returns exactly the stations the merge would re-tag', async () => {
  genres.push(
    {
      _id: 'winner-1',
      name: 'Rock',
      slug: 'rock',
    },
    {
      _id: 'demoted-1',
      name: 'Rock Music',
      slug: 'rock-music',
      cleanupDemotion: { reason: 'collision', collisionWinnerId: 'winner-1' },
    },
  );

  stations.push(
    // Singular `genre` field equals demoted name (case-insensitive).
    {
      _id: 's-genre-only',
      name: 'Alpha FM',
      slug: 'alpha-fm',
      genre: 'rock music',
      tags: 'guitar,bass',
      country: 'US',
    },
    // `tags` contains demoted entry between commas.
    {
      _id: 's-tags-mid',
      name: 'Beta FM',
      slug: 'beta-fm',
      genre: 'Indie',
      tags: 'indie,Rock Music,alt',
      country: 'GB',
    },
    // `tags` contains demoted entry at the end of the comma list.
    {
      _id: 's-tags-end',
      name: 'Gamma FM',
      slug: 'gamma-fm',
      genre: 'Pop',
      tags: 'pop,rock music',
      country: 'DE',
    },
    // `genre` is a SUPERSTRING of demoted ("Rock Music Hall") — must NOT
    // match. This is the exact regression risk between preview & merge.
    {
      _id: 's-superstring-genre',
      name: 'Delta FM',
      slug: 'delta-fm',
      genre: 'Rock Music Hall',
      tags: 'rock music hall',
      country: 'FR',
    },
    // No match at all.
    {
      _id: 's-untouched',
      name: 'Epsilon FM',
      slug: 'epsilon-fm',
      genre: 'Jazz',
      tags: 'jazz,blues',
      country: 'IT',
    },
  );

  const res = await fetch(
    `${baseUrl}/api/admin/genres/demoted-1/merge-preview?targetGenreId=winner-1`,
  );
  const rawBody = await res.text();
  assert.equal(res.status, 200, rawBody);
  const body = JSON.parse(rawBody) as {
    demotedGenreId: string;
    demotedGenreName: string;
    demotedGenreSlug: string;
    targetGenreId: string | null;
    targetGenreName: string | null;
    targetGenreSlug: string | null;
    stationsMatched: number;
    sampleLimit: number;
    sampleStations: Array<{
      _id: string;
      name: string;
      slug: string;
      genre: string | null;
      tags: string | null;
      country: string | null;
    }>;
  };

  assert.equal(body.demotedGenreId, 'demoted-1');
  assert.equal(body.demotedGenreName, 'Rock Music');
  assert.equal(body.demotedGenreSlug, 'rock-music');
  assert.equal(body.targetGenreId, 'winner-1');
  assert.equal(body.targetGenreName, 'Rock');
  assert.equal(body.targetGenreSlug, 'rock');
  assert.equal(body.sampleLimit, 50);

  // Exactly the three matching stations — superstring + non-match excluded.
  assert.equal(body.stationsMatched, 3);
  assert.deepEqual(
    body.sampleStations.map((s) => s._id).sort(),
    ['s-genre-only', 's-tags-mid', 's-tags-end'].sort(),
  );

  // Sample is sorted by name ascending (Alpha, Beta, Gamma).
  assert.deepEqual(
    body.sampleStations.map((s) => s.name),
    ['Alpha FM', 'Beta FM', 'Gamma FM'],
  );

  // Sample rows carry the full preview shape so the dialog can render.
  const alpha = body.sampleStations.find((s) => s._id === 's-genre-only')!;
  assert.equal(alpha.slug, 'alpha-fm');
  assert.equal(alpha.genre, 'rock music');
  assert.equal(alpha.tags, 'guitar,bass');
  assert.equal(alpha.country, 'US');
});

test('merge-preview matches the same set with no targetGenreId supplied', async () => {
  // Without a target the route still returns the matching set — only the
  // target fields go null. Lock that in so the auto-pick path agrees with
  // the admin-picked path on the matched-station list.
  genres.push({
    _id: 'demoted-1',
    name: 'Rock Music',
    slug: 'rock-music',
    cleanupDemotion: { reason: 'collision', collisionWinnerId: 'winner-1' },
  });
  stations.push(
    {
      _id: 's-1',
      name: 'Alpha FM',
      slug: 'alpha-fm',
      genre: 'Rock Music',
      tags: '',
    },
    {
      _id: 's-2',
      name: 'Beta FM',
      slug: 'beta-fm',
      genre: 'Other',
      tags: 'rock music',
    },
  );

  const res = await fetch(
    `${baseUrl}/api/admin/genres/demoted-1/merge-preview`,
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    targetGenreId: string | null;
    targetGenreName: string | null;
    targetGenreSlug: string | null;
    stationsMatched: number;
    sampleStations: Array<{ _id: string }>;
  };
  assert.equal(body.targetGenreId, null);
  assert.equal(body.targetGenreName, null);
  assert.equal(body.targetGenreSlug, null);
  assert.equal(body.stationsMatched, 2);
  assert.deepEqual(
    body.sampleStations.map((s) => s._id).sort(),
    ['s-1', 's-2'].sort(),
  );
});

test('merge-preview returns 404 when the demoted genre id is unknown', async () => {
  const res = await fetch(
    `${baseUrl}/api/admin/genres/does-not-exist/merge-preview`,
  );
  assert.equal(res.status, 404);
  const body = (await res.json()) as { error?: string };
  assert.match(body.error ?? '', /demoted genre not found/i);
});

test('merge-preview returns 400 when the genre is not a collision-demoted row', async () => {
  genres.push({
    _id: 'plain-1',
    name: 'Rock',
    slug: 'rock',
    // No cleanupDemotion at all.
  });
  const res = await fetch(
    `${baseUrl}/api/admin/genres/plain-1/merge-preview`,
  );
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error?: string };
  assert.match(body.error ?? '', /not a slug-cleanup demoted row/i);
});

test('merge-preview returns 400 when targetGenreId equals the demoted row (self-merge)', async () => {
  genres.push({
    _id: 'demoted-1',
    name: 'Rock Music',
    slug: 'rock-music',
    cleanupDemotion: { reason: 'collision', collisionWinnerId: 'winner-1' },
  });
  const res = await fetch(
    `${baseUrl}/api/admin/genres/demoted-1/merge-preview?targetGenreId=demoted-1`,
  );
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error?: string };
  assert.match(body.error ?? '', /into itself/i);
});

test('merge-preview returns 409 when the supplied targetGenreId is missing', async () => {
  genres.push({
    _id: 'demoted-1',
    name: 'Rock Music',
    slug: 'rock-music',
    cleanupDemotion: { reason: 'collision', collisionWinnerId: 'winner-1' },
  });
  const res = await fetch(
    `${baseUrl}/api/admin/genres/demoted-1/merge-preview?targetGenreId=ghost`,
  );
  assert.equal(res.status, 409);
  const body = (await res.json()) as { error?: string };
  assert.match(body.error ?? '', /target genre no longer exists/i);
});

// Parity test: the whole motivation for this suite is that the preview
// endpoint must agree with the actual merge on which stations are
// affected. Run BOTH endpoints against the same fixture set and assert
// the preview's matched-station IDs are exactly the IDs the merge
// re-tags. If the regex / matching logic ever drifts between the two
// route handlers, this test fails immediately.
test('merge-preview matched stations equal the set the POST merge actually re-tags', async () => {
  genres.push(
    {
      _id: 'winner-1',
      name: 'Rock',
      slug: 'rock',
    },
    {
      _id: 'demoted-1',
      name: 'Rock Music',
      slug: 'rock-music',
      cleanupDemotion: { reason: 'collision', collisionWinnerId: 'winner-1' },
    },
  );

  // Mix of matchers + non-matchers + a superstring decoy that must NOT
  // be touched by either endpoint.
  stations.push(
    {
      _id: 's-genre',
      name: 'Alpha FM',
      slug: 'alpha-fm',
      genre: 'Rock Music',
      tags: 'guitar',
    },
    {
      _id: 's-tag',
      name: 'Beta FM',
      slug: 'beta-fm',
      genre: 'Indie',
      tags: 'indie,Rock Music,alt',
    },
    {
      _id: 's-decoy',
      name: 'Delta FM',
      slug: 'delta-fm',
      genre: 'Rock Music Hall',
      tags: 'rock music hall',
    },
    {
      _id: 's-other',
      name: 'Epsilon FM',
      slug: 'epsilon-fm',
      genre: 'Jazz',
      tags: 'jazz',
    },
  );

  // 1) Preview first — capture the set the dialog would show.
  const previewRes = await fetch(
    `${baseUrl}/api/admin/genres/demoted-1/merge-preview?targetGenreId=winner-1`,
  );
  assert.equal(previewRes.status, 200);
  const preview = (await previewRes.json()) as {
    stationsMatched: number;
    sampleStations: Array<{ _id: string; genre: string | null; tags: string | null }>;
  };
  const previewIds = preview.sampleStations.map((s) => s._id).sort();

  // Snapshot pre-merge station shapes so we can detect which rows the
  // merge actually mutated (independent of the route's reported counts).
  const before = new Map(
    stations.map((s) => [s._id, { genre: s.genre, tags: s.tags }]),
  );

  // 2) Real merge against the same dataset.
  const mergeRes = await fetch(
    `${baseUrl}/api/admin/genres/demoted-1/merge-into-winner`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetGenreId: 'winner-1' }),
    },
  );
  const mergeRaw = await mergeRes.text();
  assert.equal(mergeRes.status, 200, mergeRaw);
  const mergeBody = JSON.parse(mergeRaw) as {
    stationsMatched: number;
    stationsRetagged: number;
  };

  // 3) Parity assertions.
  // Reported counts agree.
  assert.equal(
    mergeBody.stationsMatched,
    preview.stationsMatched,
    'merge.stationsMatched must equal preview.stationsMatched',
  );
  // Stations actually mutated by the merge.
  const mutatedIds = stations
    .filter((s) => {
      const b = before.get(s._id)!;
      return b.genre !== s.genre || b.tags !== s.tags;
    })
    .map((s) => s._id)
    .sort();
  assert.deepEqual(
    mutatedIds,
    previewIds,
    'the exact station IDs the preview surfaced must be the IDs the merge mutates',
  );
  // Decoy + non-matching rows untouched.
  const decoy = stations.find((s) => s._id === 's-decoy')!;
  assert.equal(decoy.genre, 'Rock Music Hall');
  assert.equal(decoy.tags, 'rock music hall');
  const other = stations.find((s) => s._id === 's-other')!;
  assert.equal(other.genre, 'Jazz');
  assert.equal(other.tags, 'jazz');
});
