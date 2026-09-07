import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import pg from 'pg';
import { bsonSafe, checksum, jsonSafe, normalizeNativeDomains, pruneNativeDomains, verifyNativeDomains }
  from '@workspace/legacy-migration/migrate-mongo-to-postgres';
import { assertNoQuarantineReplay, quarantineUserDevice, userDeviceOwner, verifyUserDeviceQuarantine }
  from '../../../lib/legacy-migration/src/user-device-quarantine';
import { isVerifiedImport, readBootstrapState } from '../../../lib/legacy-migration/src/auto-bootstrap-postgres';

const connectionString = process.env.PG_TEST_DATABASE_URL;
describe('Offline missing-owner device quarantine', { skip: !connectionString }, () => {
  const schema = `device_quarantine_test_${process.pid}_${randomBytes(6).toString('hex')}`;
  const admin = new pg.Pool({ connectionString, ssl: false, max: 1 });
  const pool = new pg.Pool({ connectionString, ssl: false, max: 3, options: `-c search_path=${schema},public` });
  let created = false;
  const devices = [
    { _id: 'device-valid', userId: 'user-present', deviceId: 'tv-valid', deviceName: 'Valid TV', isActive: true },
    { _id: 'device-orphan-active', userId: 'user-missing-a', deviceId: 'tv-orphan-a', deviceName: 'Historical TV', isActive: true, originalDetail: { retained: true } },
    { _id: 'device-orphan-inactive', userId: 'user-missing-b', deviceId: 'tv-orphan-b', deviceName: 'Inactive TV', isActive: false },
  ].map(row => ({ ...row, platform: 'webos', pairedAt: '2020-01-01T00:00:00.000Z', lastSeenAt: '2020-01-01T00:00:00.000Z' }));
  const sourceUser = { _id: 'user-present', username: 'present', email: 'present@example.invalid' };
  async function mirror(collection: string, document: Record<string, any>) {
    const payload = jsonSafe(document), bson = bsonSafe(document);
    await pool.query(`INSERT INTO legacy_documents(collection_name,document_id,payload,checksum,bson_payload,bson_checksum,last_seen_run_id)
      VALUES ($1,$2,$3,$4,$5,$6,'fixture') ON CONFLICT(collection_name,document_id) DO UPDATE
      SET payload=EXCLUDED.payload,checksum=EXCLUDED.checksum,bson_payload=EXCLUDED.bson_payload,bson_checksum=EXCLUDED.bson_checksum`,
    [collection,document._id,payload,checksum(payload),bson,checksum(bson)]);
  }
  async function runPhase(phase: string, extra: Record<string, string> = {}) {
    const url = new URL(connectionString!);
    url.searchParams.set('options', `-c search_path=${schema},public`);
    const environment: NodeJS.ProcessEnv = {};
    for (const [key,value] of Object.entries(process.env)) {
      if (/^(?:PATH|PATHEXT|SYSTEMROOT|WINDIR|TEMP|TMP|LANG|LC_ALL)$/i.test(key)) environment[key] = value;
    }
    Object.assign(environment, { NODE_ENV:'test', DATABASE_URL:url.toString(), POSTGRES_SSL:'disable',
      MIGRATION_TARGET_WRITERS_STOPPED:'true', ...extra });
    return new Promise<{ code: number | null; output: string }>((resolve, reject) => {
      const child = spawn(process.execPath, ['--import', pathToFileURL(path.resolve(import.meta.dirname, '../node_modules/tsx/dist/loader.mjs')).href,
        path.resolve(import.meta.dirname, '../../../lib/legacy-migration/src/migrate-mongo-to-postgres.ts'), `--phase=${phase}`],
      { cwd:path.resolve(import.meta.dirname,'..'), env:environment, windowsHide:true, stdio:['ignore','pipe','pipe'] });
      let output = '';
      child.stdout.on('data', chunk => { output += chunk; });
      child.stderr.on('data', chunk => { output += chunk; });
      child.once('error', reject);
      child.once('exit', code => resolve({ code,output }));
    });
  }
  before(async () => {
    const url = new URL(connectionString!);
    assert.ok(['127.0.0.1','[::1]'].includes(url.hostname), 'Only literal loopback PostgreSQL is allowed');
    assert.match(decodeURIComponent(url.pathname.slice(1)), /(?:^|[_-])(?:test|tests|validation)(?:$|[_-])/i);
    assert.equal(url.search, '', 'Connection options cannot override the isolated schema');
    assert.match(schema, /^device_quarantine_test_\d+_[a-f0-9]{12}$/);
    await admin.query(`CREATE SCHEMA "${schema}"`); created = true;
    const directory = path.resolve(import.meta.dirname, '../../../lib/db/migrations');
    for (const file of (await readdir(directory)).filter(file => /^\d+.*\.sql$/.test(file)).sort()) {
      await pool.query(await readFile(path.join(directory, file), 'utf8'));
    }
  });
  beforeEach(async () => {
    assert.match(schema, /^device_quarantine_test_\d+_[a-f0-9]{12}$/);
    await pool.query(`TRUNCATE "${schema}".migration_quarantine,"${schema}".legacy_documents,"${schema}".users CASCADE`);
    await mirror('users', sourceUser);
    await pool.query("INSERT INTO users(id,username,email,full_name) VALUES ('user-present','present','present@example.invalid','Present')");
    for (const item of devices) await mirror('userdevices', item);
  });
  after(async () => {
    await pool.end();
    try { if (created) { assert.match(schema, /^device_quarantine_test_\d+_[a-f0-9]{12}$/); await admin.query(`DROP SCHEMA "${schema}" CASCADE`); } }
    finally { await admin.end(); }
  });

  it('preserves exact capture union and original active flags without creating runtime orphan devices or users', async () => {
    const original = (await pool.query("SELECT document_id,checksum,bson_checksum,payload,bson_payload FROM legacy_documents WHERE collection_name='userdevices' ORDER BY document_id")).rows;
    await normalizeNativeDomains(pool);
    await verifyNativeDomains(pool);
    const quarantine = (await pool.query('SELECT * FROM migration_quarantine ORDER BY document_id')).rows;
    assert.equal(quarantine.length, 2);
    assert.deepEqual(quarantine.map(row => row.original_owner_id), ['user-missing-a','user-missing-b']);
    assert.deepEqual(await verifyUserDeviceQuarantine(pool), { native: 1, quarantined: 2, source: 3 });
    assert.equal((await pool.query('SELECT count(*)::int count FROM users')).rows[0].count, 1);
    assert.equal((await pool.query("SELECT count(*)::int count FROM user_devices WHERE user_id LIKE 'user-missing%' AND is_active=true")).rows[0].count, 0);
    assert.deepEqual((await pool.query("SELECT document_id,checksum,bson_checksum,payload,bson_payload FROM legacy_documents WHERE collection_name='userdevices' ORDER BY document_id")).rows, original);
    await normalizeNativeDomains(pool);
    await verifyNativeDomains(pool);
    assert.deepEqual((await pool.query('SELECT * FROM migration_quarantine ORDER BY document_id')).rows, quarantine);
  });

  it('keeps runtime owner NOT NULL and FK constraints intact and capture deletion restricted', async () => {
    await normalizeNativeDomains(pool);
    await assert.rejects(pool.query("INSERT INTO user_devices(id,user_id,device_id,device_name) VALUES ('bad',NULL,'tv','TV')"), (e: any) => e.code === '23502');
    await assert.rejects(pool.query("INSERT INTO user_devices(id,user_id,device_id,device_name) VALUES ('bad','absent','tv','TV')"), (e: any) => e.code === '23503');
    await assert.rejects(pool.query("DELETE FROM legacy_documents WHERE collection_name='userdevices' AND document_id='device-orphan-active'"), (e: any) => e.code === '23503');
  });

  it('refuses malformed/missing owner references and missing normalized source owners', async () => {
    for (const owner of ['',null,{},123,' white-space ']) await assert.rejects(userDeviceOwner(pool, owner), /malformed/);
    await pool.query("DELETE FROM users WHERE id='user-present'");
    await assert.rejects(userDeviceOwner(pool, 'user-present'), /source owner was not normalized/);
    await mirror('userdevices', { ...devices[1], deviceName: null });
    await assert.rejects(normalizeNativeDomains(pool), /required field deviceName/);
    assert.equal((await pool.query('SELECT count(*)::int count FROM migration_quarantine')).rows[0].count, 0);
  });

  it('rejects unexpected quarantine and never uses it to hide an existing valid owner', async () => {
    await normalizeNativeDomains(pool);
    await pool.query(`INSERT INTO migration_quarantine(collection_name,document_id,reason,original_owner_id,source_checksum,source_bson_checksum)
      SELECT collection_name,document_id,'missing_user',payload->>'userId',checksum,bson_checksum FROM legacy_documents
      WHERE collection_name='userdevices' AND document_id='device-valid'`);
    await assert.rejects(verifyNativeDomains(pool), /quarantine identity parity/);
    await assert.rejects(normalizeNativeDomains(pool), /Previously quarantined device owner changed/);
  });

  it('detects manipulated recorded checksums and does not overwrite evidence on retry', async () => {
    await normalizeNativeDomains(pool);
    await pool.query("UPDATE migration_quarantine SET source_checksum=repeat('0',64) WHERE document_id='device-orphan-active'");
    await assert.rejects(verifyNativeDomains(pool), /quarantine content\/ownership/);
    await assert.rejects(normalizeNativeDomains(pool), /quarantine content\/ownership/);
    assert.equal((await pool.query("SELECT source_checksum FROM migration_quarantine WHERE document_id='device-orphan-active'")).rows[0].source_checksum, '0'.repeat(64));
  });

  it('detects changed capture contents even if its checksum is recomputed', async () => {
    await normalizeNativeDomains(pool);
    await mirror('userdevices', { ...devices[1], originalDetail: { retained: false } });
    await assert.rejects(verifyNativeDomains(pool), /quarantine content\/ownership/);
    await assert.rejects(normalizeNativeDomains(pool), /quarantine content\/ownership/);
  });

  it('refuses source-owner revival and capture replay/pruning while preserving quarantine history', async () => {
    await normalizeNativeDomains(pool);
    await assert.rejects(assertNoQuarantineReplay(pool), /replay\/pruning refused/);
    await assert.rejects(pruneNativeDomains(pool), /replay\/pruning refused/);
    await mirror('users', { _id: 'user-missing-a', username: 'restored', email: 'restored@example.invalid' });
    await assert.rejects(verifyNativeDomains(pool), /source owner was not normalized/);
    await pool.query("INSERT INTO users(id,username,email,full_name) VALUES ('user-missing-a','restored','restored@example.invalid','Restored')");
    await assert.rejects(normalizeNativeDomains(pool), /Previously quarantined device owner changed/);
    assert.equal((await pool.query("SELECT count(*)::int count FROM user_devices WHERE user_id='user-missing-a'")).rows[0].count, 0);
    assert.equal((await pool.query('SELECT count(*)::int count FROM migration_quarantine')).rows[0].count, 2);
  });

  it('never quarantines an already materialized runtime device', async () => {
    await pool.query("INSERT INTO user_devices(id,user_id,device_id,device_name) VALUES ('device-orphan-active','user-present','known-tv','Known TV')");
    await assert.rejects(quarantineUserDevice(pool, devices[1]), /existing runtime device/);
    assert.equal((await pool.query('SELECT count(*)::int count FROM migration_quarantine')).rows[0].count, 0);
  });

  it('preserves reviewed stale-device pruning when no quarantine exists', async () => {
    await pool.query("DELETE FROM legacy_documents WHERE collection_name='userdevices' AND document_id LIKE 'device-orphan-%'");
    await pool.query("INSERT INTO user_devices(id,user_id,device_id,device_name) VALUES ('stale-device','user-present','stale-tv','Stale TV')");
    await normalizeNativeDomains(pool);
    assert.equal((await pool.query('SELECT count(*)::int count FROM user_devices')).rows[0].count, 2);
    await pruneNativeDomains(pool);
    await verifyNativeDomains(pool);
    assert.deepEqual(await verifyUserDeviceQuarantine(pool), { native: 1, quarantined: 0, source: 1 });
  });

  it('supports explicit normalize then verify CLI recovery without Mongo replay and retains durable authority fencing', async () => {
    await normalizeNativeDomains(pool);
    await pool.query(`INSERT INTO migration_checkpoints(collection_name,documents_processed,source_count,target_count,status)
      VALUES ('users',1,1,1,'complete'),('userdevices',3,3,3,'complete')`);
    const captures = (await pool.query('SELECT collection_name,document_id,checksum,bson_checksum FROM legacy_documents ORDER BY collection_name,document_id')).rows;
    const replay = await runPhase('all', { MONGODB_URI:'mongodb://127.0.0.1:1/never-contacted' });
    assert.equal(replay.code, 1);
    assert.match(replay.output, /Capture replay\/pruning refused/);
    assert.doesNotMatch(replay.output, /ECONNREFUSED|ServerSelection/);
    const normalize = await runPhase('normalize');
    assert.equal(normalize.code, 0, normalize.output);
    assert.equal(isVerifiedImport(await readBootstrapState(pool)), false, 'Normalization alone must not open application startup');
    const verification = await runPhase('verify');
    assert.equal(verification.code, 0, verification.output);
    assert.equal(isVerifiedImport(await readBootstrapState(pool)), true);
    assert.deepEqual((await pool.query('SELECT collection_name,document_id,checksum,bson_checksum FROM legacy_documents ORDER BY collection_name,document_id')).rows, captures);
    await pool.query("INSERT INTO database_write_authority(domain,authority) VALUES ('USER_STORE','postgres')");
    const owned = await runPhase('normalize');
    assert.equal(owned.code, 1);
    assert.match(owned.output, /durable PostgreSQL write authority exists/);
  });
});
