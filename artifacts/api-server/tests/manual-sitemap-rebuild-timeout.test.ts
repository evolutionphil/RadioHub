import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import type { Server } from 'node:http';
import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { forwardApiRequest } from '../src/middleware/forward-api-request';
import { MANUAL_SITEMAP_REBUILD_TIMEOUT_MS, manualSitemapRebuildTimeout } from '../src/middleware/manual-sitemap-rebuild-timeout';

let api: Server, web: Server, base: string;
const deadlines: Array<{path: string; milliseconds: number}> = [];
const listen = (app: express.Express): Promise<Server> => new Promise(resolve => {
  const server = app.listen(0, '127.0.0.1', () => resolve(server));
});
before(async () => {
  const app = express();
  app.use((req, _res, next) => {
    // Same real socket API, with 100x shorter fixture delays. Capture production
    // values as well so changing the actual 55s policy cannot silently pass.
    const setTimeout = req.setTimeout.bind(req);
    req.setTimeout = ((milliseconds: number) => {
      deadlines.push({path: req.path, milliseconds});
      setTimeout(milliseconds / 100);
      return req;
    }) as typeof req.setTimeout;
    req.setTimeout(30_000); next();
  });
  const admin: express.RequestHandler = (req, res, next) => {
    if (req.get('x-fixture-admin') !== 'yes') return void res.status(401).end();
    next();
  };
  const delayed: express.RequestHandler = (_req, res) => {
    setTimeout(() => { if (!res.destroyed) res.json({ok: true}); }, 400);
  };
  app.post('/api/admin/sitemap/rebuild', admin, manualSitemapRebuildTimeout, delayed);
  app.post('/api/admin/ordinary', admin, delayed);
  app.get('/api/public', delayed);
  api = await listen(app);
  const proxyApp = express();
  proxyApp.use((req, _res, next) => { req.setTimeout(300); next(); });
  const proxy = createProxyMiddleware({target: `http://127.0.0.1:${(api.address() as any).port}`, timeout: 600, proxyTimeout: 600,
    on: {error: (_error, _req, res) => { if ('writeHead' in res && !res.headersSent) res.writeHead(502).end(); }},
  });
  proxyApp.use('/api', forwardApiRequest(proxy));
  web = await listen(proxyApp); base = `http://127.0.0.1:${(web.address() as any).port}`;
});
after(async () => {
  for (const server of [web, api]) {
    server?.closeAllConnections();
    if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('authenticated rebuild survives the ordinary 30s deadline through the existing 60s web proxy', async () => {
  assert.equal(MANUAL_SITEMAP_REBUILD_TIMEOUT_MS, 55_000);
  const response = await fetch(base+'/api/admin/sitemap/rebuild', {method: 'POST', headers: {'x-fixture-admin': 'yes'}});
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), {ok: true});
  assert.deepEqual(deadlines.filter(row => row.path === '/api/admin/sitemap/rebuild').map(row => row.milliseconds), [30_000, 55_000]);
});
test('unauthenticated rebuild never receives the extended deadline', async () => {
  const offset = deadlines.length;
  const response = await fetch(base+'/api/admin/sitemap/rebuild', {method: 'POST'});
  assert.equal(response.status, 401);
  assert.deepEqual(deadlines.slice(offset).map(row => row.milliseconds), [30_000]);
});
test('ordinary authenticated and public API routes still time out at 30s', async () => {
  const offset = deadlines.length;
  for (const [path, method] of [['/api/admin/ordinary', 'POST'], ['/api/public', 'GET']]) {
    const response = await fetch(base+path, {method, headers: {'x-fixture-admin': 'yes'}});
    assert.equal(response.status, 502);
  }
  assert.deepEqual(deadlines.slice(offset).map(row => row.milliseconds), [30_000, 30_000]);
});
test('production extends only the rebuild after authentication and preserves proxy/normal deadlines', async () => {
  const routes = await readFile(new URL('../src/routes/seo-sitemap-routes.ts', import.meta.url), 'utf8');
  assert.match(routes, /app\.post\("\/api\/admin\/sitemap\/rebuild", requireAdmin, manualSitemapRebuildTimeout,/);
  assert.equal((routes.match(/requireAdmin, manualSitemapRebuildTimeout/g) || []).length, 1);
  for (const entry of ['index-api.ts', 'index-web.ts']) {
    const source = await readFile(new URL('../src/'+entry, import.meta.url), 'utf8');
    assert.match(source, /req\.setTimeout\(30000,/);
    assert.match(source, /Date\.now\(\) - requestStartedAt/);
    assert.doesNotMatch(source, /Request timeout \(30s\)/);
    if (entry === 'index-web.ts') { assert.match(source, /timeout: 60000/); assert.match(source, /proxyTimeout: 60000/); }
  }
});
