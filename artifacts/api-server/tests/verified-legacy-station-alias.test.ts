import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import { verifiedLegacyStationAlias } from '../src/seo/verified-legacy-station-alias';

const reads: string[] = [];
let rows = new Map<string, Record<string, any>>();
let slugRows: any[] = [];
mock.module('../src/postgres-runtime', { namedExports: { getPostgresPool: () => ({
  query: async (_sql: string, values: string[]) => {
    reads.push(values[0]);
    return { rows: rows.has(values[0]) ? [rows.get(values[0])] : [] };
  },
}) } });
mock.module('../src/data/postgres-catalog-store', { namedExports: { pgCatalog: () => ({ groupCount: async () => [] }) } });
mock.module('../src/data/postgres-seo-indexing-store', { namedExports: {
  pgStationSlugRows: async () => slugRows,
  pgSeoGenres: async () => [], pgSlugCountryNames: async () => [], pgSlugCountryStates: async () => [],
} });
mock.module('../src/services/precomputed-cities', { namedExports: { PrecomputedCitiesService: { getSupportedCountries: () => [] } } });
const { getStationByIdentifier } = await import('../src/data/station-read-store');
const { loadSlugExistence, hasStationSlug, getCanonicalStationSlug } = await import('../src/seo/slug-existence');

beforeEach(async () => {
  reads.length = 0;
  rows = new Map();
  slugRows = [];
  await loadSlugExistence();
});

test('only the two catalog-verified historical spellings are eligible', () => {
  assert.equal(verifiedLegacyStationAlias('kpissfm-2'), 'kpiss-fm-2');
  assert.equal(verifiedLegacyStationAlias('flashbassfm-1'), 'flashbass-fm-1');
  for (const slug of ['kpissfm-1', 'kpiss-fm-2', 'randomfm-1', '-2173', '__proto__', 'constructor']) {
    assert.equal(verifiedLegacyStationAlias(slug), null, slug);
  }
});

for (const [legacy, alias, canonical] of [
  ['kpissfm-2', 'kpiss-fm-2', 'kpiss-fm'],
  ['flashbassfm-1', 'flashbass-fm-1', 'flashbass-fm'],
]) {
  test(`${legacy}: public reads resolve the persisted alias only after an exact miss`, async () => {
    rows.set(alias, { id: 'verified-station', slug: canonical, no_index: false, slug_aliases: [alias] });
    assert.equal((await getStationByIdentifier(legacy))?.slug, canonical);
    assert.deepEqual(reads, [legacy, alias]);
  });

  test(`${legacy}: existence/canonical cache uses the same real alias and junk decision`, async () => {
    assert.equal(hasStationSlug(legacy), false);
    assert.equal(getCanonicalStationSlug(legacy), null);
    slugRows = [{ slug: canonical, slugAliases: [alias], noIndex: false, name: 'Verified FM', lastCheckOk: true, url: 'https://stream.example.invalid/live' }];
    await loadSlugExistence();
    assert.equal(hasStationSlug(legacy), true);
    assert.equal(getCanonicalStationSlug(legacy), canonical);
    slugRows[0].noIndex = true;
    await loadSlugExistence();
    assert.equal(hasStationSlug(legacy), true);
    assert.equal(getCanonicalStationSlug(legacy), null);
  });
}

test('current exact records override repairs in public reads and the redirect cache', async () => {
  rows.set('kpissfm-2', { id: 'exact', slug: 'kpissfm-2' });
  rows.set('kpiss-fm-2', { id: 'other', slug: 'kpiss-fm' });
  assert.equal((await getStationByIdentifier('kpissfm-2'))?._id, 'exact');
  assert.deepEqual(reads, ['kpissfm-2']);
  slugRows = [
    { slug: 'kpiss-fm', slugAliases: ['kpiss-fm-2'], name: 'KPISS.FM', lastCheckOk: true, url: 'https://stream.example.invalid/live' },
    { slug: 'kpissfm-2', slugAliases: [], name: 'Exact owner', lastCheckOk: true, url: 'https://stream.example.invalid/other' },
  ];
  await loadSlugExistence();
  assert.equal(getCanonicalStationSlug('kpissfm-2'), null);
  slugRows[1] = { slug: 'different-exact-owner', slugAliases: ['kpissfm-2'], name: 'Exact alias owner', lastCheckOk: true, url: 'https://stream.example.invalid/other' };
  await loadSlugExistence();
  assert.equal(getCanonicalStationSlug('kpissfm-2'), 'different-exact-owner');
});

test('missing verified targets and unverified URLs remain missing without catalog scans or guesses', async () => {
  assert.equal(await getStationByIdentifier('kpissfm-2'), null);
  assert.deepEqual(reads, ['kpissfm-2', 'kpiss-fm-2']);
  reads.length = 0;
  assert.equal(await getStationByIdentifier('kpissfm-1'), null);
  assert.deepEqual(reads, ['kpissfm-1']);
});
