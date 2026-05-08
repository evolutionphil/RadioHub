/**
 * Regression tests for the admin genre-whitelist endpoints (Task #188).
 *
 * Locks in the server-side guards added by Task #148:
 *   - POST /api/admin/genre-whitelist/slugs rejects reserved/system slugs
 *     and emits a "no matching stations" warning (without blocking) when
 *     no Genre row matches the slug.
 *   - POST /api/admin/genre-whitelist/aliases rejects a reserved slug on
 *     either side (source or canonical).
 *   - GET /api/admin/genre-whitelist exposes the reserved set so the
 *     dashboard can pre-validate client-side.
 *
 * Runner: requires `--experimental-test-module-mocks` (wired up in
 * artifacts/api-server/package.json#scripts.test).
 */
import { test, mock, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import type { AddressInfo } from 'node:net';
import type { Server as HttpServer } from 'node:http';

import { RESERVED_GENRE_SLUGS } from '../src/seo/reserved-genre-slugs.ts';

// ---------------------------------------------------------------------------
// In-memory store stubs the routes' dependencies will read/write through.
// ---------------------------------------------------------------------------

interface OverrideRow {
  kind: 'slug-add' | 'slug-remove' | 'alias-add' | 'alias-remove';
  slug: string;
  canonical?: string | null;
  notes?: string;
  createdBy?: string;
  createdAt?: Date;
}

const overrideRows: OverrideRow[] = [];
let genreStationCount = 0; // controls Genre.findOne(...) responses.

// Tiny chainable lean()/select()/sort() helper matching mongoose's surface.
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
  find: () => fakeQuery([] as Array<{ slug?: string; stationCount?: number }>),
  findOne: (query: { slug?: string }) =>
    fakeQuery(
      query?.slug
        ? { slug: query.slug, stationCount: genreStationCount }
        : null,
    ),
};

const FakeOverrideModel = {
  find: () => fakeQuery([...overrideRows]),
  findOneAndUpdate: async (
    filter: Partial<OverrideRow>,
    update: { $set?: Partial<OverrideRow>; $setOnInsert?: Partial<OverrideRow> },
    _opts?: unknown,
  ) => {
    const existing = overrideRows.find(
      (r) => r.kind === filter.kind && r.slug === filter.slug,
    );
    if (existing) {
      Object.assign(existing, update.$set ?? {});
      return existing;
    }
    const row: OverrideRow = {
      kind: (filter.kind ?? 'slug-add') as OverrideRow['kind'],
      slug: filter.slug ?? '',
      ...(update.$setOnInsert ?? {}),
      ...(update.$set ?? {}),
    };
    overrideRows.push(row);
    return row;
  },
  deleteOne: async (filter: Partial<OverrideRow>) => {
    const idx = overrideRows.findIndex(
      (r) => r.kind === filter.kind && r.slug === filter.slug,
    );
    if (idx >= 0) overrideRows.splice(idx, 1);
    return { deletedCount: idx >= 0 ? 1 : 0 };
  },
  deleteMany: async (filter: Partial<OverrideRow>) => {
    let removed = 0;
    for (let i = overrideRows.length - 1; i >= 0; i -= 1) {
      const r = overrideRows[i];
      if (
        (filter.kind === undefined || r.kind === filter.kind) &&
        (filter.canonical === undefined || r.canonical === filter.canonical)
      ) {
        overrideRows.splice(i, 1);
        removed += 1;
      }
    }
    return { deletedCount: removed };
  },
};

// ---------------------------------------------------------------------------
// Module mocks — must be installed BEFORE the routes module is imported.
// ---------------------------------------------------------------------------

mock.module('@workspace/db-shared/mongo-schemas', {
  namedExports: {
    Genre: FakeGenreModel,
    GenreWhitelistOverride: FakeOverrideModel,
    Station: { aggregate: async () => [] },
    User: { find: () => fakeQuery([]) },
    UserNotification: { create: async () => ({}) },
    GenreWhitelistPushLog: {
      create: async () => ({}),
      find: () => fakeQuery([]),
    },
    SAFE_GENRE_SLUG_RE: /^[a-z0-9-]+$/,
    normalizeGenreSlug: (slug: string) =>
      String(slug ?? '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, ''),
  },
});

// Static seed: a known seeded slug ("rock") + the seeded alias map. The
// reserved-slug guard runs before the seed check, so the only thing the
// tests really care about is that the merged whitelist contains the
// canonical we use in alias tests.
//
// Both `seededSlugs` and `seededAliases` are mutable from inside tests so
// that DELETE handlers can be exercised against either the seeded or the
// admin-added branch by adjusting membership before the request.
const seededSlugs = new Set<string>(['rock', 'jazz']);
const seededAliases = new Map<string, string>();
mock.module(new URL('../src/seo/genre-whitelist.ts', import.meta.url).href, {
  namedExports: {
    GENRE_WHITELIST: seededSlugs,
    GENRE_ALIASES: seededAliases,
    MIN_STATIONS_FOR_GENRE_INDEX: 3,
  },
});

let mergedWhitelist: Set<string> = new Set(['rock', 'jazz']);
mock.module(new URL('../src/seo/genre-whitelist-store.ts', import.meta.url).href, {
  namedExports: {
    getMergedWhitelist: () => mergedWhitelist,
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
  namedExports: {
    buildAllSitemapManifests: async () => ({}),
  },
});

mock.module(new URL('../src/seo/qualified-languages.ts', import.meta.url).href, {
  namedExports: {
    getCachedQualifiedLanguages: async () => ['en'],
  },
});

mock.module(new URL('../src/seo/url-helpers.ts', import.meta.url).href, {
  namedExports: {
    buildLocalizedUrl: (path: string, lang: string) => `/${lang}${path}`,
  },
});

mock.module(new URL('../src/services/genre-whitelist-push-notifier.ts', import.meta.url).href, {
  namedExports: {
    notifyWhitelistPushResult: async () => {},
  },
});

mock.module(new URL('../src/performance-cache.ts', import.meta.url).href, {
  namedExports: {
    performanceCache: {
      getUrlTranslations: async () => new Map<string, string>(),
    },
  },
});

// ---------------------------------------------------------------------------
// Boot Express app with mocked deps.
// ---------------------------------------------------------------------------

let server: HttpServer;
let baseUrl: string;

before(async () => {
  process.env.NODE_ENV = 'test';

  const mod = (await import('../src/routes/admin-genre-whitelist-routes.ts')) as {
    registerAdminGenreWhitelistRoutes: (
      app: Express,
      deps: { requireAdmin: (req: Request, res: Response, next: NextFunction) => void },
    ) => void;
  };

  const app = express();
  app.use(express.json());
  // Inject a fake admin session so getAdminUsername() succeeds.
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as { session: { adminAuth: { username: string } } }).session = {
      adminAuth: { username: 'test-admin' },
    };
    next();
  });
  mod.registerAdminGenreWhitelistRoutes(app, {
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
  overrideRows.length = 0;
  genreStationCount = 0;
  mergedWhitelist = new Set(['rock', 'jazz']);
  seededSlugs.clear();
  seededSlugs.add('rock');
  seededSlugs.add('jazz');
  seededAliases.clear();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('GET /api/admin/genre-whitelist exposes reservedSlugs mirroring the server set', async () => {
  resetState();
  const res = await fetch(`${baseUrl}/api/admin/genre-whitelist`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { reservedSlugs?: string[] };
  assert.ok(Array.isArray(body.reservedSlugs), 'reservedSlugs must be an array');
  // Same membership as the server set, regardless of order.
  assert.deepEqual(
    [...(body.reservedSlugs ?? [])].sort(),
    [...RESERVED_GENRE_SLUGS].sort(),
  );
  // Spot-check a few well-known reserved entries to catch a mock that
  // accidentally returned an empty array.
  for (const expected of ['stations', 'about', 'admin', 'europe']) {
    assert.ok(
      body.reservedSlugs!.includes(expected),
      `reservedSlugs must include "${expected}"`,
    );
  }
});

test('POST /api/admin/genre-whitelist/slugs rejects a reserved slug with 400', async () => {
  resetState();
  const res = await fetch(`${baseUrl}/api/admin/genre-whitelist/slugs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ slug: 'stations' }),
  });
  assert.equal(res.status, 400, 'reserved slug must be rejected with 400');
  const body = (await res.json()) as { error?: string };
  assert.match(body.error ?? '', /reserved system path/i);
  assert.equal(
    overrideRows.length,
    0,
    'reserved slug must NOT have produced any override row',
  );
});

test('POST /api/admin/genre-whitelist/slugs returns the empty-stations warning shape', async () => {
  resetState();
  genreStationCount = 0; // no Genre row will match.
  const res = await fetch(`${baseUrl}/api/admin/genre-whitelist/slugs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ slug: 'shoegaze' }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    ok?: boolean;
    slug?: string;
    stationCount?: number;
    warning?: string;
    rebuildQueued?: boolean;
  };
  assert.equal(body.ok, true);
  assert.equal(body.slug, 'shoegaze');
  assert.equal(body.stationCount, 0);
  assert.equal(typeof body.warning, 'string', 'warning must be present when stationCount is 0');
  assert.match(body.warning ?? '', /shoegaze/);
  assert.match(body.warning ?? '', /0 stations/);
  assert.equal(body.rebuildQueued, true);
});

test('POST /api/admin/genre-whitelist/slugs omits the warning when stations exist', async () => {
  resetState();
  genreStationCount = 12;
  const res = await fetch(`${baseUrl}/api/admin/genre-whitelist/slugs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ slug: 'dreampop' }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { warning?: string; stationCount?: number };
  assert.equal(body.stationCount, 12);
  assert.equal(body.warning, undefined, 'warning must be omitted when stations exist');
});

test('POST /api/admin/genre-whitelist/aliases rejects a reserved source slug', async () => {
  resetState();
  const res = await fetch(`${baseUrl}/api/admin/genre-whitelist/aliases`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ source: 'stations', canonical: 'rock' }),
  });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error?: string };
  assert.match(body.error ?? '', /reserved system path/i);
  assert.match(body.error ?? '', /alias source/i);
  assert.equal(overrideRows.length, 0);
});

test('POST /api/admin/genre-whitelist/aliases rejects a reserved canonical slug', async () => {
  resetState();
  // The reserved-canonical guard runs before the "must be on whitelist"
  // guard, so we don't need to add the reserved slug to the merged set.
  const res = await fetch(`${baseUrl}/api/admin/genre-whitelist/aliases`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ source: 'rock-music', canonical: 'admin' }),
  });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error?: string };
  assert.match(body.error ?? '', /reserved system path/i);
  assert.match(body.error ?? '', /canonical/i);
  assert.equal(overrideRows.length, 0);
});

// ---------------------------------------------------------------------------
// Task #244: DELETE flows + add-then-remove branches
// ---------------------------------------------------------------------------

test('DELETE /slugs/:slug records a slug-remove override for a seeded slug', async () => {
  resetState();
  // 'rock' is in the seeded whitelist — deleting it should persist a
  // 'slug-remove' override so refresh keeps it gone across restarts.
  const res = await fetch(`${baseUrl}/api/admin/genre-whitelist/slugs/rock`, {
    method: 'DELETE',
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok?: boolean; slug?: string };
  assert.equal(body.ok, true);
  assert.equal(body.slug, 'rock');

  const removes = overrideRows.filter((r) => r.kind === 'slug-remove' && r.slug === 'rock');
  assert.equal(removes.length, 1, 'a single slug-remove override must be persisted');
  assert.equal(removes[0].createdBy, 'test-admin');
  assert.equal(
    overrideRows.filter((r) => r.kind === 'slug-add' && r.slug === 'rock').length,
    0,
    'no slug-add override should remain for a seeded-slug delete',
  );
});

test('DELETE /slugs/:slug just drops the slug-add row for an admin-added slug', async () => {
  resetState();
  // Pre-seed an admin-added override for a non-seeded slug.
  overrideRows.push({
    kind: 'slug-add',
    slug: 'shoegaze',
    canonical: null,
    createdBy: 'test-admin',
    createdAt: new Date(),
  });

  const res = await fetch(`${baseUrl}/api/admin/genre-whitelist/slugs/shoegaze`, {
    method: 'DELETE',
  });
  assert.equal(res.status, 200);

  assert.equal(
    overrideRows.filter((r) => r.kind === 'slug-add' && r.slug === 'shoegaze').length,
    0,
    'admin-added slug-add override must be removed',
  );
  assert.equal(
    overrideRows.filter((r) => r.kind === 'slug-remove' && r.slug === 'shoegaze').length,
    0,
    'no slug-remove override should be persisted for an admin-added slug',
  );
});

test('DELETE /slugs/:slug garbage-collects alias-add overrides whose canonical pointed at it', async () => {
  resetState();
  // 'rock' is seeded; pre-seed two alias-add rows pointing at it plus a
  // third pointing at 'jazz' (which must be left alone).
  overrideRows.push(
    {
      kind: 'alias-add',
      slug: 'rocknroll',
      canonical: 'rock',
      createdBy: 'test-admin',
      createdAt: new Date(),
    },
    {
      kind: 'alias-add',
      slug: 'rock-music',
      canonical: 'rock',
      createdBy: 'test-admin',
      createdAt: new Date(),
    },
    {
      kind: 'alias-add',
      slug: 'smooth-jazz',
      canonical: 'jazz',
      createdBy: 'test-admin',
      createdAt: new Date(),
    },
  );

  const res = await fetch(`${baseUrl}/api/admin/genre-whitelist/slugs/rock`, {
    method: 'DELETE',
  });
  assert.equal(res.status, 200);

  const remainingAliases = overrideRows.filter((r) => r.kind === 'alias-add');
  assert.equal(remainingAliases.length, 1, 'only the alias pointing at jazz must survive');
  assert.equal(remainingAliases[0].slug, 'smooth-jazz');
  assert.equal(remainingAliases[0].canonical, 'jazz');
});

test('DELETE /aliases/:source records an alias-remove override for a seeded alias', async () => {
  resetState();
  // Seed the static alias map so the route takes the "seeded" branch.
  seededAliases.set('rocknroll', 'rock');

  const res = await fetch(`${baseUrl}/api/admin/genre-whitelist/aliases/rocknroll`, {
    method: 'DELETE',
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok?: boolean; source?: string };
  assert.equal(body.ok, true);
  assert.equal(body.source, 'rocknroll');

  const removes = overrideRows.filter(
    (r) => r.kind === 'alias-remove' && r.slug === 'rocknroll',
  );
  assert.equal(removes.length, 1, 'a single alias-remove override must be persisted');
  assert.equal(removes[0].createdBy, 'test-admin');
});

test('DELETE /aliases/:source just drops the alias-add row for an admin-added alias', async () => {
  resetState();
  // No matching seeded alias — pre-seed an admin alias-add row.
  overrideRows.push({
    kind: 'alias-add',
    slug: 'rock-music',
    canonical: 'rock',
    createdBy: 'test-admin',
    createdAt: new Date(),
  });

  const res = await fetch(`${baseUrl}/api/admin/genre-whitelist/aliases/rock-music`, {
    method: 'DELETE',
  });
  assert.equal(res.status, 200);

  assert.equal(
    overrideRows.filter((r) => r.kind === 'alias-add' && r.slug === 'rock-music').length,
    0,
    'admin-added alias-add override must be removed',
  );
  assert.equal(
    overrideRows.filter((r) => r.kind === 'alias-remove' && r.slug === 'rock-music').length,
    0,
    'no alias-remove override should be persisted for an admin-added alias',
  );
});

// ---------------------------------------------------------------------------
// Task #275: slug shape rejection — admin-typed slugs that don't already match
// the safe charset must return 422 with the normalized "Did you mean ..."
// suggestion instead of being silently coerced into GenreWhitelistOverride.
// ---------------------------------------------------------------------------

const DIRTY_SLUG_CASES: Array<{ input: string; suggestion: string }> = [
  { input: 'Hip Hop', suggestion: 'hip-hop' },
  { input: '--rock--', suggestion: 'rock' },
  { input: 'Jazz!', suggestion: 'jazz' },
];

for (const { input, suggestion } of DIRTY_SLUG_CASES) {
  test(`POST /slugs rejects "${input}" with 422 + suggestion and writes nothing`, async () => {
    resetState();
    const res = await fetch(`${baseUrl}/api/admin/genre-whitelist/slugs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: input }),
    });
    assert.equal(res.status, 422, `dirty slug "${input}" must return 422`);
    const body = (await res.json()) as { error?: string };
    assert.match(body.error ?? '', new RegExp(`"${input.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}"`));
    assert.match(body.error ?? '', new RegExp(`"${suggestion}"`));
    assert.match(body.error ?? '', /did you mean/i);
    assert.equal(
      overrideRows.length,
      0,
      `dirty slug "${input}" must NOT have produced any override row`,
    );
  });

  test(`DELETE /slugs/:slug rejects "${input}" with 422 and writes nothing`, async () => {
    resetState();
    const res = await fetch(
      `${baseUrl}/api/admin/genre-whitelist/slugs/${encodeURIComponent(input)}`,
      { method: 'DELETE' },
    );
    assert.equal(res.status, 422);
    const body = (await res.json()) as { error?: string };
    assert.match(body.error ?? '', new RegExp(`"${suggestion}"`));
    assert.equal(overrideRows.length, 0);
  });

  test(`POST /aliases rejects "${input}" as source with 422 and writes nothing`, async () => {
    resetState();
    const res = await fetch(`${baseUrl}/api/admin/genre-whitelist/aliases`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: input, canonical: 'rock' }),
    });
    assert.equal(res.status, 422);
    const body = (await res.json()) as { error?: string };
    assert.match(body.error ?? '', /source/i);
    assert.match(body.error ?? '', new RegExp(`"${suggestion}"`));
    assert.equal(overrideRows.length, 0);
  });

  test(`POST /aliases rejects "${input}" as canonical with 422 and writes nothing`, async () => {
    resetState();
    const res = await fetch(`${baseUrl}/api/admin/genre-whitelist/aliases`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'rock-music', canonical: input }),
    });
    assert.equal(res.status, 422);
    const body = (await res.json()) as { error?: string };
    assert.match(body.error ?? '', /canonical/i);
    assert.match(body.error ?? '', new RegExp(`"${suggestion}"`));
    assert.equal(overrideRows.length, 0);
  });

  test(`DELETE /aliases/:source rejects "${input}" with 422 and writes nothing`, async () => {
    resetState();
    const res = await fetch(
      `${baseUrl}/api/admin/genre-whitelist/aliases/${encodeURIComponent(input)}`,
      { method: 'DELETE' },
    );
    assert.equal(res.status, 422);
    const body = (await res.json()) as { error?: string };
    assert.match(body.error ?? '', /source/i);
    assert.match(body.error ?? '', new RegExp(`"${suggestion}"`));
    assert.equal(overrideRows.length, 0);
  });

  test(`POST /slugs/:slug/genre-row rejects "${input}" with 422 and writes nothing`, async () => {
    resetState();
    const res = await fetch(
      `${baseUrl}/api/admin/genre-whitelist/slugs/${encodeURIComponent(input)}/genre-row`,
      { method: 'POST' },
    );
    assert.equal(res.status, 422);
    const body = (await res.json()) as { error?: string };
    assert.match(body.error ?? '', new RegExp(`"${suggestion}"`));
    assert.match(body.error ?? '', /did you mean/i);
    assert.equal(
      overrideRows.length,
      0,
      `genre-row dirty slug "${input}" must NOT have produced any override row`,
    );
  });
}

test('POST /slugs accepts a clean slug "hip-hop" end-to-end and persists an override', async () => {
  resetState();
  genreStationCount = 5;
  const res = await fetch(`${baseUrl}/api/admin/genre-whitelist/slugs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ slug: 'hip-hop' }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok?: boolean; slug?: string };
  assert.equal(body.ok, true);
  assert.equal(body.slug, 'hip-hop');
  // 'hip-hop' is not in the seeded whitelist (rock+jazz), so an explicit
  // slug-add override must have been persisted with the admin's identity.
  const adds = overrideRows.filter((r) => r.kind === 'slug-add' && r.slug === 'hip-hop');
  assert.equal(adds.length, 1, 'a single slug-add override must be persisted');
  assert.equal(adds[0].createdBy, 'test-admin');
});

test('POST /aliases rejects a canonical that is not on the merged whitelist', async () => {
  resetState();
  // 'electronica' is not in mergedWhitelist (which only has rock+jazz)
  // and is not reserved, so the route should fail the "canonical must be
  // on the whitelist" guard with a 400.
  const res = await fetch(`${baseUrl}/api/admin/genre-whitelist/aliases`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ source: 'edm', canonical: 'electronica' }),
  });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error?: string };
  assert.match(body.error ?? '', /not on the whitelist/i);
  assert.match(body.error ?? '', /electronica/);
  assert.equal(
    overrideRows.length,
    0,
    'rejected alias must NOT have produced any override row',
  );
});
