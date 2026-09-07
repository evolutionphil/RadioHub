import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { forEachLegacyBatch } from '@workspace/legacy-migration/migrate-mongo-to-postgres';
import { lockedMigrationDatabase, MigrationLifecycleError } from '../../../lib/legacy-migration/src/migration-lifecycle';

type Row = { document_id: string; payload: Record<string, unknown> };

function fakeDatabase(pages: Row[][], options: { commitError?: Error } = {}) {
  const queries: { sql: string; values?: unknown[] }[] = [];
  let page = 0;
  let releases = 0;
  const client = Object.assign(new EventEmitter(), {
    async query(sql: string, values?: unknown[]) {
      queries.push({ sql, values });
      if (sql.startsWith('SELECT document_id,payload')) {
        const rows = pages[page++] || [];
        return { rows, rowCount: rows.length };
      }
      if (sql === 'COMMIT' && options.commitError) throw options.commitError;
      return { rows: [], rowCount: 0 };
    },
    release() { releases++; },
  });
  const database = { query: client.query.bind(client), async connect() { return client; } } as any;
  return { database, client, queries, releases: () => releases };
}

test('legacy batch cursor preserves returned ordering and advances by stored ID only after committed work', async () => {
  const first = [
    { document_id: '', payload: { _id: 'not-the-cursor', n: 1 } },
    { document_id: 'ä', payload: { _id: 'also-not-the-cursor', n: 2 } },
  ];
  const second = [{ document_id: 'z', payload: { _id: 'third', n: 3 } }];
  const fixture = fakeDatabase([first, second, []]);
  const visited: unknown[] = [];
  await forEachLegacyBatch(fixture.database, 'private-fixture', async (rows, client) => {
    assert.equal(client, fixture.client);
    visited.push(...rows);
    assert.equal(fixture.queries.at(-1)?.sql, 'BEGIN');
  });
  assert.deepEqual(visited, [...first, ...second].map(row => row.payload));
  const reads = fixture.queries.filter(query => query.sql.startsWith('SELECT'));
  assert.deepEqual(reads.map(query => query.values), [
    ['private-fixture', null, 250], ['private-fixture', 'ä', 250], ['private-fixture', 'z', 250],
  ]);
  assert.ok(reads.every(query => !/\bOFFSET\b/i.test(query.sql)));
  assert.ok(reads.every(query => /\$2::text IS NULL OR document_id>\$2/.test(query.sql)));
  assert.deepEqual(fixture.queries.filter(query => !query.sql.startsWith('SELECT')).map(query => query.sql), ['BEGIN', 'COMMIT', 'BEGIN', 'COMMIT']);
  assert.equal(fixture.releases(), 2);
});

test('empty legacy collection does not lease a connection or run callback work', async () => {
  const fixture = fakeDatabase([[]]);
  await forEachLegacyBatch(fixture.database, 'empty', async () => assert.fail('unexpected callback'));
  assert.equal(fixture.queries.length, 1);
  assert.equal(fixture.releases(), 0);
});

for (const failure of ['callback', 'commit'] as const) {
  test(`legacy batch ${failure} failure rolls back and stops without fetching or replaying another page`, async () => {
    const error = new Error(`injected ${failure} failure`);
    const fixture = fakeDatabase([[{ document_id: '', payload: { _id: '' } }], [{ document_id: 'later', payload: { _id: 'later' } }]],
      failure === 'commit' ? { commitError: error } : {});
    let callbacks = 0;
    await assert.rejects(forEachLegacyBatch(fixture.database, 'fixture', async () => {
      callbacks++;
      if (failure === 'callback') throw error;
    }), caught => caught === error);
    assert.equal(callbacks, 1);
    assert.equal(fixture.queries.filter(query => query.sql.startsWith('SELECT')).length, 1);
    assert.equal(fixture.queries.at(-1)?.sql, 'ROLLBACK');
    assert.equal(fixture.releases(), 1);
  });
}

test('keyset batch work keeps the lock-owning session and cannot commit after coordinator loss', async () => {
  const fixture = fakeDatabase([[{ document_id: '', payload: { _id: '' } }]]);
  const interruption = new MigrationLifecycleError('coordinator');
  let interrupted = false;
  const database = lockedMigrationDatabase(fixture.client as any, {
    assertHealthy() { if (interrupted) throw interruption; },
  });
  await assert.rejects(forEachLegacyBatch(database, 'fixture', async () => { interrupted = true; }), caught => caught === interruption);
  assert.deepEqual(fixture.queries.filter(query => !query.sql.startsWith('SELECT')).map(query => query.sql), ['BEGIN', 'ROLLBACK']);
  assert.equal(fixture.queries.filter(query => query.sql.startsWith('SELECT')).length, 1);
  assert.equal(fixture.releases(), 0, 'lease release must not return the lock-owning client to its pool');
});

const connectionString = process.env.PG_TEST_DATABASE_URL;
describe('native PostgreSQL legacy keyset pagination', { skip: !connectionString }, () => {
  let pool: pg.Pool;
  let admin: pg.Pool;
  let created = false;
  const schema = `batch_keyset_test_${process.pid}_${randomBytes(6).toString('hex')}`;
  const identifiers = ['', 'a', 'A', 'ä', 'z', 'Z', 'I', 'ı', 'İ', 'ß', '中', '🙂', "quote'", 'slash\\',
    ...Array.from({ length: 1003 }, (_, index) => `fixture-${String(index).padStart(6, '0')}`)];

  before(async () => {
    const url = new URL(connectionString!);
    assert.ok(['127.0.0.1', '[::1]'].includes(url.hostname), 'integration fixture must use literal loopback');
    assert.match(decodeURIComponent(url.pathname.slice(1)), /(?:^|[_-])(?:test|tests|validation)(?:$|[_-])/i);
    assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
    assert.equal(url.searchParams.size, 0, 'fixture URL must not override connection or schema options');
    assert.match(schema, /^batch_keyset_test_\d+_[a-f0-9]{12}$/);
    admin = new pg.Pool({ connectionString, ssl: false, max: 1 });
    await admin.query(`CREATE SCHEMA "${schema}"`); created = true;
    url.searchParams.set('options', `-c search_path=${schema}`);
    pool = new pg.Pool({ connectionString: url.toString(), ssl: false, max: 1 });
    await pool.query('CREATE TABLE legacy_documents(collection_name text NOT NULL,document_id text NOT NULL,payload jsonb NOT NULL,PRIMARY KEY(collection_name,document_id)); CREATE TABLE processed(document_id text PRIMARY KEY,payload jsonb NOT NULL)');
    await pool.query("INSERT INTO legacy_documents SELECT 'fixture',id,jsonb_build_object('_id',id,'ordinal',ordinal) FROM unnest($1::text[]) WITH ORDINALITY AS value(id,ordinal)", [identifiers]);
    await pool.query("INSERT INTO legacy_documents VALUES('other-collection','do-not-read','{}'::jsonb)");
  });

  after(async () => {
    await pool?.end();
    try {
      if (created) {
        assert.match(schema, /^batch_keyset_test_\d+_[a-f0-9]{12}$/);
        await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      }
    } finally { await admin?.end(); }
  });

  test('all pages exactly match PostgreSQL collation ordering, including empty and Unicode IDs, on one fenced session', async () => {
    const expected = (await pool.query("SELECT payload FROM legacy_documents WHERE collection_name='fixture' ORDER BY document_id")).rows.map(row => row.payload);
    const connection = await pool.connect();
    const database = lockedMigrationDatabase(connection, { assertHealthy() {} });
    const visited: unknown[] = [];
    const sizes: number[] = [];
    const pids = new Set<number>();
    try {
      const ownerPid = (await connection.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      await forEachLegacyBatch(database, 'fixture', async (rows, client) => {
        pids.add((await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
        visited.push(...rows); sizes.push(rows.length);
      });
      assert.deepEqual(pids, new Set([ownerPid]));
    } finally { connection.release(); }
    assert.deepEqual(visited, expected);
    assert.equal(visited.length, identifiers.length);
    assert.deepEqual(sizes, [250, 250, 250, 250, identifiers.length - 1000]);
    assert.equal(expected.filter(row => row._id === '').length, 1);
  });

  test('a later callback failure rolls back only its page, preserves committed work and never skips ahead', async () => {
    const connection = await pool.connect();
    const database = lockedMigrationDatabase(connection, { assertHealthy() {} });
    const error = new Error('injected second-page failure');
    let callbacks = 0;
    try {
      await assert.rejects(forEachLegacyBatch(database, 'fixture', async (rows, client) => {
        callbacks++;
        for (const row of rows) await client.query('INSERT INTO processed VALUES($1,$2)', [row._id, row]);
        if (callbacks === 2) throw error;
      }), caught => caught === error);
    } finally { connection.release(); }
    assert.equal(callbacks, 2);
    const expected = (await pool.query("SELECT payload FROM legacy_documents WHERE collection_name='fixture' ORDER BY document_id LIMIT 250")).rows.map(row => row.payload);
    const committed = (await pool.query('SELECT payload FROM processed ORDER BY document_id')).rows.map(row => row.payload);
    assert.deepEqual(committed, expected);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM legacy_documents WHERE collection_name='fixture'")).rows[0].count, identifiers.length);
  });
});
