import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mock, test } from 'node:test';
import { validateOutboundUrl as realValidate } from '../src/utils/safe-fetch';

let allowed = true;
let port = 0;
mock.module('../src/utils/safe-fetch.ts', { namedExports: {
  INTERNAL_SERVICE_PORTS: new Set([5432]),
  validateOutboundUrl: async (raw: string, options: { blockedPorts: ReadonlySet<number> }) => {
    assert.ok(options.blockedPorts.has(5432));
    const url = new URL(raw);
    if (['127.0.0.1', 'localhost', '169.254.169.254'].includes(url.hostname) || url.port === '5432') return realValidate(raw, options);
    return allowed ? {
      ok: true, url: new URL(`http://probe.invalid:${port}${url.pathname}`),
      pinnedIp: '127.0.0.1', family: 4,
    } : { ok: false, reason: 'private-ip' };
  },
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
test('reviewed recovery shares bounded raw/resolved/playlist probing and never accepts unverified evidence', async t => {
  let requests = 0;
  const server = http.createServer((request, response) => {
    requests++;
    assert.match(request.headers.range || '', /^bytes=0-\d+$/);
    assert.ok(Number(request.headers.range?.split('-')[1]) < 16384);
    assert.equal(request.headers.cookie, undefined);
    assert.equal(request.headers.authorization, undefined);
    assert.equal(request.headers['accept-encoding'], 'identity');
    assert.match(request.headers.host || '', /^probe\.invalid:/);
    if (request.url === '/redirect') { response.writeHead(302, { location: '/audio' }); response.end(); return; }
    if (request.url === '/redirect-private') { response.writeHead(302, { location: 'http://169.254.169.254/private' }); response.end(); return; }
    if (request.url === '/redirect-credential') { response.writeHead(302, { location: 'https://user:password@example.invalid/audio' }); response.end(); return; }
    if (request.url === '/missing') { response.writeHead(404); response.end(); return; }
    if (request.url === '/many.m3u') {
      response.writeHead(200, { 'Content-Type': 'audio/mpegurl' });
      response.end('#EXTM3U\n' + Array.from({ length: 10 }, (_, i) => `/missing-${i}`).join('\n')); return;
    }
    if (request.url?.startsWith('/missing-')) { response.writeHead(404); response.end(); return; }
    if (request.url === '/alternates.pls') {
      response.writeHead(200, { 'Content-Type': 'audio/x-scpls' });
      response.end('[playlist]\nFile1=/missing\nFile2=/audio'); return;
    }
    if (request.url === '/media.m3u8') {
      response.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
      response.end('#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\n/segment.ts'); return;
    }
    if (request.url === '/segment.ts') {
      const segment = Buffer.alloc(2048, 0); segment[0] = 0x47; segment[188] = 0x47; segment[376] = 0x47;
      response.writeHead(200, { 'Content-Type': 'video/mp2t' }); response.end(segment); return;
    }
    if (request.url === '/error') { response.writeHead(503, { 'Content-Type': 'audio/mpeg' }); response.end(Buffer.alloc(2048)); return; }
    response.setHeader('Content-Type', request.url === '/html' ? 'text/html' : 'audio/mpeg');
    if (request.url === '/short') response.end('no');
    else if (request.url === '/html' || request.url === '/fake-audio') response.end('<!doctype html>' + 'x'.repeat(2048));
    else response.end(Buffer.alloc(4096, 255));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  port = (server.address() as { port: number }).port;
  try {
    await t.test('direct audio, safe redirects and raw fallback return only sampled evidence', async () => {
      for (const candidates of ['http://unresolvable.invalid/audio', 'http://unresolvable.invalid/redirect',
        ['http://unresolvable.invalid/missing', 'http://unresolvable.invalid/audio']]) {
        const evidence = await probeStationStream(candidates);
        assert.equal(evidence.bytesRead, 1024); assert.equal(evidence.contentType, 'audio/mpeg');
        assert.ok(Number.isFinite(Date.parse(evidence.checkedAt)));
        assert.deepEqual(Object.keys(evidence).sort(), ['bytesRead', 'checkedAt', 'contentType']);
      }
    });
    await t.test('PLS alternatives and actual HLS segments include shared bytes, not manifest MIME as audio proof', async () => {
      const playlist = await probeStationStream('http://unresolvable.invalid/alternates.pls');
      assert.ok(playlist.bytesRead > 1024 && playlist.bytesRead <= 65536); assert.equal(playlist.contentType, 'audio/mpeg');
      const hls = await probeStationStream('http://unresolvable.invalid/media.m3u8');
      assert.ok(hls.bytesRead > 1024 && hls.bytesRead <= 65536); assert.equal(hls.contentType, 'video/mp2t');
    });
    await t.test('both failed and inconclusive observations reject reviewed recovery', async () => {
      for (const path of ['/missing', '/error', '/html', '/short', '/fake-audio']) {
        await assert.rejects(() => probeStationStream(`http://unresolvable.invalid${path}`), /A working audio response was not verified/);
      }
      const before = requests;
      await assert.rejects(() => probeStationStream('http://unresolvable.invalid/many.m3u'));
      assert.equal(requests - before, 4, 'one request budget covers every alternative');
    });
    await t.test('unsafe roots and redirect destinations remain blocked before connection', async () => {
      for (const path of ['/redirect-private', '/redirect-credential']) {
        const before = requests;
        await assert.rejects(() => probeStationStream(`http://unresolvable.invalid${path}`));
        assert.equal(requests - before, 1, 'unsafe redirect was not requested');
      }
      const before = requests;
      allowed = false;
      await assert.rejects(() => probeStationStream('http://unresolvable.invalid/audio'));
      allowed = true;
      for (const url of ['http://127.0.0.1/audio', 'https://user:password@example.invalid/audio', 'http://unresolvable.invalid:5432/audio']) {
        await assert.rejects(() => probeStationStream(url));
      }
      assert.equal(requests, before);
    });
  } finally { allowed = true; server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  await assert.rejects(() => probeStationStream('http://unresolvable.invalid/audio'), /A working audio response was not verified/);
});
