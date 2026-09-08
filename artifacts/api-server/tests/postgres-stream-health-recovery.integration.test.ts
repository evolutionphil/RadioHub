import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';
import pg from 'pg';
import { PostgresCatalogStore, catalogShape } from '../src/data/postgres-catalog-store';
import { getStreamRecoverySnapshot } from '../src/utils/station-health-recovery';

const connectionString = process.env.PG_TEST_DATABASE_URL;
if (connectionString) {
  const url = new URL(connectionString);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !/test/i.test(url.pathname) || url.search) {
    throw new Error('Health recovery fixture requires a loopback test database without URL options');
  }
}
describe('native reviewed stream-health CAS and preservation', { skip: !connectionString }, () => {
  const schema = `stream_health_${randomBytes(8).toString('hex')}`, id = 'a'.repeat(24);
  const admin = new pg.Pool({ connectionString, ssl: false, max: 1 });
  let pool: pg.Pool, store: PostgresCatalogStore;
  const evidence = () => ({ checkedAt: new Date().toISOString(), contentType: 'audio/mpeg', bytesRead: 1024 });
  const record = async () => (await pool.query('SELECT * FROM stations WHERE id=$1', [id])).rows[0];
  before(async () => {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new pg.Pool({ connectionString, ssl: false, max: 3, options: `-c search_path=${schema}` });
    await pool.query(`CREATE TABLE stations(id text PRIMARY KEY,name text,slug text,url text,url_resolved text,
      no_index boolean,last_check_ok boolean,last_check_time timestamptz,manual_edit_fields jsonb,redirect_to_slug text,
      slug_aliases text[],descriptions jsonb,logo_assets jsonb,average_rating real,total_ratings integer,votes integer,
      source jsonb,updated_at timestamptz);
      CREATE TABLE legacy_documents(document_id text PRIMARY KEY,payload jsonb,checksum text)`);
    store = new PostgresCatalogStore(pool);
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE stations,legacy_documents');
    const source = { lastCheckOkTime: '2024-01-01T00:00:00Z', lastLocalCheckTime: '2025-01-01T00:00:00Z',
      noIndex: true, lastCheckOk: false, arbitrary: { retained: ['value', 3] }, descriptions: { en: { full: 'Original full' } } };
    await pool.query(`INSERT INTO stations VALUES($1,'NRJ Oriental','nrj-oriental','https://example.invalid/raw','https://example.invalid/resolved',
      true,false,'2025-01-01T00:00:00Z','{}',NULL,ARRAY['old-nrj'],'{"de":{"full":"Localized text"}}',
      '{"status":"completed","original":"preserved"}',4.5,6,42,$2::jsonb,'2025-01-01T00:00:00Z')`, [id, JSON.stringify(source)]);
    await pool.query('INSERT INTO legacy_documents VALUES($1,$2::jsonb,$3)', [id, JSON.stringify(source), 'original-checksum']);
  });
  after(async () => {
    await pool?.end();
    try { assert.match(schema, /^stream_health_[a-f0-9]{16}$/); await admin.query(`DROP SCHEMA "${schema}" CASCADE`); }
    finally { await admin.end(); }
  });
  it('changes only declared health columns and3 source keys, retaining all archive/ratings/descriptions/aliases', async () => {
    const before = await record(), expected = getStreamRecoverySnapshot(catalogShape(before)), proof = evidence();
    const archive = (await pool.query('SELECT * FROM legacy_documents')).rows;
    const result = await store.recoverStreamHealth(id, expected, proof); assert.equal(result.status, 'updated');
    const after = await record();
    assert.equal(after.no_index, false); assert.equal(after.last_check_ok, true); assert.equal(after.last_check_time.toISOString(), proof.checkedAt);
    assert.deepEqual({ ...after, no_index: before.no_index, last_check_ok: before.last_check_ok, last_check_time: before.last_check_time, source: before.source, updated_at: before.updated_at }, before);
    assert.deepEqual(after.source, { ...before.source, lastCheckOkTime: proof.checkedAt, lastLocalCheckTime: proof.checkedAt,
      healthRecovery: { actor: 'admin-reviewed', previousSnapshot: expected, ...proof } });
    assert.deepEqual(after.manual_edit_fields, {});
    assert.deepEqual((await pool.query('SELECT * FROM legacy_documents')).rows, archive);
    assert.equal((await store.recoverStreamHealth(id, expected, evidence())).status, 'conflict');
  });
  for (const field of ['url', 'manual', 'redirect', 'health']) it(`concurrent ${field} edit fails CAS without mutation`, async () => {
    const expected = getStreamRecoverySnapshot(catalogShape(await record()));
    if (field === 'url') await pool.query("UPDATE stations SET url_resolved='https://example.invalid/changed'");
    if (field === 'manual') await pool.query("UPDATE stations SET manual_edit_fields='{" + '"noIndex":true' + "}'");
    if (field === 'redirect') await pool.query("UPDATE stations SET redirect_to_slug='other'");
    if (field === 'health') await pool.query('UPDATE stations SET last_check_ok=true');
    const current = await record();
    assert.equal((await store.recoverStreamHealth(id, expected, evidence())).status, 'conflict');
    assert.deepEqual(await record(), current);
  });
  it('freshly reviewed manual/redirect/codec records are rejected by repeated quality guard', async () => {
    for (const query of ["UPDATE stations SET manual_edit_fields='{" + '"noIndex":true' + "}'",
      "UPDATE stations SET manual_edit_fields='{}',redirect_to_slug='other'",
      "UPDATE stations SET redirect_to_slug=NULL,slug='nrj-aac'"]) {
      await pool.query(query); const current = await record();
      assert.equal((await store.recoverStreamHealth(id, getStreamRecoverySnapshot(catalogShape(current)), evidence())).status, 'rejected');
      assert.deepEqual(await record(), current);
    }
  });
  it('row-lock rechecks snapshot after a concurrent editor commits', async () => {
    const expected = getStreamRecoverySnapshot(catalogShape(await record())), editor = await pool.connect();
    let pending: Promise<any> | undefined;
    try {
      await editor.query('BEGIN'); await editor.query("UPDATE stations SET name='Concurrent editor' WHERE id=$1", [id]);
      pending = store.recoverStreamHealth(id, expected, evidence());
      await new Promise(resolve => setTimeout(resolve, 30)); await editor.query('COMMIT');
      assert.equal((await pending).status, 'conflict'); assert.equal((await record()).no_index, true);
    } finally { await editor.query('ROLLBACK'); editor.release(); if (pending) await pending; }
  });
  it('UPDATE failure rolls back health and audit together', async () => {
    await pool.query('ALTER TABLE stations ADD CONSTRAINT force_recovery_failure CHECK(no_index=true)');
    const current = await record();
    try { await assert.rejects(store.recoverStreamHealth(id, getStreamRecoverySnapshot(catalogShape(current)), evidence())); }
    finally { await pool.query('ALTER TABLE stations DROP CONSTRAINT force_recovery_failure'); }
    assert.deepEqual(await record(), current);
  });
  it('rejects stale/non-audio/incomplete evidence and reports missing IDs', async () => {
    const current = await record(), expected = getStreamRecoverySnapshot(catalogShape(current));
    for (const change of [{ checkedAt: 'invalid' }, { checkedAt: '2025-01-01T00:00:00Z' }, { contentType: 'text/html' }, { bytesRead: 0 }]) {
      assert.equal((await store.recoverStreamHealth(id, expected, { ...evidence(), ...change })).status, 'rejected');
    }
    assert.deepEqual(await record(), current);
    assert.equal((await store.recoverStreamHealth('b'.repeat(24), expected, evidence())).status, 'missing');
  });
});
