import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createVisitorDetailsHandler, createVisitorMetricsHandler, registerVisitorMetricsRoutes } from '../src/routes/visitor-metrics-routes';
import type { VisitorDetails } from '../src/data/postgres-visitor-metrics';
import { requireAdmin } from '../src/middleware/auth';

const fixture = { activeVisitors: 0, todayVisitors: 2, weekVisitors: 3, computedAt: '2026-09-21T00:00:00.000Z',
  collectionStartedAt: '2026-09-20T23:30:00.000Z', activeWindowMinutes: 30, timezone: 'Europe/Berlin',
  identity: 'unique-ip' as const, source: 'qualified-http-requests' as const, retentionDays: 30 };
const invoke = async (handler: any, query: Record<string, unknown> = {}) => {
  const response = { statusCode: 200, body: undefined as any, headers: {} as Record<string, unknown>,
    setHeader(k: string, v: string) { this.headers[k] = v; }, status(n: number) { this.statusCode = n; return this; },
    json(body: unknown) { this.body = body; } };
  await handler({ query }, response); return response;
};
test('real zero and source timestamps survive; concurrent polls share a bounded fresh read', async () => {
  let clock = 0, calls = 0;
  const handler = createVisitorMetricsHandler(async () => { calls++; return fixture; }, () => clock);
  const results = await Promise.all([invoke(handler), invoke(handler), invoke(handler)]);
  assert.equal(calls, 1);
  for (const result of results) { assert.equal(result.statusCode, 200); assert.deepEqual(result.body, fixture); assert.equal(result.headers['Cache-Control'], 'private, no-store'); }
  clock = 14_999; await invoke(handler); assert.equal(calls, 1);
  clock = 15_000; await invoke(handler); assert.equal(calls, 2);
});

const detailsFixture: VisitorDetails = { window: 'active', computedAt: fixture.computedAt,
  collectionStartedAt: fixture.collectionStartedAt, dimensionsStartedAt: fixture.collectionStartedAt,
  activeWindowMinutes: 30, timezone: 'Europe/Berlin', identity: 'unique-ip', attribution: 'latest-request', retentionDays: 30,
  totalVisitors: 0, matchedVisitors: 0, breakdowns: { countries: [], channels: [], platforms: [], devices: [] },
  pagination: { page: 1, limit: 25, total: 0, totalPages: 0 }, visitors: [] };

test('details apply bounded canonical defaults, preserve real zero and singleflight equivalent queries for 15 seconds', async () => {
  let clock = 0, calls = 0;
  const handler = createVisitorDetailsHandler(async query => {
    calls++; assert.deepEqual(query, { window: 'active', page: 1, limit: 25 }); return detailsFixture;
  }, () => clock);
  const responses = await Promise.all([invoke(handler), invoke(handler, { window: 'active', page: '1', limit: '25' })]);
  assert.equal(calls, 1);
  for (const response of responses) {
    assert.deepEqual(response.body, detailsFixture); assert.equal(response.statusCode, 200);
    assert.equal(response.headers['Cache-Control'], 'private, no-store');
  }
  clock = 14_999; await invoke(handler); assert.equal(calls, 1);
  clock = 15_000; await invoke(handler); assert.equal(calls, 2);
});

test('details reject malformed filters, arrays, unknown arguments and oversized pagination before any read', async () => {
  let calls = 0;
  const handler = createVisitorDetailsHandler(async () => { calls++; return detailsFixture; });
  const invalid = [
    { window: 'month' }, { window: ['active', 'week'] }, { page: '0' }, { page: '-1' }, { page: '1.5' },
    { page: '1000000' }, { page: '1e3' }, { page: '01' }, { limit: '0' }, { limit: '101' }, { limit: '25abc' },
    { limit: 25 }, { country: 'de' }, { country: 'ZZ' }, { country: 'XX' }, { country: '' }, { country: "DE' OR true--" }, { country: { value: 'DE' } },
    { platform: 'watchos' }, { platform: ['ios'] }, { deviceType: 'watch' }, { rawIp: 'true' },
  ];
  for (const query of invalid) {
    const response = await invoke(handler, query);
    assert.equal(response.statusCode, 400, JSON.stringify(query));
    assert.deepEqual(response.body, { error: 'Invalid visitor details query' });
    assert.equal(response.headers['Cache-Control'], 'private, no-store');
  }
  assert.equal(calls, 0);
});

test('details pass permitted filters and maximum page size as parsed values', async () => {
  const handler = createVisitorDetailsHandler(async query => {
    assert.deepEqual(query, { window: 'week', page: 999999, limit: 100, country: 'unknown', platform: 'androidtv', deviceType: 'tv' });
    return detailsFixture;
  });
  assert.equal((await invoke(handler, { window: 'week', page: '999999', limit: '100', country: 'unknown', platform: 'androidtv', deviceType: 'tv' })).statusCode, 200);
});

test('details failed refresh returns generic unavailable rather than stale data, fake counts or driver/IP details', async () => {
  let clock = 0, fail = false;
  const handler = createVisitorDetailsHandler(async () => {
    if (fail) throw new Error('driver: 203.0.113.199 secret-token'); return detailsFixture;
  }, () => clock);
  await invoke(handler); fail = true; clock = 15_000;
  const failed = await invoke(handler);
  assert.equal(failed.statusCode, 503);
  assert.deepEqual(failed.body, { error: 'Unique visitor details temporarily unavailable' });
  fail = false; assert.equal((await invoke(handler)).statusCode, 200);
});

test('details cache bounds concurrent distinct reads to four while sharing equivalent in-flight requests', async () => {
  let calls = 0;
  const resolvers: Array<() => void> = [];
  const handler = createVisitorDetailsHandler(async () => {
    calls++; await new Promise<void>(resolve => resolvers.push(resolve)); return detailsFixture;
  });
  const pending = Array.from({ length: 4 }, (_, i) => invoke(handler, { page: String(i + 1) }));
  const shared = invoke(handler, { page: '1' });
  await Promise.resolve();
  assert.equal(calls, 4);
  assert.equal((await invoke(handler, { page: '5' })).statusCode, 503);
  assert.equal(calls, 4);
  for (const resolve of resolvers) resolve();
  await Promise.all([...pending, shared]);
  const next = invoke(handler, { page: '5' });
  await Promise.resolve(); resolvers.at(-1)!();
  assert.equal((await next).statusCode, 200); assert.equal(calls, 5);
});

test('details cache bounds resident keys to 128 independently of the read concurrency cap', async () => {
  let calls = 0;
  const handler = createVisitorDetailsHandler(async () => { calls++; return detailsFixture; });
  for (let page = 1; page <= 128; page++) assert.equal((await invoke(handler, { page: String(page) })).statusCode, 200);
  assert.equal(calls, 128);
  await invoke(handler, { page: '1' }); assert.equal(calls, 128);
  await invoke(handler, { page: '129' }); assert.equal(calls, 129);
  // Inserting key 129 evicts key 1; a new read proves the cache stayed bounded.
  await invoke(handler, { page: '1' }); assert.equal(calls, 130);
});

test('details registration uses the actual admin gate before data access', async () => {
  const routes = new Map<string, any[]>();
  registerVisitorMetricsRoutes({ get: (path: string, ...handlers: any[]) => routes.set(path, handlers) } as any, requireAdmin);
  const handlers = routes.get('/api/admin/visitor-metrics/details')!;
  assert.equal(handlers.length, 2); assert.equal(handlers[0], requireAdmin);
  for (const [session, expectedStatus, shouldContinue] of [
    [undefined, 401, false], [{ userId: 'ordinary-user' }, 401, false],
    [{ adminAuth: { role: 'editor' } }, 403, false], [{ adminAuth: { role: 'admin' } }, 200, true],
  ] as const) {
    let continued = false;
    const response = await invoke(async (_req: any, res: any) => {
      await handlers[0]({ session, method: 'GET', path: '/api/admin/visitor-metrics/details' }, res, () => { continued = true; });
    });
    assert.equal(response.statusCode, expectedStatus); assert.equal(continued, shouldContinue);
    assert.match(String(response.headers['Cache-Control']), /private/);
    assert.match(String(response.headers['Cache-Control']), /no-store/);
  }
});
test('failed refresh returns unavailable, not cached old figures or fake zeros, and can recover', async () => {
  let clock = 0, fail = false;
  const handler = createVisitorMetricsHandler(async () => { if (fail) throw new Error('private driver detail'); return fixture; }, () => clock);
  await invoke(handler); clock = 16_000; fail = true;
  const failed = await invoke(handler);
  assert.equal(failed.statusCode, 503); assert.deepEqual(failed.body, { error: 'Unique visitor metrics temporarily unavailable' });
  fail = false; assert.equal((await invoke(handler)).statusCode, 200);
});
test('new metrics are authenticated and legacy stats no longer read contaminated IP records', async () => {
  const route = await readFile(new URL('../src/routes/visitor-metrics-routes.ts', import.meta.url), 'utf8');
  assert.match(route, /app\.get\('\/api\/admin\/visitor-metrics', requireAdmin,/);
  const legacy = await readFile(new URL('../src/data/postgres-discovery-operations.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(legacy.slice(legacy.indexOf('export async function pgDashboardTotals')), /FROM visitor_sessions/);
  assert.match(legacy, /FROM qualified_visitor_presence/);
  const dashboard = await readFile(new URL('../src/routes/cache-dashboard-routes.ts', import.meta.url), 'utf8');
  assert.match(dashboard, /dashboard:stats:v2-qualified-visitors/);
});
