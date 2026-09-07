import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { HTML_CACHE_CONTROL, serveStatic } from '../src/serve-static';
import { markSeoTemporarilyUnavailable } from '../src/seo/temporary-unavailable';

let fixtureDirectory: string;
let server: Server;
let baseUrl: string;
const immutable = 'public, max-age=31536000, immutable';

before(async () => {
  fixtureDirectory = await mkdtemp(path.join(os.tmpdir(), 'radiohub-static-cache-'));
  await mkdir(path.join(fixtureDirectory, 'assets'));
  await writeFile(path.join(fixtureDirectory, 'index.html'), '<!doctype html><html><body><main>Current application shell</main></body></html>');
  await writeFile(path.join(fixtureDirectory, 'assets', 'current-AbCd1234.js'), 'console.log("current build");');
  await writeFile(path.join(fixtureDirectory, 'assets', 'current-AbCd1234.css'), 'body { color: white; }');
  const app = express();
  app.use((req, res, next) => {
    if (req.path.startsWith('/assets/')) {
      // Production index-web applies this before static lookup. Missing
      // chunks must explicitly remove it; existing chunks must retain it.
      res.set('Cache-Control', immutable);
      res.set('Expires', new Date(Date.now() + 31536000 * 1000).toUTCString());
    }
    if (req.path === '/temporary-failure') markSeoTemporarilyUnavailable(res);
    if (req.path === '/private-shell') res.set('Cache-Control', 'no-store');
    next();
  });
  serveStatic(app, fixtureDirectory);
  server = await new Promise<Server>(resolve => {
    const value = app.listen(0, '127.0.0.1', () => resolve(value));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
  if (fixtureDirectory) {
    const resolved = path.resolve(fixtureDirectory);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.match(path.basename(resolved), /^radiohub-static-cache-[a-z0-9]+$/i);
    await rm(resolved, { recursive: true, force: true });
  }
});

for (const pathname of ['/', '/index.html', '/en', '/tr/istasyon/example', '/admin/dashboard']) {
  test(`successful HTML requires browser/CDN revalidation: ${pathname}`, async () => {
    const response = await fetch(baseUrl + pathname);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') || '', /text\/html/);
    assert.equal(response.headers.get('cache-control'), HTML_CACHE_CONTROL);
    assert.ok(response.headers.get('etag'), 'retains conditional validation support');
  });
}

test('HTML conditional requests can reuse the current representation via 304', async () => {
  const first = await fetch(baseUrl + '/en');
  const etag = first.headers.get('etag');
  assert.ok(etag);
  await first.text();
  // Node fetch otherwise adds Cache-Control:no-cache to explicit conditional
  // requests, which deliberately forces Express to return a full response.
  const second = await fetch(baseUrl + '/en', { headers: { 'If-None-Match': etag, 'Cache-Control': 'max-age=0' } });
  assert.equal(second.status, 304);
  assert.equal(second.headers.get('cache-control'), HTML_CACHE_CONTROL);
});

for (const asset of ['current-AbCd1234.js', 'current-AbCd1234.css']) {
  test(`existing hashed asset keeps its immutable policy: ${asset}`, async () => {
    const response = await fetch(baseUrl + '/assets/' + asset);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), immutable);
    assert.doesNotMatch(response.headers.get('content-type') || '', /text\/html/);
  });
}

for (const asset of ['removed-OldHash.js', 'removed-OldHash.css', 'removed-OldHash.js?v=old']) {
  test(`missing build asset returns uncached 404, never the SPA: ${asset}`, async () => {
    const response = await fetch(baseUrl + '/assets/' + asset);
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('expires'), null);
    assert.match(response.headers.get('content-type') || '', /text\/plain/);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(await response.text(), 'Not found');
  });
}

test('HEAD on a missing chunk returns the same uncached 404 without a body', async () => {
  const response = await fetch(baseUrl + '/assets/removed-OldHash.js', { method: 'HEAD' });
  assert.equal(response.status, 404);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(await response.text(), '');
});

test('temporary failure status and strict no-store policies survive SPA fallback', async () => {
  const failure = await fetch(baseUrl + '/temporary-failure');
  assert.equal(failure.status, 503);
  assert.equal(failure.headers.get('cache-control'), 'no-store');
  assert.equal(failure.headers.get('retry-after'), '60');
  const privateShell = await fetch(baseUrl + '/private-shell');
  assert.equal(privateShell.status, 200);
  assert.equal(privateShell.headers.get('cache-control'), 'no-store');
});

test('both production SSR response branches use the same HTML policy', async () => {
  const source = await readFile(path.resolve(import.meta.dirname, '../src/index-web.ts'), 'utf8');
  assert.match(source, /'Cache-Control': HTML_CACHE_CONTROL,[\s\S]*?'X-SEO-Cache': 'HIT'/);
  assert.match(source, /'Cache-Control': \(stationNotFound \|\| stationDbError\)[\s\S]*?\? 'no-store'[\s\S]*?: HTML_CACHE_CONTROL,[\s\S]*?'X-SEO-Cache': 'MISS'/);
  assert.doesNotMatch(source, /s-maxage=86400, stale-while-revalidate=3600/);
});
