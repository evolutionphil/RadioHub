import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import { ACTIVE_SITEMAP_LANGUAGES } from '@workspace/seo-shared/seo-config';
import { getIndexableLanguagesForStation, isStationIndexableInLanguage } from '../src/seo/junk-station-rules';

const pageCache = new Map<string, any>();
let databaseFails = false;
let qualificationFails = false;
let missing = false;
let noIndex = false;
let stationReads = 0;
let stationOverrides: Record<string, any> = {};
let qualifiedLanguages = ['en'];
const station = { _id: 'test-station', name: 'Recovery FM', slug: 'recovery-fm', url: 'https://stream.example.invalid/live', country: 'Germany', tags: 'pop', lastCheckOk: true };
mock.module('../src/performance-cache', { namedExports: { performanceCache: {
  getPageData: (key: string) => pageCache.get(key),
  setPageData: (key: string, value: any) => pageCache.set(key, value),
  getTranslations: () => ({}),
  getUrlTranslations: async () => new Map<string, string>(),
} } });
mock.module('../src/data/postgres-seo-read-store', { namedExports: { pgSeoCatalog: () => ({
  findOne: async () => {
    stationReads++;
    if (databaseFails) throw new Error('temporary PostgreSQL read outage');
    return missing ? null : { ...station, ...stationOverrides, noIndex };
  },
  find: async () => [], count: async () => 0, groupCount: async () => [],
}) } });
mock.module('../src/data/postgres-content-store', { namedExports: { pgSeoMetadata: async () => null } });
mock.module('../src/services/precomputed-genres', { namedExports: { PrecomputedGenresService: {} } });
mock.module('../src/seo/qualified-languages', { namedExports: { getCachedQualifiedLanguages: async () => {
  if (qualificationFails) throw new Error('temporary qualification outage');
  return qualifiedLanguages;
} } });
const { SeoRenderer } = await import('../src/seo-renderer');
const renderer = new SeoRenderer();
const url = '/en/station/recovery-fm';
beforeEach(() => {
  pageCache.clear(); databaseFails = false; qualificationFails = false;
  missing = false; noIndex = false; stationReads = 0;
  stationOverrides = {}; qualifiedLanguages = ['en'];
});

test('transient PostgreSQL placeholder is not permanent junk and the next request re-reads recovered data', async () => {
  databaseFails = true;
  const failed = await renderer.renderStaticPage(url, 'https://themegaradio.com');
  assert.equal(failed.pageData?.stationDbError, true);
  assert.equal(failed.pageData?.stationIsJunk, false);
  assert.equal(failed.pageData?.notFound, false);
  assert.equal(pageCache.has(url), false);
  databaseFails = false;
  const recovered = await renderer.renderStaticPage(url, 'https://themegaradio.com');
  assert.equal(recovered.pageData?.stationDbError, undefined);
  assert.equal(recovered.pageData?.station?.name, 'Recovery FM');
  assert.equal(recovered.pageData?.stationIsJunk, false);
  assert.equal(stationReads, 2);
  assert.equal(pageCache.has(url), true);
});

test('qualification failure is retryable and never cached as a permanent noindex or redirect', async () => {
  qualificationFails = true;
  const failed = await renderer.renderStaticPage(url, 'https://themegaradio.com');
  assert.equal(failed.pageData?.stationDbError, true);
  assert.equal(failed.pageData?.stationIsJunk, false);
  assert.equal(failed.pageData?.redirectTo, undefined);
  assert.notEqual(failed.seoTags.noIndex, true);
  assert.equal(pageCache.has(url), false);
  qualificationFails = false;
  assert.equal((await renderer.renderStaticPage(url, 'https://themegaradio.com')).pageData?.stationDbError, undefined);
});

test('real missing stations and explicit noIndex quality decisions retain permanent handling', async () => {
  missing = true;
  const unknown = await renderer.renderStaticPage(url, 'https://themegaradio.com');
  assert.equal(unknown.pageData?.notFound, true);
  assert.equal(unknown.pageData?.stationDbError, undefined);
  pageCache.clear(); missing = false; noIndex = true;
  const excluded = await renderer.renderStaticPage(url, 'https://themegaradio.com');
  assert.equal(excluded.pageData?.stationIsJunk, true);
  assert.equal(excluded.seoTags.noIndex, true);
  assert.equal(excluded.pageData?.stationDbError, undefined);
});

test('numeric-only stations are excluded consistently without turning positive callsigns into gone pages or redirects', async () => {
  qualifiedLanguages = [...ACTIVE_SITEMAP_LANGUAGES];
  const descriptions = Object.fromEntries(qualifiedLanguages.map(lang => [lang, { full: `Station description ${lang}`, meta: `Station metadata ${lang}` }]));
  for (const slug of ['1234', '-1234']) {
    stationOverrides = { slug, descriptions };
    const page = await renderer.renderStaticPage(`/en/station/${slug}`, 'https://themegaradio.com');
    assert.equal(page.seoTags.noIndex, true);
    assert.deepEqual(page.seoTags.hreflangs, []);
    assert.equal(page.pageData?.redirectTo, undefined);
    assert.equal(page.pageData?.notFound, false);
    assert.equal(page.pageData?.stationDbError, undefined);
    assert.equal(page.pageData?.stationIsJunk, slug.startsWith('-'));
    const doc = { ...station, ...stationOverrides };
    assert.deepEqual(getIndexableLanguagesForStation(doc, qualifiedLanguages), []);
    assert.equal(isStationIndexableInLanguage(doc, 'en', qualifiedLanguages), false);
  }
});

test('a normal station with complete content retains all fourteen indexable locale alternates', async () => {
  qualifiedLanguages = [...ACTIVE_SITEMAP_LANGUAGES];
  stationOverrides = { descriptions: Object.fromEntries(qualifiedLanguages.map(lang => [lang, { full: `Full ${lang}`, meta: `Meta ${lang}` }])) };
  const page = await renderer.renderStaticPage(url, 'https://themegaradio.com');
  assert.notEqual(page.seoTags.noIndex, true);
  assert.equal(page.pageData?.stationIsJunk, false);
  assert.equal(page.pageData?.redirectTo, undefined);
  assert.deepEqual(new Set(page.seoTags.hreflangs.filter((entry: any) => entry.lang !== 'x-default').map((entry: any) => entry.lang)), new Set(qualifiedLanguages));
  assert.deepEqual(new Set(getIndexableLanguagesForStation({ ...station, ...stationOverrides }, qualifiedLanguages)), new Set(qualifiedLanguages));
});
