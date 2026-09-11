import assert from 'node:assert/strict';
import { it, mock } from 'node:test';
import express from 'express';

it('serves optional configuration as HTTP200, rejects malformed ranges and keeps admin-only/no-store semantics', async () => {
  const keys = ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_API_KEY', 'CLOUDFLARE_EMAIL'];
  const original = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  keys.forEach(key => delete process.env[key]);
  mock.module('../src/services/performance-service', { namedExports: { performanceService: {} } });
  const app = express();
  const { default: router } = await import('../src/routes/performance');
  app.use('/api/admin/performance', (req, res, next) => req.headers['x-test-admin'] === 'yes' ? next() : void res.sendStatus(401), router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}/api/admin/performance/web-vitals`;
  try {
    assert.equal((await fetch(base)).status, 401);
    const response = await fetch(base, { headers: { 'x-test-admin': 'yes' } });
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'private, no-store');
    const body = await response.json(); assert.equal(body.status, 'configuration_required'); assert.equal(body.lcp.p75, null);
    for (const query of ['?start=invalid', '?start=a&start=b', '?start=2026-02-30T00:00:00Z&end=2026-03-01T00:00:00Z']) {
      assert.equal((await fetch(base + query, { headers: { 'x-test-admin': 'yes' } })).status, 400);
    }
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    for (const [key, value] of Object.entries(original)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    mock.restoreAll();
  }
});
