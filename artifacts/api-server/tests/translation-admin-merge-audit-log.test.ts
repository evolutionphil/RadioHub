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

const nativeFixture=genreAdminPgFixture({genres:()=>genres,stations:()=>stations,audits:()=>auditRows});
mock.module('../src/postgres-runtime',{namedExports:{getPostgresPool: () => nativeFixture.pool, getPostgresCoordinationPool: () => nativeFixture.pool,closePostgres:async()=>{}}});
mock.module('../src/data/postgres-catalog-store',{namedExports:{
  pgCatalog:()=>nativeFixture.catalog,pgSyncLogs:async()=>[],PostgresCatalogStore:class {},
}});
// The real native genre-admin store executes its merge transaction against the
// fixture transport; no Mongoose models or fake merge business logic are used.

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
  nativeFixture.setAuditFailure(false);
  nativeFixture.statements.length=0;
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
  const base = Date.now() - 86400000;
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
  // Relative dates keep this range inside the native 180-day retention window.
  const at=(daysAgo:number)=>{const date=new Date(Date.now()-daysAgo*86400000);date.setUTCHours(10,0,0,0);return date;};
  seedAuditRows([
    { demotedGenreName: 'Jan2', createdAt: at(12) },
    { demotedGenreName: 'Jan5', createdAt: at(9) },
    { demotedGenreName: 'Jan9', createdAt: at(5) },
  ]);

  const res = await fetch(
    `${baseUrl}/api/admin/genres/merge-audit-log?from=${at(11).toISOString().slice(0,10)}&to=${at(5).toISOString().slice(0,10)}`,
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

test('mandatory PostgreSQL audit failure rolls back retagging, survivor count and demoted deletion',async()=>{
  genres.push({_id:'winner',name:'Rock',slug:'rock',stationCount:10},{_id:'demoted',name:'Rock Music',slug:'rock-music',cleanupDemotion:{reason:'collision',collisionWinnerId:'winner'}});
  stations.push({_id:'s',slug:'s',genre:'Rock Music',tags:'Rock Music,indie'});
  nativeFixture.setAuditFailure(true);
  const response=await fetch(`${baseUrl}/api/admin/genres/demoted/merge-into-winner`,{method:'POST'});
  assert.equal(response.status,500);assert.equal(genres.length,2);assert.equal(genres.find(g=>g._id==='winner')?.stationCount,10);
  assert.equal(stations[0].genre,'Rock Music');assert.equal(stations[0].tags,'Rock Music,indie');assert.equal(auditRows.length,0);
  assert.ok(nativeFixture.statements.some(s=>s.sql==='ROLLBACK'));assert.equal(nativeFixture.statements.some(s=>s.sql==='COMMIT'),false);
});

test('native audit list excludes expired records and treats punctuation as literal bound search input',async()=>{
  seedAuditRows([{demotedGenreName:'Rock (alt)',actorEmail:'[admin]+one@example.com'},{demotedGenreName:'Rock alternative',actorEmail:'other@example.com'},
    {demotedGenreName:'Expired',createdAt:new Date(Date.now()-181*86400000)}]);
  const all=await(await fetch(`${baseUrl}/api/admin/genres/merge-audit-log`)).json() as any;assert.equal(all.total,2);
  const search='[admin]+';const response=await fetch(`${baseUrl}/api/admin/genres/merge-audit-log?actorEmail=${encodeURIComponent(search)}`);
  const body=await response.json() as any;assert.equal(body.total,1);assert.equal(body.entries[0].demotedGenreName,'Rock (alt)');
  assert.ok(nativeFixture.statements.some(s=>s.sql.startsWith('SELECT * FROM genre_merge_audit_logs')&&s.values[1]===search));
  assert.ok(nativeFixture.statements.every(s=>!s.sql.includes(search)));
});
