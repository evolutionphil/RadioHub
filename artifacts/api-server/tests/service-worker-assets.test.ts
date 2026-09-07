import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

const source = readFileSync(new URL('../../megaradio/public/sw.js', import.meta.url), 'utf8');
function harness(options: { cached?: any; network?: any; keys?: string[] } = {}) {
  const handlers: Record<string, any> = {};
  const deleted: string[] = [], puts: any[] = [], pending: Promise<unknown>[] = [];
  let fetches = 0;
  const cache = {
    match: async () => options.cached,
    delete: async (request: any) => { deleted.push(request.url); return true; },
    put: async (request: any, value: any) => { puts.push({ request, value }); },
  };
  const context = vm.createContext({ URL, console: { log() {} },
    self: { location: { origin: 'https://themegaradio.com' }, clients: { claim: async () => {} },
      addEventListener: (name: string, fn: any) => { handlers[name] = fn; } },
    caches: { open: async () => cache, keys: async () => options.keys || [],
      delete: async (key: string) => { deleted.push(key); return true; } },
    fetch: async () => { fetches++; return options.network; },
  });
  vm.runInContext(source, context);
  return { deleted, puts, fetches: () => fetches,
    async request(path: string, method = 'GET') {
      let result: Promise<any> | undefined;
      handlers.fetch({ request: { method, url: 'https://themegaradio.com' + path },
        respondWith: (promise: Promise<any>) => { result = promise; },
        waitUntil: (promise: Promise<any>) => { pending.push(promise); } });
      const value = await result; await Promise.all(pending); return value;
    },
    async activate() { let done: Promise<any>; handlers.activate({ waitUntil: (p: Promise<any>) => { done = p; } }); await done!; },
  };
}
function response(type: string, status = 200, redirected = false) {
  return { status, type: 'basic', redirected, headers: new Headers({ 'Content-Type': type }), clone() { return this; } };
}

test('cached outage HTML is evicted from CSS URL and replaced by a real stylesheet', async () => {
  const valid = response('text/css; charset=utf-8');
  const h = harness({ cached: response('text/html'), network: valid });
  assert.equal(await h.request('/assets/index-Abc123.css'), valid);
  assert.equal(h.fetches(), 1); assert.equal(h.deleted.length, 1); assert.equal(h.puts.length, 1);
});
test('successful JSON/HTML, redirects and 503 responses never poison static cache', async () => {
  for (const invalid of [response('application/json'), response('text/html'), response('text/css', 503), response('text/css', 200, true)]) {
    const h = harness({ network: invalid });
    assert.equal(await h.request('/assets/index-Abc123.css'), invalid);
    assert.equal(h.puts.length, 0);
  }
});
test('valid CSS/JS/fonts/images are reused while navigations and API calls bypass caching', async () => {
  for (const [path, mime] of [['/assets/app-123.css','text/css'], ['/assets/app-123.js','application/javascript'], ['/fonts/ubuntu.woff2','font/woff2'], ['/assets/logo-123.webp','image/webp']]) {
    const cached = response(mime); const h = harness({ cached });
    assert.equal(await h.request(path), cached); assert.equal(h.fetches(), 0);
  }
  const h = harness();
  for (const path of ['/en', '/api/translations/de', '/sitemap-index.xml', '/station-images/logo.webp']) await h.request(path);
  await h.request('/assets/app-123.css', 'POST');
  assert.equal(h.fetches(), 0); assert.equal(h.puts.length, 0);
});
test('activation retires only obsolete app caches, preserving current and unrelated caches', async () => {
  const h = harness({ keys: ['megaradio-assets-v1', 'megaradio-assets-v2', 'megaradio-v2', 'partytown', 'another-app'] });
  await h.activate(); assert.deepEqual(h.deleted, ['megaradio-assets-v1']);
});
