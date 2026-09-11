import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createCloudflareWebVitalsService, parseVitalsPeriod, WEB_VITALS_QUERY } from '../src/services/cloudflare-web-vitals';

const time = Date.parse('2026-09-11T12:00:00Z');
const period = parseVitalsPeriod(undefined, undefined, time)!;
const env = { CLOUDFLARE_ACCOUNT_ID: 'test-account', CLOUDFLARE_API_KEY: 'secret-token' };
const data = (groups: unknown[]) => Response.json({ data: { viewer: { accounts: [{ rumWebVitalsEventsAdaptiveGroups: groups }] } }, errors: [] });
const point = { count: 100, sum: { lcpTotal: 90, inpTotal: 30, clsTotal: 90 }, quantiles: {
  largestContentfulPaintP50: 1800000, largestContentfulPaintP75: 2500000, largestContentfulPaintP95: 6000000,
  interactionToNextPaintP50: 50000, interactionToNextPaintP75: 200000, interactionToNextPaintP95: 600000,
  cumulativeLayoutShiftP50: 0, cumulativeLayoutShiftP75: 0.1, cumulativeLayoutShiftP95: 0.3,
} };
it('validates a bounded UTC period and stable default minute for caching', () => {
  assert.equal(period.start, '2026-09-04T12:00:00.000Z');
  assert.deepEqual(parseVitalsPeriod(undefined, undefined, time + 1234), period);
  for (const [start, end] of [['junk', undefined], [[], undefined], ['2026-09-01T00:00:00Z', undefined], ['2026-09-12T00:00:00Z', undefined], [undefined, '2026-09-12T00:00:00Z'], ['2026-09-11T12:00:00Z', '2026-09-11T12:00:00Z']]) {
    assert.equal(parseVitalsPeriod(start, end, time), null);
  }
});
it('returns honest missing configuration without a network call or zero metrics', async () => {
  const get = createCloudflareWebVitalsService({ env: {}, fetch: async () => { throw new Error('must not fetch'); } });
  const result = await get(period);
  assert.equal(result.status, 'configuration_required'); assert.equal(result.reason, 'missing_credentials');
  assert.equal(result.lcp.p75, null); assert.equal(result.estimatedPageViews, null);
});
it('queries a single host-scoped aggregate and converts verified microsecond units', async () => {
  let calls = 0;
  const get = createCloudflareWebVitalsService({ env, fetch: async (url, init) => {
    calls++; assert.equal(url, 'https://api.cloudflare.com/client/v4/graphql');
    assert.equal((init!.headers as any).Authorization, 'Bearer secret-token');
    const body = JSON.parse(init!.body as string);
    assert.equal(body.query, WEB_VITALS_QUERY); assert.match(body.query, /requestHost_in: \["themegaradio.com", "www.themegaradio.com"\]/);
    assert.doesNotMatch(body.query, /dimensions|orderBy|\blcpP75\b/); assert.match(body.query, /limit: 1/);
    return data([point]);
  } });
  const result = await get(period);
  assert.equal(calls, 1); assert.equal(result.status, 'available'); assert.equal(result.estimatedPageViews, 100);
  assert.deepEqual(result.lcp, { p50: 1800, p75: 2500, p95: 6000, status: 'good' });
  assert.equal(result.inp.p75, 200); assert.equal(result.cls.p50, 0); assert.equal(result.cls.p75, 0.1);
});
it('never averages grouped percentiles into a fabricated percentile', async () => {
  const get = createCloudflareWebVitalsService({ env, fetch: async () => data([point, point]) });
  const result = await get(period); assert.equal(result.status, 'upstream_unavailable'); assert.equal(result.lcp.p75, null);
});
it('preserves negative/missing metric sentinels and zero metric observation counts as no_data', async () => {
  const get = createCloudflareWebVitalsService({ env, fetch: async () => data([{ ...point, sum: { lcpTotal: 1, inpTotal: 0, clsTotal: 1 }, quantiles: {
    ...point.quantiles, largestContentfulPaintP75: -1, largestContentfulPaintP95: undefined, cumulativeLayoutShiftP75: null,
  } }]) });
  const result = await get(period); assert.equal(result.status, 'no_data');
  assert.equal(result.lcp.p75, null); assert.equal(result.lcp.p95, null); assert.equal(result.inp.p75, null); assert.equal(result.cls.p75, null);
});
it('empty data is distinct from invalid/provider data', async () => {
  const get = createCloudflareWebVitalsService({ env, fetch: async () => data([]) });
  const result = await get(period); assert.equal(result.status, 'no_data'); assert.equal(result.estimatedPageViews, 0); assert.equal(result.cls.status, 'no_data');
  const invalid = createCloudflareWebVitalsService({ env, fetch: async () => Response.json({ data: {} }) });
  assert.equal((await invalid(period)).status, 'upstream_unavailable');
});
it('sanitizes the real GraphQL account access failure and missing token permission', async () => {
  const get = createCloudflareWebVitalsService({ env, fetch: async () => Response.json({ errors: [{ message: 'not authorized for that account test-account secret-token' }] }) });
  const result = await get(period); assert.equal(result.status, 'configuration_required'); assert.equal(result.reason, 'access_denied');
  assert.match(result.message, /Account Analytics Read/); assert.doesNotMatch(JSON.stringify(result), /test-account|secret-token/);
});
it('does not expose HTTP, GraphQL or network error details', async () => {
  for (const fetcher of [async () => new Response('secret-token', { status: 500 }), async () => Response.json({ errors: [{ message: 'secret-token invalid query' }] }), async () => { throw new Error('secret-token'); }]) {
    const get = createCloudflareWebVitalsService({ env, fetch: fetcher });
    const result = await get(period); assert.equal(result.status, 'upstream_unavailable'); assert.doesNotMatch(JSON.stringify(result), /secret-token/);
  }
});
it('supports preferred API tokens and global-key authentication without changing legacy token deployments', async () => {
  for (const config of [{ ...env, CLOUDFLARE_API_TOKEN: 'preferred' }, { ...env, CLOUDFLARE_EMAIL: 'test@example.invalid' }]) {
    const get = createCloudflareWebVitalsService({ env: config, fetch: async (_url, init) => {
      const headers = init!.headers as Record<string, string>;
      if ('CLOUDFLARE_API_TOKEN' in config) assert.equal(headers.Authorization, 'Bearer preferred');
      else { assert.equal(headers['X-Auth-Key'], 'secret-token'); assert.equal(headers['X-Auth-Email'], 'test@example.invalid'); assert.equal(headers.Authorization, undefined); }
      return data([]);
    } });
    await get(period);
  }
});
it('single-flights concurrent requests and expires successful data after five minutes', async () => {
  let clock = time, calls = 0, finish!: (value: Response) => void;
  const get = createCloudflareWebVitalsService({ env, now: () => clock, fetch: async () => { calls++; return calls === 1 ? new Promise<Response>(resolve => { finish = resolve; }) : data([point]); } });
  const one = get(period), two = get(period); assert.equal(calls, 1); finish(data([point]));
  assert.deepEqual(await one, await two); await get(period); assert.equal(calls, 1);
  clock += 300001; await get(period); assert.equal(calls, 2);
});
it('backs off failures for one minute and refreshes immediately when credentials change', async () => {
  let clock = time, calls = 0; const config = { ...env };
  const get = createCloudflareWebVitalsService({ env: config, now: () => clock, fetch: async () => { calls++; return new Response('', { status: 403 }); } });
  await get(period); await get(period); assert.equal(calls, 1);
  clock += 60001; await get(period); assert.equal(calls, 2);
  config.CLOUDFLARE_API_KEY = 'rotated'; await get(period); assert.equal(calls, 3);
});
it('aborts a slow upstream instead of leaving a pending admin request', async () => {
  const get = createCloudflareWebVitalsService({ env, timeoutMs: 10, fetch: async (_url, init) => new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true })) });
  const keepAlive = setTimeout(() => {}, 1000);
  try { const result = await get(period); assert.equal(result.reason, 'timeout'); assert.equal(result.lcp.p75, null); }
  finally { clearTimeout(keepAlive); }
});
