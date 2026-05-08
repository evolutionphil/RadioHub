/**
 * Task #190 — diff today's `/sitemap-main-{lang}.xml` URL set against the
 * previously-submitted snapshot and ping IndexNow with just the additions.
 *
 * The active `main` SitemapManifest already records the URL set it produced
 * (static pages are constant; top-country region/country pairs live in
 * `chunks[0].stationIds` as `tc:<region>/<country>` markers). This module
 * derives the canonical /{lang}/... URLs from the manifest, compares them
 * against the previous run's snapshot stored in `SitemapUrlSnapshot`, and
 * submits only the new URLs to IndexNow with a `sitemap-diff` trigger.
 *
 * Submissions are batched per-language under IndexNow's 10k-URL hard cap
 * (we never approach it for a `main` sitemap, but the chunking keeps the
 * pattern consistent with `indexnow-resubmit-task-152.ts`).
 */

import mongoose from 'mongoose';
import {
  SitemapUrlSnapshot,
  SitemapManifest,
  Genre,
} from '@workspace/db-shared/mongo-schemas';
import { logger } from '../utils/logger';
import { performanceCache } from '../performance-cache';
import { URL_TRANSLATIONS } from '@workspace/seo-shared/url-translations';
import { buildLocalizedUrl } from '../seo/url-helpers';
import {
  extractTopCountriesFromChunk,
  buildAllSitemapManifests,
} from '../seo/sitemap-manifest-builder';
import { IndexNowService } from './indexnow';
import { getQualifiedLanguagesState, QualifiedLanguagesUnavailableError } from '../seo/qualified-languages';

// Mirror the route's MAIN_STATIC_PAGES list (kept in sync with
// `MAIN_STATIC_PAGES` in `seo/sitemap-manifest-builder.ts` and the
// `mainPages` array in `routes/seo-sitemap-routes.ts`).
const STATIC_MAIN_PAGES = [
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

const HOST = 'themegaradio.com';
const BASE_URL = `https://${HOST}`;
// IndexNow hard cap is 10k URLs/request; chunk well under it.
const SUBMIT_CHUNK_SIZE = 1000;

export type SitemapDiffType = 'main' | 'genres';

export interface SitemapDiffPerLangResult {
  type: SitemapDiffType;
  language: string;
  todayCount: number;
  previousCount: number;
  additions: string[];
  submitted: boolean;
  submitSuccess?: boolean;
  submitError?: string;
}

export interface SitemapDiffSummary {
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
  totalAdditions: number;
  perLanguage: SitemapDiffPerLangResult[];
  skippedReason?: string;
}

/** Pure helper — given previous and current URL sets, return the additions
 * (URLs in `current` but not in `previous`). Sorted for deterministic output. */
export function diffUrlSets(previous: Iterable<string>, current: Iterable<string>): string[] {
  const prev = new Set<string>();
  for (const u of previous) prev.add(u);
  const additions: string[] = [];
  for (const u of current) {
    if (!prev.has(u)) additions.push(u);
  }
  additions.sort();
  return additions;
}

/** Build the canonical URL set that the live `/sitemap-main-{lang}.xml`
 * route would emit for the given language, derived from the active main
 * manifest's chunks (static pages + top-country markers). */
export function computeMainSitemapUrls(args: {
  language: string;
  topCountries: Array<{ regionSlug: string; countrySlug: string }>;
  translations: Map<string, string>;
  baseUrl?: string;
}): string[] {
  const { language, topCountries, translations } = args;
  const baseUrl = args.baseUrl ?? BASE_URL;
  const out: string[] = [];
  for (const page of STATIC_MAIN_PAGES) {
    const path = buildLocalizedUrl(page, language, undefined, translations);
    out.push(`${baseUrl}${path}`);
  }
  for (const { regionSlug, countrySlug: cSlug } of topCountries) {
    const path = buildLocalizedUrl(`/regions/${regionSlug}/${cSlug}`, language, undefined, translations);
    out.push(`${baseUrl}${path}`);
  }
  // Stable order so snapshots compare cleanly across runs.
  out.sort();
  return out;
}

/** Match the SAFE_SLUG_RE filter applied by the live `/sitemap-genres-{lang}.xml`
 * route — historical Genre.slug values derived from raw station tags can
 * contain XML-unsafe characters (e.g. `"`), and the route drops them before
 * emitting <loc> entries. The diff helper must mirror that filter so the
 * tracked URL set never contains a URL the live sitemap would never publish. */
const SAFE_GENRE_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isSafeGenreSlug(slug: string | undefined | null): boolean {
  return !!slug && SAFE_GENRE_SLUG_RE.test(slug);
}

/** Build the canonical URL set that the live `/sitemap-genres-{lang}.xml`
 * route would emit for the given language. Pure helper — caller is
 * responsible for resolving Genre._id → slug and pre-filtering for safe slugs.
 * Results are sorted for deterministic snapshots. */
export function computeGenresSitemapUrls(args: {
  language: string;
  genreSlugs: Iterable<string>;
  translations: Map<string, string>;
  baseUrl?: string;
}): string[] {
  const { language, genreSlugs, translations } = args;
  const baseUrl = args.baseUrl ?? BASE_URL;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const slug of genreSlugs) {
    if (!isSafeGenreSlug(slug)) continue;
    if (seen.has(slug)) continue;
    seen.add(slug);
    const path = buildLocalizedUrl(`/genres/${slug}`, language, undefined, translations);
    out.push(`${baseUrl}${path}`);
  }
  out.sort();
  return out;
}

async function loadUrlTranslationMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const db = await performanceCache.getUrlTranslations();
    for (const [k, v] of db.entries()) map.set(k, v);
  } catch (err) {
    logger.log('⚠️ sitemap-diff: performanceCache.getUrlTranslations failed, falling back to static URL_TRANSLATIONS only:', (err as Error).message);
  }
  for (const [lang, translations] of Object.entries(URL_TRANSLATIONS)) {
    for (const [english, translated] of Object.entries(translations)) {
      const key = `${lang}:${english}`;
      if (!map.has(key)) map.set(key, translated);
    }
  }
  return map;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Execute the diff + submit pass.
 *
 * @param opts.ensureManifestFresh  If true, run `buildAllSitemapManifests()`
 *                                  first so the diff reflects the latest
 *                                  station/country leaderboard. Defaults true.
 * @param opts.dryRun               If true, compute additions but DO NOT submit
 *                                  to IndexNow and DO NOT persist new snapshots.
 */
export async function runSitemapDiffSubmission(opts: {
  ensureManifestFresh?: boolean;
  dryRun?: boolean;
} = {}): Promise<SitemapDiffSummary> {
  const startedAt = new Date();
  const ensureManifestFresh = opts.ensureManifestFresh ?? true;
  const dryRun = !!opts.dryRun;
  const perLanguage: SitemapDiffPerLangResult[] = [];

  if (ensureManifestFresh) {
    try {
      await buildAllSitemapManifests();
    } catch (err) {
      logger.warn('⚠️ sitemap-diff: manifest rebuild failed, continuing with existing active manifests:', (err as Error).message);
    }
  }

  let qualifiedLanguages: string[];
  try {
    const state = await getQualifiedLanguagesState();
    qualifiedLanguages = state.languages;
  } catch (err) {
    if (err instanceof QualifiedLanguagesUnavailableError) {
      const finishedAt = new Date();
      logger.warn('⚠️ sitemap-diff: qualified-languages unavailable, skipping run');
      return {
        startedAt,
        finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        totalAdditions: 0,
        perLanguage,
        skippedReason: 'qualified-languages-unavailable',
      };
    }
    throw err;
  }

  const translations = await loadUrlTranslationMap();
  let totalAdditions = 0;

  // Resolve genre _id → slug ONCE per run (shared across all languages, since
  // the active genres manifest stores the same id set for every language).
  const genreSlugsById = await loadGenreSlugsForActiveManifest();

  for (const language of qualifiedLanguages) {
    // ---- main ----
    const mainManifest = await SitemapManifest.findOne({ type: 'main', language, status: 'active' })
      .sort({ generatedAt: -1 })
      .lean();
    if (!mainManifest) {
      logger.log(`⏭️ sitemap-diff: no active main manifest for lang=${language}, skipping main`);
    } else {
      const topCountries = mainManifest.chunks.length > 0
        ? extractTopCountriesFromChunk(mainManifest.chunks[0].stationIds)
        : [];
      const todayUrls = computeMainSitemapUrls({ language, topCountries, translations });
      const result = await processLanguageDiff({ type: 'main', language, todayUrls, dryRun });
      totalAdditions += result.additions.length;
      perLanguage.push(result);
    }

    // ---- genres (task #253) ----
    const genresManifest = await SitemapManifest.findOne({ type: 'genres', language, status: 'active' })
      .sort({ generatedAt: -1 })
      .lean();
    if (!genresManifest) {
      logger.log(`⏭️ sitemap-diff: no active genres manifest for lang=${language}, skipping genres`);
    } else {
      const manifestIds: Array<mongoose.Types.ObjectId | string> = [];
      for (const c of genresManifest.chunks) {
        for (const id of c.stationIds) manifestIds.push(id);
      }
      const slugs = mapGenreIdsToSlugs(manifestIds, genreSlugsById);
      const todayUrls = computeGenresSitemapUrls({ language, genreSlugs: slugs, translations });
      const result = await processLanguageDiff({ type: 'genres', language, todayUrls, dryRun });
      totalAdditions += result.additions.length;
      perLanguage.push(result);
    }
  }

  const finishedAt = new Date();
  const durationMs = finishedAt.getTime() - startedAt.getTime();
  logger.log(`🏁 sitemap-diff: done in ${durationMs}ms — ${totalAdditions} total addition(s) across ${perLanguage.length} (type, language) pair(s)`);
  return { startedAt, finishedAt, durationMs, totalAdditions, perLanguage };
}

/** Process one (type, language) diff: compare today's URLs against the
 * persisted snapshot, optionally submit additions to IndexNow, and advance
 * the snapshot baseline. Snapshot semantics mirror the original main-only
 * implementation: only successfully-submitted URLs are added to the next
 * baseline so that a transient IndexNow outage retries on the next run. */
async function processLanguageDiff(args: {
  type: SitemapDiffType;
  language: string;
  todayUrls: string[];
  dryRun: boolean;
}): Promise<SitemapDiffPerLangResult> {
  const { type, language, todayUrls, dryRun } = args;

  const snapshot = await SitemapUrlSnapshot.findOne({ type, language }).lean();
  const previousUrls = snapshot?.urls ?? [];
  const additions = diffUrlSets(previousUrls, todayUrls);

  const result: SitemapDiffPerLangResult = {
    type,
    language,
    todayCount: todayUrls.length,
    previousCount: previousUrls.length,
    additions,
    submitted: false,
  };

  const successfullySubmitted: string[] = [];

  if (additions.length === 0) {
    logger.log(`✅ sitemap-diff: type=${type} lang=${language} no new URLs (today=${todayUrls.length}, prev=${previousUrls.length})`);
  } else if (dryRun) {
    logger.log(`🟡 sitemap-diff: type=${type} lang=${language} DRY_RUN — ${additions.length} new URL(s) would be submitted`);
  } else {
    logger.log(`📡 sitemap-diff: type=${type} lang=${language} submitting ${additions.length} new URL(s) to IndexNow…`);
    const batches = chunk(additions, SUBMIT_CHUNK_SIZE);
    let allOk = true;
    let lastError: string | undefined;
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const submit = await IndexNowService.submitToIndexNow(batch, 'sitemap-diff');
      if (submit.success) {
        for (const u of batch) successfullySubmitted.push(u);
      } else {
        allOk = false;
        lastError = submit.error ?? 'unknown error';
        logger.warn(`⚠️ sitemap-diff: type=${type} lang=${language} batch ${i + 1}/${batches.length} failed: ${lastError}`);
      }
    }
    result.submitted = true;
    result.submitSuccess = allOk;
    if (!allOk) result.submitError = lastError;
  }

  if (!dryRun) {
    const todaySet = new Set(todayUrls);
    const carriedOver = previousUrls.filter((u) => todaySet.has(u));
    const nextSnapshot = Array.from(new Set([...carriedOver, ...successfullySubmitted])).sort();
    await SitemapUrlSnapshot.updateOne(
      { type, language },
      {
        $set: {
          urls: nextSnapshot,
          urlCount: nextSnapshot.length,
          generatedAt: new Date(),
          updatedAt: new Date(),
        },
        $setOnInsert: { type, language },
      },
      { upsert: true },
    );
  }

  return result;
}

/** Resolve manifest genre ids → slugs in their original on-disk order,
 * dropping any id whose Genre is missing or whose slug failed to resolve.
 * Pure helper so the manifest→slug step is independently testable. */
export function mapGenreIdsToSlugs(
  manifestIds: ReadonlyArray<mongoose.Types.ObjectId | string>,
  slugsById: ReadonlyMap<string, string>,
): string[] {
  const out: string[] = [];
  for (const id of manifestIds) {
    const slug = slugsById.get(String(id));
    if (slug) out.push(slug);
  }
  return out;
}

type GenreIdLookup = mongoose.Types.ObjectId | string;
interface GenreIdSlugDoc { _id: GenreIdLookup; slug?: string }

/** Collect every Genre._id referenced by an active genres manifest while
 * PRESERVING the original BSON type (ObjectId vs legacy string slug). The
 * raw Mongo `$in` query only matches when the value's BSON type matches the
 * stored `_id` — stringifying ObjectIds breaks the match. */
function collectManifestGenreIds(
  manifests: ReadonlyArray<{ chunks: ReadonlyArray<{ stationIds: ReadonlyArray<GenreIdLookup> }> }>,
): GenreIdLookup[] {
  const seen = new Set<string>();
  const out: GenreIdLookup[] = [];
  for (const m of manifests) {
    for (const c of m.chunks) {
      for (const id of c.stationIds) {
        const key = String(id);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(id);
      }
    }
  }
  return out;
}

/** Resolve every Genre._id referenced by ANY active genres manifest into its
 * slug. Done once per run because all per-language genres manifests share the
 * same id set (URLs differ only in path localization). Returns a map keyed by
 * String(_id) for cheap lookups regardless of ObjectId vs legacy-string ids. */
async function loadGenreSlugsForActiveManifest(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const manifests = await SitemapManifest.find({ type: 'genres', status: 'active' })
    .select('chunks')
    .lean();
  // Preserve BSON types — see collectManifestGenreIds JSDoc.
  const ids = collectManifestGenreIds(
    manifests as Array<{ chunks: Array<{ stationIds: GenreIdLookup[] }> }>,
  );
  if (ids.length === 0) return out;
  // Genre._id is mixed (ObjectId for new docs, string slugs like 'genre-pop'
  // for legacy seed data). Use the raw collection to bypass mongoose's strict
  // ObjectId casting on the $in array (mirrors the live route at
  // routes/seo-sitemap-routes.ts /sitemap-genres-:lang.xml).
  // Genre.collection types `_id` as ObjectId, but the underlying collection
  // accepts the mixed-shape array — cast the filter to satisfy the driver
  // typings without losing the BSON types of the values themselves.
  const docs = await Genre.collection
    .find<GenreIdSlugDoc>(
      { _id: { $in: ids as mongoose.Types.ObjectId[] } },
      { projection: { _id: 1, slug: 1 } },
    )
    .toArray();
  for (const d of docs) {
    const slug = d.slug;
    if (typeof slug === 'string' && slug.length > 0) {
      out.set(String(d._id), slug);
    }
  }
  return out;
}
