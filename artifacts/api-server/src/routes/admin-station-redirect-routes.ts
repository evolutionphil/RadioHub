import express, { type Express, type Request, type Response, type NextFunction, type RequestHandler, type ErrorRequestHandler } from 'express';
import { pgSetStationRedirect, type StationRedirectResult } from '../data/postgres-station-redirect';
import { performanceCache } from '../performance-cache';
import { publicStationCache } from '../public-station-cache';
import CacheManager from '../cache';

async function invalidateRedirectCaches(result: StationRedirectResult): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.allSettled([
        ...result.cacheKeys.map(key => Promise.resolve().then(() => performanceCache.invalidateStationCache(key))),
        ...result.cacheKeys.map(key => publicStationCache.del(`station:detail:visibility-v2:${key}`)),
        CacheManager.clearByPattern('admin_stations:'),
      ]).then(results => results.every(result => result.status === 'fulfilled')),
      new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), 1000); timer.unref(); }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}

const errors: Record<string, { status: number; message: string }> = {
  REDIRECT_SOURCE_MISSING: { status: 404, message: 'Station not found.' },
  REDIRECT_SOURCE_INVALID: { status: 409, message: 'Station metadata needs review before setting a redirect.' },
  REDIRECT_STALE: { status: 409, message: 'The redirect changed. Reload this station before saving.' },
  REDIRECT_TARGET_INVALID: { status: 422, message: 'Choose one different, indexable canonical station with no redirect.' },
  REDIRECT_TARGET_CONTENT: { status: 422, message: 'The canonical station needs full and meta descriptions in all 14 supported station languages.' },
  REDIRECT_NOT_DUPLICATE: { status: 422, message: 'The stations must have matching names and the exact same primary stream endpoint.' },
  REDIRECT_CHAIN: { status: 409, message: 'This station has incoming redirects or an ambiguous slug. Review those before adding a redirect.' },
  REDIRECT_BUSY: { status: 409, message: 'Catalogue maintenance is busy. Reload and retry shortly.' },
};
const invalidBody: ErrorRequestHandler = (_error, _req, res, _next) => {
  res.status(400).json({ error: 'Invalid station redirect request.' });
};
const validSlug = (value: unknown): value is string | null => value === null ||
  typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,199}$/.test(value);

export function registerAdminStationRedirectRoutes(app: Express, requireAdmin: RequestHandler, dependencies = {
  update: pgSetStationRedirect, invalidate: invalidateRedirectCaches,
}): void {
  app.put('/api/admin/stations/:id/redirect', requireAdmin,
    (_req: Request, res: Response, next: NextFunction) => { res.set('Cache-Control', 'private, no-store'); next(); },
    express.json({ limit: '2kb' }), async (req: Request, res: Response) => {
      const body = req.body, id = String(req.params.id);
      if (!/^[a-f0-9]{24}$/i.test(id) || Object.keys(req.query).length || !body || typeof body !== 'object' || Array.isArray(body) ||
          Object.keys(body).sort().join(',') !== 'expectedRedirectToSlug,targetSlug' ||
          !validSlug(body.targetSlug) || !validSlug(body.expectedRedirectToSlug)) {
        return void res.status(400).json({ error: 'Invalid station redirect request.' });
      }
      let result: StationRedirectResult;
      try {
        result = await dependencies.update({ id, targetSlug: body.targetSlug, expectedRedirectToSlug: body.expectedRedirectToSlug });
      } catch (error: any) {
        const known = errors[error?.code];
        return void res.status(known?.status || 503).json({ error: known?.message || 'Redirect update could not be confirmed. Reload the station before retrying.' });
      }
      // Committed changes remain successful even when cache refresh fails.
      let cacheInvalidated = false;
      try { cacheInvalidated = await dependencies.invalidate(result); } catch {}
      res.json({ success: true, stationId: result.stationId, slug: result.slug,
        redirectToSlug: result.redirectToSlug, changed: result.changed, cacheInvalidated,
        ...(!cacheInvalidated ? { warning: 'Redirect saved; server cache refresh is pending. Previously cached redirects may remain for 5 minutes.' } : {}),
      });
    }, invalidBody);
}
