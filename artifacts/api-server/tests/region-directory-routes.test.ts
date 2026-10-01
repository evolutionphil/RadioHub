import assert from 'node:assert/strict';
import { before, beforeEach, mock, test } from 'node:test';
import type { Express } from 'express';

const handlers = new Map<string, (req: any, res: any) => unknown>();
let countryFailure = false;
let cityFailure = false;
let cacheFailure = false;
let stale: any = null;
let countryCalls = 0;
let cityCalls = 0;
let countryCounts = [{ _id: 'Germany', count: 12 }, { _id: 'France', count: 4 }];
let cityCounts = { cities: [{ name: 'Berlin', stationCount: 3 }], unassigned: 2 };

mock.module('../src/data/postgres-catalog-store', { namedExports: { pgCatalog: () => ({
  groupCount: async () => {
    countryCalls++;
    if (countryFailure) throw new Error('Database unavailable');
    return countryCounts;
  },
}) } });
mock.module('../src/data/postgres-discovery-operations', { namedExports: {
  pgCityCounts: async () => {
    cityCalls++;
    if (cityFailure) throw new Error('Database unavailable');
    return cityCounts;
  },
  pgGlobalCityCounts: async () => [], pgDiverseStations: async () => [],
} });
mock.module('../src/public-station-cache', { namedExports: { publicStationCache: {
  getOrSetSingleFlight: async (_key: string, load: () => Promise<unknown>) => load(),
  get: async () => {
    if (cacheFailure) throw new Error('Cache unavailable');
    return stale;
  },
} } });
mock.module('../src/data/postgres-maintenance-store', { namedExports: {
  pgStartMaintenanceJob: async () => ({}), pgMaintenanceJobs: async () => [], pgSaveMaintenanceJob: async () => {},
} });
mock.module('../src/utils/logger', { namedExports: { logger: { log() {}, error() {}, warn() {} } } });
mock.module('../src/utils/safe-fetch', { namedExports: { safeFetch: async () => {}, INTERNAL_SERVICE_PORTS: [] } });
mock.module('../src/services/recommendation-pool', { namedExports: {
  getRecommendationPool: async () => ({}), recommendationPoolScope: () => ({}),
} });

before(async () => {
  const { registerRegionsRecommendationsRoutes } = await import('../src/routes/regions-recommendations-routes');
  registerRegionsRecommendationsRoutes({
    use() {}, post() {},
    get(path: string, ...middleware: any[]) { handlers.set(path, middleware[middleware.length - 1]); },
  } as unknown as Express, { requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next() });
});
beforeEach(() => {
  countryFailure = cityFailure = cacheFailure = false;
  stale = null; countryCalls = cityCalls = 0;
  countryCounts = [{ _id: 'Germany', count: 12 }, { _id: 'France', count: 4 }];
  cityCounts = { cities: [{ name: 'Berlin', stationCount: 3 }], unassigned: 2 };
});

class Response {
  statusCode = 200;
  headers = new Map<string, string>([['cache-control', 'no-cache, max-age=0, must-revalidate']]);
  body: any;
  status(code: number) { this.statusCode = code; return this; }
  set(field: string | Record<string, string>, value?: string) {
    if (typeof field === 'string') this.headers.set(field.toLowerCase(), value!);
    else for (const [name, content] of Object.entries(field)) this.headers.set(name.toLowerCase(), content);
    return this;
  }
  json(body: any) { this.body = body; return this; }
}
async function call(path: string, params: Record<string, string> = {}) {
  const response = new Response();
  await handlers.get(path)!({ params, query: {} }, response);
  return response;
}
function assertRetryable(response: Response) {
  assert.equal(response.statusCode, 503);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('retry-after'), '30');
  assert.equal(response.body.success, false);
  assert.equal(typeof response.body.error, 'string');
  assert.equal(response.body.data, undefined, 'Never misrepresent an outage as a successful empty catalogue');
}
const countryPath = '/api/regions/:regionSlug/:countrySlug';
const params = { regionSlug: 'europe', countrySlug: 'germany' };
function knownGood() { return { success: true, data: {
  region: { name: 'Europe', slug: 'europe' }, country: { name: 'Germany', slug: 'germany' },
  cities: [{ name: 'Berlin', slug: 'berlin', stationCount: 3 }],
} }; }

test('region index, country counts, and city lists preserve their normal contracts', async () => {
  const index = await call('/api/regions');
  assert.equal(index.statusCode, 200);
  assert.equal(index.body.success, true);
  assert.equal(index.body.data.length, 6);
  const countries = await call('/api/regions/:regionSlug', params);
  assert.equal(countries.statusCode, 200);
  assert.equal(countries.body.data.countries.find((country: any) => country.name === 'Germany').stationCount, 12);
  const cities = await call(countryPath, params);
  assert.equal(cities.statusCode, 200);
  assert.deepEqual(cities.body.data.country, knownGood().data.country);
  assert.deepEqual(cities.body.data.cities, [{ name: 'ALL', slug: 'all', stationCount: 2 }, { name: 'Berlin', slug: 'berlin', stationCount: 3 }]);
});

test('region index construction failures are retryable instead of successful empty lists', async () => {
  const response = new Response();
  const objectKeys = mock.method(Object, 'keys', () => { throw new Error('Region index unavailable'); });
  try { handlers.get('/api/regions')!({ params: {}, query: {} }, response); }
  finally { objectKeys.mock.restore(); }
  assertRetryable(response);
});

test('country count database failures return503 and recover on the next request', async () => {
  countryFailure = true;
  assertRetryable(await call('/api/regions/:regionSlug', params));
  countryFailure = false;
  const recovered = await call('/api/regions/:regionSlug', params);
  assert.equal(recovered.statusCode, 200);
  assert.equal(recovered.body.data.countries.length, 2);
});

test('city database failures without cached data return a retryable error', async () => {
  cityFailure = true;
  assertRetryable(await call(countryPath, params));
  cityFailure = false;
  assert.equal((await call(countryPath, params)).body.data.cities.length, 2);
});

test('city failures keep valid same-location stale data available without caching the outage response', async () => {
  cityFailure = true;
  stale = knownGood();
  const response = await call(countryPath, params);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, stale);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.has('retry-after'), false);
});

test('a legitimate empty city cache remains valid', async () => {
  cityFailure = true;
  stale = knownGood(); stale.data.cities = [];
  const response = await call(countryPath, params);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.data.cities, []);
});

test('malformed, synthetic, error, and wrong-location stale data cannot disguise city failures', async () => {
  cityFailure = true;
  const wrongLocation = knownGood(); wrongLocation.data.country.slug = 'france';
  const invalidCount = knownGood(); invalidCount.data.cities[0].stationCount = -1;
  for (const candidate of [
    {}, { success: false, error: 'Unavailable' }, wrongLocation, invalidCount,
    { success: true, data: { region: { name: '', slug: 'europe' }, country: { name: '', slug: 'germany' }, cities: [] } },
  ]) {
    stale = candidate;
    assertRetryable(await call(countryPath, params));
  }
});

test('an unavailable stale cache also results in a retryable city response', async () => {
  cityFailure = cacheFailure = true;
  assertRetryable(await call(countryPath, params));
});

test('unknown and inherited-property region slugs return404 before database/cache work', async () => {
  for (const regionSlug of ['unknown', '__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    for (const path of ['/api/regions/:regionSlug', countryPath]) {
      const response = await call(path, { ...params, regionSlug });
      assert.equal(response.statusCode, 404);
      assert.equal(response.body.success, false);
    }
  }
  assert.equal(countryCalls, 0);
  assert.equal(cityCalls, 0);
});

test('unknown countries remain404, not transient failures', async () => {
  const response = await call(countryPath, { ...params, countrySlug: 'unknown' });
  assert.equal(response.statusCode, 404);
  assert.equal(response.body.success, false);
  assert.equal(cityCalls, 0);
});

test('genuinely empty database counts remain successful empty directory responses', async () => {
  countryCounts = [];
  cityCounts = { cities: [], unassigned: 0 };
  const countries = await call('/api/regions/:regionSlug', params);
  assert.equal(countries.statusCode, 200);
  assert.deepEqual(countries.body.data.countries, []);
  const cities = await call(countryPath, params);
  assert.equal(cities.statusCode, 200);
  assert.deepEqual(cities.body.data.cities, []);
});
