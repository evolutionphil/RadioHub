import { after, before, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { getLanguageFromPath, SEO_LANGUAGES } from '@workspace/seo-shared/seo-config';
import { URL_TRANSLATIONS } from '@workspace/seo-shared/url-translations';
import { buildLocalizedUrl } from '../src/seo/url-helpers';

// Exact active Arabic mappings observed in PostgreSQL. No database mutation.
const mappings = new Map([
  ['ar:radios', 'radiohat'], ['ar:stations', 'mahtat'], ['ar:station', 'mahta'],
]);
let server: Server;
let baseUrl: string;
before(async () => {
  mock.module('../src/performance-cache', { namedExports: {
    performanceCache: { getUrlTranslations: async () => mappings },
  } });
  mock.module('../src/seo/slug-existence', { namedExports: {
    getCanonicalStationSlug: () => null, isSlugExistenceReady: () => false,
  } });
  const { urlRedirectMiddleware } = await import('../src/url-redirect-middleware');
  const app = express();
  app.use(urlRedirectMiddleware);
  app.use((req, res) => { res.status(200).json(getLanguageFromPath(req.path)); });
  server = await new Promise<Server>(resolve => {
    const value = app.listen(0, '127.0.0.1', () => resolve(value));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => {
  server?.closeAllConnections();
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  mock.restoreAll();
});

test('Arabic sitemap catalog URL is stable and resolves to the SSR/SPA stations route', async () => {
  const canonical = buildLocalizedUrl('/stations', 'ar', undefined, mappings);
  assert.equal(canonical, '/ar/mahtat');
  const response = await fetch(baseUrl + canonical, { redirect: 'manual' });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('location'), null);
  assert.deepEqual(await response.json(), { language: 'ar', cleanPath: '/stations' });
});

for (const alias of ['radiohat', 'radios', 'stations', 'station', 'mahta']) {
  test(`Arabic ${alias} reaches the existing canonical catalog in one hop, preserving query`, async () => {
    const response = await fetch(`${baseUrl}/ar/${alias}?page=2`, { redirect: 'manual' });
    assert.equal(response.status, 301);
    assert.equal(response.headers.get('location'), '/ar/mahtat?page=2');
    const final = await fetch(baseUrl + response.headers.get('location'), { redirect: 'manual' });
    assert.equal(final.status, 200);
    assert.deepEqual(await final.json(), { language: 'ar', cleanPath: '/stations' });
  });
}

test('all other configured language catalog paths keep their seeded canonical', async () => {
  for (const { code } of SEO_LANGUAGES.filter(language => language.enabled && language.code !== 'ar')) {
    const canonical = `/${code}/${URL_TRANSLATIONS[code]?.stations || 'stations'}`;
    const response = await fetch(baseUrl + canonical, { redirect: 'manual' });
    assert.equal(response.status, 200, `${code}: ${response.headers.get('location')}`);
  }
});

test('Arabic station detail and unrelated routes are not collapsed into the catalog', async () => {
  for (const path of ['/ar/mahta/nrj-oriental', '/ar/an']) {
    const response = await fetch(baseUrl + path, { redirect: 'manual' });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('location'), null);
  }
});
