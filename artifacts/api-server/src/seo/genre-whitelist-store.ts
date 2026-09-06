/**
 * Runtime store that merges the static `GENRE_WHITELIST` / `GENRE_ALIASES`
 * seed in `genre-whitelist.ts` with admin-managed deltas stored in the
 * PostgreSQL override rows (task #114).
 *
 * Why a runtime store?
 *   - SSR + sitemap callers (`isWhitelistedGenreSlug`, `getCanonicalGenreSlug`)
 *     are sync. We want a sync read path with O(1) lookups.
 *   - Static seeds support synchronous reads before the first database load;
 *     failed refreshes retain the last successful snapshot and report failure.
 *   - Mutations from the admin dashboard refresh the in-memory snapshot
 *     synchronously after a successful write, and a periodic refresh
 *     catches changes from other replicas.
 */

// IMPORTANT: import from the seed module — NOT from `genre-whitelist.ts`
// — to avoid a circular import. `genre-whitelist.ts` imports the lookup
// helpers from this file; if we read the seed through that module the
// constants would be undefined during partial init and the snapshot
// would seed empty.
import { GENRE_WHITELIST_SEED, GENRE_ALIASES_SEED } from './genre-whitelist-seed';
import { pgTaxonomyRuntime } from '../data/postgres-taxonomy-runtime-store';
import { logger } from '../utils/logger';

// Merged in-memory snapshot. Initialized from the static seed so the
// store is usable even before the first DB load (e.g. during cold start
// while PostgreSQL initializes). Startup must await the first successful load.
let mergedSlugs: Set<string> = new Set(GENRE_WHITELIST_SEED);
let mergedAliases: Map<string, string> = new Map(GENRE_ALIASES_SEED);
let lastRefreshAt: Date | null = null;

const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // every 5 minutes
let refreshTimer: NodeJS.Timeout | null = null;
let inflight: Promise<void> | null = null;

/** Returns the merged whitelist set (seed + overrides). Sync, O(1). */
export function getMergedWhitelist(): ReadonlySet<string> {
  return mergedSlugs;
}

/** Returns the merged alias map (seed + overrides). Sync, O(1). */
export function getMergedAliases(): ReadonlyMap<string, string> {
  return mergedAliases;
}

/** Last successful DB refresh time, or null if never refreshed. */
export function getLastRefreshAt(): Date | null {
  return lastRefreshAt;
}

/**
 * Recompute the merged snapshot from the static seed plus all
 * GenreWhitelistOverride rows. Safe to call concurrently — overlapping
 * calls share the same in-flight promise.
 */
export async function refreshGenreWhitelistFromDb(afterMutation = false): Promise<void> {
  if (inflight) {
    await inflight;
    if (!afterMutation) return;
  }
  inflight = (async () => {
    try {
      const overrides = await pgTaxonomyRuntime().overrides();

      const nextSlugs = new Set<string>(GENRE_WHITELIST_SEED);
      const nextAliases = new Map<string, string>(GENRE_ALIASES_SEED);

      for (const o of overrides) {
        const slug = String(o.slug || '').toLowerCase();
        if (!slug) continue;
        switch (o.kind) {
          case 'slug-add':
            nextSlugs.add(slug);
            break;
          case 'slug-remove':
            nextSlugs.delete(slug);
            // Drop any aliases that pointed at a now-removed slug — a
            // dangling alias would 301 to a noindex page otherwise.
            for (const [src, dst] of nextAliases) {
              if (dst === slug) nextAliases.delete(src);
            }
            break;
          case 'alias-add': {
            const canonical = String(o.canonical || '').toLowerCase();
            if (canonical) nextAliases.set(slug, canonical);
            break;
          }
          case 'alias-remove':
            nextAliases.delete(slug);
            break;
        }
      }

      // Apply target removals after all deltas, independently of query order.
      for (const [source,canonical] of nextAliases) if (!nextSlugs.has(canonical)) nextAliases.delete(source);
      mergedSlugs = nextSlugs;
      mergedAliases = nextAliases;
      lastRefreshAt = new Date();
      logger.debug?.(
        `🎯 genre-whitelist-store: refreshed (slugs=${mergedSlugs.size}, ` +
          `aliases=${mergedAliases.size}, overrides=${overrides.length})`,
      );
    } catch (err) {
      // Never crash the SEO path because of a refresh failure — keep the
      // previous snapshot in place. The static seed is still the floor.
      logger.error('❌ genre-whitelist-store: refresh failed (keeping previous snapshot)', err);
      throw err;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Start the periodic background refresh. Idempotent. */
export function startGenreWhitelistRefreshLoop(): void {
  if (refreshTimer) return;
  // Background failures are already logged; explicit/admin callers receive rejection.
  refreshGenreWhitelistFromDb().catch(() => {});
  refreshTimer = setInterval(() => {
    refreshGenreWhitelistFromDb().catch(() => {});
  }, REFRESH_INTERVAL_MS);
  // Don't keep the event loop alive just for this timer.
  if (typeof refreshTimer.unref === 'function') refreshTimer.unref();
}
