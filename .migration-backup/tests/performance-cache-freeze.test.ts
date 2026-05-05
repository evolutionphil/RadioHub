/**
 * Regression test for performance-cache mutation safety.
 *
 * Every cache in `server/performance-cache.ts` runs with `useClones: false`
 * for performance, so consumers receive shared references. Without freezing,
 * a single rogue mutation (e.g. `seoData.seoTags.domain = ...`) would corrupt
 * the cached value for every other request.
 *
 * Two protections are exercised here:
 *   1. deepFreeze() — applied to plain objects/arrays on write.
 *   2. createReadOnlyMap() — wraps Map<string,string> values returned by
 *      getCountryLanguageMappings() / getUrlTranslations() so that
 *      Map.set/delete/clear throw, since Object.freeze cannot protect Map
 *      internals.
 *
 * Run with:  npx tsx tests/performance-cache-freeze.test.ts
 */
import assert from 'node:assert/strict';
import { deepFreeze, performanceCache } from '../server/performance-cache';

let failures = 0;
async function check(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ✔ ${name}`);
  } catch (err: any) {
    failures++;
    console.error(`  ✘ ${name}\n    ${err?.message || err}`);
  }
}

async function run() {
  console.log('performance-cache freeze regression');

  await check('top-level property mutation throws', () => {
    const seoTags = deepFreeze({ domain: 'a', canonical: 'b' });
    assert.throws(() => {
      (seoTags as any).domain = 'mutated';
    }, TypeError);
    assert.equal(seoTags.domain, 'a');
  });

  await check('nested property mutation throws', () => {
    const pageData = deepFreeze({ seoTags: { canonical: 'orig' }, station: { name: 'x' } });
    assert.throws(() => {
      (pageData.seoTags as any).canonical = 'mutated';
    }, TypeError);
    assert.throws(() => {
      (pageData.station as any).name = 'changed';
    }, TypeError);
  });

  await check('array push throws', () => {
    const stations = deepFreeze([{ id: 1 }, { id: 2 }]);
    assert.throws(() => {
      (stations as any).push({ id: 3 });
    }, TypeError);
    assert.throws(() => {
      (stations[0] as any).id = 99;
    }, TypeError);
  });

  await check('handles cyclic references', () => {
    const a: any = { name: 'a' };
    a.self = a;
    deepFreeze(a);
    assert.ok(Object.isFrozen(a));
    assert.throws(() => { a.name = 'b'; }, TypeError);
  });

  await check('skips Map (Object.freeze cannot protect Map internals)', () => {
    const m = new Map<string, string>([['k', 'v']]);
    deepFreeze(m);
    // Map is intentionally left mutable by deepFreeze — Map values must be
    // protected via createReadOnlyMap (covered below).
    assert.equal(Object.isFrozen(m), false);
  });

  await check('idempotent on already-frozen values', () => {
    const obj = Object.freeze({ a: 1 });
    const out = deepFreeze(obj);
    assert.equal(out, obj);
  });

  await check('eviction-retry path also freezes (cache-full code branch)', async () => {
    // Fill quickCache (maxKeys=300) past capacity to force the ECACHEFULL retry.
    for (let i = 0; i < 320; i++) {
      performanceCache.setQuick(`__freezetest__:${i}`, { i, nested: { v: i } });
    }
    // The most recent entry must still be frozen, even though it likely went
    // through the eviction-retry branch.
    const recent = performanceCache.getQuick('__freezetest__:319') as any;
    assert.ok(recent, 'recent eviction-retry value should be cached');
    assert.throws(() => { recent.nested.v = -1; }, TypeError);
  });

  await check('SafeSet behavior: cached value cannot be mutated by consumer', async () => {
    performanceCache.setPageData('/__test__/freeze', { seoTags: { domain: 'orig' }, list: [1, 2] });
    const cached = performanceCache.getPageData('/__test__/freeze') as any;
    assert.ok(cached, 'cached value should be returned');
    assert.throws(() => { cached.seoTags.domain = 'pwn'; }, TypeError);
    assert.throws(() => { cached.list.push(3); }, TypeError);
    // Re-read to confirm nothing changed.
    const cached2 = performanceCache.getPageData('/__test__/freeze') as any;
    assert.equal(cached2.seoTags.domain, 'orig');
    assert.equal(cached2.list.length, 2);
  });

  // ---- Map read-only wrapper coverage ----

  const cacheAny = performanceCache as any;
  const createReadOnlyMap = (performanceCache.constructor as any).createReadOnlyMap;

  await check('createReadOnlyMap: read methods still work', () => {
    const src = new Map<string, string>([['us', 'en'], ['de', 'de']]);
    const ro = createReadOnlyMap(src);
    assert.equal(ro.get('us'), 'en');
    assert.equal(ro.size, 2);
    assert.equal(ro.has('de'), true);
    const keys: string[] = [];
    for (const [k] of ro) keys.push(k);
    assert.equal(keys.length, 2);
  });

  await check('createReadOnlyMap: set/delete/clear throw', () => {
    const ro = createReadOnlyMap(new Map<string, string>([['us', 'en']]));
    assert.throws(() => ro.set('fr', 'fr'), TypeError);
    assert.throws(() => ro.delete('us'), TypeError);
    assert.throws(() => ro.clear(), TypeError);
  });

  await check('createReadOnlyMap: failed writes do not mutate source', () => {
    const src = new Map<string, string>([['us', 'en']]);
    const ro = createReadOnlyMap(src);
    try { ro.set('fr', 'fr'); } catch {}
    try { ro.delete('us'); } catch {}
    assert.equal(src.size, 1);
    assert.equal(src.get('us'), 'en');
  });

  await check('getCountryLanguageMappings returns a read-only Map', async () => {
    const seeded = createReadOnlyMap(new Map<string, string>([['us', 'en']]));
    cacheAny.quickCache.set('country_language_mappings', seeded);
    const c = await performanceCache.getCountryLanguageMappings();
    assert.equal(c.get('us'), 'en');
    assert.throws(() => c.set('xx', 'xx'), TypeError);
    assert.throws(() => c.delete('us'), TypeError);
  });

  await check('getUrlTranslations returns a read-only Map', async () => {
    const seeded = createReadOnlyMap(new Map<string, string>([['en:/about', '/about']]));
    cacheAny.quickCache.set('url_translations', seeded);
    const u = await performanceCache.getUrlTranslations();
    assert.equal(u.get('en:/about'), '/about');
    assert.throws(() => u.set('fr:/about', '/a-propos'), TypeError);
    assert.throws(() => u.delete('en:/about'), TypeError);
  });
}

run().then(() => {
  if (failures > 0) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
  } else {
    console.log('\nAll freeze regression checks passed.');
    process.exit(0);
  }
}).catch((err) => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
