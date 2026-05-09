/**
 * Regression tests for the GenreMergeAuditLog wired up by Task #289.
 *
 * The merge endpoint at POST /api/admin/genres/:id/merge-into-winner
 * writes one structured row per successful merge so a future regression
 * that silently drops the audit write would not be caught by the
 * existing merge-behaviour suite. This file locks in:
 *
 *   - audit row written for the auto-recorded path (winner came from
 *     `cleanupDemotion.collisionWinnerId`); targetSource = 'auto-recorded';
 *     station counts, slugs, names, actor email all populated correctly.
 *   - audit row written for the manual-target path (admin-picked
 *     `targetGenreId` body param), including the empty-slug case where
 *     the demoted row has no recorded winner.
 *   - GET /api/admin/genres/merge-audit-log: pagination (limit/offset +
 *     total) and the actorEmail / genre / targetSource / from-to date
 *     filters all narrow the list correctly.
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

interface FakeAuditRow {
  _id: string;
  demotedGenreId: string;
  demotedGenreName: string;
  demotedGenreSlug: string;
  winnerGenreId: string;
  winnerGenreName: string;
  winnerGenreSlug: string;
  targetSource: 'manual' | 'auto-recorded';
  stationsMatched: number;
  stationsRetagged: number;
  actorUserId: string | null;
  actorEmail: string | null;
  createdAt: Date;
}

let genres: FakeGenreRow[] = [];
let stations: FakeStationRow[] = [];
let auditRows: FakeAuditRow[] = [];
let auditIdSeq = 0;

// Admin identity that the requireAdmin stub injects onto req.user. Tests
// reassign this before issuing a request so we can exercise the
// actorUserId / actorEmail capture paths.
let currentUser: { _id?: string; id?: string; email?: string } | null = null;

function fakeQuery<T>(value: T) {
  const q: {
    select: () => typeof q;
    lean: <U = T>() => Promise<U>;
    then: <R>(onFulfilled?: (v: T) => R) => Promise<R>;
  } = {
    select: () => q,
    lean: async () => value as unknown as never,
    then: (resolve) =>
      Promise.resolve(value).then(resolve as (v: T) => unknown) as Promise<never>,
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
// GenreMergeAuditLog mock — must support the route's write path AND the
// list-endpoint's filter / sort / skip / limit / countDocuments calls.
// ---------------------------------------------------------------------------

interface AuditFilter {
  targetSource?: string;
  actorEmail?: { $regex: string; $options?: string };
  $or?: Array<Record<string, { $regex: string; $options?: string }>>;
  createdAt?: { $gte?: Date; $lte?: Date };
}

function regexTest(
  cond: { $regex: string; $options?: string } | undefined,
  value: string | null | undefined,
): boolean {
  if (!cond) return true;
  const re = new RegExp(cond.$regex, cond.$options ?? '');
  return typeof value === 'string' && re.test(value);
}

function matchAuditRow(row: FakeAuditRow, filter: AuditFilter): boolean {
  if (filter.targetSource && row.targetSource !== filter.targetSource) {
    return false;
  }
  if (filter.actorEmail && !regexTest(filter.actorEmail, row.actorEmail)) {
    return false;
  }
  if (filter.$or) {
    const ok = filter.$or.some((clause) => {
      const [field, cond] = Object.entries(clause)[0] ?? [];
      const v = (row as unknown as Record<string, unknown>)[field];
      return regexTest(
        cond as { $regex: string; $options?: string },
        typeof v === 'string' ? v : null,
      );
    });
    if (!ok) return false;
  }
  if (filter.createdAt) {
    const t = row.createdAt.getTime();
    if (filter.createdAt.$gte && t < filter.createdAt.$gte.getTime()) {
      return false;
    }
    if (filter.createdAt.$lte && t > filter.createdAt.$lte.getTime()) {
      return false;
    }
  }
  return true;
}

const FakeAuditModel = {
  create: async (entry: Omit<FakeAuditRow, '_id' | 'createdAt'> & { createdAt?: Date }) => {
    auditIdSeq += 1;
    const row: FakeAuditRow = {
      _id: `audit-${auditIdSeq}`,
      createdAt: entry.createdAt ?? new Date(),
      ...entry,
    } as FakeAuditRow;
    auditRows.push(row);
    return row;
  },
  estimatedDocumentCount: async () => auditRows.length,
  countDocuments: async (filter: AuditFilter = {}) =>
    auditRows.filter((r) => matchAuditRow(r, filter)).length,
  find: (filter: AuditFilter = {}, _projection?: unknown) => {
    let snapshot = auditRows.filter((r) => matchAuditRow(r, filter));
    let skipN = 0;
    let limitN = Number.POSITIVE_INFINITY;
    let sortDir: 1 | -1 | null = null;
    const builder = {
      sort: (spec: { createdAt?: 1 | -1 }) => {
        sortDir = spec.createdAt ?? null;
        return builder;
      },
      skip: (n: number) => {
        skipN = n;
        return builder;
      },
      limit: (n: number) => {
        limitN = n;
        return builder;
      },
      lean: async () => {
        if (sortDir !== null) {
          const dir = sortDir;
          snapshot = [...snapshot].sort(
            (a, b) =>
              (a.createdAt.getTime() - b.createdAt.getTime()) * dir,
          );
        }
        return snapshot.slice(skipN, skipN + limitN);
      },
    };
    return builder;
  },
  deleteMany: async () => ({ deletedCount: 0 }),
};

// ---------------------------------------------------------------------------
// Module mocks — installed BEFORE the route module is imported.
// ---------------------------------------------------------------------------

mock.module('@workspace/db-shared/mongo-schemas', {
  namedExports: {
    Genre: FakeGenreModel,
    Station: FakeStationModel,
    GenreMergeAuditLog: FakeAuditModel,
    // Other models destructured at the top of the route file are
    // unused here — empty stubs keep the destructure from blowing up.
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
    performanceCache: { invalidateStationCache: () => {} },
  },
});

mock.module(new URL('../src/services/precomputed-genres.ts', import.meta.url).href, {
  namedExports: {
    PrecomputedGenresService: { refreshAll: async () => {} },
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
  // requireAdmin stub also injects the current acting admin onto req.user
  // so the merge handler can capture actorUserId / actorEmail.
  const injectUser = (req: Request, _res: Response, next: NextFunction) => {
    if (currentUser) {
      (req as Request & { user?: unknown }).user = currentUser;
    }
    next();
  };
  mod.registerTranslationAdminRoutes(app, {
    requireAuth: injectUser,
    requireAdmin: injectUser,
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
  auditRows = [];
  auditIdSeq = 0;
  currentUser = null;
});

// ---------------------------------------------------------------------------
// Tests — write path
// ---------------------------------------------------------------------------

test('merge audit row is written for the auto-recorded (collisionWinnerId) path', async () => {
  currentUser = { _id: 'admin-user-1', email: 'auto@example.com' };

  genres.push(
    { _id: 'winner-auto', name: 'Rock', slug: 'rock', stationCount: 0 },
    {
      _id: 'demoted-auto',
      name: 'Rock Music',
      slug: 'rock-music',
      cleanupDemotion: { reason: 'collision', collisionWinnerId: 'winner-auto' },
    },
  );
  stations.push(
    { _id: 's1', slug: 's1', genre: 'Rock Music', tags: 'guitar' },
    { _id: 's2', slug: 's2', genre: 'Indie', tags: 'rock,Rock Music' },
  );

  const res = await fetch(
    `${baseUrl}/api/admin/genres/demoted-auto/merge-into-winner`,
    { method: 'POST' },
  );
  assert.equal(res.status, 200, await res.text());

  assert.equal(auditRows.length, 1, 'exactly one audit row must be written');
  const row = auditRows[0]!;
  assert.equal(row.demotedGenreId, 'demoted-auto');
  assert.equal(row.demotedGenreName, 'Rock Music');
  assert.equal(row.demotedGenreSlug, 'rock-music');
  assert.equal(row.winnerGenreId, 'winner-auto');
  assert.equal(row.winnerGenreName, 'Rock');
  assert.equal(row.winnerGenreSlug, 'rock');
  assert.equal(row.targetSource, 'auto-recorded');
  assert.equal(row.stationsMatched, 2);
  assert.equal(row.stationsRetagged, 2);
  assert.equal(row.actorUserId, 'admin-user-1');
  assert.equal(row.actorEmail, 'auto@example.com');
});

test('merge audit row is written for the manual-target path (admin-picked targetGenreId)', async () => {
  currentUser = { _id: 'admin-user-2', email: 'manual@example.com' };

  genres.push(
    { _id: 'winner-manual', name: 'Pop', slug: 'pop', stationCount: 0 },
    {
      _id: 'demoted-manual',
      name: 'Old Pop',
      slug: 'old-pop',
      // The route would normally auto-pick this winner; the admin
      // overrides it with `targetGenreId` in the body, which must flip
      // the audit row's targetSource to 'manual'.
      cleanupDemotion: { reason: 'collision', collisionWinnerId: 'winner-manual' },
    },
  );
  stations.push({ _id: 's-m', slug: 's-m', genre: 'Old Pop', tags: 'pop' });

  const res = await fetch(
    `${baseUrl}/api/admin/genres/demoted-manual/merge-into-winner`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetGenreId: 'winner-manual' }),
    },
  );
  assert.equal(res.status, 200, await res.text());

  assert.equal(auditRows.length, 1);
  const row = auditRows[0]!;
  assert.equal(row.targetSource, 'manual');
  assert.equal(row.demotedGenreId, 'demoted-manual');
  assert.equal(row.winnerGenreId, 'winner-manual');
  assert.equal(row.stationsMatched, 1);
  assert.equal(row.stationsRetagged, 1);
  assert.equal(row.actorEmail, 'manual@example.com');
});

test('merge audit row is written for the empty-slug + manual-target path', async () => {
  currentUser = { id: 'admin-user-3', email: 'empty@example.com' };

  genres.push(
    { _id: 'winner-empty', name: 'Jazz', slug: 'jazz', stationCount: 0 },
    {
      _id: 'demoted-empty',
      name: 'Smooth Jazz',
      slug: 'smooth-jazz',
      // Empty-slug demotions land here with collisionWinnerId === null,
      // so the merge is only allowed when an admin supplies targetGenreId.
      cleanupDemotion: { reason: 'empty-slug', collisionWinnerId: null },
    },
  );
  stations.push({
    _id: 's-empty',
    slug: 's-empty',
    genre: 'Smooth Jazz',
    tags: 'jazz',
  });

  const res = await fetch(
    `${baseUrl}/api/admin/genres/demoted-empty/merge-into-winner`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetGenreId: 'winner-empty' }),
    },
  );
  assert.equal(res.status, 200, await res.text());

  assert.equal(auditRows.length, 1);
  const row = auditRows[0]!;
  assert.equal(row.targetSource, 'manual');
  assert.equal(row.demotedGenreId, 'demoted-empty');
  assert.equal(row.demotedGenreName, 'Smooth Jazz');
  assert.equal(row.winnerGenreId, 'winner-empty');
  assert.equal(row.winnerGenreName, 'Jazz');
  assert.equal(row.stationsMatched, 1);
  assert.equal(row.stationsRetagged, 1);
  // `actor.id` (not `_id`) must also flow through to actorUserId.
  assert.equal(row.actorUserId, 'admin-user-3');
  assert.equal(row.actorEmail, 'empty@example.com');
});

// ---------------------------------------------------------------------------
// Tests — list endpoint (pagination + filters)
// ---------------------------------------------------------------------------

function seedAuditRows(rows: Array<Partial<FakeAuditRow>>): void {
  for (const r of rows) {
    auditIdSeq += 1;
    auditRows.push({
      _id: `audit-${auditIdSeq}`,
      demotedGenreId: 'd',
      demotedGenreName: 'Demoted',
      demotedGenreSlug: 'demoted',
      winnerGenreId: 'w',
      winnerGenreName: 'Winner',
      winnerGenreSlug: 'winner',
      targetSource: 'auto-recorded',
      stationsMatched: 1,
      stationsRetagged: 1,
      actorUserId: null,
      actorEmail: null,
      createdAt: new Date(),
      ...r,
    } as FakeAuditRow);
  }
}

test('GET merge-audit-log paginates with limit + offset and returns total', async () => {
  const base = Date.UTC(2026, 0, 1, 12, 0, 0);
  seedAuditRows(
    Array.from({ length: 5 }, (_, i) => ({
      demotedGenreName: `Demoted ${i}`,
      // i=0 oldest, i=4 newest. Default sort is -createdAt so newest first.
      createdAt: new Date(base + i * 1000),
    })),
  );

  // Page 1: limit=2 → newest two.
  const r1 = await fetch(`${baseUrl}/api/admin/genres/merge-audit-log?limit=2&offset=0`);
  assert.equal(r1.status, 200);
  const b1 = (await r1.json()) as {
    entries: Array<{ demotedGenreName: string }>;
    total: number;
    limit: number;
    offset: number;
  };
  assert.equal(b1.total, 5);
  assert.equal(b1.limit, 2);
  assert.equal(b1.offset, 0);
  assert.deepEqual(
    b1.entries.map((e) => e.demotedGenreName),
    ['Demoted 4', 'Demoted 3'],
  );

  // Page 2: limit=2 offset=2 → next two.
  const r2 = await fetch(`${baseUrl}/api/admin/genres/merge-audit-log?limit=2&offset=2`);
  const b2 = (await r2.json()) as { entries: Array<{ demotedGenreName: string }> };
  assert.deepEqual(
    b2.entries.map((e) => e.demotedGenreName),
    ['Demoted 2', 'Demoted 1'],
  );
});

test('GET merge-audit-log filters by actorEmail (case-insensitive substring)', async () => {
  seedAuditRows([
    { demotedGenreName: 'A', actorEmail: 'alice@example.com' },
    { demotedGenreName: 'B', actorEmail: 'bob@other.com' },
    { demotedGenreName: 'C', actorEmail: 'ALICE+admin@example.com' },
  ]);

  const res = await fetch(
    `${baseUrl}/api/admin/genres/merge-audit-log?actorEmail=alice`,
  );
  const body = (await res.json()) as {
    total: number;
    entries: Array<{ demotedGenreName: string }>;
  };
  assert.equal(body.total, 2);
  assert.deepEqual(
    body.entries.map((e) => e.demotedGenreName).sort(),
    ['A', 'C'],
  );
});

test('GET merge-audit-log filters by genre across demoted/winner name+slug', async () => {
  seedAuditRows([
    { demotedGenreName: 'Rock Music', winnerGenreName: 'Rock' },
    { demotedGenreName: 'Old Pop', winnerGenreName: 'Pop', winnerGenreSlug: 'pop' },
    { demotedGenreName: 'Smooth Jazz', winnerGenreName: 'Jazz' },
  ]);

  const res = await fetch(
    `${baseUrl}/api/admin/genres/merge-audit-log?genre=rock`,
  );
  const body = (await res.json()) as {
    total: number;
    entries: Array<{ demotedGenreName: string }>;
  };
  assert.equal(body.total, 1);
  assert.equal(body.entries[0]!.demotedGenreName, 'Rock Music');
});

test('GET merge-audit-log filters by targetSource', async () => {
  seedAuditRows([
    { demotedGenreName: 'M1', targetSource: 'manual' },
    { demotedGenreName: 'A1', targetSource: 'auto-recorded' },
    { demotedGenreName: 'A2', targetSource: 'auto-recorded' },
  ]);

  const manual = (await (
    await fetch(`${baseUrl}/api/admin/genres/merge-audit-log?targetSource=manual`)
  ).json()) as { total: number; entries: Array<{ demotedGenreName: string }> };
  assert.equal(manual.total, 1);
  assert.equal(manual.entries[0]!.demotedGenreName, 'M1');

  const auto = (await (
    await fetch(
      `${baseUrl}/api/admin/genres/merge-audit-log?targetSource=auto-recorded`,
    )
  ).json()) as { total: number };
  assert.equal(auto.total, 2);

  // Unknown value → 400, not a silent pass-through.
  const bad = await fetch(
    `${baseUrl}/api/admin/genres/merge-audit-log?targetSource=bogus`,
  );
  assert.equal(bad.status, 400);
});

test('GET merge-audit-log filters by from/to date range (inclusive)', async () => {
  seedAuditRows([
    { demotedGenreName: 'Jan2', createdAt: new Date('2026-01-02T10:00:00Z') },
    { demotedGenreName: 'Jan5', createdAt: new Date('2026-01-05T10:00:00Z') },
    { demotedGenreName: 'Jan9', createdAt: new Date('2026-01-09T10:00:00Z') },
  ]);

  const res = await fetch(
    `${baseUrl}/api/admin/genres/merge-audit-log?from=2026-01-03&to=2026-01-09`,
  );
  const body = (await res.json()) as {
    total: number;
    entries: Array<{ demotedGenreName: string }>;
  };
  // `to=YYYY-MM-DD` is widened to end-of-day, so Jan9 must still match.
  assert.equal(body.total, 2);
  assert.deepEqual(
    body.entries.map((e) => e.demotedGenreName).sort(),
    ['Jan5', 'Jan9'],
  );
});
