import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import express, { type Request, type RequestHandler, type Response } from 'express';
import { createUniqueVisitorTrackingMiddleware, normalizeVisitorIp } from '../src/middleware/unique-visitor-tracking';
import { logger } from '../src/utils/logger';
import type { VisitorContext } from '../src/middleware/visitor-client-context';

const browser = 'Mozilla/5.0 Chrome/128.0 Safari/537.36';
const settle = () => new Promise<void>(resolve => setImmediate(resolve));
type Overrides = {
  path?: string; method?: string; ip?: string; remote?: string; trusted?: boolean;
  headers?: Record<string, string | string[]>; session?: unknown; user?: unknown;
  status?: number; contentType?: string;
};
function request(middleware: RequestHandler, overrides: Overrides = {}) {
  const headers = { 'user-agent': browser, ...overrides.headers };
  const req = {
    method: overrides.method ?? 'GET', path: overrides.path ?? '/api/stations',
    ip: overrides.ip ?? '203.0.113.8', headers,
    socket: { remoteAddress: overrides.remote ?? '203.0.113.8' },
    app: { get: () => (overrides.trusted ? () => true : () => false) },
    get: (name: string) => headers[name.toLowerCase() as keyof typeof headers],
    session: overrides.session, user: overrides.user,
  } as unknown as Request;
  const res = Object.assign(new EventEmitter(), {
    statusCode: overrides.status ?? 200,
    getHeader: () => overrides.contentType ?? 'application/json; charset=utf-8',
  }) as unknown as Response;
  let nextCalls = 0;
  middleware(req, res, () => { nextCalls++; });
  assert.equal(nextCalls, 1, 'tracking must advance the request synchronously');
  return { req, res, finish: () => res.emit('finish') };
}

test('IP identity normalizes IPv4-mapped IPv6 and IPv6 notation without accepting arbitrary headers', () => {
  for (const input of ['203.0.113.8', ' ::ffff:203.0.113.8 ', '0:0:0:0:0:ffff:cb00:7108']) {
    assert.equal(normalizeVisitorIp(input), '203.0.113.8');
  }
  assert.equal(normalizeVisitorIp('2001:0DB8:0000:0000:0000:0000:0000:0001'), '2001:db8::1');
  for (const input of ['', 'unknown', '203.0.113.8, 198.51.100.3', '203.0.113.8:1234',
    '[2001:db8::1]', 'fe80::1%eth0', '999.1.1.1', null, ['203.0.113.8']]) {
    assert.equal(normalizeVisitorIp(input), null);
  }
});

test('only completed successful responses count; rejected, failed and aborted requests do not', async () => {
  const calls: string[] = [];
  const middleware = createUniqueVisitorTrackingMiddleware(async ip => { calls.push(ip); });
  const first = request(middleware);
  assert.deepEqual(calls, []);
  first.res.emit('close');
  await settle();
  assert.deepEqual(calls, []);
  for (const status of [101, 400, 401, 403, 404, 429, 500, 503]) request(middleware, { status }).finish();
  await settle();
  assert.deepEqual(calls, []);
  for (const [index, status] of [200, 201, 204, 301, 304, 399].entries()) {
    request(middleware, { status, ip: `203.0.113.${index + 1}` }).finish();
  }
  await settle();
  assert.equal(calls.length, 6);
});

test('same IP across tabs, user accounts and mapped address notation coalesces; distinct IPs remain distinct', async () => {
  const calls: string[] = [];
  const middleware = createUniqueVisitorTrackingMiddleware(async ip => { calls.push(ip); });
  for (const [index, ip] of ['203.0.113.8', '::ffff:203.0.113.8', '0:0:0:0:0:ffff:cb00:7108', '203.0.113.9'].entries()) {
    request(middleware, { ip, session: { userId: `user-${index}` } }).finish();
  }
  await settle();
  assert.deepEqual(calls, ['203.0.113.8', '203.0.113.9']);
});

test('admin routes, authenticated admins, admin referers and late route authentication do not count', async () => {
  const calls: string[] = [];
  const middleware = createUniqueVisitorTrackingMiddleware(async ip => { calls.push(ip); });
  for (const path of ['/admin', '/admin/stations', '/admin-login', '/api/admin', '/api/admin/login']) {
    request(middleware, { path }).finish();
  }
  for (const overrides of [
    { session: { adminAuth: { role: 'admin' } } }, { session: { adminUser: { role: 'admin' } } },
    { session: { user: { role: 'admin' } } }, { user: { role: 'admin' } },
    { headers: { referer: 'https://themegaradio.com/admin/overview?tab=users' } },
    { headers: { referer: 'https://api.themegaradio.com/admin-login' } },
  ]) request(middleware, overrides).finish();
  const late = request(middleware);
  late.req.user = { role: 'admin' } as Request['user'];
  late.finish();
  await settle();
  assert.deepEqual(calls, []);
  request(middleware, { path: '/administration', headers: { referer: 'https://themegaradio.com/stations/admin-fm' } }).finish();
  await settle();
  assert.deepEqual(calls, ['203.0.113.8']);
});

test('internal, asset, monitoring, bot and speculative requests are excluded without excluding native app UAs', async () => {
  const calls: string[] = [];
  const middleware = createUniqueVisitorTrackingMiddleware(async ip => { calls.push(ip); });
  for (const path of ['/healthz', '/ready', '/api/health', '/api/dashboard/stats', '/api/analytics/summary',
    '/api/auth/me', '/api/internal/tick', '/api/test/fixture', '/api/logs/remote', '/api/webhooks/paddle',
    '/api/sync/force', '/api/push/silent', '/api/iap/validate', '/api/tv/telemetry', '/api/tv/bundle',
    '/api/stream/station', '/api/image/encoded', '/api/image-proxy', '/api/og-image/station',
    '/assets/main.js', '/station-logos/logo', '/robots.txt', '/sitemap-en.xml', '/favicon.ico']) {
    request(middleware, { path }).finish();
  }
  for (const ua of ['', 'Googlebot/2.1', 'ChatGPT-User/1.0', 'ClaudeBot/1.0', 'Perplexity-User/1.0',
    'Google-InspectionTool/1.0', 'Google-Extended', 'Mediapartners-Google', 'curl/8.0', 'python-requests/2.0',
    'node', 'undici', 'UptimeRobot/2.0', 'Chrome-Lighthouse', 'HeadlessChrome/1.0']) {
    request(middleware, { headers: { 'user-agent': ua } }).finish();
  }
  for (const overrides of [
    { method: 'OPTIONS' }, { method: 'HEAD' }, { headers: { purpose: 'prefetch' } },
    { headers: { 'sec-purpose': 'prefetch;prerender' } }, { headers: { 'sec-fetch-dest': 'image' } },
    { contentType: 'audio/mpeg' }, { contentType: 'image/webp' }, { contentType: 'text/css' },
  ]) request(middleware, overrides).finish();
  await settle();
  assert.deepEqual(calls, []);
  for (const [index, ua] of [browser, 'okhttp/4.12', 'Dalvik/2.1.0', 'MegaRadio/2 CFNetwork/1492 Darwin/23'].entries()) {
    request(middleware, { ip: `203.0.113.${index + 1}`, path: '/api/tv/init', headers: { 'user-agent': ua } }).finish();
  }
  await settle();
  assert.equal(calls.length, 4);
});

test('address resolution trusts CF only through a configured private proxy, never raw leftmost XFF', async () => {
  const calls: string[] = [];
  const middleware = createUniqueVisitorTrackingMiddleware(async ip => { calls.push(ip); });
  request(middleware, { headers: { 'cf-connecting-ip': '198.51.100.1', 'x-forwarded-for': '198.51.100.2' }, trusted: true }).finish();
  request(middleware, { remote: '10.0.0.1', ip: '10.0.0.1', trusted: false, headers: { 'cf-connecting-ip': '198.51.100.3' } }).finish();
  request(middleware, { remote: '10.0.0.1', ip: '10.0.0.1', trusted: true, headers: { 'cf-connecting-ip': '::ffff:198.51.100.4' } }).finish();
  request(middleware, { remote: '10.0.0.1', ip: '198.51.100.5', trusted: true, headers: { 'cf-connecting-ip': 'invalid', 'x-forwarded-for': '198.51.100.6' } }).finish();
  request(middleware, { remote: '10.0.0.1', ip: '198.51.100.7', trusted: true, headers: { 'cf-connecting-ip': ['198.51.100.8', '198.51.100.9'] } }).finish();
  for (const ip of ['unknown', '127.0.0.1', '::ffff:127.0.0.1', '10.1.2.3', '192.168.1.1', '172.16.1.2',
    '169.254.1.1', '100.64.1.2', '::1', '::', 'fd00::1', 'fe80::1', 'ff02::1']) {
    request(middleware, { ip, remote: ip }).finish();
  }
  await settle();
  assert.deepEqual(calls, ['203.0.113.8', '198.51.100.4', '198.51.100.5', '198.51.100.7']);
});

test('metadata is attached only to admitted successful writes, and country requires the trusted edge path', async () => {
  const calls: Array<{ ip: string; context: VisitorContext }> = [];
  const middleware = createUniqueVisitorTrackingMiddleware(async (ip, context) => { calls.push({ ip, context }); });
  const headers = { 'cf-connecting-ip': '198.51.100.42', 'cf-ipcountry': 'DE', 'x-megaradio-platform': 'webos' };
  request(middleware, { status: 500, remote: '10.0.0.1', trusted: true, headers }).finish();
  request(middleware, { remote: '10.0.0.1', trusted: true, headers }).finish();
  request(middleware, { remote: '10.0.0.1', trusted: true, headers: { ...headers, 'x-megaradio-platform': 'ios' } }).finish();
  request(middleware, { ip: '203.0.113.9', trusted: true, headers }).finish(); // public direct origin
  request(middleware, { ip: '203.0.113.10', remote: '10.0.0.1', trusted: true, headers: { ...headers, 'cf-connecting-ip': 'invalid' } }).finish();
  request(middleware, { ip: '203.0.113.11', remote: '10.0.0.1', trusted: false, headers }).finish();
  await settle();
  assert.equal(calls.length, 4);
  assert.equal(calls[0].ip, '198.51.100.42');
  assert.equal(calls[0].context.countryCode, 'DE');
  assert.equal(calls[0].context.platform, 'webos');
  assert.equal(calls[0].context.deviceType, 'tv');
  assert.equal(calls[0].context.contextSource, 'client-header');
  for (const call of calls.slice(1)) assert.equal(call.context.countryCode, null);
  assert.ok(calls.every(call => !('userAgent' in call.context)));
});

test('a different client behind the same IP updates context next interval without creating another identity', async t => {
  let now = 1_000_000;
  t.mock.method(Date, 'now', () => now);
  const calls: Array<{ ip: string; context: VisitorContext }> = [];
  const middleware = createUniqueVisitorTrackingMiddleware(async (ip, context) => { calls.push({ ip, context }); });
  request(middleware, { headers: { 'x-megaradio-platform': 'web' } }).finish();
  await settle();
  now += 30_000;
  request(middleware, { headers: { 'x-megaradio-platform': 'ios' } }).finish();
  await settle();
  assert.equal(calls.length, 2);
  assert.equal(calls[0].ip, calls[1].ip);
  assert.equal(calls[0].context.platform, 'web');
  assert.equal(calls[1].context.platform, 'ios');
});

test('30-second throttle retries after expiry and coalesces outstanding writes beyond the TTL', async t => {
  let now = 1_000_000;
  t.mock.method(Date, 'now', () => now);
  let release: (() => void) | undefined;
  const calls: string[] = [];
  const middleware = createUniqueVisitorTrackingMiddleware(ip => {
    calls.push(ip);
    return new Promise<void>(resolve => { release = resolve; });
  });
  request(middleware).finish();
  await settle();
  now += 30_001;
  request(middleware).finish();
  await settle();
  assert.equal(calls.length, 1);
  release!();
  await settle();
  request(middleware).finish();
  await settle();
  assert.equal(calls.length, 2);
  release!();
  await settle();
});

test('a midnight request can update the new day despite a visit in the previous 30 seconds', async t => {
  let now = Date.parse('2026-09-21T21:59:59Z'); // 23:59:59 in Europe/Berlin
  t.mock.method(Date, 'now', () => now);
  let calls = 0;
  const middleware = createUniqueVisitorTrackingMiddleware(async () => { calls++; });
  request(middleware).finish();
  await settle();
  request(middleware).finish();
  await settle();
  assert.equal(calls, 1);
  now += 1000;
  request(middleware).finish();
  await settle();
  assert.equal(calls, 2);
});

test('write failures and synchronous throws never fail responses or create immediate retry storms', async t => {
  let now = 1_000_000;
  t.mock.method(Date, 'now', () => now);
  const warnings: unknown[][] = [];
  t.mock.method(logger, 'warn', (...args: unknown[]) => { warnings.push(args); });
  let calls = 0;
  const middleware = createUniqueVisitorTrackingMiddleware(() => {
    calls++;
    if (calls === 1) throw new Error('sensitive driver details');
    return Promise.reject(new Error('sensitive driver details'));
  });
  request(middleware).finish();
  await settle();
  request(middleware).finish();
  await settle();
  assert.equal(calls, 1);
  now += 30_000;
  request(middleware).finish();
  await settle();
  assert.equal(calls, 2);
  assert.deepEqual(warnings, [['Unique visitor measurement write failed; dashboard counts may be incomplete.']]);
  now += 30_000;
  request(middleware).finish();
  await settle();
  assert.equal(warnings.length, 2);
  assert.ok(!JSON.stringify(warnings).includes('sensitive'));
  assert.ok(!JSON.stringify(warnings).includes('203.0.113.8'));
});

test('admission stays bounded at 128 pending writes and recovers after they finish', async () => {
  const releases: Array<() => void> = [];
  let calls = 0;
  const middleware = createUniqueVisitorTrackingMiddleware(() => {
    calls++;
    return new Promise<void>(resolve => { releases.push(resolve); });
  });
  for (let i = 1; i <= 200; i++) request(middleware, { ip: `203.0.113.${i}` }).finish();
  await settle();
  assert.equal(calls, 128);
  releases.splice(0).forEach(release => release());
  await settle();
  request(middleware, { ip: '198.51.100.1' }).finish();
  await settle();
  assert.equal(calls, 129);
  releases.forEach(release => release());
  await settle();
});

test('recent identity storage admits at most 50,000 IPs per interval and expires old entries', async t => {
  let now = 1_000_000;
  t.mock.method(Date, 'now', () => now);
  let calls = 0;
  const middleware = createUniqueVisitorTrackingMiddleware(async () => { calls++; });
  for (let i = 0; i < 50_100; i++) {
    request(middleware, { ip: `203.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}` }).finish();
    if (i % 100 === 99) await settle();
  }
  await settle();
  assert.equal(calls, 50_000);
  now += 30_000;
  request(middleware, { ip: '198.51.100.1' }).finish();
  await settle();
  assert.equal(calls, 50_001);
});

test('real Express responses finish promptly while metric persistence is still pending', async () => {
  const app = express();
  app.set('trust proxy', 1);
  let release: (() => void) | undefined;
  const calls: string[] = [];
  app.use(createUniqueVisitorTrackingMiddleware(ip => {
    calls.push(ip);
    return new Promise<void>(resolve => { release = resolve; });
  }));
  app.get('/api/stations', (_req, res) => res.json({ stations: [] }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/stations`, {
      headers: { 'user-agent': browser, 'cf-connecting-ip': '203.0.113.8' }, signal: AbortSignal.timeout(3000),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { stations: [] });
    assert.deepEqual(calls, ['203.0.113.8']);
  } finally {
    release?.();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
