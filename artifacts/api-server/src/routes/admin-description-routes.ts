import type { Express } from 'express';
import express from 'express';
import { pgCatalog } from '../data/postgres-catalog-store';
import { parseStationDescriptionPatch } from '../utils/station-description-patch';
import { performanceCache } from '../performance-cache';
import CacheManager from '../cache';

export function registerAdminDescriptionRoutes(app: Express, requireAdmin: any): void {
  // Match IDs only, so existing /duplicates, /precomputed, etc. keep their routes.
  app.get(/^\/api\/admin\/stations\/([a-f0-9]{24})$/i, requireAdmin, async (req, res) => {
    try {
      const station = await pgCatalog().findById(String(req.params[0]));
      if (!station) return void res.status(404).json({ error: 'Station not found' });
      res.json(station);
    } catch { res.status(503).json({ error: 'Station is temporarily unavailable' }); }
  });
  app.patch('/api/admin/stations/:id/descriptions', requireAdmin, express.json({ limit: '1mb' }), async (req, res) => {
    if (!/^[a-f0-9]{24}$/i.test(String(req.params.id))) return void res.status(400).json({ error: 'Invalid station id' });
    let patch: ReturnType<typeof parseStationDescriptionPatch>;
    try { patch = parseStationDescriptionPatch(req.body); }
    catch (error) { return void res.status(400).json({ error: (error as Error).message }); }
    try {
      const result = await pgCatalog().patchDescriptions(String(req.params.id), patch.slug, patch.changes);
      if (result.status === 'missing') return void res.status(404).json({ error: 'Station not found' });
      if (result.status === 'conflict') return void res.status(409).json({ error: 'Station descriptions changed; reload before saving' });
      const station = result.station;
      let cacheInvalidated = true;
      try {
        performanceCache.invalidateStationCache(station.slug);
        for (const key of new Set([station._id, station.slug, ...(station.slugAliases || [])])) await CacheManager.del(`station:detail:${key}`);
        await CacheManager.clearByPattern('admin_stations:');
      } catch { cacheInvalidated = false; }
      // A cache problem must not misreport an already committed content edit as failed.
      res.json({ success: true, stationId: station._id, slug: station.slug, changedFields: patch.changes.map(change => `descriptions.${change.locale}.${change.field}`), descriptions: station.descriptions, cacheInvalidated });
    } catch { res.status(503).json({ error: 'Description update is temporarily unavailable' }); }
  });
}
