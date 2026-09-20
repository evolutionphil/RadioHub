import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PostgresCatalogStore } from '../src/data/postgres-catalog-store';

function fixture(seed: Record<string, any>[] = []) {
  const rows = seed.map(row => structuredClone(row));
  const queries: string[] = [];
  const genres = new Set<string>(), users = new Set<string>();
  let locked = false;
  const client = { async query(sql: string, values: any[] = []) {
    queries.push(sql);
    if (sql.includes("hashtextextended('admin-slug-assignment',0)")) locked = true;
    if (sql.startsWith('SELECT status,cancel_requested')) return { rowCount: 1, rows: [{ status: 'running', cancel_requested: false }] };
    if (sql.startsWith('SELECT 1 FROM station_blacklist')) return { rowCount: 0, rows: [] };
    if (sql.startsWith('SELECT id FROM stations WHERE station_uuid=')) {
      const existing = rows.find(row => row.station_uuid === values[0]
        || (row.name === values[1] && row.url === values[2] && (row.country_code || '') === values[3]));
      return { rowCount: existing ? 1 : 0, rows: existing ? [existing] : [] };
    }
    if (sql.startsWith('SELECT EXISTS(')) {
      assert.equal(locked, true, 'allocation occurs under the shared transaction lock');
      const candidate = values[0];
      return { rows: [{ taken: rows.some(row => row.id !== values[2]
        && (row.slug === candidate || row.slug_aliases?.includes(candidate)))
        || genres.has(candidate) || users.has(candidate) }] };
    }
    if (sql.startsWith('INSERT INTO stations(')) {
      const columns = sql.match(/^INSERT INTO stations\(([^)]+)\)/)![1].split(',');
      const row = Object.fromEntries(columns.map((column, index) => [column, values[index]]));
      for (const column of ['source', 'descriptions', 'manual_edit_fields', 'logo_assets']) {
        if (typeof row[column] === 'string') row[column] = JSON.parse(row[column]);
      }
      rows.push(row);
      return { rows: [row], rowCount: 1 };
    }
    assert.ok(/^(BEGIN|COMMIT|ROLLBACK|LOCK TABLE|SELECT pg_advisory_xact_lock|DELETE FROM station_genres|INSERT INTO station_genres)/.test(sql), sql);
    return { rows: [], rowCount: 0 };
  }, release() {} };
  return { catalog: new PostgresCatalogStore({ connect: async () => client } as any), rows, queries, genres, users };
}

const station = (id: string, patch: Record<string, any> = {}) => ({
  _id: id, stationuuid: `uuid-${id}`, name: 'Sunrise', url: `https://example.invalid/${id}`, ...patch,
});

test('sync inserts allocate slugs avoiding current slugs, historical aliases and other namespaces', async () => {
  const seed = [
    { id: 'old', station_uuid: 'uuid-old', name: 'Existing', slug: 'sunrise', slug_aliases: ['sunrise-1'], url: 'https://example.invalid/old' },
  ];
  const f = fixture(seed);
  f.genres.add('sunrise-2'); f.users.add('sunrise-3');
  const inputs = [station('new-a'), station('new-b', { slug: null })];
  const before = structuredClone(inputs);
  const result = await f.catalog.insertMany(inputs, { syncRunId: 'run' });
  assert.deepEqual(result.map(row => row.slug), ['sunrise-4', 'sunrise-5']);
  assert.deepEqual(f.rows[0], seed[0], 'existing canonical URL and aliases stay byte-for-byte intact');
  assert.deepEqual(inputs, before, 'provider input objects are not mutated');
  const lock = f.queries.findIndex(sql => sql.includes("hashtextextended('admin-slug-assignment',0)"));
  assert.ok(lock > f.queries.findIndex(sql => sql.includes('FROM catalog_sync_runs')));
  assert.ok(lock < f.queries.findIndex(sql => sql.startsWith('LOCK TABLE stations')), 'lock order agrees with slug maintenance');
  assert.ok(f.queries.at(-1) === 'COMMIT');
  for (const row of result) assert.equal(row.source, undefined);
});

test('new provider Unicode station names receive transliterated nonempty ASCII slugs', async () => {
  const f = fixture();
  const result = await f.catalog.insertMany([
    station('turkish', { name: 'Radyo Çığ İstanbul', slug: '' }),
    station('cyrillic', { name: 'Радио Москва' }),
    station('cjk', { name: '日本語ラジオ' }),
    station('symbols', { name: '🎶' }),
  ], { syncRunId: 'run' });
  assert.equal(result[0].slug, 'radyo-cig-istanbul');
  assert.equal(result[1].slug, 'radio-moskva');
  assert.equal(result[3].slug, 'station');
  for (const row of result) assert.match(row.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert.equal(new Set(result.map(row => row.slug)).size, result.length);
});

test('sync preserves supplied slugs and aliases and does not regenerate a duplicate existing station', async () => {
  const f = fixture([{ id: 'existing', station_uuid: 'uuid-existing', name: 'Previous name', slug: 'stable-url',
    slug_aliases: ['older-url'], url: 'https://example.invalid/existing' }]);
  const result = await f.catalog.insertMany([
    station('existing', { name: 'Provider rename' }),
    station('provided', { slug: 'chosen-url', slugAliases: ['previous-url'] }),
  ], { syncRunId: 'run' });
  assert.equal(result.length, 1);
  assert.equal(result[0].slug, 'chosen-url');
  assert.deepEqual(result[0].slugAliases, ['previous-url']);
  assert.equal(f.rows[0].slug, 'stable-url');
  assert.deepEqual(f.rows[0].slug_aliases, ['older-url']);
  assert.equal(f.queries.some(sql => sql.startsWith('SELECT EXISTS(')), false);
});

test('final inserted slug applies junk policy and never clears a prior noindex decision', async () => {
  const f = fixture();
  const result = await f.catalog.insertMany([
    station('codec', { name: 'Radio Test MP3' }),
    station('excluded', { name: 'News Radio', noIndex: true, manualEditFields: { noIndex: true } }),
  ], { syncRunId: 'run' });
  assert.equal(result[0].slug, 'radio-test-mp3');
  assert.equal(result[0].noIndex, true);
  assert.equal(result[0].automaticNoIndex.owner, 'radiohub-junk-policy');
  assert.equal(result[1].noIndex, true);
  assert.deepEqual(result[1].manualEditFields, { noIndex: true });
});

test('non-provider catalog inserts keep their existing identity behavior', async () => {
  const f = fixture();
  const result = await f.catalog.insertMany([station('restore', { slug: null, slugAliases: ['archived-url'] })]);
  assert.equal(result[0].slug, null);
  assert.deepEqual(result[0].slugAliases, ['archived-url']);
  assert.equal(f.queries.some(sql => sql.includes('admin-slug-assignment')), false);
});
