import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import sharp from 'sharp';
import { serveStatic } from '../src/serve-static';

const publicDirectory = path.resolve(import.meta.dirname, '../../megaradio/public');
const expectedImages = [
  ['favicon.png', 64, 64, 'png'],
  ['apple-touch-icon.png', 180, 180, 'png'],
  ['header-logo-80w.webp', 80, 74, 'webp'],
  ['logo-icon.webp', 322, 299, 'webp'],
  ['images/logo-icon.webp', 194, 180, 'webp'],
] as const;
let server: Server;
let baseUrl: string;

before(async () => {
  const app = express();
  // Model index-web's non-SEO classification before the static middleware.
  app.use((_req, res, next) => {
    res.set('X-Robots-Tag', 'noindex, follow');
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
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

for (const [filename, width, height, format] of expectedImages) {
  test(`existing brand image has correct MIME, dimensions and no inherited noindex: ${filename}`, async () => {
    const response = await fetch(`${baseUrl}/${filename}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), `image/${format}`);
    assert.equal(response.headers.get('x-robots-tag'), null);
    assert.equal(response.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.deepEqual(bytes, await readFile(path.join(publicDirectory, filename)), 'never rewrites brand pixels');
    const metadata = await sharp(bytes).metadata();
    assert.equal(metadata.width, width);
    assert.equal(metadata.height, height);
  });
}

test('conventional favicon URL redirects to the real PNG, including HEAD and old query strings', async () => {
  for (const method of ['GET', 'HEAD']) {
    const response = await fetch(`${baseUrl}/favicon.ico?v=old`, { method, redirect: 'manual' });
    assert.equal(response.status, 301);
    assert.equal(response.headers.get('location'), '/favicon.png');
    assert.equal(response.headers.get('x-robots-tag'), null);
    assert.equal(response.headers.get('cache-control'), 'public, max-age=86400');
    if (method === 'HEAD') assert.equal(await response.text(), '');
  }
  const followed = await fetch(`${baseUrl}/favicon.ico`);
  assert.equal(followed.status, 200);
  assert.equal(followed.headers.get('content-type'), 'image/png');
});

test('manifest and unrelated/missing static assets keep their existing robots policy', async () => {
  for (const pathname of ['/manifest.json', '/icons/google.svg', '/assets/missing-brand.png']) {
    const response = await fetch(baseUrl + pathname);
    assert.equal(response.status, pathname.startsWith('/assets/') ? 404 : 200);
    assert.equal(response.headers.get('x-robots-tag'), 'noindex, follow');
  }
});

test('both site HTML templates declare only the actual PNG dimensions', async () => {
  for (const filename of ['../../megaradio/index.html', '../src/index-web.ts']) {
    const source = await readFile(path.resolve(import.meta.dirname, filename), 'utf8');
    const icons = [...source.matchAll(/<link\b[^>]*rel="(icon|apple-touch-icon)"[^>]*>/g)];
    assert.equal(icons.length, 2);
    for (const [tag] of icons) {
      const src = tag.match(/href="([^"]+)"/)?.[1];
      assert.ok(src?.startsWith('/'));
      const metadata = await sharp(path.join(publicDirectory, src!)).metadata();
      assert.equal(tag.match(/sizes="([^"]+)"/)?.[1], `${metadata.width}x${metadata.height}`);
    }
    assert.match(source, /<link rel="manifest" href="\/manifest\.json">/);
  }
});

test('manifest app/shortcut icons all reference existing images with truthful sizes', async () => {
  const manifest = JSON.parse(await readFile(path.join(publicDirectory, 'manifest.json'), 'utf8'));
  for (const icon of [...manifest.icons, ...manifest.shortcuts.flatMap((shortcut: any) => shortcut.icons)]) {
    const metadata = await sharp(path.join(publicDirectory, icon.src)).metadata();
    assert.equal(icon.sizes, `${metadata.width}x${metadata.height}`);
    if (icon.type) assert.equal(icon.type, `image/${metadata.format}`);
  }
});

test('popular-stations shortcut opens the existing home section, not an invented genre route', async () => {
  const manifest = JSON.parse(await readFile(path.join(publicDirectory, 'manifest.json'), 'utf8'));
  const popular = manifest.shortcuts.find((shortcut: any) => shortcut.name === 'Popular Stations');
  assert.equal(popular?.url, '/');
});

test('push defaults use existing brand PNG while explicit icon/badge overrides are preserved', async () => {
  const workerSource = await readFile(path.join(publicDirectory, 'sw.js'), 'utf8');
  const handlers: Record<string, (event: any) => void> = {};
  const notifications: any[] = [];
  vm.runInNewContext(workerSource, {
    URL, console: { log() {}, error() {} },
    self: {
      addEventListener: (name: string, handler: any) => { handlers[name] = handler; },
      registration: { showNotification: async (title: string, options: any) => { notifications.push({ title, options }); } },
    },
  });
  for (const payload of [{}, { icon: '/custom-icon.png', badge: '/custom-badge.png' }]) {
    let done: Promise<unknown> | undefined;
    handlers.push({ data: { json: () => payload }, waitUntil: (promise: Promise<unknown>) => { done = promise; } });
    await done;
  }
  assert.equal(notifications[0].options.icon, '/favicon.png');
  assert.equal(notifications[0].options.badge, '/favicon.png');
  assert.equal(notifications[1].options.icon, '/custom-icon.png');
  assert.equal(notifications[1].options.badge, '/custom-badge.png');
  const service = await readFile(path.resolve(import.meta.dirname, '../src/services/pushNotificationService.ts'), 'utf8');
  assert.doesNotMatch(service, /['"]\/favicon\.ico['"]/);
  assert.match(service, /icon: payload\.icon \|\| '\/favicon\.png'/);
  assert.match(service, /icon: stationData\.favicon \|\| '\/favicon\.png'/);
});
