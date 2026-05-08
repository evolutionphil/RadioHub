/**
 * Regression tests for the duplicate-slug guard on Genre admin writes
 * (Task #210, covered by Task #283).
 *
 * Four facets:
 *   1. Route-level pre-check in `PUT /api/genres/:id` returns 409 when
 *      another genre already owns the slug.
 *   2. Route's E11000 catch block translates a DB-level race into 409.
 *   3. GenreSchema still declares the partial unique index that backs
 *      the safety net (fast schema introspection check).
 *   4. A real in-memory MongoDB rejects a direct duplicate slug insert
 *      with E11000 (mongodb-memory-server).
 *
 * Runner: requires `--experimental-test-module-mocks` (wired up in
 * artifacts/api-server/package.json#scripts.test).
 */
import { test, mock, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import type { AddressInfo } from 'node:net';
import type { Server as HttpServer } from 'node:http';

// Import the real Genre model (and the safe-slug regex) BEFORE the
// mongo-schemas mock is installed so the schema-level test below can
// introspect the production index spec.
import {
  Genre as RealGenre,
  SAFE_GENRE_SLUG_RE,
} from '@workspace/db-shared/mongo-schemas';

// ---------------------------------------------------------------------------
// Recording fakes for the Mongoose models the PUT route touches.
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

// Test-controlled responses for the two Genre calls the PUT route makes.
let collisionDoc: { _id: unknown; name: string } | null = null;
let findByIdAndUpdateImpl: (id: string, ops: unknown) => Promise<unknown> = async () => ({});

const findOneCalls: Array<Record<string, unknown>> = [];
const findByIdAndUpdateCalls: Array<{ id: string; ops: unknown }> = [];

const FakeGenre = {
  findOne: (filter: Record<string, unknown>) => {
    findOneCalls.push(filter);
    return leanQuery(collisionDoc);
  },
  findByIdAndUpdate: async (id: string, ops: unknown, _opts: unknown) => {
    findByIdAndUpdateCalls.push({ id, ops });
    return findByIdAndUpdateImpl(id, ops);
  },
};

// ---------------------------------------------------------------------------
// Module mocks — must be installed BEFORE the routes module is imported
// inside `before()`. The PUT handler only touches Genre + the
// PrecomputedGenresService refresh, so most other deps can be stubbed
// to no-ops.
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
  collisionDoc = null;
  findByIdAndUpdateImpl = async () => ({ _id: 'updated' });
  findOneCalls.length = 0;
  findByIdAndUpdateCalls.length = 0;
});

// ---------------------------------------------------------------------------
// 1. Route-level guard: PUT collides with another genre's slug → 409
// ---------------------------------------------------------------------------

test('PUT /api/genres/:id returns 409 when the slug is already used by another genre', async () => {
  // Two genres exist: g-rock owns "rock"; g-pop attempts to take it.
  collisionDoc = { _id: 'g-rock', name: 'Rock' };

  const res = await fetch(`${baseUrl}/api/genres/g-pop`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ slug: 'rock' }),
  });

  assert.equal(res.status, 409, 'duplicate slug must be rejected with 409');
  const body = (await res.json()) as { error?: string };
  assert.equal(typeof body.error, 'string', 'response must carry a helpful error string');
  assert.match(body.error ?? '', /rock/, 'error must name the colliding slug');
  assert.match(
    body.error ?? '',
    /already used/i,
    'error must explain that the slug is already used',
  );
  assert.match(body.error ?? '', /Rock/, 'error must name the existing genre owning the slug');

  // The collision check must scope to other docs (`_id: { $ne: id }`).
  assert.equal(findOneCalls.length, 1, 'expected exactly one Genre.findOne collision check');
  const filter = findOneCalls[0] as { slug?: string; _id?: { $ne?: string } };
  assert.equal(filter.slug, 'rock');
  assert.deepEqual(filter._id, { $ne: 'g-pop' });

  // Most importantly: the route must NEVER have attempted the update.
  assert.equal(
    findByIdAndUpdateCalls.length,
    0,
    'route must short-circuit before findByIdAndUpdate when a collision is detected',
  );
});

// ---------------------------------------------------------------------------
// 2. Race-window safety net: pre-check passes, but Mongo rejects the
//    write via the partial unique index (E11000). The route must
//    translate that to 409 instead of leaking a 500.
// ---------------------------------------------------------------------------

test('PUT /api/genres/:id returns 409 when the DB-level unique index rejects the write', async () => {
  // Pre-check sees no collision (the race window) but Mongo's partial
  // unique index fires when the update lands.
  collisionDoc = null;
  findByIdAndUpdateImpl = async () => {
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

  const res = await fetch(`${baseUrl}/api/genres/g-blues`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ slug: 'jazz' }),
  });

  assert.equal(res.status, 409, 'E11000 from the partial unique index must surface as 409');
  const body = (await res.json()) as { error?: string };
  assert.match(body.error ?? '', /jazz/);
  assert.match(body.error ?? '', /already used/i);

  // The route reached findByIdAndUpdate (the pre-check returned no
  // collision), and Mongo's index — not the route — was what stopped
  // the duplicate.
  assert.equal(findByIdAndUpdateCalls.length, 1);
});

// ---------------------------------------------------------------------------
// 3. DB-level contract: the GenreSchema must declare the partial unique
//    index that backs the safety net above. If a future schema edit
//    drops the partial filter, downgrades it from unique, or removes
//    the index entirely, this test fails — that's the whole point.
// ---------------------------------------------------------------------------

test('GenreSchema declares a partial unique index on slug (DB-level duplicate guard)', () => {
  // Mongoose stores indexes as [fields, options] tuples on the schema.
  const indexes = RealGenre.schema.indexes() as Array<
    [Record<string, unknown>, Record<string, unknown> | undefined]
  >;

  const slugIndex = indexes.find(
    ([fields]) => Object.keys(fields).length === 1 && fields.slug === 1,
  );
  assert.ok(
    slugIndex,
    'GenreSchema must declare a single-field index on { slug: 1 } — Task #210',
  );

  const [, options] = slugIndex!;
  assert.equal(
    options?.unique,
    true,
    'the slug index must be unique so Mongo rejects duplicate inserts',
  );

  // The partial filter is what lets multiple genres legitimately share
  // a missing slug (legacy rows) without colliding. If it disappears,
  // the unique index will reject every slug-less insert and break
  // production writes — so we lock the exact predicate in.
  assert.deepEqual(
    options?.partialFilterExpression,
    { slug: { $type: 'string' } },
    'the slug index must use partialFilterExpression { slug: { $type: "string" } }',
  );
});

// ---------------------------------------------------------------------------
// 4. Runtime DB-level contract: spin up an in-memory MongoDB, bind the
//    real GenreSchema to a fresh model on it, and prove that a direct
//    duplicate slug insert is rejected by the partial unique index
//    with a Mongo E11000 error.
// ---------------------------------------------------------------------------

import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

test('Mongo rejects a direct duplicate Genre.slug insert via the partial unique index', async () => {
  const mongod = await MongoMemoryServer.create();
  const conn = await mongoose.createConnection(mongod.getUri()).asPromise();
  try {
    // Bind the production GenreSchema to a model on this isolated
    // connection. Using the real schema is the whole point — we want
    // to prove the production index spec rejects duplicates.
    const Model = conn.model('GenreDupTest', RealGenre.schema);
    // Materialize the indexes Mongoose buffered on the schema, then
    // wait for them to be built so the unique constraint is live
    // before we attempt the duplicate insert.
    await Model.syncIndexes();

    // Sanity check: the partial unique index actually made it into
    // Mongo, not just the schema definition.
    const builtIndexes = (await Model.collection.indexes()) as Array<{
      key: Record<string, unknown>;
      unique?: boolean;
      partialFilterExpression?: Record<string, unknown>;
    }>;
    const slugIdx = builtIndexes.find(
      (i) => i.key.slug === 1 && Object.keys(i.key).length === 1,
    );
    assert.ok(slugIdx, 'Mongo must materialize a single-field slug index');
    assert.equal(slugIdx!.unique, true, 'materialized slug index must be unique');
    assert.deepEqual(slugIdx!.partialFilterExpression, { slug: { $type: 'string' } });

    // First insert succeeds.
    await Model.create({ name: 'Rock', slug: 'rock' });

    // Second insert with the same slug must be rejected by Mongo
    // itself with the duplicate-key error code (11000) — proving the
    // DB-level safety net the route's catch block relies on.
    let caught: (Error & { code?: number; keyPattern?: Record<string, number> }) | null = null;
    try {
      await Model.create({ name: 'Rock Music', slug: 'rock' });
    } catch (err) {
      caught = err as Error & { code?: number; keyPattern?: Record<string, number> };
    }
    assert.ok(caught, 'duplicate insert must throw — the partial unique index was not enforced');
    assert.equal(caught!.code, 11000, 'Mongo must surface duplicate-key as E11000');
    assert.ok(
      caught!.keyPattern && 'slug' in caught!.keyPattern,
      'E11000 keyPattern must reference the slug field — that is what the route catch block keys off of',
    );

    // Two slug-less inserts must coexist (the partial filter only
    // enforces uniqueness when slug is a string). If a future edit
    // drops the partialFilterExpression, the second insert here
    // would also throw 11000 against `{ slug: null }` and break
    // production writes for legacy slug-less genres.
    await Model.create({ name: 'Legacy A' });
    await Model.create({ name: 'Legacy B' });
  } finally {
    await conn.close();
    await mongod.stop();
  }
});
