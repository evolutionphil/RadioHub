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
import { GscUrlInspection, GscIndexingSnapshot } from '@workspace/db-shared/mongo-schemas';
import { gscInspectionService, isGscConfigured } from '../services/gsc-inspection';
import { logger } from '../utils/logger';

const router = Router();

router.get('/status', async (_req: Request, res: Response) => {
  try {
    const status = gscInspectionService.getStatus();
    const stuckCutoff = new Date(
      Date.now() - status.resubmitStuckDays * 24 * 60 * 60 * 1000,
    );
    const [total, stuck] = await Promise.all([
      GscUrlInspection.estimatedDocumentCount(),
      GscUrlInspection.countDocuments({
        state: { $in: ['discovered-not-indexed', 'crawled-not-indexed'] },
        notIndexedSince: { $lte: stuckCutoff },
      }),
    ]);
    res.json({ ...status, totalUrls: total, stuckUrls: stuck });
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

router.post('/resubmit-stuck', async (_req: Request, res: Response) => {
  try {
    if (!isGscConfigured()) {
      return res.status(400).json({
        ok: false,
        error:
          'GSC is not configured. Set GSC_SERVICE_ACCOUNT_JSON and GSC_SITE_URL env vars.',
      });
    }
    const stats = await gscInspectionService.runResubmitStuckOnce(
      'admin-manual',
    );
    return res.json({ ok: true, stats });
  } catch (err: any) {
    logger.error(
      'GSC inspection /resubmit-stuck failed:',
      err?.message ?? err,
    );
    return res.status(500).json({ ok: false, error: err?.message ?? 'failed' });
  }
});


/**
 * Task #267 — Time-series trends.
 *
 * Returns one row per (date, language, group) over the requested window.
 * Default window is 30 days; max 365. The dashboard uses
 * `language=all&group=all` for the headline trend chart and lets admins
 * drill into any combination via the optional filters.
 */
router.get('/trends', async (req: Request, res: Response) => {
  try {
    const days = Math.max(
      1,
      Math.min(365, parseInt(String(req.query.days ?? '30'), 10) || 30),
    );
    const language = String(req.query.language ?? 'all');
    const group = String(req.query.group ?? 'all');

    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    since.setUTCDate(since.getUTCDate() - (days - 1));

    const filter: Record<string, unknown> = { date: { $gte: since } };
    if (language !== 'any') filter.language = language;
    if (group !== 'any') filter.group = group;

    const rows = await GscIndexingSnapshot.find(filter)
      .sort({ date: 1, language: 1, group: 1 })
      .lean();

    res.json({
      days,
      language,
      group,
      rows: rows.map((r: any) => ({
        date: r.date,
        language: r.language,
        group: r.group,
        total: r.total,
        indexed: r.indexed,
        crawledNotIndexed: r.crawledNotIndexed,
        discoveredNotIndexed: r.discoveredNotIndexed,
        excluded: r.excluded,
        error: r.error,
        pending: r.pending,
        unknown: r.unknown,
      })),
    });
  } catch (err: any) {
    logger.error('GSC inspection /trends failed:', err?.message ?? err);
    res.status(500).json({ error: 'failed to fetch trends' });
  }
});

/**
 * Task #267 — CSV export of the snapshot history. Optional filters mirror
 * /trends. Defaults to the last 90 days across every (language, group)
 * combination so admins can pivot in a spreadsheet.
 */
router.get('/history.csv', async (req: Request, res: Response) => {
  try {
    const days = Math.max(
      1,
      Math.min(365, parseInt(String(req.query.days ?? '90'), 10) || 90),
    );
    const language = String(req.query.language ?? 'any');
    const group = String(req.query.group ?? 'any');

    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    since.setUTCDate(since.getUTCDate() - (days - 1));

    const filter: Record<string, unknown> = { date: { $gte: since } };
    if (language !== 'any') filter.language = language;
    if (group !== 'any') filter.group = group;

    const rows = await GscIndexingSnapshot.find(filter)
      .sort({ date: 1, language: 1, group: 1 })
      .lean();

    const headers = [
      'date',
      'language',
      'group',
      'total',
      'indexed',
      'crawled_not_indexed',
      'discovered_not_indexed',
      'excluded',
      'error',
      'pending',
      'unknown',
    ];
    const escape = (v: unknown) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [headers.join(',')];
    for (const r of rows as any[]) {
      const dateStr = new Date(r.date).toISOString().slice(0, 10);
      lines.push(
        [
          dateStr,
          r.language,
          r.group,
          r.total,
          r.indexed,
          r.crawledNotIndexed,
          r.discoveredNotIndexed,
          r.excluded,
          r.error,
          r.pending,
          r.unknown,
        ]
          .map(escape)
          .join(','),
      );
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="gsc-indexing-history-${days}d.csv"`,
    );
    res.send(lines.join('\n'));
  } catch (err: any) {
    logger.error('GSC inspection /history.csv failed:', err?.message ?? err);
    res.status(500).json({ error: 'failed to export history' });
  }
});

/**
 * Task #267 — Manually record a daily aggregate snapshot. The cron also
 * fires nightly at 23:55 Berlin time, but admins can force one after a
 * big sitemap change to capture the impact immediately.
 */
router.post('/snapshot', async (_req: Request, res: Response) => {
  try {
    const stats = await gscInspectionService.recordDailySnapshot('admin-manual');
    return res.json({ ok: true, stats });
  } catch (err: any) {
    logger.error('GSC inspection /snapshot failed:', err?.message ?? err);
    return res.status(500).json({ ok: false, error: err?.message ?? 'failed' });
  }
});

/**
 * Task #355 — manually trigger the weekly stuck/resubmit digest email.
 * Useful for verifying the email channel without waiting for Monday.
 */
router.post('/digest', async (_req: Request, res: Response) => {
  try {
    const { scheduledStuckResubmitDigest } = await import(
      '../services/scheduled-stuck-resubmit-digest'
    );
    const result = await scheduledStuckResubmitDigest.runOnce(
      'manual:admin-api',
    );
    return res.json({
      ok: true,
      result,
      status: scheduledStuckResubmitDigest.getStatus(),
    });
  } catch (err: any) {
    logger.error('GSC inspection /digest failed:', err?.message ?? err);
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
