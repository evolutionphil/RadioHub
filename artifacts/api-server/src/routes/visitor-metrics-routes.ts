import type { Express, RequestHandler } from 'express';
import { pgUniqueVisitorDetails, pgUniqueVisitorMetrics, type VisitorDetails, type VisitorDetailsQuery } from '../data/postgres-visitor-metrics';
import { normalizeVisitorCountry, VISITOR_PLATFORMS } from '../middleware/visitor-client-context';

// Separate from the expensive five-minute catalogue dashboard cache. This
// small cache never inherits the Redis-to-memory TTL extension of that path.
export function createVisitorMetricsHandler(read = pgUniqueVisitorMetrics, now = Date.now): RequestHandler {
  let cached: Awaited<ReturnType<typeof read>> | undefined;
  let expiresAt = 0;
  let pending: Promise<Awaited<ReturnType<typeof read>>> | undefined;
  return async (_req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    try {
      if (!cached || now() >= expiresAt) {
        if (!pending) pending = read().then(value => {
          cached = value; expiresAt = now() + 15_000; return value;
        }).finally(() => { pending = undefined; });
        await pending;
      }
      res.json(cached);
    } catch {
      // Do not turn an unavailable source into fabricated zeros or stale data.
      res.status(503).json({ error: 'Unique visitor metrics temporarily unavailable' });
    }
  };
}

export function registerVisitorMetricsRoutes(app: Express, requireAdmin: RequestHandler) {
  app.get('/api/admin/visitor-metrics', requireAdmin, createVisitorMetricsHandler());
  app.get('/api/admin/visitor-metrics/details', requireAdmin, createVisitorDetailsHandler());
}

const WINDOWS = new Set(['active', 'today', 'week']);
const PLATFORMS = new Set<string>(VISITOR_PLATFORMS);
const DEVICES = new Set(['desktop', 'mobile', 'tablet', 'tv', 'unknown']);
const QUERY_KEYS = new Set(['window', 'page', 'limit', 'country', 'platform', 'deviceType']);
const DETAILS_CACHE_LIMIT = 128;
const DETAILS_READ_LIMIT = 4;

function parseDetailsQuery(query: Record<string, unknown>): VisitorDetailsQuery | null {
  if (Object.keys(query).some(key => !QUERY_KEYS.has(key))) return null;
  if (Object.values(query).some(value => typeof value !== 'string')) return null;
  const window = query.window ?? 'active';
  const page = query.page ?? '1';
  const limit = query.limit ?? '25';
  if (!WINDOWS.has(window as string) || !/^[1-9]\d{0,5}$/.test(page as string)
      || !/^[1-9]\d{0,2}$/.test(limit as string) || Number(limit) > 100) return null;
  if (query.country !== undefined && query.country !== 'unknown'
      && (normalizeVisitorCountry(query.country) !== query.country)) return null;
  if (query.platform !== undefined && !PLATFORMS.has(query.platform as string)) return null;
  if (query.deviceType !== undefined && !DEVICES.has(query.deviceType as string)) return null;
  return { window, page: Number(page), limit: Number(limit),
    ...(query.country === undefined ? {} : { country: query.country }),
    ...(query.platform === undefined ? {} : { platform: query.platform }),
    ...(query.deviceType === undefined ? {} : { deviceType: query.deviceType }),
  } as VisitorDetailsQuery;
}

export function createVisitorDetailsHandler(read: (query: VisitorDetailsQuery) => Promise<VisitorDetails> = pgUniqueVisitorDetails,
  now = Date.now): RequestHandler {
  type Entry = { value?: VisitorDetails; expiresAt: number; pending?: Promise<VisitorDetails> };
  const cache = new Map<string, Entry>();
  let activeReads = 0;
  return async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    const options = parseDetailsQuery(req.query);
    if (!options) {
      res.status(400).json({ error: 'Invalid visitor details query' });
      return;
    }
    // Canonical parsed keys prevent equivalent default/explicit queries from
    // consuming separate entries; neither cache keys nor values contain raw IPs.
    const key = JSON.stringify(options);
    try {
      let entry = cache.get(key);
      if (!entry) {
        if (cache.size >= DETAILS_CACHE_LIMIT) {
          const evictable = [...cache].find(([, candidate]) => !candidate.pending);
          if (!evictable) throw new Error('Visitor details capacity reached');
          cache.delete(evictable[0]);
        }
        entry = { expiresAt: 0 };
        cache.set(key, entry);
      }
      if (!entry.value || now() >= entry.expiresAt) {
        if (!entry.pending) {
          if (activeReads >= DETAILS_READ_LIMIT) throw new Error('Visitor details read capacity reached');
          activeReads++;
          const current = entry;
          current.pending = Promise.resolve().then(() => read(options)).then(value => {
            current.value = value; current.expiresAt = now() + 15_000; return value;
          }).finally(() => { current.pending = undefined; activeReads--; });
        }
        await entry.pending;
      }
      res.json(entry.value);
    } catch {
      res.status(503).json({ error: 'Unique visitor details temporarily unavailable' });
    }
  };
}
