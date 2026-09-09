import express, { type Express, type Request, type Response, type NextFunction, type RequestHandler, type ErrorRequestHandler } from 'express';
import { isDeepStrictEqual } from 'node:util';
import { pgCatalog } from '../data/postgres-catalog-store';
import { assertRecoverableStation, getStreamRecoverySnapshot, probeStationStream } from '../utils/station-health-recovery';
import { performanceCache } from '../performance-cache';
import CacheManager from '../cache';
import { getPostgresPool } from '../postgres-runtime';

const invalidBody: ErrorRequestHandler = (_error, _req, res, _next) => {
  res.status(400).json({ error: 'Invalid recovery request' });
};

export function registerAdminStreamHealthRoutes(app: Express, requireAdmin: RequestHandler): void {
  app.get('/api/admin/stream-health/status', requireAdmin, async (_req, res) => {
    res.set('Cache-Control','no-store');
    try {
      const query = { text:`SELECT c.last_run_at,c.next_run_at,c.summary,
        (SELECT count(*)::int FROM station_stream_health) tracked,
        (SELECT count(*)::int FROM station_stream_health WHERE next_check_at<=now()) due,
        (SELECT count(*)::int FROM stations WHERE last_check_ok IS NOT TRUE) hidden_from_lists
        FROM station_stream_health_control c WHERE c.id=1`, query_timeout:2000 };
      const result = await getPostgresPool().query(query);
      res.json({ enabled:process.env.STREAM_HEALTH_ENABLED!=='false' && process.env.BACKGROUND_JOBS_ENABLED!=='false',
        intervalSeconds:120,batchLimit:12,concurrency:2,sampleByteLimit:65_536,probeDeadlineMs:8000,
        healthyRecheckDays:7,failedRecheckHours:12,...result.rows[0] });
    } catch { res.status(503).json({error:'Health status is temporarily unavailable'}); }
  });
  app.post('/api/admin/stations/:id/recover-stream-health', requireAdmin,
    (_req: Request, res: Response, next: NextFunction) => { res.set('Cache-Control', 'no-store'); next(); },
    express.json({ limit: '32kb' }), async (req: Request, res: Response) => {
      const id = String(req.params.id), body = req.body;
      if (!/^[a-f0-9]{24}$/i.test(id) || !body || typeof body !== 'object' || Array.isArray(body) ||
          Object.keys(body).sort().join(',') !== 'confirmRecovery,expected' || body.confirmRecovery !== true ||
          !body.expected || typeof body.expected !== 'object' || Array.isArray(body.expected) ||
          Buffer.byteLength(JSON.stringify(body), 'utf8') > 32 * 1024) {
        return void res.status(400).json({ error: 'Invalid recovery request' });
      }
      let station;
      try { station = await pgCatalog().findById(id); }
      catch { return void res.status(503).json({ error: 'Station is temporarily unavailable' }); }
      if (!station) return void res.status(404).json({ error: 'Station not found' });
      if (!isDeepStrictEqual(getStreamRecoverySnapshot(station), body.expected)) {
        return void res.status(409).json({ error: 'Station changed; reload before recovering' });
      }
      let evidence;
      try {
        assertRecoverableStation(station);
        evidence = await probeStationStream(station.urlResolved || station.url);
      } catch { return void res.status(422).json({ error: 'Station recovery could not be verified' }); }
      let result;
      try { result = await pgCatalog().recoverStreamHealth(id, body.expected, evidence); }
      catch { return void res.status(503).json({ error: 'Recovery update is temporarily unavailable' }); }
      if (result.status === 'missing') return void res.status(404).json({ error: 'Station not found' });
      if (result.status === 'conflict') return void res.status(409).json({ error: 'Station changed; reload before recovering' });
      if (result.status === 'rejected') return void res.status(422).json({ error: 'Station recovery could not be verified' });
      const saved = result.station;
      const keys = [...new Set([saved._id, saved.slug, ...(saved.slugAliases || [])].filter(Boolean))];
      const cacheResults = await Promise.allSettled([
        Promise.resolve().then(() => performanceCache.invalidateStationCache(saved.slug)),
        ...keys.map(key => Promise.resolve().then(() => CacheManager.del(`station:detail:${key}`))),
        Promise.resolve().then(() => CacheManager.clearByPattern('admin_stations:')),
      ]);
      // The native transaction has committed. Cache failures must not invite a
      // duplicate mutation; other services' memory/CDN entries keep their TTL.
      const cacheInvalidated = cacheResults.every(result => result.status === 'fulfilled');
      res.json({ success: true, stationId: saved._id, slug: saved.slug, noIndex: saved.noIndex,
        lastCheckOk: saved.lastCheckOk, checkedAt: evidence.checkedAt, cacheInvalidated,
        ...(!cacheInvalidated ? { cacheWarning: 'Recovery committed; some cached views may refresh later' } : {}) });
    }, invalidBody);
}
