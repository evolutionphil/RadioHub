import { after, before, mock, test } from 'node:test';
import assert from 'node:assert/strict';

let stations: any[] = [], updates: any[] = [], batches: any[] = [], inserts: any[] = [], reports: string[] = [];
let SyncService: any, runJunkCleanup: any;
const day = 86400000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const row = (extra: any = {}) => ({ _id: 'station-a', stationuuid: 'uuid-a', name: 'Oriental', slug: 'oriental', url: 'https://example.invalid/radio', noIndex: false,
  manualEditFields: {}, lastCheckOk: false, lastCheckTime: ago(60000), lastCheckOkTime: ago(31 * day), ...extra });
const recovered = (extra: any = {}) => row({ noIndex: true, lastCheckOk: true, lastCheckTime: ago(1000), lastCheckOkTime: ago(1000),
  automaticNoIndex: { owner: 'radiohub-junk-policy', version: 1, active: true, reason: 'stream-dead-30d', failedCheckAt: ago(day) }, ...extra });
const reset = (rows: any[]) => { stations = rows; updates = []; batches = []; inserts = []; reports = []; };
const catalog = {
  find: async (filter: any) => filter.stationuuid ? stations : [],
  findOne: async () => null,
  count: async () => stations.length,
  iterate: async function* () { for (const station of stations) yield station; },
  insertMany: async (docs: any[]) => { inserts.push(...docs); return docs; },
  update: async (filter: any, update: any, options: any) => { updates.push({ filter, update, options }); return { modifiedCount: 1, matchedCount: 1 }; },
  updateProviderBatch: async (batch: any[], syncRunId: string) => { batches.push(...batch.map(entry => ({ ...entry, syncRunId }))); return { modifiedCount: batch.length }; },
};

before(async () => {
  mock.module('../src/data/postgres-catalog-store', { namedExports: {
    pgCatalog: () => catalog, pgCreateSyncRun: async () => ({}), pgSaveSyncRun: async () => {}, pgSyncLogs: async () => [], pgSyncBlacklist: async () => [],
  } });
  mock.module('../src/postgres-runtime', { namedExports: {
    getPostgresPool: () => { throw new Error('No database access permitted'); },
    getPostgresCoordinationPool: () => { throw new Error('No leadership/session access permitted'); }, closePostgres: async () => {},
  } });
  mock.module('../src/services/image-manager', { namedExports: { ImageManager: class {} } });
  mock.module('../src/services/logo-processor', { namedExports: { logoProcessor: {} } });
  mock.module('../src/utils/logger', { namedExports: { logger: { log() {}, warn() {}, error() {} } } });
  mock.module('fs/promises', { defaultExport: { mkdir: async () => {}, writeFile: async (_path: string, body: string) => { reports.push(body); } } });
  ({ SyncService } = await import('../src/services/sync'));
  ({ runJunkCleanup } = await import('../src/utils/clean-content-quality-urls'));
});
after(() => mock.restoreAll());

async function sync(api: any) {
  const service = new SyncService();
  return service.syncStationsIncrementally([api], { _id: 'test-sync' }, new Set(), new Set());
}
const incoming = (extra: any = {}) => ({ stationuuid: 'uuid-a', name: 'Provider name', url: 'https://example.invalid/radio',
  lastcheckok: 0, lastchecktime: ago(60000), lastcheckoktime: ago(31 * day), ...extra });

test('sync marks new current health failure with explicit provenance; stale records are not marked', async () => {
  reset([]); await sync(incoming());
  assert.equal(inserts[0].noIndex, true);
  assert.equal(inserts[0].automaticNoIndex.reason, 'stream-dead-30d');
  reset([]); await sync(incoming({ lastchecktime: '2025-01-01T00:00:00Z' }));
  assert.equal(inserts[0].noIndex, undefined);
  assert.equal(inserts[0].automaticNoIndex, undefined);
});

test('sync automatic transition uses guarded row update with all provider/manual fences', async () => {
  const existing = row(); reset([existing]); await sync(incoming());
  assert.equal(updates.length, 1); assert.equal(batches.length, 0);
  const write = updates[0];
  assert.equal(write.update.$set.noIndex, true);
  assert.equal(write.update.$set.automaticNoIndex.reason, 'stream-dead-30d');
  assert.deepEqual(write.filter.noIndex, { $eq: false });
  assert.deepEqual(write.filter.manualEditFields, { $eq: {} });
  assert.deepEqual(write.options, { respectManualFields: true, protectLocalCounters: true, fillMissingFaviconOnly: true, syncRunId: 'test-sync' });
});

test('sync can recover owned health flag but never unknown/manual noindex', async () => {
  reset([recovered({ lastCheckOk: false, lastCheckTime: ago(day), lastCheckOkTime: ago(40 * day) })]);
  await sync(incoming({ lastcheckok: 1, lastchecktime: ago(1000), lastcheckoktime: ago(1000) }));
  assert.equal(updates[0].update.$set.noIndex, false);
  for (const extra of [{ automaticNoIndex: undefined }, { manualEditFields: { noIndex: true } }, { redirectToSlug: 'original' }]) {
    reset([recovered(extra)]); await sync(incoming({ lastcheckok: 1, lastchecktime: ago(1000), lastcheckoktime: ago(1000) }));
    assert.equal(updates.length, 0);
    assert.equal(batches[0].patch.noIndex, undefined);
    assert.equal(batches[0].patch.automaticNoIndex, undefined);
  }
});

test('sync evaluates persisted manual name and protected health instead of raw feed', async () => {
  reset([row({ name: 'Actual Station', lastCheckOk: true, lastCheckTime: ago(1000), lastCheckOkTime: ago(1000), manualEditFields: { lastCheckOk: true } })]);
  await sync(incoming({ name: 'Pink Noise Test Stream', lastchecktime: ago(1000) }));
  assert.equal(updates.length, 0);
  assert.equal(batches[0].patch.noIndex, undefined);
});

test('nightly cleanup never clears unknown/manual/redirect/non-health flags', async () => {
  for (const extra of [{ automaticNoIndex: undefined }, { manualEditFields: { noIndex: true } }, { redirectToSlug: 'primary' },
    { automaticNoIndex: { owner: 'radiohub-junk-policy', version: 1, active: true, reason: 'codec-suffix:-aac' } }]) {
    reset([recovered(extra)]);
    await runJunkCleanup({ dryRun: false, reportPath: '/not-written.csv', log() {} });
    assert.equal(updates.length, 0);
  }
});

test('nightly cleanup owned-health recovery is guarded and audited; dry-run never writes', async () => {
  const existing = recovered(); reset([existing]);
  await runJunkCleanup({ dryRun: false, reportPath: '/not-written.csv', log() {} });
  assert.equal(updates.length, 1);
  assert.equal(updates[0].update.$set.noIndex, false);
  assert.deepEqual(updates[0].filter.automaticNoIndex, { $eq: existing.automaticNoIndex });
  assert.equal(updates[0].options.respectManualFields, true);
  assert.match(reports[0], /fresh-success-after-owned-health-failure/);
  reset([existing]); await runJunkCleanup({ dryRun: true, reportPath: '/not-written.csv', log() {} });
  assert.equal(updates.length, 0);
});

test('cleanup new flags have provenance and existing unknown flags are not adopted', async () => {
  reset([row()]); await runJunkCleanup({ dryRun: false, reportPath: '/not-written.csv', log() {} });
  assert.equal(updates[0].update.$set.automaticNoIndex.reason, 'stream-dead-30d');
  reset([row({ noIndex: true })]); await runJunkCleanup({ dryRun: false, reportPath: '/not-written.csv', log() {} });
  assert.equal(updates.length, 0);
});
