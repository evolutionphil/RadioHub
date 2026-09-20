import type { Express, RequestHandler } from 'express';
import { pgUniqueVisitorMetrics } from '../data/postgres-visitor-metrics';

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
}
