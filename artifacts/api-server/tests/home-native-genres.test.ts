import assert from 'node:assert/strict';
import { after, beforeEach, mock, test } from 'node:test';

const pages = new Map<string, any>();
let calls = 0;
let nativeGenres: Array<{ slug: string; name: string; stationCount: number; total_stations: number }> = [];
let genreRead: () => Promise<typeof nativeGenres> = async () => nativeGenres;
let translationsFail = false;
mock.module('../src/performance-cache', { namedExports: { performanceCache: {
  getPageData: (key: string) => pages.get(key),
  setPageData: (key: string, value: any) => pages.set(key, value),
  getTranslations: () => {
    if (translationsFail) throw new Error('required translations unavailable');
    return {};
  },
  getUrlTranslations: async () => new Map<string, string>(),
} } });
mock.module('../src/data/postgres-seo-read-store', { namedExports: { pgSeoCatalog: () => ({ find: async () => [] }) } });
mock.module('../src/data/postgres-content-store', { namedExports: { pgSeoMetadata: async () => null } });
mock.module('../src/services/public-genre-navigation', { namedExports: { getCachedPublicGenres: async () => {
  calls++; return genreRead();
} } });
mock.module('../src/services/precomputed-genres', { namedExports: { PrecomputedGenresService: {
  getGenres: () => { throw new Error('Home SSR must never load the legacy aggregate'); },
} } });
mock.module('../src/seo/qualified-languages', { namedExports: { getCachedQualifiedLanguages: async () => ['en'] } });
const { SeoRenderer } = await import('../src/seo-renderer');
const renderer = new SeoRenderer();
beforeEach(() => {
  pages.clear(); calls = 0; translationsFail = false;
  nativeGenres = Array.from({ length: 30 }, (_, index) => ({
    slug: `genre-${index.toString().padStart(2, '0')}`, name: `Curated genre ${index}`,
    stationCount: index, total_stations: index,
  }));
  genreRead = async () => nativeGenres;
});
after(() => mock.restoreAll());

test('cold home SSR uses the native genre result with the same ranking and top-24 presentation', async () => {
  const original = structuredClone(nativeGenres);
  const page = await renderer.renderStaticPage('/en', 'https://themegaradio.com');
  assert.equal(calls, 1);
  assert.equal(page.pageData.pageType, 'home');
  assert.deepEqual(page.pageData.topGenres, [...nativeGenres].reverse().slice(0, 24).map(genre => ({
    slug: genre.slug, name: genre.name, count: genre.stationCount,
  })));
  assert.deepEqual(nativeGenres, original, 'SSR must not sort or truncate shared cached data in place');
  await renderer.renderStaticPage('/en', 'https://themegaradio.com');
  assert.equal(calls, 1, 'A warm page does not request genre data again');
});

test('equal native counts use the public browser slug tie-breaker and preserve curated names', async () => {
  nativeGenres = [
    { slug: 'rock', name: 'Editorial Rock', stationCount: 4, total_stations: 4 },
    { slug: 'jazz', name: 'Editorial Jazz', stationCount: 4, total_stations: 4 },
  ];
  const page = await renderer.renderStaticPage('/en', 'https://themegaradio.com');
  assert.deepEqual(page.pageData.topGenres, [
    { slug: 'jazz', name: 'Editorial Jazz', count: 4 },
    { slug: 'rock', name: 'Editorial Rock', count: 4 },
  ]);
});

test('an optional native genre outage retains the home body and existing localized fallback links', async () => {
  genreRead = async () => { throw new Error('temporary genre read outage'); };
  const page = await renderer.renderStaticPage('/en', 'https://themegaradio.com');
  assert.equal(page.pageData.topGenres, undefined);
  assert.equal(page.pageData.pageType, 'home');
  const html = renderer.generateHtmlBody({
    pageType: 'home', language: page.language, translations: page.translations,
    additionalData: page.pageData, urlTranslations: page.urlTranslations,
  });
  assert.match(html, /class="hero-container/);
  assert.match(html, /href="\/en\/genres\/pop"/);
});

test('a hung optional genre read stops blocking at the 4s read budget, before the 10s render deadline', async () => {
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  genreRead = () => { started(); return new Promise(() => {}); };
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const rendering = renderer.renderStaticPage('/en', 'https://themegaradio.com');
    await ready;
    mock.timers.tick(4_001);
    const page = await rendering;
    assert.equal(page.pageData.pageType, 'home');
    assert.equal(page.pageData.topGenres, undefined);
  } finally { mock.timers.reset(); }
});

test('required translation failures are not masked by optional genre fallback', async () => {
  translationsFail = true;
  await assert.rejects(renderer.renderStaticPage('/en', 'https://themegaradio.com'), /required translations unavailable/);
  assert.equal(calls, 0);
  assert.equal(pages.size, 0);
});
