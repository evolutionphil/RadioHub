import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import express from 'express';
import type { Server } from 'node:http';
import { registerAdminLegacyNoindexRecoveryRoutes } from '../src/routes/admin-legacy-noindex-recovery-routes';

let server: Server, base: string, previewCalls: number, applyCalls: number, failure: string | null;
const previewId = '00000000-0000-4000-8000-000000000001';
before(async () => {
  const app = express();
  registerAdminLegacyNoindexRecoveryRoutes(app, (req, res, next) => req.get('x-admin') === 'yes' ? next() : void res.status(401).end(), {
    pgPreviewLegacyNoindexRecovery: async () => {
      previewCalls++;
      if (failure) throw Object.assign(new Error('private database details'), { code: failure });
      return { previewId, candidates: [{ id: 'station-a' }], totalCandidates: 1 } as any;
    },
    pgApplyLegacyNoindexRecovery: async input => {
      applyCalls++;
      if (failure) throw Object.assign(new Error('private database details'), { code: failure });
      assert.equal(input.previewId, previewId); assert.deepEqual(input.stationIds, ['station-a']);
      return { restored: 1, restoredIds: ['station-a'], skipped: 0, skippedReasons: [], cacheInvalidated: true };
    },
  });
  server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  base = `http://127.0.0.1:${(server.address() as any).port}/api/admin/seo-noindex-recovery/`;
});
beforeEach(() => { previewCalls = 0; applyCalls = 0; failure = null; });
after(async () => { server?.closeAllConnections(); if (server) await new Promise<void>(resolve => server.close(() => resolve())); });
const request = (action: string, body: any = {}, admin = true) => fetch(base + action, { method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(admin ? { 'x-admin': 'yes' } : {}) }, body: JSON.stringify(body) });

test('admin authentication and strict explicit selection precede every scan or mutation', async () => {
  assert.equal((await request('preview', {}, false)).status, 401);
  assert.equal((await request('apply', { previewId, stationIds: ['station-a'] }, false)).status, 401);
  for (const [action, body] of [['preview', { automatic: true }], ['preview?country=DE', {}], ['apply', {}],
    ['apply', { previewId, stationIds: [] }], ['apply', { previewId, stationIds: ['station-a', 'station-a'] }],
    ['apply', { previewId, stationIds: ['station-a'], noIndex: false }],
    ['apply', { previewId, stationIds: Array.from({ length: 101 }, (_, i) => String(i)) }]]) {
    assert.equal((await request(action as string, body)).status, 400);
  }
  assert.equal(previewCalls, 0); assert.equal(applyCalls, 0);
});

test('preview is uncached and never applies; explicit selected IDs return restored IDs', async () => {
  const preview = await request('preview'); assert.equal(preview.status, 200);
  assert.equal(preview.headers.get('cache-control'), 'private, no-store');
  assert.equal((await preview.json()).totalCandidates, 1); assert.equal(applyCalls, 0);
  const applied = await request('apply', { previewId, stationIds: ['station-a'] });
  assert.equal(applied.status, 200); assert.equal((await applied.json()).restored, 1);
});

test('stale/busy preview conflicts and unexpected SQL failures are safe and never disclose private errors', async () => {
  for (const [code, status] of [['RECOVERY_STALE', 409], ['RECOVERY_BUSY', 409], ['RECOVERY_INVALID', 400], ['XX000', 503]] as const) {
    failure = code; const response = await request('apply', { previewId, stationIds: ['station-a'] });
    assert.equal(response.status, status); assert.doesNotMatch(await response.text(), /private database/);
  }
});
