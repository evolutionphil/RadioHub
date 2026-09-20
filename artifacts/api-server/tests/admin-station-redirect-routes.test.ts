import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import express from 'express';
import type { Server } from 'node:http';
import { registerAdminStationRedirectRoutes } from '../src/routes/admin-station-redirect-routes';
import { assessDuplicateRedirect } from '../src/utils/station-duplicate-policy';

const id = '68a8c468bd66579311aaee28';
let server: Server, base: string, calls: any[], errorCode: string | null, cacheFailure: boolean;
before(async () => {
  const app = express();
  registerAdminStationRedirectRoutes(app, (req, res, next) => req.get('x-admin') === 'yes' ? next() : void res.status(401).end(), {
    update: async input => {
      calls.push(input);
      if (errorCode) throw Object.assign(new Error('Private internal database details'), { code: errorCode });
      return { stationId: id, slug: 'classical-kdfc-1', redirectToSlug: input.targetSlug, changed: true, cacheKeys: ['private-cache-key'] };
    },
    invalidate: async () => { if (cacheFailure) throw new Error('Fixture cache unavailable'); return true; },
  });
  server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  base = `http://127.0.0.1:${(server.address() as any).port}/api/admin/stations/${id}/redirect`;
});
beforeEach(() => { calls = []; errorCode = null; cacheFailure = false; });
after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
const request = (body: any, admin = true, suffix = '') => fetch(base + suffix, {
  method: 'PUT', headers: { 'content-type': 'application/json', ...(admin ? { 'x-admin': 'yes' } : {}) }, body: JSON.stringify(body),
});
const change = { targetSlug: 'classical-kdfc', expectedRedirectToSlug: null };

test('authentication and strict redirect-only body validation happen before any mutation', async () => {
  assert.equal((await request(change, false)).status, 401);
  for (const body of [null, [], {}, { targetSlug: 'classical-kdfc' }, { ...change, noIndex: false },
    { ...change, targetSlug: 'https://example.invalid/station' }, { ...change, targetSlug: '' },
    { ...change, targetSlug: 4 }, { ...change, expectedRedirectToSlug: false }]) {
    assert.equal((await request(body)).status, 400);
  }
  assert.equal((await request(change, true, '?confirm=true')).status, 400);
  assert.equal(calls.length, 0);
});

test('one explicit source and canonical target are passed through and clearing is supported', async () => {
  const response = await request(change);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  const result = await response.json();
  assert.equal(result.redirectToSlug, 'classical-kdfc');
  assert.equal(result.stationId, id);
  assert.equal(Object.hasOwn(result, 'cacheKeys'), false);
  assert.deepEqual(calls, [{ id, ...change }]);
  assert.equal((await request({ targetSlug: null, expectedRedirectToSlug: 'classical-kdfc' })).status, 200);
  assert.deepEqual(calls[1], { id, targetSlug: null, expectedRedirectToSlug: 'classical-kdfc' });
});

test('known validation/conflict errors remain explicit and internal errors are not disclosed', async () => {
  for (const [code, status] of [['REDIRECT_SOURCE_MISSING', 404], ['REDIRECT_STALE', 409],
    ['REDIRECT_TARGET_INVALID', 422], ['REDIRECT_TARGET_CONTENT', 422], ['REDIRECT_NOT_DUPLICATE', 422], ['REDIRECT_CHAIN', 409], ['REDIRECT_BUSY', 409], ['08006', 503]] as const) {
    errorCode = code;
    const response = await request(change);
    assert.equal(response.status, status);
    assert.doesNotMatch(await response.text(), /Private internal/);
  }
});

test('a committed redirect remains successful if cache refresh fails', async () => {
  cacheFailure = true;
  const response = await request(change);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.success, true);
  assert.equal(result.cacheInvalidated, false);
  assert.match(result.warning, /saved/);
});

test('identity proof requires normalized equal names and full primary HTTP endpoints', () => {
  const source = { name: ' Classical  KDFC ', url: 'https://STREAM.example.invalid:443/Live?q=1#ignored', countryCode: 'UM' };
  const target = { name: 'classical kdfc', url: 'https://stream.example.invalid/Live?q=1', countryCode: 'US' };
  assert.equal(assessDuplicateRedirect(source, target).eligible, true);
  for (const patch of [
    { name: 'Other broadcaster' }, { url: 'https://stream.example.invalid/live?q=1' },
    { url: 'http://stream.example.invalid/Live?q=1' }, { url: 'https://stream.example.invalid/Live?q=2' },
    { url: 'https://user:password@stream.example.invalid/Live?q=1' }, { url: '' },
    { url: 'https://other.example.invalid/', urlResolved: source.url },
  ]) assert.equal(assessDuplicateRedirect(source, { ...target, ...patch }).eligible, false);
});
