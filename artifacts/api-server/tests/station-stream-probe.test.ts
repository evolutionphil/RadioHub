import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mock, test } from 'node:test';
import { validateOutboundUrl as realValidate } from '../src/utils/safe-fetch';

let port = 0;
let denied = false;
let dnsDelay = false;
const validations: string[] = [];
mock.module('../src/utils/safe-fetch.ts', { namedExports: {
  INTERNAL_SERVICE_PORTS: new Set([5432]),
  validateOutboundUrl: async (raw: string, options: { blockedPorts: ReadonlySet<number> }) => {
    assert.ok(options.blockedPorts.has(5432));
    validations.push(raw);
    if (dnsDelay) return new Promise(() => {});
    const url = new URL(raw);
    if (['127.0.0.1', 'localhost', '169.254.169.254'].includes(url.hostname) || url.port === '5432') return realValidate(raw, options);
    if (denied) return { ok: false, reason: 'private-ip-resolved:10.0.0.1' };
    // Only the isolated test changes the validated destination: real Node
    // transport must use the pinned loopback IP, retaining the invalid Host.
    url.port = String(port);
    return { ok: true, url, pinnedIp: '127.0.0.1', family: 4 };
  },
} });
const { parseStreamPlaylist, probeStreamAvailability } = await import('../src/utils/station-stream-probe');

test('pure playlist parser handles relative PLS/M3U, HLS master/audio rendition and actual media segment', () => {
  const base = 'https://radio.example.invalid/dir/list.m3u';
  assert.deepEqual(parseStreamPlaylist('[playlist]\nFile2=/second\nFile1=../live\nTitle1=Radio', base),
    { kind: 'playlist', nextUrl: 'https://radio.example.invalid/live', segment: false });
  assert.deepEqual(parseStreamPlaylist('#EXTM3U\n#EXTINF:-1,Name\nstream', base),
    { kind: 'playlist', nextUrl: 'https://radio.example.invalid/dir/stream', segment: false });
  assert.deepEqual(parseStreamPlaylist('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=64000\nlow.m3u8', base),
    { kind: 'playlist', nextUrl: 'https://radio.example.invalid/dir/low.m3u8', segment: false });
  assert.deepEqual(parseStreamPlaylist('#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",URI="audio.m3u8"\nvideo.m3u8', base),
    { kind: 'playlist', nextUrl: 'https://radio.example.invalid/dir/audio.m3u8', segment: false });
  assert.deepEqual(parseStreamPlaylist('#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:6,\nchunk.m4s', base),
    { kind: 'playlist', nextUrl: 'https://radio.example.invalid/dir/chunk.m4s', segment: true });
});

test('pure parsing refuses encrypted, credentialed, non-HTTP, empty or malformed playlist references', () => {
  const base = 'https://radio.example.invalid/list.m3u8';
  for (const text of ['#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="secret"\na.ts',
    '#EXTM3U\nhttps://user:secret@example.invalid/live', '#EXTM3U\nfile:///etc/passwd', '#EXTM3U', '<html>Denied</html>']) {
    assert.equal(parseStreamPlaylist(text, base)?.kind, 'unsupported');
  }
  assert.equal(parseStreamPlaylist('x', 'not a URL')?.kind, 'unsupported');
  assert.equal(parseStreamPlaylist('not a playlist', 'https://radio.example.invalid/live', 'text/plain'), null);
  assert.equal(parseStreamPlaylist('#EXTM3U\n#EXT-X-KEY:METHOD=NONE\nseg.aac', base)?.kind, 'playlist');
});

test('isolated HTTP availability samples enforce safe hops, budgets and conservative outcomes', async t => {
  const requests: { path: string; host: string; method: string }[] = [];
  const server = http.createServer((request, response) => {
    requests.push({ path: request.url || '', host: request.headers.host || '', method: request.method || '' });
    assert.equal(request.headers.cookie, undefined);
    assert.equal(request.headers.authorization, undefined);
    assert.equal(request.headers['accept-encoding'], 'identity');
    assert.match(request.headers.range || '', /^bytes=0-\d+$/);
    const path = request.url || '';
    if (/^\/status\/\d+$/.test(path)) { response.writeHead(Number(path.split('/').pop())); response.end(); return; }
    if (path === '/redirect') { response.writeHead(302, { location: '/audio' }); response.end(); return; }
    if (path === '/private') { response.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data' }); response.end(); return; }
    if (path === '/credential') { response.writeHead(302, { location: 'http://user:secret@source.invalid/audio' }); response.end(); return; }
    if (path === '/loop') { response.writeHead(302, { location: '/loop' }); response.end(); return; }
    if (path.startsWith('/hop/')) { response.writeHead(302, { location: `/hop/${Number(path.slice(5)) + 1}` }); response.end(); return; }
    if (path === '/stalled') { response.writeHead(200, { 'content-type': 'audio/mpeg' }); response.flushHeaders(); return; }
    if (path === '/reset') { request.socket.destroy(); return; }
    const playlists: Record<string, string> = {
      '/list.pls': '[playlist]\nFile1=/audio\nNumberOfEntries=1\nVersion=2',
      '/list.m3u': '#EXTM3U\n#EXTINF:-1,Fixture\n/audio',
      '/master.m3u8': '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=64000\n/media.m3u8',
      '/media.m3u8': '#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\n/segment.ts',
      '/missing-segment.m3u8': '#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\n/status/404',
      '/encrypted.m3u8': '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key"\n/segment.ts',
      '/private.m3u': '#EXTM3U\nhttp://127.0.0.1/private',
      '/playlist-loop.m3u': '#EXTM3U\n/playlist-loop.m3u',
      '/huge.m3u': '#EXTM3U\n#' + 'x'.repeat(80000) + '\n/audio',
      '/partial.m3u': '#EXTM3U\n#' + 'x'.repeat(1100),
    };
    if (playlists[path]) {
      response.writeHead(200, { 'content-type': path.endsWith('.pls') ? 'audio/x-scpls' : 'application/vnd.apple.mpegurl' });
      if (path === '/partial.m3u') response.write(playlists[path]); else response.end(playlists[path]);
      return;
    }
    if (path === '/segment.ts') {
      const segment = Buffer.alloc(2048, 0); segment[0] = 0x47; segment[188] = 0x47; segment[376] = 0x47;
      response.writeHead(200, { 'content-type': 'video/mp2t' }); response.end(segment); return;
    }
    response.writeHead(path === '/partial-audio' ? 206 : 200, { 'content-type': path === '/html' ? 'text/html' : 'audio/mpeg' });
    if (path === '/html' || path === '/fake-audio') response.end('<!doctype html><html>' + 'denied'.repeat(400));
    else if (path === '/short') response.end(Buffer.alloc(100));
    else response.end(Buffer.alloc(100000, 255));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  port = (server.address() as { port: number }).port;
  const probe = (path: string, options = {}) => probeStreamAvailability(`http://source.invalid${path}`, options);
  try {
    await t.test('GET and pinned DNS return >=1KiB audio, never fetch more than the sample', async () => {
      for (const path of ['/audio', '/partial-audio']) {
        const result = await probe(path);
        assert.equal(result.outcome, 'healthy'); assert.equal(result.bytesRead, 1024);
        assert.ok(Number.isFinite(Date.parse(result.checkedAt)));
      }
      assert.ok(requests.every(request => request.method === 'GET' && request.host.startsWith('source.invalid:')));
    });
    await t.test('redirect, PLS/M3U and HLS fetch real audio/segment with per-hop validation', async () => {
      for (const path of ['/redirect', '/list.pls', '/list.m3u', '/master.m3u8']) {
        const start = requests.length, validated = validations.length;
        const result = await probe(path);
        assert.equal(result.outcome, 'healthy', path); assert.ok(result.bytesRead >= 1024 && result.bytesRead <= 65536);
        assert.equal(validations.length - validated, requests.length - start);
        assert.equal(requests.at(-1)?.path, path === '/master.m3u8' ? '/segment.ts' : '/audio');
      }
    });
    await t.test('only firm404/410 are failed; access/rate/server errors remain inconclusive', async () => {
      for (const status of [404, 410, 401, 403, 429, 451, 500, 503]) {
        const result = await probe(`/status/${status}`);
        assert.equal(result.outcome, [404, 410].includes(status) ? 'failed' : 'inconclusive');
        assert.equal(result.reason, `http-${status}`); assert.equal(result.bytesRead, 0);
      }
      assert.equal((await probe('/missing-segment.m3u8')).outcome, 'inconclusive', 'live HLS segment rollover is not a dead station');
    });
    await t.test('HTML, fake audio, short sample, encrypted and oversized playlists never healthy', async () => {
      for (const path of ['/html', '/fake-audio', '/short', '/encrypted.m3u8', '/huge.m3u']) {
        assert.equal((await probe(path)).outcome, 'inconclusive', path);
      }
      assert.ok(!requests.some(request => request.path === '/key'));
    });
    await t.test('SSRF and credentialed redirect/playlist URLs stop before their request', async () => {
      for (const path of ['/private', '/credential', '/private.m3u']) {
        const start = requests.length;
        const result = await probe(path);
        assert.equal(result.outcome, 'inconclusive'); assert.equal(requests.length, start + 1);
        assert.ok(!JSON.stringify(result).includes('secret'));
      }
      const start = requests.length;
      for (const url of ['http://127.0.0.1/', 'http://localhost/', 'http://source.invalid:5432/', 'https://user:secret@source.invalid/', 'file:///etc/passwd', 'invalid']) {
        assert.equal((await probeStreamAvailability(url)).outcome, 'inconclusive');
      }
      denied = true;
      assert.equal((await probe('/audio')).outcome, 'inconclusive'); denied = false;
      assert.equal(requests.length, start);
    });
    await t.test('request and shared byte budgets cannot grow through redirects/playlists', async () => {
      let start = requests.length;
      const capped = await probe('/hop/1', { maxRequests: 500 });
      assert.equal(capped.reason, 'request-budget'); assert.equal(requests.length - start, 4);
      start = requests.length;
      const bytes = await probe('/list.m3u', { maxBytes: 1024 });
      assert.equal(bytes.reason, 'byte-budget'); assert.equal(requests.length - start, 1);
      assert.ok(bytes.bytesRead < 1024);
      for (const path of ['/loop', '/playlist-loop.m3u']) assert.equal((await probe(path)).reason, 'redirect-or-playlist-cycle');
    });
    await t.test('one whole deadline covers stalled DNS/body; external cancellation sends no request', async () => {
      for (const path of ['/stalled', '/partial.m3u']) {
        const start = Date.now(); const result = await probe(path, { timeoutMs: 70 });
        assert.equal(result.outcome, 'inconclusive'); assert.equal(result.reason, 'deadline-or-cancelled');
        assert.ok(Date.now() - start < 1000);
        if (path === '/partial.m3u') assert.equal(result.bytesRead, 1024);
      }
      const count = requests.length; dnsDelay = true;
      assert.equal((await probe('/audio', { timeoutMs: 40 })).reason, 'deadline-or-cancelled'); dnsDelay = false;
      const controller = new AbortController(); controller.abort();
      assert.equal((await probe('/audio', { signal: controller.signal })).reason, 'deadline-or-cancelled');
      assert.equal(requests.length, count);
      assert.equal((await probe('/reset')).outcome, 'inconclusive');
    });
  } finally {
    denied = false; dnsDelay = false;
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  }
  await t.test('connection refusal is a failed observation, not an internal retry', async () => {
    const result = await probe('/audio');
    assert.equal(result.outcome, 'failed'); assert.equal(result.reason, 'connection-refused');
  });
});
