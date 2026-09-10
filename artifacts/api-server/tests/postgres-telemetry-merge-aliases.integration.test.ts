import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { after, before, describe, it } from 'node:test';
import pg from 'pg';

const connectionString = process.env.PG_TEST_DATABASE_URL;
describe('merge-safe PostgreSQL listening telemetry', { skip: !connectionString }, () => {
  const schema = `telemetry_merge_${process.pid}_${randomBytes(6).toString('hex')}`;
  const ssl = process.env.PG_TEST_SSL === 'require' ? { rejectUnauthorized: true } : false;
  const admin = new pg.Pool({ connectionString, ssl, max: 1 });
  const env = { DATABASE_URL: process.env.DATABASE_URL, POSTGRES_SSL: process.env.POSTGRES_SSL, POSTGRES_POOL_MAX: process.env.POSTGRES_POOL_MAX };
  let pool: pg.Pool, close: () => Promise<void>, created = false;
  let record: typeof import('../src/data/postgres-runtime-operations').pgRecordListening;
  let interact: typeof import('../src/data/postgres-recommendation-store').pgRecordRecommendationInteraction;
  let catalog: import('../src/data/postgres-catalog-store').PostgresCatalogStore;
  before(async () => {
    await admin.query(`CREATE SCHEMA "${schema}"`); created = true;
    const url = new URL(connectionString!); url.searchParams.set('options', `-c search_path=${schema},public`); url.searchParams.set('application_name', schema);
    process.env.DATABASE_URL = url.toString(); process.env.POSTGRES_SSL = ssl ? 'require' : 'disable'; process.env.POSTGRES_POOL_MAX = '5';
    const runtime = await import('../src/postgres-runtime'); pool = runtime.getPostgresPool(); close = runtime.closePostgres;
    const dir = path.resolve(import.meta.dirname, '../../../lib/db/migrations');
    for (const file of (await readdir(dir)).filter(file => /^\d+.*\.sql$/.test(file)).sort()) await pool.query(await readFile(path.join(dir, file), 'utf8'));
    record = (await import('../src/data/postgres-runtime-operations')).pgRecordListening;
    interact = (await import('../src/data/postgres-recommendation-store')).pgRecordRecommendationInteraction;
    catalog = new (await import('../src/data/postgres-catalog-store')).PostgresCatalogStore(pool);
    await pool.query("INSERT INTO users(id,username,email,full_name) VALUES('telemetry-user','telemetry-user','telemetry@example.invalid','Telemetry User')");
  });
  after(async () => {
    if (close) await close();
    try { if (created) { assert.match(schema, /^telemetry_merge_\d+_[a-f0-9]{12}$/); await admin.query(`DROP SCHEMA "${schema}" CASCADE`); } }
    finally { await admin.end(); for (const [key, value] of Object.entries(env)) if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  });
  async function group(prefix: string) {
    const ids = [`${prefix}-primary`, `${prefix}-loser`];
    await pool.query(`INSERT INTO stations(id,station_uuid,name,slug,url,country,country_code,votes) VALUES
      ($1,$3,'Radio One',$1,$5,'Germany','DE',10),($2,$4,'Radio One',$2,$5,'Germany','DE',5)`, [...ids, `uuid-${ids[0]}`, `uuid-${ids[1]}`, `https://example.invalid/${prefix}`]);
    return ids;
  }
  const input = (stationId: string, sessionId: string) => ({ stationId, sessionId, stationName: 'Radio One', country: 'Germany', genre: 'Pop', listenDuration: 31.4, interactionType: 'play', listenedAt: new Date() });
  const derive = (history: any[]) => ({ preferredGenres: [], preferredCountries: [], preferredLanguages: [], averageListenDuration: 31,
    peakListeningHours: [], skipRate: 0, totalStationsListened: history.length, uniqueStationsCount: new Set(history.map(item => item.stationId)).size,
    favoriteStationsCount: 0, lastListenedAt: new Date(), profileStrength: 0 });

  it('stores survivor IDs for historical merged IDs and UUIDs in both telemetry paths', async () => {
    const ids = await group('known'); await catalog.mergeDuplicates(ids, { requireSafeIdentity: true });
    await record({ userId: 'telemetry-user', stationId: ids[1], listenDuration: 12.4, stationName: 'Original played label' });
    await interact(input(`uuid-${ids[1]}`, 'known-session'), derive);
    const rows = (await pool.query('SELECT station_id,station_name,listen_duration,context FROM listening_history WHERE station_id=$1 ORDER BY listen_duration', [ids[0]])).rows;
    assert.equal(rows.length, 2); assert.equal(rows[0].station_name, 'Original played label'); assert.equal(rows[0].listen_duration, 12);
    assert.equal(rows[1].context.stationId, ids[0]);
    assert.equal((await pool.query('SELECT count(*) FROM listening_history WHERE station_id=ANY($1::text[])', [[ids[1], `uuid-${ids[1]}`]])).rows[0].count, '0');
  });

  it('preserves the historical unknown-ID contract without weakening duration validation', async () => {
    await record({ userId: 'telemetry-user', stationId: 'unknown-historical-id', listenDuration: 5 });
    await interact(input('unknown-historical-uuid', 'unknown-session'), derive);
    const rows = (await pool.query("SELECT station_id FROM listening_history WHERE station_id LIKE 'unknown-historical-%' ORDER BY station_id")).rows;
    assert.deepEqual(rows.map(row => row.station_id), ['unknown-historical-id', 'unknown-historical-uuid']);
    for (const listenDuration of [0, -1, NaN, Infinity, 2147483648]) {
      await assert.rejects(record({ userId: 'telemetry-user', stationId: 'never-inserted', listenDuration }), /Invalid listen duration/);
    }
    for (const listenDuration of [-1, NaN, Infinity, 2147483648]) await assert.rejects(interact({ ...input('never-inserted', 'invalid-session'), listenDuration }, derive), /Invalid recommendation interaction/);
    assert.equal((await pool.query("SELECT count(*) FROM listening_history WHERE station_id='never-inserted'")).rows[0].count, '0');
  });

  it('waits for a concurrent merge then resolves its newly committed aliases before insertion', async () => {
    const ids = await group('race'); const merger = await pool.connect();
    let writers: Promise<void> | undefined;
    try {
      await merger.query('BEGIN'); await catalog.mergeDuplicates(ids, { requireSafeIdentity: true, client: merger });
      writers = Promise.all([
        record({ userId: 'telemetry-user', stationId: ids[1], listenDuration: 8 }),
        interact(input(`uuid-${ids[1]}`, 'race-session'), derive),
      ]).then(() => {});
      let waiting = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const count = Number((await admin.query("SELECT count(*) FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'", [schema])).rows[0].count);
        if (count >= 2) { waiting = true; break; }
        await delay(10);
      }
      assert.equal(waiting, true, 'Both writers should wait on the station row held by the merge');
      await merger.query('COMMIT'); await writers;
      assert.equal((await pool.query('SELECT count(*) FROM listening_history WHERE station_id=$1', [ids[0]])).rows[0].count, '2');
      assert.equal((await pool.query('SELECT count(*) FROM listening_history WHERE station_id=ANY($1::text[])', [[ids[1], `uuid-${ids[1]}`]])).rows[0].count, '0');
    } finally { await merger.query('ROLLBACK'); merger.release(); if (writers) await writers; }
  });

  it('rolls back failed telemetry and profile writes without leaking locks or partial history', async () => {
    const ids = await group('rollback');
    await assert.rejects(record({ userId: 'nonexistent-user', stationId: ids[1], listenDuration: 3 }), { code: '23503' });
    await assert.rejects(interact(input(ids[1], 'rollback-session'), () => { throw new Error('Profile failed'); }), /Profile failed/);
    assert.equal((await pool.query('SELECT count(*) FROM listening_history WHERE station_id=$1', [ids[1]])).rows[0].count, '0');
    const result = await catalog.mergeDuplicates(ids, { requireSafeIdentity: true }); assert.equal(result.deletedCount, 1);
  });

  it('public recommendation entrypoints accept old IDs/UUIDs and canonicalize exclusions before recommendations', async () => {
    const source = await group('engine-source'), excluded = await group('engine-excluded');
    await catalog.mergeDuplicates(source, { requireSafeIdentity: true });
    await catalog.mergeDuplicates(excluded, { requireSafeIdentity: true });
    await pool.query("INSERT INTO stations(id,station_uuid,name,url,country,country_code,tags_raw,language,votes) VALUES('engine-alternative','uuid-engine-alternative','Other Radio','https://example.invalid/other','Germany','DE','pop','de',6000)");
    const engine = (await import('../src/services/recommendation-engine')).RecommendationEngine;
    await engine.recordUserInteraction({ sessionId: 'engine-session', stationId: `uuid-${source[1]}`, listenDuration: 25, interactionType: 'play' });
    assert.equal((await pool.query("SELECT station_id FROM listening_history WHERE session_id='engine-session'")).rows[0].station_id, source[0]);
    const similar = await engine.getSimilarStations({ stationId: source[1], excludeIds: [`uuid-${excluded[1]}`], limit: 20 });
    assert.ok(similar.some(station => station._id === 'engine-alternative'));
    assert.ok(similar.every(station => station._id !== source[0] && station._id !== excluded[0]));
    const personalized = await engine.getPersonalizedSimilarStations({ sourceStationId: `uuid-${source[1]}`, sessionId: 'engine-session', minConfidence: 0, limit: 20 });
    assert.ok(personalized.length > 0); assert.ok(personalized.every(station => station.stationId !== source[0]));
    await engine.recordUserInteraction({ sessionId: 'engine-unknown', stationId: 'unknown-engine-id', listenDuration: 25, interactionType: 'play' });
    assert.equal((await pool.query("SELECT count(*) FROM listening_history WHERE session_id='engine-unknown'")).rows[0].count, '0');
    assert.deepEqual(await engine.getSimilarStations({ stationId: 'unknown-engine-id' }), []);
    assert.deepEqual(await engine.getPersonalizedSimilarStations({ sourceStationId: 'unknown-engine-id' }), []);
  });
});
