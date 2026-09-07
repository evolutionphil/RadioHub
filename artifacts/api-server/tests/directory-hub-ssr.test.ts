import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import { ACTIVE_SITEMAP_LANGUAGES } from '@workspace/seo-shared/seo-config';
import { buildDirectoryIndexSeo } from '@workspace/seo-shared/directory-index-seo';
import { getLocalizedCountryName, getLocalizedRegionName } from '@workspace/seo-shared/country-name-translations';
import { buildLocalizedUrl } from '../src/seo/url-helpers';

const pageCache = new Map<string, any>(), allowed = new Set(['pop', 'rock', 'jazz', 'thin']);
const queries: string[] = [];
let failRead = false;
let genreRows = [
  { id: 'rock', slug: 'rock', name: 'Rock', station_count: 80, is_discoverable: true },
  { id: 'pop', slug: 'pop', name: 'Pop', station_count: 120, is_discoverable: true },
  { id: 'thin', slug: 'thin', name: 'Thin', station_count: 1, is_discoverable: true },
  { id: 'jazz', slug: 'jazz', name: 'Jazz', station_count: 75, is_discoverable: false },
  { id: '105', slug: '105', name: '105', station_count: 10000, is_discoverable: true },
];
let countryRows = [{ name: 'Germany' }, { name: 'Austria' }, { name: 'Turkey' }, { name: 'Türkiye' }, { name: 'Unknown Place' }];
const pool = { query: async (sql: string) => {
  queries.push(sql); if (failRead) throw new Error('temporary reference read failure');
  if (sql === 'SELECT * FROM genres WHERE is_discoverable=true') return { rows: genreRows.filter(row => row.is_discoverable) };
  if (sql === 'SELECT name FROM countries ORDER BY name') return { rows: countryRows };
  throw new Error(`Unexpected DB query: ${sql}`);
} };
mock.module('../src/postgres-runtime', { namedExports: { getPostgresPool: () => pool, getPostgresCoordinationPool: () => pool } });
mock.module('../src/seo/genre-whitelist-store', { namedExports: { getMergedWhitelist: () => allowed, getMergedAliases: () => new Map() } });
mock.module('../src/performance-cache', { namedExports: { performanceCache: {
  getPageData: (key: string) => pageCache.get(key), setPageData: (key: string, value: any) => pageCache.set(key, value),
  getTranslations: () => ({}), getUrlTranslations: async () => new Map(),
} } });
mock.module('../src/data/postgres-content-store', { namedExports: { pgSeoMetadata: async () => null } });
mock.module('../src/services/precomputed-genres', { namedExports: { PrecomputedGenresService: {} } });
mock.module('../src/seo/qualified-languages', { namedExports: { getCachedQualifiedLanguages: async () => [...ACTIVE_SITEMAP_LANGUAGES] } });
mock.module('../src/data/postgres-seo-read-store', { namedExports: { pgSeoCatalog: () => {
  throw new Error('Hub must not scan the station catalogue');
} } });
const { SeoRenderer } = await import('../src/seo-renderer');
const { loadGenreDirectoryHub, loadRegionDirectoryHub, DIRECTORY_GENRE_LIMIT, DIRECTORY_COUNTRIES_PER_REGION } = await import('../src/seo/directory-hub-data');
const renderer = new SeoRenderer();
const escape = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
beforeEach(() => { queries.length = 0; pageCache.clear(); failRead = false; allowed.add('rock'); });

for (const language of ACTIVE_SITEMAP_LANGUAGES) {
  for (const kind of ['genres', 'regions'] as const) {
    test(`${language}/${kind} raw SSR contains localized content and canonical native directory links`, async () => {
      const path = buildLocalizedUrl(`/${kind}`, language, undefined, new Map());
      const page = await renderer.renderStaticPage(path, 'https://themegaradio.com');
      const body = renderer.generateHtmlBody({ pageType: kind, language, translations: {}, additionalData: page.pageData.additionalData, cleanPath: `/${kind}`, urlTranslations: page.urlTranslations });
      const text = buildDirectoryIndexSeo(kind, language);
      assert.equal((body.match(/<h1\b/g) || []).length, 1);
      assert.ok(body.includes(`<h1>${escape(text.h1)}</h1>`));
      assert.ok(body.includes(escape(text.description)));
      assert.ok(body.includes(`lang="${language}" dir="${['ar', 'he'].includes(language) ? 'rtl' : 'ltr'}"`));
      if (kind === 'genres') {
        for (const slug of ['pop', 'rock']) assert.ok(body.includes(`href="${escape(path + '/' + slug)}"`));
        assert.ok(!body.includes('/105"') && !body.includes('/jazz"') && !body.includes('/thin"'));
      } else {
        const germany = buildLocalizedUrl('/regions/europe/germany', language, undefined, new Map());
        assert.ok(body.includes(`href="${escape(germany)}"`));
        assert.ok(body.includes(escape(getLocalizedCountryName('Germany', language))));
        assert.ok(body.includes(escape(getLocalizedRegionName('Europe', language))));
        assert.equal((body.match(/<section>/g) || []).length, 6);
        assert.ok(!body.includes('unknown-place'));
      }
      assert.equal(queries.length, 1, 'One small native reference-table read per cold hub');
      await renderer.renderStaticPage(path, 'https://themegaradio.com');
      assert.equal(queries.length, 1, 'Existing pageData cache eliminates repeated reads');
      assert.ok(!queries.some(sql => /\bstations\b|\bstation_genres\b|legacy|mongo/i.test(sql)));
    });
  }
}
test('warm genre hub cache follows whitelist removals immediately', async () => {
  const first = await renderer.renderStaticPage('/en/genres', 'https://themegaradio.com');
  assert.equal(first.pageData.directoryGenres.length, 2);
  allowed.delete('rock');
  const second = await renderer.renderStaticPage('/en/genres', 'https://themegaradio.com');
  assert.deepEqual(second.pageData.directoryGenres.map((genre: any) => genre.slug), ['pop']);
  assert.equal(queries.length, 2);
});
test('failed hub reads are not cached as permanent empty navigation', async () => {
  failRead = true;
  const failed = await renderer.renderStaticPage('/en/regions', 'https://themegaradio.com');
  assert.equal(failed.pageData.hubReadFailed, true); assert.equal(pageCache.size, 0);
  failRead = false;
  const recovered = await renderer.renderStaticPage('/en/regions', 'https://themegaradio.com');
  assert.equal(recovered.pageData.directoryRegions.length, 6); assert.equal(queries.length, 2);
});
test('hub bounds, alias deduplication, safe slugs and name escaping preserve curated identity', async () => {
  const originalGenres = genreRows, originalCountries = countryRows;
  try {
    genreRows = Array.from({ length: 90 }, (_, n) => ({ id: `id-${n}`, slug: `genre-${n}`, name: '<b>Editor & name</b>', station_count: n + 10, is_discoverable: true }));
    genreRows.forEach(row => allowed.add(row.slug));
    const genres = await loadGenreDirectoryHub(); assert.equal(genres.length, DIRECTORY_GENRE_LIMIT);
    countryRows = [{ name: 'Germany' }, { name: 'Deutschland' }, { name: 'Austria' }, { name: 'France' }, { name: 'Italy' }, { name: 'Spain' }, { name: 'Portugal' }, { name: 'Belgium' }, { name: 'Netherlands' }, { name: 'Denmark' }, { name: 'Sweden' }];
    const regions = await loadRegionDirectoryHub();
    assert.equal(regions.find(region => region.slug === 'europe')!.countries.length, DIRECTORY_COUNTRIES_PER_REGION);
    assert.equal(regions.flatMap(region => region.countries).filter(country => country.slug === 'germany').length, 1);
    const html = renderer.generateHtmlBody({ pageType: 'genres', language: 'de', translations: {}, additionalData: { directoryGenres: genres } });
    assert.ok(html.includes('&lt;b&gt;Editor &amp; name&lt;/b&gt;')); assert.ok(!html.includes('<b>Editor'));
  } finally { genreRows = originalGenres; countryRows = originalCountries; }
});
