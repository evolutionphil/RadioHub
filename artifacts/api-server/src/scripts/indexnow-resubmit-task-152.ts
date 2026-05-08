/**
 * Task #152 — one-shot IndexNow re-submission.
 *
 * After Task #128 expanded `/sitemap-main-{lang}.xml` to include the
 * previously-orphaned static pages (FAQ, Contact, Privacy, Terms,
 * Applications) and the top ~30 country region pages, we need to nudge the
 * IndexNow-aware engines (Bing/Yandex) to re-crawl the new URLs without
 * waiting for the next scheduled sitemap regeneration.
 *
 * The script:
 *   1. Pings `/sitemap-index.xml` (IndexNow sitemap notification).
 *   2. Submits the canonical /{lang}/{path} URL for every static main page
 *      across every active sitemap language.
 *   3. Submits the top ~30 country region URLs (/{lang}/regions/<region>/<country>)
 *      across every active sitemap language, computed from the same Mongo
 *      aggregation used by the live sitemap.
 *
 * Google Search Console does NOT consume IndexNow — the GSC "Resubmit
 * sitemap" action for `/sitemap-index.xml` is a manual step and must be
 * performed in the GSC UI for `themegaradio.com`. See the runbook entry
 * in `BACKFILL_RUNBOOK.md` (section "IndexNow re-submission (Task #152)").
 *
 * Idempotent — safe to re-run; submissions are batched per IndexNow's
 * 10k-URL-per-request cap.
 *
 * Usage (production):
 *   pnpm --filter @workspace/api-server run indexnow:task-152
 *
 * Dry-run (logs URLs without sending):
 *   DRY_RUN=1 pnpm --filter @workspace/api-server run indexnow:task-152
 *
 * Environment: requires `MONGODB_URI` (or `MONGO_URI` / `DATABASE_URL`).
 */

import mongoose from 'mongoose';
import { Station } from '@workspace/db-shared/mongo-schemas';
import { ACTIVE_SITEMAP_LANGUAGES } from '@workspace/seo-shared/seo-config';
import { buildLocalizedUrl } from '../seo/url-helpers';
import {
  canonicalizeCountry,
  countrySlug,
  getRegionSlugForCountry,
} from '@workspace/seo-shared/country-regions';
import { performanceCache } from '../performance-cache';
import { URL_TRANSLATIONS } from '@workspace/seo-shared/url-translations';
import { IndexNowService } from '../services/indexnow';
import { logger } from '../utils/logger';

const DRY_RUN =
  process.env.DRY_RUN === '1' ||
  process.env.DRY_RUN === 'true' ||
  process.env.DRY_RUN === 'yes';

const HOST = 'themegaradio.com';
const BASE_URL = `https://${HOST}`;

// Static main pages added/expanded by Task #128. Keep in sync with
// `mainPages` in `routes/seo-sitemap-routes.ts` (sitemap-main-{lang}.xml)
// and `MAIN_STATIC_PAGES` in `seo/sitemap-manifest-builder.ts`.
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

const TOP_COUNTRY_LIMIT = 30;
// IndexNow has a hard 10k cap per request; chunk well under it so logs and
// Bing's per-host throttle stay friendly.
const SUBMIT_CHUNK_SIZE = 1000;

async function loadUrlTranslationMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const db = await performanceCache.getUrlTranslations();
    for (const [k, v] of db.entries()) map.set(k, v);
  } catch (err) {
    logger.log('⚠️ task-152: performanceCache.getUrlTranslations failed, falling back to static URL_TRANSLATIONS only:', (err as Error).message);
  }
  for (const [lang, translations] of Object.entries(URL_TRANSLATIONS)) {
    for (const [english, translated] of Object.entries(translations)) {
      const key = `${lang}:${english}`;
      if (!map.has(key)) map.set(key, translated);
    }
  }
  return map;
}

async function getTopCountries(limit: number): Promise<Array<{ regionSlug: string; countrySlug: string }>> {
  const rows: Array<{ _id: string; count: number }> = await Station.aggregate([
    {
      $match: {
        country: { $exists: true, $ne: '' },
        $or: [{ noIndex: { $exists: false } }, { noIndex: { $ne: true } }],
      },
    },
    { $group: { _id: '$country', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: limit * 2 },
  ]).allowDiskUse(true);

  const out: Array<{ regionSlug: string; countrySlug: string }> = [];
  const seen = new Set<string>();
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
    out.push({ regionSlug: region, countrySlug: slug });
    if (out.length >= limit) break;
  }
  return out;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function main(): Promise<void> {
  const mongoUri =
    process.env.MONGODB_URI ||
    process.env.MONGO_URI ||
    process.env.DATABASE_URL;
  if (!mongoUri) {
    throw new Error('MONGODB_URI (or MONGO_URI / DATABASE_URL) must be set');
  }

  logger.log(`🚀 task-152: connecting to MongoDB${DRY_RUN ? ' (DRY_RUN)' : ''}…`);
  await mongoose.connect(mongoUri);

  try {
    const translations = await loadUrlTranslationMap();
    const topCountries = await getTopCountries(TOP_COUNTRY_LIMIT);
    logger.log(`🌍 task-152: top-${topCountries.length} countries resolved (limit ${TOP_COUNTRY_LIMIT})`);

    const langs = ACTIVE_SITEMAP_LANGUAGES as readonly string[];
    const urls = new Set<string>();

    for (const lang of langs) {
      for (const page of STATIC_MAIN_PAGES) {
        const path = buildLocalizedUrl(page, lang, undefined, translations);
        urls.add(`${BASE_URL}${path}`);
      }
      for (const { regionSlug, countrySlug: cSlug } of topCountries) {
        const path = buildLocalizedUrl(`/regions/${regionSlug}/${cSlug}`, lang, undefined, translations);
        urls.add(`${BASE_URL}${path}`);
      }
    }

    const urlList = Array.from(urls).sort();
    logger.log(`📦 task-152: built ${urlList.length} unique URLs across ${langs.length} languages`);

    if (DRY_RUN) {
      for (const u of urlList.slice(0, 20)) logger.log(`   • ${u}`);
      if (urlList.length > 20) logger.log(`   …and ${urlList.length - 20} more`);
      logger.log('🟡 task-152: DRY_RUN set — skipping IndexNow submission and sitemap ping');
      return;
    }

    logger.log(`📡 task-152: pinging IndexNow with /sitemap-index.xml…`);
    const sitemapResult = await IndexNowService.submitSitemaps(HOST, 'manual');
    logger.log(`   → success=${sitemapResult.success} ${sitemapResult.message ?? sitemapResult.error ?? ''}`);

    const batches = chunk(urlList, SUBMIT_CHUNK_SIZE);
    let successBatches = 0;
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      logger.log(`📡 task-152: submitting batch ${i + 1}/${batches.length} (${batch.length} URLs)…`);
      const result = await IndexNowService.submitToIndexNow(batch, 'manual');
      if (result.success) {
        successBatches++;
        logger.log(`   ✅ ${result.message ?? 'ok'}`);
      } else {
        logger.log(`   ❌ ${result.error ?? 'failed'}`);
      }
    }

    logger.log(`🏁 task-152: done — ${successBatches}/${batches.length} URL batches succeeded, sitemap-index ping=${sitemapResult.success ? 'ok' : 'failed'}`);
    logger.log('ℹ️ task-152: GSC sitemap re-submission is a manual step — see BACKFILL_RUNBOOK.md.');
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  logger.error('❌ task-152: fatal error:', err);
  process.exit(1);
});
