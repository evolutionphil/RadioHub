import assert from 'node:assert/strict';
import { after, before, describe, it, mock } from 'node:test';
import { readFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import express from 'express';
import { privateApiCachePolicy, setHealthCacheHeaders } from '../src/middleware/cache-policy';

mock.module('../src/data/auth-token-store', { namedExports: {
  createAuthToken: async () => 'unused-fixture-token',
  findActiveAuthToken: async (token: string) => token === 'fixture-bearer' ? { userId: 'active' } : null,
} });
mock.module('../src/data/postgres-user-store', { namedExports: {
  pgFindUserById: async (id: string) => {
    if (id === 'unavailable') throw new Error('Injected unavailable auth store');
    if (id === 'missing') return null;
    return { _id: id, status: id === 'inactive' ? 'suspended' : 'active' };
  },
} });
const { requireAuth, requireAdmin } = await import('../src/middleware/auth');
const { registerAdminAuthRoutes } = await import('../src/routes/admin-auth-routes');

describe('Private API and health cache policy', () => {
  let server: Server, base: string;
  const oldUsername = process.env.ADMIN_USERNAME, oldPassword = process.env.ADMIN_PASSWORD;
  before(async () => {
    process.env.ADMIN_USERNAME = 'cache-policy-fixture'; process.env.ADMIN_PASSWORD = 'fixture-only-password';
    const app = express();
    // This exact segment-scoped mount also protects parse errors and unknown
    // private routes before any authentication handler is selected.
    app.use(['/api/admin', '/api/auth'], privateApiCachePolicy);
    app.use(express.json());
    app.use((req: any, _res, next) => {
      req.session = { save: (done: (error?: Error) => void) => done() };
      if (req.headers['x-fixture-user']) req.session.userId = String(req.headers['x-fixture-user']);
      if (req.headers['x-fixture-role']) req.session.adminAuth = { username: 'fixture', role: String(req.headers['x-fixture-role']) };
      next();
    });
    app.get('/private/profile', requireAuth, (req: any, res) => res.json({ id: req.user._id }));
    app.get('/private/admin', requireAdmin, (_req, res) => res.json({ authorized: true }));
    registerAdminAuthRoutes(app, { requireAdmin });
    app.get('/api/auth/redirect-fixture', (_req, res) => res.redirect(302, '/login'));
    app.get('/api/admin/unavailable-fixture', (_req, res) => res.status(503).json({ error: 'Unavailable' }));
    app.get('/api/admin/limited-fixture', (_req, res) => res.status(429).json({ error: 'Limited' }));
    app.get('/healthz', (_req, res) => { setHealthCacheHeaders(res); res.type('text/plain').send('ok'); });
    app.get(['/readyz', '/health', '/api/health'], (req, res) => {
      setHealthCacheHeaders(res);
      res.status(req.query.ready === 'false' ? 503 : 200).json({ ready: req.query.ready !== 'false' });
    });
    app.get(['/api/stations/precomputed', '/api/translations/de', '/api/administrator', '/api/author'], (_req, res) => {
      res.setHeader('Cache-Control', 'public, max-age=300'); res.json({ public: true });
    });
    app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
    app.use((error: any, _req: any, res: any, _next: any) => res.status(error.status || 500).json({ error: 'Request failed' }));
    server = await new Promise<Server>(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
    base = `http://127.0.0.1:${(server.address() as any).port}`;
  });
  after(async () => {
    server?.closeAllConnections();
    if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    if (oldUsername === undefined) delete process.env.ADMIN_USERNAME; else process.env.ADMIN_USERNAME = oldUsername;
    if (oldPassword === undefined) delete process.env.ADMIN_PASSWORD; else process.env.ADMIN_PASSWORD = oldPassword;
    mock.restoreAll();
  });
  function privateHeaders(response: Response) {
    assert.equal(response.headers.get('cache-control'), 'private, no-store, max-age=0');
    assert.equal(response.headers.get('cdn-cache-control'), 'no-store');
    assert.equal(response.headers.get('cloudflare-cdn-cache-control'), 'no-store');
  }
  it('marks shared authenticated/admin guards private for success, rejection and storage errors', async () => {
    for (const [path, headers, status] of [
      ['/private/profile', {}, 401],
      ['/private/profile', { 'x-fixture-user': 'active' }, 200],
      ['/private/profile', { 'x-fixture-user': 'inactive' }, 403],
      ['/private/profile', { 'x-fixture-user': 'missing' }, 401],
      ['/private/profile', { 'x-fixture-user': 'unavailable' }, 503],
      ['/private/profile', { authorization: 'Bearer fixture-bearer' }, 200],
      ['/private/admin', {}, 401],
      ['/private/admin', { 'x-fixture-role': 'user' }, 403],
      ['/private/admin', { 'x-fixture-role': 'admin' }, 200],
    ] as const) {
      const response = await fetch(base + path, { headers }); assert.equal(response.status, status); privateHeaders(response);
    }
  });
  it('keeps private namespace redirects, unavailable/rate-limited replies, malformed bodies and unknown 404s uncached', async () => {
    for (const [path, status] of [['/api/admin/absent', 404], ['/api/auth/absent', 404], ['/api/admin/unavailable-fixture', 503], ['/api/admin/limited-fixture', 429], ['/api/auth/redirect-fixture', 302]] as const) {
      const response = await fetch(base + path, { redirect: 'manual' }); assert.equal(response.status, status); privateHeaders(response);
    }
    const response = await fetch(base + '/api/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' });
    assert.equal(response.status, 400); privateHeaders(response);
  });
  it('preserves the real environment-backed admin login response and rejection contract', async () => {
    for (const [body, status] of [[{}, 400], [{ username: 'wrong', password: 'wrong' }, 401], [{ username: 'cache-policy-fixture', password: 'fixture-only-password' }, 200]] as const) {
      const response = await fetch(base + '/api/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      assert.equal(response.status, status); privateHeaders(response);
      if (status === 200) assert.deepEqual((await response.json() as any).user, { username: 'cache-policy-fixture', role: 'admin' });
    }
  });
  it('makes health success and failure non-storable while keeping liveness plain text and HEAD empty', async () => {
    for (const path of ['/healthz', '/readyz', '/readyz?ready=false', '/health', '/health?ready=false', '/api/health', '/api/health?ready=false']) {
      const response = await fetch(base + path); assert.equal(response.status, path.includes('false') ? 503 : 200);
      assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0');
      assert.equal(response.headers.get('cdn-cache-control'), 'no-store'); assert.equal(response.headers.get('cloudflare-cdn-cache-control'), 'no-store');
      if (path === '/healthz') { assert.match(response.headers.get('content-type') || '', /^text\/plain/); assert.equal(await response.text(), 'ok'); }
      else assert.match(response.headers.get('content-type') || '', /^application\/json/);
    }
    const head = await fetch(base + '/healthz', { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal(await head.text(), '');
    assert.equal(head.headers.get('cache-control'), 'no-store, max-age=0');
  });
  it('does not capture public API paths or similarly named prefix segments', async () => {
    for (const path of ['/api/stations/precomputed', '/api/translations/de', '/api/administrator', '/api/author']) {
      const response = await fetch(base + path); assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'public, max-age=300');
      assert.equal(response.headers.get('cdn-cache-control'), null); assert.equal(response.headers.get('cloudflare-cdn-cache-control'), null);
    }
  });
});

it('wires both actual roles before private early failures and marks every implemented health handler', async () => {
  for (const name of ['index-web.ts', 'index-api.ts']) {
    const source = await readFile(new URL(`../src/${name}`, import.meta.url), 'utf8');
    const boundary = source.indexOf("app.use(['/api/admin', '/api/auth'], privateApiCachePolicy)");
    assert.ok(boundary > source.indexOf('app.use(geoBlockMiddleware)'));
    assert.ok(boundary < source.indexOf('app.use(express.json'));
    if (name === 'index-api.ts') {
      assert.ok(boundary < source.indexOf('app.use(databaseMaintenanceMiddleware)'));
      assert.ok(boundary < source.indexOf("app.use('/api', globalApiLimiter)"));
      assert.match(source, /app\.get\(\['\/healthz', '\/health', '\/api\/health'\],[\s\S]*?setHealthCacheHeaders\(res\);[\s\S]*?\.type\('text\/plain'\)\.send\('ok'\)/);
    } else {
      assert.match(source, /app\.get\('\/healthz',[\s\S]*?setHealthCacheHeaders\(res\);[\s\S]*?\.type\('text\/plain'\)\.send\('ok'\)/);
      assert.match(source, /app\.get\('\/health',[\s\S]*?setHealthCacheHeaders\(res\);/);
    }
    assert.match(source, /app\.get\('\/readyz',[\s\S]*?setHealthCacheHeaders\(res\);\s*const postgres = await getPostgresHealth\(\)/);
  }
});
