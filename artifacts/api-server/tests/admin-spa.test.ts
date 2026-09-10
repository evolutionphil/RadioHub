import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { get as httpGet } from 'node:http';
import type { AddressInfo } from 'node:net';
import vm from 'node:vm';
import express from 'express';
import { buildAdminShell, createAdminSpaHandler, registerAdminAssets } from '../src/admin-spa';

let directory: string;
let server: Server;
let base: string;
let publicHtml: string;

before(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'radiohub-admin-assets-'));
  publicHtml = await readFile(new URL('../../megaradio/index.html', import.meta.url), 'utf8');
  for (const name of ['fonts', 'assets', '~partytown', '.vite']) await mkdir(path.join(directory, name));
  await writeFile(path.join(directory, 'index.html'), publicHtml);
  for (const weight of [400, 500, 700]) await writeFile(path.join(directory, 'fonts', `ubuntu-${weight}.woff2`), 'wOF2-font-fixture');
  await writeFile(path.join(directory, 'assets', 'entry-AbCd1234.js'), 'export const current = true;');
  await writeFile(path.join(directory, 'assets', 'entry-AbCd1234.css'), 'body { color: white; }');
  await writeFile(path.join(directory, '~partytown', 'partytown.js'), '/* local worker runtime fixture */');
  await writeFile(path.join(directory, 'manifest.json'), JSON.stringify({ name: 'Mega Radio', icons: [{ src: '/favicon.png' }] }));
  await writeFile(path.join(directory, 'favicon.png'), 'PNG-fixture');
  await writeFile(path.join(directory, '.vite', 'manifest.json'), '{"privateBuildDetails":true}');
  await writeFile(path.join(directory, 'package.json'), '{"privatePackageDetails":true}');
  const app = express();
  registerAdminAssets(app, directory);
  const shell = createAdminSpaHandler(directory);
  app.get('/admin-login', shell);
  app.get('/admin', shell);
  app.get('/admin/*path', shell);
  app.get('/missing-shell', createAdminSpaHandler(path.join(directory, 'missing-build')));
  app.get('/api/example', (_req, res) => res.json({ unchanged: true }));
  app.use((_req, res) => res.status(404).type('text/plain').send('Unmatched route'));
  server = await new Promise<Server>(resolve => {
    const running = app.listen(0, '127.0.0.1', () => resolve(running));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
  if (directory) {
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.match(path.basename(resolved), /^radiohub-admin-assets-[a-z0-9]+$/i);
    await rm(resolved, { recursive: true, force: true });
  }
});

for (const weight of [400, 500, 700]) {
  test(`API-host admin font ubuntu-${weight} is served at its absolute URL`, async () => {
    const response = await fetch(`${base}/fonts/ubuntu-${weight}.woff2`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') || '', /^font\/woff2/);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(await response.text(), 'wOF2-font-fixture');
  });
}

test('PWA manifest has JSON MIME, never immutable caching, and accessible icon URLs', async () => {
  const response = await fetch(base + '/manifest.json');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /^application\/manifest\+json/);
  assert.match(response.headers.get('cache-control') || '', /no-store/);
  const manifest = await response.json();
  const icon = await fetch(base + manifest.icons[0].src);
  assert.equal(icon.status, 200);
  assert.match(icon.headers.get('content-type') || '', /^image\/png/);
});

test('existing Partytown runtime remains available with JavaScript MIME', async () => {
  const response = await fetch(base + '/~partytown/partytown.js');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /javascript/);
  assert.doesNotMatch(response.headers.get('cache-control') || '', /immutable/);
});

for (const extension of ['js', 'css']) {
  test(`hashed ${extension} keeps existing immutable caching and correct MIME`, async () => {
    const response = await fetch(`${base}/assets/entry-AbCd1234.${extension}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    assert.match(response.headers.get('content-type') || '', extension === 'js' ? /javascript/ : /text\/css/);
  });
}

for (const asset of ['/fonts/missing.woff2', '/assets/old.js?v=1', '/assets/old.css', '/~partytown/missing.js', '/images/missing.webp']) {
  test(`missing asset never returns or caches HTML: ${asset}`, async () => {
    const response = await fetch(base + asset);
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match(response.headers.get('content-type') || '', /^text\/plain/);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(await response.text(), 'Not found');
  });
}

for (const pathname of ['/admin', '/admin-login', '/admin/stations', '/admin/radio-browser']) {
  test(`private shell excludes public preloads and analytics: ${pathname}`, async () => {
    const response = await fetch(base + pathname);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
    const html = await response.text();
    const executableScripts = [...html.matchAll(/<script\b[^>]*>[\s\S]*?<\/script>/gi)].map(match => match[0]).join('\n');
    assert.doesNotMatch(executableScripts, /partytown|clarity\.ms/);
    assert.doesNotMatch(html, /<link[^>]+(?:hero-bg|header-logo)/);
    assert.match(html, /<link[^>]+ubuntu-400\.woff2/);
    assert.match(html, /<script type="module" src="\/src\/main\.tsx"/);
    assert.match(executableScripts, /cast_sender\.js/); // shared player remains functional
  });
}

test('public source retains its analytics and home preloads; only tagged nodes are removed', () => {
  assert.equal([...publicHtml.matchAll(/<link data-public-preload/g)].length, 3);
  assert.match(publicHtml, /<script data-public-runtime type="text\/partytown">/);
  assert.match(publicHtml, /s\.src = '\/~partytown\/partytown\.js'/);
  const ordinary = '<link rel="preload" href="/fonts/a.woff2"><script type="module" src="/assets/app.js"></script>';
  assert.equal(buildAdminShell(ordinary), ordinary);
  assert.equal(buildAdminShell(buildAdminShell(publicHtml)), buildAdminShell(publicHtml));
});

for (const pathname of ['/admin', '/admin-login', '/admin/stations', '/admin/stations/example']) {
  test(`untransformed development shell cannot bootstrap Partytown for ${pathname}`, () => {
    const inline = publicHtml.match(/<script data-public-runtime>([\s\S]*?)<\/script>/)?.[1];
    assert.ok(inline);
    const scripts: unknown[] = [];
    const window = { location: { hostname: 'api.themegaradio.com', pathname } };
    vm.runInNewContext(inline, {
      window,
      document: { createElement: () => ({}), head: { appendChild: (node: unknown) => scripts.push(node) } },
    });
    assert.equal(scripts.length, 0);
    assert.equal('partytown' in window, false);
  });
}

test('public production pages still bootstrap the same local Partytown runtime', () => {
  const inline = publicHtml.match(/<script data-public-runtime>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(inline);
  const scripts: Array<{ src?: string }> = [];
  vm.runInNewContext(inline, {
    window: { location: { hostname: 'themegaradio.com', pathname: '/de' } },
    document: { createElement: () => ({}), head: { appendChild: (node: { src?: string }) => scripts.push(node) } },
  });
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].src, '/~partytown/partytown.js');
});

for (const pathname of ['/index.html', '/package.json', '/.vite/manifest.json']) {
  test(`API asset mount does not expose an unrelated build file: ${pathname}`, async () => {
    const response = await fetch(base + pathname);
    assert.equal(response.status, 404);
    assert.equal(await response.text(), 'Unmatched route');
  });
}

for (const pathname of ['/assets/%2e%2e/index.html', '/fonts/..%2fpackage.json', '/assets/%5c..%5cpackage.json']) {
  test(`encoded traversal cannot escape the static allowlist: ${pathname}`, async () => {
    // Raw HTTP avoids fetch/URL normalizing dot-segments before reaching Express.
    const result = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      httpGet({ hostname: '127.0.0.1', port: (server.address() as AddressInfo).port, path: pathname }, response => {
        let body = ''; response.setEncoding('utf8'); response.on('data', chunk => { body += chunk; });
        response.on('end', () => resolve({ status: response.statusCode!, body }));
      }).on('error', reject);
    });
    assert.equal(result.status, 404); assert.equal(result.body, 'Not found');
  });
}

test('API routes are untouched and missing admin builds fail closed without caching', async () => {
  assert.deepEqual(await (await fetch(base + '/api/example')).json(), { unchanged: true });
  const response = await fetch(base + '/missing-shell');
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('retry-after'), '30');
  assert.equal(await response.text(), 'Admin shell unavailable');
});
