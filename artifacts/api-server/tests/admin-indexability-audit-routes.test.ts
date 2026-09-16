import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import express from 'express';
import type { Server } from 'node:http';
import { registerAdminIndexabilityAuditRoutes } from '../src/routes/admin-indexability-audit-routes';
import { AUDIT_LANGUAGES, createStationAudit } from '../src/seo/station-indexability-audit';

let server: Server, base: string, calls: number, failure: string | null;
before(async () => {
  const app = express();
  registerAdminIndexabilityAuditRoutes(app, (req, res, next) => req.get('x-admin') === 'yes' ? next() : void res.status(401).end(), {
    getQualifiedLanguagesState: async () => ({ languages: AUDIT_LANGUAGES, hash: 'fixture' }) as any,
    pgAuditStationIndexability: async options => {
      calls++;
      if (failure) throw Object.assign(new Error('Internal secret database error'), { code: failure });
      const audit = createStationAudit(options.qualifiedLanguages, '2026-09-17T00:00:00Z');
      const station = { _id: 'example', slug: 'example-radio', name: '=Unsafe formula', url: 'present', noIndex: true };
      const decision = audit.consume(station);
      if (options.onStation) await options.onStation(station, decision);
      return audit.report;
    },
  });
  server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  base = `http://127.0.0.1:${(server.address() as any).port}/api/admin/seo-indexability-audit`;
});
beforeEach(() => { calls = 0; failure = null; });
after(async () => { server?.closeAllConnections(); if (server) await new Promise<void>(resolve => server.close(() => resolve())); });
const request = (suffix = '', admin = true) => fetch(base + suffix, { headers: admin ? { 'x-admin': 'yes' } : {} });

test('authentication and strict query validation occur before scanning any catalog row', async () => {
  assert.equal((await request('', false)).status, 401);
  for (const suffix of ['?country=DE', '?format=bad', '?format=json&format=csv']) assert.equal((await request(suffix)).status, 400);
  assert.equal(calls, 0);
});
test('explicit audit returns a complete uncached summary and full CSV export', async () => {
  const response = await request(); assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  const result = await response.json(); assert.equal(result.total, 1); assert.equal(result.languages.length, 14);
  const csv = await request('?format=csv'); assert.match(csv.headers.get('content-disposition')!, /attachment/);
  const text = await csv.text(); assert.ok(text.startsWith('station_id,')); assert.ok(text.includes('"\'=Unsafe formula"'));
  assert.equal(text.trim().split('\r\n').length, 2);
});
test('busy and unavailable failures are stable and never expose database details', async () => {
  failure = 'AUDIT_BUSY'; const busy = await request(); assert.equal(busy.status, 409); assert.doesNotMatch(await busy.text(), /secret/);
  failure = 'OTHER'; const unavailable = await request(); assert.equal(unavailable.status, 503); assert.doesNotMatch(await unavailable.text(), /secret/);
});
