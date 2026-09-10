import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import pg from 'pg';
import { PostgresCatalogStore } from '../src/data/postgres-catalog-store';

const connectionString = process.env.PG_TEST_DATABASE_URL;
describe('native PostgreSQL lossless station merges', { skip: !connectionString }, () => {
  const schema = `station_merge_${process.pid}_${randomBytes(6).toString('hex')}`;
  const ssl = process.env.PG_TEST_SSL === 'require' ? { rejectUnauthorized: true } : false;
  const admin = new pg.Pool({ connectionString, ssl, max: 1 });
  let pool: pg.Pool, catalog: PostgresCatalogStore, created = false;
  before(async () => {
    await admin.query(`CREATE SCHEMA "${schema}"`); created = true;
    const url = new URL(connectionString!); url.searchParams.set('options', `-c search_path=${schema},public`);
    pool = new pg.Pool({ connectionString: url.toString(), ssl, max: 5 }); catalog = new PostgresCatalogStore(pool);
    const dir = path.resolve(import.meta.dirname, '../../../lib/db/migrations');
    for (const file of (await readdir(dir)).filter(file => /^\d+.*\.sql$/.test(file)).sort()) await pool.query(await readFile(path.join(dir, file), 'utf8'));
    await pool.query('CREATE TABLE merge_test_checkpoints(id text PRIMARY KEY)');
  });
  after(async () => {
    if (pool) await pool.end();
    try { if (created) { assert.match(schema, /^station_merge_\d+_[a-f0-9]{12}$/); await admin.query(`DROP SCHEMA "${schema}" CASCADE`); } }
    finally { await admin.end(); }
  });
  async function group(prefix: string, patches: Record<string, any>[] = [{}, {}]) {
    const docs = patches.map((patch, index) => ({ _id: `${prefix}-${index}`, stationuuid: `uuid-${prefix}-${index}`, name: `Fixture ${prefix} ${index}`,
      slug: `${prefix}-${index}`, country: 'Germany', countryCode: 'DE', url: `https://example.invalid/${prefix}`, votes: 10 - index, ...patch }));
    await catalog.insertMany(docs);
    await pool.query("UPDATE stations SET name='Radio One' WHERE id=ANY($1::text[])", [docs.map(doc => doc._id)]);
    return docs.map(doc => doc._id);
  }
  const count = async (table: string, ids: string[]) => Number((await pool.query(`SELECT count(*) FROM ${table} WHERE id=ANY($1::text[])`, [ids])).rows[0].count);

  it('archives every loser with a shared URL and preserves all translations and original metadata', async () => {
    const ids = await group('content', [
      { descriptions: { de: { full: 'Survivor German', meta: '' } }, manualEditFields: { name: true }, mergedUrls: ['https://example.invalid/historical'] },
      { descriptions: { de: { full: 'Conflicting donor German', meta: 'German meta' }, tr: { full: 'Türkçe', meta: 'Türkçe meta' } }, manualEditFields: { descriptions: true }, urlResolved: 'https://example.invalid/resolved', customUnmapped: { preserved: 'donor one' } },
      { descriptions: { ja: { full: '日本語', meta: '日本語メタ' } }, customUnmapped: { preserved: 'donor two' } },
    ]);
    await pool.query("INSERT INTO station_blacklist(id,url,name) VALUES('preexisting-content','https://example.invalid/content','Existing archive')");
    const result = await catalog.mergeDuplicates(ids, { requireSafeIdentity: true });
    assert.equal(result.deletedCount, 2); assert.equal(result.primary?._id, ids[0]);
    assert.deepEqual(result.primary?.descriptions, { de: { full: 'Survivor German', meta: 'German meta' }, tr: { full: 'Türkçe', meta: 'Türkçe meta' }, ja: { full: '日本語', meta: '日本語メタ' } });
    assert.equal(result.primary?.manualEditFields.name, true); assert.equal(result.primary?.manualEditFields.descriptions, true);
    assert.ok(result.primary?.mergedUrls.includes('https://example.invalid/historical')); assert.ok(result.primary?.mergedUrls.includes('https://example.invalid/resolved'));
    const archives = (await pool.query("SELECT source FROM station_blacklist WHERE source->'mergeAudit'->>'survivorId'=$1 ORDER BY station_uuid", [ids[0]])).rows;
    assert.equal(archives.length, 2);
    assert.equal(archives[0].source.descriptions.de.full, 'Conflicting donor German');
    assert.equal(archives[1].source.customUnmapped.preserved, 'donor two');
    assert.deepEqual(result.primary?.mergedStationIds, ids.slice(1));
    for (const id of ids.slice(1)) {
      assert.equal((await catalog.findMergedAlias(id))?._id, ids[0]);
      assert.equal((await catalog.findMergedAlias(`uuid-${id}`))?._id, ids[0]);
    }
    await catalog.updateProviderBatch([{ uuid: `uuid-${ids[0]}`, patch: { name: 'Provider overwrite', descriptions: {} } }]);
    assert.deepEqual((await catalog.findById(ids[0]))?.descriptions, result.primary?.descriptions);
    assert.equal((await catalog.findById(ids[0]))?.name, 'Radio One');
  });

  it('moves user references while retaining conflicting ratings in the archived snapshot', async () => {
    const ids = await group('refs');
    await pool.query("INSERT INTO users(id,username,email,full_name,source) VALUES('refs-u1','refs-u1','refs-u1@example.invalid','One',$1),('refs-u2','refs-u2','refs-u2@example.invalid','Two','{}')", [JSON.stringify({ untouched: true, recentlyPlayedStations: [
      { stationId: ids[1], playedAt: '2026-09-10', custom: 42 }, { stationId: ids[0], playedAt: '2026-09-09' }, 'unrelated',
    ] })]);
    await pool.query("INSERT INTO user_favorites(user_id,station_id,created_at) VALUES('refs-u1',$1,'2025-01-01T00:00:00Z'),('refs-u1',$2,'2024-01-01T00:00:00Z'),('refs-u2',$2,'2024-06-01T00:00:00Z')", ids);
    await pool.query("INSERT INTO station_ratings(id,station_id,user_id,rating,comment) VALUES('refs-r1',$1,'refs-u1',4,'Keep survivor'),('refs-r2',$2,'refs-u1',2,'Archive conflicting review'),('refs-r3',$2,'refs-u2',5,'Move review')", ids);
    await pool.query("INSERT INTO listening_history(id,session_id,station_id,station_name,interaction_type,listened_at,listen_duration) VALUES('refs-h','session',$1,'Old name','play',now(),99)", [ids[1]]);
    await pool.query("INSERT INTO listening_sessions(id,session_id,station_id,station_name,genre,country,language,duration,source) VALUES('refs-session','session',$1,'Old name','pop','Germany','de',42,'{\"custom\":true}')", [ids[1]]);
    await pool.query("INSERT INTO recommendation_events(id,station_id,station_name,recommendation_type,confidence,reason,liked) VALUES('refs-event',$1,'Old name','similar',90,'matching',now())", [ids[1]]);
    await pool.query("INSERT INTO analytics_events(id,event,station_id) VALUES('refs-analytics','play',$1)", [ids[1]]);
    await pool.query("INSERT INTO station_similarities(id,station_id_1,station_id_2,similarity_score,confidence,calculation_type,last_calculated) VALUES('refs-similar',$1,$2,0.8,0.9,'derived',now())", ids);
    await pool.query("INSERT INTO cast_sessions(id,session_id,user_id,status,current_station,expires_at) VALUES('refs-cast','cast','refs-u1','active',$1,now()+interval '1 day')", [JSON.stringify({ stationId: ids[1], streamUrl: 'https://example.invalid/current-live-playback' })]);
    await pool.query("INSERT INTO cast_commands(id,user_id,device_id,type,station,timestamp) VALUES('refs-command','refs-u1','device','cast:play',$1,1)", [JSON.stringify({ _id: ids[1], stationId: ids[1], retained: true })]);
    const result = await catalog.mergeDuplicates(ids, { requireSafeIdentity: true });
    assert.equal(result.primary?.totalRatings, 2); assert.equal(result.primary?.averageRating, 4.5);
    const favorites = (await pool.query("SELECT station_id,created_at FROM user_favorites WHERE user_id='refs-u1'")).rows;
    assert.equal(favorites.length, 1); assert.equal(favorites[0].station_id, ids[0]); assert.equal(favorites[0].created_at.toISOString().slice(0, 10), '2024-01-01');
    assert.equal((await pool.query("SELECT station_id,comment FROM station_ratings WHERE id='refs-r3'")).rows[0].station_id, ids[0]);
    const archived = (await pool.query('SELECT source FROM station_blacklist WHERE station_uuid=$1', [`uuid-${ids[1]}`])).rows[0].source;
    assert.deepEqual(archived.mergeAudit.ratings.map((rating: any) => rating.comment).sort(), ['Archive conflicting review', 'Move review']);
    for (const table of ['listening_history', 'listening_sessions', 'recommendation_events', 'analytics_events']) {
      assert.equal((await pool.query(`SELECT station_id FROM ${table} LIMIT 1`)).rows[0].station_id, ids[0]);
    }
    assert.equal((await pool.query("SELECT listen_duration FROM listening_history WHERE id='refs-h'")).rows[0].listen_duration, 99);
    assert.equal((await pool.query("SELECT count(*) FROM station_similarities WHERE id='refs-similar'")).rows[0].count, '0');
    const user = (await pool.query("SELECT source FROM users WHERE id='refs-u1'")).rows[0].source;
    assert.equal(user.untouched, true); assert.deepEqual(user.recentlyPlayedStations, [{ stationId: ids[0], playedAt: '2026-09-10', custom: 42 }, 'unrelated']);
    const cast = (await pool.query("SELECT current_station FROM cast_sessions WHERE id='refs-cast'")).rows[0].current_station;
    assert.equal(cast.stationId, ids[0]); assert.equal(cast.streamUrl, 'https://example.invalid/current-live-playback');
    assert.deepEqual((await pool.query("SELECT station FROM cast_commands WHERE id='refs-command'")).rows[0].station, { _id: ids[0], stationId: ids[0], retained: true });
  });

  it('rechecks safety after waiting for a concurrent edit and rejects missing members without merging a subset', async () => {
    const ids = await group('stale', [{ city: 'Berlin' }, { city: 'Berlin' }]);
    const editor = await pool.connect();
    try {
      await editor.query('BEGIN');
      await editor.query("UPDATE stations SET source=source||'{\"city\":\"Munich\"}'::jsonb WHERE id=$1", [ids[1]]);
      const merge = catalog.mergeDuplicates(ids, { requireSafeIdentity: true });
      await editor.query('COMMIT');
      await assert.rejects(merge, { code: 'UNSAFE_DUPLICATE_GROUP' });
    } finally { editor.release(); }
    assert.equal(await count('stations', ids), 2);
    await assert.rejects(catalog.mergeDuplicates([ids[0], 'missing-station'], { requireSafeIdentity: true }), { code: 'UNSAFE_DUPLICATE_GROUP' });
    assert.equal((await pool.query("SELECT count(*) FROM station_blacklist WHERE station_uuid=ANY($1::text[])", [ids.map(id => `uuid-${id}`)])).rows[0].count, '0');
  });

  it('shares the caller transaction so checkpoint and merge commit or roll back together', async () => {
    const ids = await group('transaction');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await catalog.mergeDuplicates(ids, { requireSafeIdentity: true, client });
      await client.query("INSERT INTO merge_test_checkpoints VALUES('rolled-back')");
      assert.equal(await count('stations', ids), 2);
      await client.query('ROLLBACK');
      assert.equal(await count('stations', ids), 2); assert.equal(await catalog.findMergedAlias(ids[1]), null);
      assert.equal((await pool.query('SELECT count(*) FROM merge_test_checkpoints')).rows[0].count, '0');
      await client.query('BEGIN');
      await catalog.mergeDuplicates(ids, { requireSafeIdentity: true, client });
      await client.query("INSERT INTO merge_test_checkpoints VALUES('committed')");
      await client.query('COMMIT');
      assert.equal((await client.query('SELECT 1 AS usable')).rows[0].usable, 1);
      assert.equal(await count('stations', ids), 1); assert.equal((await catalog.findMergedAlias(ids[1]))?._id, ids[0]);
      assert.equal((await pool.query('SELECT count(*) FROM merge_test_checkpoints')).rows[0].count, '1');
    } finally { client.release(); }
  });

  it('retargets every historical ID/UUID alias across later merges without chains', async () => {
    const ids = await group('chain', [{}, {}, { votes: 100 }]);
    await catalog.mergeDuplicates(ids.slice(0, 2), { requireSafeIdentity: true });
    const result = await catalog.mergeDuplicates([ids[0], ids[2]], { primaryId: ids[2], requireSafeIdentity: true });
    assert.equal(result.primary?._id, ids[2]);
    for (const id of ids.slice(0, 2)) {
      assert.equal((await catalog.findMergedAlias(id))?._id, ids[2]);
      assert.equal((await catalog.findMergedAlias(`uuid-${id}`))?._id, ids[2]);
    }
    assert.deepEqual(new Set(result.primary?.mergedStationIds), new Set(ids.slice(0, 2)));
    assert.equal((await pool.query('SELECT count(*) FROM station_merge_aliases WHERE station_id=$1', [ids[0]])).rows[0].count, '0');
  });

  it('rolls back content, archive and references on alias ownership conflicts', async () => {
    const ids = await group('conflict'); const other = (await group('unrelated'))[0];
    await pool.query('INSERT INTO station_merge_aliases(alias,station_id) VALUES($1,$2)', [ids[1], other]);
    await assert.rejects(catalog.mergeDuplicates(ids, { requireSafeIdentity: true }), { code: 'MERGE_ALIAS_CONFLICT' });
    assert.equal(await count('stations', ids), 2);
    assert.equal((await catalog.findMergedAlias(ids[1]))?._id, other);
    assert.equal((await pool.query('SELECT count(*) FROM station_blacklist WHERE station_uuid=$1', [`uuid-${ids[1]}`])).rows[0].count, '0');
    assert.deepEqual((await catalog.findById(ids[0]))?.descriptions, {});
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await assert.rejects(catalog.mergeDuplicates(ids, { requireSafeIdentity: true, client }), { code: 'MERGE_ALIAS_CONFLICT' });
      await client.query("INSERT INTO merge_test_checkpoints VALUES('handled-failed-merge')");
      await client.query('COMMIT');
      assert.equal(await count('stations', ids), 2);
      assert.equal((await pool.query('SELECT count(*) FROM station_blacklist WHERE station_uuid=$1', [`uuid-${ids[1]}`])).rows[0].count, '0');
    } finally { client.release(); }
  });

  it('overlapping safe merges cannot double count votes or delete a changed subset', async () => {
    const ids = await group('concurrent');
    const results = await Promise.allSettled([catalog.mergeDuplicates(ids, { requireSafeIdentity: true }), catalog.mergeDuplicates([...ids].reverse(), { requireSafeIdentity: true })]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter(result => result.status === 'rejected' && result.reason.code === 'UNSAFE_DUPLICATE_GROUP').length, 1);
    assert.equal((await catalog.findById(ids[0]))?.votes, 19);
    assert.equal(await count('stations', ids), 1);
  });

  it('preserves explicit manual merging while clearing stale verification for a newly chosen URL', async () => {
    const ids = await group('manual', [{ urlResolved: 'https://example.invalid/obsolete', availabilityOutcome: 'healthy', availabilityCheckedAt: new Date() }, { city: 'Other city' }]);
    await pool.query("UPDATE stations SET name='Different explicit selection' WHERE id=$1", [ids[1]]);
    await pool.query("INSERT INTO station_stream_health(station_id,failure_count,first_failure_at,lease_token,lease_until) VALUES($1,1,now(),'old-lease',now()+interval '1 hour')", [ids[0]]);
    const result = await catalog.mergeDuplicates(ids, { primaryId: ids[0], validateGroup: false, patch: { url: 'https://example.invalid/manual-repair' } });
    assert.equal(result.deletedCount, 1); assert.equal(result.primary?.urlResolved, '');
    assert.equal(result.primary?.availabilityOutcome, 'inconclusive'); assert.equal(result.primary?.manualEditFields.url, true);
    assert.ok(result.primary?.mergedUrls.includes('https://example.invalid/obsolete'));
    assert.ok(result.primary?.mergedUrls.includes('https://example.invalid/manual-repair'));
    const queue = (await pool.query('SELECT failure_count,lease_token FROM station_stream_health WHERE station_id=$1', [ids[0]])).rows[0];
    assert.equal(queue.failure_count, 0); assert.equal(queue.lease_token, null);
  });
});
