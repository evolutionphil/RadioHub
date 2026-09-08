import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import express, { type RequestHandler } from 'express';
import type { Server } from 'node:http';
import { forwardApiRequest } from '../src/middleware/forward-api-request';

let server: Server, base: string;
let localAdminHits = 0;
before(async () => {
  const app = express(); app.use(express.json());
  const fakeProxy: RequestHandler = (req, res) => {
    if (req.url.startsWith('/api/admin') && req.get('cookie') !== 'adminSession=valid') {
      res.status(401).json({ delegated: true, error: 'API authentication required' }); return;
    }
    res.json({ delegated: true, path: req.url, originalUrl: req.originalUrl, method: req.method,
      cookie: req.get('cookie'), authorization: req.get('authorization'), contentType: req.get('content-type'), body: req.body });
  };
  app.use('/api/admin', forwardApiRequest(fakeProxy));
  // Mirror the registrar's competing admin stub and public local endpoints.
  app.post('/api/admin/sitemap/rebuild', (_req, res) => { localAdminHits++; res.status(403).end(); });
  app.get('/api/seo/page-data', (_req, res) => { res.json({ localSeo: true }); });
  app.get('/sitemap.xml', (_req, res) => { res.type('xml').send('<sitemapindex/>'); });
  app.use('/api', forwardApiRequest(fakeProxy));
  server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  base = 'http://127.0.0.1:' + (server.address() as any).port;
});
after(async () => { server?.closeAllConnections(); if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });

test('admin sitemap rebuild reaches API with full path/query/body/cookie/authorization, not local403', async () => {
  const path = '/api/admin/sitemap/rebuild?lang=de&marker=%2F%26';
  const response = await fetch(base + path, { method: 'POST', headers: {
    'Content-Type': 'application/json', Cookie: 'adminSession=valid', Authorization: 'Bearer test-admin',
  }, body: JSON.stringify({ requested: 'stations' }) });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { delegated: true, path, originalUrl: path, method: 'POST', cookie: 'adminSession=valid',
    authorization: 'Bearer test-admin', contentType: 'application/json', body: { requested: 'stations' } });
  assert.equal(localAdminHits, 0);
});
test('unauthenticated admin request is rejected by destination API, not bypassed', async () => {
  const response = await fetch(base + '/api/admin/sitemap/rebuild', { method: 'POST' });
  assert.equal(response.status, 401); assert.equal((await response.json()).delegated, true); assert.equal(localAdminHits, 0);
});
test('public local SEO page-data and sitemap XML are not forwarded', async () => {
  const pageData = await fetch(base + '/api/seo/page-data?url=%2Fde');
  assert.deepEqual(await pageData.json(), { localSeo: true });
  assert.equal(await (await fetch(base + '/sitemap.xml')).text(), '<sitemapindex/>');
});
test('general API and bare admin mount keep exact original prefixes/query without duplicate or extra slash', async () => {
  for (const path of ['/api/station/nrj-oriental?test=%23', '/api/admin?test=%2F', '/api/admin/stations/abc/recover-stream-health']) {
    const response = await fetch(base + path, { headers: { Cookie: 'adminSession=valid' } });
    assert.equal(response.status, 200); assert.equal((await response.json()).path, path);
  }
});
test('production registration order delegates only admin before local SEO, then general API afterward', async () => {
  const source = await readFile(new URL('../src/index-web.ts', import.meta.url), 'utf8');
  const admin = source.indexOf("app.use('/api/admin', forwardApiRequest(apiProxy))");
  const local = source.indexOf('await registerSeoSitemapRoutes(app, seoSitemapDeps)');
  const general = source.indexOf("app.use('/api', forwardApiRequest(apiProxy))");
  assert.ok(admin >= 0 && admin < local && local < general);
  assert.match(source, /Admin routes only available on API service/);
});
