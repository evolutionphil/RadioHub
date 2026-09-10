import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import express from 'express';
import { ACTIVE_SITEMAP_LANGUAGES } from '@workspace/seo-shared/seo-config';
import { buildCommunityPageSeo } from '@workspace/seo-shared/community-page-seo-templates';
import { buildLocalizedUrl, validateRegionRouteShape } from '../src/seo/url-helpers';
import { parseSeoCatalogPage, seoCatalogPageLinks } from '../src/seo/catalog-pagination';
import { sendSeoNotFound } from '../src/seo/send-seo-not-found';

const pageCache = new Map<string, any>();
let readFails = false, cacheReady = true, reads = 0, totalPages = 2;
let stationFilters: any[] = [];
let catalog = [{ _id: 'fm', slug: 'real-fm', name: 'Real FM', country: 'Germany', url: 'https://stream.example.invalid/live', lastCheckOk: true, isListVisible: true }];
const catalogRead = async () => { reads++; if (readFails) throw Error('temporary catalogue failure'); return { stations: catalog, totalPages }; };
mock.module('../src/performance-cache', { namedExports: { performanceCache: {
  getPageData: (key: string) => pageCache.get(key), setPageData: (key: string, value: any) => pageCache.set(key, value),
  getTranslations: () => ({}), getUrlTranslations: async () => new Map(),
} } });
mock.module('../src/public-station-cache', { namedExports: { publicStationCache: { getOrSetSingleFlight: async (_key: string, read: () => Promise<any>) => read() } } });
mock.module('../src/data/postgres-seo-read-store', { namedExports: { pgSeoCatalog: () => ({
  find: async (filter: any) => { stationFilters.push(filter); return (await catalogRead()).stations; }, count: async () => totalPages * 60,
}) } });
mock.module('../src/services/precomputed-stations', { namedExports: { PrecomputedStationsService: { getGlobalStations: catalogRead, getCountryStationsByName: catalogRead } } });
mock.module('../src/services/precomputed-genres', { namedExports: { PrecomputedGenresService: {} } });
mock.module('../src/data/postgres-content-store', { namedExports: { pgSeoMetadata: async () => null } });
mock.module('../src/seo/qualified-languages', { namedExports: { getCachedQualifiedLanguages: async () => [...ACTIVE_SITEMAP_LANGUAGES] } });
mock.module('../src/seo/slug-existence', { namedExports: {
  isSlugExistenceReady: () => cacheReady,
  hasCountrySlug: (country: string) => ['germany', 'turkey', 'custom-admin-country'].includes(country),
  hasCityDataForCountry: (country: string) => country === 'germany',
  hasCitySlug: (_country: string, city: string) => city === 'berlin',
} });
const { SeoRenderer } = await import('../src/seo-renderer');
const renderer = new SeoRenderer();
beforeEach(() => { pageCache.clear(); readFails = false; cacheReady = true; reads = 0; totalPages = 2; stationFilters = [];
  catalog = [{ _id: 'fm', slug: 'real-fm', name: 'Real FM', country: 'Germany', url: 'https://stream.example.invalid/live', lastCheckOk: true, isListVisible: true }]; });

test('public SSR grids exclude confirmed local unavailability without hiding provider-failed or unknown stations', async () => {
  catalog.push({ ...catalog[0], _id: 'offline', slug: 'offline-fm', name: 'Offline FM', lastCheckOk: false, isListVisible: false });
  catalog.push({ ...catalog[0], _id: 'source-flagged', slug: 'source-flagged-fm', name: 'Provider Flagged FM', lastCheckOk: false });
  catalog.push({ ...catalog[0], _id: 'unknown', slug: 'unknown-fm', name: 'Unknown FM', lastCheckOk: undefined as any });
  for (const path of ['/en', '/en/stations', '/en/stations/a', '/en/regions/europe/germany']) {
    const page = await renderer.renderStaticPage(path, 'https://themegaradio.com');
    assert.notEqual(page.seoTags.noIndex, true);
    const data = page.pageData.additionalData;
    for (const list of [data.popularStations, data.catalogStations].filter(Boolean)) {
      assert.deepEqual(list.map((station: any) => station.slug), ['real-fm', 'source-flagged-fm', 'unknown-fm'], path);
    }
    const body = renderer.generateHtmlBody({ pageType: page.pageData.pageType, language: 'en', translations: {},
      additionalData: data, seoTags: page.seoTags });
    assert.ok(!body.includes('offline-fm'), path);
    assert.ok(body.includes('source-flagged-fm'), path);
    assert.ok(body.includes('unknown-fm'), path);
  }
  assert.ok(stationFilters.length >= 3);
  assert.ok(stationFilters.every(filter => filter.isListVisible === true && !Object.hasOwn(filter, 'lastCheckOk')),
    'raw SSR collection reads push confirmed visibility filtering into SQL without treating provider flags as proof');
});

test('page parser is strict, bounded and query-order agnostic without modifying filters', () => {
  for (const query of ['', '?page=1', '?page=2&country=DE', '?country=DE&page=50', '?page=02', '?page=51', '?page=999999']) assert.equal(parseSeoCatalogPage('/en/stations' + query).valid, true, query);
  for (const query of ['?page=0', '?page=-1', '?page=2junk', '?page=2.1', '?page=', '?page=1&page=2', '?page=999999999999999999999999999']) assert.equal(parseSeoCatalogPage('/en/stations' + query).valid, false, query);
});

for (const language of ACTIVE_SITEMAP_LANGUAGES) {
  test(`${language} valid catalogue/A-Z/country page2 remains self-canonical and reciprocal`, async () => {
    for (const cleanPath of ['/stations', '/stations/a', '/regions/europe/germany']) {
      const path = buildLocalizedUrl(cleanPath, language, undefined, new Map());
      const page = await renderer.renderStaticPage(path + '?page=2', 'https://themegaradio.com');
      assert.equal(page.pageData.httpNotFound, undefined);
      assert.equal(page.seoTags.canonical, `https://themegaradio.com${path}?page=2`);
      assert.ok(page.seoTags.hreflangs.every((entry: any) => entry.url.endsWith('?page=2')));
      assert.equal(page.pageData.catalogStations.length, 1);
      if (cleanPath === '/stations') {
        const body = renderer.generateHtmlBody({ pageType: 'stations', language, translations: {}, additionalData: page.pageData.additionalData });
        const expected = buildCommunityPageSeo('stations', language).title.split(' — ')[0];
        assert.ok(body.includes(expected), `${language} localized station-directory H1`);
      }
    }
  });
}

test('invalid page cannot use a cached valid slice, query filters or a non-catalogue page are not banned', async () => {
  await renderer.renderStaticPage('/en/stations?page=2', 'https://themegaradio.com');
  const previousReads = reads;
  for (const value of ['2junk', '0', '-1']) {
    const result = await renderer.renderStaticPage(`/en/stations?page=${value}`, 'https://themegaradio.com');
    assert.equal(result.pageData.httpNotFound, true);
    assert.equal(result.seoTags.noIndex, true);
    assert.deepEqual(result.seoTags.hreflangs, []);
  }
  assert.equal(reads, previousReads, 'invalid requests never execute catalogue reads');
  const about = await renderer.renderStaticPage('/en/about?page=999999', 'https://themegaradio.com');
  assert.equal(about.pageData.httpNotFound, undefined);
});

test('real page51 stays accessible and distinct from50; manufactured huge A-Z pages never execute OFFSET', async () => {
  totalPages = 60;
  for (const path of ['/en/stations', '/en/stations/a', '/en/regions/europe/germany']) {
    const page = await renderer.renderStaticPage(`${path}?page=51`, 'https://themegaradio.com');
    assert.equal(page.pageData.httpNotFound, undefined);
    assert.equal(page.pageData.catalogPage, 51);
    assert.equal(page.seoTags.canonical, `https://themegaradio.com${path}?page=51`);
    assert.equal(page.pageData.catalogTotalPages, 60);
  }
  const previousReads = reads;
  const pastEnd = await renderer.renderStaticPage('/en/stations/a?page=999999', 'https://themegaradio.com');
  assert.equal(pastEnd.pageData.httpNotFound, true);
  assert.equal(reads, previousReads, 'count-only out-of-range lookup must not execute catalogue OFFSET');
  for (const current of [1, 2, 50, 51, 999, 1000]) {
    const links = seoCatalogPageLinks(current, 1000);
    assert.ok(links.length <= 50);
    assert.ok(links.includes(1) && links.includes(1000) && links.includes(current));
    if (current > 1) assert.ok(links.includes(current - 1));
    if (current < 1000) assert.ok(links.includes(current + 1));
  }
});

test('successfully empty or past-end page2 is 404, but sparse valid country page1 is not false-404', async () => {
  for (const path of ['/en/stations', '/en/stations/a', '/en/regions/europe/germany']) {
    totalPages = 1;
    const pastEnd = await renderer.renderStaticPage(`${path}?page=2`, 'https://themegaradio.com');
    assert.equal(pastEnd.pageData.httpNotFound, true);
    assert.equal(pastEnd.seoTags.noIndex, true);
    assert.deepEqual(pastEnd.seoTags.hreflangs, []);
    totalPages = 50; catalog = [];
    const empty = await renderer.renderStaticPage(`${path}?page=50`, 'https://themegaradio.com');
    assert.equal(empty.pageData.httpNotFound, true);
  }
  const first = await renderer.renderStaticPage('/en/regions/europe/germany', 'https://themegaradio.com');
  assert.equal(first.pageData.notFound, false);
  assert.notEqual(first.seoTags.noIndex, true);
});

test('catalogue outage is retryable503 evidence, never inferred absence or a cached empty success', async () => {
  for (const path of ['/en/stations', '/en/stations/a']) {
    readFails = true;
    const failed = await renderer.renderStaticPage(`${path}?page=2`, 'https://themegaradio.com');
    assert.equal(failed.pageData.stationDbError, true);
    assert.equal(failed.pageData.notFound, false);
    assert.equal(pageCache.size, 0);
    readFails = false;
    const recovered = await renderer.renderStaticPage(`${path}?page=2`, 'https://themegaradio.com');
    assert.equal(recovered.pageData.stationDbError, undefined);
    pageCache.clear();
  }
});

test('invalid geography and extra genre suffixes are 404 without making empty country grids evidence', async () => {
  for (const path of ['/en/regions/europe/not-a-real-country', '/en/regions/europe/germany/not-a-real-city', '/en/genres/rock/extra']) {
    const page = await renderer.renderStaticPage(path, 'https://themegaradio.com');
    assert.equal(page.pageData.httpNotFound, true, path);
    assert.equal(page.seoTags.noIndex, true);
    assert.deepEqual(page.seoTags.hreflangs, []);
  }
  assert.equal(reads, 0, 'invalid shapes and known missing geographic identities never query stations');
  cacheReady = false;
  const cold = await renderer.renderStaticPage('/en/regions/europe/custom-admin-country', 'https://themegaradio.com');
  assert.equal(cold.pageData.stationDbError, true);
  assert.equal(cold.pageData.notFound, false);
  cacheReady = true;
  const recovered = await renderer.renderStaticPage('/en/regions/europe/custom-admin-country', 'https://themegaradio.com');
  assert.equal(recovered.pageData.notFound, false);
});

test('supported city/listing route shapes remain valid but appended extra segments are rejected', () => {
  for (const path of ['/regions/europe/germany', '/regions/europe/germany/berlin', '/regions/europe/germany/berlin/stations', '/regions/europe/germany/stations', '/regions/europe/germany/cities', '/country/germany', '/country/germany/berlin/stations']) assert.equal(validateRegionRouteShape(path).ok, true, path);
  for (const path of ['/regions/europe/germany/berlin/garbage', '/regions/europe/germany/berlin/stations/garbage', '/country/germany/berlin/garbage']) assert.equal(validateRegionRouteShape(path).ok, false, path);
});

test('new404 HTTP response preserves body and HEAD semantics, cannot enter the legacy410 branch', async () => {
  const app = express(); app.use((_req, res) => sendSeoNotFound(res, '<main><h1>Page not found</h1></main>'));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  try {
    for (const method of ['GET', 'HEAD']) {
      const response = await fetch(`http://127.0.0.1:${(server.address() as any).port}/missing`, { method });
      assert.equal(response.status, 404); assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('x-robots-tag'), 'noindex, follow');
      assert.equal(await response.text(), method === 'HEAD' ? '' : '<main><h1>Page not found</h1></main>');
    }
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  const web = await readFile(new URL('../src/index-web.ts', import.meta.url), 'utf8');
  assert.ok(web.indexOf('if (seoData.pageData?.httpNotFound)') < web.indexOf('const stationNotFound = !!seoData.pageData?.notFound;'));
  assert.match(web, /const parsedPage = parseSeoCatalogPage\(url\)/);
  assert.match(web, /parsedPage\.valid \? performanceCache\.getSeoHtml/);
});
