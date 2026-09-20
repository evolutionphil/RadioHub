import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { performanceCache, SEO_CACHE_NAMESPACE } from '../src/performance-cache';
import { withPublicStationDeadline, limitPublicStationDeadline, getPublicStationDeadline } from '../src/utils/public-station-deadline';
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

test('negative data lasts at most60s, evicts stale HTML and prevents new cached HTML; informational-page TTL unchanged', () => {
  const cache = performanceCache as any;
  for (const flag of ['stationIsJunk', 'notFound']) {
    const url = `/en/station/cache-recovery-${flag}`;
    const pageKey = `page:${SEO_CACHE_NAMESPACE}:${url}`;
    performanceCache.setPageData(url, { pageData: { pageType: 'about' } });
    performanceCache.setSeoHtml(url, '<p>old healthy page</p>');
    assert.ok(cache.pageDataCache.getTtl(pageKey) - Date.now() > 1700000);
    assert.ok(performanceCache.getSeoHtml(url));
    performanceCache.setPageData(url, { pageData: { [flag]: true } });
    const ttl = cache.pageDataCache.getTtl(pageKey) - Date.now();
    assert.ok(ttl > 59000 && ttl <= 60000);
    assert.equal(performanceCache.getSeoHtml(url), null);
    performanceCache.setSeoHtml(url, '<p>must not survive the negative guard</p>');
    assert.equal(performanceCache.getSeoHtml(url), null);
    cache.pageDataCache.ttl(pageKey, -1);
    assert.equal(performanceCache.getPageData(url), null);
    performanceCache.setPageData(url, { pageData: { pageType: 'about', stationIsJunk: false } });
    performanceCache.setSeoHtml(url, '<p>recovered</p>');
    assert.equal(performanceCache.getSeoHtml(url), '<p>recovered</p>');
    assert.ok(cache.pageDataCache.getTtl(pageKey) - Date.now() > 1700000);
    performanceCache.invalidateStationCache(`cache-recovery-${flag}`);
  }
});

test('station-dependent page and HTML caches share the earliest datasource deadline without TTL renewal', async () => {
  const cache = performanceCache as any;
  for (const pageType of ['home', 'station', 'stations', 'genres', 'regions']) {
    const url = `/en/cache-health-${pageType}`;
    const pageKey = `page:${SEO_CACHE_NAMESPACE}:${url}`;
    const htmlKey = `seo:${SEO_CACHE_NAMESPACE}:bot:${url}`;
    const deadline = Date.now() + 5000;
    await withPublicStationDeadline(async () => {
      limitPublicStationDeadline(deadline); // upstream 60s pool is already55s old
      performanceCache.setPageData(url, { pageData: { pageType } });
    });
    const expires = cache.pageDataCache.getTtl(pageKey);
    assert.ok(expires <= deadline && expires > deadline - 100);
    performanceCache.setSeoHtml(url, '<main>retained</main>');
    assert.ok(cache.seoHtmlCache.getTtl(htmlKey) <= expires);
    await withPublicStationDeadline(async () => {
      assert.ok(performanceCache.getPageData(url));
      assert.ok(getPublicStationDeadline() <= expires);
    });
    cache.pageDataCache.ttl(pageKey, -1); cache.seoHtmlCache.ttl(htmlKey, -1);
    assert.equal(performanceCache.getPageData(url), null);
    assert.equal(performanceCache.getSeoHtml(url), null);
  }
});

test('direct station details and notices are cached at most60s without changing their successful content', () => {
  const cache = performanceCache as any;
  const url = '/en/station/health-deadline';
  const page = { pageData: { pageType: 'station', station: { lastCheckOk: false, name: 'Real FM' } } };
  performanceCache.setPageData(url, page);
  performanceCache.setSeoHtml(url, '<main>Real information with temporarily unavailable notice</main>');
  assert.ok(cache.pageDataCache.getTtl(`page:${SEO_CACHE_NAMESPACE}:${url}`) - Date.now() <= 60000);
  assert.equal(performanceCache.getPageData(url), page);
  assert.ok(performanceCache.getSeoHtml(url)?.includes('Real information'));
  performanceCache.invalidateStationCache('health-deadline');
});

test('a retained noindex information page expires within 60s after recovery in another process without renewing its HTML deadline', t => {
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const cache = performanceCache as any;
  const url = '/en/station/offline-noindex-recovery';
  const pageKey = `page:${SEO_CACHE_NAMESPACE}:${url}`;
  const htmlKey = `seo:${SEO_CACHE_NAMESPACE}:bot:${url}`;
  const before = {
    seoTags: { noIndex: true },
    pageData: { pageType: 'station', station: { noIndex: true, lastCheckOk: false, isListVisible: false } },
  };
  performanceCache.setPageData(url, before);
  performanceCache.setSeoHtml(url, '<meta name="robots" content="noindex, follow">');
  const deadline = cache.pageDataCache.getTtl(pageKey);
  assert.ok(deadline <= now + 60_000);

  // The API process commits a repair, while this web process still has its
  // old page. A late cache hit or HTML render must not restart the 60s window.
  now += 45_000;
  assert.equal(performanceCache.getPageData(url), before);
  assert.match(performanceCache.getSeoHtml(url)!, /noindex/);
  performanceCache.setSeoHtml(url, '<meta name="robots" content="noindex, follow">');
  assert.ok(cache.seoHtmlCache.getTtl(htmlKey) <= deadline);

  now = deadline + 1;
  assert.equal(performanceCache.getPageData(url), null);
  assert.equal(performanceCache.getSeoHtml(url), null);
  const after = {
    seoTags: { noIndex: false },
    pageData: { pageType: 'station', station: { ...before.pageData.station, noIndex: false } },
  };
  performanceCache.setPageData(url, after);
  performanceCache.setSeoHtml(url, '<meta name="robots" content="index, follow">');
  assert.equal(performanceCache.getPageData(url).seoTags.noIndex, false);
  assert.equal(performanceCache.getSeoHtml(url), '<meta name="robots" content="index, follow">');
  assert.equal(performanceCache.getPageData(url).pageData.station.lastCheckOk, false);
  assert.equal(performanceCache.getPageData(url).pageData.station.isListVisible, false);
  performanceCache.invalidateStationCache('offline-noindex-recovery');
});
