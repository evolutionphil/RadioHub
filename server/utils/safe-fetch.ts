import { promises as dns } from 'dns';
import net from 'net';

/**
 * SSRF guard. Validates an outbound URL before any fetch/request to prevent
 * the API server from being used as a proxy into the internal network
 * (cloud metadata, internal databases, intra-VPC services, etc).
 *
 * Rules:
 *  - Only http: and https: schemes
 *  - Only ports 80/443 (or explicit allowlist)
 *  - Resolve every A/AAAA record and reject if ANY is private/loopback/
 *    link-local/CGNAT/multicast/unspecified or matches well-known cloud
 *    metadata endpoints (169.254.169.254, fd00:ec2::254, etc).
 *
 * The resolver also returns the "pinned" IP — pass it to the request so
 * DNS rebinding can't swap the IP between validation and connect.
 */

export interface SafeUrlResult {
  ok: true;
  url: URL;
  pinnedIp: string;
  family: 4 | 6;
}
export interface SafeUrlError {
  ok: false;
  reason: string;
}
export type SafeUrlOutcome = SafeUrlResult | SafeUrlError;

const ALLOWED_PORTS = new Set([80, 443]);

const BLOCKED_HOSTNAMES = new Set([
  'localhost', 'localhost.localdomain', 'ip6-localhost', 'ip6-loopback',
  'metadata.google.internal', 'metadata',
]);

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => Number.isNaN(p) || p < 0 || p > 255)) return true;
  const [a, b] = parts;
  // 0.0.0.0/8 unspecified
  if (a === 0) return true;
  // 10.0.0.0/8
  if (a === 10) return true;
  // 100.64.0.0/10 CGNAT
  if (a === 100 && b >= 64 && b <= 127) return true;
  // 127.0.0.0/8 loopback
  if (a === 127) return true;
  // 169.254.0.0/16 link-local (incl. 169.254.169.254 cloud metadata)
  if (a === 169 && b === 254) return true;
  // 172.16.0.0/12
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.0.0.0/24, 192.0.2.0/24 docs
  if (a === 192 && b === 0) return true;
  // 192.168.0.0/16
  if (a === 192 && b === 168) return true;
  // 198.18.0.0/15 benchmarking
  if (a === 198 && (b === 18 || b === 19)) return true;
  // 198.51.100.0/24 docs
  if (a === 198 && b === 51) return true;
  // 203.0.113.0/24 docs
  if (a === 203 && b === 113) return true;
  // 224.0.0.0/4 multicast & 240.0.0.0/4 reserved
  if (a >= 224) return true;
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::' || lower === '::1') return true;
  // ::ffff:x.x.x.x — IPv4-mapped: re-check the embedded IPv4
  if (lower.startsWith('::ffff:')) {
    const rest = lower.slice(7);
    if (net.isIPv4(rest)) return isPrivateIPv4(rest);
  }
  // fc00::/7 unique-local, fe80::/10 link-local, ff00::/8 multicast
  if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true;
  if (/^fe[89ab][0-9a-f]:/.test(lower)) return true;
  if (lower.startsWith('ff')) return true;
  // Cloud metadata over IPv6
  if (lower.startsWith('fd00:ec2:')) return true;
  // 6to4 tunneling (2002::/16) — embeds IPv4 in bits 16-47, can reach internal
  // IPv4 space if a 6to4 gateway exists. Block defensively and inspect embedded v4.
  if (lower.startsWith('2002:')) {
    // 2002:AABB:CCDD:: → IPv4 = AA.BB.CC.DD
    const m = lower.match(/^2002:([0-9a-f]{1,4}):([0-9a-f]{1,4}):/);
    if (m) {
      const hex1 = m[1].padStart(4, '0');
      const hex2 = m[2].padStart(4, '0');
      const a = parseInt(hex1.slice(0, 2), 16);
      const b = parseInt(hex1.slice(2, 4), 16);
      const c = parseInt(hex2.slice(0, 2), 16);
      const d = parseInt(hex2.slice(2, 4), 16);
      if (isPrivateIPv4(`${a}.${b}.${c}.${d}`)) return true;
    }
    // Even with public embedded v4, 6to4 is exotic enough to refuse outright.
    return true;
  }
  // Teredo (2001:0::/32) — IPv4 over IPv6 tunneling, similar concern
  if (/^2001:0{0,3}:/.test(lower)) return true;
  return false;
}

export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) return isPrivateIPv4(ip);
  if (net.isIPv6(ip)) return isPrivateIPv6(ip);
  return true; // unknown family -> reject
}

export interface SafeUrlOptions {
  allowedProtocols?: Array<'http:' | 'https:'>;
  allowedPorts?: number[];
  /**
   * Alternative to `allowedPorts`. When provided (and `allowedPorts` is not),
   * every port EXCEPT those listed is accepted. Use this for radio/stream
   * proxies where legitimate hosts bind to thousands of non-standard ports
   * but we still want to block well-known internal-service ports (SSH,
   * DB, cache, etc). If both options are present, `allowedPorts` wins.
   */
  blockedPorts?: ReadonlySet<number>;
  allowHttp?: boolean;
}

export async function validateOutboundUrl(
  rawUrl: string,
  opts: SafeUrlOptions = {}
): Promise<SafeUrlOutcome> {
  let url: URL;
  try { url = new URL(rawUrl); } catch { return { ok: false, reason: 'invalid-url' }; }

  const allowedProtocols = opts.allowedProtocols || (opts.allowHttp ? ['http:', 'https:'] : ['https:', 'http:']);
  if (!allowedProtocols.includes(url.protocol as any)) {
    return { ok: false, reason: 'protocol-not-allowed' };
  }

  const port = url.port ? parseInt(url.port, 10) : (url.protocol === 'https:' ? 443 : 80);
  const portOk = opts.allowedPorts
    ? opts.allowedPorts.includes(port)
    : opts.blockedPorts
    ? !opts.blockedPorts.has(port)
    : ALLOWED_PORTS.has(port);
  if (!portOk) return { ok: false, reason: 'port-not-allowed' };

  const host = url.hostname.toLowerCase();
  if (!host) return { ok: false, reason: 'empty-host' };
  if (BLOCKED_HOSTNAMES.has(host)) return { ok: false, reason: 'blocked-hostname' };
  if (host.endsWith('.local') || host.endsWith('.internal')) {
    return { ok: false, reason: 'blocked-internal-tld' };
  }

  // If host is already a literal IP, validate it directly
  if (net.isIP(host)) {
    if (isPrivateIp(host)) return { ok: false, reason: 'private-ip-literal' };
    return { ok: true, url, pinnedIp: host, family: net.isIPv6(host) ? 6 : 4 };
  }

  // DNS resolve and reject if any answer is private. We pin the first public
  // IP so callers can dial it directly to defeat DNS rebinding between
  // validation and connect.
  let addrs: { address: string; family: number }[] = [];
  try {
    addrs = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    return { ok: false, reason: 'dns-lookup-failed' };
  }
  if (addrs.length === 0) return { ok: false, reason: 'no-dns-answer' };
  for (const a of addrs) {
    if (isPrivateIp(a.address)) {
      return { ok: false, reason: `private-ip-resolved:${a.address}` };
    }
  }
  const pinned = addrs[0];
  return { ok: true, url, pinnedIp: pinned.address, family: pinned.family === 6 ? 6 : 4 };
}

/**
 * Convenience wrapper around fetch() that runs the SSRF guard first.
 * NOTE: uses globalThis.fetch (Node 18+). DNS rebinding is mitigated for the
 * initial connect but cannot be enforced through the platform's https.Agent
 * here — for the strongest guarantee callers should use the pinnedIp value
 * with a custom https.Agent.
 */
export async function safeFetch(
  rawUrl: string,
  init: RequestInit = {},
  opts: SafeUrlOptions & { timeoutMs?: number; maxRedirects?: number } = {}
): Promise<Response> {
  const maxRedirects = opts.maxRedirects ?? 5;
  let currentUrl = rawUrl;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10_000);
  try {
    for (let hop = 0; hop <= maxRedirects; hop++) {
      const guarded = await validateOutboundUrl(currentUrl, opts);
      if (!guarded.ok) {
        throw new Error(`SSRF guard rejected URL: ${guarded.reason}`);
      }
      // Re-validate every redirect hop. A malicious origin could 302 us into
      // 169.254.169.254, localhost, etc.
      const merged: RequestInit = {
        ...init,
        signal: init.signal || controller.signal,
        redirect: 'manual',
      };
      const res = await fetch(guarded.url.toString(), merged);
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (!location) return res;
        if (hop === maxRedirects) {
          throw new Error('SSRF guard rejected URL: too-many-redirects');
        }
        // Resolve relative redirects against the current URL.
        try {
          currentUrl = new URL(location, guarded.url).toString();
        } catch {
          throw new Error('SSRF guard rejected URL: malformed-redirect-location');
        }
        // Drain the body so the underlying socket can be reused.
        try { await res.body?.cancel(); } catch {}
        continue;
      }
      return res;
    }
    // Should be unreachable.
    throw new Error('SSRF guard rejected URL: too-many-redirects');
  } finally {
    clearTimeout(timeout);
  }
}
