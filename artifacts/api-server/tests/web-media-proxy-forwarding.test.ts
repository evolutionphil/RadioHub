import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import type { Server } from 'node:http';
import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { forwardApiRequest } from '../src/middleware/forward-api-request';

let upstream: Server, web: Server, base: string;
const seen: Array<{ path: string; accept?: string; range?: string }> = [];
const image = Buffer.from('fixture image bytes');
const listen = (app: express.Express): Promise<Server> => new Promise(resolve => {
  const server = app.listen(0, '127.0.0.1', () => resolve(server));
});

before(async () => {
  const media = express();
  media.use((req, _res, next) => {
    seen.push({ path: req.originalUrl, accept: req.get('accept'), range: req.get('range') });
    next();
  });
  media.get('/api/image/missing', (_req, res) => {
    res.status(404).set('Cache-Control', 'public, max-age=300').json({ error: 'Image not found or inaccessible' });
  });
  media.get('/api/image/*path', (_req, res) => {
    res.set({ 'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=86400', Vary: 'Accept' }).send(image);
  });
  media.get('/api/stream/*path', (_req, res) => {
    res.status(206).set({ 'Content-Type': 'audio/mpeg', 'Content-Range': 'bytes 0-3/4' }).send('live');
  });
  media.use((_req, res) => { res.status(404).json({ error: 'Not found', service: 'stream-proxy' }); });
  upstream = await listen(media);

  const app = express();
  const proxy = createProxyMiddleware({ target: `http://127.0.0.1:${(upstream.address() as any).port}`, changeOrigin: true });
  app.use('/api/image', forwardApiRequest(proxy));
  app.use('/api/stream', forwardApiRequest(proxy));
  web = await listen(app);
  base = `http://127.0.0.1:${(web.address() as any).port}`;
});

after(async () => {
  for (const server of [web, upstream]) {
    server?.closeAllConnections();
    if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('same-origin image proxy retains the complete encoded path, size query and image response', async () => {
  const encoded = Buffer.from('https://upload.wikimedia.org/example/logo.svg').toString('base64url');
  for (const suffix of ['', '?w=256', '?w=96&h=96&marker=%2F%26']) {
    const path = `/api/image/${encoded}${suffix}`;
    const response = await fetch(base + path, { headers: { Accept: 'image/avif,image/webp' } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/webp');
    assert.equal(response.headers.get('cache-control'), 'public, max-age=86400');
    assert.equal(response.headers.get('vary'), 'Accept');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), image);
    assert.deepEqual(seen.at(-1), { path, accept: 'image/avif,image/webp', range: undefined });
  }
});

test('real upstream image failures remain errors instead of a placeholder 200', async () => {
  const response = await fetch(base + '/api/image/missing?w=256');
  assert.equal(response.status, 404);
  assert.equal(response.headers.get('cache-control'), 'public, max-age=300');
  assert.deepEqual(await response.json(), { error: 'Image not found or inaccessible' });
});

test('same-origin audio forwarding preserves the stream prefix, query, Range and partial response', async () => {
  const path = '/api/stream/radio-id?source=https%3A%2F%2Fexample.com%2Fstream';
  const response = await fetch(base + path, { headers: { Range: 'bytes=0-3' } });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('content-type'), 'audio/mpeg; charset=utf-8');
  assert.equal(response.headers.get('content-range'), 'bytes 0-3/4');
  assert.equal(await response.text(), 'live');
  assert.equal(seen.at(-1)?.path, path);
  assert.equal(seen.at(-1)?.range, 'bytes=0-3');
});

test('production media mounts restore original URLs before the general API proxy', async () => {
  const source = await readFile(new URL('../src/index-web.ts', import.meta.url), 'utf8');
  const general = source.indexOf("app.use('/api', forwardApiRequest(apiProxy))");
  for (const mount of ['image', 'stream']) {
    const media = source.indexOf(`app.use('/api/${mount}', forwardApiRequest(streamServiceProxy))`);
    assert.ok(media >= 0 && media < general, `The ${mount} mount must preserve its original prefix`);
  }
});
