/**
 * Regression tests for the admin "create genre" endpoint (Task #281).
 *
 * Locks in the POST /api/genres route added by Task #209 — the admin
 * genres page already had a "Create" dialog that POSTed here, but the
 * route was never registered for a while and creates 404'd silently.
 * These tests guard against that regressing again, and cover the four
 * documented behaviours:
 *   - Successful create returns 201 with the new genre (admin-only)
 *   - Invalid slug (failing SAFE_GENRE_SLUG_RE) returns 400
 *   - Duplicate slug returns 409
 *   - Non-admins are rejected by requireAdmin (401)
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
// Real PostgreSQL persistence; only non-database side effects are mocked.
// ---------------------------------------------------------------------------

interface GenreRow {
  _id: string;
  name: string;
  slug: string;
  isDiscoverable?: boolean;
  description?: string;
  posterImage?: string;
  discoverableImage?: string;
  displayOrder?: number;
  stationCount?: number;
  createdAt?: Date;
  updatedAt?: Date;
}

let fixture: Awaited<ReturnType<typeof createNativePostgresFixture>>;
let refreshAllCalls = 0;
async function genreCount(){return Number((await fixture.pool.query('SELECT count(*) AS count FROM genres')).rows[0].count);}

mock.module(
  new URL('../src/services/recommendation-engine.ts', import.meta.url).href,
  {
    namedExports: {
      RecommendationEngine: {
        recordUserInteraction: async () => {},
        getPersonalizedSimilarStations: async () => [],
      },
    },
  },
);

mock.module(new URL('../src/cache.ts', import.meta.url).href, {
  namedExports: {
    CacheKeys: {
      genres: (...parts: unknown[]) => `genres:${JSON.stringify(parts)}`,
    },
  },
  defaultExport: {
    get: async () => null,
    set: async () => {},
    del: async () => {},
  },
});

mock.module(
  new URL('../src/services/precomputed-genres.ts', import.meta.url).href,
  {
    namedExports: {
      PrecomputedGenresService: {
        getGenres: async () => ({ genres: [], computedAt: 0, countryName: 'global' }),
        refreshAll: async () => {
          refreshAllCalls += 1;
        },
      },
    },
  },
);

mock.module(new URL('../src/utils/normalize-country.ts', import.meta.url).href, {
  namedExports: {
    normalizeCountryFilter: () => ({}),
    resolveToDbName: (s: string) => s,
    getAllCountryInfoFromDb: () => [],
  },
});

mock.module(new URL('../src/routes/shared-utils.ts', import.meta.url).href, {
  namedExports: {
    tvValidateParams: () => ({ page: 1, limit: 9 }),
    tvSlimGenre: <T,>(g: T) => g,
    stripPlaceholders: <T,>(g: T) => g,
  },
});

mock.module(new URL('../src/utils/logger.ts', import.meta.url).href, {
  namedExports: {
    logger: {
      log: () => {},
      error: () => {},
      warn: () => {},
      info: () => {},
      debug: () => {},
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
  fixture=await createNativePostgresFixture('admin_genre_create');

  const mod = (await import(
    '../src/routes/genres-countries-routes.ts'
  )) as {
    registerGenresCountriesRoutes: (
      app: Express,
      deps: {
        requireAdmin: (req: Request, res: Response, next: NextFunction) => void;
      },
    ) => void;
  };

  const app = express();
  app.use(express.json());

  // Test-only requireAdmin: callers opt in by sending `x-admin: 1`.
  // This lets us cover both the success path and the "non-admin
  // rejected" path without standing up real session/passport plumbing.
  const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
    if (req.header('x-admin') === '1') return next();
    return void res.status(401).json({ error: 'Admin required' });
  };

  mod.registerGenresCountriesRoutes(app, { requireAdmin });

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
  await fixture.clear('genres');
  refreshAllCalls = 0;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('POST /api/genres rejects non-admins with 401', async () => {
  await resetState();
  const res = await fetch(`${baseUrl}/api/genres`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Shoegaze', slug: 'shoegaze' }),
  });
  assert.equal(res.status, 401, 'non-admin must be rejected');
  assert.equal(await genreCount(), 0, 'no genre must be persisted for non-admins');
});

test('POST /api/genres creates a new genre and returns 201 (admin)', async () => {
  await resetState();
  const res = await fetch(`${baseUrl}/api/genres`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-admin': '1' },
    body: JSON.stringify({
      name: '  Shoegaze  ',
      slug: 'shoegaze',
      description: 'Wall-of-sound guitars',
      isDiscoverable: true,
      displayOrder: 7,
    }),
  });
  assert.equal(res.status, 201);
  const body = (await res.json()) as Partial<GenreRow>;
  assert.equal(body.name, 'Shoegaze', 'name must be trimmed before persist');
  assert.equal(body.slug, 'shoegaze');
  assert.equal(body.isDiscoverable, true);
  assert.equal(body.description, 'Wall-of-sound guitars');
  assert.equal(body.displayOrder, 7);
  assert.ok(body._id, 'created genre must have an _id');

  assert.equal(await genreCount(), 1, 'a single Genre row must be persisted');
  assert.equal(
    refreshAllCalls,
    1,
    'PrecomputedGenresService.refreshAll must be invoked exactly once after create',
  );
});

test('POST /api/genres rejects an invalid slug with 400 (SAFE_GENRE_SLUG_RE)', async () => {
  await resetState();
  // Uppercase + space — fails /^[a-z0-9]+(?:-[a-z0-9]+)*$/.
  const res = await fetch(`${baseUrl}/api/genres`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-admin': '1' },
    body: JSON.stringify({ name: 'Bad Slug', slug: 'Bad Slug!' }),
  });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error?: string };
  assert.match(body.error ?? '', /invalid slug/i);
  assert.equal(await genreCount(), 0, 'invalid-slug request must NOT persist a row');
  assert.equal(refreshAllCalls, 0, 'refreshAll must NOT run when validation fails');
});

test('POST /api/genres rejects a duplicate slug with 409', async () => {
  await resetState();
  // Pre-seed an existing genre with slug "rock".
  await fixture.insert('genres',{
    _id: 'seed-1',
    name: 'Rock',
    slug: 'rock',
    isDiscoverable: true,
  });

  const res = await fetch(`${baseUrl}/api/genres`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-admin': '1' },
    body: JSON.stringify({ name: 'Rock 2', slug: 'rock' }),
  });
  assert.equal(res.status, 409);
  const body = (await res.json()) as { error?: string };
  assert.match(body.error ?? '', /already exists/i);
  assert.match(body.error ?? '', /rock/);
  assert.equal(await genreCount(), 1, 'duplicate-slug request must NOT add a new row');
});

test('POST /api/genres rejects missing name with 400', async () => {
  await resetState();
  const res = await fetch(`${baseUrl}/api/genres`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-admin': '1' },
    body: JSON.stringify({ slug: 'jazz' }),
  });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error?: string };
  assert.match(body.error ?? '', /name is required/i);
  assert.equal(await genreCount(), 0);
});
