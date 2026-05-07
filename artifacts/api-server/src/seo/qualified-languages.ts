/**
 * Centralized source of truth for "qualifiedLanguages" — the set of UI
 * languages whose SEO translations are complete enough to ship to crawlers.
 *
 * ============================================================================
 * FAIL-CLOSED + DB-BACKED LKG (Last-Known-Good) — refactored 2026-04-30
 * ============================================================================
 * Previous behavior was fail-OPEN: when the in-memory cache was cold AND the
 * live computation returned zero qualified languages (DB miss, translation
 * cache cold, etc.), it returned the FULL `ACTIVE_SITEMAP_LANGUAGES` list
 * (49 entries). This caused:
 *
 *   1. /sitemap-index.xml emitted 2550 entries (49 langs × 50 chunks + 49
 *      main + 49 genres).
 *   2. Cloudflare cached this stale 49-language index for 24h.
 *   3. ~5 minutes later the in-memory cache warmed up to the real 10 qualified
 *      languages.
 *   4. Child sitemap routes (`/sitemap-stations-pa-1.xml`, etc.) returned
 *      404 "Language not found" for the 39 non-qualified languages.
 *   5. Bing Webmaster Tools reported 1023 sitemap errors/warnings; Google
 *      Search Console reported the same pattern.
 *
 * The new behavior is fail-CLOSED with DB-backed Last-Known-Good fallback:
 *
 *   - Live compute -> non-empty -> save as LKG -> cache + return.
 *   - Live compute -> empty + LKG present -> return LKG (do NOT cache short-term;
 *     re-probe on next request).
 *   - Live compute -> empty + no LKG -> throw `QualifiedLanguagesUnavailableError`.
 *     Sitemap routes catch this and return 503 + Retry-After: 300 + no-store.
 *
 * Architect P0 mandate: `getIndexableLanguagesForStation(station, qualifiedLangs)`
 * is the unified indexability gate. Every caller (sitemap, SSR robots, SSR
 * hreflang, 410 handler) MUST pass `qualifiedLangs` from this module so the
 * answer is identical on every surface.
 */

import crypto from 'crypto';
import { performanceCache } from '../performance-cache';
import {
  ACTIVE_SITEMAP_LANGUAGES,
  hasCompleteSeoTranslations,
} from '../shared/seo-config';
import { logger } from '../utils/logger';
import { SeoQualifiedLanguagesLkg } from '../shared/mongo-schemas';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------
export class QualifiedLanguagesUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QualifiedLanguagesUnavailableError';
  }
}

export interface QualifiedLanguagesState {
  languages: string[];
  hash: string;
  source: 'computed' | 'lkg' | 'seed';
  computedAt: Date;
  expiresAt: Date | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const LKG_KEY = 'qualified_languages';
const CACHE_TTL_MS = 10 * 60 * 1000;          // 10 minutes
const LKG_TTL_MS = 30 * 24 * 60 * 60 * 1000;  // 30 days
const DRIFT_WINDOW_MS = 60 * 60 * 1000;       // 1 hour
const DRIFT_FLAP_THRESHOLD = 3;               // 3+ changes/hour = flap alert

/** Emergency seed used ONLY by `seedQualifiedLanguagesLkg()` when the DB has
 * never been populated. Never used at runtime as a silent fallback. */
export const EMERGENCY_SEED_QUALIFIED_LANGUAGES: readonly string[] = [
  'ar', 'de', 'en', 'es', 'fr', 'it', 'nl', 'pt', 'ru', 'tr',
];

// ---------------------------------------------------------------------------
// In-memory state
// ---------------------------------------------------------------------------
let memoryCache: { state: QualifiedLanguagesState; expiresAt: number } | null = null;
let lastHash: string | null = null;
let driftHistory: number[] = []; // timestamps of hash changes within DRIFT_WINDOW_MS

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function hashLanguages(langs: readonly string[]): string {
  const normalized = [...langs].sort().join(',');
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

function recordDrift(newHash: string): void {
  if (lastHash !== null && lastHash !== newHash) {
    const now = Date.now();
    driftHistory = driftHistory.filter((t) => now - t < DRIFT_WINDOW_MS);
    driftHistory.push(now);
    if (driftHistory.length >= DRIFT_FLAP_THRESHOLD) {
      logger.error(
        `🚨 qualified-languages FLAP DETECTED: ${driftHistory.length} hash changes in last hour. Last: ${lastHash} → ${newHash}`,
      );
    } else {
      logger.warn(
        `⚠️ qualified-languages drift: hash ${lastHash} → ${newHash} (count this hour: ${driftHistory.length})`,
      );
    }
  }
  lastHash = newHash;
}

async function computeFromTranslations(): Promise<string[]> {
  const qualified: string[] = [];
  for (const lang of ACTIVE_SITEMAP_LANGUAGES as unknown as string[]) {
    try {
      const translations = await performanceCache.getTranslations(lang);
      if (translations && hasCompleteSeoTranslations(translations)) {
        qualified.push(lang);
      }
    } catch (err) {
      logger.warn(
        `⚠️ qualified-languages: skipping ${lang} — translation load failed`,
      );
    }
  }
  return qualified;
}

async function loadLkg(): Promise<QualifiedLanguagesState | null> {
  try {
    const doc = await SeoQualifiedLanguagesLkg.findOne({ key: LKG_KEY }).lean();
    if (!doc) return null;
    if (doc.expiresAt && doc.expiresAt.getTime() < Date.now()) {
      logger.warn(`⚠️ qualified-languages: LKG expired at ${doc.expiresAt.toISOString()}`);
      return null;
    }
    return {
      languages: doc.languages,
      hash: doc.hash,
      source: 'lkg',
      computedAt: doc.computedAt,
      expiresAt: doc.expiresAt,
    };
  } catch (err) {
    logger.error('❌ qualified-languages: LKG read failed', err);
    return null;
  }
}

async function persistLkg(languages: string[], hash: string): Promise<void> {
  try {
    const now = new Date();
    await SeoQualifiedLanguagesLkg.findOneAndUpdate(
      { key: LKG_KEY },
      {
        $set: {
          languages,
          hash,
          source: 'computed',
          computedAt: now,
          expiresAt: new Date(now.getTime() + LKG_TTL_MS),
        },
      },
      { upsert: true, returnDocument: 'after' },
    );
  } catch (err) {
    logger.error('❌ qualified-languages: LKG persist failed', err);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns the current qualified-languages state. The recommended entry point
 * for sitemap routes — provides hash + source for cache keys + ETags + 503.
 *
 * Throws `QualifiedLanguagesUnavailableError` when neither live compute nor
 * LKG can produce a non-empty list. Callers MUST handle this and respond
 * 503 + Retry-After + no-store.
 *
 * SHRINK PROTECTION: If the live computation returns FEWER languages than
 * SHRINK_PROTECTION_RATIO (50%) of the LKG, we treat it as a transient
 * translation-cache miss and serve the LKG instead. This prevents brief
 * cache evictions from collapsing the sitemap from 10 langs back down to 1.
 * A genuine permanent shrink (e.g. a translation key was removed) requires
 * `invalidateQualifiedLanguages()` to be called explicitly by an admin.
 */
const SHRINK_PROTECTION_RATIO = 0.5;

export async function getQualifiedLanguagesState(): Promise<QualifiedLanguagesState> {
  const now = Date.now();
  if (memoryCache && memoryCache.expiresAt > now) {
    return memoryCache.state;
  }

  const computed = await computeFromTranslations();

  // Try to load LKG up front so we can compare sizes for shrink protection.
  const lkg = await loadLkg();

  if (computed.length > 0) {
    // SHRINK PROTECTION: a sudden drop > 50% from LKG is almost always a
    // translation-cache miss, not a real qualification change. Stick with LKG.
    if (
      lkg &&
      lkg.languages.length > 0 &&
      computed.length < lkg.languages.length * SHRINK_PROTECTION_RATIO
    ) {
      logger.warn(
        `⚠️ qualified-languages: shrink-protect — computed=${computed.length} < LKG=${lkg.languages.length} × ${SHRINK_PROTECTION_RATIO}; serving LKG (hash=${lkg.hash})`,
      );
      const SHORT_TTL_MS = 60 * 1000; // re-probe in 1min
      memoryCache = { state: lkg, expiresAt: now + SHORT_TTL_MS };
      return lkg;
    }

    const hash = hashLanguages(computed);
    recordDrift(hash);
    const state: QualifiedLanguagesState = {
      languages: computed,
      hash,
      source: 'computed',
      computedAt: new Date(),
      expiresAt: new Date(now + CACHE_TTL_MS),
    };
    memoryCache = { state, expiresAt: now + CACHE_TTL_MS };
    // Persist LKG asynchronously (do not block response on Mongo write).
    void persistLkg(computed, hash);
    logger.log(
      `✅ qualified-languages: ${computed.length}/${ACTIVE_SITEMAP_LANGUAGES.length} computed, hash=${hash}`,
    );
    return state;
  }

  // Live compute returned zero — fall back to LKG (fail-closed except for valid LKG).
  if (lkg && lkg.languages.length > 0) {
    recordDrift(lkg.hash);
    logger.warn(
      `⚠️ qualified-languages: live compute returned 0; serving LKG (${lkg.languages.length} langs, hash=${lkg.hash}, source=${lkg.source})`,
    );
    // DO NOT memory-cache the LKG fallback for the full TTL — short cache so
    // the next request re-probes the translation cache once it warms up.
    const SHORT_TTL_MS = 30 * 1000;
    memoryCache = { state: lkg, expiresAt: now + SHORT_TTL_MS };
    return lkg;
  }

  // Hard fail: no compute, no LKG. Sitemap routes return 503.
  logger.error(
    '🔴 qualified-languages: no qualified languages available (live=0, LKG=null) — throwing 503',
  );
  throw new QualifiedLanguagesUnavailableError(
    'No qualified languages available: translation cache cold and no LKG persisted',
  );
}

/** Convenience: just the language array. Throws on unavailability. */
export async function getCachedQualifiedLanguages(): Promise<string[]> {
  const state = await getQualifiedLanguagesState();
  return state.languages;
}

/** Synchronous read for SSR hot paths. Returns null on cache miss; caller
 * must fall back to `await getCachedQualifiedLanguages()`. Never throws. */
export function getCachedQualifiedLanguagesSync(): string[] | null {
  const now = Date.now();
  if (memoryCache && memoryCache.expiresAt > now) {
    return memoryCache.state.languages;
  }
  return null;
}

/** Force-invalidate the in-memory cache. Useful after admin translation edits. */
export function invalidateQualifiedLanguages(): void {
  memoryCache = null;
}

/**
 * Server-boot warm-up. Computes once, persists LKG, caches in memory. If
 * neither compute nor LKG produces a result, seeds the LKG with the
 * EMERGENCY_SEED so subsequent requests have a non-empty fallback.
 *
 * Call this BEFORE registering public sitemap routes (or before accepting
 * the first request). Returns the resulting state for logging.
 */
export async function initializeQualifiedLanguages(): Promise<QualifiedLanguagesState> {
  try {
    const state = await getQualifiedLanguagesState();
    logger.log(
      `🚀 qualified-languages init: ${state.languages.length} langs from ${state.source}, hash=${state.hash}`,
    );
    return state;
  } catch (err) {
    if (err instanceof QualifiedLanguagesUnavailableError) {
      // First-ever boot with empty DB — seed LKG with the emergency list so
      // subsequent compute failures still have a known-good fallback.
      const seed = [...EMERGENCY_SEED_QUALIFIED_LANGUAGES];
      const hash = hashLanguages(seed);
      const now = new Date();
      try {
        await SeoQualifiedLanguagesLkg.findOneAndUpdate(
          { key: LKG_KEY },
          {
            $set: {
              languages: seed,
              hash,
              source: 'seed',
              computedAt: now,
              expiresAt: new Date(now.getTime() + LKG_TTL_MS),
            },
          },
          { upsert: true, returnDocument: 'after' },
        );
        logger.warn(
          `⚠️ qualified-languages: seeded LKG with emergency fallback (${seed.length} langs, hash=${hash})`,
        );
      } catch (seedErr) {
        logger.error('❌ qualified-languages: emergency seed failed', seedErr);
      }
      // Try one more time — should now find the seed.
      try {
        return await getQualifiedLanguagesState();
      } catch {
        // Truly catastrophic — no Mongo. Return seed in memory only so warm-up
        // doesn't block server startup; routes will still 503 if Mongo down.
        const state: QualifiedLanguagesState = {
          languages: seed,
          hash,
          source: 'seed',
          computedAt: now,
          expiresAt: null,
        };
        memoryCache = { state, expiresAt: Date.now() + 30 * 1000 };
        return state;
      }
    }
    throw err;
  }
}
