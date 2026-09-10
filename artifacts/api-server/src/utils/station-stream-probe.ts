import http from 'node:http';
import https from 'node:https';
import { INTERNAL_SERVICE_PORTS, validateOutboundUrl, type SafeUrlResult } from './safe-fetch';

export interface StreamAvailability {
  outcome: 'healthy' | 'failed' | 'inconclusive';
  reason: string;
  checkedAt: string;
  bytesRead: number;
  /** Present only after a media sample, never copied from an unverified
   * manifest/error response. Unknown media MIME is application/octet-stream. */
  verifiedContentType?: string;
}
export interface StreamProbeOptions {
  /** Options can reduce, never increase, the production resource ceilings. */
  timeoutMs?: number;
  maxBytes?: number;
  maxRequests?: number;
  signal?: AbortSignal;
}
export interface StreamPlaylistCandidate { nextUrl: string; segment: boolean }
export type ParsedStreamPlaylist =
  | ({ kind: 'playlist'; alternatives?: StreamPlaylistCandidate[]; inconclusiveReason?: string } & StreamPlaylistCandidate)
  | { kind: 'unsupported'; reason: string }
  | null;

const PLAYLIST_TYPE = /(?:mpegurl|scpls|vnd\.apple\.mpegurl)/i;
const HTML = /^\s*(?:\uFEFF)?\s*<(?:!doctype|html|head|body|\?xml|svg)\b/i;
const MAX_PLAYLIST_BYTES = 16 * 1024;
const MAX_CANDIDATES = 16;

/** Parse bounded PLS/M3U/HLS alternatives, preserving uncertainty for entries
 * we cannot inspect. This does not authorize their URLs: the caller must
 * validate and pin DNS again before following every returned hop. */
export function parseStreamPlaylist(body: string, baseUrl: string, contentType = ''): ParsedStreamPlaylist {
  let base: URL;
  try { base = new URL(baseUrl); } catch { return { kind: 'unsupported', reason: 'invalid-playlist-base' }; }
  if (Buffer.byteLength(body, 'utf8') > MAX_PLAYLIST_BYTES) return { kind: 'unsupported', reason: 'playlist-body-budget' };
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
  const renditionUrls = lines.filter(line => /^#EXT-X-MEDIA:/i.test(line) && /\bTYPE=AUDIO(?:,|$)/i.test(line))
    .map(line => /\bURI="([^"]+)"/i.exec(line)?.[1]).filter((url): url is string => Boolean(url));
  const entries = lines.filter(line => line && !line.startsWith('#') && !line.startsWith('[')
    && !/^(?:NumberOfEntries|Title\d+|Length\d+|Version)\s*=/i.test(line));
  const references = pls.length ? pls.map(match => match[2]) : [...renditionUrls, ...entries];
  const segment = !pls.length && !renditionUrls.length && lines.some(line => /^#EXT-X-TARGETDURATION:/i.test(line));
  const candidates: StreamPlaylistCandidate[] = [];
  const seen = new Set<string>();
  let inconclusiveReason: string | undefined;
  for (const reference of references) {
    try {
      const next = new URL(reference, baseUrl);
      if (!['http:', 'https:'].includes(next.protocol) || next.username || next.password || next.href.length > 8192) {
        inconclusiveReason ||= 'unsafe-playlist-url';
        continue;
      }
      next.hash = '';
      if (seen.has(next.href)) continue;
      seen.add(next.href);
      if (candidates.length >= MAX_CANDIDATES) { inconclusiveReason ||= 'playlist-candidate-budget'; continue; }
      candidates.push({ nextUrl: next.href, segment });
    } catch { inconclusiveReason ||= 'invalid-playlist-url'; }
  }
  if (!candidates.length) return { kind: 'unsupported', reason: inconclusiveReason || 'empty-playlist' };
  return {
    kind: 'playlist', ...candidates[0],
    ...(candidates.length > 1 ? { alternatives: candidates.slice(1) } : {}),
    ...(inconclusiveReason ? { inconclusiveReason } : {}),
  };
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
        const body = Buffer.concat(chunks, bytes);
        if (status === 206 && isPlaylist(body, contentType, guard.url)) {
          const range = /^bytes (\d+)-(\d+)\/(\d+)$/i.exec(String(response.headers['content-range'] || ''));
          // A partial manifest may contain only its first, broken alternative.
          // Unlike a sampled audio payload, it cannot prove all entries failed.
          truncated ||= !range || Number(range[1]) !== 0 || Number(range[2]) + 1 !== Number(range[3]) || Number(range[3]) !== bytes;
        }
        resolve({ status, contentType, location: response.headers.location, body, truncated });
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
 * deliberately inconclusive. Original/resolved URLs, redirects and every
 * playlist alternative share ONE station-wide deadline and resource budget.
 * A single positive sample wins; a negative requires all inspected branches
 * to conclusively fail, with no unsupported or untested branch remaining. */
export async function probeStreamAvailability(rawUrl: string | readonly string[], options: StreamProbeOptions = {}): Promise<StreamAvailability> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), bounded(options.timeoutMs, 8000));
  const cancel = () => controller.abort();
  options.signal?.addEventListener('abort', cancel, { once: true });
  if (options.signal?.aborted) controller.abort();
  const maxBytes = bounded(options.maxBytes, 64 * 1024);
  const maxRequests = bounded(options.maxRequests, 4);
  let bytesRead = 0;
  let requestCount = 0;
  let failedCount = 0;
  let lastFailure = '';
  let uncertainReason = '';
  const pending: { key: string; url: URL; segment: boolean; ancestors: ReadonlySet<string> }[] = [];
  const scheduled = new Set<string>();
  const failures = new Set<string>();
  const branches = new Map<string, string[]>();
  const enqueue = (raw: string, segment = false, ancestors: ReadonlySet<string> = new Set()) => {
    if (typeof raw !== 'string') { uncertainReason ||= 'invalid-url'; return; }
    if (raw.length > 8192) { uncertainReason ||= 'unsafe-url'; return; }
    let url: URL;
    try { url = new URL(raw); } catch { uncertainReason ||= 'invalid-url'; return; }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.href.length > 8192) {
      uncertainReason ||= 'unsafe-url'; return;
    }
    url.hash = '';
    if (ancestors.has(url.href)) { uncertainReason ||= 'redirect-or-playlist-cycle'; return; }
    // The same address may be a live HLS segment in one branch but a direct
    // stream in another. A missing rolling segment is never firm evidence.
    const key = `${Number(segment)}:${url.href}`;
    if (scheduled.has(key)) return key;
    if (scheduled.size >= MAX_CANDIDATES) { uncertainReason ||= 'candidate-budget'; return; }
    scheduled.add(key);
    pending.push({ key, url, segment, ancestors });
    return key;
  };
  const result = (outcome: StreamAvailability['outcome'], reason: string, verifiedContentType?: string): StreamAvailability =>
    ({ outcome, reason, checkedAt: new Date().toISOString(), bytesRead,
      ...(verifiedContentType ? { verifiedContentType } : {}) });
  try {
    const input = typeof rawUrl === 'string' ? [rawUrl] : rawUrl;
    const roots = input.slice(0, MAX_CANDIDATES).map(url => enqueue(url)).filter((key): key is string => Boolean(key));
    if (input.length > MAX_CANDIDATES) uncertainReason ||= 'candidate-budget';
    while (pending.length) {
      if (controller.signal.aborted) return result('inconclusive', 'deadline-or-cancelled');
      if (requestCount >= maxRequests) return result('inconclusive', 'request-budget');
      if (maxBytes - bytesRead < 1024) return result('inconclusive', 'byte-budget');
      const { key, url, segment, ancestors } = pending.shift()!;
      let response: ProbeResponse;
      let guard: SafeUrlResult;
      try {
        const validated = await untilAbort(validateOutboundUrl(url.href, { blockedPorts: INTERNAL_SERVICE_PORTS }), controller.signal);
        if (!validated.ok) { uncertainReason ||= 'url-validation-rejected'; continue; }
        guard = validated;
        requestCount++;
        response = await requestPinned(guard, controller.signal, Math.min(MAX_PLAYLIST_BYTES, maxBytes - bytesRead));
      } catch (error: any) {
        bytesRead = Math.min(maxBytes, bytesRead + (Number(error?.sampleBytesRead) || 0));
        if (controller.signal.aborted || error?.code === 'ABORT_ERR') return result('inconclusive', 'deadline-or-cancelled');
        // The guard pins only one validated DNS answer. Another A/AAAA answer,
        // network or player fallback can work despite this socket refusal.
        uncertainReason ||= error?.code === 'ECONNREFUSED' ? 'connection-refused' : 'network-error';
        continue;
      }
      bytesRead += response.body.length;
      const childAncestors = new Set([...ancestors, url.href]);
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (!response.location) { uncertainReason ||= 'redirect-without-location'; continue; }
        try {
          const child = enqueue(new URL(response.location, guard.url).href, segment, childAncestors);
          branches.set(key, child ? [child] : []);
        }
        catch { uncertainReason ||= 'invalid-redirect'; }
        continue;
      }
      if ([404, 410].includes(response.status)) {
        if (segment) uncertainReason ||= 'hls-segment-unavailable';
        else { failedCount++; failures.add(key); lastFailure = `http-${response.status}`; }
        continue;
      }
      if (![200, 206].includes(response.status)) { uncertainReason ||= `http-${response.status}`; continue; }
      if (response.truncated) { uncertainReason ||= 'playlist-or-encoding-budget'; continue; }
      const playlist = parseStreamPlaylist(response.body.toString('utf8'), guard.url.href, response.contentType);
      if (playlist?.kind === 'unsupported') { uncertainReason ||= playlist.reason; continue; }
      if (playlist?.kind === 'playlist') {
        uncertainReason ||= playlist.inconclusiveReason || '';
        const children = [playlist, ...(playlist.alternatives || [])]
          .map(candidate => enqueue(candidate.nextUrl, candidate.segment, childAncestors))
          .filter((child): child is string => Boolean(child));
        branches.set(key, children);
        continue;
      }
      if (audioSample(response.body, response.contentType, segment)) {
        const contentType = response.contentType.length <= 256 && /^(audio\/[a-z0-9.+-]+|application\/(?:ogg|mp4)|video\/(?:mp2t|mp4))$/.test(response.contentType)
          ? response.contentType : 'application/octet-stream';
        return result('healthy', segment ? 'hls-segment-sample' : 'audio-sample', contentType);
      }
      uncertainReason ||= response.body.length < 1024 ? 'insufficient-sample' : 'non-audio-content';
    }
    if (controller.signal.aborted) return result('inconclusive', 'deadline-or-cancelled');
    if (uncertainReason || !failedCount) return result('inconclusive', uncertainReason || 'no-candidates');
    // Deduplicated roots may converge on each other before either was visited.
    // Walk their tiny dependency graph so a cycle cannot be mistaken for a
    // fully failed branch just because some unrelated candidate returned 404.
    const failedBranch = (key: string, ancestors: ReadonlySet<string> = new Set()): boolean => {
      if (failures.has(key)) return true;
      if (ancestors.has(key)) return false;
      const children = branches.get(key);
      return Boolean(children?.length && children.every(child => failedBranch(child, new Set([...ancestors, key]))));
    };
    if (!roots.every(root => failedBranch(root))) return result('inconclusive', 'redirect-or-playlist-cycle');
    return result('failed', failedCount > 1 ? 'all-candidates-failed' : lastFailure);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', cancel);
  }
}
