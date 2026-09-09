import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import { ACTIVE_SITEMAP_LANGUAGES, generateLanguageUrls, truncateAtWordBoundary } from '@workspace/seo-shared/seo-config';
import { getIndexableLanguagesForStation, isStationIndexableInLanguage } from '../src/seo/junk-station-rules';
import { URL_TRANSLATIONS } from '@workspace/seo-shared/url-translations';
import { getStationStreamUnavailableNotice } from '@workspace/seo-shared/station-page-copy';

const pageCache = new Map<string, any>();
let databaseFails = false;
let qualificationFails = false;
let missing = false;
let noIndex = false;
let stationReads = 0;
let stationOverrides: Record<string, any> = {};
let customMetadata: Record<string, any> | null = null;
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
mock.module('../src/data/postgres-content-store', { namedExports: { pgSeoMetadata: async () => customMetadata } });
mock.module('../src/services/precomputed-genres', { namedExports: { PrecomputedGenresService: {} } });
mock.module('../src/seo/qualified-languages', { namedExports: { getCachedQualifiedLanguages: async () => {
  if (qualificationFails) throw new Error('temporary qualification outage');
  return qualifiedLanguages;
} } });
const { SeoRenderer } = await import('../src/seo-renderer');
const renderer = new SeoRenderer();
for (const language of ACTIVE_SITEMAP_LANGUAGES) {
  test(`${language}: station collection breadcrumb uses the real plural directory with and without cached overrides`, () => {
    const expected = URL_TRANSLATIONS[language]?.stations || 'stations';
    const overrides = new Map(Object.entries(URL_TRANSLATIONS[language] || {}).map(([key, value]) => [`${language}:${key}`, value]));
    overrides.set(`${language}:station`, 'detail-only-prefix');
    for (const mapping of [overrides, undefined]) {
      const items = (renderer as any).computeBreadcrumbItems(language, '/station/kral-fm', mapping,
        { name: 'KRAL FM' }, (key: string, fallback: string) => key === 'nav_stations' ? 'Directory' : fallback);
      assert.equal(items.find((item: any) => item.name === 'Directory')?.path, `/${language}/${expected}`);
      assert.notEqual(items.find((item: any) => item.name === 'Directory')?.path, `/${language}/detail-only-prefix`);
    }
  });
}
const url = '/en/station/recovery-fm';
beforeEach(() => {
  pageCache.clear(); databaseFails = false; qualificationFails = false;
  missing = false; noIndex = false; stationReads = 0;
  stationOverrides = {}; qualifiedLanguages = ['en']; customMetadata = null;
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

test('actual localized SSR station routes retain the same reciprocal fourteen-language cluster', async () => {
  qualifiedLanguages = [...ACTIVE_SITEMAP_LANGUAGES];
  stationOverrides = { descriptions: Object.fromEntries(qualifiedLanguages.map(lang => [lang, { full: `Full ${lang}`, meta: `Meta ${lang}` }])) };
  const expected = generateLanguageUrls('/station/recovery-fm', 'https://themegaradio.com', 'en', undefined, undefined, qualifiedLanguages)
    .map(entry => ({ ...entry, url: new URL(entry.url).href }));
  for (const entry of expected.filter(item => item.lang !== 'x-default')) {
    const page = await renderer.renderStaticPage(new URL(entry.url).pathname, 'https://themegaradio.com');
    assert.equal(page.pageData?.pageType, 'station');
    assert.equal(new URL(page.seoTags.canonical).href, new URL(entry.url).href);
    assert.deepEqual(page.seoTags.hreflangs.map((item: any) => ({ ...item, url: new URL(item.url).href })), expected, entry.lang);
  }
});

test('offline station details retain full fourteen-language content, indexability and matching human-visible notices', async () => {
  qualifiedLanguages = [...ACTIVE_SITEMAP_LANGUAGES];
  stationOverrides = {
    lastCheckOk: false, lastCheckTime: new Date(), lastCheckOkTime: new Date(Date.now() - 90 * 86400000),
    descriptions: Object.fromEntries(qualifiedLanguages.map(lang => [lang, { full: `Existing editorial station information ${lang}`, meta: `Existing station summary ${lang}` }])),
  };
  const entries = generateLanguageUrls('/station/recovery-fm', 'https://themegaradio.com', 'en', undefined, undefined, qualifiedLanguages);
  for (const entry of entries.filter(item => item.lang !== 'x-default')) {
    const page = await renderer.renderStaticPage(new URL(entry.url).pathname, 'https://themegaradio.com');
    assert.equal(page.pageData?.station.lastCheckOk, false);
    assert.equal(page.pageData?.stationIsJunk, false);
    assert.equal(page.pageData?.notFound, false);
    assert.equal(page.pageData?.stationDbError, undefined, 'offline audio is not a page/database outage');
    assert.equal(page.pageData?.redirectTo, undefined);
    assert.notEqual(page.seoTags.noIndex, true);
    assert.equal(new URL(page.seoTags.canonical).href, new URL(entry.url).href);
    assert.deepEqual(page.seoTags.hreflangs.map((item: any) => ({ ...item, url: new URL(item.url).href })), entries.map(item => ({ ...item, url: new URL(item.url).href })));
    assert.equal(page.pageData?.station.descriptions[entry.lang].full, stationOverrides.descriptions[entry.lang].full);
    const body = renderer.generateHtmlBody({ pageType: 'station', language: entry.lang, translations: {},
      stationData: page.pageData?.station, seoTags: page.seoTags, cleanPath: page.cleanPath });
    assert.ok(body.includes(stationOverrides.descriptions[entry.lang].full));
    assert.ok(body.includes(`<p id="station-stream-unavailable" role="status">${escapeHead(getStationStreamUnavailableNotice(entry.lang))}</p>`));
    assert.equal((body.match(/<h1>/g) || []).length, 1);
    for (const availability of [true, undefined]) {
      const availableBody = renderer.generateHtmlBody({ pageType: 'station', language: entry.lang, translations: {},
        stationData: { ...page.pageData?.station, lastCheckOk: availability }, seoTags: page.seoTags });
      assert.ok(!availableBody.includes('id="station-stream-unavailable"'));
    }
  }
});

test('unknown legacy offline noindex keeps rich localized200 data without reindexing, while manual and quality exclusions stay gone', async () => {
  noIndex = true; qualifiedLanguages = [...ACTIVE_SITEMAP_LANGUAGES];
  stationOverrides = { lastCheckOk: false, descriptions: Object.fromEntries(qualifiedLanguages.map(lang => [lang,
    { full: `Retained original station article ${lang}`, meta: `Retained station summary ${lang}` }])) };
  const entries = generateLanguageUrls('/station/recovery-fm', 'https://themegaradio.com', 'en', undefined, undefined, qualifiedLanguages);
  for (const entry of entries.filter(item => item.lang !== 'x-default')) {
    const page = await renderer.renderStaticPage(new URL(entry.url).pathname, 'https://themegaradio.com');
    assert.equal(page.pageData.stationIsJunk, false, 'HTTP layer keeps200 instead of410');
    assert.equal(page.pageData.stationDbError, undefined);
    assert.equal(page.pageData.notFound, false);
    assert.equal(page.pageData.redirectTo, undefined);
    assert.equal(page.pageData.station.noIndex, true, 'unknown persisted flag is not reset');
    assert.equal(page.seoTags.noIndex, true);
    assert.deepEqual(page.seoTags.hreflangs, []);
    assert.deepEqual(getIndexableLanguagesForStation(page.pageData.station, qualifiedLanguages), []);
    assert.equal(new URL(page.seoTags.canonical).href, new URL(entry.url).href);
    const body = renderer.generateHtmlBody({ pageType: 'station', language: entry.lang, translations: {},
      stationData: page.pageData.station, seoTags: page.seoTags });
    assert.ok(body.includes(stationOverrides.descriptions[entry.lang].full));
    assert.ok(body.includes('id="station-stream-unavailable"'));
  }
  for (const extra of [{ manualEditFields: { noIndex: true } }, { manualEditFields: { noIndex: false } },
    { slug: 'radio-test-stream' }, { slug: 'radio-aac' }, { slug: '-1234' }]) {
    pageCache.clear(); stationOverrides = { ...stationOverrides, manualEditFields: undefined, slug: 'recovery-fm', ...extra };
    const page = await renderer.renderStaticPage(`/en/station/${stationOverrides.slug}`, 'https://themegaradio.com');
    assert.equal(page.pageData.stationIsJunk, true);
    assert.equal(page.seoTags.noIndex, true);
  }
  pageCache.clear(); stationOverrides = { lastCheckOk: false, redirectToSlug: 'original-fm' };
  const duplicate = await renderer.renderStaticPage(url, 'https://themegaradio.com');
  assert.match(duplicate.pageData.redirectTo, /original-fm$/);
});

const escapeHead = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
test('page-data and HTML emit identical bounded descriptions without shortening stored body content', async () => {
  qualifiedLanguages = [...ACTIVE_SITEMAP_LANGUAGES];
  const full = 'Full station editorial text with a final unpunctuated tail '.repeat(12);
  stationOverrides = { descriptions: Object.fromEntries(qualifiedLanguages.map(lang => [lang, { full, meta: `${lang}: ` + 'Music, news & "special" programming for every listener. '.repeat(5) }])) };
  for (const language of qualifiedLanguages) {
    const entry = generateLanguageUrls('/station/recovery-fm', 'https://themegaradio.com', 'en', undefined, undefined, qualifiedLanguages).find(item => item.lang === language)!;
    const page = await renderer.renderStaticPage(new URL(entry.url).pathname, 'https://themegaradio.com');
    const head = renderer.generateHtmlHead(page.seoTags, language, {}, page.cleanPath, page.pageData?.station);
    const expected = truncateAtWordBoundary(stationOverrides.descriptions[language].meta, 160);
    assert.equal(page.seoTags.description, expected);
    assert.equal(page.pageData?.seoTags.description, expected);
    assert.ok(head.includes(`<meta name="description" content="${escapeHead(expected)}">`));
    assert.ok(head.includes(`<meta property="og:description" content="${escapeHead(page.seoTags.ogDescription)}">`));
    assert.ok(head.includes(`<meta name="twitter:description" content="${escapeHead(page.seoTags.twitterDescription)}">`));
    assert.equal(page.pageData?.station.descriptions[language].full, full);
    assert.ok(stationOverrides.descriptions[language].meta.length > 160, 'stored value is not rewritten');
  }
});

test('published admin descriptions keep priority and match HTML presentation limits without mutating overrides or titles', async () => {
  customMetadata = {
    title: 'An intentional full editorial title '.repeat(4),
    description: 'Admin-approved meta description & special programming. '.repeat(5),
    ogDescription: 'Admin-approved social description. '.repeat(8),
    twitterDescription: 'Admin-approved Twitter description. '.repeat(8),
  };
  const original = { ...customMetadata };
  const page = await renderer.renderStaticPage(url, 'https://themegaradio.com');
  const head = renderer.generateHtmlHead(page.seoTags, 'en', {}, page.cleanPath, page.pageData?.station);
  for (const field of ['description', 'ogDescription', 'twitterDescription']) {
    assert.equal(page.seoTags[field], truncateAtWordBoundary(original[field], 160));
    assert.ok(head.includes(`content="${escapeHead(page.seoTags[field])}"`));
  }
  assert.equal(page.seoTags.title, original.title, 'H1/title derivation keeps its full source input');
  assert.deepEqual(customMetadata, original, 'admin data is not mutated');
});
