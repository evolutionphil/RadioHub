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
  Station,
  Genre,
  type IGscUrlInspection,
} from '@workspace/db-shared/mongo-schemas';
import { logger } from '../utils/logger';
import {
  getActiveManifest,
  extractTopCountriesFromChunk,
} from '../seo/sitemap-manifest-builder';
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
  private isInitialized = false;
  private lastDiscoveryAt: Date | null = null;
  private lastInspectionAt: Date | null = null;
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

    logger.log(
      `🔍 GSC inspection cron initialized (discovery 03:15+15:15, inspection hourly :07, batch=${DEFAULT_BATCH_SIZE}/run)`,
    );

    // Cold-start: kick off a discovery shortly after boot so a freshly
    // deployed environment doesn't show an empty dashboard until the
    // next 03:15/15:15 cron tick. Delayed slightly so it doesn't fight
    // the boot sequence for Mongo connections.
    setTimeout(() => {
      this.runDiscoveryOnce('boot').catch((err) =>
        logger.error('❌ GSC discovery boot crashed:', err),
      );
    }, 30_000);
  }

  getStatus() {
    return {
      configured: isGscConfigured(),
      cronEnabled: process.env.ENABLE_GSC_INSPECTION_CRON !== 'false',
      siteUrl: process.env.GSC_SITE_URL ?? null,
      discoveryRunning: this.discoveryRunning,
      inspectionRunning: this.inspectionRunning,
      lastDiscoveryAt: this.lastDiscoveryAt,
      lastInspectionAt: this.lastInspectionAt,
      lastDiscoveryStats: this.lastDiscoveryStats,
      lastInspectionStats: this.lastInspectionStats,
      defaultBatchSize: DEFAULT_BATCH_SIZE,
      stationDiscoveryCapPerLanguage: STATION_DISCOVERY_CAP_PER_LANG,
    };
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
        await GscUrlInspection.updateOne(
          { _id: row._id },
          {
            $set: {
              state: classifyState(result.payload),
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
            },
          },
        );
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
}

export const gscInspectionService = GscInspectionService.getInstance();
