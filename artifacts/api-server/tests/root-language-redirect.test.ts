import { after, before, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

let server: Server;
let baseUrl: string;
before(async () => {
  mock.module('../src/performance-cache', { namedExports: {
    performanceCache: { getUrlTranslations: async () => new Map() },
  } });
  mock.module('../src/seo/slug-existence', { namedExports: {
    getCanonicalStationSlug: () => null, isSlugExistenceReady: () => false,
  } });
  const { urlRedirectMiddleware } = await import('../src/url-redirect-middleware');
  const app = express();
  app.use(urlRedirectMiddleware);
  app.use((_req, res) => { res.status(204).end(); });
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

for (const [accept, cookie, target] of [
  ['de-AT,de;q=0.9,en;q=0.8', '', 'de'],
  ['de-DE,de;q=0.9', '', 'de'],
  ['de-AT', 'preferredLanguage=tr', 'tr'],
  ['de-AT', 'preferredLanguage=en', 'en'],
  ['en-US', 'preferredLanguage=de', 'de'],
  ['zz-ZZ,de-DE;q=0.8,en;q=0.2', '', 'de'],
  ['en;q=0.3,de-AT;q=0.9', '', 'de'],
  ['de;q=0,en;q=0.5', '', 'en'],
  ['zz-ZZ', '', 'en'],
  ['de-DE', 'notpreferredLanguage=tr; preferredLanguage=invalid', 'de'],
  ['de-DE', 'preferredLanguage=trailing', 'de'],
]) {
  test(`root selects ${target} for ${accept} / ${cookie || 'no cookie'}, independent of IP country`, async () => {
    const response = await fetch(baseUrl + '/?utm_source=iphone%26test', {
      redirect: 'manual', headers: { 'accept-language': accept, cookie, 'cf-ipcountry': 'US' },
    });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), `/${target}?utm_source=iphone%26test`);
    assert.match(response.headers.get('cache-control') || '', /private/);
    assert.match(response.headers.get('cache-control') || '', /no-store/);
    assert.match(response.headers.get('vary') || '', /Cookie/i);
    assert.match(response.headers.get('vary') || '', /Accept-Language/i);
  });
}

for (const path of ['/en', '/tr', '/de', '/ar']) {
  test(`explicit ${path} never follows a saved/device/IP language`, async () => {
    const response = await fetch(baseUrl + path, { redirect: 'manual', headers: {
      cookie: 'preferredLanguage=de', 'accept-language': 'de-AT', 'cf-ipcountry': 'US',
    } });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('location'), null);
  });
}

test('bare content canonicalization remains deterministic English', async () => {
  const response = await fetch(baseUrl + '/station/example', { redirect: 'manual', headers: {
    cookie: 'preferredLanguage=de', 'accept-language': 'de-AT',
  } });
  assert.equal(response.status, 301);
  assert.equal(response.headers.get('location'), '/en/station/example');
});

test('bot root remains deterministic and cannot poison a user redirect cache', async () => {
  const response = await fetch(baseUrl + '/', { redirect: 'manual', headers: {
    'user-agent': 'Googlebot', 'accept-language': 'de-AT', cookie: 'preferredLanguage=tr',
  } });
  assert.equal(response.headers.get('location'), '/en');
  assert.match(response.headers.get('cache-control') || '', /no-store/);
  assert.match(response.headers.get('vary') || '', /User-Agent/i);
});
