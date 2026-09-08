import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mock, test } from 'node:test';

let allowed = true;
let port = 0;
mock.module('../src/utils/safe-fetch.ts', { namedExports: {
  INTERNAL_SERVICE_PORTS: new Set([5432]),
  validateOutboundUrl: async (raw: string) => allowed ? {
    ok: true, url: new URL(`http://probe.invalid:${port}${new URL(raw).pathname}`),
    pinnedIp: '127.0.0.1', family: 4,
  } : { ok: false, reason: 'private-ip' },
} });
const { assertRecoverableStation, getStreamRecoverySnapshot, probeStationStream } = await import('../src/utils/station-health-recovery');

const row = () => ({ slug: 'nrj-oriental', name: 'NRJ Oriental', url: 'https://radio.invalid/live',
  noIndex: true, lastCheckOk: false, manualEditFields: {}, lastCheckTime: new Date('2025-11-21T00:00:00Z') });
test('review snapshot normalizes dates/nulls and excludes ratings/translations/counters', () => {
  const snapshot = getStreamRecoverySnapshot({ ...row(), votes: 200, descriptions: { de: { full: 'Kept' } } });
  assert.equal(snapshot.lastCheckTime, '2025-11-21T00:00:00.000Z');
  assert.equal(snapshot.urlResolved, null);
  assert.ok(!('votes' in snapshot)); assert.ok(!('descriptions' in snapshot));
});
test('reviewed recovery permits historical health flags, never manual/non-health/redirect exclusions', () => {
  assert.doesNotThrow(() => assertRecoverableStation(row()));
  for (const change of [{ noIndex: false }, { lastCheckOk: true }, { manualEditFields: { noIndex: true } },
    { redirectToSlug: 'original' }, { slug: '1234' }, { slug: 'test-stream' }, { slug: 'radio-aac' },
    { url: '' }, { name: '' }, { automaticNoIndex: { active: true, reason: 'duplicate-of:radio' } }]) {
    assert.throws(() => assertRecoverableStation({ ...row(), ...change }));
  }
});
test('probe pins DNS, bounds audio to1KiB and rejects redirects, empty/HTML/error/private/credentialed streams', async () => {
  let requests = 0;
  const server = http.createServer((request, response) => {
    requests++;
    assert.equal(request.headers.range, 'bytes=0-1023');
    assert.equal(request.headers.cookie, undefined);
    assert.match(request.headers.host || '', /^probe\.invalid:/);
    if (request.url === '/redirect') { response.writeHead(302, { location: '/audio' }); response.end(); return; }
    if (request.url === '/error') { response.writeHead(503, { 'Content-Type': 'audio/mpeg' }); response.end(Buffer.alloc(2048)); return; }
    response.setHeader('Content-Type', request.url === '/html' ? 'text/html' : 'audio/mpeg');
    if (request.url === '/short') response.end('no');
    else if (request.url === '/fake-audio') response.end('<!doctype html>' + 'x'.repeat(2048));
    else response.end(Buffer.alloc(4096, 255));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  port = (server.address() as { port: number }).port;
  try {
    const evidence = await probeStationStream('http://unresolvable.invalid/audio');
    assert.equal(evidence.bytesRead, 1024); assert.equal(evidence.contentType, 'audio/mpeg');
    assert.ok(Number.isFinite(Date.parse(evidence.checkedAt)));
    for (const path of ['/redirect', '/error', '/html', '/short', '/fake-audio']) {
      await assert.rejects(() => probeStationStream(`http://unresolvable.invalid${path}`));
    }
    const before = requests;
    allowed = false;
    await assert.rejects(() => probeStationStream('http://127.0.0.1/audio'));
    allowed = true;
    await assert.rejects(() => probeStationStream('https://user:password@example.invalid/audio'));
    assert.equal(requests, before);
    assert.equal(requests, 6, 'redirect was not followed and no retry was made');
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
