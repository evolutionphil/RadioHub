import assert from 'node:assert/strict';
import { after, beforeEach, mock, test } from 'node:test';
import { PostgresCatalogStore } from '../src/data/postgres-catalog-store';
import { stationListVisibleSql } from '../src/utils/station-visibility';

// Exercise the production catalog SQL compiler and real SWR/singleflight cache;
// the query transport is deterministic, in-memory and cannot contact a DB.
delete process.env.REDIS_URL;
const queries: Array<{ sql: string; values: any[] }> = [];
let rows: Record<string, any>[] = [];
let failure: 'count' | 'find' | null = null;
let pause: Promise<void> | undefined;
const catalog = new PostgresCatalogStore({ query: async (sql: string, values: any[]) => {
  queries.push({ sql, values });
  if (pause) await pause;
  const count = sql.startsWith('SELECT count(*)');
  if (failure === (count ? 'count' : 'find')) throw new Error('Database unavailable');
  assert.ok(sql.includes(`${stationListVisibleSql()} = $2::boolean`));
  assert.equal(values[1], true);
  const matches = rows.filter(row => row.is_list_visible === true && (
    sql.includes('s.country ~*') ? new RegExp(values[0], 'i').test(row.country) : row.country === values[0]
  ));
  if (count) return { rows: [{ count: String(matches.length) }] };
  assert.match(sql, /ORDER BY s.has_logo DESC NULLS LAST,s.votes DESC NULLS LAST,s.id ASC NULLS LAST/);
  assert.doesNotMatch(sql, /s\.\*|s\.source|s\.descriptions/);
  const selected = matches.sort((a, b) => Number(b.has_logo) - Number(a.has_logo) || b.votes - a.votes || a.id.localeCompare(b.id));
  const limit = values[2], offset = values[3] || 0;
  const columns = sql.slice('SELECT '.length, sql.indexOf(' FROM stations')).split(',').map(value => value.trim().replace(/^s\./, ''));
  return { rows: selected.slice(offset, offset + limit).map(row => Object.fromEntries(columns.map(column => [column, row[column]]))) };
} } as any);
catalog.groupCount = async () => [{ _id: 'Germany', count: 3061 }, { _id: 'Austria', count: 1 }];
catalog.findOne = async () => null;
mock.module('../src/data/postgres-catalog-store', { namedExports: { pgCatalog: () => catalog } });
mock.module('../src/utils/logger', { namedExports: { logger: { log() {}, warn() {}, error() {} } } });
const { CacheManager: rawCache } = await import('../src/cache');
const { publicStationCache: CacheManager, publicStationCacheKey } = await import('../src/public-station-cache');
const { PrecomputedStationsService } = await import('../src/services/precomputed-stations');
const prefix = 'precomputed_stations:catalog:v1:';

function fixture() {
  return Array.from({ length: 3061 }, (_, index) => ({ id: `radio-${String(index).padStart(5, '0')}`,
    slug: `station-${index}`, name: `Station ${index}`, country: 'Germany', last_check_ok: true, is_list_visible: true,
    has_logo: true, votes: 10, url: 'https://example.invalid/live', url_resolved: 'https://example.invalid/resolved',
    no_index: index === 0, source: { unrelated: 'not selected' }, descriptions: { en: { full: 'not selected' } },
  }));
}
beforeEach(async () => {
  await CacheManager.clearByPattern('precomputed_stations:');
  (PrecomputedStationsService as any).allCountries = [];
  (PrecomputedStationsService as any).resolvedCache.clear();
  rows = fixture(); queries.length = 0; failure = null; pause = undefined;
});
after(async () => { await CacheManager.clearByPattern('precomputed_stations:'); });

test('country page51 reads beyond the popular3000 cap and reports the full native count', async () => {
  const page = await PrecomputedStationsService.getCountryStationsByName('Germany', 51, 60);
  assert.equal(page.total, 3061);
  assert.equal(page.totalPages, 52);
  assert.equal(page.page, 51);
  assert.equal(page.stations.length, 60);
  assert.equal(page.stations[0]._id, 'radio-03000');
  assert.equal(page.stations.at(-1)?._id, 'radio-03059');
  assert.equal(page.stations[0].url_resolved, 'https://example.invalid/resolved');
  assert.deepEqual(queries.at(-1)?.values, ['Germany', true, 60, 3000]);
  const last = await PrecomputedStationsService.getCountryStationsByName('Germany', 52, 60);
  assert.equal(last.stations.length, 1);
  assert.equal(last.stations[0]._id, 'radio-03060');
});

test('country, page and limit isolate warm cache entries; concurrent identical reads singleflight', async () => {
  let release!: () => void;
  pause = new Promise<void>(resolve => { release = resolve; });
  const pending = Array.from({ length: 8 }, () => PrecomputedStationsService.getCountryStationsByName('Germany', 51, 60));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(queries.length, 1, 'one in-flight native count');
  release();
  const results = await Promise.all(pending);
  assert.ok(results.every(result => result.stations[0]._id === 'radio-03000'));
  assert.equal(queries.length, 2, 'one count and one bounded page read');
  const warm = await PrecomputedStationsService.getCountryStationsByName('germany', 51, 60);
  assert.equal(warm.cached, true);
  assert.equal(queries.length, 2);
  await PrecomputedStationsService.getCountryStationsByName('Germany', 50, 60);
  await PrecomputedStationsService.getCountryStationsByName('Germany', 51, 30);
  await PrecomputedStationsService.getCountryStationsByName('Austria', 51, 60);
  assert.ok(await CacheManager.getSWR(`${prefix}Germany:51:60`));
  assert.ok(await CacheManager.getSWR(`${prefix}Germany:50:60`));
  assert.ok(await CacheManager.getSWR(`${prefix}Germany:51:30`));
  assert.ok(await CacheManager.getSWR(`${prefix}Austria:51:60`));
});

test('known empty and past-end catalogues are successful, and huge pages never issue OFFSET', async () => {
  const absent = await PrecomputedStationsService.getCountryStationsByName('Austria', 2, 60);
  assert.equal(absent.total, 0); assert.equal(absent.totalPages, 0); assert.deepEqual(absent.stations, []);
  const past = await PrecomputedStationsService.getCountryStationsByName('Germany', 999999, 60);
  assert.equal(past.total, 3061); assert.equal(past.totalPages, 52); assert.deepEqual(past.stations, []);
  assert.ok(queries.every(query => query.sql.startsWith('SELECT count(*)')));
});

for (const phase of ['count', 'find'] as const) {
  test(`${phase} failure propagates, never caches empty success, and a later attempt recovers`, async () => {
    failure = phase;
    await assert.rejects(PrecomputedStationsService.getCountryStationsByName('Germany', 51, 60), /Database unavailable/);
    assert.equal(await CacheManager.getSWR(`${prefix}Germany:51:60`), null);
    failure = null;
    const recovered = await PrecomputedStationsService.getCountryStationsByName('Germany', 51, 60);
    assert.equal(recovered.stations.length, 60);
  });
}

test('expired health data cannot survive a failed refresh', async () => {
  const good = await PrecomputedStationsService.getCountryStationsByName('Germany', 51, 60);
  const key = `${prefix}Germany:51:60`;
  const data = await CacheManager.getSWR(key);
  await rawCache.set(publicStationCacheKey(`${key}:swr`), { value: data, expiresAt: Date.now() - 1000 }, { ttl: 300 });
  failure = 'find';
  await assert.rejects(PrecomputedStationsService.getCountryStationsByName('Germany', 51, 60), /Database unavailable/);
  assert.equal(await CacheManager.getSWR(key), null);
});

test('hasLogo/votes order keeps deterministic ID ties and supplies existing renderer filter flags', async () => {
  rows = [
    { ...rows[2], votes: 99 }, { ...rows[1], votes: 99 }, { ...rows[0], has_logo: false, votes: 999 },
    { ...rows[3], last_check_ok: false, is_list_visible: false },
  ];
  const page = await PrecomputedStationsService.getCountryStationsByName('Germany', 1, 60);
  assert.deepEqual(page.stations.map(station => station._id), ['radio-00001', 'radio-00002', 'radio-00000']);
  assert.equal(page.total, 3);
  assert.equal((page.stations[2] as any).noIndex, true, 'renderer retains ownership of noIndex/junk filtering');
  assert.ok(page.stations.every(station => (station as any).lastCheckOk === true));
  assert.ok(page.stations.every(station => !('source' in station) && !('descriptions' in station)));
});

test('case-insensitive fallback escapes the exact country and uses the same filter for count/page', async () => {
  rows = [{ ...rows[0], country: 'Case (Land)+' }, { ...rows[1], country: 'Case Landdddd' }];
  const page = await PrecomputedStationsService.getCountryStationsByName('case (land)+', 1, 60);
  assert.equal(page.total, 1); assert.equal(page.stations.length, 1);
  assert.equal(queries[1].values[0], '^case \\(land\\)\\+$');
  assert.equal(queries[1].values[0], queries[2].values[0]);
});

test('rejects unsafe page/limit inputs before SQL or cache lookup', async () => {
  for (const [page, limit] of [[0, 60], [-1, 60], [1.5, 60], [NaN, 60], [Infinity, 60],
    [1, 0], [1, -1], [1, 1.5], [1, 201], [1, NaN], [1, Infinity], [Number.MAX_SAFE_INTEGER, 200]]) {
    await assert.rejects(PrecomputedStationsService.getCountryStationsByName('Germany', page, limit), RangeError);
  }
  assert.equal(queries.length, 0);
});
