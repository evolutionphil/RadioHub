import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { PostgresPopularGlobalCandidates, POPULAR_RANK_FIELDS } from '../src/data/postgres-popular-global-candidates';
import { PostgresCatalogStore } from '../src/data/postgres-catalog-store';
import { isJunkStation } from '../src/seo/junk-station-rules';

test('popular candidate SQL is narrow, parameterized and preserves country order/multiplicity', async () => {
  const calls: any[] = [];
  const reader = new PostgresPopularGlobalCandidates({ query: async (...args: any[]) => {
    calls.push(args);
    return { rows: [{ id: 'id-a', votes: 3, click_count: 2, is_featured: false, show_in_global_popular: false }] };
  } } as any);
  assert.deepEqual(await reader.regular(['Turkey', "country'", 'Turkey'], 40), [
    { _id: 'id-a', votes: 3, clickCount: 2, isFeatured: false, showInGlobalPopular: false },
  ]);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][1], [['Turkey', "country'", 'Turkey'], 40]);
  assert.match(calls[0][0], /PARTITION BY country/);
  assert.match(calls[0][0], /WITH ORDINALITY/);
  assert.match(calls[0][0], /ORDER BY c.country_order,s.position/);
  assert.doesNotMatch(calls[0][0], /descriptions|source|SELECT \*|country'/);
});

test('empty country input avoids SQL and invalid country caps fail before a query', async () => {
  const reader = new PostgresPopularGlobalCandidates({ query: async () => assert.fail('unexpected SQL') } as any);
  assert.deepEqual(await reader.regular([], 40), []);
  for (const limit of [0, -1, 201, NaN, Infinity, 1.5]) {
    await assert.rejects(reader.regular(['Turkey'], limit), /Invalid popular per-country limit/);
  }
});

const connectionString = process.env.PG_TEST_DATABASE_URL;
describe('native popular ranking preserves the former loop and full response', { skip: !connectionString }, () => {
  const schema = `popular_global_test_${process.pid}_${randomBytes(6).toString('hex')}`;
  const originalEnv = { DATABASE_URL: process.env.DATABASE_URL, POSTGRES_SSL: process.env.POSTGRES_SSL };
  const admin = new pg.Pool({ connectionString, ssl: false, max: 1 });
  let pool: pg.Pool;
  let catalog: PostgresCatalogStore;
  let closePostgres: () => Promise<void>;
  let created = false;
  before(async () => {
    const url = new URL(connectionString!);
    assert.equal(url.hostname, '127.0.0.1', 'Only literal loopback is allowed');
    assert.equal(url.pathname, '/radiohub_test', 'Only the disposable test database is allowed');
    assert.equal(url.search, '');
    await admin.query(`CREATE SCHEMA "${schema}"`); created = true;
    url.searchParams.set('options', `-c search_path=${schema},public`);
    process.env.DATABASE_URL = url.toString(); process.env.POSTGRES_SSL = 'disable';
    const runtime = await import('../src/postgres-runtime');
    pool = runtime.getPostgresPool(); closePostgres = runtime.closePostgres;
    const directory = path.resolve(import.meta.dirname, '../../../lib/db/migrations');
    for (const file of (await readdir(directory)).filter(file => /^\d+.*\.sql$/.test(file)).sort()) {
      await pool.query(await readFile(path.join(directory, file), 'utf8'));
    }
    catalog = new PostgresCatalogStore(pool);
    // More than 800 regular candidates exercises equivalence to the former
    // intermediate trimming, including the cap in the highest-ranked country.
    await pool.query(`INSERT INTO stations(id,station_uuid,name,slug,url,country,votes,click_count,descriptions,source)
      SELECT 'fixture-'||n,'uuid-'||n,'Radio '||n,'radio-'||n||'x','https://example.invalid/'||n,
        'Country '||((n-1)/45),10000-n,n,
        jsonb_build_object('tr',jsonb_build_object('meta','Türkçe açıklama','full',repeat('Metin ',400))),
        jsonb_build_object('countrycode','ZZ','genre','Jazz','lastCheckOkTime','2026-09-01',
          'localImagePath','/images/'||n,'unrequested',repeat('Private source ',200))
      FROM generate_series(1,1170) n`);
    await catalog.insertMany([
      { _id: 'featured', stationuuid: 'featured', name: 'Featured Radio', slug: 'featured-radio', url: 'https://example.invalid/f',
        country: null, isFeatured: true, showInGlobalPopular: true, votes: -10 },
      { _id: 'hidden-featured', stationuuid: 'hidden-featured', name: 'Hidden Featured', slug: 'hidden-featured',
        url: 'https://example.invalid/h', country: 'Country 0', isFeatured: true, showInGlobalPopular: false, votes: 200000 },
    ]);
    await pool.query(`UPDATE stations SET no_index=true WHERE id='fixture-2'`);
    await pool.query(`UPDATE stations SET last_check_ok=false WHERE id='fixture-3'`);
    await pool.query(`UPDATE stations SET slug='' WHERE id='fixture-4'`);
    await pool.query(`UPDATE stations SET slug=NULL WHERE id='fixture-5'`);
    await pool.query(`UPDATE stations SET country=' ' WHERE id='fixture-6'`);
    await pool.query(`UPDATE stations SET country=' Country 0 ' WHERE id='fixture-7'`);
    // Still ranked first, then removed by the existing post-limit junk gate.
    await pool.query(`UPDATE stations SET name='Codec test',slug='radio-test-feed' WHERE id='fixture-1'`);
  });
  after(async () => {
    if (closePostgres) await closePostgres();
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    try {
      if (created) {
        assert.match(schema, /^popular_global_test_\d+_[a-f0-9]{12}$/);
        await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      }
    } finally { await admin.end(); }
  });

  test('per-country eligibility, exact keys, caps and duplicate key order match the old queries', async () => {
    const countries = ['Country 1', 'Country 0', 'Country 1', 'no such country'];
    const expected: any[] = [];
    for (const country of countries) {
      expected.push(...await catalog.find({ country, lastCheckOk: true, isFeatured: { $ne: true },
        noIndex: { $ne: true }, slug: { $exists: true, $ne: '' } }, {
        sort: { votes: -1, clickCount: -1 }, limit: 40, fields: POPULAR_RANK_FIELDS,
      }));
    }
    assert.equal(expected.length, 119);
    assert.deepEqual(await new PostgresPopularGlobalCandidates(pool).regular(countries, 40), expected);
  });

  test('full compute matches old incremental trimming, hydrates only winners, and keeps source extras', async () => {
    const { PrecomputedPopularGlobalService } = await import('../src/services/precomputed-popular-global');
    const trim = (stations: any[]) => stations.sort((a,b) =>
      Number(Boolean(b.isFeatured && b.showInGlobalPopular)) - Number(Boolean(a.isFeatured && a.showInGlobalPopular)) ||
      (b.votes ?? 0) - (a.votes ?? 0) || (b.clickCount ?? 0) - (a.clickCount ?? 0)).slice(0,200);
    const fullFields = ['_id','name','url','urlResolved','favicon','country','countrycode','state','genre','codec','bitrate',
      'homepage','tags','slug','hls','votes','clickCount','lastCheckOk','lastCheckTime','lastCheckOkTime','descriptions',
      'logoAssets','localImagePath','isFeatured','showInGlobalPopular','hasLogo','noIndex'];
    let featured = await catalog.find({ lastCheckOk: true, isFeatured: true, showInGlobalPopular: true,
      noIndex: { $ne: true }, slug: { $exists: true, $ne: '' } },
      { sort: { votes: -1, clickCount: -1 }, limit: 200, fields: fullFields });
    const countries = (await catalog.groupCount('country', { lastCheckOk: true }))
      .map(row => row._id).filter((country): country is string => !!country?.trim()).map(country => country.trim());
    let regular: any[] = [];
    for (const country of countries) {
      regular.push(...await catalog.find({ country, lastCheckOk: true, isFeatured: { $ne: true },
        noIndex: { $ne: true }, slug: { $exists: true, $ne: '' } },
        { sort: { votes: -1, clickCount: -1 }, limit: 40, fields: fullFields }));
      if (regular.length > 800) {
        const trimmed = trim([...featured, ...regular]);
        featured = trimmed.filter(s => s.isFeatured && s.showInGlobalPopular);
        regular = trimmed.filter(s => !(s.isFeatured && s.showInGlobalPopular));
      }
    }
    const expected = trim([...featured, ...regular]).filter(station => !isJunkStation(station));
    const queries: string[] = [];
    const query = pool.query.bind(pool);
    (pool as any).query = async (...args: any[]) => { queries.push(args[0]); return (query as any)(...args); };
    let actual: any[];
    try { actual = await PrecomputedPopularGlobalService.computeStations(50); }
    finally { pool.query = query; }
    assert.deepEqual(actual!, expected);
    assert.equal(queries.length, 4);
    assert.equal(queries.filter(sql => sql.includes('s.descriptions')).length, 1);
    assert.equal(actual![0]._id, 'featured');
    assert.equal(actual!.some(s => s._id === 'fixture-1'), false);
    assert.ok(actual!.length < 200, 'Junk removal must not refill beyond the original top-200 gate');
    assert.equal(actual![1].genre, 'Jazz');
    assert.equal(actual![1].countrycode, 'ZZ');
    assert.equal(actual![1].lastCheckOkTime, '2026-09-01');
    assert.ok(actual![1].descriptions.tr.full.length > 2000);
    assert.equal(actual![1].unrequested, undefined);
  });

  test('score ties are deterministic within a country and do not duplicate a unique input key', async () => {
    await pool.query(`UPDATE stations SET votes=10000,click_count=10 WHERE id IN ('fixture-1100','fixture-1101')`);
    const reader = new PostgresPopularGlobalCandidates(pool);
    const first = await reader.regular(['Country 24'], 2);
    assert.deepEqual(first.map(s => s._id), ['fixture-1100','fixture-1101']);
    assert.deepEqual(await reader.regular(['Country 24'], 2), first);
  });

  test('a failed regular query retains the existing usable featured-only fallback', async () => {
    const { PrecomputedPopularGlobalService } = await import('../src/services/precomputed-popular-global');
    const query = pool.query.bind(pool);
    (pool as any).query = async (...args: any[]) => {
      if (args[0].startsWith('WITH ranked AS')) throw new Error('test regular query unavailable');
      return (query as any)(...args);
    };
    try {
      assert.deepEqual((await PrecomputedPopularGlobalService.computeStations(50)).map(s => s._id), ['featured']);
    } finally { pool.query = query; }
  });

  test('empty recomputation still throws instead of replacing the stale cache with empty success', async () => {
    const { PrecomputedPopularGlobalService } = await import('../src/services/precomputed-popular-global');
    await pool.query('UPDATE stations SET last_check_ok=false');
    await assert.rejects(PrecomputedPopularGlobalService.computeStations(50), /refusing to cache empty success/);
  });
});
