import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';
import pg from 'pg';
import { PostgresLogoVariantStore } from '../src/data/postgres-logo-variant-store';

const connectionString = process.env.PG_TEST_DATABASE_URL;
if (connectionString) {
  const url = new URL(connectionString);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !/test/i.test(url.pathname) || url.search) {
    throw new Error('Logo fixture requires an explicit loopback test database without URL options');
  }
}
describe('native logo variant CAS and immutable source', { skip: !connectionString }, () => {
  const schema = `logo_variant_${randomBytes(8).toString('hex')}`, id = '1234567890abcdef12345678';
  const admin = new pg.Pool({ connectionString, ssl: false, max: 1 });
  let pool: pg.Pool, store: PostgresLogoVariantStore;
  const assets = { status: 'completed', folder: 'radio', original: 'original.png', webp256: '256.webp',
    processedAt: '2026-05-19T00:00:00Z', operationId: 'preserve-operation', arbitrary: { nested: ['preserve', 1] } };
  before(async () => {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new pg.Pool({ connectionString, ssl: false, max: 3, options: `-c search_path=${schema}` });
    await pool.query(`CREATE TABLE stations(id text PRIMARY KEY,slug text,favicon text,country text,country_code text,
      slug_aliases text[],logo_assets jsonb,source jsonb,unrelated_counter integer,updated_at timestamptz);
      CREATE TABLE legacy_documents(document_id text PRIMARY KEY,payload jsonb,checksum text)`);
    store = new PostgresLogoVariantStore(pool);
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE stations,legacy_documents');
    await pool.query(`INSERT INTO stations VALUES($1,'radio',NULL,'Germany','DE',ARRAY['old-radio'],$2::jsonb,
      $3::jsonb,42,'2026-01-01T00:00:00Z')`, [id, JSON.stringify(assets), JSON.stringify({ logoAssets: assets, sourceOnly: 'immutable-original' })]);
    await pool.query('INSERT INTO legacy_documents VALUES($1,$2::jsonb,$3)', [id, JSON.stringify({ original: assets }), 'immutable-checksum']);
  });
  after(async () => {
    await pool?.end();
    try { assert.match(schema, /^logo_variant_[a-f0-9]{16}$/); await admin.query(`DROP SCHEMA "${schema}" CASCADE`); }
    finally { await admin.end(); }
  });
  it('adds missing fields only, preserving source, archive and every metadata sibling', async () => {
    const before = (await pool.query('SELECT *,source::text AS source_text FROM stations')).rows[0];
    const archive = (await pool.query('SELECT * FROM legacy_documents')).rows;
    const [station] = await store.findByIds([id]);
    assert.equal(await store.appendVariants(station, { webp48: 'https://safe.invalid/48.webp', webp96: 'https://safe.invalid/96.webp' }), true);
    const after = (await pool.query('SELECT *,source::text AS source_text FROM stations')).rows[0];
    assert.deepEqual(after.logo_assets, { ...assets, webp48: 'https://safe.invalid/48.webp', webp96: 'https://safe.invalid/96.webp' });
    assert.deepEqual({ ...after, logo_assets: before.logo_assets, updated_at: before.updated_at }, before);
    assert.deepEqual((await pool.query('SELECT * FROM legacy_documents')).rows, archive);
    assert.equal(await store.appendVariants(station, { webp48: 'https://safe.invalid/other.webp' }), false);
  });
  for (const field of ['favicon', 'sibling', 'status']) it(`rejects a concurrent ${field} change without replacing the changed row`, async () => {
    const [station] = await store.findByIds([id]);
    if (field === 'favicon') await pool.query("UPDATE stations SET favicon='new-admin-logo'");
    else await pool.query('UPDATE stations SET logo_assets=logo_assets||$1::jsonb', [JSON.stringify(field === 'sibling' ? { extra: true } : { status: 'processing' })]);
    const current = (await pool.query('SELECT * FROM stations')).rows[0];
    assert.equal(await store.appendVariants(station, { webp96: 'https://safe.invalid/96.webp' }), false);
    assert.deepEqual((await pool.query('SELECT * FROM stations')).rows[0], current);
  });
  it('waits for an in-flight row edit and then rechecks its exact before-image', async () => {
    const [station] = await store.findByIds([id]), editor = await pool.connect();
    await editor.query('BEGIN'); await editor.query("UPDATE stations SET favicon='concurrent-admin' WHERE id=$1", [id]);
    const pending = store.appendVariants(station, { webp96: 'https://safe.invalid/96.webp' });
    await new Promise(resolve => setTimeout(resolve, 30));
    await editor.query('COMMIT'); editor.release();
    assert.equal(await pending, false); assert.equal((await store.findByIds([id]))[0].favicon, 'concurrent-admin');
  });
  it('rejects overwrites, original256 edits and noncompleted input before mutation', async () => {
    const [station] = await store.findByIds([id]);
    await assert.rejects(store.appendVariants(station, { webp256: 'no' }));
    await assert.rejects(store.appendVariants(station, { original: 'no' }));
    await assert.rejects(store.appendVariants({ ...station, logoAssets: { ...assets, webp48: 'existing' } }, { webp48: 'no' }));
    await assert.rejects(store.appendVariants({ ...station, logoAssets: { ...assets, status: 'failed' } }, { webp96: 'no' }));
    assert.deepEqual((await store.findByIds([id]))[0].logoAssets, assets);
  });
});
