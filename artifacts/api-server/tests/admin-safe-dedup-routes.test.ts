import assert from 'node:assert/strict';
import { after, before, beforeEach, mock, test } from 'node:test';
import type { Server } from 'node:http';
import express from 'express';

type Doc = Record<string, any>;
let docs: Doc[], sqlCalls: string[], readFields: string[][], connections: number, released: number;
let editBeforeLock: (() => void) | undefined;
let failLockId: string | undefined, cacheFailure = false, cacheRefreshes = 0;
const project = (doc: Doc, fields: string[]) => Object.fromEntries(fields.map(field => [field, doc[field]]));
const client = {
  query: async (sql: string, values: any[] = []) => {
    sqlCalls.push(sql);
    if (sql.startsWith('SELECT')) {
      assert.match(sql, /ORDER BY id FOR UPDATE/);
      if (failLockId && values[0].includes(failLockId)) throw new Error('Injected later group failure');
      editBeforeLock?.(); editBeforeLock = undefined;
      return { rows: structuredClone(docs.filter(doc => values[0].includes(doc._id) || doc.slug === values[1])) };
    }
    if (sql.startsWith('UPDATE')) {
      const selected = docs.filter(doc => Array.isArray(values[0]) ? values[0].includes(doc._id) : doc._id === values[0]);
      if (sql.includes('SET slug_aliases=')) for (const doc of selected) doc.slugAliases = values[1];
      else if (sql.includes('SET redirect_to_slug=')) {
        assert.match(sql, /CASE WHEN no_index IS NOT TRUE THEN jsonb_build_object\('automaticNoIndex',\$3::jsonb\) ELSE '\{\}'::jsonb END/);
        for (const doc of selected) {
          if (doc.noIndex !== true) doc.automaticNoIndex = JSON.parse(values[2]);
          doc.redirectToSlug = values[1]; doc.noIndex = true;
        }
      } else {
        assert.match(sql, /SET no_index=true/);
        assert.match(sql, /'automaticNoIndex',\$2::jsonb/);
        for (const doc of selected) { doc.noIndex = true; doc.automaticNoIndex = JSON.parse(values[1]); }
      }
      return { rows: [], rowCount: selected.length };
    }
    assert.match(sql, /^(BEGIN|COMMIT|ROLLBACK|SET LOCAL)/);
    return { rows: [] };
  },
  release: () => { released++; },
};
mock.module(new URL('../src/postgres-runtime.ts', import.meta.url).href, { namedExports: {
  getPostgresPool: () => ({ connect: async () => { connections++; return client; } }),
} });
mock.module(new URL('../src/data/postgres-catalog-store.ts', import.meta.url).href, { namedExports: {
  catalogShape: (row: Doc) => row,
  pgCatalog: () => ({ find: async (query: any, options: any) => {
    readFields.push(options.fields);
    const selected = docs.filter(doc => query._id ? query._id.$in.includes(doc._id)
      : typeof query.slug === 'string' ? doc.slug === query.slug
      : query.slug.$regex ? /[0-9]-[0-9]/.test(doc.slug) : query.slug.$in.includes(doc.slug));
    return structuredClone(selected.slice(0, options.limit).map(doc => project(doc, options.fields)));
  } }),
} });
mock.module(new URL('../src/data/postgres-admin-catalog-store.ts', import.meta.url).href, { namedExports: {
  pgContentDuplicateGroups: async () => [{ _id: { name: 'Radio One', url: 'https://stream.example/live', countryCode: 'DE' },
    count: docs.length, docs: docs.map(doc => project(doc, ['_id', 'stationuuid', 'votes', 'clickCount', 'noIndex'])) }],
} });
mock.module(new URL('../src/performance-cache.ts', import.meta.url).href, { namedExports: { performanceCache: { clearSeoAndQuickCaches: () => { cacheRefreshes++; } } } });
mock.module(new URL('../src/cache.ts', import.meta.url).href, { defaultExport: { clearByPattern: async () => { cacheRefreshes++; if (cacheFailure) throw new Error('Injected cache outage'); } } });
mock.module(new URL('../src/utils/logger.ts', import.meta.url).href, { namedExports: { logger: { error: () => {} } } });
const { registerAdminSafeDedupRoutes } = await import('../src/routes/admin-safe-dedup-routes');
let server: Server, base: string;
before(async () => {
  const app = express();
  registerAdminSafeDedupRoutes(app, (req, res, next) => req.get('x-admin') === 'yes' ? next() : void res.sendStatus(401));
  server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  base = `http://127.0.0.1:${(server.address() as any).port}/api/admin/stations`;
});
after(async () => { server?.closeAllConnections(); if (server) await new Promise<void>(resolve => server.close(() => resolve())); });
beforeEach(() => {
  docs = ['a', 'b'].map((id, i) => ({ _id: id, stationuuid: `uuid-${id}`, name: 'Radio One', country: 'Germany', countryCode: 'DE',
    city: 'Berlin', state: 'Berlin', url: 'https://stream.example/live', urlResolved: '', homepage: 'https://radio.example',
    slug: i ? 'radio-959' : 'radio-95-9', slugAliases: i ? [] : ['older-radio'], votes: i ? 1 : 100, clickCount: 0,
    noIndex: false, redirectToSlug: '', lastCheckOk: true, manualEditFields: {}, descriptions: { en: { full: 'Existing text', meta: 'Existing meta' } },
    retainedUserReferences: [`favorite-${id}`, `history-${id}`] }));
  sqlCalls = []; readFields = []; connections = 0; released = 0; editBeforeLock = undefined;
  failLockId = undefined; cacheFailure = false; cacheRefreshes = 0;
});
const request = (route: string, confirm = false, admin = true) => fetch(`${base}/${route}${confirm ? '?confirm=true' : ''}`, {
  method: 'POST', headers: admin ? { 'x-admin': 'yes' } : {},
});
const mutations = () => sqlCalls.filter(sql => sql.startsWith('UPDATE'));

for (const route of ['dedup', 'dedup-frequency']) {
  test(`${route}: authenticated dry run hydrates policy fields and never opens a write transaction`, async () => {
    assert.equal((await request(route, true, false)).status, 401);
    assert.equal(readFields.length, 0);
    const before = structuredClone(docs);
    const response = await request(route);
    const body: any = await response.json();
    assert.equal(response.status, 200); assert.equal(body.confirm, false); assert.equal(body.clustersFound, 1);
    assert.equal(body[route === 'dedup' ? 'rowsMarked' : 'rowsRedirected'], 0);
    assert.equal(connections, 0); assert.deepEqual(docs, before);
    for (const fields of readFields.filter(fields => fields.includes('votes'))) for (const field of ['name', 'url', 'urlResolved', 'country', 'city', 'state', 'manualEditFields']) assert.ok(fields.includes(field));
    assert.equal(body.sampleClusters.length, 1);
  });

  test(`${route}: unrelated identities or endpoints never mutate despite matching candidate keys`, async () => {
    for (const patch of [{ name: 'Different broadcaster' }, { url: 'https://other.example/live' }, { city: 'Munich' }, { countryCode: 'FR' }]) {
      const previous = structuredClone(docs[1]); Object.assign(docs[1], patch);
      const body: any = await (await request(route, true)).json();
      assert.equal(body.clustersFound, 0); assert.equal(mutations().length, 0);
      docs[1] = previous;
    }
  });

  test(`${route}: every protected indexing, slug or visibility decision is respected`, async () => {
    for (const field of ['noIndex', 'slug', 'slugAliases', 'redirectToSlug', 'isListVisible', 'lastCheckOk']) {
      docs[1].manualEditFields = { [field]: true };
      const body: any = await (await request(route, true)).json();
      assert.equal(body.clustersFound, 0); assert.equal(mutations().length, 0);
      assert.match(body.sampleSkipped[0].reason, /Manually protected/);
    }
  });

  test(`${route}: eligible canonical beats an excluded high-engagement row`, async () => {
    docs[0].noIndex = true;
    const body: any = await (await request(route, true)).json();
    assert.equal(docs[1].noIndex, false);
    if (route === 'dedup-frequency') {
      assert.equal(body.rowsRedirected, 1); assert.equal(docs[0].redirectToSlug, docs[1].slug);
    } else { assert.equal(body.rowsMarked, 0); assert.equal(mutations().length, 0); }
  });

  test(`${route}: no eligible canonical or existing redirect cannot receive new exclusions`, async () => {
    docs[0].noIndex = true; docs[1].noIndex = true;
    let body: any = await (await request(route, true)).json();
    assert.equal(body.clustersFound, 0); assert.equal(mutations().length, 0);
    docs[0].noIndex = false; docs[1].noIndex = false; docs[0].redirectToSlug = 'third-station';
    body = await (await request(route, true)).json();
    assert.equal(body.clustersFound, 0); assert.equal(mutations().length, 0);
  });

  test(`${route}: ambiguous canonical slugs cannot create self redirects or hide their own destination`, async () => {
    docs.push({ ...structuredClone(docs[0]), _id: 'c', stationuuid: 'uuid-c' });
    const body: any = await (await request(route, true)).json();
    assert.equal(body.clustersFound, 0); assert.equal(mutations().length, 0);
    assert.match(body.sampleSkipped[0].reason, /Canonical slug is shared/);
  });

  test(`${route}: concurrent identity, protection, slug and canonical changes roll back before writes`, async () => {
    for (const edit of [() => { docs[1].url = 'https://different.example/live'; },
      () => { docs[1].manualEditFields.noIndex = true; }, () => { docs[1].slug = 'different-slug'; },
      () => { docs[0].noIndex = true; }, () => { docs.pop(); }]) {
      const previous = structuredClone(docs);
      editBeforeLock = edit;
      const body: any = await (await request(route, true)).json();
      assert.equal(body[route === 'dedup' ? 'rowsMarked' : 'rowsRedirected'], 0);
      assert.equal(mutations().length, 0); assert.ok(sqlCalls.includes('ROLLBACK'));
      assert.equal(released, connections);
      docs = previous;
    }
  });

  test(`${route}: verified apply retains every record and reference with an idempotent rerun`, async () => {
    const before = structuredClone(docs);
    const body: any = await (await request(route, true)).json();
    assert.equal(body[route === 'dedup' ? 'rowsMarked' : 'rowsRedirected'], 1);
    assert.equal(docs.length, 2); assert.equal(docs[0].noIndex, false); assert.equal(docs[1].noIndex, true);
    assert.deepEqual(docs[1].automaticNoIndex, {
      owner: 'radiohub-junk-policy', version: 1, active: true,
      reason: `duplicate-of:${docs[0].slug}`, markedAt: docs[1].automaticNoIndex.markedAt,
      decision: 'verified-admin-dedup', canonicalStationId: docs[0]._id,
    });
    assert.ok(Number.isFinite(Date.parse(docs[1].automaticNoIndex.markedAt)));
    assert.equal(docs[0].automaticNoIndex, undefined);
    for (let i = 0; i < docs.length; i++) {
      assert.deepEqual(docs[i].descriptions, before[i].descriptions);
      assert.deepEqual(docs[i].retainedUserReferences, before[i].retainedUserReferences);
    }
    if (route === 'dedup-frequency') {
      assert.equal(docs[1].redirectToSlug, docs[0].slug);
      assert.deepEqual(docs[0].slugAliases, ['older-radio', 'radio-959']);
    } else assert.equal(docs[1].redirectToSlug, '');
    assert.ok(sqlCalls.includes('COMMIT')); assert.equal(released, connections);
    const writeCount = mutations().length;
    const again: any = await (await request(route, true)).json();
    assert.equal(again[route === 'dedup' ? 'rowsMarked' : 'rowsRedirected'], 0);
    assert.equal(mutations().length, writeCount);
    assert.ok(!sqlCalls.some(sql => /DELETE|station_blacklist|station_merge_aliases/.test(sql)));
  });
}

test('later transaction failure still refreshes caches for previously committed redirects', async () => {
  docs.push(...['c', 'd'].map((id, i) => ({ ...structuredClone(docs[i]), _id: id, slug: i ? 'other-923' : 'other-92-3' })));
  failLockId = 'c';
  const response = await request('dedup-frequency', true);
  assert.equal(response.status, 500);
  assert.equal(docs[1].redirectToSlug, docs[0].slug);
  assert.equal(docs[2].redirectToSlug, ''); assert.equal(docs[3].redirectToSlug, '');
  assert.equal(cacheRefreshes, 3); assert.equal(released, connections);
});

test('cache outages do not turn committed safe redirects into a failed response', async () => {
  cacheFailure = true;
  const response = await request('dedup-frequency', true);
  assert.equal(response.status, 200);
  assert.equal((await response.json() as any).rowsRedirected, 1);
  assert.equal(docs[1].redirectToSlug, docs[0].slug);
  assert.equal(cacheRefreshes, 3);
});

test('frequency canonical owned by an unrelated station outside the country group is rejected globally', async () => {
  docs.push({ ...structuredClone(docs[0]), _id: 'other-owner', name: 'Different Radio', country: 'France', countryCode: 'FR', url: 'https://different.example/live' });
  const response = await request('dedup-frequency', true);
  const body: any = await response.json();
  assert.equal(body.clustersFound, 0); assert.equal(mutations().length, 0);
  assert.match(body.sampleSkipped[0].reason, /owned outside/);
});

test('new external canonical slug owner between discovery and lock prevents every write', async () => {
  editBeforeLock = () => docs.push({ ...structuredClone(docs[0]), _id: 'other-owner', name: 'Different Radio', country: 'France', countryCode: 'FR', url: 'https://different.example/live' });
  const body: any = await (await request('dedup-frequency', true)).json();
  assert.equal(body.rowsRedirected, 0); assert.equal(mutations().length, 0);
  assert.ok(sqlCalls.includes('ROLLBACK'));
});

test('frequency redirects preserve existing noindex provenance and never adopt unknown exclusions', async () => {
  for (const provenance of [undefined, { owner: 'legacy-policy', active: true, reason: 'original-reason', markedAt: '2025-01-01T00:00:00Z' },
    { owner: 'radiohub-junk-policy', version: 1, active: true, reason: 'original-rule', markedAt: '2026-01-01T00:00:00Z' }]) {
    docs[1].noIndex = true; docs[1].redirectToSlug = '';
    if (provenance === undefined) delete docs[1].automaticNoIndex;
    else docs[1].automaticNoIndex = structuredClone(provenance);
    const response = await request('dedup-frequency', true);
    assert.equal(response.status, 200);
    assert.equal((await response.json() as any).rowsRedirected, 1);
    assert.equal(docs[1].redirectToSlug, docs[0].slug);
    assert.deepEqual(docs[1].automaticNoIndex, provenance);
    if (provenance === undefined) assert.equal(Object.hasOwn(docs[1], 'automaticNoIndex'), false);
  }
});

test('content dedup leaves already excluded records and their unknown origin untouched', async () => {
  docs[1].noIndex = true;
  const before = structuredClone(docs[1]);
  const response = await request('dedup', true);
  assert.equal((await response.json() as any).rowsMarked, 0);
  assert.deepEqual(docs[1], before);
  assert.equal(mutations().length, 0);
});
