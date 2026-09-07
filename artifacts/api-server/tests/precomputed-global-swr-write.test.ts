import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';

// Keep the cache implementation real, but never connect to Redis/PostgreSQL.
delete process.env.REDIS_URL;
const stations = Array.from({ length: 6 }, (_, i) => ({ _id: `id-${i}`, slug: `station-${i}`, name: `Station ${i}`, country: 'Germany', votes: 100-i }));
let reads = 0;
let fail = false;
let gate: Promise<void> | undefined;
mock.module('../src/data/postgres-catalog-store', { namedExports: { pgCatalog: () => ({
  globalStationCards: async (limit: number, perCountry: number) => {
    reads++;
    assert.equal(limit, 2000); assert.equal(perCountry, 200);
    if (gate) await gate;
    if (fail) throw new Error('catalog unavailable');
    return stations;
  },
  count: async (filter: unknown) => { assert.deepEqual(filter, { lastCheckOk: true }); return 61291; },
}) } });
const { CacheManager } = await import('../src/cache');
const { PrecomputedStationsService } = await import('../src/services/precomputed-stations');
const key = 'precomputed_stations:global';
const originalSet = CacheManager.set.bind(CacheManager);
const writes = mock.method(CacheManager, 'set', originalSet);
beforeEach(async () => {
  await CacheManager.delSWR(key);
  reads = 0; fail = false; gate = undefined; writes.mock.resetCalls();
});

test('concurrent cold global readers publish one SWR envelope and retain rank, count and pagination', async () => {
  const results = await Promise.all(Array.from({ length: 8 }, () => PrecomputedStationsService.getGlobalStations(2, 2)));
  assert.equal(reads, 1);
  assert.equal(writes.mock.callCount(), 1);
  assert.equal(writes.mock.calls[0].arguments[0], `${key}:swr`);
  assert.deepEqual(writes.mock.calls[0].arguments[2], { ttl: 86400*7 });
  for (const result of results) {
    assert.deepEqual(result.stations, stations.slice(2, 4));
    assert.equal(result.total, 61291); assert.equal(result.page, 2); assert.equal(result.totalPages, 3);
  }
  const warm = await PrecomputedStationsService.getGlobalStations(1, 3);
  assert.deepEqual(warm.stations, stations.slice(0, 3)); assert.equal(warm.cached, true);
  assert.equal(reads, 1); assert.equal(writes.mock.callCount(), 1);
});

test('direct global refresh still writes through and subsequent shared readers reuse it', async () => {
  const refreshed = await PrecomputedStationsService.computeGlobalStations();
  assert.equal(writes.mock.callCount(), 1);
  assert.equal(await CacheManager.getSWR(key), refreshed);
  assert.equal(refreshed.total, 61291); assert.deepEqual(refreshed.stations, stations);
  const warm = await PrecomputedStationsService.getGlobalStations();
  assert.equal(warm.cached, true); assert.equal(reads, 1); assert.equal(writes.mock.callCount(), 1);
});

test('stale reads return immediately and coalesce background refresh into one publication', async () => {
  const stale = { stations: stations.slice(0, 1), total: 100, computedAt: 1, countryName: 'global' };
  await CacheManager.set(`${key}:swr`, { v: stale, exp: Date.now()-1 }, { ttl: 86400*7 });
  writes.mock.resetCalls();
  let release!: () => void;
  gate = new Promise<void>(resolve => { release = resolve; });
  const results = await Promise.all(Array.from({ length: 8 }, () => PrecomputedStationsService.getGlobalStations()));
  assert.ok(results.every(result => result.total === 100));
  assert.equal(reads, 1); assert.equal(writes.mock.callCount(), 0);
  release();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(writes.mock.callCount(), 1);
  assert.equal((await CacheManager.getSWR<{ total: number }>(key))?.total, 61291);
});

test('failed loads publish nothing and a following request can retry successfully', async () => {
  fail = true;
  await assert.rejects(PrecomputedStationsService.getGlobalStations(), /catalog unavailable/);
  assert.equal(writes.mock.callCount(), 0); assert.equal(await CacheManager.getSWR(key), null);
  fail = false;
  const retried = await PrecomputedStationsService.getGlobalStations();
  assert.equal(retried.total, 61291); assert.equal(reads, 2); assert.equal(writes.mock.callCount(), 1);
});
