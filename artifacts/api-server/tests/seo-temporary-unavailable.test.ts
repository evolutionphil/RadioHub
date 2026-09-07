import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import path from 'node:path';
import { test } from 'node:test';
import express from 'express';
import { markSeoTemporarilyUnavailable } from '../src/seo/temporary-unavailable';

test('temporary SSR failures preserve a usable SPA file with 503/no-store/Retry-After, including HEAD', async () => {
  const app = express();
  app.use((_req, res, next) => {
    res.setHeader('X-Robots-Tag', 'noindex, follow');
    markSeoTemporarilyUnavailable(res);
    next();
  });
  // Match serveStatic's express.static + sendFile chain against the real SPA
  // template. No production listener, credentials, external requests or writes.
  const webRoot = path.resolve(import.meta.dirname, '../../megaradio');
  app.use(express.static(webRoot));
  app.use((_req, res) => res.sendFile(path.join(webRoot, 'index.html')));
  const server = await new Promise<Server>((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  try {
    const url = `http://127.0.0.1:${(server.address() as any).port}/en/station/temporary-test`;
    for (const method of ['GET', 'HEAD']) {
      const response = await fetch(url, { method });
      assert.equal(response.status, 503);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('retry-after'), '60');
      assert.equal(response.headers.get('x-robots-tag'), null);
      assert.match(response.headers.get('content-type') || '', /text\/html/);
      const html = await response.text();
      if (method === 'HEAD') assert.equal(html, '');
      else {
        assert.match(html, /id="root"/);
        assert.match(html, /src="\/src\/main\.tsx"/);
      }
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('web SSR uses temporary failure handling before permanent quality decisions and keeps permanent gates', async () => {
  const source = await readFile(new URL('../src/index-web.ts', import.meta.url), 'utf8');
  assert.equal(source.match(/markSeoTemporarilyUnavailable\(res\)/g)?.length, 3,
    'request timeout, renderer rejection/error and database placeholder must all use the retryable response');
  assert.ok(source.indexOf('if (seoData.pageData?.stationDbError)') < source.indexOf('const stationNotFound = !!seoData.pageData?.notFound;'));
  assert.match(source, /if \(stationIsJunk\) \{[\s\S]*?sendJunkGone\(res\)/);
  assert.match(source, /if \(stationNotFound\) \{[\s\S]*?sendJunkGone\(res\)/);
  assert.match(source, /if \(forceNoIndex\) \{[\s\S]*?res\.setHeader\('X-Robots-Tag', 'noindex, follow'\)/);
  assert.equal(source.match(/if \(res\.statusCode === 503\) return next\(\)/g)?.length, 2,
    'post-SSR alias and 404 middleware must not replace the temporary status');
});
