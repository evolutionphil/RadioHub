import assert from 'node:assert/strict';
import { after, before, beforeEach, mock, test } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';

const stations = [
  { _id: 'berlin-jazz', name: 'Berlin Jazz 90.5', country: 'Germany', tags: 'jazz', votes: 30, isListVisible: true },
  { _id: 'national-news', name: 'National News', country: 'Germany', tags: 'talk', genre: 'classical', votes: 20, isListVisible: true },
  { _id: 'paris-jazz', name: 'Paris Jazz 90.5', country: 'France', tags: 'jazz', votes: 40, isListVisible: true },
  { _id: 'berlin-pop', name: 'Berlin Pop 9015', country: 'Germany', tags: 'pop', votes: 10, isListVisible: true },
  { _id: 'hidden', name: 'Berlin Jazz Archive', country: 'Germany', tags: 'jazz', votes: 50, isListVisible: false },
];
type Station = typeof stations[number];
type Filter = Record<string, any>;
const cache = new Map<string, unknown>();
const calls: Array<{ filter: Filter; options: any }> = [];
let unavailable = false;

function matches(station: Station, filter: Filter): boolean {
  return Object.entries(filter).every(([field, value]) => {
    if (field === '$and') return value.every((child: Filter) => matches(station, child));
    if (field === '$or') return value.some((child: Filter) => matches(station, child));
    const actual = station[field as keyof Station];
    if (value && typeof value === 'object') {
      if ('$not' in value) return !matches(station, { [field]: value.$not });
      if ('$regex' in value) {
        const pattern = value.$regex instanceof RegExp ? value.$regex : new RegExp(value.$regex, value.$options);
        return actual != null && pattern.test(String(actual));
      }
    }
    return actual === value;
  });
}

mock.module('../src/data/postgres-catalog-store', { namedExports: { pgCatalog: () => ({
  find: async (filter: Filter, options: any) => {
    calls.push({ filter, options });
    if (unavailable) throw new Error('Catalogue unavailable');
    const selected = stations.filter((station) => matches(station, filter));
    selected.sort((a, b) => {
      for (const [field, direction] of Object.entries(options.sort)) {
        const left = a[field as keyof Station];
        const right = b[field as keyof Station];
        const comparison = typeof left === 'string'
          ? left.localeCompare(String(right))
          : Number(left) - Number(right);
        if (comparison) return comparison * Number(direction);
      }
      return 0;
    });
    return selected.slice(options.offset, options.offset + options.limit);
  },
  count: async (filter: Filter) => stations.filter((station) => matches(station, filter)).length,
}) } });
mock.module('../src/public-station-cache', { namedExports: { publicStationCache: {
  getOrSetSingleFlight: async (key: string, load: () => Promise<unknown>) => {
    if (!cache.has(key)) cache.set(key, await load());
    return cache.get(key);
  },
} } });
mock.module('../src/data/postgres-discovery-operations', { namedExports: {
  pgCityCounts: async () => ({}), pgGlobalCityCounts: async () => [], pgDiverseStations: async () => [],
} });
mock.module('../src/data/postgres-maintenance-store', { namedExports: {
  pgStartMaintenanceJob: async () => ({}), pgMaintenanceJobs: async () => [], pgSaveMaintenanceJob: async () => {},
} });
mock.module('../src/utils/logger', { namedExports: { logger: { log() {}, error() {}, warn() {} } } });
mock.module('../src/utils/safe-fetch', { namedExports: { safeFetch: async () => {}, INTERNAL_SERVICE_PORTS: [] } });
mock.module('../src/services/recommendation-pool', { namedExports: {
  getRecommendationPool: async () => ({}), recommendationPoolScope: () => ({}),
} });

let server: Server;
let baseUrl: string;
before(async () => {
  const { registerRegionsRecommendationsRoutes } = await import('../src/routes/regions-recommendations-routes');
  const app = express();
  registerRegionsRecommendationsRoutes(app, { requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next() });
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
beforeEach(() => { calls.length = 0; cache.clear(); unavailable = false; });
after(async () => { if (server) await new Promise<void>((resolve) => server.close(() => resolve())); });

async function getStations(suffix = '?limit=1') {
  const response = await fetch(`${baseUrl}/api/regions/europe/germany${suffix}`);
  assert.equal(response.status, 200);
  return (await response.json()).data;
}

test('country stations expose location and pagination while retaining the legacy flat response fields', async () => {
  const data = await getStations('/stations?limit=1&offset=1');
  assert.deepEqual(data.region, { name: 'Europe', slug: 'europe' });
  assert.deepEqual(data.country, { name: 'Germany', slug: 'germany' });
  assert.equal(data.city, undefined);
  assert.deepEqual(data.pagination, { total: 3, limit: 1, offset: 1, hasMore: true });
  assert.equal(data.stations[0]._id, 'national-news');
  assert.equal(data.total, 3);
  assert.equal(data.limit, 1);
  assert.equal(data.offset, 1);
  assert.equal(data.countryName, 'Germany');
  assert.equal(data.cityName, null);
  assert.deepEqual(calls[0].options.sort, { votes: -1, _id: 1 });
  const lastPage = await getStations('/stations?limit=1&offset=2');
  assert.equal(lastPage.pagination.hasMore, false);
});

test('city and all-stations URLs retain their location filters and describe their location', async () => {
  const city = await getStations('/berlin/stations');
  assert.deepEqual(city.city, { name: 'Berlin', slug: 'berlin' });
  assert.equal(city.cityName, 'Berlin');
  assert.deepEqual(city.stations.map((station: Station) => station._id), ['berlin-jazz', 'berlin-pop']);
  const unassigned = await getStations('/all/stations');
  assert.deepEqual(unassigned.city, { name: 'ALL', slug: 'all' });
  assert.equal(unassigned.cityName, null, 'Keep the existing flat field for old consumers');
  assert.deepEqual(unassigned.stations.map((station: Station) => station._id), ['national-news']);
});

test('search covers the full location catalogue and uses separate cached pages for each term', async () => {
  await getStations('/stations?limit=1');
  const news = await getStations('/stations?limit=1&search=News');
  assert.equal(news.total, 1);
  assert.equal(news.stations[0]._id, 'national-news');
  const byTags = await getStations('/stations?limit=1&search=jazz');
  assert.equal(byTags.total, 1, 'Exclude other countries and stations hidden from public lists');
  assert.equal(byTags.stations[0]._id, 'berlin-jazz');
  const byGenre = await getStations('/stations?limit=1&search=classical');
  assert.equal(byGenre.stations[0]._id, 'national-news');
  await getStations('/stations?limit=1&search=News');
  assert.equal(calls.length, 4, 'Repeating a term should reuse only that term’s cached page');
});

test('city search treats regex punctuation literally and combines with the city restriction', async () => {
  const literal = await getStations('/berlin/stations?search=90.5');
  assert.deepEqual(literal.stations.map((station: Station) => station._id), ['berlin-jazz']);
  assert.equal(literal.pagination.total, 1);
  const outsideCity = await getStations('/berlin/stations?search=News');
  assert.deepEqual(outsideCity.stations, []);
  assert.equal(outsideCity.pagination.total, 0);
});

test('pagination and search inputs are bounded before catalogue access', async () => {
  const data = await getStations(`/stations?limit=999999&offset=-9&sortBy=unknown&search=${'a'.repeat(300)}`);
  assert.equal(data.limit, 500);
  assert.equal(data.offset, 0);
  assert.equal(calls[0].filter.$and[0].$or[0].name.$regex.length, 200);
  assert.deepEqual(calls[0].options.sort, { votes: -1, _id: 1 });
  const repeated = await getStations('/stations?search=News&search=Jazz&offset=99999999');
  assert.equal(repeated.offset, 1000000);
  assert.equal(calls[1].filter.$and, undefined, 'Do not stringify arrays or objects into searches');
});

test('invalid locations return 404 and do not query the catalogue', async () => {
  for (const path of [
    'unknown/germany/stations', 'europe/unknown/stations', 'europe/germany/unknown/stations',
    '__proto__/germany/stations', 'constructor/germany/stations', 'toString/germany/stations',
  ]) {
    const response = await fetch(`${baseUrl}/api/regions/${path}`);
    assert.equal(response.status, 404);
    assert.equal((await response.json()).success, false);
  }
  assert.equal(calls.length, 0);
});

test('temporary catalogue failure returns a retryable error instead of reporting an empty catalogue', async () => {
  unavailable = true;
  for (const suffix of ['/stations', '/berlin/stations']) {
    const response = await fetch(`${baseUrl}/api/regions/europe/germany${suffix}`);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('retry-after'), '30');
    assert.deepEqual(await response.json(), {
      success: false,
      error: 'Station data is temporarily unavailable',
    });
  }
  assert.equal(cache.size, 0, 'Failed loads must not be cached as empty pages');
  unavailable = false;
  const recovered = await getStations('/stations');
  assert.equal(recovered.total, 3, 'A retry after recovery should return real stations');
});
