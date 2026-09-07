import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

const calls: Array<{ sql: string; values: unknown[] }> = [];
const rows = [{ _id: 'radio-one', slug: 'radio-one', descriptions: { tr: { full: 'Tam açıklama', meta: 'Açıklama' } } }];
mock.module('../src/postgres-runtime', { namedExports: {
  getPostgresPool: () => ({ query: async (sql: string, values: unknown[]) => {
    calls.push({ sql, values }); return { rows };
  } }),
  getPostgresCoordinationPool: () => { throw new Error('sitemap reads must not use the coordination pool'); },
} });
const { pgSitemapStationBatch, SITEMAP_STATION_READ_BATCH_SIZE } = await import('../src/data/postgres-seo-indexing-store');

test('sitemap station reads use one native array bind and a slim projection, retaining all eligibility fields', async () => {
  calls.length = 0;
  const ids = Array.from({ length: SITEMAP_STATION_READ_BATCH_SIZE }, (_, n) => `id-${n}`);
  assert.deepEqual(await pgSitemapStationBatch(ids), rows);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /WHERE id=ANY\(\$1::text\[\]\)/);
  assert.deepEqual(calls[0].values, [ids]);
  assert.doesNotMatch(calls[0].sql, /SELECT\s+(?:s\.)?\*|\sOR\s|,source(?:,|\s)/i);
  for (const key of ['descriptions', 'country_code', 'language_codes', 'no_index', 'last_check_ok', 'last_check_time', 'lastCheckOkTime', 'logo_assets', 'favicon', 'updated_at']) {
    assert.ok(calls[0].sql.includes(key), `must preserve sitemap/indexability field ${key}`);
  }
});

test('empty batches avoid database access and oversized batches fail before any query', async () => {
  calls.length = 0;
  assert.deepEqual(await pgSitemapStationBatch([]), []);
  await assert.rejects(pgSitemapStationBatch(Array.from({ length: 501 }, (_, n) => String(n))), /exceeds 500/);
  assert.equal(calls.length, 0);
});
