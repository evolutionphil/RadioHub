import { isIP } from 'node:net';
import type { Request, RequestHandler } from 'express';
import { logger } from '../utils/logger';
import { classifyVisitorContext, type VisitorContext } from './visitor-client-context';

const WRITE_INTERVAL_MS = 30_000;
const MAX_RECENT_IPS = 50_000;
const MAX_PENDING_WRITES = 128;

// The existing entrypoints keep their bot expressions private. This local
// analytics policy also excludes monitoring and scripted HTTP clients while
// retaining native app clients such as okhttp, Dalvik and CFNetwork.
const AUTOMATED_USER_AGENT = /bot|crawl|spider|slurp|baidu|yandex|duckduck|bingpreview|google-inspectiontool|google-extended|googleother|mediapartners-google|apis-google|facebookexternalhit|whatsapp|telegram|skype|seobility|semrush|ahrefs|majestic|screaming|nutch|genieo|demandbase|chatgpt-user|anthropic-ai|claude-web|perplexity-user|cohere-ai|meta-externalagent|chrome-lighthouse|headlesschrome|pingdom|uptime|healthcheck|health-check|curl\b|wget\b|python|node-fetch|undici|axios|go-http-client|^node$|^java\//i;
const ADMIN_PATH = /^\/(?:api\/)?admin(?:\/|$|-login(?:\/|$))/i;
const EXCLUDED_PATH = /^\/(?:api\/(?:auth|dashboard|analytics|internal|test|debug|logs|webhook|webhooks|sync|push|iap|health|healthz|stream|image|image-proxy|og-image)(?:\/|$)|(?:health|healthz|ready|readyz|live|livez|status|ping)(?:\/|$)|(?:assets|station-logos|station-images|uploads|node_modules|\.well-known)(?:\/|$)|(?:sitemap[^/]*|robots\.txt)(?:\/|$))/i;
const EXCLUDED_TV_PATH = /^\/api\/tv\/(?:telemetry|bundle|version)(?:\/|$)/i;
const STATIC_EXTENSION = /\.(?:avif|bmp|css|gif|ico|jpe?g|js|json|map|mjs|mp3|mp4|ogg|otf|png|svg|txt|wasm|wav|webm|webp|woff2?|xml|zip)$/i;

/** A canonical address is the identity; never use an arbitrary header string.
 * IPv4 and IPv4-mapped IPv6 must select the same database row. */
export function normalizeVisitorIp(candidate: unknown): string | null {
  if (typeof candidate !== 'string') return null;
  const address = candidate.trim();
  if (!address || address.length > 45 || address.includes('%')) return null;
  const version = isIP(address);
  if (version === 4) return address;
  if (version !== 6) return null;
  const canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  const mapped = /^::ffff:([\da-f]{1,4}):([\da-f]{1,4})$/.exec(canonical);
  if (!mapped) return canonical;
  const high = Number.parseInt(mapped[1], 16);
  const low = Number.parseInt(mapped[2], 16);
  return [high >> 8, high & 255, low >> 8, low & 255].join('.');
}

function isInternalIp(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
      || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  return address === '::' || address === '::1' || /^(?:f[cd]|fe[89ab]|ff)/i.test(address);
}

/** Deployment contract: the private Railway/web proxy hop must preserve only
 * edge-overwritten CF-Connecting-IP. A header alone cannot authenticate an
 * edge. Do not honor it on a public direct connection, or without Express
 * trusting the immediate proxy. Never select the first raw X-Forwarded-For
 * entry: Express resolves that chain according to the configured trust policy.
 * Header spoofing through an unprotected origin still requires ingress hardening;
 * these statistics are best-effort measurement, not an authentication boundary. */
function visitorAddress(req: Request): { ip: string; countryCode: unknown } | null {
  const remote = normalizeVisitorIp(req.socket?.remoteAddress);
  const trust = req.app?.get('trust proxy fn') as ((ip: string, hop: number) => boolean) | undefined;
  const privateTrustedProxy = remote && isInternalIp(remote)
    && typeof trust === 'function' && trust(req.socket.remoteAddress!, 0);
  const edge = privateTrustedProxy ? normalizeVisitorIp(req.headers['cf-connecting-ip']) : null;
  const address = edge ?? normalizeVisitorIp(req.ip) ?? remote;
  return address && !isInternalIp(address) ? {
    ip: address,
    // Never infer country from UI language, selected station country or an
    // unauthenticated direct-origin CF header. Missing edge data stays unknown.
    countryCode: edge && !isInternalIp(edge) ? req.headers['cf-ipcountry'] : null,
  } : null;
}

function adminRequest(req: Request): boolean {
  const session = req.session as typeof req.session & {
    adminAuth?: unknown; adminUser?: unknown; user?: { role?: string };
  };
  if (session?.adminAuth || session?.adminUser || session?.user?.role === 'admin'
    || (req.user as { role?: string } | undefined)?.role === 'admin') return true;
  const referer = req.get('referer');
  if (!referer) return false;
  try { return ADMIN_PATH.test(new URL(referer).pathname); } catch { return false; }
}

function eligibleRequest(req: Request): boolean {
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return false;
  const path = req.path;
  if (ADMIN_PATH.test(path) || EXCLUDED_PATH.test(path) || EXCLUDED_TV_PATH.test(path)
    || STATIC_EXTENSION.test(path) || adminRequest(req)) return false;
  const userAgent = req.get('user-agent');
  if (!userAgent || AUTOMATED_USER_AGENT.test(userAgent)) return false;
  if (/prefetch|prerender/i.test(`${req.get('purpose') || ''} ${req.get('sec-purpose') || ''}`)) return false;
  const destination = req.get('sec-fetch-dest');
  if (destination && !['empty', 'document', 'iframe'].includes(destination)) return false;
  return path.startsWith('/api/') || req.method === 'GET';
}

/** Mount after session/passport initialization. Route-level authentication may
 * populate req.user later, so inspect it again only after a successful response.
 * Writes start after finish and never delay next(), response delivery or errors.
 * The capped, process-local throttle coalesces tabs/API bursts in 30-second windows;
 * the database's unique canonical IP remains authoritative across processes. */
export function createUniqueVisitorTrackingMiddleware(track: (ip: string, context: VisitorContext) => Promise<void>): RequestHandler {
  const recent = new Map<string, { expiresAt: number; pending: boolean }>();
  let pendingWrites = 0;
  let lastWarningAt = Number.NEGATIVE_INFINITY;
  return (req, res, next) => {
    if (!eligibleRequest(req)) return next();
    const address = visitorAddress(req);
    if (!address) return next();
    const { ip, countryCode } = address;
    res.once('finish', () => {
      if (res.statusCode < 200 || res.statusCode >= 400 || adminRequest(req)) return;
      const contentType = String(res.getHeader('Content-Type') || '');
      if (contentType && !/^(?:application\/json|text\/html)(?:\s*;|$)/i.test(contentType)) return;
      const now = Date.now();
      const previous = recent.get(ip);
      if (previous && (previous.pending || previous.expiresAt > now)) return;
      if (pendingWrites >= MAX_PENDING_WRITES) return;
      if (previous) recent.delete(ip);
      // Insertion order follows admission time. Evict only expired completed
      // entries; at saturation drop measurements rather than grow memory/work.
      if (recent.size >= MAX_RECENT_IPS) {
        let inspected = 0;
        for (const [key, value] of recent) {
          if (!value.pending && value.expiresAt <= now) recent.delete(key);
          else if (value.pending) { recent.delete(key); recent.set(key, value); }
          else break;
          if (recent.size < MAX_RECENT_IPS) break;
          if (++inspected >= MAX_PENDING_WRITES) break;
        }
        if (recent.size >= MAX_RECENT_IPS) return;
      }
      // Calendar-aligned windows ensure a request after midnight can update
      // today's count even when this IP also visited just before midnight.
      const entry = { expiresAt: (Math.floor(now / WRITE_INTERVAL_MS) + 1) * WRITE_INTERVAL_MS, pending: true };
      recent.set(ip, entry);
      pendingWrites++;
      void Promise.resolve().then(() => track(ip, classifyVisitorContext({
        userAgent: req.headers['user-agent'], platformHeader: req.headers['x-megaradio-platform'], countryCode,
      }))).catch(() => {
        // Deliberately omit addresses and driver errors from request logs.
        // Keep the retry interval during outages to avoid a hot-path retry storm.
        if (Date.now() - lastWarningAt >= 60_000) {
          lastWarningAt = Date.now();
          logger.warn('Unique visitor measurement write failed; dashboard counts may be incomplete.');
        }
      }).finally(() => { entry.pending = false; pendingWrites--; });
    });
    next();
  };
}
