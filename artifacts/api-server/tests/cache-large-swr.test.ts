import assert from 'node:assert/strict';
import { test } from 'node:test';

test('without Redis large SWR values survive subsequent callers and invalidate across tiers', async () => {
  delete process.env.REDIS_URL;
  const { CacheManager } = await import('../src/cache');
  const payload = { stations: 'x'.repeat(300_000) };
  let calls=0;
  const load=async () => { calls++; return payload; };
  const options={freshTtl:3600,staleTtl:86400};
  try {
    const results=await Promise.all(Array.from({length:8},()=>CacheManager.getOrSetSWR('large-test',load,options)));
    assert.ok(results.every(result => result===payload));
    assert.equal(await CacheManager.getOrSetSWR('large-test',load,options),payload);
    assert.equal(calls,1);
    assert.equal(CacheManager.needsRefresh('large-test:swr',60),false);
    await CacheManager.delSWR('large-test');
    assert.equal(await CacheManager.getSWR('large-test'),null);
    await CacheManager.set('large-test', 'small');
    await CacheManager.set('large-test', payload);
    assert.equal(await CacheManager.get('large-test'),payload);
    await CacheManager.set('large-test','small-again');
    assert.equal(await CacheManager.get('large-test'),'small-again');
    await CacheManager.set('large-test',payload);
    await CacheManager.clearByPattern('large-test');
    assert.equal(await CacheManager.get('large-test'),null);
  } finally { await CacheManager.clearByPattern('large-test'); }
});
