import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import pg from 'pg';
const connectionString = process.env.PG_TEST_DATABASE_URL;
describe('Native PostgreSQL recommendation engine and precomputed station pools', { skip: !connectionString }, () => {
  const schema = `recommendation_test_${process.pid}_${randomBytes(6).toString('hex')}`;
  const ssl = process.env.PG_TEST_SSL === 'require' ? { rejectUnauthorized: true } : false;
  const admin = new pg.Pool({ connectionString, ssl, max: 1 });
  let pool: pg.Pool, closePostgres: () => Promise<void>;
  let engine: typeof import('../src/services/recommendation-engine').RecommendationEngine;
  let store: typeof import('../src/data/postgres-recommendation-store');
  let schemaCreated = false;
  before(async () => {
    assert.match(schema, /^recommendation_test_\d+_[a-f0-9]{12}$/);
    await admin.query(`CREATE SCHEMA "${schema}"`); schemaCreated = true;
    const url = new URL(connectionString!);
    url.searchParams.set('options', `-c search_path=${schema},public`);
    process.env.DATABASE_URL = url.toString(); process.env.POSTGRES_SSL = ssl ? 'require' : 'disable';
    const runtime = await import('../src/postgres-runtime');
    pool = runtime.getPostgresPool(); closePostgres = runtime.closePostgres;
    const directory = path.resolve(import.meta.dirname, '../../../lib/db/migrations');
    for (const file of (await readdir(directory)).filter(file => /^\d+.*\.sql$/.test(file)).sort()) {
      await pool.query(await readFile(path.join(directory, file), 'utf8'));
    }
    await pool.query(`INSERT INTO stations(id,station_uuid,name,slug,url,url_resolved,country,language,tags_raw,votes,last_check_ok,has_logo,logo_assets) VALUES
      ('a','uuid-a','Radio A','radio-a','https://example.invalid/a','https://example.invalid/live-a','Turkey','Turkish','rock,pop',10000,true,true,'{"webp96":"logo-a"}'),
      ('b','uuid-b','Radio B','radio-b','https://example.invalid/b',NULL,'Turkey','Turkish','rock',8000,true,true,'{"webp96":"logo-b"}'),
      ('c','uuid-c','Radio C','radio-c','https://example.invalid/c',NULL,'Turkey','Turkish','jazz',6000,true,false,'{}'),
      ('d','uuid-d','Radio D','radio-d','https://example.invalid/d',NULL,'Turkey','Turkish','rock',4000,true,true,'{"webp96":"logo-d"}'),
      ('e','uuid-e','Radio E','radio-e','https://example.invalid/e',NULL,'Germany','German','rock',50000,true,true,'{}'),
      ('offline','uuid-offline','Offline','offline','https://example.invalid/offline',NULL,'Turkey','Turkish','rock',99999,false,true,'{}')`);
    engine = (await import('../src/services/recommendation-engine')).RecommendationEngine;
    store = await import('../src/data/postgres-recommendation-store');
  });
  after(async () => {
    if (closePostgres) await closePostgres();
    try {
      if (schemaCreated) { assert.match(schema, /^recommendation_test_\d+_[a-f0-9]{12}$/); await admin.query(`DROP SCHEMA "${schema}" CASCADE`); }
    } finally { await admin.end(); }
  });
  it('serializes concurrent history+rich-profile updates without losing events or custom profile metadata', async () => {
    await pool.query("INSERT INTO recommendation_profiles(id,session_id,source) VALUES ('profile-a','listener','{\"customPreference\":\"kept\"}')");
    await Promise.all(Array.from({ length: 24 }, (_, index) => engine.recordUserInteraction({
      sessionId: 'listener', stationId: ['a', 'b', 'c'][index % 3], listenDuration: 600,
      interactionType: index % 6 === 0 ? 'favorite' : 'play', deviceType: 'mobile',
    })));
    const profile = await store.pgRecommendationProfile('listener');
    assert.equal(profile._id, 'profile-a');
    assert.equal(profile.customPreference, 'kept');
    assert.equal(profile.totalStationsListened, 24);
    assert.equal(profile.uniqueStationsCount, 3);
    assert.equal(profile.favoriteStationsCount, 4);
    assert.equal(profile.averageListenDuration, 600);
    assert.equal(profile.profileStrength, 24 / 50);
    assert.equal(profile.preferredCountries[0].country, 'Turkey');
    assert.equal(profile.preferredLanguages[0].language, 'Turkish');
    assert.ok(profile.preferredGenres.some((entry: any) => entry.genre === 'rock' && entry.weight === 1));
    assert.equal((await store.pgRecentSessionListening('listener', 5)).length, 5);
    assert.equal((await store.pgRecentSessionListening('listener', 5))[0].language, 'Turkish');
    assert.equal(await store.pgRecommendationProfile('missing'), null);
  });
  it('rolls back history if profile persistence fails', async () => {
    const count = (await pool.query("SELECT count(*)::int count FROM listening_history WHERE session_id='rollback'")).rows[0].count;
    await assert.rejects(store.pgRecordRecommendationInteraction({ sessionId: 'rollback', stationId: 'a',
      stationName: 'A', country: 'Turkey', listenDuration: 30, interactionType: 'play', listenedAt: new Date() }, () => { throw new Error('test derivation failed'); }));
    assert.equal((await pool.query("SELECT count(*)::int count FROM listening_history WHERE session_id='rollback'")).rows[0].count, count);
    assert.equal(await store.pgRecommendationProfile('rollback'), null);
  });
  it('runs collaborative grouping in SQL and preserves rating/reason confidence inputs', async () => {
    for (const session of ['peer-1', 'peer-2']) for (const station of ['a', 'b', 'd', 'offline']) {
      await engine.recordUserInteraction({ sessionId: session, stationId: station, listenDuration: 600, interactionType: 'play' });
    }
    const recs = await store.pgCollaborativeRecommendations('a', 'listener');
    assert.deepEqual(recs.map(rec => rec._id), ['d']);
    assert.equal(recs[0].score, 5);
    assert.equal(recs[0].listenerCount, 2);
    assert.equal(recs[0].avgListenDuration, 600);
    assert.deepEqual(await store.pgCollaborativeRecommendations('a', 'missing'), []);
    const blended = await engine.getPersonalizedSimilarStations({ sourceStationId: 'a', sessionId: 'listener', limit: 5 });
    assert.ok(blended.length > 0);
    assert.ok(blended.every(rec => rec.stationId !== 'a' && rec.stationId !== 'offline'));
    assert.ok(blended.some(rec => rec.stationId === 'd'));
  });
  it('keeps similar stations in source country, excludes source/explicit IDs and retains logos', async () => {
    const stations = await engine.getSimilarStations({ stationId: 'a', country: 'Germany', limit: 10, excludeIds: ['b'] });
    assert.ok(stations.length > 0);
    assert.ok(stations.every(station => station.country === 'Turkey' && !['a', 'b', 'offline'].includes(station._id)));
    assert.ok(stations.some(station => station.logoAssets?.webp96 === 'logo-d'));
    assert.deepEqual(await engine.getDedicatedRecommendations('Turkey', 'rock.*injection', 10), []);
    const dedicated = await engine.getDedicatedRecommendations('Turkey', 'rock', 2);
    assert.equal(dedicated.length, 2);
    assert.ok(dedicated.every(station => station.country === 'Turkey'));
  });
  it('precomputes country/global pools with SQL limits and no stale empty-success caching', async () => {
    const { PrecomputedStationsService } = await import('../src/services/precomputed-stations');
    const { PrecomputedPopularGlobalService } = await import('../src/services/precomputed-popular-global');
    const country = await PrecomputedStationsService.computeCountryStationsByName('turkey');
    assert.equal(country.stations.length, 4);
    assert.equal(country.stations.find(station => station._id === 'a')?.url_resolved, 'https://example.invalid/live-a');
    assert.ok(country.stations.every(station => station._id !== 'offline'));
    const global = await PrecomputedStationsService.computeGlobalStations();
    assert.ok(global.stations.length >= 5);
    const popular = await PrecomputedPopularGlobalService.computeStations(12);
    assert.ok(popular.length > 0);
    assert.ok(popular.every(station => station._id !== 'offline'));
    await pool.query("UPDATE stations SET no_index=true WHERE id='e'");
    const refreshed = await PrecomputedPopularGlobalService.computeStations(12);
    assert.ok(refreshed.every(station => station._id !== 'e'));
  });
});
