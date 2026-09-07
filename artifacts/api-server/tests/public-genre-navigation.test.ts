import assert from 'node:assert/strict';
import { after, before, beforeEach, it, mock } from 'node:test';
import type { Server } from 'node:http';
import express from 'express';

// Actual taxonomy and HTTP handlers, with only storage/network boundaries mocked.
// No taxonomy, whitelist, station or production data is mutated.
const row = (slug: string, count: number, discoverable = true, name = slug, source = {}) => ({ id: `id-${slug}`, slug, name, station_count: count, is_discoverable: discoverable, source });
let rows: ReturnType<typeof row>[] = [], lastCountry: unknown, reads = 0;
const allowed = new Set<string>();
const cache = new Map<string, unknown>();
mock.module('../src/postgres-runtime', { namedExports: { getPostgresPool: () => ({ query: async (sql: string, params: any[] = []) => {
  lastCountry = params[0];
  reads++;
  assert.ok(sql.startsWith('SELECT'), 'Only a read query is allowed');
  return { rows: sql.includes('WHERE is_discoverable=true') ? rows.filter(r => r.is_discoverable) : rows };
} }) } });
mock.module('../src/seo/genre-whitelist-store', { namedExports: { getMergedWhitelist: () => allowed, getMergedAliases: () => new Map() } });
const manager = {
  get: async (key: string) => cache.get(key), set: async (key: string, value: unknown) => { cache.set(key, value); },
  getOrSetSingleFlight: async (key: string, compute: () => Promise<unknown>) => {
    if (cache.has(key)) return cache.get(key);
    const result = await compute(); cache.set(key, result); return result;
  },
};
mock.module('../src/cache', { defaultExport: manager, namedExports: { CacheManager: manager, CacheKeys: { genres: (...args: any[]) => `genres:${JSON.stringify(args)}` } } });
mock.module('../src/services/recommendation-engine', { namedExports: { RecommendationEngine: {} } });
mock.module('../src/services/precomputed-genres', { namedExports: { PrecomputedGenresService: {} } });
mock.module('../src/routes/shared-utils', { namedExports: { tvSlimGenre: (value: unknown) => value, tvValidateParams: () => ({ page: 1, limit: 9 }) } });
const taxonomy = await import('../src/data/postgres-taxonomy-store');
const { registerGenresCountriesRoutes } = await import('../src/routes/genres-countries-routes');
let server: Server, base: string;
before(async () => {
  const app = express(); registerGenresCountriesRoutes(app, { requireAdmin: (_req: unknown, res: any) => res.sendStatus(401) });
  server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); mock.restoreAll(); });
beforeEach(() => {
  rows = [row('105', 1000), row('105-9', 900), row('pop', 20), row('rock', 40), row('jazz', 100, false), row('custom-genre', 60), row('alias-only', 70)];
  allowed.clear(); for (const slug of ['pop', 'rock', 'jazz', 'custom-genre']) allowed.add(slug);
  cache.clear(); lastCountry = undefined; reads = 0;
});
const get = async (path: string) => { const response = await fetch(base + path); assert.equal(response.status, 200); return response.json() as Promise<any>; };

it('filters raw numeric/frequency tags and explicitly hidden curated rows before country pagination', async () => {
  const result = await get('/api/genres/precomputed?country=Austria&limit=2');
  assert.equal(lastCountry, 'Austria');
  assert.deepEqual(result.data.map((r: any) => r.slug), ['custom-genre', 'rock']);
  assert.equal(result.total, 3); assert.equal(result.totalPages, 2);
  assert.deepEqual(result.genres, result.data);
  assert.deepEqual((await get('/api/genres/precomputed?country=Austria&limit=2&page=2')).data.map((r: any) => r.slug), ['pop']);
});
it('public global/country browser and discoverable endpoints apply the same whitelist', async () => {
  for (const path of ['/api/genres?country=Austria', '/api/genres?limit=20', '/api/genres/discoverable?country=Austria', '/api/genres/discoverable']) {
    const result = await get(path); const list = Array.isArray(result) ? result : result.data;
    assert.deepEqual(list.map((r: any) => r.slug).sort(), ['custom-genre', 'pop', 'rock']);
  }
});
it('honors current admin additions/removals and does not change internal raw taxonomy', async () => {
  assert.equal((await taxonomy.pgGenres('Austria', true)).length, rows.length);
  allowed.delete('rock'); allowed.add('105');
  const result = await get('/api/genres/precomputed?country=Austria');
  assert.deepEqual(result.data.map((r: any) => r.slug), ['105', 'custom-genre', 'pop']);
  assert.equal((await taxonomy.pgGenres('Austria', true)).length, rows.length);
});
it('cached browser/discovery navigation follows whitelist changes without flushing unrelated caches', async () => {
  for (const path of ['/api/genres?limit=20', '/api/genres/discoverable']) await get(path);
  allowed.delete('rock'); allowed.add('105');
  for (const path of ['/api/genres?limit=20', '/api/genres/discoverable']) {
    const result = await get(path); const list = Array.isArray(result) ? result : result.data;
    assert.deepEqual(list.map((r: any) => r.slug).sort(), ['105', 'custom-genre', 'pop']);
  }
  assert.equal(cache.size, 4, 'Both whitelist versions keep their independent cached results');
});
it('keeps display order and custom names/images, and never promotes an alias into a new genre URL', async () => {
  rows[2] = row('pop', 20, true, 'Editorial Pop', { displayOrder: 0, posterImage: '/existing-pop.webp' });
  const list = await get('/api/genres/discoverable?country=Austria');
  assert.equal(list[0].name, 'Editorial Pop'); assert.equal(list[0].posterImage, '/existing-pop.webp');
  assert.ok(!list.some((r: any) => r.slug === 'alias-only'));
});
it('search applies after qualification so hidden or unknown matches cannot bypass it', async () => {
  assert.equal((await get('/api/genres/precomputed?country=Austria&search=105')).total, 0);
  assert.equal((await get('/api/genres/precomputed?country=Austria&search=jazz')).total, 0);
  assert.deepEqual((await get('/api/genres/precomputed?country=Austria&search=pop')).data.map((r: any) => r.slug), ['pop']);
});
it('reuses the native aggregate across pagination/search while separating country and whitelist versions', async () => {
  await get('/api/genres/precomputed?country=Austria&limit=2');
  await get('/api/genres/precomputed?country=Austria&limit=1&page=2');
  const filtered = await get('/api/genres/precomputed?country=Austria&search=pop');
  assert.deepEqual(filtered.data.map((r: any) => r.slug), ['pop']);
  assert.equal(reads, 1);
  await get('/api/genres/precomputed?country=Germany'); assert.equal(reads, 2);
  allowed.delete('rock');
  const changed = await get('/api/genres/precomputed?country=Austria');
  assert.equal(reads, 3); assert.ok(!changed.data.some((r: any) => r.slug === 'rock'));
});
