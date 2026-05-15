/**
 * Task #191 — Google Search Console URL Inspection cache.
 *
 * Background service that:
 *   1. Discovers every URL we publish in the active sitemap manifests
 *      (static main pages + top-30 country pages + genres + a sampled set
 *      of stations) and upserts a row per URL in `gscurlinspections`.
 *   2. Periodically rotates through those rows (oldest `lastInspectedAt`
 *      first) and calls the GSC URL Inspection API to refresh the cached
 *      indexing state.
 *
 * The GSC URL Inspection API has a hard quota of ~2000 requests/day per
 * site, so the cron rate is intentionally conservative (default 50 URLs
 * per hour ≈ 1200/day). Admins can also trigger a manual batch from the
 * UI via POST /api/admin/gsc-inspection/refresh.
 *
 * Configuration (env):
 *   GSC_SERVICE_ACCOUNT_JSON — service account JSON (full file contents).
 *     The service account must be added as a user with at least
 *     "Restricted" access on the verified Search Console property.
 *   GSC_SITE_URL              — Search Console property, e.g.
 *     "https://themegaradio.com/" (Domain properties: "sc-domain:themegaradio.com").
 *   GSC_INSPECTION_BATCH_SIZE — optional, default 50.
 *   ENABLE_GSC_INSPECTION_CRON=false — disables cron in non-leader
 *     replicas of split deployments.
 *
 * When the env vars are missing the service is fully inert: discovery
 * still populates the URL table (so the UI can display "pending" rows)
 * but no API calls are made. The status endpoint reports
 * `configured: false` so the admin UI can show a setup hint.
 */

import cron from 'node-cron';
import { JWT } from 'google-auth-library';
import axios from 'axios';
import {
  GscUrlInspection,
  GscIndexingSnapshot,
  Station,
  Genre,
  type IGscUrlInspection,
} from '@workspace/db-shared/mongo-schemas';
import { logger } from '../utils/logger';
import {
  getActiveManifest,
  extractTopCountriesFromChunk,
  buildAllSitemapManifests,
} from '../seo/sitemap-manifest-builder';
import { IndexNowService } from './indexnow';
import { performanceCache } from '../performance-cache';
import { URL_TRANSLATIONS } from '@workspace/seo-shared/url-translations';
import { buildLocalizedUrl } from '../seo/url-helpers';

const GSC_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const GSC_ENDPOINT =
  'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect';
const DEFAULT_BATCH_SIZE = parseInt(
  process.env.GSC_INSPECTION_BATCH_SIZE || '50',
  10,
);
// Hard cap on stations per language ONLY as a safety valve (e.g. catalogs
// with 100k+ stations). Defaults to 0 = no cap, i.e. discover every station
// URL that appears in the sitemap. Inspections themselves are still rate-
// limited per cron run (see DEFAULT_BATCH_SIZE) so quota is preserved —
// rows that haven't been hit yet simply show as "pending" in the UI.
const STATION_DISCOVERY_CAP_PER_LANG = parseInt(
  process.env.GSC_INSPECTION_STATION_CAP_PER_LANG || '0',
  10,
);
// When discovery hasn't found a URL recently, prune it. We keep this
// generous so a temporary sitemap blip doesn't wipe the cache.
const STALE_DISCOVERY_MS = 14 * 24 * 60 * 60 * 1000;

// Task #266 — auto-resubmit thresholds. A URL is considered "stuck" when
// it has been in a non-indexed state continuously for at least
// RESUBMIT_STUCK_DAYS. We won't re-ping the same URL more often than
// once every RESUBMIT_COOLDOWN_DAYS, and we cap how many URLs we pump
// through IndexNow per run so a backlog can't burn the whole quota in
// one cron tick.
const RESUBMIT_STUCK_DAYS = parseInt(
  process.env.GSC_RESUBMIT_STUCK_DAYS || '14',
  10,
);
const RESUBMIT_COOLDOWN_DAYS = parseInt(
  process.env.GSC_RESUBMIT_COOLDOWN_DAYS || '7',
  10,
);
const RESUBMIT_BATCH_LIMIT = parseInt(
  process.env.GSC_RESUBMIT_BATCH_LIMIT || '200',
  10,
);
// Task #360 — retention window for the daily aggregate snapshot rows.
// The collection grows by ~(languages × groups + 1) rows every day, so
// without a prune it would balloon to tens of thousands of documents
// over a few years. Default keeps ~2 years of history (matches the
// retention model used by the cleanup-history collection elsewhere).
// Override via `GSC_SNAPSHOT_RETENTION_DAYS`; set to `0` to disable
// pruning entirely (useful for tests or one-off historical analysis).
const SNAPSHOT_RETENTION_DAYS = Math.max(
  0,
  parseInt(process.env.GSC_SNAPSHOT_RETENTION_DAYS || '730', 10),
);
const NON_INDEXED_STATES: IGscUrlInspection['state'][] = [
  'discovered-not-indexed',
  'crawled-not-indexed',
];

type Group = IGscUrlInspection['group'];

interface UrlSpec {
  url: string;
  language: string;
  group: Group;
}

function getBaseUrl(): string {
  // CRITICAL SEO FIX: Always use themegaradio.com as the PRIMARY domain.
  // Mirrors getProductionDomain() in seo-sitemap-routes.ts.
  return 'https://themegaradio.com';
}

async function loadUrlTranslations(): Promise<Map<string, string>> {
  const dbTranslations = await performanceCache.getUrlTranslations();
  const merged = new Map<string, string>(dbTranslations);
  for (const [lang, translations] of Object.entries(URL_TRANSLATIONS)) {
    for (const [english, translated] of Object.entries(translations)) {
      const key = `${lang}:${english}`;
      if (!merged.has(key)) merged.set(key, translated);
    }
  }
  return merged;
}

const MAIN_STATIC_PAGES = [
  '',
  '/stations',
  '/genres',
  '/about',
  '/regions',
  '/regions/europe',
  '/regions/asia',
  '/regions/africa',
  '/regions/north-america',
  '/regions/south-america',
  '/regions/oceania',
  '/faq',
  '/contact',
  '/privacy-policy',
  '/terms-and-conditions',
  '/applications',
];

/**
 * Walk every active sitemap manifest and produce a unique list of
 * (url, language, group) tuples. For station URLs we sample per
 * language to stay within GSC's daily quota — the admin UI clearly
 * labels station results as "sampled".
 */
async function discoverSitemapUrls(): Promise<UrlSpec[]> {
  const baseUrl = getBaseUrl();
  const urlTranslations = await loadUrlTranslations();
  const out: UrlSpec[] = [];
  const seen = new Set<string>();

  const push = (url: string, language: string, group: Group) => {
    if (seen.has(url)) return;
    seen.add(url);
    out.push({ url, language, group });
  };

  // Pull the union of languages that have an active main manifest.
  const SitemapManifest = (await import('@workspace/db-shared/mongo-schemas'))
    .SitemapManifest;
  const manifests = await SitemapManifest.find(
    { type: 'main', status: 'active' },
    { language: 1 },
  ).lean();
  const languages = Array.from(
    new Set(manifests.map((m) => m.language).filter(Boolean)),
  );

  for (const lang of languages) {
    // 1. Static main pages
    for (const page of MAIN_STATIC_PAGES) {
      const path = buildLocalizedUrl(page, lang, undefined, urlTranslations);
      push(`${baseUrl}${path}`, lang, 'static');
    }

    // 2. Top-30 country pages (baked into chunks[0].stationIds of main manifest).
    const main = await getActiveManifest('main', lang);
    if (main && main.chunks.length > 0) {
      const topCountries = extractTopCountriesFromChunk(
        main.chunks[0].stationIds,
      );
      for (const { regionSlug, countrySlug: cSlug } of topCountries) {
        const enginePath = `/regions/${regionSlug}/${cSlug}`;
        const path = buildLocalizedUrl(
          enginePath,
          lang,
          undefined,
          urlTranslations,
        );
        push(`${baseUrl}${path}`, lang, 'country');
      }
    }

    // 3. Genres
    const genres = await getActiveManifest('genres', lang);
    if (genres) {
      const genreIds = genres.chunks.flatMap((c) => c.stationIds);
      const genreDocs =
        genreIds.length > 0
          ? await Genre.collection
              .find(
                { _id: { $in: genreIds as any[] } },
                { projection: { _id: 1, slug: 1 } },
              )
              .toArray()
          : [];
      const SAFE_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
      for (const g of genreDocs) {
        const slug = (g as any).slug;
        if (!slug || !SAFE_SLUG_RE.test(String(slug))) continue;
        const enginePath = `/genres/${slug}`;
        const path = buildLocalizedUrl(
          enginePath,
          lang,
          undefined,
          urlTranslations,
        );
        push(`${baseUrl}${path}`, lang, 'genre');
      }
    }

    // 4. Stations — discover EVERY station URL that appears in the active
    // sitemap, so the dashboard truthfully lists every sitemap URL. The
    // hourly inspection batch then rotates through them oldest-first, so
    // we still respect GSC's ~2000/day quota; un-inspected rows simply
    // show as "pending" in the UI until rotation reaches them.
    const stations = await getActiveManifest('stations', lang);
    if (stations) {
      const allIds = stations.chunks.flatMap((c) => c.stationIds);
      const slice =
        STATION_DISCOVERY_CAP_PER_LANG > 0
          ? allIds.slice(0, STATION_DISCOVERY_CAP_PER_LANG)
          : allIds;
      if (slice.length > 0) {
        const stationDocs = await Station.find({ _id: { $in: slice } })
          .select('_id slug')
          .lean();
        for (const s of stationDocs) {
          const slug = (s as any).slug;
          if (!slug) continue;
          const enginePath = `/station/${slug}`;
          const path = buildLocalizedUrl(
            enginePath,
            lang,
            undefined,
            urlTranslations,
          );
          push(`${baseUrl}${path}`, lang, 'station');
        }
      }
    }
  }

  return out;
}

/**
 * Replace the discovery snapshot in Mongo with the latest crawl. New URLs
 * are inserted as `pending`; existing URLs keep their previous inspection
 * state but get their `discoveredAt` bumped so we don't prune them.
 */
async function syncDiscoveredUrls(specs: UrlSpec[]): Promise<{
  inserted: number;
  refreshed: number;
  pruned: number;
}> {
  const now = new Date();
  let inserted = 0;
  let refreshed = 0;

  // Bulk upsert in batches of 1000 to keep round-trips bounded.
  const CHUNK = 1000;
  for (let i = 0; i < specs.length; i += CHUNK) {
    const slice = specs.slice(i, i + CHUNK);
    const ops = slice.map((spec) => ({
      updateOne: {
        filter: { url: spec.url },
        update: {
          $set: {
            language: spec.language,
            group: spec.group,
            discoveredAt: now,
            updatedAt: now,
          },
          $setOnInsert: {
            state: 'pending' as const,
            errorCount: 0,
          },
        },
        upsert: true,
      },
    }));
    const res = await GscUrlInspection.bulkWrite(ops, { ordered: false });
    inserted += res.upsertedCount ?? 0;
    refreshed += res.modifiedCount ?? 0;
  }

  // Prune URLs that haven't been re-discovered for a while (sitemap
  // dropped them — e.g. station deleted, country fell out of top-30).
  const cutoff = new Date(now.getTime() - STALE_DISCOVERY_MS);
  const pruneRes = await GscUrlInspection.deleteMany({
    discoveredAt: { $lt: cutoff },
  });
  return { inserted, refreshed, pruned: pruneRes.deletedCount ?? 0 };
}

/**
 * Map GSC's free-form coverage strings into a small enum the UI can
 * filter on. The coverage labels themselves come from
 * https://developers.google.com/search/docs/crawling-indexing/url-inspection
 * (English only — GSC returns localized strings, but the underlying
 * verdict + indexingState pair is stable).
 */
function classifyState(payload: any): IGscUrlInspection['state'] {
  const idx = payload?.inspectionResult?.indexStatusResult ?? {};
  const verdict: string = idx.verdict ?? '';
  const coverage: string = idx.coverageState ?? '';
  const indexingState: string = idx.indexingState ?? '';
  const lower = coverage.toLowerCase();

  // PRIMARY: parse the coverageState first. The GSC verdict (`PASS` /
  // `NEUTRAL` / `FAIL` / `PARTIAL`) is too coarse — both "Crawled - not
  // indexed" and "Discovered - not indexed" come back as `NEUTRAL`, so
  // collapsing on verdict would hide exactly the buckets this dashboard
  // exists to surface. coverageState is stable English even when the GSC
  // UI is localized (per Search Console API docs).
  if (lower.includes('discovered') && lower.includes('not indexed')) {
    return 'discovered-not-indexed';
  }
  if (lower.includes('crawled') && lower.includes('not indexed')) {
    return 'crawled-not-indexed';
  }
  if (lower.includes('submitted and indexed') || lower === 'indexed') {
    return 'indexed';
  }
  if (lower.includes('alternate page') || lower.includes('duplicate')) {
    return 'excluded';
  }
  if (
    lower.includes('excluded') ||
    lower.includes('redirect') ||
    lower.includes('noindex') ||
    lower.includes('blocked')
  ) {
    return 'excluded';
  }

  // SECONDARY: indexingState (`INDEXING_ALLOWED` /
  // `BLOCKED_BY_META_TAG` / `BLOCKED_BY_HTTP_HEADER` / `BLOCKED_BY_ROBOTS_TXT`).
  if (
    indexingState === 'BLOCKED_BY_META_TAG' ||
    indexingState === 'BLOCKED_BY_HTTP_HEADER' ||
    indexingState === 'BLOCKED_BY_ROBOTS_TXT'
  ) {
    return 'excluded';
  }

  // TERTIARY: fall back to verdict only when nothing else matched.
  if (verdict === 'PASS' || verdict === 'PARTIAL') return 'indexed';
  if (verdict === 'FAIL') return 'excluded';
  // NEUTRAL with no recognizable coverage string — genuinely unknown.
  return 'unknown';
}

let cachedJwt: JWT | null = null;
function getJwt(): JWT | null {
  const raw = process.env.GSC_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  if (cachedJwt) return cachedJwt;
  try {
    const parsed = JSON.parse(raw);
    cachedJwt = new JWT({
      email: parsed.client_email,
      key: parsed.private_key,
      scopes: [GSC_SCOPE],
    });
    return cachedJwt;
  } catch (err: any) {
    logger.error(
      '❌ GSC inspection: GSC_SERVICE_ACCOUNT_JSON is not valid JSON:',
      err?.message ?? err,
    );
    return null;
  }
}

export function isGscConfigured(): boolean {
  return Boolean(
    process.env.GSC_SERVICE_ACCOUNT_JSON && process.env.GSC_SITE_URL,
  );
}

async function inspectUrl(
  url: string,
  jwt: JWT,
  siteUrl: string,
): Promise<{ ok: true; payload: any } | { ok: false; error: string }> {
  try {
    const accessToken = await jwt.getAccessToken();
    if (!accessToken.token) {
      return { ok: false, error: 'no access token returned by JWT client' };
    }
    const resp = await axios.post(
      GSC_ENDPOINT,
      {
        inspectionUrl: url,
        siteUrl,
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken.token}`,
          'Content-Type': 'application/json',
        },
        timeout: 20_000,
        validateStatus: () => true,
      },
    );
    if (resp.status !== 200) {
      const msg =
        typeof resp.data === 'string'
          ? resp.data
          : JSON.stringify(resp.data ?? {});
      return { ok: false, error: `HTTP ${resp.status}: ${msg.slice(0, 500)}` };
    }
    return { ok: true, payload: resp.data };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? 'unknown error' };
  }
}

class GscInspectionService {
  private static instance: GscInspectionService;
  private discoveryRunning = false;
  private inspectionRunning = false;
  private resubmitRunning = false;
  private isInitialized = false;
  private lastDiscoveryAt: Date | null = null;
  private lastInspectionAt: Date | null = null;
  private lastResubmitAt: Date | null = null;
  private lastDiscoveryStats: {
    inserted: number;
    refreshed: number;
    pruned: number;
    discovered: number;
  } | null = null;
  private lastInspectionStats: {
    attempted: number;
    succeeded: number;
    failed: number;
  } | null = null;
  private lastResubmitStats: {
    attempted: number;
    succeeded: number;
    failed: number;
    sitemapRebuilt: boolean;
  } | null = null;
  private snapshotRunning = false;
  private lastSnapshotAt: Date | null = null;
  private lastSnapshotStats: { rows: number; date: string } | null = null;
  private snapshotPruneRunning = false;
  private lastSnapshotPruneAt: Date | null = null;
  private lastSnapshotPruneStats: {
    deleted: number;
    olderThan: string;
  } | null = null;

  static getInstance(): GscInspectionService {
    if (!GscInspectionService.instance) {
      GscInspectionService.instance = new GscInspectionService();
    }
    return GscInspectionService.instance;
  }

  initialize(): void {
    if (this.isInitialized) return;
    if (process.env.ENABLE_GSC_INSPECTION_CRON === 'false') {
      this.isInitialized = true;
      logger.log(
        '🔍 GSC inspection cron DISABLED (ENABLE_GSC_INSPECTION_CRON=false)',
      );
      return;
    }
    this.isInitialized = true;

    // Discovery: every 12h. Cheap (Mongo-only).
    cron.schedule(
      '15 3,15 * * *',
      () => {
        this.runDiscoveryOnce('cron').catch((err) =>
          logger.error('❌ GSC discovery cron crashed:', err),
        );
      },
      { timezone: 'Europe/Berlin' },
    );

    // Inspection: every hour at :07.
    cron.schedule(
      '7 * * * *',
      () => {
        this.runInspectionBatchOnce(DEFAULT_BATCH_SIZE, 'cron').catch(
          (err) => logger.error('❌ GSC inspection cron crashed:', err),
        );
      },
      { timezone: 'Europe/Berlin' },
    );

    // Task #266 — auto-resubmit stuck URLs once a day at 04:30 Berlin time.
    // Runs after the 03:15 discovery so the freshest discovery snapshot is
    // already in place before we re-ping IndexNow.
    cron.schedule(
      '30 4 * * *',
      () => {
        this.runResubmitStuckOnce('cron').catch((err) =>
          logger.error('❌ GSC resubmit cron crashed:', err),
        );
      },
      { timezone: 'Europe/Berlin' },
    );

    // Task #267 — daily aggregate snapshot: 23:55 Berlin time. Idempotent
    // — re-running the same UTC day overwrites the previous row via
    // $set/upsert, so an accidental double-trigger is harmless.
    cron.schedule(
      '55 23 * * *',
      () => {
        this.recordDailySnapshot('cron').catch((err) =>
          logger.error('❌ GSC snapshot cron crashed:', err),
        );
      },
      { timezone: 'Europe/Berlin' },
    );

    // Task #360 — prune snapshots older than the retention window once a
    // day, just after the daily roll-up at 23:55. Cheap (single
    // deleteMany on an indexed `date` field) and idempotent. Skipped
    // entirely when retention is disabled (`SNAPSHOT_RETENTION_DAYS=0`).
    if (SNAPSHOT_RETENTION_DAYS > 0) {
      cron.schedule(
        '5 0 * * *',
        () => {
          this.pruneOldSnapshots('cron').catch((err) =>
            logger.error('❌ GSC snapshot prune cron crashed:', err),
          );
        },
        { timezone: 'Europe/Berlin' },
      );
    }

    logger.log(
      `🔍 GSC inspection cron initialized (discovery 03:15+15:15, inspection hourly :07, resubmit 04:30, snapshot 23:55, prune 00:05 keep=${SNAPSHOT_RETENTION_DAYS}d, batch=${DEFAULT_BATCH_SIZE}/run, stuck>${RESUBMIT_STUCK_DAYS}d)`,
    );

    // Cold-start: kick off a discovery shortly after boot so a freshly
    // deployed environment doesn't show an empty dashboard until the
    // next 03:15/15:15 cron tick. Delayed slightly so it doesn't fight
    // the boot sequence for Mongo connections.
    setTimeout(() => {
      this.runDiscoveryOnce('boot').catch((err) => {
        // INCIDENT 2026-05-15 v10.1 — downgrade noisy boot timeout to warn.
        // GSC discovery boot is non-critical (the 03:15/15:15 cron will
        // retry); a cold-cluster MongoNetworkTimeoutError here is an
        // expected condition during M10 cold-start, not a 5xx event.
        const msg = err?.message || String(err);
        const isNetTimeout = /MongoNetworkTimeoutError|timed out|MaxTimeMSExpired/i.test(msg);
        if (isNetTimeout) {
          logger.warn(`⚠️ GSC discovery boot skipped (cluster cold): ${msg}`);
        } else {
          logger.error('❌ GSC discovery boot crashed:', err);
        }
      });
      // Task #266 — one-shot backfill for legacy rows. Any URL that's
      // already in a non-indexed bucket but is missing `notIndexedSince`
      // (because the field didn't exist before this task) gets anchored
      // to its `lastInspectedAt` (or `updatedAt`) so the existing stuck
      // backlog is immediately eligible for the resubmit cron. This is
      // idempotent — the filter excludes rows that already have a value.
      this.backfillNotIndexedSince().catch((err) =>
        logger.error('❌ GSC notIndexedSince backfill crashed:', err),
      );
    }, 30_000);
  }

  /**
   * One-shot migration so URLs that were already stuck in a non-indexed
   * state when task #266 shipped become resubmit-eligible without
   * waiting for the slow inspection rotation to revisit each one.
   */
  private async backfillNotIndexedSince(): Promise<void> {
    // ARCHITECT FIX (2026-05-10): Mongoose ≥8 refuses array (aggregation
    // pipeline) updates unless `updatePipeline: true` is set explicitly,
    // throwing `MongooseError: Cannot pass an array to query updates unless
    // the updatePipeline option is set.` Adding the flag re-enables the
    // legacy pipeline form so this one-shot backfill stops crashing on
    // every cold boot in production.
    const res = await GscUrlInspection.updateMany(
      {
        state: { $in: NON_INDEXED_STATES },
        notIndexedSince: { $exists: false },
      },
      [
        {
          $set: {
            notIndexedSince: {
              $ifNull: ['$lastInspectedAt', { $ifNull: ['$updatedAt', '$$NOW'] }],
            },
          },
        },
      ] as any,
      { updatePipeline: true } as any,
    );
    if ((res.modifiedCount ?? 0) > 0) {
      logger.log(
        `🔁 GSC backfill: anchored notIndexedSince on ${res.modifiedCount} legacy non-indexed rows`,
      );
    }
  }

  getStatus() {
    return {
      configured: isGscConfigured(),
      cronEnabled: process.env.ENABLE_GSC_INSPECTION_CRON !== 'false',
      siteUrl: process.env.GSC_SITE_URL ?? null,
      discoveryRunning: this.discoveryRunning,
      inspectionRunning: this.inspectionRunning,
      resubmitRunning: this.resubmitRunning,
      lastDiscoveryAt: this.lastDiscoveryAt,
      lastInspectionAt: this.lastInspectionAt,
      lastResubmitAt: this.lastResubmitAt,
      lastDiscoveryStats: this.lastDiscoveryStats,
      lastInspectionStats: this.lastInspectionStats,
      lastResubmitStats: this.lastResubmitStats,
      lastSnapshotAt: this.lastSnapshotAt,
      lastSnapshotStats: this.lastSnapshotStats,
      lastSnapshotPruneAt: this.lastSnapshotPruneAt,
      lastSnapshotPruneStats: this.lastSnapshotPruneStats,
      defaultBatchSize: DEFAULT_BATCH_SIZE,
      stationDiscoveryCapPerLanguage: STATION_DISCOVERY_CAP_PER_LANG,
      resubmitStuckDays: RESUBMIT_STUCK_DAYS,
      resubmitCooldownDays: RESUBMIT_COOLDOWN_DAYS,
      resubmitBatchLimit: RESUBMIT_BATCH_LIMIT,
      snapshotRetentionDays: SNAPSHOT_RETENTION_DAYS,
    };
  }

  /**
   * Task #360 — drop snapshot rows older than the retention window so
   * the `GscIndexingSnapshot` collection doesn't grow unbounded. Safe
   * to call concurrently (guarded) and idempotent: re-running deletes
   * nothing once everything in-window has already been pruned.
   * Returns `null` when retention is disabled or a prune is already in
   * progress.
   */
  async pruneOldSnapshots(
    trigger: string = 'manual',
  ): Promise<{ deleted: number; olderThan: string } | null> {
    if (SNAPSHOT_RETENTION_DAYS <= 0) {
      logger.log(
        `🧹 GSC snapshot prune: skip (${trigger}) — retention disabled`,
      );
      return null;
    }
    if (this.snapshotPruneRunning) {
      logger.log(
        `⏭️  GSC snapshot prune: skip (${trigger}) — previous run in progress`,
      );
      return null;
    }
    this.snapshotPruneRunning = true;
    try {
      const cutoff = new Date(
        Date.now() - SNAPSHOT_RETENTION_DAYS * 24 * 60 * 60 * 1000,
      );
      const res = await GscIndexingSnapshot.deleteMany({
        date: { $lt: cutoff },
      });
      const stats = {
        deleted: res.deletedCount ?? 0,
        olderThan: cutoff.toISOString(),
      };
      this.lastSnapshotPruneAt = new Date();
      this.lastSnapshotPruneStats = stats;
      if (stats.deleted > 0) {
        logger.log(
          `🧹 GSC snapshot prune (${trigger}): removed ${stats.deleted} rows older than ${stats.olderThan} (retention=${SNAPSHOT_RETENTION_DAYS}d)`,
        );
      }
      return stats;
    } finally {
      this.snapshotPruneRunning = false;
    }
  }

  /**
   * Roll up the current per-URL inspection state into one row per
   * (UTC day, language, group) plus an `all`/`all` cross-cutting row.
   * Idempotent for the same UTC day, so a manual trigger after the cron
   * just overwrites the day's numbers with the latest counts.
   */
  async recordDailySnapshot(
    trigger: string = 'manual',
  ): Promise<{ rows: number; date: string } | null> {
    if (this.snapshotRunning) {
      logger.log(
        `⏭️  GSC snapshot: skip (${trigger}) — previous run in progress`,
      );
      return null;
    }
    this.snapshotRunning = true;
    const start = Date.now();
    try {
      // Anchor the date at UTC midnight of "today" so the unique
      // (date, language, group) index makes the upsert idempotent
      // regardless of run time during the day.
      const now = new Date();
      const date = new Date(
        Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth(),
          now.getUTCDate(),
        ),
      );

      // Per (language, group)
      const perGroup = await GscUrlInspection.aggregate<{
        _id: { language: string; group: IGscUrlInspection['group'] };
        total: number;
        indexed: number;
        crawledNotIndexed: number;
        discoveredNotIndexed: number;
        excluded: number;
        error: number;
        pending: number;
        unknown: number;
      }>([
        {
          $group: {
            _id: { language: '$language', group: '$group' },
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
            unknown: {
              $sum: { $cond: [{ $eq: ['$state', 'unknown'] }, 1, 0] },
            },
          },
        },
      ]);

      type Row = {
        date: Date;
        language: string;
        group: IGscUrlInspection['group'] | 'all';
        total: number;
        indexed: number;
        crawledNotIndexed: number;
        discoveredNotIndexed: number;
        excluded: number;
        error: number;
        pending: number;
        unknown: number;
      };

      const rows: Row[] = [];
      // language -> aggregated row
      const perLang = new Map<string, Row>();
      // group -> aggregated row
      const perGrp = new Map<string, Row>();
      const overall: Row = {
        date,
        language: 'all',
        group: 'all',
        total: 0,
        indexed: 0,
        crawledNotIndexed: 0,
        discoveredNotIndexed: 0,
        excluded: 0,
        error: 0,
        pending: 0,
        unknown: 0,
      };

      const addInto = (target: Row, src: Row) => {
        target.total += src.total;
        target.indexed += src.indexed;
        target.crawledNotIndexed += src.crawledNotIndexed;
        target.discoveredNotIndexed += src.discoveredNotIndexed;
        target.excluded += src.excluded;
        target.error += src.error;
        target.pending += src.pending;
        target.unknown += src.unknown;
      };

      for (const r of perGroup) {
        const row: Row = {
          date,
          language: r._id.language,
          group: r._id.group,
          total: r.total,
          indexed: r.indexed,
          crawledNotIndexed: r.crawledNotIndexed,
          discoveredNotIndexed: r.discoveredNotIndexed,
          excluded: r.excluded,
          error: r.error,
          pending: r.pending,
          unknown: r.unknown,
        };
        rows.push(row);

        const langKey = row.language;
        if (!perLang.has(langKey)) {
          perLang.set(langKey, {
            date,
            language: langKey,
            group: 'all',
            total: 0,
            indexed: 0,
            crawledNotIndexed: 0,
            discoveredNotIndexed: 0,
            excluded: 0,
            error: 0,
            pending: 0,
            unknown: 0,
          });
        }
        addInto(perLang.get(langKey)!, row);

        const grpKey = String(row.group);
        if (!perGrp.has(grpKey)) {
          perGrp.set(grpKey, {
            date,
            language: 'all',
            group: row.group,
            total: 0,
            indexed: 0,
            crawledNotIndexed: 0,
            discoveredNotIndexed: 0,
            excluded: 0,
            error: 0,
            pending: 0,
            unknown: 0,
          });
        }
        addInto(perGrp.get(grpKey)!, row);

        addInto(overall, row);
      }

      rows.push(...perLang.values(), ...perGrp.values(), overall);

      if (rows.length > 0) {
        const ops = rows.map((r) => ({
          updateOne: {
            filter: { date: r.date, language: r.language, group: r.group },
            update: {
              $set: {
                total: r.total,
                indexed: r.indexed,
                crawledNotIndexed: r.crawledNotIndexed,
                discoveredNotIndexed: r.discoveredNotIndexed,
                excluded: r.excluded,
                error: r.error,
                pending: r.pending,
                unknown: r.unknown,
              },
              $setOnInsert: { createdAt: new Date() },
            },
            upsert: true,
          },
        }));
        await GscIndexingSnapshot.bulkWrite(ops, { ordered: false });
      }

      const stats = { rows: rows.length, date: date.toISOString() };
      this.lastSnapshotAt = new Date();
      this.lastSnapshotStats = stats;
      logger.log(
        `🔍 GSC snapshot DONE (${trigger}): ${rows.length} rows for ${stats.date} in ${Math.round((Date.now() - start) / 1000)}s`,
      );
      return stats;
    } finally {
      this.snapshotRunning = false;
    }
  }

  async runDiscoveryOnce(trigger: string = 'manual'): Promise<{
    inserted: number;
    refreshed: number;
    pruned: number;
    discovered: number;
  } | null> {
    if (this.discoveryRunning) {
      logger.log(
        `⏭️  GSC discovery: skip (${trigger}) — previous run in progress`,
      );
      return null;
    }
    this.discoveryRunning = true;
    const start = Date.now();
    try {
      logger.log(`🔍 GSC discovery START (${trigger})`);
      const specs = await discoverSitemapUrls();
      const sync = await syncDiscoveredUrls(specs);
      const stats = { ...sync, discovered: specs.length };
      this.lastDiscoveryAt = new Date();
      this.lastDiscoveryStats = stats;
      logger.log(
        `🔍 GSC discovery DONE: ${specs.length} URLs (${sync.inserted} new, ${sync.refreshed} refreshed, ${sync.pruned} pruned) in ${Math.round((Date.now() - start) / 1000)}s`,
      );
      return stats;
    } finally {
      this.discoveryRunning = false;
    }
  }

  async runInspectionBatchOnce(
    batchSize: number = DEFAULT_BATCH_SIZE,
    trigger: string = 'manual',
  ): Promise<{ attempted: number; succeeded: number; failed: number } | null> {
    if (this.inspectionRunning) {
      logger.log(
        `⏭️  GSC inspection batch: skip (${trigger}) — previous run in progress`,
      );
      return null;
    }
    if (!isGscConfigured()) {
      logger.log(
        `⏭️  GSC inspection batch: skip (${trigger}) — GSC not configured (set GSC_SERVICE_ACCOUNT_JSON + GSC_SITE_URL)`,
      );
      return null;
    }
    const jwt = getJwt();
    if (!jwt) return null;
    const siteUrl = process.env.GSC_SITE_URL!;

    this.inspectionRunning = true;
    const start = Date.now();
    let attempted = 0;
    let succeeded = 0;
    let failed = 0;

    try {
      // Pick the rows that have NEVER been inspected first, then the
      // rows whose last inspection is oldest. Uses the
      // (lastInspectedAt, discoveredAt) compound index so the sort is
      // covered.
      const candidates = await GscUrlInspection.find({})
        .sort({ lastInspectedAt: 1, discoveredAt: -1 })
        .limit(Math.max(1, Math.min(batchSize, 200)))
        .lean();
      logger.log(
        `🔍 GSC inspection START (${trigger}) — ${candidates.length} URLs`,
      );

      for (const row of candidates) {
        attempted += 1;
        const result = await inspectUrl(row.url, jwt, siteUrl);
        const now = new Date();
        if (!result.ok) {
          failed += 1;
          await GscUrlInspection.updateOne(
            { _id: row._id },
            {
              $set: {
                state: 'error' as const,
                lastError: result.error.slice(0, 1000),
                lastInspectedAt: now,
                updatedAt: now,
              },
              $inc: { errorCount: 1 },
            },
          );
          // Back off briefly on errors so a misconfigured property doesn't
          // burn through quota in a tight loop.
          await new Promise((r) => setTimeout(r, 500));
          continue;
        }
        succeeded += 1;
        const idx = result.payload?.inspectionResult?.indexStatusResult ?? {};
        const lastCrawl = idx.lastCrawlTime
          ? new Date(idx.lastCrawlTime)
          : undefined;
        const newState = classifyState(result.payload);
        const wasNonIndexed = NON_INDEXED_STATES.includes(
          row.state as IGscUrlInspection['state'],
        );
        const isNonIndexed = NON_INDEXED_STATES.includes(newState);
        // Maintain `notIndexedSince` so the resubmit cron can find URLs
        // that have been stuck for a while. We only set it on the
        // transition INTO a non-indexed bucket; if the row is already
        // non-indexed we leave the timestamp untouched so the "stuck for
        // X days" window keeps growing.
        const set: Record<string, unknown> = {
          state: newState,
          coverageState: idx.coverageState,
          verdict: idx.verdict,
          robotsTxtState: idx.robotsTxtState,
          indexingState: idx.indexingState,
          pageFetchState: idx.pageFetchState,
          lastCrawlTime:
            lastCrawl && !isNaN(lastCrawl.getTime()) ? lastCrawl : undefined,
          googleCanonical: idx.googleCanonical,
          userCanonical: idx.userCanonical,
          inspectionResultLink:
            result.payload?.inspectionResult?.inspectionResultLink,
          lastInspectedAt: now,
          lastError: undefined,
          errorCount: 0,
          updatedAt: now,
        };
        const unset: Record<string, ''> = {};
        if (isNonIndexed && !wasNonIndexed) {
          set.notIndexedSince = now;
        } else if (isNonIndexed && !row.notIndexedSince) {
          // Legacy/backfill case: row was already non-indexed before
          // task #266 shipped (so the field is missing). Anchor the
          // "stuck since" timestamp to the best signal we have for when
          // we first observed this state — preferring the previous
          // inspection time over `now` so the URL can become stuck-
          // eligible immediately if it was already stuck for a while.
          set.notIndexedSince =
            (row.lastInspectedAt as Date | undefined) ??
            (row.updatedAt as Date | undefined) ??
            now;
        } else if (!isNonIndexed) {
          unset.notIndexedSince = '';
        }
        const update: Record<string, unknown> = { $set: set };
        if (Object.keys(unset).length > 0) update.$unset = unset;
        await GscUrlInspection.updateOne({ _id: row._id }, update);
        // Pace ourselves to ~10 req/s — well below GSC's published cap.
        await new Promise((r) => setTimeout(r, 120));
      }

      const stats = { attempted, succeeded, failed };
      this.lastInspectionAt = new Date();
      this.lastInspectionStats = stats;
      logger.log(
        `🔍 GSC inspection DONE: ${succeeded}/${attempted} succeeded (${failed} failed) in ${Math.round((Date.now() - start) / 1000)}s`,
      );
      return stats;
    } finally {
      this.inspectionRunning = false;
    }
  }

  /**
   * Task #266 — Auto-resubmit URLs that have been stuck in
   * "Discovered – not indexed" or "Crawled – not indexed" beyond the
   * configured threshold. Re-pings IndexNow for each, force-rebuilds the
   * sitemap so the lastmod bumps, and clears `lastInspectedAt` so the
   * next inspection batch picks them up first to verify whether Google
   * moved them.
   */
  async runResubmitStuckOnce(trigger: string = 'manual'): Promise<{
    attempted: number;
    succeeded: number;
    failed: number;
    sitemapRebuilt: boolean;
  } | null> {
    if (this.resubmitRunning) {
      logger.log(
        `⏭️  GSC resubmit: skip (${trigger}) — previous run in progress`,
      );
      return null;
    }
    this.resubmitRunning = true;
    const start = Date.now();
    let attempted = 0;
    let succeeded = 0;
    let failed = 0;
    let sitemapRebuilt = false;
    try {
      const now = Date.now();
      const stuckCutoff = new Date(
        now - RESUBMIT_STUCK_DAYS * 24 * 60 * 60 * 1000,
      );
      const cooldownCutoff = new Date(
        now - RESUBMIT_COOLDOWN_DAYS * 24 * 60 * 60 * 1000,
      );
      const candidates = await GscUrlInspection.find({
        state: { $in: NON_INDEXED_STATES },
        notIndexedSince: { $lte: stuckCutoff },
        $or: [
          { lastResubmitAt: { $exists: false } },
          { lastResubmitAt: null },
          { lastResubmitAt: { $lte: cooldownCutoff } },
        ],
      })
        .sort({ notIndexedSince: 1 })
        .limit(Math.max(1, RESUBMIT_BATCH_LIMIT))
        .lean();

      logger.log(
        `🔁 GSC resubmit START (${trigger}) — ${candidates.length} stuck URLs (>${RESUBMIT_STUCK_DAYS}d)`,
      );

      if (candidates.length === 0) {
        const stats = { attempted: 0, succeeded: 0, failed: 0, sitemapRebuilt };
        this.lastResubmitAt = new Date();
        this.lastResubmitStats = stats;
        return stats;
      }

      // Group by host (IndexNow requires a single host per submission). All
      // discovered URLs are themegaradio.com today but submitToIndexNow
      // handles per-host grouping internally and returns a combined result.
      const allUrls = candidates.map((c) => c.url);
      const submitNow = new Date();
      const result = await IndexNowService.submitToIndexNow(
        allUrls,
        'sitemap-regen',
      );
      attempted = allUrls.length;
      if (result.success) {
        succeeded = allUrls.length;
      } else {
        failed = allUrls.length;
      }

      const status: 'success' | 'failed' = result.success
        ? 'success'
        : 'failed';
      const errorMsg = result.success
        ? undefined
        : (result.error ?? 'IndexNow submission failed').slice(0, 1000);

      // Persist the resubmit attempt on every row, regardless of outcome,
      // so the dashboard truthfully reports the last attempt and the
      // cooldown filter prevents hammering on repeated failures. Clear
      // `lastInspectedAt` so the next inspection batch (sorted asc on
      // that field) picks these rows up first to verify if Google moved
      // them after the re-ping.
      const ids = candidates.map((c) => c._id);
      await GscUrlInspection.updateMany(
        { _id: { $in: ids } },
        {
          $set: {
            lastResubmitAt: submitNow,
            lastResubmitStatus: status,
            lastResubmitError: errorMsg,
            updatedAt: submitNow,
          },
          $inc: { resubmitCount: 1 },
          $unset: { lastInspectedAt: '' },
        },
      );

      // Force-rebuild the sitemap so each affected URL gets a fresh
      // <lastmod>. The rebuild is cluster-wide and not per-URL, so we
      // only do it once per resubmit run (and only when there was at
      // least one URL to resubmit).
      try {
        await buildAllSitemapManifests({ force: true });
        sitemapRebuilt = true;
      } catch (err: any) {
        logger.error(
          '❌ GSC resubmit: sitemap rebuild failed:',
          err?.message ?? err,
        );
      }

      const stats = { attempted, succeeded, failed, sitemapRebuilt };
      this.lastResubmitAt = new Date();
      this.lastResubmitStats = stats;
      logger.log(
        `🔁 GSC resubmit DONE: ${succeeded}/${attempted} succeeded (${failed} failed, sitemap=${sitemapRebuilt}) in ${Math.round((Date.now() - start) / 1000)}s`,
      );
      return stats;
    } finally {
      this.resubmitRunning = false;
    }
  }
}

export { RESUBMIT_STUCK_DAYS, RESUBMIT_COOLDOWN_DAYS, NON_INDEXED_STATES };

export const gscInspectionService = GscInspectionService.getInstance();
