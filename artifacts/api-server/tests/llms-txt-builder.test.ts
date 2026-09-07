import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';
import { setImmediate } from 'node:timers/promises';

let now = 1_000_000;
const calls = { countries: 0, genres: 0, languages: 0 };
let countries: () => Promise<any>;
let genres: () => Promise<any>;
let languages: () => Promise<any>;

mock.module('../src/data/postgres-seo-indexing-store', { namedExports: {
  pgTopIndexableTags: () => { calls.genres++; return genres(); },
} });
mock.module('../src/seo/sitemap-manifest-builder', { namedExports: {
  getActiveManifest: () => { calls.countries++; return countries(); },
  extractTopCountriesFromChunk: (entries: any[]) => entries,
} });
mock.module('../src/seo/qualified-languages', { namedExports: {
  getCachedQualifiedLanguages: () => { calls.languages++; return languages(); },
} });
mock.module('../src/utils/logger', { namedExports: { logger: { warn() {} } } });
const { buildLlmsTxtBody, clearLlmsTxtCache } = await import('../src/seo/llms-txt-builder');
const base = 'https://themegaradio.com';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  clearLlmsTxtCache(); now = 1_000_000;
  calls.countries = calls.genres = calls.languages = 0;
  countries = async () => ({ chunks: [{ stationIds: [{ regionSlug: 'europe', countrySlug: 'germany' }] }] });
  genres = async () => [{ _id: 'rock', count: 12 }, { _id: 'not-a-public-genre', count: 9 }];
  languages = async () => ['en', 'de', 'tr'];
  mock.method(Date, 'now', () => now);
});
afterEach(() => { clearLlmsTxtCache(); mock.restoreAll(); });

test('cold concurrent reads return a real core guide without waiting for any database source', { timeout: 1000 }, async () => {
  const pending = deferred<any>();
  countries = genres = languages = () => pending.promise;
  const bodies = await Promise.all(Array.from({ length: 100 }, () => buildLlmsTxtBody(base)));
  assert.equal(new Set(bodies).size, 1);
  assert.deepEqual(calls, { countries: 1, genres: 1, languages: 1 }, 'one shared refresh, not 100 aggregations');
  assert.match(bodies[0], /^# MegaRadio\n/);
  assert.match(bodies[0], /\[Sitemap Index\]\(https:\/\/themegaradio\.com\/sitemap-index\.xml\)/);
  assert.doesNotMatch(bodies[0], /Top genre directories|Top country directories/);
  pending.resolve([]); await setImmediate();
});

test('completed refresh supplies only measured, whitelisted optional links and qualified locales', async () => {
  const first = await buildLlmsTxtBody(base);
  assert.doesNotMatch(first, /Top genre directories/);
  await setImmediate();
  const enriched = await buildLlmsTxtBody(base);
  assert.match(enriched, /\/en\/genres\/rock/);
  assert.match(enriched, /\/en\/regions\/europe\/germany/);
  assert.match(enriched, /\/de\/sender/);
  assert.match(enriched, /\/tr\/istasyonlar/);
  assert.doesNotMatch(enriched, /not-a-public-genre/);
  assert.deepEqual(calls, { countries: 1, genres: 1, languages: 1 });
  assert.equal(await buildLlmsTxtBody(base + '/'), enriched);
});

test('expired reads keep the complete guide available while one background refresh runs', async () => {
  await buildLlmsTxtBody(base); await setImmediate();
  const previous = await buildLlmsTxtBody(base);
  now += 6 * 60 * 60 * 1000 + 1;
  const pending = deferred<any>(); genres = () => pending.promise;
  assert.equal(await buildLlmsTxtBody(base), previous);
  assert.equal(await buildLlmsTxtBody(base), previous);
  assert.equal(calls.genres, 2);
  pending.resolve([{ _id: 'jazz', count: 15 }]); await setImmediate();
  assert.match(await buildLlmsTxtBody(base), /\/en\/genres\/jazz/);
  assert.doesNotMatch(await buildLlmsTxtBody(base), /\/en\/genres\/rock/);
});

test('failed optional sources do not fabricate a ranked whitelist sample and retry after one minute', async () => {
  countries = genres = languages = async () => { throw new Error('database unavailable'); };
  const core = await buildLlmsTxtBody(base); await setImmediate();
  assert.equal(await buildLlmsTxtBody(base), core);
  assert.doesNotMatch(core, /Top genre directories|Top country directories|\/en\/genres\/pop/);
  assert.equal(calls.genres, 1);
  now += 60_001;
  countries = async () => null;
  languages = async () => ['en'];
  genres = async () => [{ _id: 'jazz', count: 12 }];
  await buildLlmsTxtBody(base); await setImmediate();
  assert.equal(calls.genres, 2);
  assert.match(await buildLlmsTxtBody(base), /\/en\/genres\/jazz/);
});

test('failed stale refresh retains the last verified guide instead of erasing its optional links', async () => {
  await buildLlmsTxtBody(base); await setImmediate();
  const previous = await buildLlmsTxtBody(base);
  now += 6 * 60 * 60 * 1000 + 1;
  genres = async () => { throw new Error('database unavailable'); };
  await buildLlmsTxtBody(base); await setImmediate();
  assert.equal(await buildLlmsTxtBody(base), previous);
  assert.equal(calls.genres, 2);
});

test('clearing the cache prevents an old in-flight refresh from republishing obsolete results', async () => {
  const pending = deferred<any>(); genres = () => pending.promise;
  await buildLlmsTxtBody(base);
  clearLlmsTxtCache();
  genres = async () => [{ _id: 'jazz', count: 12 }];
  await buildLlmsTxtBody(base); await setImmediate();
  pending.resolve([{ _id: 'rock', count: 20 }]); await setImmediate();
  const body = await buildLlmsTxtBody(base);
  assert.match(body, /\/en\/genres\/jazz/);
  assert.doesNotMatch(body, /\/en\/genres\/rock/);
});

test('guide uses current supported locale scope and real homepage link, without unverified quotas or refresh guarantees', async () => {
  languages = async () => ['en', 'de', 'af', 'xx'];
  await buildLlmsTxtBody(base); await setImmediate();
  const body = await buildLlmsTxtBody(base);
  assert.match(body, /14 supported languages/);
  assert.match(body, /\[Popular Stations\]\(https:\/\/themegaradio\.com\/en\)/);
  assert.doesNotMatch(body, /57 languages|Top 100|\/en\/popular|1,000 requests|updated daily|verified stream|\/af\/|\/xx\//);
});
