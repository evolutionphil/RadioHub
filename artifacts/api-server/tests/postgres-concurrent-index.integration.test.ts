import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import pg from 'pg';
import { applyPostgresMigrations } from '../scripts/apply-postgres-migrations.mjs';

test('two real startup replicas serialize a concurrent index and safely resume a missing checksum',
  { skip: !process.env.PG_TEST_DATABASE_URL }, async () => {
    const schema = 'concurrent_index_' + randomBytes(6).toString('hex');
    const base = new URL(process.env.PG_TEST_DATABASE_URL!);
    const admin = new pg.Pool({ connectionString: base.href, ssl: false, max: 1 });
    const scoped = new URL(base); scoped.searchParams.set('options', '-c search_path=' + schema + ',public');
    const pool = new pg.Pool({ connectionString: scoped.href, ssl: false, max: 1 });
    const directory = await mkdtemp(path.join(os.tmpdir(), 'radiohub-concurrent-index-'));
    try {
      await admin.query('CREATE SCHEMA ' + schema);
      await pool.query("CREATE TABLE stations(id text PRIMARY KEY,source jsonb); INSERT INTO stations VALUES('one','{\"genre\":\"rock\"}')");
      const migration = await readFile(new URL('../../../lib/db/migrations/0027_station_source_genre_search.sql', import.meta.url), 'utf8');
      await writeFile(path.join(directory, '0027_station_source_genre_search.sql'), migration);
      const settings = { environment: { DATABASE_URL: scoped.href, POSTGRES_SSL: 'disable' }, migrationsDirectory: directory, log() {} };
      const settled = await Promise.allSettled([applyPostgresMigrations(settings), applyPostgresMigrations(settings)]);
      const results = settled.map(result => { if (result.status === 'rejected') throw result.reason; return result.value; });
      assert.equal(results.reduce((sum, result) => sum + result.applied, 0), 1);
      assert.equal(results.reduce((sum, result) => sum + result.skipped, 0), 1);
      assert.deepEqual((await pool.query("SELECT indisvalid,indisready FROM pg_index WHERE indexrelid='stations_source_genre_trgm_idx'::regclass")).rows,
        [{ indisvalid: true, indisready: true }]);
      // Simulate interruption after CREATE completed but before checksum INSERT.
      await pool.query('DELETE FROM radiohub_schema_migrations');
      assert.deepEqual(await applyPostgresMigrations(settings), { applied: 1, skipped: 0 });
      assert.equal(Number((await pool.query('SELECT count(*) FROM stations')).rows[0].count), 1);
    } finally {
      await pool.end();
      assert.match(schema, /^concurrent_index_[a-f0-9]{12}$/);
      await admin.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE'); await admin.end();
      assert.ok(directory.startsWith(path.join(os.tmpdir(), 'radiohub-concurrent-index-')));
      await rm(directory, { recursive: true, force: true });
    }
  });
