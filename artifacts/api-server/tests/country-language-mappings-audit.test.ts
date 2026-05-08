/**
 * Regression tests for the country-language-mapping admin audit log
 * (Task #213).
 *
 * Locks down the contract that every override-mutating endpoint writes
 * exactly one ClearedOverridesAuditLog entry with the right `action`,
 * `changes`/`snapshot`, and actor — and that no-op edits skip the
 * write — plus the on-write 500-row prune cap and the GET endpoint's
 * `?action=` filter.
 *
 * Runner: requires `--experimental-test-module-mocks` (wired up in
 * artifacts/api-server/package.json#scripts.test).
 */
import { test, mock, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import type { AddressInfo } from 'node:net';
import type { Server as HttpServer } from 'node:http';

// ---------------------------------------------------------------------------
// In-memory stores backing the mocked Mongoose models.
// ---------------------------------------------------------------------------

interface MappingDoc {
  countryCode: string;
  countryName: string;
  languageCode: string;
  isActive?: boolean;
  notes?: string;
  updatedAt?: Date;
}

interface AuditDoc {
  _id: string;
  action: string;
  actorEmail: string | null;
  deletedCount: number;
  changes: Array<Record<string, unknown>>;
  snapshot: Array<Record<string, unknown>>;
  createdAt: Date;
}

const mappings: MappingDoc[] = [];
const audits: AuditDoc[] = [];
let nextId = 1;
let nowCounter = 0;
function nextNow(): Date {
  // Monotonically-increasing dates so prune ordering is deterministic
  // even when many writes happen in the same millisecond.
  nowCounter += 1;
  return new Date(2026, 0, 1, 0, 0, 0, nowCounter);
}

// Project a plain object the way mongoose's `lean({foo:1})` does — the
// routes only ever ask for include/exclude projections, so we mirror
// that shape.
type Projection = Record<string, 0 | 1>;
function project<T extends Record<string, unknown>>(
  doc: T,
  projection?: Projection,
): Record<string, unknown> {
  if (!projection) return { ...doc };
  const includeKeys = Object.entries(projection)
    .filter(([, v]) => v === 1)
    .map(([k]) => k);
  const excludeKeys = new Set(
    Object.entries(projection)
      .filter(([, v]) => v === 0)
      .map(([k]) => k),
  );
  if (includeKeys.length > 0) {
    const out: Record<string, unknown> = {};
    for (const k of includeKeys) {
      if (k in doc) out[k] = doc[k];
    }
    if ('_id' in doc && !('_id' in out)) out._id = (doc as { _id?: unknown })._id;
    return out;
  }
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(doc)) {
    if (!excludeKeys.has(k)) out[k] = doc[k];
  }
  return out;
}

// Minimal mongoose-shaped chainable for `find().sort().skip().limit().lean()`.
interface FakeArrayQuery<T> extends PromiseLike<T[]> {
  sort: (spec: Record<string, 1 | -1>) => FakeArrayQuery<T>;
  skip: (n: number) => FakeArrayQuery<T>;
  limit: (n: number) => FakeArrayQuery<T>;
  lean: <U = T>() => Promise<U[]>;
}
function arrayQuery<T extends Record<string, unknown>>(
  produce: () => T[],
): FakeArrayQuery<T> {
  let _skip = 0;
  let _limit: number | undefined;
  let sortSpec: Record<string, 1 | -1> | null = null;

  const apply = (): T[] => {
    let arr = produce().slice();
    if (sortSpec) {
      const entries = Object.entries(sortSpec);
      arr.sort((a, b) => {
        for (const [field, dir] of entries) {
          const av = (a as Record<string, unknown>)[field];
          const bv = (b as Record<string, unknown>)[field];
          if (av === bv) continue;
          if (av === undefined) return 1;
          if (bv === undefined) return -1;
          if (av < bv) return dir === 1 ? -1 : 1;
          if (av > bv) return dir === 1 ? 1 : -1;
        }
        return 0;
      });
    }
    if (_skip) arr = arr.slice(_skip);
    if (_limit !== undefined) arr = arr.slice(0, _limit);
    return arr;
  };

  const q: FakeArrayQuery<T> = {
    sort(spec) {
      sortSpec = spec;
      return q;
    },
    skip(n) {
      _skip = n;
      return q;
    },
    limit(n) {
      _limit = n;
      return q;
    },
    async lean<U = T>() {
      return apply() as unknown as U[];
    },
    then(resolve, reject) {
      return Promise.resolve(apply()).then(resolve, reject);
    },
  };
  return q;
}

// `findOne(...).lean()` returns a single doc or null — separate shape.
interface FakeSingleQuery<T> extends PromiseLike<T | null> {
  lean: <U = T>() => Promise<U | null>;
}
function singleQuery<T>(produce: () => T | null): FakeSingleQuery<T> {
  return {
    async lean<U = T>() {
      return produce() as unknown as U | null;
    },
    then(resolve, reject) {
      return Promise.resolve(produce()).then(resolve, reject);
    },
  };
}

function matchesAuditFilter(doc: AuditDoc, filter: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(filter)) {
    if (k === 'action' && doc.action !== v) return false;
    // Other filters (actorEmail regex, $or, createdAt range) are not
    // exercised by these tests; the action filter is the contract we
    // care about for Task #213.
  }
  return true;
}

const FakeCountryLanguageMapping = {
  find(
    filter?: { countryCode?: { $in?: string[] } } | Record<string, never>,
    projection?: Projection,
  ): FakeArrayQuery<MappingDoc> {
    return arrayQuery<MappingDoc>(() => {
      let rows: MappingDoc[] = mappings;
      const cc = filter && (filter as { countryCode?: { $in?: string[] } }).countryCode;
      if (cc && Array.isArray(cc.$in)) {
        const inList = cc.$in;
        rows = rows.filter((m) => inList.includes(m.countryCode));
      }
      return rows.map((r) => project(r, projection) as unknown as MappingDoc);
    });
  },
  findOne(
    filter: { countryCode?: string },
    projection?: Projection,
  ): FakeSingleQuery<MappingDoc> {
    return singleQuery<MappingDoc>(() => {
      const found = mappings.find((m) => m.countryCode === filter.countryCode);
      return found ? (project(found, projection) as unknown as MappingDoc) : null;
    });
  },
  async findOneAndUpdate(
    filter: { countryCode: string },
    update: Partial<MappingDoc>,
  ): Promise<MappingDoc> {
    const idx = mappings.findIndex((m) => m.countryCode === filter.countryCode);
    if (idx >= 0) {
      mappings[idx] = { ...mappings[idx], ...update };
      return mappings[idx];
    }
    const next: MappingDoc = {
      countryCode: filter.countryCode,
      countryName: '',
      languageCode: '',
      ...update,
    };
    mappings.push(next);
    return next;
  },
  async deleteOne(filter: { countryCode: string }): Promise<{ deletedCount: number }> {
    const idx = mappings.findIndex((m) => m.countryCode === filter.countryCode);
    if (idx >= 0) {
      mappings.splice(idx, 1);
      return { deletedCount: 1 };
    }
    return { deletedCount: 0 };
  },
  async deleteMany(
    filter: { countryCode?: { $in?: string[] } } | Record<string, never>,
  ): Promise<{ deletedCount: number }> {
    const before = mappings.length;
    const isEmpty = !filter || Object.keys(filter).length === 0;
    if (isEmpty) {
      mappings.length = 0;
      return { deletedCount: before };
    }
    const cc = (filter as { countryCode?: { $in?: string[] } }).countryCode;
    if (cc && Array.isArray(cc.$in)) {
      const inList = cc.$in;
      for (let i = mappings.length - 1; i >= 0; i -= 1) {
        if (inList.includes(mappings[i].countryCode)) mappings.splice(i, 1);
      }
    }
    return { deletedCount: before - mappings.length };
  },
};

const FakeClearedOverridesAuditLog = {
  async create(doc: {
    action: string;
    actorEmail?: string | null;
    deletedCount?: number;
    changes?: AuditDoc['changes'];
    snapshot?: AuditDoc['snapshot'];
  }): Promise<AuditDoc> {
    const entry: AuditDoc = {
      _id: String(nextId++),
      action: doc.action,
      actorEmail: doc.actorEmail ?? null,
      deletedCount: doc.deletedCount ?? 0,
      changes: doc.changes ?? [],
      snapshot: doc.snapshot ?? [],
      createdAt: nextNow(),
    };
    audits.push(entry);
    return entry;
  },
  async estimatedDocumentCount(): Promise<number> {
    return audits.length;
  },
  async countDocuments(filter: Record<string, unknown>): Promise<number> {
    return audits.filter((d) => matchesAuditFilter(d, filter)).length;
  },
  find(
    filter?: Record<string, unknown>,
    projection?: Projection,
  ): FakeArrayQuery<AuditDoc> {
    return arrayQuery<AuditDoc>(() => {
      const rows = audits.filter((d) =>
        filter ? matchesAuditFilter(d, filter) : true,
      );
      return rows.map((r) => project(r, projection) as unknown as AuditDoc);
    });
  },
  async deleteMany(filter: { _id?: { $in?: string[] } }): Promise<{ deletedCount: number }> {
    const ids = filter?._id?.$in ?? [];
    let removed = 0;
    for (let i = audits.length - 1; i >= 0; i -= 1) {
      if (ids.includes(audits[i]._id)) {
        audits.splice(i, 1);
        removed += 1;
      }
    }
    return { deletedCount: removed };
  },
};

// ---------------------------------------------------------------------------
// Module mocks — must be installed BEFORE the routes module is imported.
// ---------------------------------------------------------------------------

mock.module(new URL('../src/shared/mongo-schemas.ts', import.meta.url).href, {
  namedExports: {
    CountryLanguageMapping: FakeCountryLanguageMapping,
    ClearedOverridesAuditLog: FakeClearedOverridesAuditLog,
  },
});

mock.module(new URL('../src/performance-cache.ts', import.meta.url).href, {
  namedExports: {
    performanceCache: {
      clearCountryLanguageMappings: () => {},
    },
  },
});

mock.module('@workspace/seo-shared/seo-config', {
  namedExports: {
    COUNTRY_TO_CODE: { 'United States': 'US', France: 'FR', Germany: 'DE' },
    COUNTRY_TO_LANGUAGE: { US: 'en', FR: 'fr', DE: 'de' },
    SEO_LANGUAGES: [
      { code: 'en', name: 'English' },
      { code: 'fr', name: 'French' },
      { code: 'de', name: 'German' },
      { code: 'es', name: 'Spanish' },
    ],
  },
});

// Stub the audit-email service so the fire-and-forget side effects never
// touch the network or fs during tests.
mock.module(new URL('../src/services/admin-audit-email.ts', import.meta.url).href, {
  namedExports: {
    emailClearedOverridesCsv: async () => {},
    emailResetAllMappingsCsv: async () => {},
    buildClearedOverridesCsv: () => '',
    buildClearedOverridesHistoryCsv: () => '',
  },
});

// ---------------------------------------------------------------------------
// Boot Express app with mocked deps and a fake admin session user.
// ---------------------------------------------------------------------------

let server: HttpServer;
let baseUrl: string;
const ACTOR_EMAIL = 'admin@example.com';

before(async () => {
  process.env.NODE_ENV = 'test';

  const mod = (await import('../src/routes/country-language-mappings.ts')) as {
    registerCountryLanguageMappingRoutes: (
      app: Express,
      requireAdmin: (req: Request, res: Response, next: NextFunction) => void,
    ) => void;
  };

  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as { user: { email: string } }).user = { email: ACTOR_EMAIL };
    next();
  });
  mod.registerCountryLanguageMappingRoutes(
    app,
    (_req: Request, _res: Response, next: NextFunction) => next(),
  );

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
  mappings.length = 0;
  audits.length = 0;
  nextId = 1;
  nowCounter = 0;
});

// The audit write is a fire-and-forget `void writeMappingAuditEntry(...)`
// in most paths. Yield to the event loop a few times so the await chain
// inside the helper completes before assertions run.
async function flushAudit(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('POST upsert with a new mapping logs exactly one "edit" entry with the diff and actor', async () => {
  const res = await fetch(`${baseUrl}/api/admin/country-language-mappings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      countryCode: 'US',
      countryName: 'United States',
      languageCode: 'es',
    }),
  });
  assert.equal(res.status, 200);
  await flushAudit();

  assert.equal(audits.length, 1, 'must produce exactly one audit entry');
  const entry = audits[0];
  assert.equal(entry.action, 'edit');
  assert.equal(entry.actorEmail, ACTOR_EMAIL);
  assert.equal(entry.deletedCount, 1);
  assert.deepEqual(entry.changes, [
    {
      countryCode: 'US',
      countryName: 'United States',
      previousLanguageCode: null,
      newLanguageCode: 'es',
    },
  ]);
});

test('POST update of an existing mapping logs one "edit" entry with previous→new diff', async () => {
  // Pre-existing override — admin is now changing the language.
  mappings.push({ countryCode: 'US', countryName: 'United States', languageCode: 'en' });

  const res = await fetch(`${baseUrl}/api/admin/country-language-mappings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      countryCode: 'US',
      countryName: 'United States',
      languageCode: 'es',
    }),
  });
  assert.equal(res.status, 200);
  await flushAudit();

  assert.equal(audits.length, 1);
  const entry = audits[0];
  assert.equal(entry.action, 'edit');
  assert.equal(entry.actorEmail, ACTOR_EMAIL);
  assert.equal(entry.deletedCount, 1);
  assert.deepEqual(entry.changes, [
    {
      countryCode: 'US',
      countryName: 'United States',
      previousLanguageCode: 'en',
      newLanguageCode: 'es',
    },
  ]);
  // And the underlying row is actually updated.
  const stored = mappings.find((m) => m.countryCode === 'US');
  assert.equal(stored?.languageCode, 'es');
});

test('POST with the same languageCode as the existing row is a no-op and writes no audit entry', async () => {
  mappings.push({ countryCode: 'FR', countryName: 'France', languageCode: 'fr' });

  const res = await fetch(`${baseUrl}/api/admin/country-language-mappings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      countryCode: 'FR',
      countryName: 'France',
      languageCode: 'fr',
    }),
  });
  assert.equal(res.status, 200);
  await flushAudit();

  assert.equal(
    audits.length,
    0,
    'no-op edits must not spam the audit log',
  );
});

test('POST /bulk writes one "bulk-save" entry covering only rows whose languageCode actually changed', async () => {
  mappings.push(
    { countryCode: 'FR', countryName: 'France', languageCode: 'fr' },
    // This one is already at "en" — sending the same value in the bulk
    // payload must not produce a change row.
    { countryCode: 'US', countryName: 'United States', languageCode: 'en' },
  );

  const res = await fetch(`${baseUrl}/api/admin/country-language-mappings/bulk`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      mappings: [
        // Changed: fr → es
        { countryCode: 'FR', countryName: 'France', languageCode: 'es' },
        // New row: previous null → de
        { countryCode: 'DE', countryName: 'Germany', languageCode: 'de' },
        // No-op: same value as already stored.
        { countryCode: 'US', countryName: 'United States', languageCode: 'en' },
      ],
    }),
  });
  assert.equal(res.status, 200);
  await flushAudit();

  assert.equal(audits.length, 1);
  const entry = audits[0];
  assert.equal(entry.action, 'bulk-save');
  assert.equal(entry.actorEmail, ACTOR_EMAIL);
  assert.equal(entry.changes.length, 2, 'no-op rows must NOT appear in changes');
  const byCode = Object.fromEntries(
    entry.changes.map((c) => [c.countryCode as string, c]),
  );
  assert.deepEqual(byCode.FR, {
    countryCode: 'FR',
    countryName: 'France',
    previousLanguageCode: 'fr',
    newLanguageCode: 'es',
  });
  assert.deepEqual(byCode.DE, {
    countryCode: 'DE',
    countryName: 'Germany',
    previousLanguageCode: null,
    newLanguageCode: 'de',
  });
  assert.equal(byCode.US, undefined);
});

test('DELETE /:countryCode logs one "delete" entry with the previous languageCode', async () => {
  mappings.push({ countryCode: 'DE', countryName: 'Germany', languageCode: 'es' });

  const res = await fetch(
    `${baseUrl}/api/admin/country-language-mappings/DE`,
    { method: 'DELETE' },
  );
  assert.equal(res.status, 200);
  await flushAudit();

  assert.equal(audits.length, 1);
  const entry = audits[0];
  assert.equal(entry.action, 'delete');
  assert.equal(entry.actorEmail, ACTOR_EMAIL);
  assert.equal(entry.deletedCount, 1);
  assert.deepEqual(entry.changes, [
    {
      countryCode: 'DE',
      countryName: 'Germany',
      previousLanguageCode: 'es',
      newLanguageCode: null,
    },
  ]);
});

test('DELETE /overrides logs one "clear-overrides" entry with snapshot of overridden rows only', async () => {
  // Default: US→en, FR→fr, DE→de. Override US (en→es) and FR (fr→de);
  // leave DE at its default. Only the two overrides should be cleared.
  mappings.push(
    { countryCode: 'US', countryName: 'United States', languageCode: 'es' },
    { countryCode: 'FR', countryName: 'France', languageCode: 'de' },
    { countryCode: 'DE', countryName: 'Germany', languageCode: 'de' },
  );

  const res = await fetch(
    `${baseUrl}/api/admin/country-language-mappings/overrides`,
    { method: 'DELETE' },
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { deletedCount: number };
  assert.equal(body.deletedCount, 2);
  await flushAudit();

  assert.equal(audits.length, 1);
  const entry = audits[0];
  assert.equal(entry.action, 'clear-overrides');
  assert.equal(entry.actorEmail, ACTOR_EMAIL);
  assert.equal(entry.deletedCount, 2);
  assert.equal(entry.snapshot.length, 2);
  const codes = entry.snapshot.map((s) => s.countryCode as string).sort();
  assert.deepEqual(codes, ['FR', 'US']);
  // DE was at the default, so it must NOT be in the snapshot.
  assert.ok(!codes.includes('DE'));
});

test('DELETE / (reset-all) logs one "reset-all" entry with snapshot of every prior mapping', async () => {
  mappings.push(
    { countryCode: 'US', countryName: 'United States', languageCode: 'es' },
    { countryCode: 'FR', countryName: 'France', languageCode: 'de' },
  );

  const res = await fetch(`${baseUrl}/api/admin/country-language-mappings`, {
    method: 'DELETE',
  });
  assert.equal(res.status, 200);
  await flushAudit();

  assert.equal(audits.length, 1);
  const entry = audits[0];
  assert.equal(entry.action, 'reset-all');
  assert.equal(entry.actorEmail, ACTOR_EMAIL);
  assert.equal(entry.deletedCount, 2);
  assert.equal(entry.snapshot.length, 2);
  assert.equal(entry.changes.length, 2);
  // Mappings collection must be empty after reset.
  assert.equal(mappings.length, 0);
});

test('on-write prune caps the audit collection at 500 entries (oldest dropped first)', async () => {
  // Pre-fill 500 entries directly so each new write trips the cap.
  for (let i = 0; i < 500; i += 1) {
    audits.push({
      _id: String(nextId++),
      action: 'edit',
      actorEmail: 'seed@example.com',
      deletedCount: 1,
      changes: [],
      snapshot: [],
      createdAt: nextNow(),
    });
  }
  const oldestId = audits[0]._id;

  const res = await fetch(`${baseUrl}/api/admin/country-language-mappings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      countryCode: 'US',
      countryName: 'United States',
      languageCode: 'es',
    }),
  });
  assert.equal(res.status, 200);
  await flushAudit();

  assert.equal(audits.length, 500, 'cap must hold at 500');
  assert.ok(
    !audits.some((a) => a._id === oldestId),
    'oldest entry must have been pruned',
  );
  // The freshly-inserted entry must still be present.
  assert.ok(audits.some((a) => a.actorEmail === ACTOR_EMAIL));
});

test('GET ?action= returns only matching rows; ?action=all returns everything', async () => {
  // Seed three entries across two action types.
  audits.push(
    {
      _id: String(nextId++),
      action: 'edit',
      actorEmail: ACTOR_EMAIL,
      deletedCount: 1,
      changes: [],
      snapshot: [],
      createdAt: nextNow(),
    },
    {
      _id: String(nextId++),
      action: 'delete',
      actorEmail: ACTOR_EMAIL,
      deletedCount: 1,
      changes: [],
      snapshot: [],
      createdAt: nextNow(),
    },
    {
      _id: String(nextId++),
      action: 'edit',
      actorEmail: ACTOR_EMAIL,
      deletedCount: 1,
      changes: [],
      snapshot: [],
      createdAt: nextNow(),
    },
  );

  const editsRes = await fetch(
    `${baseUrl}/api/admin/country-language-mappings/cleared-overrides-log?action=edit`,
  );
  assert.equal(editsRes.status, 200);
  const editsBody = (await editsRes.json()) as {
    entries: Array<{ action: string }>;
    total: number;
  };
  assert.equal(editsBody.total, 2);
  assert.equal(editsBody.entries.length, 2);
  assert.ok(editsBody.entries.every((e) => e.action === 'edit'));

  const allRes = await fetch(
    `${baseUrl}/api/admin/country-language-mappings/cleared-overrides-log?action=all`,
  );
  assert.equal(allRes.status, 200);
  const allBody = (await allRes.json()) as { total: number };
  assert.equal(allBody.total, 3);

  const badRes = await fetch(
    `${baseUrl}/api/admin/country-language-mappings/cleared-overrides-log?action=not-a-real-action`,
  );
  assert.equal(badRes.status, 400, 'unknown action filter must 400');
});
