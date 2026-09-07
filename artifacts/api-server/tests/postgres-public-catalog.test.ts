import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { after, before, beforeEach, describe, it, mock } from 'node:test';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import pg from 'pg';
import { PostgresCatalogStore } from '../src/data/postgres-catalog-store';

describe('Native PostgreSQL public catalog', { skip: !process.env.PG_TEST_DATABASE_URL }, () => {
  const schema = `public_catalog_${process.pid}_${randomBytes(6).toString('hex')}`;
  const options = { connectionString: process.env.PG_TEST_DATABASE_URL, ssl: process.env.PG_TEST_SSL === 'require' ? { rejectUnauthorized: true } : false };
  const admin = new pg.Pool({ ...options, max: 1 });
  const pool = new pg.Pool({ ...options, max: 8, options: `-c search_path=${schema},public` });
  const catalog = new PostgresCatalogStore(pool);
  const cache = new Map<string, any>();
  let read: typeof import('../src/data/station-read-store');
  let write: typeof import('../src/data/station-write-store');
  let taxonomy: typeof import('../src/data/postgres-taxonomy-store');
  let server: Server;
  let schemaCreated = false;
  let base = '';
  const station = (id: string, extra: Record<string, unknown> = {}) => ({ _id: id, stationuuid: `uuid-${id}`, name: id, url: `https://stream.invalid/${id}`, country: 'Germany', countryCode: 'DE', ...extra });
  before(async () => {
    assert.match(schema, /^public_catalog_\d+_[a-f0-9]{12}$/);
    await admin.query(`CREATE SCHEMA "${schema}"`); schemaCreated = true;
    const migrations = path.resolve(import.meta.dirname, '../../../lib/db/migrations');
    for (const file of (await readdir(migrations)).filter((file) => /^\d+.*\.sql$/.test(file)).sort()) await pool.query(await readFile(path.join(migrations, file), 'utf8'));
    mock.module('../src/postgres-runtime', { namedExports: { getPostgresPool: () => pool, getPostgresCoordinationPool: () => pool } });
    const manager = {
      get: async (key: string) => cache.get(key) ?? null,
      getSWR: async (key: string) => cache.get(key) ?? null,
      set: async (key: string, value: any) => { cache.set(key, value); },
      getOrSetSingleFlight: async (key: string, compute: () => Promise<any>) => {
        if (cache.has(key)) return cache.get(key);
        const value = await compute(); cache.set(key, value); return value;
      },
      getOrSetSWR: async (key: string, compute: () => Promise<any>) => cache.get(key) ?? compute(),
    };
    mock.module('../src/cache', { defaultExport: manager, namedExports: { CacheManager: manager, CacheKeys: { genres: (...args: any[]) => JSON.stringify(args) } } });
    mock.module('../src/services/precomputed-genres', { namedExports: { PrecomputedGenresService: { refreshAll: async () => {} } } });
    mock.module('../src/services/recommendation-engine', { namedExports: { RecommendationEngine: {} } });
    // The shared UI helpers also start an unrelated slug-job cleanup interval.
    mock.module('../src/routes/shared-utils', { namedExports: {
      stripPlaceholders: (value: any) => value, tvSlimStation: (value: any) => value, tvSlimGenre: (value: any) => value,
      tvValidateParams: (query: any) => ({ page: Number(query.page) || 1, limit: Number(query.limit) || 25 }),
    } });
    read = await import('../src/data/station-read-store');
    write = await import('../src/data/station-write-store');
    taxonomy = await import('../src/data/postgres-taxonomy-store');
    const { registerPublicStationRoutes } = await import('../src/routes/station-public-routes');
    const { registerGenresCountriesRoutes } = await import('../src/routes/genres-countries-routes');
    const app = express(); app.use(express.json());
    const deps = { requireAdmin: (req: any, res: any, next: () => void) => req.headers['x-test-admin'] === 'true' ? next() : res.status(401).end() };
    registerPublicStationRoutes(app, deps); registerGenresCountriesRoutes(app, deps);
    server = await new Promise<Server>((resolve) => { const result = app.listen(0, '127.0.0.1', () => resolve(result)); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  beforeEach(async () => { cache.clear(); await pool.query('TRUNCATE stations,genres CASCADE'); });
  after(async () => {
    if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    mock.restoreAll(); await pool.end();
    try { if (schemaCreated) { assert.match(schema, /^public_catalog_\d+_[a-f0-9]{12}$/); await admin.query(`DROP SCHEMA "${schema}" CASCADE`); } }
    finally { await admin.end(); }
  });
  it('always uses PostgreSQL, resolves aliases and keeps canonical columns authoritative', async () => {
    assert.equal(read.stationReadMode, 'postgres'); assert.equal(write.stationWriteMode, 'postgres');
    await catalog.insertMany([station('one', { slug: 'canonical', slugAliases: ['old-name'], descriptions: { de: 'Beschreibung' } })]);
    await pool.query("UPDATE stations SET source=source||'{\"name\":\"stale\",\"votes\":999}'::jsonb WHERE id='one'");
    assert.equal((await read.getStationByIdentifier('old-name')).name, 'one');
    assert.equal((await read.getStationByIdentifier('canonical')).votes, 0);
    assert.equal(await read.getStationByIdentifier('missing'), null);
    assert.equal(await read.stationSlugExists('canonical', 'two'), true);
    await read.updateStationDerivedFields('one', { slug: 'renamed', noIndex: true });
    assert.equal((await read.getStationByIdentifier('renamed')).noIndex, true);
  });
  it('matches literal wildcards and exact genre tokens with deterministic totals on empty pages', async () => {
    await catalog.insertMany([station('literal', { name: '100% Music', tags: 'rock' }),station('other', { name: '1000 Music', tags: 'rockabilly' })]);
    assert.deepEqual((await read.listStationsFromPostgres({ search: '100%', page: 1, limit: 10 })).stations.map((s) => s._id), ['literal']);
    assert.equal((await read.listStationsFromPostgres({ country: '%', page: 1, limit: 10 })).totalCount, 0);
    const empty = await read.listStationsFromPostgres({ genre: 'rock', page: 3, limit: 1 });
    assert.equal(empty.totalCount, 1); assert.deepEqual(empty.stations, []); assert.equal(empty.pagination.pages, 1);
  });
  it('filters codec, bitrate and logos before pagination in the precomputed public API', async () => {
    await catalog.insertMany([
      station('top-rejected', { codec: 'AAC', bitrate: 64, votes: 999 }),
      station('accepted-a', { codec: 'MP3', bitrate: 192, favicon: 'https://logo.invalid/a', votes: 20 }),
      station('accepted-b', { codec: 'MP3', bitrate: 128, favicon: 'https://logo.invalid/b', votes: 10 }),
    ]);
    const response = await fetch(base + '/api/stations/precomputed?codec=mp3&bitrate=128&hasLogo=true&limit=1&page=2');
    assert.equal(response.status, 200); const body = await response.json() as any;
    assert.equal(body.total, 2); assert.equal(body.totalPages, 2); assert.equal(body.stations[0]._id, 'accepted-b');
  });
  it('indexed genre candidates preserve normalized tags, standalone source genres and literal raw-token fallbacks', async () => {
    await catalog.insertMany([
      station('normalized', { tags: 'Türkçe Pop', votes: 30 }),
      station('source-only', { genre: 'Türkçe pOP', votes: 20 }),
      station('unrelated', { tags: 'popcorn', votes: 999 }),
      station('literal-percent', { tags: '100% music', votes: 10 }),
      station('wildcard-impostor', { tags: '1000 music', votes: 999 }),
      station('raw-unicode', { tags: '音乐', country: 'China' }),
    ]);
    // Exercise a raw token without a normalized relation, as with non-ASCII
    // tags whose original normalizer cannot produce a non-empty ASCII slug.
    await pool.query("DELETE FROM station_genres WHERE station_id='literal-percent'");
    const result = await read.listStationsFromPostgres({ genre: 'Türkçe Pop', page: 1, limit: 10, compact: true });
    assert.deepEqual(result.stations.map(s => s._id), ['normalized', 'source-only']);
    assert.equal(result.totalCount, 2);
    assert.deepEqual((await read.listStationsFromPostgres({ genre: '100% music', page: 1, limit: 10 })).stations.map(s => s._id), ['literal-percent']);
    assert.deepEqual((await read.listStationsFromPostgres({ genre: '音乐', page: 1, limit: 10 })).stations.map(s => s._id), ['raw-unicode']);
    const absent = await read.listStationsFromPostgres({ genre: 'Türkçe Pop', country: 'China', page: 1, limit: 1 });
    assert.equal(absent.totalCount, 0); assert.deepEqual(absent.stations, []);
    const pageTwo = await read.listStationsFromPostgres({ genre: 'Türkçe Pop', page: 2, limit: 1 });
    assert.equal(pageTwo.totalCount, 2); assert.equal(pageTwo.stations[0]._id, 'source-only');
  });
  it('compact list opt-in preserves ordering, filters and player fields without full translated articles', async () => {
    await catalog.insertMany([station('compact', { slug:'compact',votes:20,lastCheckOk:true,
      urlResolved:'https://stream.invalid/resolved',logoAssets:{status:'completed',webp256:'https://s3.invalid/logo.webp'},
      descriptions:{de:{full:'Long article '.repeat(3000)}},genre:'Jazz',sslError:true,customSecret:'unneeded',
    })]);
    const full=await read.listStationsFromPostgres({page:1,limit:10});
    const compact=await read.listStationsFromPostgres({page:1,limit:10,compact:true});
    assert.deepEqual(compact.pagination,full.pagination);
    for (const field of ['_id','stationuuid','slug','name','votes','url','urlResolved','logoAssets','genre','sslError']) {
      assert.deepEqual(compact.stations[0][field],full.stations[0][field],field);
    }
    assert.deepEqual(compact.stations[0].descriptions,{});
    assert.equal(compact.stations[0].customSecret,undefined);
    assert.ok(JSON.stringify(compact).length<JSON.stringify(full).length/10);
    const response=await fetch(base+'/api/stations/precomputed?slim=1&limit=10');
    assert.equal(response.status,200);
    const body=await response.json() as any;
    assert.deepEqual(body.stations,JSON.parse(JSON.stringify(compact.stations)));
    assert.deepEqual(body.data,body.stations);
    const detail=await read.getStationByIdentifier('compact');
    assert.ok(detail.descriptions.de.full.length>30000);
  });
  it('legacy slim opt-in preserves card/player/logo fields and filters while the default stays full', async () => {
    const article = { de: { full: 'Full station article '.repeat(3000) } };
    await catalog.insertMany([
      station('card-a', { name: 'Radio Wien A', slug: 'radio-wien-a', state: 'Vienna', tags: 'jazz', votes: 20,
        urlResolved: 'https://stream.invalid/resolved', hls: true, codec: 'AAC', bitrate: 128,
        homepage: 'https://station.invalid', favicon: 'https://logo.invalid/a', hasLogo: true,
        logoAssets: { folder: 'fixture', status: 'completed', webp48: '48.webp', webp96: '96.webp', webp256: '256.webp' },
        localImagePath: 'fixture.png', sslError: true, genre: 'Jazz', genres: ['Jazz'], mood: 'calm',
        geoLat: 48.2, geoLong: 16.3, lastCheckOk: true, noIndex: true,
        isFeatured: true, showInGlobalPopular: true, descriptions: article, extraArchiveField: 'full-only' }),
      station('card-b', { name: 'Radio Wien B', state: 'Wien', tags: 'jazz', votes: 10, lastCheckOk: true }),
      station('wrong-city', { state: 'Berlin', tags: 'jazz', votes: 999, lastCheckOk: true }),
      station('broken', { state: 'Wien', tags: 'jazz', votes: 999, lastCheckOk: false }),
    ]);
    const path = '/api/stations?country=Germany&state=Wien&tags=jazz&excludeBroken=true&sort=votes&limit=1&page=1';
    const request = async (suffix = '') => {
      const response = await fetch(base + path + suffix); assert.equal(response.status, 200);
      return await response.json() as any;
    };
    const full = await request(); const compact = await request('&slim=1');
    assert.deepEqual(compact.pagination, { page: 1, limit: 1, total: 2, pages: 2 });
    assert.deepEqual(compact.pagination, full.pagination);
    assert.deepEqual(compact.stations.map((s: any) => s._id), full.stations.map((s: any) => s._id));
    for (const field of ['_id','stationuuid','slug','name','country','countryCode','state','votes','url','urlResolved',
      'hls','codec','bitrate','homepage','favicon','hasLogo','logoAssets','localImagePath','sslError','genre','genres',
      'mood','geoLat','geoLong','lastCheckOk','noIndex','isFeatured','showInGlobalPopular']) {
      assert.deepEqual(compact.stations[0][field], full.stations[0][field], field);
    }
    assert.deepEqual(full.stations[0].descriptions, article);
    assert.equal(full.stations[0].extraArchiveField, 'full-only');
    assert.deepEqual(compact.stations[0].descriptions, {});
    assert.equal(compact.stations[0].extraArchiveField, undefined);
    assert.ok(JSON.stringify(compact).length < JSON.stringify(full).length / 10);
    for (const suffix of ['&slim=0', '&slim=true']) assert.deepEqual(await request(suffix), full);
    // Both warm shapes must stay independently usable without touching PostgreSQL.
    const fault = mock.method(pool, 'query', async () => { throw new Error('Unexpected warm-cache query'); });
    try { assert.deepEqual(await request(), full); assert.deepEqual(await request('&slim=1'), compact); }
    finally { fault.mock.restore(); }
  });
  it('legacy slim search keeps synonyms and ranking without exposing full descriptions', async () => {
    await catalog.insertMany([
      station('search', { name: 'Vienna FM', descriptions: { de: { full: 'Search article' } } }),
      station('other-search', { name: 'Unrelated station' }),
    ]);
    const request = async (suffix: string) => {
      const response = await fetch(base + '/api/stations?search=Viyana%20FM&limit=20' + suffix);
      assert.equal(response.status, 200); return await response.json() as any;
    };
    const full = await request(''); const compact = await request('&slim=1');
    assert.deepEqual(compact.stations.map((s: any) => s._id), ['search']);
    assert.deepEqual(compact.pagination, full.pagination);
    assert.deepEqual(compact.stations[0].descriptions, {});
    assert.equal(full.stations[0].descriptions.de.full, 'Search article');
  });
  it('legacy fallback caches cannot cross full/compact shapes and search failures stay unavailable', async () => {
    await catalog.insertMany([station('fallback', { descriptions: { de: { full: 'Preserved full article' } } })]);
    for (const [warm, cold] of [['', '&slim=1'], ['&slim=1', '']]) {
      cache.clear();
      assert.equal((await fetch(base + '/api/stations?country=Germany' + warm)).status, 200);
      const fault = mock.method(pool, 'query', async () => { throw new Error('Injected catalog outage'); });
      try {
        const wrongShape = await fetch(base + '/api/stations?country=Germany&state=Berlin' + cold);
        assert.equal(wrongShape.status, 503); assert.equal(wrongShape.headers.get('cache-control'), 'no-store');
        const sameShape = await fetch(base + '/api/stations?country=Germany&state=Berlin' + warm);
        assert.equal(sameShape.status, 200); assert.equal(sameShape.headers.get('x-data-stale'), 'true');
        const body = await sameShape.json() as any;
        assert.deepEqual(body.stations[0].descriptions, warm ? {} : { de: { full: 'Preserved full article' } });
        const search = await fetch(base + '/api/stations?country=Germany&search=missing' + warm);
        assert.equal(search.status, 503);
      } finally { fault.mock.restore(); }
    }
  });
  it('concurrent PostgreSQL counters never lose increments and retain click timestamps', async () => {
    await catalog.insertMany([station('counter')]);
    await Promise.all(Array.from({ length: 24 }, () => write.incrementStationClick('counter')));
    await Promise.all(Array.from({ length: 24 }, () => write.incrementStationVote('counter')));
    const result = await read.getStationByIdentifier('counter');
    assert.equal(result.clickCount, 24); assert.equal(result.votes, 24); assert.ok(Number.isFinite(new Date(result.clickTimestamp).getTime()));
    assert.equal(await write.incrementStationClick('absent'), false); assert.equal(await write.incrementStationVote('absent'), null);
  });
  it('filters distance before LIMIT and finds nearby stations across the antimeridian', async () => {
    await catalog.insertMany([
      station('outside', { geoLat: 0.8, geoLong: 0.8, votes: 999, favicon: 'https://logo.invalid/out' }),
      station('inside', { geoLat: 0.1, geoLong: 0.1 }),
      station('dateline', { geoLat: 0, geoLong: -179.9 }),
    ]);
    assert.equal((await read.getNearbyStationsFromPostgres({ latitude: 0, longitude: 0, radiusKm: 100, limit: 1 }))[0]._id, 'inside');
    assert.equal((await read.getNearbyStationsFromPostgres({ latitude: 0, longitude: 179.9, radiusKm: 30, limit: 1 }))[0]._id, 'dateline');
    await assert.rejects(read.getNearbyStationsFromPostgres({ latitude: 100, longitude: 0, radiusKm: 100, limit: 5 }), TypeError);
  });
  it('native genre CRUD preserves rich fields, clears demotion and rejects duplicate slugs atomically', async () => {
    const created = await taxonomy.pgCreateGenre({ name: 'Rock', slug: 'rock', isDiscoverable: true, description: 'Original', displayOrder: 0 });
    await pool.query('UPDATE genres SET source=source||$1::jsonb WHERE id=$2', [JSON.stringify({ cleanupDemotion: { cause: 'test' }, posterImage: '/poster.png' }), created._id]);
    const updated = await taxonomy.pgUpdateGenre(created._id, { name: 'Rock Music' }, true);
    assert.equal(updated.posterImage, '/poster.png'); assert.equal(updated.description, 'Original'); assert.equal(updated.cleanupDemotion, undefined);
    await assert.rejects(taxonomy.pgCreateGenre({ name: 'Duplicate', slug: 'rock' }), (e: any) => e.code === '23505');
    assert.equal((await taxonomy.pgDiscoverableGenres(undefined, 10))[0].displayOrder, 0);
    assert.equal((await taxonomy.pgDeleteGenre(created._id))._id, created._id); assert.equal(await taxonomy.pgStoredGenreBySlug('rock'), null);
  });
  it('nearby compact reads preserve distance and cache keys separate limit, shape and country preference', async () => {
    await catalog.insertMany([
      station('near-a',{geoLat:0.1,geoLong:0.1,country:'Austria',descriptions:{de:{full:'Nearby article'}}}),
      station('near-b',{geoLat:0.2,geoLong:0.2,country:'Germany'}),
    ]);
    const request=async (suffix:string) => {
      const response=await fetch(base+'/api/stations/nearby?lat=0&lng=0&radius=100'+suffix);
      assert.equal(response.status,200);return await response.json() as any[];
    };
    const full=await request('&limit=1');
    const compact=await request('&limit=1&slim=1');
    assert.equal(full[0]._id,compact[0]._id);
    assert.equal(full[0].distance,compact[0].distance);
    assert.deepEqual(full[0].descriptions,{de:{full:'Nearby article'}});
    assert.deepEqual(compact[0].descriptions,{});
    assert.equal((await request('&limit=2&slim=1')).length,2);
    assert.equal((await request('&limit=1&slim=1&userCountry=Germany'))[0]._id,'near-b');
    assert.equal((await request('&limit=1&slim=1'))[0]._id,'near-a');
  });
  it('protects genre mutations and returns real dynamic genre lookups and country counts', async () => {
    await catalog.insertMany([station('jazz-a', { tags: 'jazz' }),station('jazz-b', { tags: 'jazz' })]);
    assert.equal((await taxonomy.pgGenreBySlug('jazz')).stationCount, 2);
    assert.deepEqual(await taxonomy.pgCountryCounts(), [{ name: 'Germany', count: 2 }]);
    assert.equal((await fetch(base + '/api/genres', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Jazz', slug: 'jazz' }) })).status, 401);
    const response = await fetch(base + '/api/genres', { method: 'POST', headers: { 'content-type': 'application/json', 'x-test-admin': 'true' }, body: JSON.stringify({ name: 'Jazz', slug: 'jazz' }) });
    assert.equal(response.status, 201);
  });
  it('returns unavailable status on a cold database failure instead of a fabricated empty success', async () => {
    const fault = mock.method(pool, 'query', async () => { throw new Error('Injected PostgreSQL catalog outage'); });
    try {
      for (const url of ['/api/station/missing','/api/stations/stats','/api/stations/precomputed','/api/countries','/api/genres']) {
        const response = await fetch(base + url); assert.equal(response.status, 503, url); assert.equal(response.headers.get('cache-control'), 'no-store');
      }
    } finally { fault.mock.restore(); }
  });
});
