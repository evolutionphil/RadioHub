import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, it, mock } from 'node:test';
import type { Server } from 'node:http';
import express from 'express';
import pg from 'pg';

const connectionString = process.env.PG_TEST_DATABASE_URL;
describe('Native admin account settings and revenue contracts', { skip: !connectionString }, () => {
  const schema = `account_settings_${process.pid}_${randomBytes(6).toString('hex')}`;
  const admin = new pg.Pool({ connectionString, ssl: false, max: 1 });
  let runtime: typeof import('../src/postgres-runtime'), pool: pg.Pool, server: Server, base: string, created = false;
  let tv: typeof import('../src/data/postgres-tv-store');
  let billing: typeof import('../src/data/postgres-billing-store');
  const originalEnv = { DATABASE_URL: process.env.DATABASE_URL, POSTGRES_SSL: process.env.POSTGRES_SSL, REDIS_URL: process.env.REDIS_URL };
  before(async () => {
    await admin.query(`CREATE SCHEMA "${schema}"`); created = true;
    const url = new URL(connectionString!); url.searchParams.set('options', `-c search_path=${schema},public`);
    process.env.DATABASE_URL = url.toString(); process.env.POSTGRES_SSL = 'disable'; process.env.REDIS_URL = '';
    runtime = await import('../src/postgres-runtime'); pool = runtime.getPostgresPool();
    const dir = path.resolve(import.meta.dirname, '../../../lib/db/migrations');
    for (const file of (await readdir(dir)).filter(file => /^\d+.*\.sql$/.test(file)).sort()) await pool.query(await readFile(path.join(dir, file), 'utf8'));
    tv = await import('../src/data/postgres-tv-store'); billing = await import('../src/data/postgres-billing-store');
    mock.module('../src/cache', { defaultExport: { del: async () => { throw new Error('test cache unavailable'); }, getOrSetSingleFlight: async (_key: string, loader: () => Promise<unknown>) => loader() } });
    const { registerStripePlanAdminRoutes } = await import('../src/routes/stripe-plan-admin-routes');
    const { registerTvVersionRoutes } = await import('../src/routes/tv-version-routes');
    const { registerSalesAnalyticsRoutes } = await import('../src/routes/sales-analytics-routes');
    const app = express(); app.use(express.json());
    const requireAdmin = (req: any, res: any, next: any) => req.headers['x-test-admin'] === 'yes' ? next() : res.status(401).json({ error: 'Admin required' });
    const deps = { requireAdmin };
    registerStripePlanAdminRoutes(app, deps); registerTvVersionRoutes(app, deps); registerSalesAnalyticsRoutes(app, deps);
    server = await new Promise<Server>(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = 'http://127.0.0.1:' + (server.address() as any).port;
  });
  after(async () => {
    if (server) await new Promise<void>(resolve => server.close(() => resolve()));
    if (runtime) await runtime.closePostgres();
    try { if (created) { assert.match(schema, /^account_settings_\d+_[a-f0-9]{12}$/); await admin.query(`DROP SCHEMA "${schema}" CASCADE`); } }
    finally { await admin.end(); mock.restoreAll(); for (const [key, value] of Object.entries(originalEnv)) if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  });
  const request = (route: string, method = 'GET', body?: unknown, authenticated = true) => fetch(base + route, { method,
    headers: { ...(authenticated ? { 'x-test-admin': 'yes' } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });

  it('rejects unauthorized reads/writes without saving a plan or version', async () => {
    for (const route of ['/api/admin/stripe-plans', '/api/admin/tv-version', '/api/admin/sales']) assert.equal((await request(route, 'GET', undefined, false)).status, 401);
    assert.equal((await request('/api/admin/stripe-plans/premium_monthly', 'PUT', { amount: 123 }, false)).status, 401);
    assert.equal((await request('/api/admin/tv-version', 'PUT', { latest: {} }, false)).status, 401);
    assert.equal(await tv.getTvVersion(), null);
  });
  it('rejects malformed plans and writes valid zero amounts without changing the other provider', async () => {
    const route = '/api/admin/stripe-plans/premium_monthly';
    for (const body of [{ amount: -3 }, { isActive: 'false' }, { currency: 'broken' }, { amount: 1.5 }, { paddlePriceId: '<invalid>' }]) assert.equal((await request(route, 'PUT', body)).status, 400);
    assert.equal((await request(route, 'PUT', { stripePriceId: 'price_fixture', label: 'Existing' })).status, 200);
    assert.equal((await request(route, 'PUT', { paddlePriceId: 'pri_fixture', amount: 0, currency: 'EUR', isActive: false })).status, 200);
    const plan = (await tv.listSubscriptionPlans()).find((p: any) => p.planId === 'premium_monthly');
    assert.equal(plan.stripePriceId, 'price_fixture'); assert.equal(plan.paddlePriceId, 'pri_fixture'); assert.equal(plan.amount, 0); assert.equal(plan.currency, 'eur'); assert.equal(plan.isActive, false);
  });
  it('preserves manifest locales, rejects unsafe values and truthfully returns committed saves during cache failure', async () => {
    const body = { latest: { ios: '5.4.3' }, minimum: {}, releaseNotes: { de: 'Deutsch', tr: 'Türkçe' }, storeUrl: { web: 'https://example.invalid/releases' } };
    assert.equal((await request('/api/admin/tv-version', 'PUT', body)).status, 200);
    assert.deepEqual((await tv.getTvVersion()).releaseNotes, body.releaseNotes);
    for (const invalid of [{ latest: [] }, { latest: {}, minimum: null }, { ...body, storeUrl: { web: 'javascript:bad()' } }]) assert.equal((await request('/api/admin/tv-version', 'PUT', invalid)).status, 400);
    assert.deepEqual((await tv.getTvVersion()).latest, { ios: '5.4.3' });
  });
  async function payment(provider: string, eventType: string, status: string, currency: string, amount: number, extra: any = {}) {
    const id = randomUUID();
    await pool.query(`INSERT INTO payment_events(id,provider,provider_event_id,event_type,status,plan,currency,amount_minor,occurred_at,payload,origin)
      VALUES($1,$2,$1,$3,$4,'premium_monthly',$5,$6,'2026-09-10T23:59:59.999Z',$7,$8)`, [id, provider, eventType, status, currency, amount, extra.payload || {}, extra.origin || 'runtime']);
  }
  it('separates currencies and excludes failed/refund/lifecycle deliveries while retaining migrated sales', async () => {
    await payment('stripe', 'checkout.session.completed', 'processed', 'EUR', 500, { payload: { data: { object: { payment_status: 'paid' } } } });
    await payment('paddle', 'transaction.completed', 'processed', 'usd', 900);
    await payment('stripe', 'premium_monthly', 'recorded', 'eur', 200, { origin: 'mongo_migration', payload: { stripeSessionId: 'cs_legacy' } });
    await payment('stripe', 'checkout.session.completed', 'failed', 'eur', 90000);
    await payment('stripe', 'checkout.session.completed', 'processed', 'eur', 90000, { payload: { data: { object: { payment_status: 'unpaid' } } } });
    await payment('paddle', 'adjustment.created', 'processed', 'usd', 90000);
    await payment('paddle', 'subscription.canceled', 'processed', 'usd', 90000);
    await payment('paddle', 'transaction.completed', 'stale', 'usd', 90000);
    const range = { from: new Date('2026-09-10T00:00:00Z'), to: new Date('2026-09-10T23:59:59.999Z'), platform: 'all', plan: 'all', groupBy: 'day' };
    const result = await billing.pgSalesAnalytics(range);
    assert.equal(result.sales.count, 3); assert.equal(result.sales.totalAmount, null); assert.equal(result.sales.currency, null);
    assert.deepEqual(result.sales.byCurrency, [{ currency: 'eur', count: 2, amount: 700 }, { currency: 'usd', count: 1, amount: 900 }]);
    assert.equal(result.sales.byPlan[0].total, null); assert.equal(result.sales.timeline[0].amount, null);
    assert.equal(result.recent.length, 3);
    const response = await request('/api/admin/sales?from=2026-09-10T00:00:00Z&to=2026-09-10T23:59:59.999Z');
    const report: any = await response.json(); assert.equal(response.status, 200);
    assert.equal(report.summary.stripeRevenue, null); assert.equal(report.summary.revenueByCurrency.length, 2); assert.equal(report.byPlan[0].stripeAmount, null); assert.equal(report.timeline[0].stripeAmount, null);
    assert.equal((await request('/api/admin/sales?from=invalid')).status, 400);
    assert.equal((await request('/api/admin/sales?from=2026-09-11&to=2026-09-10')).status, 400);
  });
});
