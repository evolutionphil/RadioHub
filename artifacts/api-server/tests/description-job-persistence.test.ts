import { beforeEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';

let record: any;
let acquired = true;
let completedDuringLock = false;
let writes: any[];
let released: boolean[];
const pool = {
  query: async (sql: string, values: any[]) => {
    if (sql.startsWith('SELECT')) return { rows: record ? [structuredClone(record)] : [] };
    writes.push({ sql, values });
    return { rows: [] };
  },
};
mock.module(new URL('../src/postgres-runtime.ts', import.meta.url).href, { namedExports: {
  getPostgresPool: () => pool,
  getPostgresCoordinationPool: () => ({ connect: async () => ({
    query: async (sql: string) => {
      if (completedDuringLock) record.status = 'completed';
      return { rows: [{ acquired }] };
    },
    release: (discard: boolean) => released.push(discard),
  }) }),
} });
mock.module(new URL('../src/data/station-identity-store.ts', import.meta.url).href, { namedExports: { lockStationIdentity: async () => null } });
const { pgReadDescriptionJob } = await import('../src/data/postgres-runtime-operations');

beforeEach(() => {
  record = { job_id: 'fixture-job', status: 'running', total_stations: 50, processed_stations: 7,
    success_count: 5, failed_count: 1, skipped_count: 1, created_at: new Date(), updated_at: new Date() };
  acquired = true;
  completedDuringLock = false;
  writes = [];
  released = [];
});

test('durable progress reports interrupted worker as failed with safe missing-only continuation', async () => {
  const status = await pgReadDescriptionJob('fixture-job');
  assert.equal(status.status, 'failed');
  assert.equal(status.interrupted, true);
  assert.equal(status.total, 50);
  assert.equal(status.processed, 7);
  assert.equal(status.successful, 5);
  assert.match(status.error, /interrupted.*Rerun the same selection/);
  assert.equal(writes.length, 1);
  assert.deepEqual(released, [false]);
});

test('live worker on another replica keeps running status', async () => {
  acquired = false;
  const status = await pgReadDescriptionJob('fixture-job');
  assert.equal(status.status, 'running');
  assert.equal(status.interrupted, false);
  assert.equal(writes.length, 0);
});

test('interrupted global repair persists an unconfirmed publishing warning', async () => {
  record.publish_status = 'pending';
  const status = await pgReadDescriptionJob('fixture-job');
  assert.equal(status.status, 'failed'); assert.equal(status.publishStatus, 'failed');
  assert.match(status.error, /Sitemap refresh was not confirmed/);
  assert.match(writes[0].sql, /publish_status/);
});

test('completion concurrent with lock acquisition is not misreported as interruption', async () => {
  completedDuringLock = true;
  const status = await pgReadDescriptionJob('fixture-job');
  assert.equal(status.status, 'completed');
  assert.equal(status.interrupted, false);
  assert.equal(writes.length, 0);
});

test('completed progress remains readable without worker memory or extra writes', async () => {
  record.status = 'completed';
  assert.equal((await pgReadDescriptionJob('fixture-job')).status, 'completed');
  assert.equal(writes.length, 0);
  assert.equal(released.length, 0);
  record = null;
  assert.equal(await pgReadDescriptionJob('unknown'), null);
});
