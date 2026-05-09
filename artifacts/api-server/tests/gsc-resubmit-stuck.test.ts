/**
 * Task #356 — coverage for the auto-resubmit flow shipped in Task #266.
 *
 * `runResubmitStuckOnce` decides which GSC URL inspection rows count as
 * "stuck" (still in a non-indexed bucket beyond a configurable window),
 * pings IndexNow for each, force-rebuilds the sitemap and bookkeeps the
 * attempt back onto the row so the cooldown filter prevents hammering.
 * None of that decision logic was covered before — a regression could
 * silently start resubmitting nothing (or everything) without anyone
 * noticing. This file locks down:
 *
 *   1. Stuck-window threshold:   only rows in NON_INDEXED_STATES whose
 *      `notIndexedSince` is older than RESUBMIT_STUCK_DAYS get picked.
 *   2. State filter:             indexed/excluded/error/pending rows are
 *      ignored even when their `notIndexedSince` is ancient.
 *   3. Cooldown filter:          a row whose `lastResubmitAt` is newer
 *      than RESUBMIT_COOLDOWN_DAYS is skipped on the next run.
 *   4. Bookkeeping:              `lastResubmitAt`, `lastResubmitStatus`,
 *      `resubmitCount` and the `lastInspectedAt` unset are all applied
 *      to every candidate, on both success and failure paths.
 *   5. notIndexedSince transitions on inspection updates: set on the
 *      transition INTO a non-indexed bucket and cleared on the transition
 *      out, while preserved when the row stays non-indexed across runs.
 *
 * The resubmit suite uses a real in-memory MongoDB so the actual Mongoose
 * filter, sort and updateMany run end-to-end. The transition suite calls
 * the same `runInspectionBatchOnce` the cron uses, with `axios` and the
 * `google-auth-library` JWT mocked so we can drive deterministic GSC
 * inspection responses without touching the network.
 *
 * Runner: requires `--experimental-test-module-mocks` (wired up in
 * artifacts/api-server/package.json#scripts.test).
 */

import { test, mock, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

// ---------------------------------------------------------------------------
// Mocks installed BEFORE importing gsc-inspection.ts so it picks them up.
// ---------------------------------------------------------------------------

let indexNowResult: { success: boolean; error?: string } = { success: true };
const indexNowCalls: Array<{ urls: string[]; trigger: string }> = [];

mock.module(
  new URL('../src/services/indexnow.ts', import.meta.url).href,
  {
    namedExports: {
      IndexNowService: {
        submitToIndexNow: async (urls: string[], trigger: string) => {
          indexNowCalls.push({ urls: [...urls], trigger });
          return indexNowResult;
        },
      },
    },
  },
);

let sitemapRebuildCalls = 0;
let sitemapRebuildShouldThrow = false;

mock.module(
  new URL('../src/seo/sitemap-manifest-builder.ts', import.meta.url).href,
  {
    namedExports: {
      buildAllSitemapManifests: async () => {
        sitemapRebuildCalls += 1;
        if (sitemapRebuildShouldThrow) {
          throw new Error('synthetic sitemap rebuild failure');
        }
        return {};
      },
      // The resubmit path doesn't use these, but they're imported at the
      // top of gsc-inspection.ts so the mock must satisfy the namespace.
      getActiveManifest: async () => null,
      extractTopCountriesFromChunk: () => [],
    },
  },
);

mock.module(
  new URL('../src/performance-cache.ts', import.meta.url).href,
  {
    namedExports: {
      performanceCache: {
        getUrlTranslations: async () => new Map<string, string>(),
        invalidateStationCache: () => {},
      },
    },
  },
);

// google-auth-library + axios are only exercised by the inspection path,
// but the gsc-inspection module imports them at the top so we stub both
// here. The transition suite below swaps `axiosResponder` per test to
// drive deterministic verdicts.

interface AxiosResponse {
  status: number;
  data: unknown;
}
let axiosResponder: (url: string) => AxiosResponse = () => ({
  status: 200,
  data: {},
});
const axiosCalls: Array<{ url: string; payload: unknown }> = [];

mock.module('axios', {
  defaultExport: {
    post: async (
      _endpoint: string,
      payload: { inspectionUrl: string },
    ) => {
      axiosCalls.push({ url: payload.inspectionUrl, payload });
      return axiosResponder(payload.inspectionUrl);
    },
  },
});

mock.module('google-auth-library', {
  namedExports: {
    JWT: class FakeJWT {
      constructor(_opts: unknown) {}
      async getAccessToken() {
        return { token: 'test-access-token' };
      }
    },
  },
});

// ---------------------------------------------------------------------------
// Shared fixtures — boot one mongo-memory server for the whole file.
// ---------------------------------------------------------------------------

let mongod: MongoMemoryServer;

// Imported lazily AFTER the mocks above are installed.
let GscUrlInspection: typeof import('@workspace/db-shared/mongo-schemas')['GscUrlInspection'];
let runResubmitStuckOnce: (trigger?: string) => Promise<unknown>;
let runInspectionBatchOnce: (
  batchSize?: number,
  trigger?: string,
) => Promise<unknown>;
let RESUBMIT_STUCK_DAYS: number;
let RESUBMIT_COOLDOWN_DAYS: number;

const DAY_MS = 24 * 60 * 60 * 1000;

before(async () => {
  process.env.NODE_ENV = 'test';

  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { dbName: 'gsc-resubmit-test' });

  // Pretend GSC is configured so the inspection path doesn't short-circuit.
  process.env.GSC_SERVICE_ACCOUNT_JSON = JSON.stringify({
    client_email: 'test@example.com',
    private_key: 'fake-key',
  });
  process.env.GSC_SITE_URL = 'https://themegaradio.com/';

  const schemas = await import('@workspace/db-shared/mongo-schemas');
  GscUrlInspection = schemas.GscUrlInspection;

  const svc = await import('../src/services/gsc-inspection.ts');
  runResubmitStuckOnce =
    svc.gscInspectionService.runResubmitStuckOnce.bind(svc.gscInspectionService);
  runInspectionBatchOnce =
    svc.gscInspectionService.runInspectionBatchOnce.bind(svc.gscInspectionService);
  RESUBMIT_STUCK_DAYS = svc.RESUBMIT_STUCK_DAYS;
  RESUBMIT_COOLDOWN_DAYS = svc.RESUBMIT_COOLDOWN_DAYS;
});

after(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

beforeEach(async () => {
  await GscUrlInspection.deleteMany({});
  indexNowCalls.length = 0;
  axiosCalls.length = 0;
  indexNowResult = { success: true };
  sitemapRebuildCalls = 0;
  sitemapRebuildShouldThrow = false;
});

interface SeedRow {
  url: string;
  state: string;
  notIndexedSince?: Date;
  lastResubmitAt?: Date;
  lastResubmitStatus?: 'success' | 'failed';
  resubmitCount?: number;
  lastInspectedAt?: Date;
  group?: string;
  language?: string;
}

async function seed(rows: SeedRow[]) {
  await GscUrlInspection.insertMany(
    rows.map((r) => ({
      language: r.language ?? 'en',
      group: (r.group ?? 'station') as 'station',
      ...r,
    })),
  );
}

// ===========================================================================
// 1. Stuck-window threshold + state filter.
// ===========================================================================

test('runResubmitStuckOnce only picks non-indexed rows older than the stuck window', async () => {
  const now = Date.now();
  // Two stuck candidates (one of each non-indexed flavor) plus a basket
  // of rows that must NOT be picked: too-recent, indexed, excluded,
  // pending, error.
  const ancient = new Date(now - (RESUBMIT_STUCK_DAYS + 5) * DAY_MS);
  const recent = new Date(now - (RESUBMIT_STUCK_DAYS - 2) * DAY_MS);

  await seed([
    { url: 'https://t.example/stuck-discovered', state: 'discovered-not-indexed', notIndexedSince: ancient },
    { url: 'https://t.example/stuck-crawled', state: 'crawled-not-indexed', notIndexedSince: ancient },
    { url: 'https://t.example/recent', state: 'discovered-not-indexed', notIndexedSince: recent },
    { url: 'https://t.example/indexed', state: 'indexed', notIndexedSince: ancient },
    { url: 'https://t.example/excluded', state: 'excluded', notIndexedSince: ancient },
    { url: 'https://t.example/pending', state: 'pending' },
    { url: 'https://t.example/error', state: 'error', notIndexedSince: ancient },
    // Stuck-state row but missing notIndexedSince entirely — must be
    // ignored until the inspection batch (or the boot backfill)
    // anchors the timestamp.
    { url: 'https://t.example/stuck-no-anchor', state: 'discovered-not-indexed' },
  ]);

  const stats = (await runResubmitStuckOnce('test')) as {
    attempted: number;
    succeeded: number;
    failed: number;
    sitemapRebuilt: boolean;
  };

  assert.equal(stats.attempted, 2, 'only the two ancient non-indexed rows are stuck');
  assert.equal(stats.succeeded, 2);
  assert.equal(stats.failed, 0);
  assert.equal(stats.sitemapRebuilt, true);

  assert.equal(indexNowCalls.length, 1, 'IndexNow is pinged exactly once with all stuck URLs');
  const submittedUrls = new Set(indexNowCalls[0].urls);
  assert.deepEqual(
    submittedUrls,
    new Set([
      'https://t.example/stuck-discovered',
      'https://t.example/stuck-crawled',
    ]),
  );
  assert.equal(indexNowCalls[0].trigger, 'sitemap-regen');
  assert.equal(sitemapRebuildCalls, 1, 'sitemap is rebuilt once per resubmit run');
});

// ===========================================================================
// 2. Cooldown filter.
// ===========================================================================

test('runResubmitStuckOnce skips rows whose lastResubmitAt is inside the cooldown window', async () => {
  const now = Date.now();
  const ancient = new Date(now - (RESUBMIT_STUCK_DAYS + 10) * DAY_MS);
  const justResubmitted = new Date(now - (RESUBMIT_COOLDOWN_DAYS - 1) * DAY_MS);
  const oldEnoughToReSubmit = new Date(now - (RESUBMIT_COOLDOWN_DAYS + 1) * DAY_MS);

  await seed([
    {
      url: 'https://t.example/in-cooldown',
      state: 'discovered-not-indexed',
      notIndexedSince: ancient,
      lastResubmitAt: justResubmitted,
      lastResubmitStatus: 'success',
      resubmitCount: 1,
    },
    {
      url: 'https://t.example/cooldown-elapsed',
      state: 'crawled-not-indexed',
      notIndexedSince: ancient,
      lastResubmitAt: oldEnoughToReSubmit,
      lastResubmitStatus: 'failed',
      resubmitCount: 2,
    },
    {
      url: 'https://t.example/never-resubmitted',
      state: 'discovered-not-indexed',
      notIndexedSince: ancient,
    },
  ]);

  const stats = (await runResubmitStuckOnce('test')) as { attempted: number };
  assert.equal(stats.attempted, 2, 'cooldown row excluded; the other two are picked');

  const submitted = new Set(indexNowCalls[0]?.urls ?? []);
  assert.ok(submitted.has('https://t.example/cooldown-elapsed'));
  assert.ok(submitted.has('https://t.example/never-resubmitted'));
  assert.ok(
    !submitted.has('https://t.example/in-cooldown'),
    'a row pinged inside the cooldown must not be re-pinged',
  );

  // The cooldown row's bookkeeping must NOT advance.
  const untouched = await GscUrlInspection.findOne({
    url: 'https://t.example/in-cooldown',
  }).lean();
  assert.ok(untouched);
  assert.equal(untouched!.resubmitCount, 1, 'cooldown row resubmitCount stays put');
  assert.equal(
    untouched!.lastResubmitAt?.getTime(),
    justResubmitted.getTime(),
    'cooldown row lastResubmitAt stays put',
  );
});

// ===========================================================================
// 3. Bookkeeping on success: lastResubmitAt set, count incremented,
//    lastInspectedAt cleared so the next inspection batch picks it up.
// ===========================================================================

test('runResubmitStuckOnce bookkeeps every candidate on the success path', async () => {
  const ancient = new Date(Date.now() - (RESUBMIT_STUCK_DAYS + 1) * DAY_MS);
  const previousInspection = new Date(Date.now() - 2 * DAY_MS);

  await seed([
    {
      url: 'https://t.example/a',
      state: 'discovered-not-indexed',
      notIndexedSince: ancient,
      resubmitCount: 0,
      lastInspectedAt: previousInspection,
    },
    {
      url: 'https://t.example/b',
      state: 'crawled-not-indexed',
      notIndexedSince: ancient,
      resubmitCount: 3,
      lastInspectedAt: previousInspection,
    },
  ]);

  const before = Date.now();
  await runResubmitStuckOnce('test');
  const after = Date.now();

  const rows = await GscUrlInspection.find({}).sort({ url: 1 }).lean();
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal(row.lastResubmitStatus, 'success');
    assert.equal(row.lastResubmitError, undefined);
    assert.ok(row.lastResubmitAt instanceof Date);
    const ts = row.lastResubmitAt!.getTime();
    assert.ok(
      ts >= before && ts <= after,
      'lastResubmitAt must be set during the run',
    );
    assert.equal(
      row.lastInspectedAt,
      undefined,
      'lastInspectedAt must be unset so the next inspection batch re-checks Google',
    );
  }
  // resubmitCount is incremented per row (0→1, 3→4).
  const a = rows.find((r) => r.url === 'https://t.example/a')!;
  const b = rows.find((r) => r.url === 'https://t.example/b')!;
  assert.equal(a.resubmitCount, 1);
  assert.equal(b.resubmitCount, 4);
});

// ===========================================================================
// 4. Bookkeeping on failure: status='failed', error captured, cooldown
//    still applies so we don't hammer on repeated IndexNow outages.
// ===========================================================================

test('runResubmitStuckOnce records lastResubmitStatus="failed" when IndexNow rejects the batch', async () => {
  indexNowResult = { success: false, error: 'synthetic IndexNow outage' };
  const ancient = new Date(Date.now() - (RESUBMIT_STUCK_DAYS + 1) * DAY_MS);

  await seed([
    {
      url: 'https://t.example/will-fail',
      state: 'discovered-not-indexed',
      notIndexedSince: ancient,
    },
  ]);

  const stats = (await runResubmitStuckOnce('test')) as {
    attempted: number;
    succeeded: number;
    failed: number;
  };
  assert.equal(stats.attempted, 1);
  assert.equal(stats.succeeded, 0);
  assert.equal(stats.failed, 1);

  const row = await GscUrlInspection.findOne({
    url: 'https://t.example/will-fail',
  }).lean();
  assert.ok(row);
  assert.equal(row!.lastResubmitStatus, 'failed');
  assert.match(row!.lastResubmitError ?? '', /synthetic IndexNow outage/);
  assert.equal(row!.resubmitCount, 1, 'count still bumps so cooldown applies on failure too');
  assert.ok(row!.lastResubmitAt instanceof Date);
});

// ===========================================================================
// 5. Empty case: no stuck rows → no IndexNow ping, no sitemap rebuild.
// ===========================================================================

test('runResubmitStuckOnce is a no-op when nothing is stuck', async () => {
  await seed([
    { url: 'https://t.example/healthy', state: 'indexed' },
    {
      url: 'https://t.example/recent',
      state: 'discovered-not-indexed',
      notIndexedSince: new Date(Date.now() - 1 * DAY_MS),
    },
  ]);

  const stats = (await runResubmitStuckOnce('test')) as {
    attempted: number;
    sitemapRebuilt: boolean;
  };
  assert.equal(stats.attempted, 0);
  assert.equal(stats.sitemapRebuilt, false);
  assert.equal(indexNowCalls.length, 0);
  assert.equal(sitemapRebuildCalls, 0);
});

// ===========================================================================
// 6. notIndexedSince transitions on inspection updates.
//
//    The inspection batch is the only path that owns the
//    `notIndexedSince` field. We verify the three transition shapes:
//      a. indexed → non-indexed: set to NOW.
//      b. non-indexed → non-indexed across runs: previous timestamp
//         preserved (the "stuck for X days" window keeps growing).
//      c. non-indexed → indexed/excluded: cleared so the row drops out
//         of the resubmit candidate set.
// ===========================================================================

function gscPayload(coverage: string, verdict = 'NEUTRAL') {
  return {
    status: 200,
    data: {
      inspectionResult: {
        indexStatusResult: {
          coverageState: coverage,
          verdict,
          indexingState: 'INDEXING_ALLOWED',
          robotsTxtState: 'ALLOWED',
          pageFetchState: 'SUCCESSFUL',
        },
      },
    },
  };
}

test('inspection update SETS notIndexedSince on the transition into a non-indexed bucket', async () => {
  await seed([
    { url: 'https://t.example/freshly-stuck', state: 'indexed' },
  ]);

  axiosResponder = () => gscPayload('Discovered - currently not indexed');
  const before = Date.now();
  await runInspectionBatchOnce(10, 'test');
  const after = Date.now();

  const row = await GscUrlInspection.findOne({
    url: 'https://t.example/freshly-stuck',
  }).lean();
  assert.ok(row);
  assert.equal(row!.state, 'discovered-not-indexed');
  assert.ok(row!.notIndexedSince instanceof Date);
  const ts = row!.notIndexedSince!.getTime();
  assert.ok(
    ts >= before && ts <= after,
    'notIndexedSince must be anchored to the inspection time on the transition INTO non-indexed',
  );
});

test('inspection update PRESERVES notIndexedSince when a row stays non-indexed across runs', async () => {
  const anchored = new Date(Date.now() - 30 * DAY_MS);
  await seed([
    {
      url: 'https://t.example/still-stuck',
      state: 'discovered-not-indexed',
      notIndexedSince: anchored,
    },
  ]);

  // Same non-indexed verdict on the next inspection — the "stuck since"
  // anchor must NOT be reset, otherwise a URL would never become
  // resubmit-eligible.
  axiosResponder = () => gscPayload('Crawled - currently not indexed');
  await runInspectionBatchOnce(10, 'test');

  const row = await GscUrlInspection.findOne({
    url: 'https://t.example/still-stuck',
  }).lean();
  assert.ok(row);
  assert.equal(row!.state, 'crawled-not-indexed');
  assert.equal(
    row!.notIndexedSince?.getTime(),
    anchored.getTime(),
    'notIndexedSince must be preserved when the row stays non-indexed across inspections',
  );
});

test('inspection update CLEARS notIndexedSince on the transition out of a non-indexed bucket', async () => {
  const anchored = new Date(Date.now() - 30 * DAY_MS);
  await seed([
    {
      url: 'https://t.example/recovered',
      state: 'discovered-not-indexed',
      notIndexedSince: anchored,
    },
  ]);

  axiosResponder = () => gscPayload('Submitted and indexed', 'PASS');
  await runInspectionBatchOnce(10, 'test');

  const row = await GscUrlInspection.findOne({
    url: 'https://t.example/recovered',
  }).lean();
  assert.ok(row);
  assert.equal(row!.state, 'indexed');
  assert.equal(
    row!.notIndexedSince,
    undefined,
    'notIndexedSince must be cleared so the row drops out of the resubmit candidate set',
  );
});

test('inspection update ANCHORS notIndexedSince for legacy rows already non-indexed without a timestamp', async () => {
  // Pre-task-#266 rows live in a non-indexed bucket but have no
  // `notIndexedSince`. The boot backfill anchors them to
  // lastInspectedAt; the next inspection round does the same
  // defensively when the field is still missing.
  const previousInspection = new Date(Date.now() - 21 * DAY_MS);
  await seed([
    {
      url: 'https://t.example/legacy',
      state: 'discovered-not-indexed',
      lastInspectedAt: previousInspection,
    },
  ]);

  axiosResponder = () => gscPayload('Discovered - currently not indexed');
  await runInspectionBatchOnce(10, 'test');

  const row = await GscUrlInspection.findOne({
    url: 'https://t.example/legacy',
  }).lean();
  assert.ok(row);
  assert.equal(row!.state, 'discovered-not-indexed');
  assert.equal(
    row!.notIndexedSince?.getTime(),
    previousInspection.getTime(),
    'legacy non-indexed row must anchor notIndexedSince to its previous inspection time',
  );
});
