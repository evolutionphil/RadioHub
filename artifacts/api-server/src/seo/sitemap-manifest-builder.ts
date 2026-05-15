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
import { Station, Genre, SitemapManifest, ISitemapManifestChunk } from '@workspace/db-shared/mongo-schemas';
import { logger } from '../utils/logger';
import { IndexNowService } from '../services/indexnow';
import { getQualifiedLanguagesState, QualifiedLanguagesUnavailableError } from './qualified-languages';
import { getIndexableLanguagesForStation } from './junk-station-rules';
import { isWhitelistedGenreSlug, MIN_STATIONS_FOR_GENRE_INDEX } from './genre-whitelist';
import { RESERVED_GENRE_SLUGS } from './reserved-genre-slugs';
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
  //
  // FRESHNESS BUG FIX (2026-05-09): even though `version` (ETag) intentionally
  // excludes `maxUpdatedAt` to avoid cache stampedes from uptime-probe churn,
  // the OLD code returned the existing-active doc untouched — so its
  // `chunks[].maxUpdatedAt` (which DRIVES the sitemap <lastmod> and the
  // Last-Modified HTTP header) was frozen at whatever value the manifest had
  // when it was first written. Result observed in production: sitemap.xml
  // lastmod was 3+ months stale (2026-02-10) and per-chunk lastmods were
  // 9 months stale (2025-08-22), so Googlebot/Bingbot saw "no change" and
  // skipped re-crawls indefinitely → SEO ranking decay.
  //
  // Fix: when the URL set hasn't changed (version match), do an in-place
  // $set update of `chunks` (carries fresh maxUpdatedAt), `generatedAt`,
  // and `expiresAt`. The `version` field stays identical → the sitemap-index
  // ETag does NOT change → no cache stampede. But Last-Modified/<lastmod>
  // now reflect today's freshest station updatedAt → search engines see
  // proper freshness signals again.
  const existingActive = await SitemapManifest.findOne({
    type,
    language,
    status: 'active',
    version,
  }).lean();
  if (existingActive) {
    await SitemapManifest.updateOne(
      { _id: existingActive._id },
      {
        $set: {
          chunks,
          totalUrls,
          chunkCount: chunks.length,
          generatedAt: now,
          expiresAt: new Date(now.getTime() + MANIFEST_TTL_ACTIVE_MS),
          qualifiedLanguages,
          qualifiedLanguagesHash,
        },
      },
    );
    logger.debug(`✅ manifest freshness-bump: type=${type} lang=${language} version=${version} (chunks/lastmod refreshed in place)`);
    // Return updated view so callers see the new chunks/generatedAt.
    return {
      ...existingActive,
      chunks,
      totalUrls,
      chunkCount: chunks.length,
      generatedAt: now,
      qualifiedLanguages,
      qualifiedLanguagesHash,
    };
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
          { type, language, status: 'active' } as any,
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
    { type, language, status: 'active' } as any,
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

  // FRESHNESS FIX (2026-05-09): force PRIMARY read preference for the manifest
  // builder cursor. Without this, large catalog scans (60k+ stations) can be
  // routed to a secondary that hasn't yet replicated the latest writes from
  // the admin "Save station" / bulk import path. The freshness-bump branch in
  // `writeBuildingManifest` then commits a STALE id set into the manifest while
  // bumping `generatedAt` — admins see "lastmod updated" but the URL list
  // inside is the same as before. Reading from primary closes that race.
  // FRESHNESS BUG FIX (2026-05-09): `.allowDiskUse(true)` is REQUIRED here.
  // The catalog has ~60K active stations and the `votes:-1, _id:1` sort
  // exceeds Mongo Atlas' default 32MB in-memory sort budget, throwing
  // `QueryExceededMemoryLimitNoDiskUseAllowed` and crashing the entire
  // boot-time `buildAllSitemapManifests` call. Without this, every sitemap
  // rebuild silently returned 0 manifests and the served XML went stale.
  // ARCHITECT FIX (2026-05-10): force the {votes:-1} index via .hint() to
  // BYPASS the multiplanner. Without the hint, Mongo evaluates several
  // candidate plans during plan selection and one of them performs an
  // in-memory sort over the full 48k+ result set — blowing the 32MB
  // multiplanner budget with `QueryExceededMemoryLimitNoDiskUseAllowed`
  // (code 292). `.allowDiskUse(true)` does NOT help here because that
  // budget applies to the EXECUTION phase, not the plan-selection phase.
  // With `.hint({votes:-1})` Mongo skips multiplanner entirely and uses
  // the index immediately → no in-memory sort, no crash, and boot-time
  // `buildAllSitemapManifests` succeeds.
  // INCIDENT 2026-05-15 v10.2 round 7 — wrap cursor creation in a
  // factory so we can retry without the .hint() if the planner
  // rejects it with BadValue (code 2 — index hidden / renamed).
  // This codifies the "code 2 → retry unhinted" discipline from
  // replit.md for the only remaining hinted query in the codebase.
  const buildStationCursor = (useHint: boolean) => {
    const q = Station.find({
      slug: { $exists: true, $ne: '' },
      $or: [{ noIndex: { $exists: false } }, { noIndex: { $ne: true } }],
    })
      .select('_id slug name url homepage tags bitrate lastCheckOk lastCheckOkTime lastCheckTime country countryCode language languageCodes noIndex votes updatedAt logoAssets favicon descriptions')
      .sort({ votes: -1 });
    if (useHint) {
      // HINT-VERIFIED 2026-05-15 - {votes:-1} (key-spec hint, not name; survives Atlas index renames/hides)
      q.hint({ votes: -1 });
    }
    return q.read('primary').lean().cursor({ batchSize: 500 });
  };

  let cursor = buildStationCursor(true);
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
  try {
    await consume(cursor);
  } catch (err: any) {
    if (err?.code === 2 || err?.codeName === 'BadValue') {
      logger.warn(`[sitemap-builder] hinted Station cursor rejected (code=${err?.code}); retrying without index hint — ${err?.message || ''}`);
      processed = 0;
      buckets.forEach((b) => (b.length = 0));
      cursor = buildStationCursor(false);
      await consume(cursor);
    } else {
      throw err;
    }
  }
  logger.log(`📦 manifest-builder: scanned ${processed} indexable stations across ${qualifiedLanguages.length} langs`);

  const perLang = new Map<string, ISitemapManifestChunk[]>();
  const totalUrls = new Map<string, number>();

  for (const [lang, bucket] of buckets.entries()) {
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
  // Task #104: only publish genre URLs whose slug is on the curated whitelist
  // (real music/talk genres) AND that have at least MIN_STATIONS_FOR_GENRE_INDEX
  // stations backing them. The historical sitemap had ~8,824 slugs/lang derived
  // from raw station tags — ~80% of which were FM frequencies, city names,
  // station/brand names, or random noise. Those URLs are now dropped from
  // sitemaps; the SSR layer (seo-renderer.ts) noindex'es or 301's them.
  // ARCHITECT FIX (2026-05-10): same multiplanner-bypass as the Station
  // cursor — force the {stationCount:-1} index via .hint() so plan-eval
  // never tries an in-memory sort.
  // ARCHITECT FIX (2026-05-10, take 2): same blocking-SORT bug as the
  // Station cursor — drop `_id` tie-breaker so the {stationCount:-1}
  // index fully satisfies the sort with no in-memory SORT stage.
  // INCIDENT 2026-05-15 v10.2 round 7 — same retry-without-hint
  // pattern as the Station cursor above. If Atlas hides/renames the
  // {stationCount:-1} index, the planner throws BadValue (code 2);
  // we then re-issue without the hint so sitemap generation never
  // hard-fails on an index-audit.
  const buildGenreCursor = (useHint: boolean) => {
    const q = Genre.find({ slug: { $exists: true, $ne: '' } })
      .select('_id slug stationCount updatedAt')
      .sort({ stationCount: -1 });
    if (useHint) {
      // HINT-VERIFIED 2026-05-15 - {stationCount:-1} (key-spec hint, not name; survives Atlas index renames/hides)
      q.hint({ stationCount: -1 });
    }
    return q.lean().cursor({ batchSize: 500 });
  };

  const ids: mongoose.Types.ObjectId[] = [];
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
  try {
    await consumeGenres(buildGenreCursor(true));
  } catch (err: any) {
    if (err?.code === 2 || err?.codeName === 'BadValue') {
      logger.warn(`[sitemap-builder] hinted Genre cursor rejected (code=${err?.code}); retrying without index hint — ${err?.message || ''}`);
      scanned = 0; skippedNotWhitelisted = 0; skippedThin = 0;
      ids.length = 0; updatedAts.length = 0;
      await consumeGenres(buildGenreCursor(false));
    } else {
      throw err;
    }
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

// Static main pages — must mirror sitemap-main-:lang.xml route.
// Task #128: includes /faq, /contact, /privacy-policy, /terms-and-conditions,
// /applications so Google has a discovery path to those pages.
//
// /radios (NOT /stations) is the canonical listing path: the SPA mounts
// the listing at the literal /radios route (artifacts/megaradio/src/App.tsx
// ~line 255), and url-redirect-middleware Step 7 now 301s
// /lang/{station-singular} and /lang/{stations-plural} to
// /lang/{radios-translated}. Emitting /stations here would make every
// sitemap URL a 301 and trigger Google sitemap-redirect warnings.
const MAIN_STATIC_PAGES = ['', '/radios', '/genres', '/about', '/regions',
  '/regions/europe', '/regions/asia', '/regions/africa',
  '/regions/north-america', '/regions/south-america', '/regions/oceania',
  '/faq', '/contact', '/privacy-policy', '/terms-and-conditions', '/applications'];

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
  stationIds: Array<mongoose.Types.ObjectId | string>,
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
    const rows: Array<{ _id: string; count: number; maxUpdatedAt?: Date }> = await Station.aggregate([
      { $match: {
          country: { $exists: true, $ne: '' },
          $or: [{ noIndex: { $exists: false } }, { noIndex: { $ne: true } }],
          $and: [
            { $or: [{ isJunk: { $exists: false } }, { isJunk: { $ne: true } }] },
            { $or: [{ lastCheckOk: { $exists: false } }, { lastCheckOk: { $ne: false } }] },
          ],
      } },
      { $group: { _id: '$country', count: { $sum: 1 }, maxUpdatedAt: { $max: '$updatedAt' } } },
      { $sort: { count: -1, _id: 1 } },
      { $limit: limit * 2 },
    ]).allowDiskUse(true);

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
    return { entries: [], rawCountryNames: [] };
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
        await activateManifest(stationsBuilding._id as mongoose.Types.ObjectId, 'stations', lang);
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
        await activateManifest(genresBuilding._id as mongoose.Types.ObjectId, 'genres', lang);
        activatedCount++;
      }

      // Main
      const mainBuilding: any = await writeBuildingManifest({
        type: 'main', language: lang,
        qualifiedLanguages: languages, qualifiedLanguagesHash: hash,
        chunks: [mainData.chunk], totalUrls: mainData.totalUrls,
      });
      if (mainBuilding?.status !== 'active') {
        await activateManifest(mainBuilding._id as mongoose.Types.ObjectId, 'main', lang);
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
      const zombieRes = await SitemapManifest.updateMany(
        { status: 'active', language: { $nin: languages } },
        { $set: { status: 'retired', retiredAt: new Date() } },
      );
      retiredZombies = zombieRes.modifiedCount ?? 0;
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
