import { after, before, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { COUNTRY_TO_LANGUAGE, SEO_LANGUAGES } from '@workspace/seo-shared/seo-config';
import { langIneligibilityRedirectMiddleware } from '../src/middleware/lang-ineligibility-redirect';

let server: Server;
let baseUrl: string;

before(async () => {
  // No production DB reads: only the URL-token cache and slug-alias cache are
  // replaced. Both redirect middlewares and Express's Location handling run.
  mock.module('../src/performance-cache', { namedExports: {
    performanceCache: { getUrlTranslations: async () => new Map() },
  } });
  mock.module('../src/seo/slug-existence', { namedExports: {
    getCanonicalStationSlug: () => null,
    isSlugExistenceReady: () => false,
  } });
  const { urlRedirectMiddleware } = await import('../src/url-redirect-middleware');
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
  app.use(langIneligibilityRedirectMiddleware);
  // 204 only means the redirect stages pass to SSR. Actual station existence,
  // indexability and its eventual 200/404/410 status require the real database.
  app.use((_req, res) => { res.status(204).end(); });
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
