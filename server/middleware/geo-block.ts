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

const ENFORCE_CF_ONLY = process.env.ENFORCE_CF_ONLY !== 'false'; // default: ON

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

  // 2. Block direct-origin (CF bypass) attempts on protected hosts.
  //    Real visitors always traverse Cloudflare, which sets cf-ipcountry.
  //    A request to themegaradio.com WITHOUT cf-ipcountry is suspicious
  //    (someone resolved Railway IP and bypassed CF, possibly to evade WAF).
  if (ENFORCE_CF_ONLY && !cc) {
    const host = String(req.headers.host || '').toLowerCase().split(':')[0];
    if (host && PROTECTED_HOSTS.has(host)) {
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
