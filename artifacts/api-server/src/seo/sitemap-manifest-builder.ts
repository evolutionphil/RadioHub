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
import { pgCatalog } from '../data/postgres-catalog-store';
import { pgWriteBuildingManifest, pgActivateManifest, pgFreshManifestCount, pgSeoGenres, pgTopSitemapCountries, pgRetireManifests, pgActiveManifest, pgSeoCleanup, type ISitemapManifestChunk } from '../data/postgres-seo-indexing-store';
import { logger } from '../utils/logger';
import { IndexNowService } from '../services/indexnow';
import { getQualifiedLanguagesState, QualifiedLanguagesUnavailableError } from './qualified-languages';
import { getIndexableLanguagesForStation } from './junk-station-rules';
import { isWhitelistedGenreSlug, MIN_STATIONS_FOR_GENRE_INDEX } from './genre-whitelist';
import { RESERVED_GENRE_SLUGS } from './reserved-genre-slugs';
import { AZ_INDEX_KEYS } from './az-station-index';
import { canonicalizeCountry, countrySlug, getRegionSlugForCountry } from '@workspace/seo-shared/country-regions';

// Re-export so other modules importing from the manifest builder still
// get a single source of truth (task #148).
export { RESERVED_GENRE_SLUGS };

// S-A4 FIX (2026-05-08): bumped from 1000 → 10000. The XML sitemap spec
// allows up to 50,000 URLs per file; 1000 was over-fragmenting our 60k+
// catalog into 60 child sitemaps per language × 57 languages, blowing
// past the 50k child-entry sitemap-index cap and forcing Google to
// re-crawl tiny chunks. 10k keeps each file under ~5 MB pre-gzip
// (well under the 50 MB hard limit) while reducing index entries 10×.
const STATIONS_PER_CHUNK = 10000;
const MANIFEST_TTL_SUPERSEDED_MS = 24 * 60 * 60 * 1000;     // 24h
const MANIFEST_TTL_ACTIVE_MS = 7 * 24 * 60 * 60 * 1000;     // 7 days (refreshed every 6h)
const MANIFEST_TTL_BUILDING_MS = 6 * 60 * 60 * 1000;        // 6h cleanup for crashed builds
const STALE_BUILDING_RECLAIM_MS = 30 * 60 * 1000;           // reclaim stuck building >30min

let buildLock = false;

interface StationLite {
  _id: string;
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
  return pgWriteBuildingManifest({ ...args, version: makeContentVersion(args) });
}

/** Swap under a transaction; a reclaimed builder cannot demote the last good active manifest. */
async function activateManifest(buildingId: string, type: string, language: string) {
  await pgActivateManifest(String(buildingId), type, language);
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
  const count = await pgFreshManifestCount(hash, qualifiedLanguages, cutoff);
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
  const buckets = new Map<string, Array<{ id: string; votes: number; updatedAt?: Date }>>();
  for (const lang of qualifiedLanguages) buckets.set(lang, []);

  const cursor = pgCatalog().iterate({ slug: { $exists: true, $ne: '' }, noIndex: { $ne: true } }, { batchSize: 500 });
  let processed = 0;
  const consume = async (c: any) => {
    for await (const stationDoc of c) {
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
  };
  await consume(cursor);
  logger.log(`📦 manifest-builder: scanned ${processed} indexable stations across ${qualifiedLanguages.length} langs`);

  const perLang = new Map<string, ISitemapManifestChunk[]>();
  const totalUrls = new Map<string, number>();

  for (const [lang, bucket] of buckets.entries()) {
    bucket.sort((a,b) => b.votes-a.votes || String(a.id).localeCompare(String(b.id)));
    // Already sorted by cursor(votes desc; ties broken by natural index
    // RecordId order) so chunk slicing is deterministic per process.
    const chunks: ISitemapManifestChunk[] = [];
    for (let i = 0; i < bucket.length; i += STATIONS_PER_CHUNK) {
      const slice = bucket.slice(i, i + STATIONS_PER_CHUNK);
      const updatedAts = slice
        .map((s) => s.updatedAt)
        .filter((d): d is Date => d instanceof Date);
      const maxUpdatedAt = updatedAts.length > 0
        ? new Date(Math.max(...updatedAts.map((d) => d.getTime())))
        : undefined;
      // CHUNK NUMBERING CONTRACT (Task #344): station-sitemap chunk numbers
      // are ALWAYS 1-based. The sitemap-index handler advertises whatever
      // value lives in `chunk.chunk`, and the per-chunk route rejects
      // anything outside `[1-9]\d{0,3}` with 410 Gone. If this ever drifts
      // to 0-based we'd quietly tell Google to fetch
      // `/sitemap-stations-<lang>-0.xml` and it would 410 immediately,
      // dropping every station URL in that chunk from the index. The
      // index-emission path also asserts chunk > 0 as a belt-and-braces
      // guard against future regressions here.
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
  // Keep the curated genre whitelist and minimum station count gate.
  const ids: string[] = [];
  const updatedAts: Date[] = [];
  let scanned = 0;
  let skippedNotWhitelisted = 0;
  let skippedThin = 0;
  const consumeGenres = async (c: any) => {
    for await (const g of c) {
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
  };
  await consumeGenres(await pgSeoGenres());
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

// Static main pages — must mirror sitemap-main-:lang.xml route.
// Task #128: includes /faq, /contact, /privacy-policy, /terms-and-conditions,
// /applications so Google has a discovery path to those pages.
//
// 2026-05-15 v11 FLIP: /stations (NOT /radios) is the canonical listing
// path. Must mirror seo-sitemap-routes.ts mainPages (line 1189) which
// emits /stations. The url-redirect-middleware STATION_LIST_ALIASES
// canonical was flipped from .radios to .stations on the same date so
// every sitemap URL serves 200 instead of 301'ing to a different URL.
// (Previous setup caused "Submitted URL is a redirect" GSC warnings.)
const MAIN_STATIC_PAGES = ['', '/stations', '/genres', '/about', '/regions',
  '/regions/europe', '/regions/asia', '/regions/africa',
  '/regions/north-america', '/regions/south-america', '/regions/oceania',
  '/faq', '/contact', '/privacy-policy', '/terms-and-conditions', '/applications',
  // A-Z station index pages (Task #11, 2026-07-03) — mirrors mainPages in
  // routes/seo-sitemap-routes.ts and STATIC_MAIN_PAGES in
  // services/sitemap-diff-indexnow.ts.
  ...AZ_INDEX_KEYS.map((k) => `/stations/${k}`)];

const TOP_COUNTRIES_LIMIT = 30;

/** Marker prefix used in chunk.stationIds to distinguish top-country region/country
 * pairs from station ObjectIds. The schema field is Mixed[] so strings are accepted.
 * Routes parse these out to render `/regions/<region>/<country>` URLs. */
const TOP_COUNTRY_PREFIX = 'tc:';

export function encodeTopCountryEntry(regionSlug: string, countrySlug: string): string {
  return `${TOP_COUNTRY_PREFIX}${regionSlug}/${countrySlug}`;
}

/** Parse top-country entries out of a main-manifest chunk's stationIds.
 * Filters strings prefixed with `tc:` and returns ordered { regionSlug, countrySlug }. */
export function extractTopCountriesFromChunk(
  stationIds: Array<string>,
): Array<{ regionSlug: string; countrySlug: string }> {
  const out: Array<{ regionSlug: string; countrySlug: string }> = [];
  for (const id of stationIds) {
    if (typeof id !== 'string') continue;
    if (!id.startsWith(TOP_COUNTRY_PREFIX)) continue;
    const rest = id.slice(TOP_COUNTRY_PREFIX.length);
    const slash = rest.indexOf('/');
    if (slash <= 0) continue;
    const regionSlug = rest.slice(0, slash);
    const cSlug = rest.slice(slash + 1);
    if (!regionSlug || !cSlug) continue;
    out.push({ regionSlug, countrySlug: cSlug });
  }
  return out;
}

/** Aggregate top countries (by indexable station count) into ordered region/country
 * pairs and compute the freshest station updatedAt across those countries.
 * Used by the main-manifest builder so:
 *   - The country set is part of the manifest's content version → ETag flips when
 *     it changes (deterministic invalidation).
 *   - maxUpdatedAt feeds <lastmod>/Last-Modified, so listings reflect the latest
 *     station change inside any of the top countries (not just an arbitrary clock).
 */
export async function getTopCountryDbNames(limit: number = TOP_COUNTRIES_LIMIT): Promise<string[]> {
  // Single source of truth for "top N countries by indexable station count".
  // Used by the main sitemap manifest AND by the nightly genre_counts
  // denormalization job (precomputed-genres.ts) so both surfaces stay in
  // sync — when a country drops/rises in the leaderboard, both the sitemap
  // top-countries list and the per-country genre cache update together.
  const { rawCountryNames } = await computeTopCountriesForMain(limit);
  return rawCountryNames;
}

async function computeTopCountriesForMain(limit: number): Promise<{
  entries: Array<{ regionSlug: string; countrySlug: string }>;
  maxUpdatedAt?: Date;
  rawCountryNames: string[];
}> {
  try {
    // S5/S29 FIX (2026-05-08): also exclude junk-flagged stations from the
    // leaderboard count (they are excluded from sitemap-stations.xml so they
    // shouldn't influence the country ranking either) and add a deterministic
    // tie-break (alphabetical by canonical country name) so two countries
    // with identical counts produce a stable order across replicas — without
    // this, Cloudflare can cache divergent main sitemaps from different pods.
    const rows: Array<{ _id: string; count: number; maxUpdatedAt?: Date }> = await pgTopSitemapCountries(limit * 2);

    const entries: Array<{ regionSlug: string; countrySlug: string }> = [];
    const rawCountryNames: string[] = [];
    const seen = new Set<string>();
    let max: Date | undefined;
    for (const r of rows) {
      const canonical = canonicalizeCountry(String(r._id || ''));
      if (!canonical) continue;
      const region = getRegionSlugForCountry(canonical);
      if (!region) continue;
      const slug = countrySlug(canonical);
      if (!slug) continue;
      const key = `${region}/${slug}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({ regionSlug: region, countrySlug: slug });
      rawCountryNames.push(String(r._id));
      if (r.maxUpdatedAt instanceof Date && (!max || r.maxUpdatedAt > max)) {
        max = r.maxUpdatedAt;
      }
      if (entries.length >= limit) break;
    }
    return { entries, maxUpdatedAt: max, rawCountryNames };
  } catch (err) {
    logger.error('❌ computeTopCountriesForMain failed:', err);
    throw err;
  }
}

/** Build the "main" manifest — static main pages + top-N region/country pages.
 * Top-country entries are baked into chunks[0].stationIds (as `tc:<region>/<country>`
 * marker strings) so the manifest's content-version hash flips deterministically
 * when station data shifts the country leaderboard. */
async function buildMainChunks(): Promise<{ chunk: ISitemapManifestChunk; totalUrls: number }> {
  const top = await computeTopCountriesForMain(TOP_COUNTRIES_LIMIT);
  const topIds: string[] = top.entries.map((e) => encodeTopCountryEntry(e.regionSlug, e.countrySlug));
  const totalUrls = MAIN_STATIC_PAGES.length + topIds.length;
  return {
    chunk: {
      chunk: 1,
      stationIds: topIds, // static pages are hardcoded in the route; only dynamic entries here
      urlCount: totalUrls,
      maxUpdatedAt: top.maxUpdatedAt,
    },
    totalUrls,
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
  /** Number of (type, lang) manifests that were swapped to a fresh active
   * version this run. Zero means every per-(type, lang) writeBuildingManifest
   * was a content-version no-op (existing active doc matched the new
   * version). Callers (e.g. the scheduled refresh loop) use this to decide
   * whether to ping IndexNow — we only want to notify search engines when
   * the URL set actually changed, not every 6h on identical content. */
  activatedCount?: number;
  /** Number of `status: 'active'` manifest docs whose language was no longer
   * in the qualified set and thus moved to `status: 'retired'`. Reflects
   * leftover state from a previous (larger) qualified-languages list — should
   * be 0 after the first rebuild post-shrink. */
  retiredZombies?: number;
}> {
  if (buildLock) {
    logger.warn('⏭️ manifest-builder: build already in progress, skipping');
    return { built: false, qualifiedLanguagesHash: '', qualifiedLanguages: [], activatedCount: 0 };
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
      return { built: false, qualifiedLanguagesHash: hash, qualifiedLanguages: languages, activatedCount: 0 };
    }

    logger.log(`🏗️ manifest-builder: building manifests for ${languages.length} langs (hash=${hash})`);
    const t0 = Date.now();

    // STATIONS — bucket all stations once.
    const { perLang, totalUrls: stationTotals } = await buildStationBuckets(languages);

    // GENRES — one shared snapshot reused per language (URL is per-lang but ids identical).
    const genreData = await buildGenreChunks();

    // MAIN — static pages + top-N region/country pages (one snapshot reused per
    // language; URL is per-lang but the country set is identical).
    const mainData = await buildMainChunks();

    // Write building docs and activate per (type, lang).
    const perLangCounts: Record<string, number> = {};
    let activatedCount = 0;
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
        await activateManifest(stationsBuilding._id as string, 'stations', lang);
        activatedCount++;
      }

      // Genres (one chunk per lang, same ids; URLs differ via buildLocalizedUrl)
      const genresBuilding: any = await writeBuildingManifest({
        type: 'genres', language: lang,
        qualifiedLanguages: languages, qualifiedLanguagesHash: hash,
        chunks: genreData.totalUrls > 0 ? [genreData.chunk] : [],
        totalUrls: genreData.totalUrls,
      });
      if (genresBuilding?.status !== 'active') {
        await activateManifest(genresBuilding._id as string, 'genres', lang);
        activatedCount++;
      }

      // Main
      const mainBuilding: any = await writeBuildingManifest({
        type: 'main', language: lang,
        qualifiedLanguages: languages, qualifiedLanguagesHash: hash,
        chunks: [mainData.chunk], totalUrls: mainData.totalUrls,
      });
      if (mainBuilding?.status !== 'active') {
        await activateManifest(mainBuilding._id as string, 'main', lang);
        activatedCount++;
      }
    }

    // ZOMBIE CLEANUP (2026-05-09): retire any active SitemapManifest doc
    // whose language is no longer in the qualified set. Symptom this fixes:
    // an earlier deploy ran with 30+ qualified languages (pl, no, bg, lv, lt,
    // vi, te, mr, pa, af, bs, ...). After the AI-translation list was cut to
    // 14, those manifests stayed `status: 'active'` in Mongo and the
    // sitemap-index route kept emitting them — Bing/Google fetched them and
    // logged them as 0-URL or stale entries. Set them to 'retired' so the
    // index handler's `language: { $in: qualifiedLanguages }` filter no longer
    // surfaces them, and so getActiveManifest() can never return them.
    let retiredZombies = 0;
    try {
      retiredZombies = await pgRetireManifests(languages);
      await pgSeoCleanup();
      if (retiredZombies > 0) {
        logger.warn(`🧟 manifest-builder: retired ${retiredZombies} zombie manifest(s) for non-qualified languages`);
      }
    } catch (err) {
      logger.error('❌ manifest-builder: zombie cleanup failed (non-fatal)', err);
    }

    const elapsed = Date.now() - t0;
    logger.log(`✅ manifest-builder: built+activated all manifests in ${elapsed}ms (activated=${activatedCount}, retiredZombies=${retiredZombies})`);
    return { built: true, qualifiedLanguagesHash: hash, qualifiedLanguages: languages, perLangCounts, activatedCount, retiredZombies };

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
  const doc = await pgActiveManifest(type, language);
  if (!doc) return null;
  // Compute overall maxUpdatedAt across chunks
  const dates = doc.chunks
    .map((c: ISitemapManifestChunk) => c.maxUpdatedAt)
    .filter((d: Date | undefined): d is Date => d instanceof Date);
  const maxUpdatedAt = dates.length > 0
    ? new Date(Math.max(...dates.map((d: Date) => d.getTime())))
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
  stationIds: Array<string>;
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

/**
 * One tick of the scheduled refresh loop, extracted so tests can exercise the
 * post-build IndexNow ping decision without a live MongoDB. Always resolves;
 * IndexNow failures are logged but never bubble out (Task #272 + #362).
 *
 * @param builder Optional override for the manifest builder (test seam).
 *                Defaults to the real `buildAllSitemapManifests`.
 */
export async function runScheduledManifestRefreshTick(
  builder: () => ReturnType<typeof buildAllSitemapManifests> = buildAllSitemapManifests,
): Promise<void> {
  let result: Awaited<ReturnType<typeof buildAllSitemapManifests>>;
  try {
    result = await builder();
  } catch (err) {
    logger.error('❌ manifest-builder: scheduled rebuild failed', err);
    return;
  }
  // Task #272: ping IndexNow after the scheduled rebuild too — but only
  // when at least one (type, lang) manifest got swapped to a new active
  // version. Skipping the ping on no-op rebuilds avoids spamming
  // IndexNow every 6h with an unchanged sitemap (which would burn the
  // daily submission quota and look like spam to Bing).
  // Mirrors the manual /api/admin/sitemap/rebuild path's IndexNow ping
  // (added in task #201). Failures are logged but never fail the cron.
  if (result.built && (result.activatedCount ?? 0) > 0) {
    try {
      await IndexNowService.submitSitemaps(undefined, 'sitemap-regen');
      logger.log(`📣 manifest-builder: IndexNow sitemap ping fired after scheduled rebuild (activated=${result.activatedCount})`);
    } catch (err: any) {
      logger.error('manifest-builder: IndexNow sitemap ping failed after scheduled rebuild:', err?.message ?? err);
    }
  }
}

/** Background refresh trigger — call after server boot + periodic interval. */
let refreshTimer: NodeJS.Timeout | null = null;
export function startManifestRefreshLoop(intervalMs: number = 6 * 60 * 60 * 1000): void {
  if (refreshTimer) return;
  refreshTimer = setInterval(() => {
    void runScheduledManifestRefreshTick();
  }, intervalMs);
  logger.log(`⏰ manifest-builder: refresh loop started (every ${Math.round(intervalMs / 60000)}min)`);
}
