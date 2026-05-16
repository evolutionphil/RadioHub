import CacheManager from '../cache';
import { Station } from '@workspace/db-shared/mongo-schemas';
import { logger } from '../utils/logger';
import { sleep } from '../utils/event-loop-yield';
import { trackOperation } from '../utils/operation-tracker';

const POPULAR_PROJECTION = {
  _id: 1, name: 1, url: 1, urlResolved: 1, favicon: 1, country: 1,
  countrycode: 1, state: 1, genre: 1, codec: 1, bitrate: 1,
  homepage: 1, tags: 1, slug: 1, hls: 1, votes: 1, clickCount: 1,
  lastCheckOk: 1, lastCheckTime: 1, descriptions: 1, logoAssets: 1, localImagePath: 1,
  isFeatured: 1, showInGlobalPopular: 1, hasLogo: 1
} as const;

const PER_COUNTRY_LIMIT = 40;
const POOL_TRIM_THRESHOLD = 800;
// Task spec: 7d fresh / 28d stale. The cron refresh runs every 4h, so
// the envelope is virtually always within the fresh window in practice;
// the long stale window is a safety net for sustained cluster outages.
const FRESH_TTL = 7 * 86400;        // 7d fresh
const STALE_TTL = 28 * 86400;       // 28d stale

export const POPULAR_GLOBAL_LIMITS = [12, 24, 50] as const;

export type PopularGlobalLimit = typeof POPULAR_GLOBAL_LIMITS[number];

export function popularGlobalCacheKey(limit: number): string {
  // Dedicated namespace for the global precompute envelope — kept
  // separate from the legacy per-endpoint key so rollouts and dashboards
  // can observe the precompute path independently.
  return `precomputed_popular:v1:global:limit:${limit}`;
}

function trimPool(pool: any[], limit: number): any[] {
  pool.sort((a, b) => {
    const featDiff = ((b.isFeatured && b.showInGlobalPopular) ? 1 : 0)
                   - ((a.isFeatured && a.showInGlobalPopular) ? 1 : 0);
    if (featDiff !== 0) return featDiff;
    const voteDiff = (b.votes ?? 0) - (a.votes ?? 0);
    if (voteDiff !== 0) return voteDiff;
    return (b.clickCount ?? 0) - (a.clickCount ?? 0);
  });
  if (pool.length > limit) pool.length = limit;
  return pool;
}

export class PrecomputedPopularGlobalService {
  static async computeStations(maxLimit: number = 50): Promise<any[]> {
    return trackOperation('precompute-popular-global', async () => {
      const startTime = Date.now();

      // Featured global pool — small (~hundreds), one cheap aggregate.
      let featured: any[] = [];
      try {
        featured = await Station.aggregate([
          { $match: { lastCheckOk: true, isFeatured: true, showInGlobalPopular: true } },
          { $sort: { votes: -1, clickCount: -1 } },
          { $project: POPULAR_PROJECTION },
          { $limit: maxLimit * 4 }
        ]).option({ maxTimeMS: 15000, allowDiskUse: true }).exec();
      } catch (err: any) {
        logger.warn(`[popular-global] featured aggregate failed: ${err?.message || 'unknown'}`);
      }

      // Regular pool — collect per country to use the country-prefixed index
      // and avoid the global $sort hot path that the M10 multiplanner
      // routinely times out on (code 50, 15s budget).
      let countries: string[] = [];
      try {
        const raw = await Station.distinct('country', { lastCheckOk: true });
        countries = raw
          .filter((c: any) => c && typeof c === 'string' && c.trim().length > 0)
          .map((c: any) => c.trim());
      } catch (err: any) {
        logger.warn(`[popular-global] distinct countries failed: ${err?.message || 'unknown'}`);
      }

      let pool: any[] = [];
      let perCountryFailures = 0;
      let processed = 0;
      const targetPoolSize = maxLimit * 4;

      for (const country of countries) {
        try {
          const batch = await Station.aggregate([
            { $match: { country, lastCheckOk: true, isFeatured: { $ne: true } } },
            { $sort: { votes: -1, clickCount: -1 } },
            { $limit: PER_COUNTRY_LIMIT },
            { $project: POPULAR_PROJECTION }
          ]).option({ maxTimeMS: 8000, allowDiskUse: true }).exec();
          if (batch.length > 0) pool.push(...batch);
        } catch (err: any) {
          perCountryFailures++;
        }

        processed++;
        if (pool.length > POOL_TRIM_THRESHOLD) {
          pool = trimPool([...featured, ...pool], targetPoolSize);
          // Re-separate so featured doesn't get re-merged repeatedly
          featured = pool.filter(s => s.isFeatured && s.showInGlobalPopular);
          pool = pool.filter(s => !(s.isFeatured && s.showInGlobalPopular));
        }
        if (processed % 25 === 0) await sleep(20);
      }

      const merged = trimPool([...featured, ...pool], targetPoolSize);

      const duration = Math.round((Date.now() - startTime) / 1000);
      logger.log(
        `✅ POPULAR GLOBAL: ${merged.length} stations (countries=${countries.length}, ` +
        `failures=${perCountryFailures}) in ${duration}s`
      );

      // INCIDENT 2026-05-16 (review hardening) — never report success on
      // an empty/degraded compute. If the cluster was thrashing and we
      // got nothing useful out of either pool, throw so callers
      // (`getOrCompute` / `refresh` / route guard) can fall through to
      // the existing SWR last-known-good path instead of caching an
      // empty homepage list for 6 hours.
      if (merged.length === 0) {
        throw new Error(
          `[popular-global] empty result (countries=${countries.length}, ` +
          `failures=${perCountryFailures}) — refusing to cache empty success`
        );
      }
      return merged;
    });
  }

  static async refresh(): Promise<void> {
    try {
      const computed = await this.computeStations(Math.max(...POPULAR_GLOBAL_LIMITS));
      // Pre-populate the SWR envelopes for every advertised limit.
      for (const limit of POPULAR_GLOBAL_LIMITS) {
        const sliced = computed.slice(0, limit);
        await CacheManager.setSWR(
          popularGlobalCacheKey(limit),
          sliced,
          { freshTtl: FRESH_TTL, staleTtl: STALE_TTL }
        );
      }
    } catch (err: any) {
      logger.error(`[popular-global] refresh failed: ${err?.message || err}`);
    }
  }

  static async getOrCompute(limit: number): Promise<any[]> {
    const key = popularGlobalCacheKey(limit);
    return CacheManager.getOrSetSWR<any[]>(
      key,
      async () => {
        const computed = await this.computeStations(Math.max(limit, ...POPULAR_GLOBAL_LIMITS));
        // Side-populate sibling limit envelopes so a single compute warms all.
        for (const other of POPULAR_GLOBAL_LIMITS) {
          if (other === limit) continue;
          try {
            await CacheManager.setSWR(
              popularGlobalCacheKey(other),
              computed.slice(0, other),
              { freshTtl: FRESH_TTL, staleTtl: STALE_TTL }
            );
          } catch {}
        }
        return computed.slice(0, limit);
      },
      { freshTtl: FRESH_TTL, staleTtl: STALE_TTL }
    );
  }

  /**
   * Last-resort stale lookup. Used by the route's catch path so we never
   * fall through to the legacy live aggregate when precompute fails.
   */
  static async getStale(limit: number): Promise<any[] | null> {
    try {
      // Review fix — SWR envelopes are stored under `<key>:swr`, so we
      // must use getSWR (not get) to retrieve the last-known-good list.
      const stale = await CacheManager.getSWR<any[]>(popularGlobalCacheKey(limit));
      return Array.isArray(stale) && stale.length > 0 ? stale : null;
    } catch {
      return null;
    }
  }

  static get FRESH_TTL() { return FRESH_TTL; }
  static get STALE_TTL() { return STALE_TTL; }
}
