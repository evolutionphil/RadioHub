/**
 * Task #191 — Admin endpoints for the cached Google Search Console URL
 * Inspection results (see services/gsc-inspection.ts).
 *
 * Routes (mounted at /api/admin/gsc-inspection, all behind requireAdmin):
 *   GET  /status     — config + last-run summary
 *   GET  /stats      — counts by language / group / state
 *   GET  /urls       — paginated list of URLs with their cached state,
 *                      filterable by lang, group and state
 *   POST /refresh    — kick a manual inspection batch (subject to quota)
 *   POST /discover   — re-discover sitemap URLs from the active manifests
 */

import { Router, Request, Response } from 'express';
import { GscUrlInspection } from '@workspace/db-shared/mongo-schemas';
import { gscInspectionService, isGscConfigured } from '../services/gsc-inspection';
import { logger } from '../utils/logger';

const router = Router();

router.get('/status', async (_req: Request, res: Response) => {
  try {
    const status = gscInspectionService.getStatus();
    const total = await GscUrlInspection.estimatedDocumentCount();
    res.json({ ...status, totalUrls: total });
  } catch (err: any) {
    logger.error('GSC inspection /status failed:', err?.message ?? err);
    res.status(500).json({ error: 'failed to fetch status' });
  }
});

router.get('/stats', async (_req: Request, res: Response) => {
  try {
    const [byState, byGroup, byLanguage] = await Promise.all([
      GscUrlInspection.aggregate([
        { $group: { _id: '$state', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      GscUrlInspection.aggregate([
        {
          $group: {
            _id: '$group',
            total: { $sum: 1 },
            indexed: {
              $sum: { $cond: [{ $eq: ['$state', 'indexed'] }, 1, 0] },
            },
            crawledNotIndexed: {
              $sum: {
                $cond: [{ $eq: ['$state', 'crawled-not-indexed'] }, 1, 0],
              },
            },
            discoveredNotIndexed: {
              $sum: {
                $cond: [
                  { $eq: ['$state', 'discovered-not-indexed'] },
                  1,
                  0,
                ],
              },
            },
            excluded: {
              $sum: { $cond: [{ $eq: ['$state', 'excluded'] }, 1, 0] },
            },
            error: { $sum: { $cond: [{ $eq: ['$state', 'error'] }, 1, 0] } },
            pending: {
              $sum: { $cond: [{ $eq: ['$state', 'pending'] }, 1, 0] },
            },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      GscUrlInspection.aggregate([
        {
          $group: {
            _id: '$language',
            total: { $sum: 1 },
            indexed: {
              $sum: { $cond: [{ $eq: ['$state', 'indexed'] }, 1, 0] },
            },
          },
        },
        { $sort: { _id: 1 } },
      ]),
    ]);

    const total = byState.reduce(
      (sum: number, row: any) => sum + (row.count ?? 0),
      0,
    );

    res.json({
      total,
      byState: byState.map((r: any) => ({ state: r._id, count: r.count })),
      byGroup: byGroup.map((r: any) => ({
        group: r._id,
        total: r.total,
        indexed: r.indexed,
        crawledNotIndexed: r.crawledNotIndexed,
        discoveredNotIndexed: r.discoveredNotIndexed,
        excluded: r.excluded,
        error: r.error,
        pending: r.pending,
      })),
      byLanguage: byLanguage.map((r: any) => ({
        language: r._id,
        total: r.total,
        indexed: r.indexed,
      })),
    });
  } catch (err: any) {
    logger.error('GSC inspection /stats failed:', err?.message ?? err);
    res.status(500).json({ error: 'failed to fetch stats' });
  }
});

router.get('/urls', async (req: Request, res: Response) => {
  try {
    const language = String(req.query.language ?? 'all');
    const group = String(req.query.group ?? 'all');
    const state = String(req.query.state ?? 'all');
    const search = String(req.query.search ?? '').trim();
    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
    const limit = Math.max(
      1,
      Math.min(200, parseInt(String(req.query.limit ?? '50'), 10) || 50),
    );

    const filter: Record<string, unknown> = {};
    if (language && language !== 'all') filter.language = language;
    if (group && group !== 'all') filter.group = group;
    if (state && state !== 'all') filter.state = state;
    if (search) {
      // Anchored prefix search on url so Mongo can use the unique `url`
      // index instead of a collection scan. We deliberately drop the `i`
      // flag here because case-insensitive regex defeats the index;
      // sitemap URLs are lowercase by construction so this is safe.
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.url = { $regex: `^${escaped}` };
    }

    const [rows, total] = await Promise.all([
      GscUrlInspection.find(filter)
        .sort({ state: 1, language: 1, url: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      GscUrlInspection.countDocuments(filter),
    ]);

    res.json({
      rows,
      pagination: {
        page,
        limit,
        total,
        pages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (err: any) {
    logger.error('GSC inspection /urls failed:', err?.message ?? err);
    res.status(500).json({ error: 'failed to fetch urls' });
  }
});

router.post('/refresh', async (req: Request, res: Response) => {
  try {
    if (!isGscConfigured()) {
      return res.status(400).json({
        ok: false,
        error:
          'GSC is not configured. Set GSC_SERVICE_ACCOUNT_JSON and GSC_SITE_URL env vars.',
      });
    }
    const requested = parseInt(String(req.body?.batchSize ?? ''), 10);
    const batchSize =
      Number.isFinite(requested) && requested > 0 ? requested : undefined;
    const stats = await gscInspectionService.runInspectionBatchOnce(
      batchSize,
      'admin-manual',
    );
    return res.json({ ok: true, stats });
  } catch (err: any) {
    logger.error('GSC inspection /refresh failed:', err?.message ?? err);
    return res.status(500).json({ ok: false, error: err?.message ?? 'failed' });
  }
});

router.post('/discover', async (_req: Request, res: Response) => {
  try {
    const stats = await gscInspectionService.runDiscoveryOnce('admin-manual');
    return res.json({ ok: true, stats });
  } catch (err: any) {
    logger.error('GSC inspection /discover failed:', err?.message ?? err);
    return res.status(500).json({ ok: false, error: err?.message ?? 'failed' });
  }
});

export default router;
