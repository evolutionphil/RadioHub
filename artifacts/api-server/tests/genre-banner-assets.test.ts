import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { serveStatic } from '../src/serve-static';

const publicDirectory = path.resolve(import.meta.dirname, '../../megaradio/public');
// Existing public API paths must survive the deployment, without rewriting DB content.
const banners = [
  'genre-dfd155a5-8ea0-47f6-8c09-d3ba856c4853.png', // Jazz
  'genre-4ace263b-6542-4e1c-816c-4e5e2f97ec6b.png', // Rock
  'genre-4bb1ec26-df03-4398-a3c5-a7ecf8f3b63d.png', // Folk
];
let server: Server;
let baseUrl: string;

before(async () => {
  const app = express();
  app.use((_req, res, next) => {
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.set('Expires', new Date(Date.now() + 31536000 * 1000).toUTCString());
    next();
  });
  serveStatic(app, publicDirectory);
  server = await new Promise<Server>(resolve => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server?.closeAllConnections();
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

for (const filename of banners) {
  test(`bundled genre banner serves real image bytes at its original URL: ${filename}`, async () => {
    const pathname = `/uploads/genres/discoverable/${filename}`;
    const response = await fetch(baseUrl + pathname);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/png');
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.deepEqual(bytes.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    assert.deepEqual(bytes, await readFile(path.join(publicDirectory, pathname)));
  });
}

test('missing genre upload returns an uncached 404, not a successful HTML page', async () => {
  for (const method of ['GET', 'HEAD']) {
    const response = await fetch(`${baseUrl}/uploads/genres/discoverable/missing.png`, { method });
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('expires'), null);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.match(response.headers.get('content-type') || '', /text\/plain/);
    assert.equal(await response.text(), method === 'GET' ? 'Not found' : '');
  }
});
