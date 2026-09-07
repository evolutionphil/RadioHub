import { after, before, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

let server: Server;
let baseUrl: string;
let precompute: () => void;
const dictionary = {
  homepage_popular_stations: 'Beliebte Sender',
  homepage_community_favorites: 'Favoriten der Community',
  recently_played: 'Zuletzt gehört',
  meta_title: 'Mega Radio Deutsch',
  nav_home: 'Startseite',
  auth_login: '</script><script>unexpected()</script>',
  noncritical_admin_detail: 'Loads later through the full dictionary',
};

before(async () => {
  mock.module('../src/performance-cache', { namedExports: {
    performanceCache: { getTranslations: (language: string) => language === 'de' ? dictionary : undefined },
  } });
  const module = await import('../src/html-lang-middleware');
  precompute = module.precomputeTranslationScripts;
  const app = express();
  app.use(module.htmlLangMiddleware);
  app.use((_req, res) => res.type('html').send('<!DOCTYPE html><html lang="en"><head><title>Station-specific title</title></head><body>Station</body></html>'));
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

for (const cached of [false, true]) {
  test(`SSR uses the shared critical keys without embedding the full dictionary (${cached ? 'precomputed' : 'cold'})`, async () => {
    if (cached) precompute();
    const response = await fetch(baseUrl + '/de', { headers: { accept: 'text/html', cookie: 'preferredLanguage=tr' } });
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /<html lang="de">/);
    assert.match(html, /<title>Station-specific title<\/title>/);
    assert.match(html, /window\.__INITIAL_LANGUAGE__="de"/);
    assert.match(html, /"homepage_popular_stations":"Beliebte Sender"/);
    assert.match(html, /"homepage_community_favorites":"Favoriten der Community"/);
    assert.match(html, /"recently_played":"Zuletzt gehört"/);
    assert.match(html, /"nav_home":"Startseite"/);
    assert.doesNotMatch(html, /noncritical_admin_detail/);
    assert.doesNotMatch(html, /<script>unexpected\(\)<\/script>/);
    assert.match(html, /\\u003c\/script>/);
  });
}
