import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { PostgresCatalogStore, catalogShape } from '../src/data/postgres-catalog-store';

// Previous SELECT s.* -> catalogShape -> requested JS projection contract.
function originalProjection(row: Record<string, any>, requested: string[]) {
  const doc = catalogShape(row);
  const selected: Record<string, any> = { _id: doc._id };
  for (const field of requested) {
    const parts = field.split('.');
    let from = doc, to = selected;
    for (const part of parts.slice(0,-1)) { from = from?.[part]; to = to[part] ||= {}; }
    if (from?.[parts.at(-1)!] !== undefined) to[parts.at(-1)!] = from[parts.at(-1)!];
  }
  return selected;
}

test('scalar/native JSON projections select only whitelisted needed columns plus default id', async () => {
  const queries: string[] = [];
  const catalog = new PostgresCatalogStore({ query: async (sql: string) => { queries.push(sql); return { rows: [] }; } } as any);
  await catalog.find({ lastCheckOk: true }, { fields: ['name','logoAssets.status','name','descriptions.tr.meta'], limit: 10 });
  assert.match(queries[0], /^SELECT s.id,s.name,s.logo_assets,s.descriptions FROM stations/);
  assert.doesNotMatch(queries[0], /s\.\*|s\.source/);
  assert.match(queries[0], /WHERE s.last_check_ok = \$1::boolean ORDER BY s.id ASC NULLS LAST LIMIT \$2$/);
  await catalog.find({}, { fields: [] });
  assert.match(queries[1], /^SELECT s.id FROM/);
  await catalog.find({}, { fields: ['_id'] });
  assert.match(queries[2], /^SELECT s.id FROM/);
});

test('unknown fields/provider aliases alone require source while unprojected find remains unchanged', async () => {
  const queries: string[] = [];
  const catalog = new PostgresCatalogStore({ query: async (sql: string) => { queries.push(sql); return { rows: [] }; } } as any);
  await catalog.find({}, { fields: ['custom.nested','countrycode','name.length'] });
  assert.match(queries[0], /^SELECT s.id,s.source,s.name FROM/);
  await catalog.find({}, { limit: 5 });
  assert.match(queries[1], /^SELECT s\.\* FROM/);
});

test('projection rejects unsafe paths before executing a query', async () => {
  const catalog = new PostgresCatalogStore({ query: async () => assert.fail('unsafe projection reached SQL') } as any);
  for (const field of ['name;DROP TABLE stations','source.__proto__.x','constructor','name..x']) {
    await assert.rejects(catalog.find({}, { fields: [field] }), /Unsupported catalog field/);
  }
});

const connectionString = process.env.PG_TEST_DATABASE_URL;
describe('projected PostgreSQL catalog matches the former full-row result exactly', { skip: !connectionString }, () => {
  const schema = `catalog_projection_test_${process.pid}_${randomBytes(6).toString('hex')}`;
  const admin = new pg.Pool({ connectionString, ssl: false, max: 1 });
  const pool = new pg.Pool({ connectionString, ssl: false, max: 2, options: `-c search_path=${schema},public` });
  const catalog = new PostgresCatalogStore(pool);
  let created = false;
  before(async () => {
    const url = new URL(connectionString!);
    assert.ok(['127.0.0.1','[::1]'].includes(url.hostname), 'Only literal loopback is allowed');
    assert.match(url.pathname, /(?:^|[_-])(?:test|tests|validation)(?:$|[_-])/i);
    assert.equal(url.search, '');
    await admin.query(`CREATE SCHEMA "${schema}"`); created = true;
    const directory = path.resolve(import.meta.dirname, '../../../lib/db/migrations');
    for (const file of (await readdir(directory)).filter(file => /^\d+.*\.sql$/.test(file)).sort()) {
      await pool.query(await readFile(path.join(directory, file), 'utf8'));
    }
    await catalog.insertMany([{ _id: 'projection-fixture', stationuuid: 'projection-fixture-uuid',
      name: 'Native Radio', url: 'https://example.invalid/stream', countryCode: 'DE',
      descriptions: { tr: { meta: 'Türkçe metadata', full: 'Station text '.repeat(2000) } },
      logoAssets: { status: 'completed', nested: { enabled: true }, sizes: [96,256] },
      custom: { nested: { value: 7 }, nullable: null }, countrycode: 'legacy-value',
    }]);
    // Native columns must still override conflicting source values, including
    // native null; unknown legacy roots must still come from source unchanged.
    await pool.query(`UPDATE stations SET latitude=NULL,source=source || $1::jsonb WHERE id='projection-fixture'`,
      [JSON.stringify({ _id: 'wrong-source-id', name: 'Wrong source name', geoLat: 42, descriptions: { bad: true } })]);
  });
  after(async () => {
    await pool.end();
    try {
      if (created) {
        assert.match(schema, /^catalog_projection_test_\d+_[a-f0-9]{12}$/);
        await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      }
    } finally { await admin.end(); }
  });

  test('preserves native/null/nested/default-id/provider/source and missing-field behavior', async () => {
    const original = (await pool.query('SELECT * FROM stations WHERE id=$1', ['projection-fixture'])).rows[0];
    for (const requested of [[], ['_id'], ['name','countryCode','geoLat','createdAt'],
      ['logoAssets.status','logoAssets.sizes','descriptions.tr.meta'], ['name.length'],
      ['custom.nested.value','custom.nullable','countrycode','missing.deep'],
      ['name','custom','descriptions.tr.meta','geoLat']]) {
      assert.deepEqual(await catalog.find({ _id: 'projection-fixture' }, { fields: requested }),
        [originalProjection(original, requested)], requested.join(','));
    }
    assert.deepEqual(await catalog.find({ _id: 'projection-fixture' }), [catalogShape(original)]);
  });
  test('projected queries avoid receiving heavy source/description columns from PostgreSQL', async () => {
    const responses: pg.QueryResult[] = [];
    const captured = new PostgresCatalogStore({ query: async (...args: any[]) => {
      const result = await (pool.query as any)(...args); responses.push(result); return result;
    } } as any);
    assert.deepEqual(await captured.find({}, { fields: ['_id','name'] }), [{ _id: 'projection-fixture', name: 'Native Radio' }]);
    assert.deepEqual(responses[0].fields.map(field => field.name), ['id','name']);
    await captured.find({}, { fields: ['custom.nested.value'] });
    assert.deepEqual(responses[1].fields.map(field => field.name), ['id','source']);
  });
  test('null native JSON does not fall back to stale source JSON', async () => {
    await pool.query(`UPDATE stations SET logo_assets=NULL,source=source || '{"logoAssets":{"status":"stale"}}'::jsonb WHERE id='projection-fixture'`);
    const original = (await pool.query('SELECT * FROM stations WHERE id=$1', ['projection-fixture'])).rows[0];
    for (const requested of [['logoAssets'], ['logoAssets.status']]) {
      assert.deepEqual(await catalog.find({}, { fields: requested }), [originalProjection(original, requested)]);
    }
  });
});
