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

let blockedCount = 0;
let lastLoggedAt = 0;

export function geoBlockMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (BLOCKED_COUNTRIES.size === 0) return next();

  const cc = String(
    req.headers['cf-ipcountry'] ||
    req.headers['x-country-code'] ||
    ''
  ).toUpperCase();

  if (!cc || !BLOCKED_COUNTRIES.has(cc)) return next();

  // Hard-drop the TCP socket — client sees a connection reset.
  // No HTTP response, no headers, minimal CPU/bandwidth cost.
  blockedCount++;
  const now = Date.now();
  if (now - lastLoggedAt > 60_000) {
    console.log(`🚫 GEO-BLOCK: dropped ${blockedCount} requests from ${Array.from(BLOCKED_COUNTRIES).join(',')} in last window`);
    blockedCount = 0;
    lastLoggedAt = now;
  }

  try {
    req.socket?.destroy();
  } catch {
    // Socket already gone — nothing to do
  }
  // Do NOT call next() — request is terminated.
}

export function getBlockedCountries(): string[] {
  return Array.from(BLOCKED_COUNTRIES);
}
