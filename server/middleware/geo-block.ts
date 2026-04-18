import type { Request, Response, NextFunction } from 'express';

/**
 * Geo-Block Middleware
 *
 * Drops TCP connections from blocked countries with no HTTP response,
 * forcing the client to see a connection reset (RST) instead of a 403.
 * This saves bandwidth and CPU vs sending a response body.
 *
 * Source of truth: Cloudflare's `cf-ipcountry` request header (ISO-3166-1 alpha-2).
 * Cloudflare sets this on every request that hits our origin.
 *
 * To change the blocklist, edit BLOCKED_COUNTRIES below or set the
 * `BLOCKED_COUNTRIES` env var (comma-separated, e.g. "SG,TH,RU").
 */

const DEFAULT_BLOCKED = ['SG', 'TH'];

const BLOCKED_COUNTRIES: Set<string> = new Set(
  (process.env.BLOCKED_COUNTRIES
    ? process.env.BLOCKED_COUNTRIES.split(',')
    : DEFAULT_BLOCKED
  )
    .map(c => c.trim().toUpperCase())
    .filter(c => /^[A-Z]{2}$/.test(c))
);

// Production hosts that MUST go through Cloudflare. If a request claims
// one of these Host headers but has no `cf-ipcountry`, it is a direct
// origin connection (CF bypass attempt) — drop it.
const PROTECTED_HOSTS: Set<string> = new Set(
  (process.env.PROTECTED_HOSTS ||
    'themegaradio.com,www.themegaradio.com,api.themegaradio.com,stream.themegaradio.com'
  )
    .split(',')
    .map(h => h.trim().toLowerCase())
    .filter(Boolean)
);

// CF bypass detection is OFF by default. Railway's internal health checks
// and our own self-watchdog hit the container directly (not through CF), so
// they have NO cf-ipcountry header. Enabling CF-only enforcement here would
// kill those requests, fail health checks, and cause 502 Bad Gateway.
// Only enable via env if origin IP is genuinely public AND health checks
// have been allowlisted by path/source-IP.
const ENFORCE_CF_ONLY = process.env.ENFORCE_CF_ONLY === 'true';

// Health check / internal paths that must NEVER be blocked, regardless of source.
const HEALTH_PATHS = new Set([
  '/healthz', '/health', '/ready', '/readyz', '/live', '/livez', '/status', '/ping',
]);

// Private/loopback IPs are always trusted (Railway internal network, localhost).
function isPrivateOrLoopback(ip: string): boolean {
  if (!ip) return false;
  if (ip === '::1' || ip.startsWith('::ffff:127.') || ip.startsWith('127.')) return true;
  if (ip.startsWith('10.') || ip.startsWith('192.168.')) return true;
  if (ip.startsWith('172.')) {
    const second = parseInt(ip.split('.')[1] || '0', 10);
    if (second >= 16 && second <= 31) return true;
  }
  if (ip.startsWith('fc') || ip.startsWith('fd')) return true; // IPv6 ULA
  if (ip.startsWith('fe80:')) return true; // IPv6 link-local
  return false;
}

let blockedCount = 0;
let bypassCount = 0;
let lastLoggedAt = 0;

function dropSocket(req: Request): void {
  try {
    req.socket?.destroy();
  } catch {
    // Socket already gone
  }
}

function maybeFlushLog(): void {
  const now = Date.now();
  if (now - lastLoggedAt > 60_000) {
    if (blockedCount > 0 || bypassCount > 0) {
      console.log(
        `🚫 GEO-BLOCK: ${blockedCount} blocked-country drops, ${bypassCount} CF-bypass drops in last window ` +
        `(blocked=${Array.from(BLOCKED_COUNTRIES).join(',')})`
      );
    }
    blockedCount = 0;
    bypassCount = 0;
    lastLoggedAt = now;
  }
}

export function geoBlockMiddleware(req: Request, res: Response, next: NextFunction): void {
  const cc = String(
    req.headers['cf-ipcountry'] ||
    req.headers['x-country-code'] ||
    ''
  ).toUpperCase();

  // 1. Block known bad countries
  if (BLOCKED_COUNTRIES.size > 0 && cc && BLOCKED_COUNTRIES.has(cc)) {
    blockedCount++;
    maybeFlushLog();
    dropSocket(req);
    return;
  }

  // 2. Optional CF bypass detection — OFF by default. When enabled, blocks
  //    requests to production hosts that arrive without cf-ipcountry.
  //    Always exempts: health-check paths, private/loopback source IPs
  //    (Railway internal network, container self-pings).
  if (ENFORCE_CF_ONLY && !cc) {
    const host = String(req.headers.host || '').toLowerCase().split(':')[0];
    const path = (req.path || req.url || '').split('?')[0];
    const srcIp = (req.ip || req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
    const isHealth = HEALTH_PATHS.has(path);
    const isInternal = isPrivateOrLoopback(srcIp);
    if (host && PROTECTED_HOSTS.has(host) && !isHealth && !isInternal) {
      bypassCount++;
      maybeFlushLog();
      dropSocket(req);
      return;
    }
  }

  // 3. Tell Cloudflare to vary cache by country, so SG/TH cannot be served
  //    a cached response that was originally generated for another country.
  //    Combined with a CF Cache Rule, this guarantees SG/TH always reach the
  //    origin (where the geo-block above will drop them).
  res.setHeader('Vary', appendVary(res.getHeader('Vary'), 'CF-IPCountry'));

  next();
}

function appendVary(existing: number | string | string[] | undefined, header: string): string {
  if (!existing) return header;
  const list = (Array.isArray(existing) ? existing.join(', ') : String(existing))
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  if (!list.some(h => h.toLowerCase() === header.toLowerCase())) list.push(header);
  return list.join(', ');
}

export function getBlockedCountries(): string[] {
  return Array.from(BLOCKED_COUNTRIES);
}

export function getProtectedHosts(): string[] {
  return Array.from(PROTECTED_HOSTS);
}
