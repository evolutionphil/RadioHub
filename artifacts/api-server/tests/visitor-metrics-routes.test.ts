import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createVisitorMetricsHandler } from '../src/routes/visitor-metrics-routes';

const fixture = { activeVisitors: 0, todayVisitors: 2, weekVisitors: 3, computedAt: '2026-09-21T00:00:00.000Z',
  collectionStartedAt: '2026-09-20T23:30:00.000Z', activeWindowMinutes: 30, timezone: 'Europe/Berlin',
  identity: 'unique-ip' as const, source: 'qualified-http-requests' as const, retentionDays: 30 };
const invoke = async (handler: any) => {
  const response = { statusCode: 200, body: undefined as any, headers: {} as Record<string, unknown>,
    setHeader(k: string, v: string) { this.headers[k] = v; }, status(n: number) { this.statusCode = n; return this; },
    json(body: unknown) { this.body = body; } };
  await handler({}, response); return response;
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
