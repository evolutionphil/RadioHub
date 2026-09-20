import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { after, before, beforeEach, mock, test } from 'node:test';

let SyncService: any;
let providerPages: unknown[][], existing: any[], inserted: any[], updated: any[], savedRuns: any[], warnings: string[];
let failure: 'find' | 'insert' | 'update' | null;
let writeAttempts: number, queryAttempts: number, leaderReleased: boolean;
const fixtureError = Object.assign(new Error('Fixture database unavailable'), { code: '08006' });
const provider = (extra: Record<string, any> = {}) => ({
  stationuuid: 'new-radio', name: 'Radio Sunrise', url: 'https://example.invalid/live',
  countrycode: 'DE', lastcheckok: 1, ...extra,
});
const catalog = {
  find: async (filter: any) => {
    queryAttempts++;
    if (failure === 'find') throw fixtureError;
    if (filter.stationuuid) return existing.filter(row => filter.stationuuid.$in.includes(row.stationuuid));
    return [];
  },
  count: async () => existing.length + inserted.length,
  insertMany: async (docs: any[], options: any) => {
    writeAttempts++;
    if (failure === 'insert') throw fixtureError;
    assert.equal(options.syncRunId, 'sync-fixture');
    for (const row of docs) {
      if (!row.stationuuid || !row.name || !row.url) throw new Error('Station UUID, name and URL are required');
    }
    inserted.push(...structuredClone(docs));
    return docs;
  },
  updateProviderBatch: async (rows: any[], syncRunId: string) => {
    writeAttempts++;
    if (failure === 'update') throw fixtureError;
    assert.equal(syncRunId, 'sync-fixture');
    updated.push(...structuredClone(rows));
    return { modifiedCount: rows.length };
  },
  update: async () => { throw new Error('Unexpected policy write in provider validation fixture'); },
};

before(async () => {
  mock.module('../src/data/postgres-catalog-store', { namedExports: {
    pgCatalog: () => catalog,
    pgCreateSyncRun: async () => ({ _id: 'sync-fixture', status: 'running' }),
    pgSaveSyncRun: async (run: any) => { savedRuns.push(structuredClone(run)); },
    pgSyncLogs: async () => [], pgSyncBlacklist: async () => [],
  } });
  mock.module('../src/postgres-runtime', { namedExports: {
    getPostgresPool: () => ({ query: async () => ({ rowCount: 1, rows: [{ status: 'running', cancel_requested: false }] }) }),
    getPostgresCoordinationPool: () => ({ connect: async () => Object.assign(new EventEmitter(), {
      query: async () => ({ rows: [{ acquired: true }] }), release: () => { leaderReleased = true; },
    }) }),
  } });
  mock.module('axios', { defaultExport: { get: async () => ({ data: providerPages.shift() || [] }) } });
  mock.module('../src/services/image-manager', { namedExports: { ImageManager: class {} } });
  mock.module('../src/services/logo-processor', { namedExports: { logoProcessor: {} } });
  mock.module('../src/services/indexnow', { namedExports: { IndexNowService: { submitStationUrls: async () => {} } } });
  mock.module('../src/utils/logger', { namedExports: { logger: {
    log() {}, error() {}, warn: (message: string) => { warnings.push(message); },
  } } });
  ({ SyncService } = await import('../src/services/sync'));
});

beforeEach(() => {
  providerPages = []; existing = []; inserted = []; updated = []; savedRuns = []; warnings = [];
  failure = null; writeAttempts = 0; queryAttempts = 0; leaderReleased = false;
});
after(async () => {
  // Let queued, non-blocking sync follow-ups import their mocked dependency
  // before restoring it; none may load a real external-service module.
  await new Promise<void>(resolve => setImmediate(resolve));
  await import('../src/services/indexnow');
  mock.restoreAll();
});

function service() {
  const instance = new SyncService();
  instance.downloadFaviconsInBackground = async () => {};
  instance.processLogosInBackground = async () => {};
  instance.hydrateMissingTagsInBackground = async () => {};
  return instance;
}

test('incomplete provider rows are skipped and audited while valid insert and update complete', async () => {
  existing = [{ _id: 'local', stationuuid: 'existing-radio', name: 'Local title', slug: 'local-radio',
    url: 'https://local.invalid/live', descriptions: { en: 'Saved description' }, favicon: 'https://local.invalid/logo',
    manualEditFields: { url: true, name: true }, noIndex: true }];
  const original = structuredClone(existing);
  providerPages = [[
    provider(),
    provider({ stationuuid: 'missing-url', url: undefined, url_resolved: 'https://must-not-substitute.invalid/live' }),
    provider({ stationuuid: 'existing-radio', name: 'Provider title', url: 'https://provider.invalid/live', favicon: 'https://provider.invalid/logo' }),
    provider({ stationuuid: 'existing-radio', url: '' }),
  ]];
  const result = await service().startSync();
  assert.equal(result.success, true);
  assert.match(result.message, /2 invalid skipped/);
  assert.deepEqual(inserted.map(row => row.stationuuid), ['new-radio']);
  assert.equal(inserted[0].url, 'https://example.invalid/live');
  assert.equal(updated.length, 1);
  assert.equal(updated[0].uuid, 'existing-radio');
  for (const field of ['name', 'descriptions', 'favicon', 'manualEditFields', 'noIndex']) {
    assert.equal(Object.hasOwn(updated[0].patch, field), false, `${field} stays under local control`);
  }
  assert.deepEqual(existing, original);
  const run = savedRuns.at(-1);
  assert.equal(run.status, 'completed');
  assert.equal(run.stationsProcessed, 4);
  assert.equal(run.stationsAdded, 1);
  assert.equal(run.stationsUpdated, 1);
  assert.equal(run.stationsSkipped, 2);
  assert.equal(run.stationsInvalid, 2);
  assert.deepEqual(run.stationsInvalidReasons, { url: 2 });
  assert.deepEqual(run.stationsInvalidSamples, [
    { stationuuid: 'missing-url', fields: ['url'] }, { stationuuid: 'existing-radio', fields: ['url'] },
  ]);
  assert.match(warnings.join('\n'), /skipped 2 invalid provider rows/);
  assert.doesNotMatch(JSON.stringify(run.stationsInvalidSamples), /https?:/);
  assert.equal(leaderReleased, true);
});

test('null, empty, whitespace and wrongly typed required fields never reach catalogue writes', async () => {
  const invalidRows: any[] = [null, false, [], {}];
  for (const field of ['stationuuid', 'name', 'url']) {
    for (const value of [undefined, null, '', ' \t\n', 23, true, {}, []]) {
      invalidRows.push(provider({ [field]: value }));
    }
  }
  providerPages = [invalidRows];
  const result = await service().startSync();
  assert.equal(result.success, true);
  assert.equal(writeAttempts, 0);
  assert.equal(queryAttempts, 0);
  const run = savedRuns.at(-1);
  assert.equal(run.stationsInvalid, invalidRows.length);
  assert.equal(run.stationsProcessed, invalidRows.length);
  assert.equal(run.stationsSkipped, invalidRows.length);
  assert.equal(run.stationsInvalidSamples.length, 10);
  assert.deepEqual(run.stationsInvalidReasons, { stationuuid: 12, name: 12, url: 12 });
  assert.equal(savedRuns[0].status, 'running', 'an all-invalid batch still persists progress');
});

test('invalid UUID occurrences do not suppress valid records later in the same or next page', async () => {
  providerPages = [
    [provider({ stationuuid: 'repaired', url: '' }), provider(), ...Array.from({ length: 4998 }, () => provider())],
    [provider({ stationuuid: 'repaired' }), provider(), provider({ stationuuid: 'later-repaired', name: null }), provider({ stationuuid: 'later-repaired' })],
  ];
  const result = await service().startSync();
  assert.equal(result.success, true);
  assert.deepEqual(inserted.map(row => row.stationuuid), ['new-radio', 'repaired', 'later-repaired']);
  const progress = savedRuns.filter(run => run.status === 'running');
  assert.deepEqual(progress.map(run => run.stationsProcessed), [2, 5]);
  assert.deepEqual(progress.map(run => run.stationsInvalid), [1, 2]);
  assert.deepEqual(progress.map(run => run.stationsSkipped), [1, 2]);
  assert.equal(savedRuns.at(-1).stationsInvalid, 2);
});

test('validation preserves accepted provider text exactly and does not impose an HTTP-only URL policy', async () => {
  const record = provider({ name: '  Dünya Rádió  ', url: 'mms://legacy.example.invalid/stream' });
  providerPages = [[record]];
  assert.equal((await service().startSync()).success, true);
  assert.equal(inserted[0].name, record.name);
  assert.equal(inserted[0].url, record.url);
  assert.equal(savedRuns.at(-1).stationsInvalid, 0);
});

test('invalid-row diagnostics remain consistent when valid catalogue writes subsequently fail', async () => {
  failure = 'insert';
  providerPages = [[provider({ stationuuid: 'missing-url', url: null }), provider()]];
  assert.equal((await service().startSync()).success, false);
  const run = savedRuns.at(-1);
  assert.equal(run.status, 'failed');
  assert.equal(run.error, fixtureError.message);
  assert.equal(run.stationsSkipped, 1);
  assert.equal(run.stationsInvalid, 1);
  assert.deepEqual(run.stationsInvalidReasons, { url: 1 });
  assert.equal(inserted.length, 0);
});

for (const operation of ['find', 'insert', 'update'] as const) {
  test(`real catalogue ${operation} failures still fail the run, without retry or invalid-row classification`, async () => {
    failure = operation;
    if (operation === 'update') existing = [{ _id: 'local', ...provider(), slug: 'radio-sunrise', noIndex: false }];
    providerPages = [[provider()]];
    const result = await service().startSync();
    assert.equal(result.success, false);
    assert.match(result.message, /Fixture database unavailable/);
    assert.equal(savedRuns.at(-1).status, 'failed');
    assert.equal(savedRuns.at(-1).error, fixtureError.message);
    assert.equal(savedRuns.at(-1).stationsInvalid || 0, 0);
    assert.equal(writeAttempts, operation === 'find' ? 0 : 1);
    assert.equal(leaderReleased, true);
  });
}
