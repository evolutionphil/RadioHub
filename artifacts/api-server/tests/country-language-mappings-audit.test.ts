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

interface RegexSpec {
  $regex?: string;
  $options?: string;
}

function matchesRegexSpec(value: unknown, spec: RegexSpec): boolean {
  if (typeof value !== 'string') return false;
  if (typeof spec.$regex !== 'string') return false;
  const re = new RegExp(spec.$regex, spec.$options ?? '');
  return re.test(value);
}

function matchesAuditFilter(doc: AuditDoc, filter: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(filter)) {
    if (k === 'action') {
      if (doc.action !== v) return false;
      continue;
    }
    if (k === 'actorEmail') {
      if (!matchesRegexSpec(doc.actorEmail, v as RegexSpec)) return false;
      continue;
    }
    if (k === '$or') {
      const clauses = v as Array<Record<string, RegexSpec>>;
      const anyMatch = clauses.some((clause) => {
        const [path, spec] = Object.entries(clause)[0] ?? [];
        if (!path || !spec) return false;
        const [field, sub] = path.split('.');
        const arr = (doc as unknown as Record<string, Array<Record<string, unknown>> | undefined>)[field];
        if (!Array.isArray(arr)) return false;
        return arr.some((row) => matchesRegexSpec(row[sub], spec));
      });
      if (!anyMatch) return false;
      continue;
    }
    if (k === 'createdAt') {
      const spec = v as { $gte?: Date; $lte?: Date };
      const t = doc.createdAt.getTime();
      if (spec.$gte && t < spec.$gte.getTime()) return false;
      if (spec.$lte && t > spec.$lte.getTime()) return false;
      continue;
    }
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

mock.module('@workspace/db-shared/mongo-schemas', {
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

test('GET ?actorEmail= matches case-insensitively and treats input literally (no regex injection)', async () => {
  audits.push(
    {
      _id: String(nextId++),
      action: 'edit',
      actorEmail: 'Admin@Example.com',
      deletedCount: 1,
      changes: [],
      snapshot: [],
      createdAt: nextNow(),
    },
    {
      _id: String(nextId++),
      action: 'edit',
      actorEmail: 'someone-else@example.com',
      deletedCount: 1,
      changes: [],
      snapshot: [],
      createdAt: nextNow(),
    },
    // If the dot in the query were treated as a regex wildcard, this row
    // would falsely match "admin.example.com".
    {
      _id: String(nextId++),
      action: 'edit',
      actorEmail: 'adminXexample.com',
      deletedCount: 1,
      changes: [],
      snapshot: [],
      createdAt: nextNow(),
    },
  );

  // Case-insensitive: lowercase query matches mixed-case actor.
  const ciRes = await fetch(
    `${baseUrl}/api/admin/country-language-mappings/cleared-overrides-log?actorEmail=admin@example.com`,
  );
  assert.equal(ciRes.status, 200);
  const ciBody = (await ciRes.json()) as {
    entries: Array<{ actorEmail: string }>;
    total: number;
  };
  assert.equal(ciBody.total, 1);
  assert.equal(ciBody.entries[0].actorEmail, 'Admin@Example.com');

  // Regex metacharacters in the input must be matched literally.
  const literalRes = await fetch(
    `${baseUrl}/api/admin/country-language-mappings/cleared-overrides-log?actorEmail=${encodeURIComponent(
      'admin.example.com',
    )}`,
  );
  assert.equal(literalRes.status, 200);
  const literalBody = (await literalRes.json()) as { total: number };
  assert.equal(literalBody.total, 0, 'dot must not be a regex wildcard');
});

test('GET ?country= matches both snapshot rows (clears) and changes rows (edits)', async () => {
  audits.push(
    // clear-overrides — country lives in snapshot
    {
      _id: String(nextId++),
      action: 'clear-overrides',
      actorEmail: ACTOR_EMAIL,
      deletedCount: 1,
      changes: [],
      snapshot: [
        {
          countryCode: 'FR',
          countryName: 'France',
          currentLanguageCode: 'de',
          defaultLanguageCode: 'fr',
        },
      ],
      createdAt: nextNow(),
    },
    // edit — country lives in changes
    {
      _id: String(nextId++),
      action: 'edit',
      actorEmail: ACTOR_EMAIL,
      deletedCount: 1,
      changes: [
        {
          countryCode: 'FR',
          countryName: 'France',
          previousLanguageCode: 'fr',
          newLanguageCode: 'es',
        },
      ],
      snapshot: [],
      createdAt: nextNow(),
    },
    // unrelated edit — must not match.
    {
      _id: String(nextId++),
      action: 'edit',
      actorEmail: ACTOR_EMAIL,
      deletedCount: 1,
      changes: [
        {
          countryCode: 'US',
          countryName: 'United States',
          previousLanguageCode: null,
          newLanguageCode: 'es',
        },
      ],
      snapshot: [],
      createdAt: nextNow(),
    },
  );

  // By country code — picks up both the snapshot and the changes row.
  const byCodeRes = await fetch(
    `${baseUrl}/api/admin/country-language-mappings/cleared-overrides-log?country=FR`,
  );
  assert.equal(byCodeRes.status, 200);
  const byCodeBody = (await byCodeRes.json()) as {
    entries: Array<{ action: string }>;
    total: number;
  };
  assert.equal(byCodeBody.total, 2);
  const actions = byCodeBody.entries.map((e) => e.action).sort();
  assert.deepEqual(actions, ['clear-overrides', 'edit']);

  // Country name match works the same way (also case-insensitive).
  const byNameRes = await fetch(
    `${baseUrl}/api/admin/country-language-mappings/cleared-overrides-log?country=${encodeURIComponent(
      'france',
    )}`,
  );
  assert.equal(byNameRes.status, 200);
  const byNameBody = (await byNameRes.json()) as { total: number };
  assert.equal(byNameBody.total, 2);
});

test('GET ?from= / ?to= treat YYYY-MM-DD upper bound as inclusive end-of-day', async () => {
  // One entry just before the window, one late on the same day as the
  // upper bound, one early the next day (must be excluded for a
  // single-day from/to=2026-05-01 query).
  audits.push(
    {
      _id: String(nextId++),
      action: 'edit',
      actorEmail: ACTOR_EMAIL,
      deletedCount: 1,
      changes: [],
      snapshot: [],
      createdAt: new Date('2026-04-30T12:00:00.000Z'),
    },
    {
      _id: String(nextId++),
      action: 'edit',
      actorEmail: ACTOR_EMAIL,
      deletedCount: 1,
      changes: [],
      snapshot: [],
      createdAt: new Date('2026-05-01T22:30:00.000Z'),
    },
    {
      _id: String(nextId++),
      action: 'edit',
      actorEmail: ACTOR_EMAIL,
      deletedCount: 1,
      changes: [],
      snapshot: [],
      createdAt: new Date('2026-05-02T00:30:00.000Z'),
    },
  );

  // Same-day window — without end-of-day inclusivity, the 22:30 entry
  // would be silently dropped.
  const sameDayRes = await fetch(
    `${baseUrl}/api/admin/country-language-mappings/cleared-overrides-log?from=2026-05-01&to=2026-05-01`,
  );
  assert.equal(sameDayRes.status, 200);
  const sameDayBody = (await sameDayRes.json()) as { total: number };
  assert.equal(
    sameDayBody.total,
    1,
    'YYYY-MM-DD upper bound must be inclusive of the entire day',
  );

  // Two-day window picks up both May-1 22:30 and May-2 00:30; the April
  // entry stays excluded by the lower bound.
  const rangeRes = await fetch(
    `${baseUrl}/api/admin/country-language-mappings/cleared-overrides-log?from=2026-05-01&to=2026-05-02`,
  );
  assert.equal(rangeRes.status, 200);
  const rangeBody = (await rangeRes.json()) as { total: number };
  assert.equal(rangeBody.total, 2);
});
