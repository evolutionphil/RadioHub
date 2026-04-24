/**
 * Centralized source of truth for "qualifiedLanguages" — the set of UI
 * languages whose SEO translations are complete enough to ship to crawlers.
 *
 * Previously this cache lived as a closure inside
 * `server/routes/seo-sitemap-routes.ts` and was only reachable from the
 * sitemap handlers. The SSR renderer had no way to consult it, so per-station
 * hreflang alternates were restricted by eligibility alone — NOT by
 * (eligibility ∩ qualified). That caused SSR to advertise language variants
 * that the sitemap was (correctly) excluding, reintroducing the exact
 * "Crawled - currently not indexed" URLs the sitemap gate was meant to block.
 *
 * Architect P0 mandate: `getIndexableLanguagesForStation(station, qualifiedLangs)`
 * is the unified indexability gate. Every caller (sitemap, SSR robots, SSR
 * hreflang, 410 handler) MUST pass `qualifiedLangs` from this module so the
 * answer is identical on every surface.
 */

import { performanceCache } from '../performance-cache';
import {
  ACTIVE_SITEMAP_LANGUAGES,
  hasCompleteSeoTranslations,
} from '../../shared/seo-config';
import { logger } from '../utils/logger';

interface QualifiedLangCache {
  value: string[];
  expiresAt: number;
}

let qualifiedLangCache: QualifiedLangCache | null = null;
const CACHE_TTL_MS = 10 * 60 * 1000;

interface ComputeResult {
  value: string[];
  /** True when we fell back to the full enabled-language set because the
   * translation cache returned zero complete languages (cold cache, DB miss,
   * etc.). Callers that need a cacheable answer should NOT cache a fallback
   * result — we want to re-probe the real cache shortly after. */
  isFallback: boolean;
}

async function computeQualifiedLanguages(): Promise<ComputeResult> {
  const qualified: string[] = [];
  for (const lang of ACTIVE_SITEMAP_LANGUAGES as unknown as string[]) {
    try {
      const translations = await performanceCache.getTranslations(lang);
      if (hasCompleteSeoTranslations(translations)) {
        qualified.push(lang);
      }
    } catch (err) {
      logger.warn(
        `⚠️ qualified-languages: skipping ${lang} — translation load failed`,
      );
    }
  }
  logger.log(
    `✅ qualified-languages: ${qualified.length}/${ACTIVE_SITEMAP_LANGUAGES.length} langs have complete SEO translations`,
  );

  // Fail-open safety net: if the translation cache is cold (dev bootstrap,
  // transient DB miss), returning `[]` would noindex every station on every
  // surface — far worse than accepting the full enabled-language set until
  // the cache warms up. Caller is told this was a fallback so it can skip
  // caching.
  if (qualified.length === 0) {
    logger.warn(
      '⚠️ qualified-languages: zero languages qualified — falling back to ACTIVE_SITEMAP_LANGUAGES (cache likely cold; will re-probe on next call)',
    );
    return {
      value: (ACTIVE_SITEMAP_LANGUAGES as unknown as string[]).slice(),
      isFallback: true,
    };
  }
  return { value: qualified, isFallback: false };
}

/**
 * Returns the cached list of qualified languages. Short 10-minute TTL — admin
 * translation updates propagate within 10 minutes without a restart.
 *
 * Fallback results (see `computeQualifiedLanguages`) are NEVER cached so the
 * next call re-probes the translation cache and picks up the real qualified
 * set once translations finish warming.
 */
export async function getCachedQualifiedLanguages(): Promise<string[]> {
  const now = Date.now();
  if (qualifiedLangCache && qualifiedLangCache.expiresAt > now) {
    return qualifiedLangCache.value;
  }
  const { value, isFallback } = await computeQualifiedLanguages();
  if (!isFallback) {
    qualifiedLangCache = { value, expiresAt: now + CACHE_TTL_MS };
  }
  return value;
}

/**
 * Synchronous helper for hot paths (SSR) that already awaited the cache
 * earlier in the request and just want the latest cached value without
 * re-awaiting. Returns `null` if the cache is cold — caller must fall back
 * to `await getCachedQualifiedLanguages()`.
 */
export function getCachedQualifiedLanguagesSync(): string[] | null {
  const now = Date.now();
  if (qualifiedLangCache && qualifiedLangCache.expiresAt > now) {
    return qualifiedLangCache.value;
  }
  return null;
}
