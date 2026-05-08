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

import {
  SitemapUrlSnapshot,
  SitemapManifest,
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

export interface SitemapDiffPerLangResult {
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

  for (const language of qualifiedLanguages) {
    const manifest = await SitemapManifest.findOne({ type: 'main', language, status: 'active' })
      .sort({ generatedAt: -1 })
      .lean();
    if (!manifest) {
      logger.log(`⏭️ sitemap-diff: no active main manifest for lang=${language}, skipping`);
      continue;
    }

    const topCountries = manifest.chunks.length > 0
      ? extractTopCountriesFromChunk(manifest.chunks[0].stationIds)
      : [];
    const todayUrls = computeMainSitemapUrls({ language, topCountries, translations });

    const snapshot = await SitemapUrlSnapshot.findOne({ type: 'main', language }).lean();
    const previousUrls = snapshot?.urls ?? [];
    const additions = diffUrlSets(previousUrls, todayUrls);

    const result: SitemapDiffPerLangResult = {
      language,
      todayCount: todayUrls.length,
      previousCount: previousUrls.length,
      additions,
      submitted: false,
    };

    // Track URLs we can confidently mark as "submitted" — only successful
    // batches advance the baseline so a transient IndexNow outage doesn't
    // permanently drop unsent URLs from future diffs.
    const successfullySubmitted: string[] = [];

    if (additions.length === 0) {
      logger.log(`✅ sitemap-diff: lang=${language} no new URLs (today=${todayUrls.length}, prev=${previousUrls.length})`);
    } else if (dryRun) {
      logger.log(`🟡 sitemap-diff: lang=${language} DRY_RUN — ${additions.length} new URL(s) would be submitted`);
    } else {
      logger.log(`📡 sitemap-diff: lang=${language} submitting ${additions.length} new URL(s) to IndexNow…`);
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
          logger.warn(`⚠️ sitemap-diff: lang=${language} batch ${i + 1}/${batches.length} failed: ${lastError}`);
        }
      }
      result.submitted = true;
      result.submitSuccess = allOk;
      if (!allOk) result.submitError = lastError;
    }

    // Snapshot semantics (architect-2026-05 fix): the baseline tracks URLs we
    // have confirmed-submitted to IndexNow. We move it forward by:
    //   - keeping every previously-tracked URL that is still in today's set
    //     (URLs that have left the sitemap drop out automatically), AND
    //   - adding URLs whose submission this run was successful.
    // URLs whose batch failed STAY OUT of the snapshot, so the next nightly
    // diff re-includes them as additions and retries the ping. This trades
    // a small risk of duplicate submissions (next run if Bing already
    // accepted the failed batch retroactively) for guaranteed eventual
    // delivery during transient outages — IndexNow is explicitly
    // documented to be safe to re-submit.
    if (!dryRun) {
      const todaySet = new Set(todayUrls);
      const carriedOver = previousUrls.filter((u) => todaySet.has(u));
      const nextSnapshot = Array.from(new Set([...carriedOver, ...successfullySubmitted])).sort();
      await SitemapUrlSnapshot.updateOne(
        { type: 'main', language },
        {
          $set: {
            urls: nextSnapshot,
            urlCount: nextSnapshot.length,
            generatedAt: new Date(),
            updatedAt: new Date(),
          },
          $setOnInsert: { type: 'main', language },
        },
        { upsert: true },
      );
    }

    totalAdditions += additions.length;
    perLanguage.push(result);
  }

  const finishedAt = new Date();
  const durationMs = finishedAt.getTime() - startedAt.getTime();
  logger.log(`🏁 sitemap-diff: done in ${durationMs}ms — ${totalAdditions} total addition(s) across ${perLanguage.length} language(s)`);
  return { startedAt, finishedAt, durationMs, totalAdditions, perLanguage };
}
