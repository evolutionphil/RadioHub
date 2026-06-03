/**
 * TV boot telemetry beacon.
 *
 * GET /api/tv/telemetry/open — public, no auth, CORS *
 *   ?src=remote|local   — CDN vs packaged fallback
 *   ?v=20260601160253   — running bundle version
 *   ?plat=tizen|webos|other
 *   ?app=1.0.2          — store package version
 *   ?did=<anon-id>      — anonymous device id (for unique TV count)
 *
 * Writes a daily aggregate row: { day, plat, src, v, count, uniqueDids }.
 * Never returns data — always 204.
 *
 * GET /api/admin/tv-telemetry — admin stats (last N days)
 */

import type { Express, Request, Response } from 'express';
import { TvTelemetryDaily } from '@workspace/db-shared/mongo-schemas';
import { logger } from '../utils/logger';

const SRC_VALUES  = new Set(['remote', 'local']);
const PLAT_VALUES = new Set(['tizen', 'webos', 'other']);
const VERSION_RE  = /^[0-9.]{1,20}$/;
const DID_RE      = /^[a-z0-9-]{8,64}$/;

function openCors(res: Response) {
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
  });
}

function toDay(d: Date): string {
  return d.toISOString().slice(0, 10); // "YYYY-MM-DD"
}

export function registerTvTelemetryRoutes(app: Express, deps: any) {
  const { requireAdmin } = deps;

  // OPTIONS preflight (TV WebViews / CORS)
  app.options('/api/tv/telemetry/open', (_req, res) => {
    openCors(res);
    res.sendStatus(204);
  });

  // ── Public beacon ─────────────────────────────────────────────────────────
  app.get('/api/tv/telemetry/open', async (req: Request, res: Response) => {
    openCors(res);
    // Reply immediately — client doesn't need to wait for the DB write.
    res.sendStatus(204);

    try {
      const q = req.query as Record<string, string>;

      // Whitelist / validate each param; silently drop invalid values.
      const src  = SRC_VALUES.has(q.src)   ? q.src  : 'remote';
      const plat = PLAT_VALUES.has(q.plat) ? q.plat : 'other';
      const v    = VERSION_RE.test(q.v ?? '')   ? q.v   : '';
      const did  = DID_RE.test(q.did ?? '')     ? q.did : null;

      // Optional: country from Cloudflare header (no raw IP stored).
      const country = typeof req.headers['cf-ipcountry'] === 'string'
        ? req.headers['cf-ipcountry'].toUpperCase()
        : undefined;

      const day = toDay(new Date());
      const id  = `${day}|${plat}|${src}|${v}`;

      const update: Record<string, any> = {
        $inc: { count: 1 },
        $set: { day, plat, src, v, updatedAt: new Date(), ...(country ? { country } : {}) },
      };
      if (did) update.$addToSet = { uniqueDids: did };

      await TvTelemetryDaily.findOneAndUpdate(
        { _id: id },
        update,
        { upsert: true },
      );
    } catch (err: any) {
      // Never let a telemetry write block the beacon response (already sent).
      logger.error('[tv-telemetry] write failed:', err?.message);
    }
  });

  // ── Admin stats ───────────────────────────────────────────────────────────
  app.get('/api/admin/tv-telemetry', requireAdmin, async (req: Request, res: Response) => {
    try {
      const days = Math.min(parseInt((req.query.days as string) || '7', 10), 90);
      const since = toDay(new Date(Date.now() - days * 86_400_000));

      const rows = await TvTelemetryDaily
        .find({ day: { $gte: since } })
        .sort({ day: -1 })
        .lean();

      // Summarise: per version × src, sum count + unique did count
      const byVersion: Record<string, { remote: number; local: number; uniqueTvs: Set<string> }> = {};
      for (const r of rows) {
        const key = r.v || '(unknown)';
        if (!byVersion[key]) byVersion[key] = { remote: 0, local: 0, uniqueTvs: new Set() };
        byVersion[key][r.src === 'local' ? 'local' : 'remote'] += r.count;
        for (const d of r.uniqueDids) byVersion[key].uniqueTvs.add(d);
      }

      const summary = Object.entries(byVersion)
        .map(([v, s]) => ({
          v,
          remote: s.remote,
          local: s.local,
          total: s.remote + s.local,
          uniqueTvs: s.uniqueTvs.size,
          localPct: s.remote + s.local > 0
            ? Math.round((s.local / (s.remote + s.local)) * 100)
            : 0,
        }))
        .sort((a, b) => b.total - a.total);

      res.json({ days, since, summary, rawRows: rows.length });
    } catch (err: any) {
      logger.error('[tv-telemetry] admin stats failed:', err?.message);
      res.status(500).json({ error: 'Failed to fetch telemetry stats' });
    }
  });
}
