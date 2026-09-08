import assert from 'node:assert/strict';
import { after, before, beforeEach, it, mock } from 'node:test';
import type { Server } from 'node:http';
import express from 'express';

// Real HTTP handlers; isolated storage/cache boundaries. The matching real-PG
// regression lives in postgres-public-catalog.test.ts.
const cache = new Map<string, any>();
let lookupCalls = 0, failLookup = false, missing = false;
let listingCalls: any[] = [];
const members = [
  { _id: 'jazz-a', country: 'Austria' },
  { _id: 'jazz-b', country: 'Austria' },
  { _id: 'jazz-c', country: 'Germany' },
];
const manager = {
  get: async (key: string) => cache.get(key),
  set: async (key: string, value: unknown) => { cache.set(key, value); },
  getOrSetSingleFlight: async (key: string, compute: () => Promise<unknown>) => {
    if (cache.has(key)) return cache.get(key);
    const result = await compute(); cache.set(key, result); return result;
  },
};
mock.module('../src/cache', { defaultExport: manager, namedExports: { CacheKeys: { genres: () => '' } } });
mock.module('../src/data/postgres-taxonomy-store', { namedExports: {
  pgGenreBySlug: async () => {
    lookupCalls++;
    if (failLookup) throw new Error('Isolated taxonomy outage');
    return missing ? null : { name: 'Jazz Music', slug: 'jazz', stationCount: 3 };
  },
  pgCountryCounts: async () => [], pgDiscoverableGenres: async () => [], pgPublicGenres: async () => [],
  pgStoredGenreBySlug: async () => null, pgCreateGenre: async () => null, pgUpdateGenre: async () => null, pgDeleteGenre: async () => null,
} });
mock.module('../src/data/station-read-store', { namedExports: { listStationsFromPostgres: async (options: any) => {
  listingCalls.push(options);
  const matches = options.genre === 'jazz' ? members.filter(member => !options.country || options.country === member.country) : [];
  return { stations: matches.slice((options.page - 1) * options.limit, options.page * options.limit), totalCount: matches.length,
    pagination: { page: options.page, limit: options.limit, total: matches.length, pages: Math.ceil(matches.length / options.limit) } };
} } });
mock.module('../src/seo/genre-whitelist-store', { namedExports: { getMergedWhitelist: () => new Set() } });
mock.module('../src/services/recommendation-engine', { namedExports: { RecommendationEngine: {} } });
mock.module('../src/services/precomputed-genres', { namedExports: { PrecomputedGenresService: {} } });
mock.module('../src/routes/shared-utils', { namedExports: { tvSlimGenre: (value: unknown) => value, tvValidateParams: () => ({ page: 1, limit: 9 }) } });
const { registerGenresCountriesRoutes } = await import('../src/routes/genres-countries-routes');
let server: Server, base: string;
before(async () => {
  const app = express(); registerGenresCountriesRoutes(app, { requireAdmin: (_req: unknown, res: any) => res.sendStatus(401) });
  server = await new Promise(resolve => { const running = app.listen(0, '127.0.0.1', () => resolve(running)); });
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); mock.restoreAll(); });
beforeEach(() => { cache.clear(); listingCalls = []; lookupCalls = 0; failLookup = false; missing = false; });
const request = (query = '') => fetch(base + '/api/genres/jazz/stations' + query);

it('uses the canonical genre identity while preserving the editorial name and public response shape', async () => {
  const response = await request(); assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { genre: { name: 'Jazz Music', slug: 'jazz', stationCount: 3 },
    stations: members, total: 3, page: 1, pages: 1 });
  assert.deepEqual(listingCalls, [{ genre: 'jazz', country: undefined, sort: 'votes', page: 1, limit: 20 }]);
});
it('does not reuse display-name-era empty cache entries and caches the corrected result', async () => {
  cache.set('genre-stations:jazz:all:1:20', { stations: [], total: 0 });
  assert.equal((await (await request()).json() as any).total, 3);
  assert.equal((await (await request()).json() as any).total, 3);
  assert.equal(listingCalls.length, 1);
  assert.ok(cache.has('genre-stations:slug-v2:jazz:all:1:20'));
});
it('does not reuse the old stored-count genre detail cache after membership counts become authoritative', async () => {
  cache.set('genre-slug:jazz', { name: 'Jazz Music', slug: 'jazz', stationCount: 0 });
  const response = await fetch(base + '/api/genres/slug/jazz');
  assert.equal(response.status, 200);
  const detail = await response.json() as any;
  assert.equal(detail.name, 'Jazz Music'); assert.equal(detail.stationCount, 3);
  assert.ok(cache.has('genre-slug:membership-v2:jazz'));
});
it('retains country-scoped totals, global genre metadata, and separate pagination caches', async () => {
  const first = await (await request('?country=Austria&limit=1')).json() as any;
  const next = await (await request('?country=Austria&limit=1&page=2')).json() as any;
  assert.equal(first.genre.stationCount, 3); assert.equal(first.total, 2); assert.equal(first.pages, 2);
  assert.deepEqual(first.stations.map((s: any) => s._id), ['jazz-a']);
  assert.deepEqual(next.stations.map((s: any) => s._id), ['jazz-b']);
  const empty = await (await request('?limit=2&page=3')).json() as any;
  assert.deepEqual(empty.stations, []); assert.equal(empty.total, 3); assert.equal(empty.pages, 2); assert.equal(empty.page, 3);
});
for (const query of ['?page=0', '?page=-1', '?page=1.5', '?page=2junk', '?page=Infinity', '?page=9007199254740992', '?page=1&page=2', '?limit=0', '?limit=-20', '?limit=NaN', '?limit=2.5', '?limit=']) {
  it(`rejects malformed pagination before cache or native reads: ${query}`, async () => {
    const response = await request(query);
    assert.equal(response.status, 400); assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(lookupCalls, 0); assert.equal(listingCalls.length, 0); assert.equal(cache.size, 0);
  });
}
it('caps valid oversized pagination consistently with native bounds and normalizes its cache identity', async () => {
  const first = await (await request('?page=1000001&limit=1000')).json() as any;
  assert.equal(first.page, 1_000_000); assert.deepEqual(first.stations, []);
  await request('?page=1000000&limit=100');
  assert.equal(listingCalls.length, 1); assert.equal(listingCalls[0].limit, 100);
});
it('keeps genuine missing genres as 404, without listing stations or fabricating empty success', async () => {
  missing = true; assert.equal((await request()).status, 404); assert.equal(listingCalls.length, 0);
});
it('never resurrects the old empty cache during an outage, but retains corrected stale fallback', async () => {
  cache.set('genre-stations:jazz:all:1:20', { stations: [], total: 0 }); failLookup = true;
  const failed = await request(); assert.equal(failed.status, 503); assert.equal(failed.headers.get('cache-control'), 'no-store');
  failLookup = false; await request(); failLookup = true;
  const stale = await request(); assert.equal(stale.status, 200); assert.equal(stale.headers.get('x-data-stale'), 'true');
  assert.equal((await stale.json() as any).total, 3);
});
