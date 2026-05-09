/**
 * Regression tests for the duplicate-slug guard on POST /api/genres
 * (Task #370 — extends the PUT-side coverage from Task #283).
 *
 * Two facets, mirroring the create-side of the route:
 *   1. Route-level pre-check in `POST /api/genres` returns 409 when a
 *      genre already owns the requested slug.
 *   2. Route's E11000 catch block translates a DB-level race (the
 *      partial unique index firing between the pre-check and the
 *      insert) into 409 instead of leaking a 500.
 *
 * The DB-level contract (the partial unique index on `slug`) is
 * already locked in by `genre-slug-duplicate-guard.test.ts`, so we
 * don't re-assert it here — the same index protects both create and
 * update writes.
 *
 * Runner: requires `--experimental-test-module-mocks` (wired up in
 * artifacts/api-server/package.json#scripts.test).
 */
import { test, mock, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import type { AddressInfo } from 'node:net';
import type { Server as HttpServer } from 'node:http';

import { SAFE_GENRE_SLUG_RE } from '@workspace/db-shared/mongo-schemas';

// ---------------------------------------------------------------------------
// Recording fakes for the Mongoose Genre model the POST route touches.
// ---------------------------------------------------------------------------

interface LeanQuery<T> extends PromiseLike<T> {
  select: (..._a: unknown[]) => LeanQuery<T>;
  lean: <U = T>() => Promise<U>;
}
function leanQuery<T>(value: T): LeanQuery<T> {
  const q: LeanQuery<T> = {
    select: () => q,
    lean: async () => value as unknown as never,
    then: (resolve, reject) => Promise.resolve(value).then(resolve, reject),
  };
  return q;
}

let existingDoc: { _id: unknown; name: string; slug: string } | null = null;
let createImpl: (doc: unknown) => Promise<unknown> = async (doc) => ({ _id: 'created', ...(doc as object) });

const findOneCalls: Array<Record<string, unknown>> = [];
const createCalls: Array<unknown> = [];

const FakeGenre = {
  findOne: (filter: Record<string, unknown>) => {
    findOneCalls.push(filter);
    return leanQuery(existingDoc);
  },
  create: async (doc: unknown) => {
    createCalls.push(doc);
    return createImpl(doc);
  },
};

// ---------------------------------------------------------------------------
// Module mocks — must be installed BEFORE the routes module is imported
// inside `before()`.
// ---------------------------------------------------------------------------

mock.module('@workspace/db-shared/mongo-schemas', {
  namedExports: {
    Genre: FakeGenre,
    Country: {},
    Station: {},
    UserProfile: {},
    UserListeningHistory: {},
    SAFE_GENRE_SLUG_RE,
  },
});

mock.module(new URL('../src/services/precomputed-genres.ts', import.meta.url).href, {
  namedExports: {
    PrecomputedGenresService: {
      refreshAll: async () => {},
    },
  },
});

mock.module(new URL('../src/services/recommendation-engine.ts', import.meta.url).href, {
  namedExports: {
    RecommendationEngine: class {},
  },
});

mock.module(new URL('../src/cache.ts', import.meta.url).href, {
  defaultExport: {
    get: async () => null,
    set: async () => {},
    delete: async () => {},
    clearByPattern: async () => {},
  },
  namedExports: { CacheKeys: {} },
});

mock.module(new URL('../src/utils/normalize-country.ts', import.meta.url).href, {
  namedExports: {
    normalizeCountryFilter: (v: unknown) => v,
    resolveToDbName: (v: unknown) => v,
    getAllCountryInfoFromDb: async () => [],
  },
});

mock.module(new URL('../src/routes/shared-utils.ts', import.meta.url).href, {
  namedExports: {
    tvValidateParams: () => true,
    tvSlimGenre: <T>(v: T) => v,
    stripPlaceholders: <T>(v: T) => v,
  },
});

// ---------------------------------------------------------------------------
// Boot one Express app per test file with the genres routes registered.
// ---------------------------------------------------------------------------

let server: HttpServer;
let baseUrl: string;

before(async () => {
  process.env.NODE_ENV = 'test';

  const mod = (await import('../src/routes/genres-countries-routes.ts')) as {
    registerGenresCountriesRoutes: (
      app: Express,
      deps: { requireAdmin: (req: Request, res: Response, next: NextFunction) => void },
    ) => void;
  };

  const app = express();
  app.use(express.json());
  const passthrough = (_req: Request, _res: Response, next: NextFunction) => next();
  mod.registerGenresCountriesRoutes(app, { requireAdmin: passthrough });

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
  existingDoc = null;
  createImpl = async (doc) => ({ _id: 'created', ...(doc as object) });
  findOneCalls.length = 0;
  createCalls.length = 0;
});

// ---------------------------------------------------------------------------
// 1. Route-level guard: POST collides with an existing genre's slug → 409
// ---------------------------------------------------------------------------

test('POST /api/genres returns 409 when the requested slug already belongs to another genre', async () => {
  existingDoc = { _id: 'g-rock', name: 'Rock', slug: 'rock' };

  const res = await fetch(`${baseUrl}/api/genres`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Rock Music', slug: 'rock' }),
  });

  assert.equal(res.status, 409, 'duplicate slug must be rejected with 409');
  const body = (await res.json()) as { error?: string };
  assert.equal(typeof body.error, 'string', 'response must carry a helpful error string');
  assert.match(body.error ?? '', /rock/, 'error must name the colliding slug');
  assert.match(
    body.error ?? '',
    /already exists/i,
    'error must explain that a genre with that slug already exists',
  );

  // The collision check must look up the exact requested slug.
  assert.equal(findOneCalls.length, 1, 'expected exactly one Genre.findOne collision check');
  const filter = findOneCalls[0] as { slug?: string };
  assert.equal(filter.slug, 'rock');

  // Most importantly: the route must NEVER have attempted the insert.
  assert.equal(
    createCalls.length,
    0,
    'route must short-circuit before Genre.create when a collision is detected',
  );
});

// ---------------------------------------------------------------------------
// 2. Race-window safety net: pre-check passes, but Mongo rejects the
//    insert via the partial unique index (E11000). The route must
//    translate that to 409 instead of leaking a 500.
// ---------------------------------------------------------------------------

test('POST /api/genres returns 409 when the DB-level unique index rejects the insert', async () => {
  existingDoc = null;
  createImpl = async () => {
    const err = new Error('E11000 duplicate key error') as Error & {
      code?: number;
      keyPattern?: Record<string, number>;
      keyValue?: Record<string, string>;
    };
    err.code = 11000;
    err.keyPattern = { slug: 1 };
    err.keyValue = { slug: 'jazz' };
    throw err;
  };

  const res = await fetch(`${baseUrl}/api/genres`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Jazz', slug: 'jazz' }),
  });

  assert.equal(res.status, 409, 'E11000 from the partial unique index must surface as 409');
  const body = (await res.json()) as { error?: string };
  assert.match(body.error ?? '', /jazz/);
  assert.match(body.error ?? '', /already exists/i);

  // The route reached Genre.create (the pre-check returned no
  // collision), and Mongo's index — not the route — was what stopped
  // the duplicate.
  assert.equal(createCalls.length, 1);
});
