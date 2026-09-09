import http from 'node:http';
import https from 'node:https';
import { INTERNAL_SERVICE_PORTS, validateOutboundUrl, type SafeUrlResult } from './safe-fetch';

export interface StreamAvailability {
  outcome: 'healthy' | 'failed' | 'inconclusive';
  reason: string;
  checkedAt: string;
  bytesRead: number;
}
export interface StreamProbeOptions {
  /** Options can reduce, never increase, the production resource ceilings. */
  timeoutMs?: number;
  maxBytes?: number;
  maxRequests?: number;
  signal?: AbortSignal;
}
export type ParsedStreamPlaylist =
  | { kind: 'playlist'; nextUrl: string; segment: boolean }
  | { kind: 'unsupported'; reason: string }
  | null;

const PLAYLIST_TYPE = /(?:mpegurl|scpls|vnd\.apple\.mpegurl)/i;
const HTML = /^\s*(?:\uFEFF)?\s*<(?:!doctype|html|head|body|\?xml|svg)\b/i;
const MAX_PLAYLIST_BYTES = 16 * 1024;

/** Parse one bounded PLS/M3U/HLS hop. This does not authorize its URL: the
 * caller must validate and pin DNS again before following every returned hop. */
export function parseStreamPlaylist(body: string, baseUrl: string, contentType = ''): ParsedStreamPlaylist {
  let base: URL;
  try { base = new URL(baseUrl); } catch { return { kind: 'unsupported', reason: 'invalid-playlist-base' }; }
  const text = body.replace(/^\uFEFF/, '').trim();
  const lines = text.split(/\r?\n/).map(line => line.trim());
  const playlist = /^\[playlist\]/i.test(text) || /^#EXTM3U\b/i.test(text)
    || PLAYLIST_TYPE.test(contentType) || /\.(?:m3u8?|pls)$/i.test(base.pathname);
  if (!playlist) return null;
  if (HTML.test(text)) return { kind: 'unsupported', reason: 'playlist-is-markup' };
  if (lines.some(line => /^#EXT-X-(?:SESSION-)?KEY:/i.test(line) && !/\bMETHOD=NONE(?:,|$)/i.test(line))) {
    return { kind: 'unsupported', reason: 'encrypted-hls' };
  }
  const pls = lines.map(line => /^File(\d+)\s*=\s*(.+)$/i.exec(line)).filter(match => match !== null)
    .sort((left, right) => Number(left[1]) - Number(right[1]));
  const audioRendition = lines.find(line => /^#EXT-X-MEDIA:/i.test(line) && /\bTYPE=AUDIO(?:,|$)/i.test(line));
  const renditionUrl = audioRendition && /\bURI="([^"]+)"/.exec(audioRendition)?.[1];
  const candidate = pls[0]?.[2] || renditionUrl || lines.find(line => line && !line.startsWith('#') && !line.startsWith('[')
    && !/^(?:NumberOfEntries|Title\d+|Length\d+|Version)\s*=/i.test(line));
  if (!candidate) return { kind: 'unsupported', reason: 'empty-playlist' };
  try {
    const next = new URL(candidate, baseUrl);
    if (!['http:', 'https:'].includes(next.protocol) || next.username || next.password) {
      return { kind: 'unsupported', reason: 'unsafe-playlist-url' };
    }
    return { kind: 'playlist', nextUrl: next.href,
      segment: !pls.length && !renditionUrl && lines.some(line => /^#EXT-X-TARGETDURATION:/i.test(line)) };
  } catch { return { kind: 'unsupported', reason: 'invalid-playlist-url' }; }
}

function bounded(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value! > 0 ? Math.min(Math.floor(value!), fallback) : fallback;
}
function isPlaylist(body: Buffer, contentType: string, url: URL): boolean {
  return PLAYLIST_TYPE.test(contentType) || /\.(?:m3u8?|pls)$/i.test(url.pathname)
    || /^(?:\uFEFF)?\s*(?:#EXTM3U\b|\[playlist\])/i.test(body.subarray(0, 100).toString('utf8'));
}
function audioSample(body: Buffer, contentType: string, segment: boolean): boolean {
  if (body.length < 1024 || HTML.test(body.subarray(0, 256).toString('utf8'))) return false;
  if (/^audio\//.test(contentType) || contentType === 'application/ogg') return true;
  const prefix = body.subarray(0, 12).toString('latin1');
  if (/^(?:ID3|OggS|fLaC)/.test(prefix) || (prefix.startsWith('RIFF') && prefix.endsWith('WAVE'))) return true;
  if (body[0] === 0xff && (body[1] & 0xe0) === 0xe0) return true; // MPEG audio / ADTS
  // HLS media segments can contain MPEG-TS or fragmented MP4. Fetch the
  // actual segment, not just a master/media manifest or its init-map URI.
  return segment && ((body[0] === 0x47 && body[188] === 0x47 && body[376] === 0x47)
    || ['styp', 'moof', 'mdat'].includes(body.subarray(4, 8).toString('ascii')));
}

interface ProbeResponse { status: number; contentType: string; location?: string; body: Buffer; truncated: boolean }

/** Sampled payload stays bounded; Node/OS may buffer additional in-flight TCP
 * bytes before socket destruction. No response is decompressed or pooled. */
function requestPinned(guard: SafeUrlResult, signal: AbortSignal, maxBytes: number): Promise<ProbeResponse> {
  return new Promise((resolve, reject) => {
    let done = false;
    let sampledBytes = 0;
    const transport = guard.url.protocol === 'https:' ? https : http;
    const request = transport.request(guard.url, {
      method: 'GET', agent: false, signal, family: guard.family, maxHeaderSize: 8192,
      lookup: (_host, _options, callback) => callback(null, guard.pinnedIp, guard.family),
      headers: { 'User-Agent': 'MegaRadio-Availability-Probe/1.0',
        Accept: 'audio/*,application/ogg,application/vnd.apple.mpegurl,audio/x-scpls,*/*;q=0.1',
        'Accept-Encoding': 'identity', Range: `bytes=0-${maxBytes - 1}` },
    }, response => {
      const contentType = String(response.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      const status = response.statusCode || 0;
      let bytes = 0;
      const chunks: Buffer[] = [];
      const finish = (truncated = false) => {
        if (done) return;
        done = true;
        resolve({ status, contentType, location: response.headers.location, body: Buffer.concat(chunks, bytes), truncated });
        response.destroy(); request.destroy();
      };
      const fail = (error: Error) => {
        if (!done) { done = true; reject(Object.assign(error, { sampleBytesRead: bytes })); }
        response.destroy(); request.destroy();
      };
      response.on('error', fail);
      response.on('aborted', () => fail(Object.assign(new Error('Aborted response'), { code: 'ECONNRESET' })));
      if (![200, 206].includes(status)) return finish();
      if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') return finish(true);
      response.on('readable', () => {
        while (!done) {
          const chunk = response.read(Math.min(1024, maxBytes - bytes)) as Buffer | null;
          if (!chunk) break;
          chunks.push(chunk); bytes += chunk.length; sampledBytes = bytes;
          const prefix = Buffer.concat(chunks, bytes);
          if (bytes >= 1024 && !isPlaylist(prefix, contentType, guard.url)) return finish();
          if (bytes >= maxBytes) return finish(true);
        }
      });
      response.on('end', () => finish());
    });
    request.on('error', error => { if (!done) { done = true; reject(Object.assign(error, { sampleBytesRead: sampledBytes })); } });
    request.end();
  });
}

function untilAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(Object.assign(new Error('Probe deadline or cancellation'), { code: 'ABORT_ERR' }));
    if (signal.aborted) return abort();
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

/** Availability evidence only, never a permanent exclusion decision. The
 * worker requires separated failed observations; access/network ambiguity is
 * deliberately inconclusive. Redirect/playlist hops share one deadline. */
export async function probeStreamAvailability(rawUrl: string, options: StreamProbeOptions = {}): Promise<StreamAvailability> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), bounded(options.timeoutMs, 8000));
  const cancel = () => controller.abort();
  options.signal?.addEventListener('abort', cancel, { once: true });
  if (options.signal?.aborted) controller.abort();
  const maxBytes = bounded(options.maxBytes, 64 * 1024);
  const maxRequests = bounded(options.maxRequests, 4);
  let bytesRead = 0;
  let nextUrl = rawUrl;
  let segment = false;
  const visited = new Set<string>();
  const result = (outcome: StreamAvailability['outcome'], reason: string): StreamAvailability =>
    ({ outcome, reason, checkedAt: new Date().toISOString(), bytesRead });
  try {
    for (let requestCount = 0; requestCount < maxRequests; requestCount++) {
      if (controller.signal.aborted) return result('inconclusive', 'deadline-or-cancelled');
      if (maxBytes - bytesRead < 1024) return result('inconclusive', 'byte-budget');
      let url: URL;
      try { url = new URL(nextUrl); } catch { return result('inconclusive', 'invalid-url'); }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.href.length > 8192) {
        return result('inconclusive', 'unsafe-url');
      }
      url.hash = '';
      if (visited.has(url.href)) return result('inconclusive', 'redirect-or-playlist-cycle');
      visited.add(url.href);
      const guard = await untilAbort(validateOutboundUrl(url.href, { blockedPorts: INTERNAL_SERVICE_PORTS }), controller.signal);
      if (!guard.ok) return result('inconclusive', 'url-validation-rejected');
      const response = await requestPinned(guard, controller.signal, Math.min(MAX_PLAYLIST_BYTES, maxBytes - bytesRead));
      bytesRead += response.body.length;
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (!response.location) return result('inconclusive', 'redirect-without-location');
        try { nextUrl = new URL(response.location, guard.url).href; }
        catch { return result('inconclusive', 'invalid-redirect'); }
        continue;
      }
      if ([404, 410].includes(response.status)) return result(segment ? 'inconclusive' : 'failed', segment ? 'hls-segment-unavailable' : `http-${response.status}`);
      if (![200, 206].includes(response.status)) return result('inconclusive', `http-${response.status}`);
      if (response.truncated) return result('inconclusive', 'playlist-or-encoding-budget');
      const playlist = parseStreamPlaylist(response.body.toString('utf8'), guard.url.href, response.contentType);
      if (playlist?.kind === 'unsupported') return result('inconclusive', playlist.reason);
      if (playlist?.kind === 'playlist') { nextUrl = playlist.nextUrl; segment = playlist.segment; continue; }
      if (audioSample(response.body, response.contentType, segment)) return result('healthy', segment ? 'hls-segment-sample' : 'audio-sample');
      return result('inconclusive', response.body.length < 1024 ? 'insufficient-sample' : 'non-audio-content');
    }
    return result('inconclusive', 'request-budget');
  } catch (error: any) {
    bytesRead = Math.min(maxBytes, bytesRead + (Number(error?.sampleBytesRead) || 0));
    if (controller.signal.aborted || error?.code === 'ABORT_ERR') return result('inconclusive', 'deadline-or-cancelled');
    if (error?.code === 'ECONNREFUSED') return result('failed', 'connection-refused');
    return result('inconclusive', 'network-error');
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', cancel);
  }
}
