import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { performanceCache } from '../src/performance-cache';
import { sendJunkGone } from '../src/seo/send-junk-gone';

test('excluded station HTTP responses remain genuine410/noindex but cannot persist in browser/CDN', async () => {
  const app = express(); app.use((_req, res) => sendJunkGone(res));
  const server = await new Promise<any>(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    for (const method of ['GET', 'HEAD']) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/en/station/excluded`, { method });
      assert.equal(response.status, 410);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('x-robots-tag'), 'noindex, follow');
      assert.equal(await response.text(), method === 'HEAD' ? '' : '410 Gone');
    }
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(resolve)); }
});

test('negative data lasts at most60s, evicts stale HTML and prevents new cached HTML; healthy TTL unchanged', () => {
  const cache = performanceCache as any;
  for (const flag of ['stationIsJunk', 'notFound']) {
    const url = `/en/station/cache-recovery-${flag}`;
    performanceCache.setPageData(url, { pageData: { station: { slug: flag } } });
    performanceCache.setSeoHtml(url, '<p>old healthy page</p>');
    assert.ok(cache.pageDataCache.getTtl(`page:${url}`) - Date.now() > 1700000);
    assert.ok(performanceCache.getSeoHtml(url));
    performanceCache.setPageData(url, { pageData: { [flag]: true } });
    const ttl = cache.pageDataCache.getTtl(`page:${url}`) - Date.now();
    assert.ok(ttl > 59000 && ttl <= 60000);
    assert.equal(performanceCache.getSeoHtml(url), null);
    performanceCache.setSeoHtml(url, '<p>must not survive the negative guard</p>');
    assert.equal(performanceCache.getSeoHtml(url), null);
    cache.pageDataCache.ttl(`page:${url}`, -1);
    assert.equal(performanceCache.getPageData(url), null);
    performanceCache.setPageData(url, { pageData: { stationIsJunk: false } });
    performanceCache.setSeoHtml(url, '<p>recovered</p>');
    assert.equal(performanceCache.getSeoHtml(url), '<p>recovered</p>');
    assert.ok(cache.pageDataCache.getTtl(`page:${url}`) - Date.now() > 1700000);
    performanceCache.invalidateStationCache(`cache-recovery-${flag}`);
  }
});
