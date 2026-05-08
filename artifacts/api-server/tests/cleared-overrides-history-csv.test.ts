/**
 * Regression tests for the combined cleared-overrides history CSV
 * endpoint (Task #277).
 *
 * Locks down the contract that
 *   `GET /api/admin/country-language-mappings/cleared-overrides-log/all/csv`
 * builds one row per snapshot entry, repeats the createdAt / actor /
 * deletedCount metadata per row, emits a single placeholder row when the
 * snapshot is empty, and respects the same `action` / `actorEmail` /
 * `country` / `from` / `to` filters as the JSON list endpoint.
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
// In-memory store backing the mocked ClearedOverridesAuditLog model.
// ---------------------------------------------------------------------------

interface SnapshotEntry {
  countryCode: string;
  countryName: string;
  currentLanguageCode: string;
  defaultLanguageCode: string;
}

interface ChangeEntry {
  countryCode: string;
  countryName: string;
  previousLanguageCode: string | null;
  newLanguageCode: string | null;
}

interface AuditDoc {
  _id: string;
  action: string;
  actorEmail: string | null;
  deletedCount: number;
  changes: ChangeEntry[];
  snapshot: SnapshotEntry[];
  createdAt: Date;
}

const audits: AuditDoc[] = [];
let nextId = 1;

// Mongoose-shaped chainable for `find().sort().lean()`.
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

// Mirror the filter shapes the route actually builds (action equality,
// $regex actorEmail, $or against snapshot/changes country fields,
// createdAt $gte/$lte). Keep this in lockstep with the route — that's
// the whole point of the test.
function matchesAuditFilter(doc: AuditDoc, filter: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(filter)) {
    if (k === 'action') {
      if (doc.action !== v) return false;
      continue;
    }
    if (k === 'actorEmail' && v && typeof v === 'object') {
      const spec = v as { $regex?: string; $options?: string };
      const re = new RegExp(spec.$regex ?? '', spec.$options ?? '');
      if (!re.test(doc.actorEmail ?? '')) return false;
      continue;
    }
    if (k === '$or' && Array.isArray(v)) {
      const matched = (v as Array<Record<string, { $regex?: string; $options?: string }>>).some(
        (clause) => {
          const [path, spec] = Object.entries(clause)[0];
          const re = new RegExp(spec.$regex ?? '', spec.$options ?? '');
          if (path.startsWith('snapshot.')) {
            const field = path.slice('snapshot.'.length) as keyof SnapshotEntry;
            return doc.snapshot.some((s) => re.test(String(s[field] ?? '')));
          }
          if (path.startsWith('changes.')) {
            const field = path.slice('changes.'.length) as keyof ChangeEntry;
            return doc.changes.some((c) => re.test(String(c[field] ?? '')));
          }
          return false;
        },
      );
      if (!matched) return false;
      continue;
    }
    if (k === 'createdAt' && v && typeof v === 'object') {
      const spec = v as { $gte?: Date; $lte?: Date };
      if (spec.$gte && doc.createdAt < spec.$gte) return false;
      if (spec.$lte && doc.createdAt > spec.$lte) return false;
      continue;
    }
  }
  return true;
}

const FakeClearedOverridesAuditLog = {
  async create(doc: Partial<AuditDoc>): Promise<AuditDoc> {
    const entry: AuditDoc = {
      _id: String(nextId++),
      action: doc.action ?? 'clear-overrides',
      actorEmail: doc.actorEmail ?? null,
      deletedCount: doc.deletedCount ?? 0,
      changes: doc.changes ?? [],
      snapshot: doc.snapshot ?? [],
      createdAt: doc.createdAt ?? new Date(),
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
  find(filter?: Record<string, unknown>): FakeArrayQuery<AuditDoc> {
    return arrayQuery<AuditDoc>(() =>
      audits.filter((d) => (filter ? matchesAuditFilter(d, filter) : true)),
    );
  },
  async deleteMany(): Promise<{ deletedCount: number }> {
    return { deletedCount: 0 };
  },
};

// ---------------------------------------------------------------------------
// Module mocks — must be installed BEFORE the routes module is imported.
// ---------------------------------------------------------------------------

mock.module('@workspace/db-shared/mongo-schemas', {
  namedExports: {
    CountryLanguageMapping: {
      find: () => arrayQuery(() => []),
      findOne: () => ({ async lean() { return null; }, then(r: any) { return Promise.resolve(null).then(r); } }),
      async findOneAndUpdate() { return null; },
      async deleteOne() { return { deletedCount: 0 }; },
      async deleteMany() { return { deletedCount: 0 }; },
    },
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

// IMPORTANT: do NOT stub admin-audit-email — the test must exercise the
// real `buildClearedOverridesHistoryCsv` so a future divergence between
// the route's row-building and the CSV serializer is caught.

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
  audits.length = 0;
  nextId = 1;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CSV_PATH = '/api/admin/country-language-mappings/cleared-overrides-log/all/csv';

function seedAudits(): void {
  // 1. clear-overrides — two snapshot rows, US/FR, alice, 2026-01-10
  audits.push({
    _id: String(nextId++),
    action: 'clear-overrides',
    actorEmail: 'alice@example.com',
    deletedCount: 2,
    changes: [],
    snapshot: [
      {
        countryCode: 'US',
        countryName: 'United States',
        currentLanguageCode: 'es',
        defaultLanguageCode: 'en',
      },
      {
        countryCode: 'FR',
        countryName: 'France',
        currentLanguageCode: 'de',
        defaultLanguageCode: 'fr',
      },
    ],
    createdAt: new Date('2026-01-10T12:00:00Z'),
  });
  // 2. reset-all — three snapshot rows, bob, 2026-02-15
  audits.push({
    _id: String(nextId++),
    action: 'reset-all',
    actorEmail: 'bob@example.com',
    deletedCount: 3,
    changes: [],
    snapshot: [
      {
        countryCode: 'DE',
        countryName: 'Germany',
        currentLanguageCode: 'es',
        defaultLanguageCode: 'de',
      },
      {
        countryCode: 'US',
        countryName: 'United States',
        currentLanguageCode: 'fr',
        defaultLanguageCode: 'en',
      },
      {
        countryCode: 'FR',
        countryName: 'France',
        currentLanguageCode: 'en',
        defaultLanguageCode: 'fr',
      },
    ],
    createdAt: new Date('2026-02-15T08:30:00Z'),
  });
  // 3. edit — empty snapshot, change row carries the country, alice, 2026-03-01
  audits.push({
    _id: String(nextId++),
    action: 'edit',
    actorEmail: 'alice@example.com',
    deletedCount: 1,
    changes: [
      {
        countryCode: 'DE',
        countryName: 'Germany',
        previousLanguageCode: 'de',
        newLanguageCode: 'es',
      },
    ],
    snapshot: [],
    createdAt: new Date('2026-03-01T09:00:00Z'),
  });
  // 4. bulk-save — empty snapshot, two change rows, bob, 2026-03-20
  audits.push({
    _id: String(nextId++),
    action: 'bulk-save',
    actorEmail: 'bob@example.com',
    deletedCount: 2,
    changes: [
      {
        countryCode: 'US',
        countryName: 'United States',
        previousLanguageCode: 'en',
        newLanguageCode: 'es',
      },
      {
        countryCode: 'FR',
        countryName: 'France',
        previousLanguageCode: 'fr',
        newLanguageCode: 'de',
      },
    ],
    snapshot: [],
    createdAt: new Date('2026-03-20T18:45:00Z'),
  });
}

interface ParsedCsv {
  header: string[];
  rows: string[][];
}

function parseCsv(body: string): ParsedCsv {
  // Strip BOM if present, then parse a simple CSV with quoted fields.
  const text = body.replace(/^\ufeff/, '');
  const lines: string[][] = [];
  let cur: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      cur.push(field);
      field = '';
    } else if (ch === '\r') {
      // peek for \n
      if (text[i + 1] === '\n') i += 1;
      cur.push(field);
      lines.push(cur);
      cur = [];
      field = '';
    } else if (ch === '\n') {
      cur.push(field);
      lines.push(cur);
      cur = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || cur.length > 0) {
    cur.push(field);
    lines.push(cur);
  }
  const [header, ...rows] = lines;
  return { header: header ?? [], rows };
}

async function fetchCsv(query = ''): Promise<ParsedCsv> {
  const res = await fetch(`${baseUrl}${CSV_PATH}${query}`);
  assert.equal(res.status, 200, `CSV request failed: ${query}`);
  assert.match(
    res.headers.get('content-type') ?? '',
    /text\/csv/,
    'must serve text/csv',
  );
  assert.match(
    res.headers.get('content-disposition') ?? '',
    /attachment; filename="country-overrides-history-\d{4}-\d{2}-\d{2}\.csv"/,
    'must use the dated history filename',
  );
  return parseCsv(await res.text());
}

async function fetchListTotal(query: string): Promise<number> {
  const res = await fetch(
    `${baseUrl}/api/admin/country-language-mappings/cleared-overrides-log${query}`,
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { total: number };
  return body.total;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('CSV unfiltered: header + one row per snapshot entry, plus one summary row per empty-snapshot entry', async () => {
  seedAudits();
  const { header, rows } = await fetchCsv();

  assert.deepEqual(header, [
    'Created At',
    'Actor',
    'Deleted Count',
    'Country Code',
    'Country Name',
    'Current Language',
    'Fallback Language',
  ]);

  // 2 (clear-overrides snapshot) + 3 (reset-all snapshot) + 1 (edit
  // placeholder) + 1 (bulk-save placeholder) = 7 rows.
  assert.equal(rows.length, 7);

  // Spot-check a snapshot row…
  const usFromClear = rows.find(
    (r) => r[1] === 'alice@example.com' && r[3] === 'US' && r[5] === 'es',
  );
  assert.ok(usFromClear, 'expected US row from clear-overrides snapshot');
  assert.equal(usFromClear![0], '2026-01-10T12:00:00.000Z');
  assert.equal(usFromClear![2], '2'); // deletedCount metadata repeats per row
  assert.equal(usFromClear![4], 'United States');
  assert.equal(usFromClear![6], 'en');

  // …and confirm the empty-snapshot placeholder rows preserve metadata.
  const editPlaceholder = rows.find(
    (r) => r[0] === '2026-03-01T09:00:00.000Z',
  );
  assert.ok(editPlaceholder, 'edit entry must produce a placeholder row');
  assert.deepEqual(editPlaceholder, [
    '2026-03-01T09:00:00.000Z',
    'alice@example.com',
    '1',
    '',
    '',
    '',
    '',
  ]);

  const bulkPlaceholder = rows.find(
    (r) => r[0] === '2026-03-20T18:45:00.000Z',
  );
  assert.ok(bulkPlaceholder, 'bulk-save entry must produce a placeholder row');
  assert.deepEqual(bulkPlaceholder, [
    '2026-03-20T18:45:00.000Z',
    'bob@example.com',
    '2',
    '',
    '',
    '',
    '',
  ]);
});

test('CSV ?action=clear-overrides narrows to that audit type only and matches the list endpoint count', async () => {
  seedAudits();
  const { rows } = await fetchCsv('?action=clear-overrides');
  assert.equal(rows.length, 2, 'only the two clear-overrides snapshot rows');
  assert.ok(rows.every((r) => r[1] === 'alice@example.com'));

  // The list endpoint groups by audit entry (1 entry), not by snapshot
  // row — but the same `action` filter must select the same set of
  // audit entries. We verify both endpoints see the same underlying
  // entries by counting the distinct (createdAt, actor) tuples.
  const distinctEntries = new Set(rows.map((r) => `${r[0]}|${r[1]}`)).size;
  assert.equal(distinctEntries, await fetchListTotal('?action=clear-overrides'));
});

test('CSV ?actorEmail= matches the list endpoint and is case-insensitive', async () => {
  seedAudits();
  const { rows } = await fetchCsv('?actorEmail=ALICE');
  // 2 from the clear-overrides snapshot + 1 placeholder for the edit.
  assert.equal(rows.length, 3);
  assert.ok(rows.every((r) => r[1] === 'alice@example.com'));

  const distinctEntries = new Set(rows.map((r) => `${r[0]}|${r[1]}`)).size;
  assert.equal(distinctEntries, await fetchListTotal('?actorEmail=ALICE'));
});

test('CSV ?country= matches snapshot countryCode AND inline change.countryCode', async () => {
  seedAudits();
  // DE appears in the reset-all snapshot AND in the edit entry's
  // changes (which has an empty snapshot, so it must surface as a
  // placeholder row).
  const { rows } = await fetchCsv('?country=DE');

  // Sanity: every selected entry must be one of the entries the list
  // endpoint would return for the same filter.
  const listTotal = await fetchListTotal('?country=DE');
  assert.equal(listTotal, 2, 'list endpoint should match 2 audit entries for DE');

  const distinctEntries = new Set(rows.map((r) => `${r[0]}|${r[1]}`)).size;
  assert.equal(
    distinctEntries,
    listTotal,
    'CSV must cover the same audit entries as the list endpoint',
  );

  // 3 snapshot rows from reset-all + 1 placeholder row from edit = 4.
  assert.equal(rows.length, 4);
  // The placeholder row from the edit (empty snapshot) must still be
  // present even though the country only matched via `changes`.
  assert.ok(
    rows.some(
      (r) => r[0] === '2026-03-01T09:00:00.000Z' && r[3] === '' && r[2] === '1',
    ),
    'edit entry placeholder row must be present even though country matched via changes',
  );
});

test('CSV ?from=&to= (inclusive day-end) narrows by createdAt and matches the list endpoint', async () => {
  seedAudits();
  // Window covering only the two March entries (both empty-snapshot
  // → placeholder rows). `to=2026-03-20` (date-only) must include
  // entries written later that same day.
  const q = '?from=2026-02-16T00:00:00.000Z&to=2026-03-20';
  const { rows } = await fetchCsv(q);
  assert.equal(rows.length, 2);
  const dates = rows.map((r) => r[0]).sort();
  assert.deepEqual(dates, [
    '2026-03-01T09:00:00.000Z',
    '2026-03-20T18:45:00.000Z',
  ]);

  const distinctEntries = new Set(rows.map((r) => `${r[0]}|${r[1]}`)).size;
  assert.equal(distinctEntries, await fetchListTotal(q));
});

test('CSV combined filters intersect the same way the list endpoint does', async () => {
  seedAudits();
  const q = '?action=reset-all&actorEmail=bob&country=DE';
  const { rows } = await fetchCsv(q);
  // Only audit #2 matches → 3 snapshot rows.
  assert.equal(rows.length, 3);
  assert.ok(rows.every((r) => r[1] === 'bob@example.com'));
  assert.ok(rows.every((r) => r[0] === '2026-02-15T08:30:00.000Z'));

  const distinctEntries = new Set(rows.map((r) => `${r[0]}|${r[1]}`)).size;
  assert.equal(distinctEntries, await fetchListTotal(q));
});

test('CSV with only empty-snapshot entries still emits one summary row each', async () => {
  audits.push({
    _id: String(nextId++),
    action: 'edit',
    actorEmail: 'carol@example.com',
    deletedCount: 7,
    changes: [
      {
        countryCode: 'IT',
        countryName: 'Italy',
        previousLanguageCode: 'it',
        newLanguageCode: 'en',
      },
    ],
    snapshot: [],
    createdAt: new Date('2026-04-01T00:00:00Z'),
  });
  audits.push({
    _id: String(nextId++),
    action: 'clear-overrides',
    actorEmail: null,
    deletedCount: 0,
    changes: [],
    snapshot: [],
    createdAt: new Date('2026-04-02T00:00:00Z'),
  });

  const { rows } = await fetchCsv();
  assert.equal(rows.length, 2);

  const carol = rows.find((r) => r[1] === 'carol@example.com');
  assert.deepEqual(carol, [
    '2026-04-01T00:00:00.000Z',
    'carol@example.com',
    '7',
    '',
    '',
    '',
    '',
  ]);

  // Null actor must serialize as an empty string, not "null".
  const noop = rows.find((r) => r[0] === '2026-04-02T00:00:00.000Z');
  assert.deepEqual(noop, [
    '2026-04-02T00:00:00.000Z',
    '',
    '0',
    '',
    '',
    '',
    '',
  ]);
});

test('CSV ?action= rejects unknown values with 400 (mirrors the list endpoint)', async () => {
  const res = await fetch(`${baseUrl}${CSV_PATH}?action=not-a-real-action`);
  assert.equal(res.status, 400);
});
