import http from 'node:http';
import https from 'node:https';
import { evaluateJunkStation, isNumericOnlySlug } from '../seo/junk-station-rules';
import { validateOutboundUrl, INTERNAL_SERVICE_PORTS } from './safe-fetch';

/** The exact inputs an administrator reviewed, independent of mutable counters. */
export function getStreamRecoverySnapshot(station: any): Record<string, any> {
  const fields = ['slug', 'name', 'url', 'urlResolved', 'noIndex', 'lastCheckOk',
    'lastCheckTime', 'lastCheckOkTime', 'manualEditFields', 'redirectToSlug', 'automaticNoIndex'];
  return Object.fromEntries(fields.map(key => [key,
    station[key] instanceof Date ? station[key].toISOString() : station[key] ?? null]));
}

/** An explicit administrator review may recover a historical health flag,
 * but cannot reverse manual exclusions, redirects or other quality rules.
 * Passing health=true here isolates non-health reasons; it does not assert
 * a working stream. A separate pinned-network probe must succeed before CAS.
 */
export function assertRecoverableStation(station: any): void {
  if (!station || station.noIndex !== true || station.manualEditFields?.noIndex ||
      station.redirectToSlug || isNumericOnlySlug(station.slug) ||
      evaluateJunkStation({ ...station, lastCheckOk: true }).isJunk) {
    throw new Error('Station is not eligible for reviewed health recovery');
  }
  const previous = station.automaticNoIndex;
  if (previous?.active && previous.reason !== 'stream-dead-30d') {
    throw new Error('A non-health exclusion must be reviewed separately');
  }
  if (station.lastCheckOk !== false && previous?.reason !== 'stream-dead-30d') {
    throw new Error('Station has no failed health evidence to recover');
  }
}

export interface StreamRecoveryEvidence { checkedAt: string; contentType: string; bytesRead: number }

/** A small audio-response sample, not a playback or availability guarantee.
 * No retries/redirects, cookies or credentials. DNS is validated and pinned;
 * the entire operation is bounded by12seconds and stops after1KiB of audio.
 */
export async function probeStationStream(rawUrl: string): Promise<StreamRecoveryEvidence> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const parsed = new URL(rawUrl);
    if (parsed.username || parsed.password) throw new Error('Credentialed streams cannot be probed');
    const guard = await Promise.race([
      validateOutboundUrl(rawUrl, { blockedPorts: INTERNAL_SERVICE_PORTS }),
      new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('Stream probe timed out')), { once: true })),
    ]);
    if (!guard.ok || controller.signal.aborted) throw new Error('Stream probe is unavailable');
    return await new Promise<StreamRecoveryEvidence>((resolve, reject) => {
      let done = false;
      const transport = guard.url.protocol === 'https:' ? https : http;
      const request = transport.request(guard.url, {
        method: 'GET', agent: false, signal: controller.signal,
        family: guard.family,
        lookup: (_host, _options, callback) => callback(null, guard.pinnedIp, guard.family),
        headers: { 'User-Agent': 'MegaRadio-Reviewed-Health-Recovery/1.0',
          Accept: 'audio/*,application/ogg', Range: 'bytes=0-1023' },
      }, response => {
        const contentType = String(response.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
        const fail = () => {
          if (!done) { done = true; reject(new Error('A working audio response was not verified')); }
          response.destroy(); request.destroy();
        };
        if (![200, 206].includes(response.statusCode || 0) ||
            !/^(audio\/[a-z0-9.+-]+|application\/ogg)$/.test(contentType)) return fail();
        let bytes = 0;
        const chunks: Buffer[] = [];
        response.on('data', chunk => {
          const part = Buffer.from(chunk).subarray(0, 1024 - bytes);
          chunks.push(part); bytes += part.length;
          if (bytes < 1024 || done) return;
          if (/^\s*<(?:!doctype|html|head|body)\b/i.test(Buffer.concat(chunks).subarray(0, 100).toString())) return fail();
          done = true;
          resolve({ checkedAt: new Date().toISOString(), contentType, bytesRead: bytes });
          response.destroy(); request.destroy();
        });
        response.on('error', fail);
        response.on('end', () => { if (!done) fail(); });
      });
      request.on('error', () => {
        if (!done) { done = true; reject(new Error('Stream probe is unavailable')); }
      });
      request.end();
    });
  } finally { clearTimeout(timer); }
}
