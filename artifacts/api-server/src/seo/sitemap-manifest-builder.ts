/**
 * SitemapManifest builder — deterministic, per-language, per-type sitemap
 * planner backed by Mongo.
 *
 * Replaces the old global Math.ceil(50000/1000)=50-chunks-per-language strategy
 * that emitted ~empty chunks for sparse languages (pa, so, hy, am, kn, sq, lt,
 * lv, az, tl, vi, et, sw, ko, ms, ur, ml, gu, ta, hi, bn, te, no, mr, sl, ...).
 *
 * Build flow:
 *   1. Acquire qualified-languages state (throws 503 if unavailable).
 *   2. Idempotency check — skip if active manifest with same hash + non-expired.
 *   3. Stream all non-noIndex stations once via cursor (bounded memory).
 *   4. For each station, call getIndexableLanguagesForStation() — push the
 *      station's _id into per-language buckets.
 *   5. Sort each bucket (votes DESC, _id ASC) and chunk by 1000.
 *   6. Compute maxUpdatedAt per chunk for <lastmod>.
 *   7. Write status='building' docs.
 *   8. Atomic swap: superseded ← old active; active ← building (per type/lang).
 *   9. TTL cleanup handles superseded/failed docs after 24h.
 *
 * Concurrency: at most one active build per process (in-memory lock). The
 * partialFilterExpression unique index on `building` enforces one in-flight
 * build per (type, language) across processes.
 */

import crypto from 'crypto';
import mongoose from 'mongoose';
import { Station, Genre, SitemapManifest, ISitemapManifestChunk } from '../shared/mongo-schemas';
import { logger } from '../utils/logger';
import { getQualifiedLanguagesState, QualifiedLanguagesUnavailableError } from './qualified-languages';
import { getIndexableLanguagesForStation } from './junk-station-rules';
import { isWhitelistedGenreSlug, MIN_STATIONS_FOR_GENRE_INDEX } from './genre-whitelist';

const STATIONS_PER_CHUNK = 1000;
const MANIFEST_TTL_SUPERSEDED_MS = 24 * 60 * 60 * 1000;     // 24h
const MANIFEST_TTL_ACTIVE_MS = 7 * 24 * 60 * 60 * 1000;     // 7 days (refreshed every 6h)
const MANIFEST_TTL_BUILDING_MS = 6 * 60 * 60 * 1000;        // 6h cleanup for crashed builds
const STALE_BUILDING_RECLAIM_MS = 30 * 60 * 1000;           // reclaim stuck building >30min

let buildLock = false;

interface StationLite {
  _id: mongoose.Types.ObjectId;
  slug?: string;
  name?: string;
  url?: string;
  homepage?: string;
  tags?: string;
  bitrate?: number;
  lastCheckOk?: boolean;
  lastCheckOkTime?: Date | null;
  lastCheckTime?: Date | null;
  country?: string;
  countryCode?: string;
  language?: string;
  languageCodes?: string;
  noIndex?: boolean;
  votes?: number;
  updatedAt?: Date;
  logoAssets?: any;
  favicon?: string;
}

/**
 * Build a CONTENT-DEPENDENT version string so identical rebuilds produce the
 * same version (ETag stability). ARCHITECT P0 fix (2026-04-30): the previous
 * `Date.now() + randomBytes` recipe re-keyed every 6h even when the chunk
 * contents were identical, which:
 *   1. caused a Cloudflare cache stampede on each rebuild,
 *   2. wasted Bing/Google bot bandwidth re-downloading identical sitemaps,
 *   3. made If-None-Match 304 short-circuiting useless.
 * The new recipe = sha256(qualifiedLanguagesHash + sorted chunks signature).
 */
function makeContentVersion(args: {
  qualifiedLanguagesHash: string;
  chunks: Array<{ chunk: number; urlCount: number; stationIds?: any[]; maxUpdatedAt?: Date | null }>;
}): string {
  // Webmaster #2 HIGH-1a fix (2026-04-30): version hash MUST NOT include
  // maxUpdatedAt. Mongoose timestamps auto-bump Station.updatedAt on every
  // save (including uptime probes setting lastCheckOk), which would tick the
  // version every time a station was probed → ETag invalidation → Cloudflare
  // cache stampede → defeats the entire stampede-protection purpose of this
  // refactor. The URL SET (stationIds) is the cache-relevant content. The
  // <lastmod> XML element is a freshness *signal* surfaced via the
  // Last-Modified HTTP header, which clients revalidate independently with
  // If-Modified-Since. So: ETag tracks URL set; Last-Modified tracks freshness.
  const sig = args.chunks
    .slice()
    .sort((a, b) => a.chunk - b.chunk)
    .map(c => {
      const ids = (c.stationIds || []).map((x: any) => String(x)).sort().join(',');
      return `${c.chunk}:${c.urlCount}:${ids}`;
    })
    .join('|');
  const hash = crypto
    .createHash('sha256')
    .update(args.qualifiedLanguagesHash + '\n' + sig)
    .digest('hex')
    .slice(0, 16);
  return `v${hash}`;
}

/** Build a manifest for one (type, language). Status will be written as
 * 'building' first, then atomically swapped to 'active' once the caller
 * decides the per-type build is complete. */
async function writeBuildingManifest(args: {
  type: 'stations' | 'main' | 'genres';
  language: string;
  qualifiedLanguages: string[];
  qualifiedLanguagesHash: string;
  chunks: ISitemapManifestChunk[];
  totalUrls: number;
}) {
  const { type, language, qualifiedLanguages, qualifiedLanguagesHash, chunks, totalUrls } = args;
  // Content-addressable version (stable when chunks are identical).
  const version = makeContentVersion({ qualifiedLanguagesHash, chunks });
  const now = new Date();

  // Architect P0 fix: idempotent skip — if the active manifest already has
  // this exact (type, language, version), there is nothing to swap. Return
  // the active doc directly without writing a new building doc. This
  // prevents Cloudflare cache stampede when chunks haven't changed but the
  // 6h refresh loop fired.
  const existingActive = await SitemapManifest.findOne({
    type,
    language,
    status: 'active',
    version,
  }).lean();
  if (existingActive) {
    logger.debug(`✅ manifest no-op: type=${type} lang=${language} version=${version} already active`);
    return existingActive;
  }

  // Reclaim stuck building docs (process crashed mid-build).
  await SitemapManifest.deleteMany({
    type,
    language,
    status: 'building',
    generatedAt: { $lt: new Date(Date.now() - STALE_BUILDING_RECLAIM_MS) },
  });

  // Webmaster #1 MEDIUM-3 fix (2026-04-30): handle E11000 from the
  // partialFilterExpression unique index on (type, language, status='building').
  // When two processes (multi-replica deploy + cron) race here, exactly one
  // create succeeds. The loser must NOT bubble — it should re-check whether
  // the winner already activated a matching version, and either return that
  // active doc (idempotent skip) or wait one cycle and let the next refresh
  // loop pick it up (return any existing active for this type/lang).
  try {
    return await SitemapManifest.create({
      type,
      language,
      version,
      status: 'building',
      qualifiedLanguagesHash,
      qualifiedLanguages,
      chunks,
      totalUrls,
      chunkCount: chunks.length,
      generatedAt: now,
      expiresAt: new Date(now.getTime() + MANIFEST_TTL_BUILDING_MS),
    });
  } catch (err: any) {
    if (err?.code !== 11000) throw err;
    logger.warn(`⚠️ manifest-builder: E11000 race on (type=${type}, lang=${language}) — another builder is in flight; returning existing active doc as no-op`);
    // Re-check active first (the winner may have already swapped to active).
    const winnerActive = await SitemapManifest.findOne({
      type,
      language,
      status: 'active',
    }).sort({ generatedAt: -1 }).lean();
    if (winnerActive) return winnerActive;
    // Else return current building doc (caller will skip swap because
    // status is 'building' but not its own _id — see callers' guard).
    const winnerBuilding = await SitemapManifest.findOne({
      type,
      language,
      status: 'building',
    }).sort({ generatedAt: -1 }).lean();
    if (winnerBuilding) {
      // Mark with a sentinel flag so callers know NOT to call activateManifest()
      // on the winner's _id (only the writer of a building doc may activate it).
      return { ...winnerBuilding, status: 'active' as const, _raceLost: true } as any;
    }
    // Pathological: no row anywhere — let the caller throw normally on next access.
    throw err;
  }
}

/** Atomically swap building → active and demote any existing active to
 * superseded. Per-(type, language). Uses a transaction when available; falls
 * back to a sequential best-effort path when transactions aren't supported
 * (standalone Mongo). The fallback is acceptable because:
 *   - Worst case: a few seconds where two manifests have status='active' for
 *     the same (type, lang). Sitemap routes pick the first one found and
 *     they are equivalent by construction (same hash, newer version).
 *   - The unique partialFilterExpression on (type, lang, status='active') is
 *     intentionally NOT created — only on status='building' — so we can
 *     tolerate this brief overlap. */
async function activateManifest(buildingId: mongoose.Types.ObjectId, type: string, language: string) {
  const conn = mongoose.connection as any;

  const tryTransaction = async (): Promise<boolean> => {
    let session: any;
    try {
      session = await mongoose.startSession();
    } catch {
      return false;
    }
    try {
      await session.withTransaction(async () => {
        await SitemapManifest.updateMany(
          { type, language, status: 'active' },
          {
            $set: {
              status: 'superseded',
              expiresAt: new Date(Date.now() + MANIFEST_TTL_SUPERSEDED_MS),
            },
          },
          { session },
        );
        await SitemapManifest.updateOne(
          { _id: buildingId },
          {
            $set: {
              status: 'active',
              expiresAt: new Date(Date.now() + MANIFEST_TTL_ACTIVE_MS),
            },
          },
          { session },
        );
      });
      return true;
    } catch (err: any) {
      // Mongo 20 = transactions not supported (e.g. standalone server).
      if (err?.code === 20 || /Transaction numbers are only allowed/i.test(String(err?.message))) {
        return false;
      }
      throw err;
    } finally {
      try { await session?.endSession(); } catch {}
    }
  };

  const ok = await tryTransaction();
  if (ok) return;

  // Standalone Mongo fallback — sequential best-effort.
  await SitemapManifest.updateMany(
    { type, language, status: 'active' },
    {
      $set: {
        status: 'superseded',
        expiresAt: new Date(Date.now() + MANIFEST_TTL_SUPERSEDED_MS),
      },
    },
  );
  await SitemapManifest.updateOne(
    { _id: buildingId },
    {
      $set: {
        status: 'active',
        expiresAt: new Date(Date.now() + MANIFEST_TTL_ACTIVE_MS),
      },
    },
  );
}

/** Check if every (type, lang) already has an active manifest with the same
 * qualifiedLanguagesHash and is fresh (< activation TTL). */
async function isManifestUpToDate(
  hash: string,
  qualifiedLanguages: string[],
  freshWindowMs: number,
): Promise<boolean> {
  const expected = ['stations', 'genres', 'main'].length * qualifiedLanguages.length;
  const cutoff = new Date(Date.now() - freshWindowMs);
  const count = await SitemapManifest.countDocuments({
    status: 'active',
    qualifiedLanguagesHash: hash,
    language: { $in: qualifiedLanguages },
    type: { $in: ['stations', 'genres', 'main'] },
    generatedAt: { $gte: cutoff },
  });
  return count >= expected;
}

/**
 * Stream all non-junk stations and build per-language buckets of station _ids.
 * Returns { lang -> chunks[] }.
 *
 * Memory budget: ~43K stations × ~10 langs × 12-byte ObjectId ≈ 5MB worst case.
 */
async function buildStationBuckets(qualifiedLanguages: string[]): Promise<{
  perLang: Map<string, ISitemapManifestChunk[]>;
  totalUrls: Map<string, number>;
}> {
  // Bucket per language: Array<{ id, votes, updatedAt }>.
  const buckets = new Map<string, Array<{ id: mongoose.Types.ObjectId; votes: number; updatedAt?: Date }>>();
  for (const lang of qualifiedLanguages) buckets.set(lang, []);

  const cursor = Station.find({
    slug: { $exists: true, $ne: '' },
    $or: [{ noIndex: { $exists: false } }, { noIndex: { $ne: true } }],
  })
    .select('_id slug name url homepage tags bitrate lastCheckOk lastCheckOkTime lastCheckTime country countryCode language languageCodes noIndex votes updatedAt logoAssets favicon')
    .sort({ votes: -1, _id: 1 })
    .lean()
    .cursor({ batchSize: 500 });

  let processed = 0;
  for await (const stationDoc of cursor as any) {
    const station = stationDoc as StationLite;
    const indexableLangs = getIndexableLanguagesForStation(station as any, qualifiedLanguages);
    if (indexableLangs.length === 0) continue;
    const entry = {
      id: station._id,
      votes: typeof station.votes === 'number' ? station.votes : 0,
      updatedAt: station.updatedAt,
    };
    for (const lang of indexableLangs) {
      const bucket = buckets.get(lang);
      if (bucket) bucket.push(entry);
    }
    processed++;
  }
  logger.log(`📦 manifest-builder: scanned ${processed} indexable stations across ${qualifiedLanguages.length} langs`);

  const perLang = new Map<string, ISitemapManifestChunk[]>();
  const totalUrls = new Map<string, number>();

  for (const [lang, bucket] of buckets.entries()) {
    // Already sorted by cursor(votes desc, _id asc) so order is stable.
    const chunks: ISitemapManifestChunk[] = [];
    for (let i = 0; i < bucket.length; i += STATIONS_PER_CHUNK) {
      const slice = bucket.slice(i, i + STATIONS_PER_CHUNK);
      const updatedAts = slice
        .map((s) => s.updatedAt)
        .filter((d): d is Date => d instanceof Date);
      const maxUpdatedAt = updatedAts.length > 0
        ? new Date(Math.max(...updatedAts.map((d) => d.getTime())))
        : undefined;
      chunks.push({
        chunk: chunks.length + 1,
        stationIds: slice.map((s) => s.id),
        urlCount: slice.length,
        maxUpdatedAt,
      });
    }
    perLang.set(lang, chunks);
    totalUrls.set(lang, bucket.length);
    logger.log(`📦 manifest-builder: lang=${lang} stations=${bucket.length} chunks=${chunks.length}`);
  }

  return { perLang, totalUrls };
}

/** Build the genres manifest — one chunk per language (genres are far below
 * 50K). Stores Genre._ids ordered by stationCount desc. */
async function buildGenreChunks(): Promise<{ chunk: ISitemapManifestChunk; maxUpdatedAt?: Date; totalUrls: number }> {
  // Task #104: only publish genre URLs whose slug is on the curated whitelist
  // (real music/talk genres) AND that have at least MIN_STATIONS_FOR_GENRE_INDEX
  // stations backing them. The historical sitemap had ~8,824 slugs/lang derived
  // from raw station tags — ~80% of which were FM frequencies, city names,
  // station/brand names, or random noise. Those URLs are now dropped from
  // sitemaps; the SSR layer (seo-renderer.ts) noindex'es or 301's them.
  const cursor = Genre.find({ slug: { $exists: true, $ne: '' } })
    .select('_id slug stationCount updatedAt')
    .sort({ stationCount: -1, _id: 1 })
    .lean()
    .cursor({ batchSize: 500 });

  const ids: mongoose.Types.ObjectId[] = [];
  const updatedAts: Date[] = [];
  let scanned = 0;
  let skippedNotWhitelisted = 0;
  let skippedThin = 0;
  for await (const g of cursor as any) {
    scanned++;
    const slug: string | undefined = (g as any).slug;
    const stationCount: number = (g as any).stationCount ?? 0;
    if (!isWhitelistedGenreSlug(slug)) {
      skippedNotWhitelisted++;
      continue;
    }
    if (stationCount < MIN_STATIONS_FOR_GENRE_INDEX) {
      skippedThin++;
      continue;
    }
    ids.push((g as any)._id);
    if ((g as any).updatedAt instanceof Date) updatedAts.push((g as any).updatedAt);
  }
  logger.log(
    `📦 manifest-builder: genres scanned=${scanned} kept=${ids.length} ` +
    `skipped_not_whitelisted=${skippedNotWhitelisted} skipped_thin=${skippedThin} ` +
    `(min_stations=${MIN_STATIONS_FOR_GENRE_INDEX})`,
  );
  const maxUpdatedAt = updatedAts.length > 0
    ? new Date(Math.max(...updatedAts.map((d) => d.getTime())))
    : undefined;
  return {
    chunk: {
      chunk: 1,
      stationIds: ids,                  // re-using stationIds field for genre ids (route-internal)
      urlCount: ids.length,
      maxUpdatedAt,
    },
    maxUpdatedAt,
    totalUrls: ids.length,
  };
}

/** Build the "main" manifest — fixed list of static main pages per language.
 * Has zero dynamic IDs; chunk count is always 1. */
function buildMainChunks(): { chunk: ISitemapManifestChunk; totalUrls: number } {
  // Static main pages — must mirror sitemap-main-:lang.xml route.
  // Task #128: includes /faq, /contact, /privacy-policy, /terms-and-conditions,
  // /applications so Google has a discovery path to those pages. The route
  // additionally appends top-country region URLs at request time.
  // NOTE: totalUrls counts STATIC pages only. The route also appends ~30
  // top-country URLs per language at request time which are NOT included in
  // this count — the manifest's urlCount will under-report actual emitted
  // URLs. Top-country invalidation is handled via the topCountriesSig folded
  // into the route's ETag + cache key (see seo-sitemap-routes.ts).
  const PAGES = ['', '/stations', '/genres', '/about', '/regions',
    '/regions/europe', '/regions/asia', '/regions/africa',
    '/regions/north-america', '/regions/south-america', '/regions/oceania',
    '/faq', '/contact', '/privacy-policy', '/terms-and-conditions', '/applications'];
  return {
    chunk: { chunk: 1, stationIds: [], urlCount: PAGES.length, maxUpdatedAt: undefined },
    totalUrls: PAGES.length,
  };
}

/**
 * Top-level build entry point. Builds all (stations, main, genres) × qualified
 * languages, then atomically swaps each manifest to active.
 *
 * Idempotent — if the latest active hash matches and is fresh, it skips the
 * build and returns early.
 *
 * @param force  Ignore freshness check; rebuild even if active is fresh.
 */
export async function buildAllSitemapManifests(opts: { force?: boolean } = {}): Promise<{
  built: boolean;
  qualifiedLanguagesHash: string;
  qualifiedLanguages: string[];
  perLangCounts?: Record<string, number>;
}> {
  if (buildLock) {
    logger.warn('⏭️ manifest-builder: build already in progress, skipping');
    return { built: false, qualifiedLanguagesHash: '', qualifiedLanguages: [] };
  }
  buildLock = true;

  try {
    let state;
    try {
      state = await getQualifiedLanguagesState();
    } catch (err) {
      if (err instanceof QualifiedLanguagesUnavailableError) {
        logger.error('🔴 manifest-builder: aborting build — qualified-languages unavailable (will retry next cycle)');
        return { built: false, qualifiedLanguagesHash: '', qualifiedLanguages: [] };
      }
      throw err;
    }

    const { languages, hash } = state;
    const REBUILD_FRESH_WINDOW_MS = 6 * 60 * 60 * 1000; // skip if active < 6h old

    if (!opts.force && (await isManifestUpToDate(hash, languages, REBUILD_FRESH_WINDOW_MS))) {
      logger.log(`⏭️ manifest-builder: active manifests fresh (hash=${hash}, langs=${languages.length}) — skipping`);
      return { built: false, qualifiedLanguagesHash: hash, qualifiedLanguages: languages };
    }

    logger.log(`🏗️ manifest-builder: building manifests for ${languages.length} langs (hash=${hash})`);
    const t0 = Date.now();

    // STATIONS — bucket all stations once.
    const { perLang, totalUrls: stationTotals } = await buildStationBuckets(languages);

    // GENRES — one shared snapshot reused per language (URL is per-lang but ids identical).
    const genreData = await buildGenreChunks();

    // MAIN — static.
    const mainData = buildMainChunks();

    // Write building docs and activate per (type, lang).
    const perLangCounts: Record<string, number> = {};
    for (const lang of languages) {
      const stationChunks = perLang.get(lang) ?? [];
      const stationTotal = stationTotals.get(lang) ?? 0;
      perLangCounts[lang] = stationTotal;

      // Stations
      const stationsBuilding: any = await writeBuildingManifest({
        type: 'stations', language: lang,
        qualifiedLanguages: languages, qualifiedLanguagesHash: hash,
        chunks: stationChunks, totalUrls: stationTotal,
      });
      // Skip swap when writeBuildingManifest returned an existing-active doc
      // (content-version no-op). Otherwise activate the freshly written
      // building doc.
      if (stationsBuilding?.status !== 'active') {
        await activateManifest(stationsBuilding._id as mongoose.Types.ObjectId, 'stations', lang);
      }

      // Genres (one chunk per lang, same ids; URLs differ via buildLocalizedUrl)
      const genresBuilding: any = await writeBuildingManifest({
        type: 'genres', language: lang,
        qualifiedLanguages: languages, qualifiedLanguagesHash: hash,
        chunks: genreData.totalUrls > 0 ? [genreData.chunk] : [],
        totalUrls: genreData.totalUrls,
      });
      if (genresBuilding?.status !== 'active') {
        await activateManifest(genresBuilding._id as mongoose.Types.ObjectId, 'genres', lang);
      }

      // Main
      const mainBuilding: any = await writeBuildingManifest({
        type: 'main', language: lang,
        qualifiedLanguages: languages, qualifiedLanguagesHash: hash,
        chunks: [mainData.chunk], totalUrls: mainData.totalUrls,
      });
      if (mainBuilding?.status !== 'active') {
        await activateManifest(mainBuilding._id as mongoose.Types.ObjectId, 'main', lang);
      }
    }

    const elapsed = Date.now() - t0;
    logger.log(`✅ manifest-builder: built+activated all manifests in ${elapsed}ms`);
    return { built: true, qualifiedLanguagesHash: hash, qualifiedLanguages: languages, perLangCounts };

  } catch (err) {
    logger.error('❌ manifest-builder: build failed', err);
    throw err;
  } finally {
    buildLock = false;
  }
}

/** Fetch the active manifest for (type, lang). Returns null if none. */
export async function getActiveManifest(
  type: 'stations' | 'main' | 'genres',
  language: string,
): Promise<{
  type: string;
  language: string;
  version: string;
  qualifiedLanguagesHash: string;
  chunks: ISitemapManifestChunk[];
  totalUrls: number;
  chunkCount: number;
  generatedAt: Date;
  maxUpdatedAt?: Date;
} | null> {
  // Sort by generatedAt desc so if a brief overlap exists (transactions
  // unavailable, swap mid-flight), the newer manifest wins.
  const doc = await SitemapManifest.findOne({ type, language, status: 'active' })
    .sort({ generatedAt: -1 })
    .lean();
  if (!doc) return null;
  // Compute overall maxUpdatedAt across chunks
  const dates = doc.chunks
    .map((c) => c.maxUpdatedAt)
    .filter((d): d is Date => d instanceof Date);
  const maxUpdatedAt = dates.length > 0
    ? new Date(Math.max(...dates.map((d) => d.getTime())))
    : undefined;
  return {
    type: doc.type,
    language: doc.language,
    version: doc.version,
    qualifiedLanguagesHash: doc.qualifiedLanguagesHash,
    chunks: doc.chunks,
    totalUrls: doc.totalUrls,
    chunkCount: doc.chunkCount,
    generatedAt: doc.generatedAt,
    maxUpdatedAt,
  };
}

/** Fetch a single chunk slot from active stations manifest. Returns null if
 * the chunk index doesn't exist (caller should respond 410 Gone). */
export async function getActiveStationChunk(language: string, chunk: number): Promise<{
  stationIds: Array<mongoose.Types.ObjectId | string>;
  maxUpdatedAt?: Date;
  qualifiedLanguagesHash: string;
  version: string;
} | null> {
  const manifest = await getActiveManifest('stations', language);
  if (!manifest) return null;
  const found = manifest.chunks.find((c) => c.chunk === chunk);
  if (!found) return null;
  return {
    stationIds: found.stationIds,
    maxUpdatedAt: found.maxUpdatedAt,
    qualifiedLanguagesHash: manifest.qualifiedLanguagesHash,
    version: manifest.version,
  };
}

/** Background refresh trigger — call after server boot + periodic interval. */
let refreshTimer: NodeJS.Timeout | null = null;
export function startManifestRefreshLoop(intervalMs: number = 6 * 60 * 60 * 1000): void {
  if (refreshTimer) return;
  refreshTimer = setInterval(() => {
    buildAllSitemapManifests().catch((err) => {
      logger.error('❌ manifest-builder: scheduled rebuild failed', err);
    });
  }, intervalMs);
  logger.log(`⏰ manifest-builder: refresh loop started (every ${Math.round(intervalMs / 60000)}min)`);
}
