import assert from 'node:assert/strict';
import { beforeEach, after, it, mock } from 'node:test';
const entries = new Map<string, any>(), writes: Array<{ key: string; options: any }> = [];
mock.module('../src/cache', { defaultExport: {
  get: async (key: string) => entries.get(key) ?? null,
  set: async (key: string, value: any, options: any) => { entries.set(key, value); writes.push({ key, options }); },
  del: async (key: string) => { entries.delete(key); },
  clearByPattern: async () => {},
} });
const { publicStationCache: cache, publicStationCacheKey: key } = await import('../src/public-station-cache');
let now = 1_000_000;
beforeEach(() => { entries.clear(); writes.length = 0; now = 1_000_000; mock.method(Date, 'now', () => now); });
after(() => mock.restoreAll());

it('never reads former public data and caps day/week TTLs at 60 seconds', async () => {
  entries.set('stations', ['offline']);
  assert.equal(await cache.get('stations'), null);
  await cache.set('stations', ['healthy'], { ttl: 86400 });
  assert.equal(writes[0].options.ttl, 60);
  assert.deepEqual(await cache.get('stations'), ['healthy']);
  now += 60001;
  assert.equal(await cache.get('stations'), null, 'absolute deadline survives a Redis to memory promotion');
  assert.ok(entries.has(key('stations')), 'mock deliberately retains stale memory values');
});
it('SWR fallback cannot return expired health data or extend it during an outage', async () => {
  await cache.setSWR('popular', ['healthy'], { freshTtl: 86400, staleTtl: 604800 });
  now += 60001;
  assert.equal(await cache.getSWR('popular'), null);
  await assert.rejects(cache.getOrSetSWR('popular', async () => { throw new Error('database unavailable'); }, { freshTtl: 86400, staleTtl: 604800 }));
  assert.equal(await cache.getSWR('popular'), null);
});
it('coalesces cold requests and re-reads after expiry so recovered stations return', async () => {
  let calls = 0;
  const loader = async () => { calls++; return ['recovered']; };
  const results = await Promise.all(Array.from({ length: 20 }, () => cache.getOrSetSingleFlight('cards', loader)));
  assert.equal(calls, 1); assert.equal(results.length, 20);
  now += 60001;
  await cache.getOrSetSingleFlight('cards', loader); assert.equal(calls, 2);
});
it('does not renew a cached pool deadline when wrapping it in a later response cache', async () => {
  await cache.setSWR('pool', ['healthy'], { freshTtl: 60, staleTtl: 60 });
  now += 55000;
  await cache.getOrSetSingleFlight('response', async () => ({ stations: await cache.getSWR('pool') }));
  assert.equal(entries.get(key('response')).expiresAt, 1_060_000);
  now += 5001;
  assert.equal(await cache.get('response'), null);
});
