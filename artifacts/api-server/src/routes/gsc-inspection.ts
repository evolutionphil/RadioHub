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
import { GscUrlInspection, GscIndexingSnapshot, GscOAuthToken, Station } from '@workspace/db-shared/mongo-schemas';
import {
  gscInspectionService,
  isGscConfigured,
  createOAuthClientFromEnv,
  invalidateOAuthCache,
} from '../services/gsc-inspection';
import { getCachedQualifiedLanguages } from '../seo/qualified-languages';
import { isNumericOnlySlug, isJunkStation } from '../seo/junk-station-rules';
import { logger } from '../utils/logger';

const router = Router();

/**
 * Compute the server-side noindex reason for a single URL.
 *
 * This mirrors the gate logic in seo-renderer.ts so the dashboard can show
 * WHY the server is sending noindex for any given URL — distinct from
 * Google's own verdict in `state`/`coverageState`.
 *
 * Returns the first matching reason in priority order. `null` means the
 * server is currently serving the URL as indexable.
 */
type ServerNoindexReason =
  | 'langIneligible'
  | 'stationNoIndex'
  | 'numericSlug'
  | 'junk'
  | null;

function extractStationSlugFromUrl(url: string): string | null {
  // URL shape: /<lang>/<translated-segment>/<station-slug>
  // We can't decode the translated segment without the URL_TRANSLATIONS map,
  // but the slug is always the final path component.
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    return parts[parts.length - 1] || null;
  } catch {
    return null;
  }
}

function computeServerNoindex(
  url: string,
  language: string,
  group: string,
  qualifiedLangs: Set<string>,
  stationBySlug: Map<string, { noIndex?: boolean; slug?: string; name?: string; url?: string; lastCheckOk?: boolean }>,
): { noindex: boolean; reason: ServerNoindexReason } {
  // Gate 1: language qualification (the 368-noindex root cause)
  if (!qualifiedLangs.has(language)) {
    return { noindex: true, reason: 'langIneligible' };
  }

  // Gate 2: station-specific checks (genres / countries / static are
  // currently always indexable when the language is qualified, so we only
  // check stations explicitly).
  if (group === 'station') {
    const slug = extractStationSlugFromUrl(url);
    if (slug && isNumericOnlySlug(slug)) {
      return { noindex: true, reason: 'numericSlug' };
    }
    const station = slug ? stationBySlug.get(slug) : undefined;
    if (station?.noIndex === true) {
      return { noindex: true, reason: 'stationNoIndex' };
    }
    if (station && isJunkStation(station)) {
      return { noindex: true, reason: 'junk' };
    }
  }

  return { noindex: false, reason: null };
}

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

    const noindexFilter = String(req.query.noindex ?? 'any');

    const [rawRows, total, qualifiedLangsArr] = await Promise.all([
      GscUrlInspection.find(filter)
        .sort({ state: 1, language: 1, url: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      GscUrlInspection.countDocuments(filter),
      getCachedQualifiedLanguages().catch(() => [] as string[]),
    ]);

    const qualifiedLangs = new Set(qualifiedLangsArr);

    // Batch-fetch stations for the URLs in this page so the per-URL noindex
    // computation doesn't fan out into N Mongo queries.
    const stationSlugs = Array.from(
      new Set(
        rawRows
          .filter((r: any) => r.group === 'station')
          .map((r: any) => extractStationSlugFromUrl(r.url))
          .filter((s): s is string => Boolean(s)),
      ),
    );
    const stations = stationSlugs.length
      ? await Station.find(
          { slug: { $in: stationSlugs } },
          { slug: 1, noIndex: 1, name: 1, url: 1, lastCheckOk: 1 },
        ).lean()
      : [];
    const stationBySlug = new Map<string, any>(
      stations.map((s: any) => [s.slug, s]),
    );

    let rows = rawRows.map((r: any) => ({
      ...r,
      serverNoindex: computeServerNoindex(
        r.url,
        r.language,
        r.group,
        qualifiedLangs,
        stationBySlug,
      ),
    }));

    // Optional noindex filter — applied AFTER computation. Note: filtering
    // here means `pagination.total` reflects pre-filter count (the DB-side
    // total). Documented in the response so the UI can warn.
    if (noindexFilter === 'noindex') {
      rows = rows.filter(r => r.serverNoindex.noindex);
    } else if (noindexFilter === 'indexable') {
      rows = rows.filter(r => !r.serverNoindex.noindex);
    }

    res.json({
      rows,
      pagination: {
        page,
        limit,
        total,
        pages: Math.max(1, Math.ceil(total / limit)),
      },
      qualifiedLanguages: qualifiedLangsArr,
      noindexFilterApplied: noindexFilter !== 'any',
    });
  } catch (err: any) {
    logger.error('GSC inspection /urls failed:', err?.message ?? err);
    res.status(500).json({ error: 'failed to fetch urls' });
  }
});

router.post('/refresh', async (req: Request, res: Response) => {
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

  // Fire-and-forget: batch inspections take 30-120 s for 50 URLs (20 s/URL
  // timeout). Awaiting synchronously would exceed Railway's 60 s HTTP
  // timeout → 502.  The frontend polls GET /status for lastInspectionStats.
  void gscInspectionService
    .runInspectionBatchOnce(batchSize, 'admin-manual')
    .catch((err: any) =>
      logger.error('GSC inspection /refresh failed:', err?.message ?? err),
    );

  return res.json({ ok: true, message: 'Inspection batch started — poll GET /status for results', running: true });
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

    // Compute which UTC days inside the requested window have no
    // snapshot row at all. The snapshot job always writes the
    // `language=all`/`group=all` overall row alongside every per-(lang,
    // group) row, so we count a day as "covered" iff at least one row
    // exists for it (regardless of the language/group filter the admin
    // picked — gaps mean the cron didn't run, not that the filter is
    // empty). We always check against an unfiltered query so a
    // language/group filter doesn't manufacture phantom gaps.
    const coveredDates = new Set<string>();
    if (language !== 'any' && group !== 'any' && (language !== 'all' || group !== 'all')) {
      const unfiltered = await GscIndexingSnapshot.find(
        { date: { $gte: since } },
        { date: 1 },
      ).lean();
      for (const r of unfiltered as any[]) {
        coveredDates.add(new Date(r.date).toISOString().slice(0, 10));
      }
    } else {
      for (const r of rows as any[]) {
        coveredDates.add(new Date(r.date).toISOString().slice(0, 10));
      }
    }
    // Today's snapshot is normally written by the 23:55 Berlin cron, so
    // until that runs we don't yet consider today "missing" — otherwise
    // every dashboard view before 23:55 would show today as a gap.
    const todayKey = new Date().toISOString().slice(0, 10);
    const missingDates: string[] = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(since);
      d.setUTCDate(d.getUTCDate() + i);
      const key = d.toISOString().slice(0, 10);
      if (key === todayKey) continue;
      if (!coveredDates.has(key)) missingDates.push(key);
    }

    res.json({
      days,
      language,
      group,
      missingDates,
      todayMissing: !coveredDates.has(todayKey),
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

/**
 * Task #360 — Manually prune snapshots older than the retention window.
 * The cron also fires nightly at 00:05 Berlin time; this endpoint exists
 * so admins can sanity-check the prune (or recover disk after lowering
 * `GSC_SNAPSHOT_RETENTION_DAYS`) without waiting for the next tick.
 */
router.post('/snapshot/prune', async (_req: Request, res: Response) => {
  try {
    const stats = await gscInspectionService.pruneOldSnapshots('admin-manual');
    return res.json({ ok: true, stats });
  } catch (err: any) {
    logger.error('GSC inspection /snapshot/prune failed:', err?.message ?? err);
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

/**
 * Server-side noindex breakdown — distinct from Google's verdict.
 *
 * For every URL in gscurlinspections we compute the server's current
 * indexability decision (via the same gates seo-renderer.ts uses) and
 * return aggregate counts by reason. This is the dashboard's primary
 * surface for tracking the 368-noindex incident: it tells you which URLs
 * the server is actively telling Google to skip vs. which Google is
 * choosing to skip on its own.
 *
 * Returned counts:
 *  - langIneligible: URL language not in qualifiedLanguages (the LKG gate)
 *  - stationNoIndex: station.noIndex === true
 *  - numericSlug: slug matches /^-?\d+$/ (frontend slug bug victims)
 *  - junk: station fails isJunkStation() (empty name, dead stream, …)
 *  - indexable: none of the above
 *
 * Heavy aggregation — uses Mongo aggregation for language counts, then
 * a single station lookup keyed by every station slug. Safe to call
 * read-only; takes ~1-2s on a 10k-URL collection.
 */
router.get('/noindex-breakdown', async (_req: Request, res: Response) => {
  try {
    const qualifiedLangsArr = await getCachedQualifiedLanguages().catch(
      () => [] as string[],
    );
    const qualifiedLangs = new Set(qualifiedLangsArr);

    // Per-language totals from gscurlinspections
    const byLangAgg = await GscUrlInspection.aggregate([
      {
        $group: {
          _id: { language: '$language', group: '$group' },
          count: { $sum: 1 },
        },
      },
    ]);

    let langIneligible = 0;
    let totalUrls = 0;
    const byLanguage: Record<string, { total: number; qualified: boolean; ineligible: number }> = {};

    for (const row of byLangAgg as Array<{ _id: { language: string; group: string }; count: number }>) {
      const lang = row._id.language;
      totalUrls += row.count;
      if (!byLanguage[lang]) {
        byLanguage[lang] = { total: 0, qualified: qualifiedLangs.has(lang), ineligible: 0 };
      }
      byLanguage[lang].total += row.count;
      if (!qualifiedLangs.has(lang)) {
        langIneligible += row.count;
        byLanguage[lang].ineligible += row.count;
      }
    }

    // For station-specific reasons (junk, numericSlug, stationNoIndex) we
    // need to look at every station URL. We aggregate the slugs from the
    // gscurlinspections then join against Station.
    const stationUrlSample = await GscUrlInspection.find(
      { group: 'station' },
      { url: 1, language: 1 },
    )
      .limit(50000)
      .lean();

    let numericSlugCount = 0;
    let stationNoIndexCount = 0;
    let junkCount = 0;
    const slugSet = new Set<string>();
    const slugToUrlInfo = new Map<string, { language: string; url: string }>();

    for (const row of stationUrlSample as any[]) {
      const slug = extractStationSlugFromUrl(row.url);
      if (!slug) continue;
      // Only count URLs whose language IS qualified — otherwise it's
      // already counted in langIneligible and we don't want double-counting.
      if (!qualifiedLangs.has(row.language)) continue;
      if (isNumericOnlySlug(slug)) {
        numericSlugCount++;
        continue;
      }
      slugSet.add(slug);
      if (!slugToUrlInfo.has(slug)) slugToUrlInfo.set(slug, row);
    }

    if (slugSet.size > 0) {
      const stations = await Station.find(
        { slug: { $in: Array.from(slugSet) } },
        { slug: 1, noIndex: 1, name: 1, url: 1, lastCheckOk: 1 },
      ).lean();
      const stationBySlug = new Map<string, any>(
        stations.map((s: any) => [s.slug, s]),
      );

      for (const slug of slugSet) {
        const st = stationBySlug.get(slug);
        if (!st) continue; // station missing — covered by sitemap drift, skip
        if (st.noIndex === true) stationNoIndexCount++;
        else if (isJunkStation(st)) junkCount++;
      }
    }

    const serverNoindexTotal =
      langIneligible + numericSlugCount + stationNoIndexCount + junkCount;
    const indexable = Math.max(0, totalUrls - serverNoindexTotal);

    res.json({
      total: totalUrls,
      breakdown: {
        langIneligible,
        numericSlug: numericSlugCount,
        stationNoIndex: stationNoIndexCount,
        junk: junkCount,
        indexable,
      },
      serverNoindexTotal,
      qualifiedLanguageCount: qualifiedLangsArr.length,
      totalLanguagesInCache: Object.keys(byLanguage).length,
      qualifiedLanguages: qualifiedLangsArr.sort(),
      byLanguage: Object.entries(byLanguage)
        .map(([language, info]) => ({ language, ...info }))
        .sort((a, b) => b.ineligible - a.ineligible || b.total - a.total),
      sampledStationUrls: stationUrlSample.length,
    });
  } catch (err: any) {
    logger.error(
      'GSC inspection /noindex-breakdown failed:',
      err?.message ?? err,
    );
    res.status(500).json({ error: 'failed to fetch noindex breakdown' });
  }
});

// ─── OAuth2 Routes ───────────────────────────────────────────────────────────

router.get('/oauth/status', async (_req: Request, res: Response) => {
  const hasEnvVars = Boolean(
    process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET,
  );
  const token = hasEnvVars
    ? await GscOAuthToken.findOne({}).sort({ createdAt: -1 }).lean()
    : null;
  res.json({
    hasEnvVars,
    connected: Boolean(token?.refreshToken),
    connectedAt: token?.createdAt ?? null,
    scope: token?.scope ?? null,
    connectedEmail: token?.connectedEmail ?? null,
  });
});

router.get('/oauth/init', (_req: Request, res: Response) => {
  const client = createOAuthClientFromEnv();
  if (!client) {
    return void res.status(400).json({
      error: 'GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET not set in Railway env vars',
    });
  }
  const redirectUri = `${process.env.API_BASE_URL ?? 'https://api.themegaradio.com'}/api/admin/gsc-inspection/oauth/callback`;
  const url = client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/webmasters.readonly'],
    redirect_uri: redirectUri,
    prompt: 'consent',
  });
  res.json({ url, redirectUri });
});

router.delete('/oauth/disconnect', async (_req: Request, res: Response) => {
  await GscOAuthToken.deleteMany({});
  invalidateOAuthCache();
  res.json({ message: 'OAuth token disconnected' });
});

/**
 * Handles the Google OAuth2 redirect after the user authorizes.
 * Exported separately so routes.ts can mount it WITHOUT requireAdmin
 * (Google sends a plain GET redirect — no auth headers possible).
 */
export async function handleOAuthCallback(req: Request, res: Response): Promise<void> {
  const { code, error } = req.query as { code?: string; error?: string };

  if (error) {
    res.redirect(`/admin/gsc-inspection?oauth_error=${encodeURIComponent(String(error))}`);
    return;
  }
  if (!code) {
    res.redirect('/admin/gsc-inspection?oauth_error=missing_code');
    return;
  }
  const client = createOAuthClientFromEnv();
  if (!client) {
    res.redirect('/admin/gsc-inspection?oauth_error=env_missing');
    return;
  }
  try {
    const redirectUri = `${process.env.API_BASE_URL ?? 'https://api.themegaradio.com'}/api/admin/gsc-inspection/oauth/callback`;
    const { tokens } = await client.getToken({ code, redirect_uri: redirectUri });
    if (!tokens.refresh_token) {
      res.redirect('/admin/gsc-inspection?oauth_error=no_refresh_token');
      return;
    }
    let connectedEmail: string | undefined;
    try {
      const infoClient = createOAuthClientFromEnv()!;
      infoClient.setCredentials(tokens);
      const tokenInfo = await infoClient.getTokenInfo(tokens.access_token!);
      connectedEmail = (tokenInfo as any).email ?? undefined;
    } catch { /* email is optional — don't fail the whole flow */ }
    await GscOAuthToken.deleteMany({});
    await GscOAuthToken.create({
      refreshToken: tokens.refresh_token,
      accessToken: tokens.access_token ?? undefined,
      expiryDate: tokens.expiry_date ?? undefined,
      scope: tokens.scope ?? 'https://www.googleapis.com/auth/webmasters.readonly',
      connectedEmail,
    });
    invalidateOAuthCache();
    res.redirect('/admin/gsc-inspection?oauth_success=1');
  } catch (err: any) {
    logger.error('GSC OAuth callback error:', err?.message ?? err);
    res.redirect(
      `/admin/gsc-inspection?oauth_error=${encodeURIComponent(err?.message ?? 'unknown')}`,
    );
  }
}

export default router;
