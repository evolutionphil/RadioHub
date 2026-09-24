import { after, before, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { COUNTRY_TO_LANGUAGE, SEO_LANGUAGES } from '@workspace/seo-shared/seo-config';
import { ACTIVE_SITEMAP_LANGUAGES } from '@workspace/seo-shared/seo-config';
import { URL_TRANSLATIONS } from '@workspace/seo-shared/url-translations';
import { langIneligibilityRedirectMiddleware } from '../src/middleware/lang-ineligibility-redirect';
import { isJunkStation, isNumericOnlySlug } from '../src/seo/junk-station-rules';
import { sendJunkGone } from '../src/seo/send-junk-gone';

let server: Server;
let baseUrl: string;
let slugCacheReady = false;
const pageCache = new Map<string, any>();
let stationRows: any[] = [];
const redirectable = (identifier: string) => {
  if (!slugCacheReady) return null;
  const row = stationRows.find(station => station.slug === identifier)
    || stationRows.find(station => station.slugAliases?.includes(identifier));
  return row && !row.noIndex && !row.redirectToSlug && !isNumericOnlySlug(row.slug) && !isJunkStation(row) ? row.slug : null;
};

before(async () => {
  // No production DB reads: only the URL-token cache and slug-alias cache are
  // replaced. Both redirect middlewares and Express's Location handling run.
  mock.module('../src/performance-cache', { namedExports: {
    performanceCache: { getUrlTranslations: async () => new Map(), getTranslations: () => ({}),
      getPageData: (key: string) => pageCache.get(key), setPageData: (key: string, value: any) => pageCache.set(key, value) },
  } });
  mock.module('../src/seo/slug-existence', { namedExports: {
    getCanonicalStationSlug: (identifier: string) => {
      const canonical = redirectable(identifier); return canonical === identifier ? null : canonical;
    },
    getRedirectableStationSlug: redirectable,
    isSlugExistenceReady: () => slugCacheReady,
  } });
  mock.module('../src/data/postgres-seo-read-store', { namedExports: { pgSeoCatalog: () => ({
    findOne: async (query: any) => stationRows.find(station => query.slug ? station.slug === query.slug : station.slugAliases?.includes(query.slugAliases)) ?? null,
    findMergedAlias: async () => null, find: async () => [], count: async () => 0, groupCount: async () => [],
  }) } });
  mock.module('../src/data/postgres-content-store', { namedExports: { pgSeoMetadata: async () => null } });
  mock.module('../src/services/precomputed-genres', { namedExports: { PrecomputedGenresService: {} } });
  mock.module('../src/seo/qualified-languages', { namedExports: { getCachedQualifiedLanguages: async () => [...ACTIVE_SITEMAP_LANGUAGES] } });
  const { urlRedirectMiddleware } = await import('../src/url-redirect-middleware');
  const { SeoRenderer } = await import('../src/seo-renderer');
  const renderer = new SeoRenderer();
  const app = express();
  app.use((req, res, next) => {
    if (req.get('x-test-direct') === '1') {
      return langIneligibilityRedirectMiddleware(req, res, () => { res.status(204).end(); });
    }
    next();
  });

  // Mirror the small country-prefix stage from index-web, without importing
  // that application entry point (which starts DB/bootstrap/background work).
  const languages = new Set(SEO_LANGUAGES.filter(language => language.enabled).map(language => language.code));
  const countryPrefixes = new Map(Object.entries(COUNTRY_TO_LANGUAGE).filter(([country, language]) => !languages.has(country) && languages.has(language)));
  app.use((req, res, next) => {
    const match = req.path.match(/^\/([a-z]{2})(\/.*)?$/i);
    const target = match && countryPrefixes.get(match[1].toLowerCase());
    if (!target) return next();
    const queryAt = req.originalUrl.indexOf('?');
    res.redirect(301, `/${target}${match?.[2] || ''}${queryAt >= 0 ? req.originalUrl.substring(queryAt) : ''}`);
  });
  app.use(urlRedirectMiddleware);
  app.use((req, res, next) => {
    if (req.get('x-test-direct') === 'url-only') return void res.status(204).end();
    next();
  });
  app.use(langIneligibilityRedirectMiddleware);
  // 204 only means the redirect stages pass to SSR. Actual station existence,
  // indexability and its eventual 200/404/410 status require the real database.
  app.use(async (req, res) => {
    if (req.get('x-test-ssr') !== '1') return void res.status(204).end();
    const page = await renderer.renderStaticPage(req.path, 'https://themegaradio.com');
    if (page.pageData?.redirectTo) {
      const queryAt = req.originalUrl.indexOf('?');
      return void res.redirect(301, page.pageData.redirectTo + (queryAt >= 0 ? req.originalUrl.slice(queryAt) : ''));
    }
    if (page.pageData?.stationIsJunk || page.pageData?.notFound) return sendJunkGone(res);
    res.status(200).json({ id: page.pageData?.station?._id, canonical: page.seoTags.canonical, noIndex: page.seoTags.noIndex === true });
  });
  server = await new Promise<Server>(resolve => {
    const value = app.listen(0, '127.0.0.1', () => resolve(value));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
  mock.restoreAll();
});

for (const [source, target] of [
  ['/af/stasie/profiel', '/en/station/profiel'],
  ['/af/stasie/stasie', '/en/station/stasie'],
  ['/hu/radio/radio', '/en/station/radio'],
  ['/af/stasie/WTOS', '/en/station/wtos'],
  ['/af/stasie/%C5%9Feker', '/en/station/%C5%9Feker'],
  ['/af/stasie/radio%20one', '/en/station/radio%20one'],
  ['/af/stasie/radio%23one', '/en/station/radio%23one'],
  ['/af/stasie/radio%3Fone', '/en/station/radio%3Fone'],
  ['/af/stasie/radio%2Fone', '/en/station/radio%2Fone'],
  ['/af/stasie/radio%252Fone', '/en/station/radio%252fone'],
  ['/af/stasie/radio%0Aone', '/en/station/radio%0Aone'],
  ['/af/stasie/profiel?utm_source=gsc%26test&x=%23', '/en/station/profiel?utm_source=gsc%26test&x=%23'],
]) {
  test(`localized station redirect preserves slug URL component: ${source}`, async () => {
    const response = await fetch(baseUrl + source, { redirect: 'manual', headers: { 'x-test-direct': '1' } });
    assert.equal(response.status, 301);
    assert.equal(response.headers.get('location'), target);
    assert.equal(response.headers.get('cache-control'), 'public, max-age=300, s-maxage=300');
  });
}

const fixture = (patch: Record<string, unknown> = {}) => ({ _id: 'safe-existing-id', slug: 'safe-existing-fm',
  slugAliases: ['old-safe-fm'], name: 'Safe Existing FM', noIndex: false, country: 'Germany',
  url: 'https://stream.example.invalid/live', lastCheckOk: true,
  descriptions: Object.fromEntries(ACTIVE_SITEMAP_LANGUAGES.map(language => [language, { full: `Full ${language}`, meta: `Meta ${language}` }])), ...patch });

async function followLocal(source: string) {
  const chain: Array<{ path: string; status: number; location: string | null }> = [];
  let path = source;
  for (let attempt = 0; attempt < 8; attempt++) {
    const response = await fetch(baseUrl + path, { redirect: 'manual', headers: { 'x-test-ssr': '1' } });
    const location = response.headers.get('location');
    chain.push({ path, status: response.status, location });
    if (response.status !== 301) return { chain, response, body: response.headers.get('content-type')?.includes('json') ? await response.json() as any : await response.text() };
    assert.ok(location);
    const next = new URL(location, baseUrl);
    assert.ok([baseUrl, 'https://themegaradio.com'].includes(next.origin));
    path = next.pathname + next.search;
  }
  assert.fail('redirect loop');
}

test('verified existing legacy station exact and alias routes reach English canonical in one warm-cache hop', async () => {
  const canonical = 'onda-rossa';
  stationRows = [fixture({ _id: '68a8c482bd66579311ab2f5b', slug: canonical, slugAliases: ['radio-onda-rossa-1'] })];
  for (const source of ['/af/station/onda-rossa', '/af/station/radio-onda-rossa-1', '/am/station/radio-onda-rossa-1', '/hu/radios/radio-onda-rossa-1']) {
    const results = [];
    for (const ready of [false, true]) {
      slugCacheReady = ready; pageCache.clear();
      const result = await followLocal(source + '?utm_source=gsc%26test&x=%23');
      assert.equal(result.response.status, 200); assert.equal(result.body.id, stationRows[0]._id);
      assert.equal(result.body.noIndex, false);
      assert.equal(result.chain.at(-1)?.path, `/en/station/${canonical}?utm_source=gsc%26test&x=%23`);
      if (ready) assert.equal(result.chain.length, 2, source);
      results.push(result.body);
    }
    assert.deepEqual(results[0], results[1], 'cache availability changes hop count, never destination identity/status');
  }
  const head = await fetch(baseUrl + '/af/station/radio-onda-rossa-1', { method: 'HEAD', redirect: 'manual' });
  assert.equal(head.status, 301);
  assert.equal(head.headers.get('location'), '/en/station/onda-rossa');
  assert.equal(head.headers.get('cache-control'), 'public, max-age=300, must-revalidate');
  slugCacheReady = false; stationRows = []; pageCache.clear();
});

test('exact GSC fm-100 alias and excluded/missing records keep warm/cold terminal policies without false404', async () => {
  for (const [patch, expected] of [
    [{ noIndex: true, lastCheckOk: false }, 200],
    [{ noIndex: true, lastCheckOk: true }, 410],
    [{ noIndex: true, lastCheckOk: false, manualEditFields: { noIndex: true } }, 410],
    [{ noIndex: false, url: '' }, 410],
    [null, 410],
  ] as const) {
    stationRows = patch ? [fixture({ _id: '68a8c4a6bd66579311ab887d', name: 'Джем FM', slug: 'dzhem-fm', slugAliases: ['fm-100'], ...patch })] : [];
    const outcomes = [];
    for (const ready of [false, true]) {
      slugCacheReady = ready; pageCache.clear();
      const result = await followLocal('/af/station/fm-100');
      assert.equal(result.response.status, expected);
      if (expected === 200) assert.equal(result.body.noIndex, true, 'offline informational page stays noindex');
      outcomes.push({ chain: result.chain, body: result.body });
    }
    assert.deepEqual(outcomes[0], outcomes[1], 'excluded and missing identities do not enter shortcut');
  }
  slugCacheReady = false; stationRows = []; pageCache.clear();
});

test('all fourteen canonical languages retain their locale with a warm identity cache', async () => {
  stationRows = [fixture()]; slugCacheReady = true;
  for (const language of ACTIVE_SITEMAP_LANGUAGES) {
    pageCache.clear();
    const segment = URL_TRANSLATIONS[language]?.station || 'station';
    const path = `/${language}/${encodeURIComponent(segment)}/safe-existing-fm`;
    const result = await followLocal(path);
    assert.equal(result.response.status, 200, language); assert.equal(result.chain.length, 1, language);
    assert.equal(result.body.canonical, `https://themegaradio.com${path}`, language);
  }
  slugCacheReady = false; stationRows = []; pageCache.clear();
});

test('encoded/Unicode slugs stay on the existing SSR path with identical warm/cold identity policy', async () => {
  stationRows = [fixture({ slug: 'şeker-fm', slugAliases: ['eski-şeker'] }), fixture({ slugAliases: ['eski-güvenli'] })];
  for (const source of ['/af/stasie/%C5%9Feker-fm', '/af/station/eski-%C5%9Feker', '/af/station/eski-g%C3%BCvenli']) {
    const outcomes = [];
    for (const ready of [false, true]) {
      slugCacheReady = ready; pageCache.clear();
      const result = await followLocal(source);
      outcomes.push({ chain: result.chain, body: result.body });
    }
    assert.deepEqual(outcomes[0], outcomes[1], source);
  }
  slugCacheReady = false; stationRows = []; pageCache.clear();
});

test('shortcut does not add locale redirects to private/query-only/A-Z paths or mutation requests', async () => {
  stationRows = [fixture()]; slugCacheReady = true;
  for (const [method, path] of [['GET', '/af/profiel'], ['GET', '/af?station=old-safe-fm'],
    ['GET', '/af/stasies/a'], ['POST', '/af/stasie/safe-existing-fm']]) {
    const response = await fetch(baseUrl + path, { method, redirect: 'manual', headers: { 'x-test-direct': 'url-only' } });
    // Browse-language middleware already redirects /af browse pages, so test
    // the URL canonicalizer in isolation using the dedicated branch below.
    assert.equal(response.status, 204, path); assert.equal(response.headers.get('location'), null, path);
  }
  slugCacheReady = false; stationRows = []; pageCache.clear();
});

test('universal-14 station locale is not redirected to English', async () => {
  for (const language of ['en', 'es', 'fr', 'de', 'pt', 'it', 'ru', 'ar', 'zh', 'tr', 'ja', 'ko', 'hi', 'he']) {
    const response = await fetch(`${baseUrl}/${language}/station/example`, { redirect: 'manual', headers: { 'x-test-direct': '1' } });
    assert.equal(response.status, 204, language);
    assert.equal(response.headers.get('location'), null, language);
  }
});

test('HEAD redirects identically, malformed encoding and POST pass through', async () => {
  const head = await fetch(baseUrl + '/af/stasie/profiel', { method: 'HEAD', redirect: 'manual', headers: { 'x-test-direct': '1' } });
  assert.equal(head.status, 301);
  assert.equal(head.headers.get('location'), '/en/station/profiel');
  for (const [method, pathname] of [['GET', '/af/stasie/%E0%A4%A'], ['POST', '/af/stasie/profiel']]) {
    const response = await fetch(baseUrl + pathname, { method, redirect: 'manual', headers: { 'x-test-direct': '1' } });
    assert.equal(response.status, 204);
  }
});

for (const [source, target, hops] of [
  ['/af/stasie/wtos', '/en/station/wtos', 1],
  ['/af/station/wtos', '/en/station/wtos', 2],
  ['/ee/station/kamu-radio-fm-909', '/en/station/kamu-radio-fm-909', 1],
  ['/ar/station/nrj-oriental', '/ar/mahta/nrj-oriental', 1],
  ['/am/station/nrj-international-hits', '/en/station/nrj-international-hits', 2],
  ['/jo/station/sveriges-radio-p3-2', '/ar/mahta/sveriges-radio-p3-2', 2],
  ['/om/station/sveriges-radio-p3-2', '/ar/mahta/sveriges-radio-p3-2', 2],
  ['/hu/radios/1-21', '/en/station/1-21', 2],
  ['/hu/radio/1-21', '/en/station/1-21', 1],
] as const) {
  test(`GSC historical URL reaches a stable redirect target without a loop: ${source}`, async () => {
    const seen = new Set<string>();
    let current: string = source;
    let redirectCount = 0;
    for (let attempt = 0; attempt < 8; attempt++) {
      assert.ok(!seen.has(current), `redirect loop at ${current}`);
      seen.add(current);
      const response = await fetch(baseUrl + current, { redirect: 'manual' });
      if (response.status === 204) {
        assert.equal(current, target);
        assert.equal(redirectCount, hops);
        return;
      }
      assert.equal(response.status, 301);
      const location = response.headers.get('location');
      assert.ok(location);
      const next = new URL(location, baseUrl);
      assert.equal(next.origin, baseUrl);
      current = next.pathname + next.search;
      redirectCount++;
    }
    assert.fail('redirect did not stabilize within 8 requests');
  });
}
