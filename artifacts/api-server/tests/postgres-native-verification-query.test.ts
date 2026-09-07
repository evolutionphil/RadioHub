import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, it, test } from 'node:test';
import pg from 'pg';
import { nativeVerificationQuery } from '@workspace/legacy-migration/migrate-mongo-to-postgres';

test('native verification indexes only explicit non-null keys and keeps content null-safe and parameterized', () => {
  const row = { id: "id-'quoted", title: null, details: { x: [null,1] }, total: '9223372036854775807' };
  const query = nativeVerificationQuery('fixture', row);
  assert.equal(query.text, 'SELECT 1 FROM "fixture" WHERE "id" = $1 AND "title" IS NOT DISTINCT FROM $2 AND "details" IS NOT DISTINCT FROM $3 AND "total" IS NOT DISTINCT FROM $4');
  assert.deepEqual(query.values, Object.values(row));
  assert.doesNotMatch(query.text, /quoted/);
});

test('native verification refuses missing/null/ignored lookup keys instead of silently scanning content', () => {
  for (const row of [{ title:'missing' }, { id:null }, { id:undefined }]) {
    assert.throws(() => nativeVerificationQuery('fixture', row), /every non-null lookup key/);
  }
  assert.throws(() => nativeVerificationQuery('fixture', { id:'x' }, []), /every non-null lookup key/);
  assert.throws(() => nativeVerificationQuery('fixture', { id:'x' }, ['id'], ['id']), /every non-null lookup key/);
  assert.throws(() => nativeVerificationQuery('bad;table', { id:'x' }), /Invalid internal migration identifier/);
});

test('singleton lookup uses its primary key while physical ID remains a checked content field', () => {
  const query = nativeVerificationQuery('tv_version_config', { singleton:true, id:'source-id', latest:'{}' }, ['singleton']);
  assert.match(query.text, /"singleton" = \$1/);
  assert.match(query.text, /"id" IS NOT DISTINCT FROM \$2/);
});

const connectionString = process.env.PG_TEST_DATABASE_URL;
describe('Native verification PostgreSQL index plans and null parity', { skip:!connectionString }, () => {
  const schema = `native_verify_test_${process.pid}_${randomBytes(6).toString('hex')}`;
  const admin = new pg.Pool({ connectionString, ssl:false, max:1 });
  const pool = new pg.Pool({ connectionString, ssl:false, max:2, options:`-c search_path=${schema},public` });
  let created = false;
  function nodes(plan: any): any[] { return [plan, ...(plan.Plans || []).flatMap(nodes)]; }
  async function planFor(query: { text:string; values:unknown[] }) {
    return (await pool.query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+query.text, query.values)).rows[0]['QUERY PLAN'][0].Plan;
  }
  before(async () => {
    const url = new URL(connectionString!);
    assert.ok(['127.0.0.1','[::1]'].includes(url.hostname), 'Only literal loopback PostgreSQL is permitted');
    assert.match(decodeURIComponent(url.pathname.slice(1)), /(?:^|[_-])(?:test|tests|validation)(?:$|[_-])/i);
    assert.equal(url.search, '', 'Test connection must not override schema/host through query options');
    assert.match(schema, /^native_verify_test_\d+_[a-f0-9]{12}$/);
    await admin.query(`CREATE SCHEMA "${schema}"`); created = true;
    const directory = path.resolve(import.meta.dirname, '../../../lib/db/migrations');
    for (const file of (await readdir(directory)).filter(file => /^\d+.*\.sql$/.test(file)).sort()) {
      await pool.query(await readFile(path.join(directory, file), 'utf8'));
    }
    // BSON dates have millisecond precision; do not introduce PostgreSQL-only
    // now() microseconds that a JavaScript Date roundtrip would truncate.
    await pool.query(`INSERT INTO gsc_url_inspections(id,url,language,url_group,discovered_at,updated_at)
      SELECT 'inspection-'||n,'https://example.invalid/'||n,'en','station','2026-01-01T00:00:00.123Z','2026-01-01T00:00:00.123Z' FROM generate_series(1,5000) n`);
    await pool.query(`INSERT INTO tv_telemetry_daily(id,day,plat,src,v,count,updated_at)
      SELECT 'physical-'||n,'day-'||(n/100),'platform-'||(n%10),'remote','version-'||((n%100)/10),n,'2026-01-01T00:00:00.123Z' FROM generate_series(1,5000) n`);
    await pool.query("INSERT INTO tv_version_config(singleton,id,latest,minimum,release_notes,store_url,updated_at) VALUES (true,'version-id','{}','{}','{}','{}','2026-01-01T00:00:00.123Z')");
    await pool.query('ANALYZE gsc_url_inspections');
    await pool.query('ANALYZE tv_telemetry_daily');
  });
  after(async () => {
    await pool.end();
    try { if (created) { assert.match(schema, /^native_verify_test_\d+_[a-f0-9]{12}$/); await admin.query(`DROP SCHEMA "${schema}" CASCADE`); } }
    finally { await admin.end(); }
  });

  it('uses a primary-key Index Cond for complete native content instead of a filtered whole-table scan', async () => {
    const row = (await pool.query("SELECT * FROM gsc_url_inspections WHERE id='inspection-2500'")).rows[0];
    const current = nativeVerificationQuery('gsc_url_inspections', row);
    const old = { ...current, text:current.text.replace('"id" = $1','"id" IS NOT DISTINCT FROM $1') };
    assert.equal((await pool.query(current.text,current.values)).rowCount, 1);
    assert.deepEqual((await pool.query(current.text,current.values)).rows, (await pool.query(old.text,old.values)).rows);
    const currentNodes = nodes(await planFor(current)), oldNodes = nodes(await planFor(old));
    assert.ok(currentNodes.some(node => node['Index Name'] === 'gsc_url_inspections_pkey' && /id =/.test(node['Index Cond'] || '')));
    assert.ok(currentNodes.every(node => node['Node Type'] !== 'Seq Scan'));
    assert.ok(oldNodes.every(node => !node['Index Cond']), 'Original null-safe key must demonstrate the missing Index Cond');
    assert.ok(oldNodes.some(node => Number(node['Rows Removed by Filter']) >= 4999));
  });

  it('still detects null/non-null content changes and wrong identities', async () => {
    const row = (await pool.query("SELECT * FROM gsc_url_inspections WHERE id='inspection-2500'")).rows[0];
    assert.equal(row.google_canonical, null);
    for (const variant of [row, { ...row,google_canonical:'https://example.invalid/changed' }, { ...row,id:'absent' }]) {
      const query = nativeVerificationQuery('gsc_url_inspections', variant);
      assert.equal((await pool.query(query.text,query.values)).rowCount, variant === row ? 1 : 0);
    }
    await pool.query("UPDATE gsc_url_inspections SET google_canonical='https://example.invalid/native' WHERE id='inspection-2500'");
    const stale = nativeVerificationQuery('gsc_url_inspections', row);
    assert.equal((await pool.query(stale.text,stale.values)).rowCount, 0, 'Expected null must not match changed non-null content');
  });

  it('uses the non-null telemetry natural-key index and preserves intentionally different physical IDs', async () => {
    const row = (await pool.query("SELECT * FROM tv_telemetry_daily WHERE id='physical-2500'")).rows[0];
    const query = nativeVerificationQuery('tv_telemetry_daily', { ...row,id:'different-source-id' }, ['day','plat','src','v'], ['id']);
    assert.doesNotMatch(query.text, /"id"/);
    assert.equal((await pool.query(query.text,query.values)).rowCount, 1);
    const plans = nodes(await planFor(query));
    assert.ok(plans.some(node => node['Index Name'] === 'tv_telemetry_daily_day_plat_src_v_key' && ['day','plat','src','v'].every(key => node['Index Cond']?.includes(key+' ='))));
    const changed = nativeVerificationQuery('tv_telemetry_daily', { ...row,count:'99999' }, ['day','plat','src','v'], ['id']);
    assert.equal((await pool.query(changed.text,changed.values)).rowCount, 0);
    assert.throws(() => nativeVerificationQuery('tv_telemetry_daily', { ...row,v:null }, ['day','plat','src','v'], ['id']), /every non-null lookup key/);
  });

  it('keeps singleton ID content parity and validates every special lookup key is NOT NULL in the actual schema', async () => {
    const row = (await pool.query('SELECT * FROM tv_version_config')).rows[0];
    const query = nativeVerificationQuery('tv_version_config', { ...row,latest:JSON.stringify(row.latest),minimum:JSON.stringify(row.minimum),
      release_notes:JSON.stringify(row.release_notes),store_url:JSON.stringify(row.store_url) }, ['singleton']);
    assert.equal((await pool.query(query.text,query.values)).rowCount, 1);
    const changed = nativeVerificationQuery('tv_version_config', { singleton:true,id:'wrong-id' }, ['singleton']);
    assert.equal((await pool.query(changed.text,changed.values)).rowCount, 0);
    for (const [table,keys] of [['gsc_url_inspections',['id']],['runtime_app_state',['key']],['tv_version_config',['singleton']],['tv_telemetry_daily',['day','plat','src','v']]] as const) {
      const found = (await pool.query(`SELECT a.attname,a.attnotnull FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
        JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relname=$2 AND a.attname=ANY($3::text[])`,[schema,table,keys])).rows;
      assert.equal(found.length,keys.length);
      assert.ok(found.every(column => column.attnotnull));
    }
  });
});
