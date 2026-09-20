import assert from 'node:assert/strict';
import { after, before, beforeEach, mock, test } from 'node:test';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

const calls: unknown[][] = [];
mock.module('../src/data/postgres-slug-store', { namedExports: {
  pgSlugStatistics: async () => ({}), pgClearAllSlugs: async () => ({}),
  pgStartSlugGeneration: async (...args: unknown[]) => {
    calls.push(['start', ...args]);
    return { job: { jobId: 'missing-station-slugs', progress: { total: 85 } }, token: 'test-token' };
  },
  runPgSlugGeneration: async (...args: unknown[]) => { calls.push(['run', ...args]); },
} });
mock.module('../src/data/postgres-maintenance-store', { namedExports: {
  pgMaintenanceJobs: async () => [], pgStopMaintenanceJobs: async () => {},
} });
mock.module('../src/cache', { defaultExport: { clearByPattern: async () => {} } });
mock.module('../src/seo/slug-existence', { namedExports: {
  loadSlugExistence: async () => { calls.push(['refresh-slugs']); },
} });
const { registerSlugRoutes } = await import('../src/routes/slug-routes');
let server: Server, base: string;
before(async () => {
  const app = express(); app.use(express.json());
  registerSlugRoutes(app, { requireAdmin: (req: any, res: any, next: any) => req.get('x-admin') === 'yes' ? next() : res.sendStatus(401) });
  server = await new Promise<Server>(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
beforeEach(() => { calls.length = 0; });
after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  mock.restoreAll();
});

for (const [body, regenerateAll] of [[{ regenerateAll: false }, false], [{ regenerateAll: true }, true], [{}, true]] as const) {
  test(`station slug endpoint keeps scope stations-only with regenerateAll=${regenerateAll} body=${JSON.stringify(body)}`, async () => {
    const response = await fetch(`${base}/api/admin/stations/generate-slugs`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin': 'yes' }, body: JSON.stringify(body) });
    assert.equal(response.status, 200);
    assert.equal((await response.json() as any).totalStations, 85);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.deepEqual(calls, [
      ['start', regenerateAll, true], ['run', 'missing-station-slugs', 'test-token', regenerateAll, true],
      ['refresh-slugs'],
    ]);
  });
}

test('missing-only station repair is protected by the existing admin gate', async () => {
  const response = await fetch(`${base}/api/admin/stations/generate-slugs`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ regenerateAll: false }) });
  assert.equal(response.status, 401);
  assert.deepEqual(calls, []);
});
