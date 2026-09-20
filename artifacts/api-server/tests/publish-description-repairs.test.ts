import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';

let built = true, purgeSuccess = true, manifestMissing = false;
let cleared: string[], batches: string[][], checks: number, cancelled: boolean;
mock.module(new URL('../src/cache.ts', import.meta.url).href, { defaultExport: {
  clearByPattern: async (pattern: string) => { cleared.push(pattern); },
} });
mock.module(new URL('../src/seo/sitemap-manifest-builder.ts', import.meta.url).href, { namedExports: {
  buildAllSitemapManifests: async (options: any) => { assert.deepEqual(options, {force: true}); return {built, qualifiedLanguages: ['en', 'de']}; },
  getActiveManifest: async () => manifestMissing ? null : {chunkCount: 20},
} });
mock.module(new URL('../src/services/scheduled-cache-clear.ts', import.meta.url).href, { namedExports: {
  scheduledCacheClearService: { purgeCloudflareUrls: async (urls: string[]) => { batches.push(urls); return {success: purgeSuccess, message: 'Mock edge purge failure'}; } },
} });
const {publishDescriptionRepairs} = await import('../src/services/publish-description-repairs');
beforeEach(() => { built = true; purgeSuccess = true; manifestMissing = false; cleared = []; batches = []; checks = 0; cancelled = false; });
const assertActive = () => { checks++; if (cancelled) throw new Error('Job cancelled'); };

test('publishing rebuilds first, clears XML caches and purges actual language/chunk URLs in batches of thirty', async () => {
  await publishDescriptionRepairs(assertActive);
  assert.deepEqual(cleared, ['admin_stations:', 'sitemap:', 'precomputed_']);
  assert.deepEqual(batches.map(batch => batch.length), [30, 16]);
  assert.equal(new Set(batches.flat()).size, 46);
  assert.ok(batches.flat().some(url => url.endsWith('/sitemap-stations-de-20.xml')));
  assert.ok(checks >= 7);
});
test('failed or busy rebuild never reports successful publishing or purges stale XML', async () => {
  built = false;
  await assert.rejects(publishDescriptionRepairs(assertActive), /unavailable or already running/);
  assert.deepEqual(cleared, []); assert.deepEqual(batches, []);
});
test('failed edge purge is observable after the manifest and runtime XML refresh', async () => {
  purgeSuccess = false;
  await assert.rejects(publishDescriptionRepairs(assertActive), /edge purge failure/);
  assert.deepEqual(cleared, ['admin_stations:', 'sitemap:', 'precomputed_']); assert.equal(batches.length, 1);
});
test('missing manifest or cancellation cannot claim a fully published result', async () => {
  manifestMissing = true;
  await assert.rejects(publishDescriptionRepairs(assertActive), /sitemap is unavailable/);
  assert.equal(batches.length, 0);
  cancelled = true;
  await assert.rejects(publishDescriptionRepairs(assertActive), /cancelled/);
});
