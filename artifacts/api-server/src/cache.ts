import NodeCache from 'node-cache';
import { createClient } from 'redis';
import { logger } from './utils/logger';
import { startOperation, endOperation } from './utils/operation-tracker';

// In-memory cache with TTL
// INCIDENT 2026-05-14 round 8: post-failover RSS climbed to 745MB and
// `RSS MEMORY RELIEF` fired repeatedly. NodeCache was holding precomputed
// station blobs + sitemap XMLs from the warmup loop; with maxKeys=200 ×
// up-to-6MB each the worst case is ~1.2GB. Cut to 100 (worst case ~600MB)
// — Redis is the source of truth, this is just a hot tier. Eviction churn
// is fine because the Redis layer absorbs misses transparently.
// MEMORY FIX 2026-05-18: raised 100→500 now that a 512KB payload gate
// exists (see safeSet). Worst case: 500 × 512KB = 256MB, well below the
// old 200-key risk. 57 SEO languages × genre/station/search routes need
// >100 keys to stay warm — at 100 keys, constant eviction was sending
// excess DB queries that showed up as pool pressure on M10.
const memoryCache = new NodeCache({
  stdTTL: 600,
  checkperiod: 120,
  useClones: false,
  maxKeys: 500
});

// Redis client for production (optional)
let redisClient: any = null;

// Initialize Redis if available
async function initRedis() {
  try {
    if (process.env.REDIS_URL) {
      redisClient = createClient({ url: process.env.REDIS_URL });
      await redisClient.connect();
      // console.log('✅ Connected to Redis cache');
    }
  } catch (error) {
    // console.log('⚠️  Redis not available, using memory cache only');
    redisClient = null;
  }
}

// Initialize cache
initRedis();

interface CacheOptions {
  ttl?: number; // Time to live in seconds
  useRedis?: boolean; // Force Redis usage
  refreshThreshold?: number; // Refresh when TTL remaining is below this (seconds)
}

export class CacheManager {
  // Get cached data with TTL info
  static async get<T>(key: string): Promise<T | null> {
    try {
      // Try memory cache first (fastest)
      const memoryResult = memoryCache.get<T>(key);
      if (memoryResult !== undefined) {
        return memoryResult;
      }

      if (redisClient && redisClient.isOpen) {
        const redisResult = await redisClient.get(key);
        if (redisResult) {
          // Detect raw string payloads (set() may have stored a string without
          // JSON-encoding it). JSON.parse on raw text would throw and lose
          // the value silently. Probe with the first non-whitespace character
          // so leading whitespace in legitimate JSON doesn't trip the heuristic.
          let probeIdx = 0;
          while (probeIdx < redisResult.length) {
            const ch = redisResult.charCodeAt(probeIdx);
            if (ch !== 0x20 && ch !== 0x09 && ch !== 0x0a && ch !== 0x0d) break;
            probeIdx++;
          }
          const first = redisResult.charCodeAt(probeIdx);
          const looksJson = first === 0x7b /*{*/ || first === 0x5b /*[*/ ||
            first === 0x22 /*"*/ || first === 0x74 /*t*/ || first === 0x66 /*f*/ ||
            first === 0x6e /*n*/ || (first >= 0x30 && first <= 0x39) /*0-9*/ ||
            first === 0x2d /*-*/;
          let parsed: T;
          try {
            parsed = looksJson ? (JSON.parse(redisResult) as T) : (redisResult as unknown as T);
          } catch {
            parsed = redisResult as unknown as T;
          }
          if (redisResult.length < 256_000) {
            try { memoryCache.set(key, parsed, 300); } catch {}
          }
          return parsed;
        }
      }

      return null;
    } catch (error) {
      // console.error('Cache get error:', error);
      return null;
    }
  }

  // Check if cache needs refresh (TTL below threshold)
  static needsRefresh(key: string, threshold: number = 60): boolean {
    try {
      const ttl = memoryCache.getTtl(key);
      if (ttl === undefined) return true; // No cache, needs refresh
      
      const remainingSeconds = Math.max(0, (ttl - Date.now()) / 1000);
      return remainingSeconds < threshold;
    } catch (error) {
      return true; // Error means refresh needed
    }
  }

  static async set<T>(key: string, value: T, options: CacheOptions = {}): Promise<void> {
    const ttl = options.ttl || 600;

    // Single-pass size measurement: serialize once and reuse for both memory
    // size check and Redis payload. This was previously broken — only string
    // payloads were measured, so multi-MB precomputed JSON was silently
    // jammed into NodeCache and triggered ECACHEFULL evictions on hot keys.
    let serialized: string | null = null;
    let payloadBytes = 0;
    if (typeof value === 'string') {
      payloadBytes = (value as unknown as string).length * 2; // UTF-16 estimate
    } else {
      try {
        const opId = startOperation('cache-stringify', key);
        try {
          serialized = JSON.stringify(value);
        } finally {
          endOperation(opId);
        }
        payloadBytes = serialized ? serialized.length * 2 : 0;
      } catch {
        // value is not serializable (Map/circular/etc) — skip Redis but keep memory
        serialized = null;
      }
    }

    const isLargeValue = payloadBytes > 512_000;

    // Memory write — independent failure path. NodeCache may throw ECACHEFULL
    // if maxKeys is exceeded; that must NOT prevent the Redis write.
    if (!isLargeValue) {
      try {
        const memTtl = Math.min(ttl, 3600);
        memoryCache.set(key, value, memTtl);
      } catch {}
    }

    // Redis write — independent failure path.
    if (redisClient && redisClient.isOpen && serialized !== null) {
      try {
        await redisClient.setEx(key, ttl, serialized);
      } catch {}
    } else if (redisClient && redisClient.isOpen && typeof value === 'string') {
      try {
        await redisClient.setEx(key, ttl, value as unknown as string);
      } catch {}
    }
  }

  // Single-flight helper — coalesces concurrent misses on the same key into
  // one upstream call. Prevents cache stampedes during precompute warmup or
  // when a hot key TTLs out under traffic.
  private static inflight = new Map<string, Promise<any>>();
  // INCIDENT 2026-05-15 v10.2 round 5 — count consecutive SWR
  // background-refresh failures per envelope key so a silently-stuck
  // stale value (broken loader, persistent Mongo timeout) becomes
  // visible via warn-level logs instead of being silently swallowed.
  private static swrRefreshFailures = new Map<string, number>();
  // INCIDENT 2026-05-16 v12 — per-key waiter telemetry. When the M10
  // cluster gets slow, a single-flight loader can be stuck for tens of
  // seconds with dozens of concurrent callers piling on behind it. We
  // had no visibility into "how bad" it was. Now we count waiters per
  // key, track the peak, and emit ONE warn-line per minute summarizing
  // the hottest contended key. No per-request log spam, no overhead on
  // the cache-hit fast path.
  private static waiterCounts = new Map<string, number>();
  private static waiterPeaks = new Map<string, number>();
  private static lastTelemetryLogMs = 0;
  private static maybeLogTelemetry(): void {
    const now = Date.now();
    if (now - CacheManager.lastTelemetryLogMs < 60_000) return;
    if (CacheManager.waiterPeaks.size === 0) return;
    CacheManager.lastTelemetryLogMs = now;
    const entries = Array.from(CacheManager.waiterPeaks.entries())
      .sort((a, b) => b[1] - a[1]);
    const totalKeys = entries.length;
    const top5 = entries.slice(0, 5).filter(([, peak]) => peak >= 3);
    if (top5.length > 0) {
      try {
        const summary = top5
          .map(([k, peak]) => `"${k}"=${peak}`)
          .join(', ');
        logger.log(
          `🛬 SF stats: last 60s — ${totalKeys} contended key(s), top-${top5.length} by peak waiters: ${summary}`
        );
      } catch {}
    }
    CacheManager.waiterPeaks.clear();
  }
  static async getOrSetSingleFlight<T>(
    key: string,
    loader: () => Promise<T>,
    options: CacheOptions = {}
  ): Promise<T> {
    const cached = await CacheManager.get<T>(key);
    if (cached !== null) return cached;
    const existing = CacheManager.inflight.get(key);
    if (existing) {
      const w = (CacheManager.waiterCounts.get(key) || 0) + 1;
      CacheManager.waiterCounts.set(key, w);
      const peak = CacheManager.waiterPeaks.get(key) || 0;
      if (w > peak) CacheManager.waiterPeaks.set(key, w);
      try {
        return await (existing as Promise<T>);
      } finally {
        const remaining = (CacheManager.waiterCounts.get(key) || 1) - 1;
        if (remaining <= 0) CacheManager.waiterCounts.delete(key);
        else CacheManager.waiterCounts.set(key, remaining);
        CacheManager.maybeLogTelemetry();
      }
    }
    const p = (async () => {
      try {
        const value = await loader();
        await CacheManager.set(key, value, options);
        return value;
      } finally {
        CacheManager.inflight.delete(key);
        CacheManager.maybeLogTelemetry();
      }
    })();
    CacheManager.inflight.set(key, p);
    return p;
  }

  // Stale-while-revalidate helper. Stores `{v, exp}` envelope under
  // `<key>:swr`. Two TTLs:
  //   freshTtl — under this age, value is returned immediately, no refresh.
  //   staleTtl — between freshTtl and staleTtl, value is returned
  //              immediately AND a background refresh is kicked off (
  //              coalesced via the same inflight Map as singleflight).
  // Past staleTtl: behaves like singleflight — block the caller until
  // a fresh value is computed.
  // Designed for the precomputed-stations / precomputed-genres /
  // precomputed-cities path: 24h freshTtl + 7d staleTtl means an
  // organic visitor never waits on a Mongo aggregate during normal
  // ops, AND a brief Atlas hiccup just serves last-known-good while
  // the cluster recovers — no 500, no empty payload.
  static async getOrSetSWR<T>(
    key: string,
    loader: () => Promise<T>,
    options: { freshTtl: number; staleTtl: number }
  ): Promise<T> {
    const { freshTtl, staleTtl } = options;
    const envKey = `${key}:swr`;
    const env = await CacheManager.get<{ v: T; exp: number }>(envKey);
    const now = Date.now();
    if (env && typeof env === 'object' && 'v' in env && 'exp' in env) {
      const ageMs = now - (env.exp - freshTtl * 1000);
      const isFresh = ageMs < freshTtl * 1000;
      if (isFresh) {
        return env.v;
      }
      // Stale-but-usable: serve immediately, refresh in background
      // (coalesced via inflight). Errors are swallowed so a transient
      // upstream failure does not break the response.
      if (!CacheManager.inflight.has(envKey)) {
        const refresh = (async () => {
          try {
            const fresh = await loader();
            // INCIDENT 2026-05-15 v10.2 round 6 — capture exp at WRITE
            // time, not before loader execution. A slow loader
            // (multi-second Mongo aggregate) was previously eating
            // into the fresh window from the moment we entered the
            // refresh closure, so a 1h fresh TTL with a 10s loader
            // effectively had ~3590s freshness and could even be
            // already-stale on write under really pathological
            // latency. Using Date.now() here gives the configured
            // freshTtl from the moment the fresh value lands.
            await CacheManager.set(envKey, { v: fresh, exp: Date.now() + freshTtl * 1000 }, { ttl: staleTtl });
            CacheManager.swrRefreshFailures.delete(envKey);
          } catch (err: any) {
            // Keep stale; next caller will retry. INCIDENT 2026-05-15
            // v10.2 round 5 — count consecutive refresh failures per
            // key and warn-log every 5th so a silently-stuck stale
            // value (e.g. broken loader, persistent Mongo timeout) is
            // visible in the Railway tail without spamming on every
            // request.
            const prev = CacheManager.swrRefreshFailures.get(envKey) || 0;
            const next = prev + 1;
            CacheManager.swrRefreshFailures.set(envKey, next);
            if (next === 1 || next % 5 === 0) {
              try {
                logger.warn(
                  `[swr] background refresh failed key=${envKey} consecutive=${next} ` +
                  `code=${err?.code || err?.codeName || 'unknown'} msg=${err?.message || 'unknown'}`
                );
              } catch {}
            }
          } finally {
            CacheManager.inflight.delete(envKey);
          }
        })();
        CacheManager.inflight.set(envKey, refresh);
      }
      return env.v;
    }
    // No envelope at all — block the first caller, coalesce the rest.
    const existing = CacheManager.inflight.get(envKey);
    if (existing) return existing as Promise<T>;
    const p = (async () => {
      try {
        const v = await loader();
        await CacheManager.set(envKey, { v, exp: Date.now() + freshTtl * 1000 }, { ttl: staleTtl });
        return v;
      } finally {
        CacheManager.inflight.delete(envKey);
      }
    })();
    CacheManager.inflight.set(envKey, p);
    return p;
  }

  // SWR companion helpers — invalidation/refresh paths must use these
  // (NOT plain set/del) when the read side is `getOrSetSWR`, otherwise
  // writes go to a base key that nobody reads and cron refreshes have
  // no effect.
  static async getSWR<T>(key: string): Promise<T | null> {
    const env = await CacheManager.get<{ v: T; exp: number }>(`${key}:swr`);
    if (env && typeof env === 'object' && 'v' in env) return env.v as T;
    return null;
  }
  static async setSWR<T>(
    key: string,
    value: T,
    options: { freshTtl: number; staleTtl: number }
  ): Promise<void> {
    const envKey = `${key}:swr`;
    const exp = Date.now() + options.freshTtl * 1000;
    await CacheManager.set(envKey, { v: value, exp }, { ttl: options.staleTtl });
  }
  static async delSWR(key: string): Promise<void> {
    const envKey = `${key}:swr`;
    await CacheManager.del(envKey);
    // also drop any in-flight refresh marker so the next caller
    // recomputes immediately.
    CacheManager.inflight.delete(envKey);
  }

  // Delete cached data
  static async del(key: string): Promise<void> {
    try {
      memoryCache.del(key);
      
      if (redisClient && redisClient.isOpen) {
        await redisClient.del(key);
      }
    } catch (error) {
      // console.error('Cache del error:', error);
    }
  }

  // Clear cache by pattern
  static async clearByPattern(pattern: string): Promise<void> {
    try {
      // Clear memory cache
      const keys = memoryCache.keys();
      keys.forEach(key => {
        if (key.includes(pattern)) {
          memoryCache.del(key);
        }
      });

      // Clear Redis cache.
      // SEO AUDIT FIX (2026-05-09): switched from `redisClient.keys()` to
      // SCAN. `KEYS *pattern*` is O(N) over the entire keyspace and blocks
      // Redis's single-threaded event loop until it finishes — under
      // production load (tens of thousands of cached station/genre/sitemap
      // entries) this can stall every other tenant on the Redis instance
      // for hundreds of ms or more, and is explicitly flagged as a
      // production hazard by Redis docs. SCAN is cursor-based and
      // non-blocking; it yields control back between batches.
      // Batched DEL (chunks of 500) avoids sending one giant DEL command
      // for very large pattern matches.
      if (redisClient && redisClient.isOpen) {
        const matchPattern = `*${pattern}*`;
        const toDelete: string[] = [];
        // node-redis v4 exposes scanIterator; iterate in batches of 500.
        for await (const key of redisClient.scanIterator({ MATCH: matchPattern, COUNT: 500 } as any)) {
          // The iterator yields either a single key or a batch (string[])
          // depending on driver version — normalize both.
          if (Array.isArray(key)) {
            toDelete.push(...key);
          } else {
            toDelete.push(key as string);
          }
          if (toDelete.length >= 500) {
            await redisClient.del(toDelete.splice(0, toDelete.length));
          }
        }
        if (toDelete.length > 0) {
          await redisClient.del(toDelete);
        }
      }
    } catch (error) {
      // console.error('Cache clear pattern error:', error);
    }
  }

  // Get cache stats
  static getStats() {
    return {
      memory: {
        keys: memoryCache.keys().length,
        stats: memoryCache.getStats()
      },
      redis: {
        connected: redisClient && redisClient.isOpen,
        status: redisClient?.status || 'not available'
      }
    };
  }
}

// Normalize search terms for consistent cache keys
// "fm 4" and "fm4" should produce same cache key
const normalizeSearchTerm = (term?: string): string => {
  if (!term) return '';
  return term.toLowerCase().trim().replace(/\s+/g, '');
};

// Normalize filters for cache key
const normalizeFilters = (filters?: any): any => {
  if (!filters) return {};
  const normalized = { ...filters };
  if (normalized.search) {
    normalized.search = normalizeSearchTerm(normalized.search);
  }
  return normalized;
};

// Cache key generators
export const CacheKeys = {
  // Genre caches
  genres: (page?: number, limit?: number, filters?: any) => 
    `genres:${page || 1}:${limit || 9}:${JSON.stringify(filters || {})}`,
  popularGenres: (limit?: number, countrycode?: string) => 
    `genres:popular:${limit || 5}:${countrycode || 'all'}`,
  allGenres: () => 'genres:all',
  
  // Station caches - normalize search in filters
  stations: (page?: number, filters?: any) => 
    `stations:${page || 1}:${JSON.stringify(normalizeFilters(filters))}`,
  stationById: (id: string) => `station:${id}`,
  popularStations: (limit?: number) => `stations:popular:${limit || 20}`,
  nearbyStations: (lat: number, lng: number, radius?: number) => 
    `stations:nearby:${lat}:${lng}:${radius || 100}`,
  
  // Country caches
  countries: () => 'countries:all',
  
  // Translation caches
  translations: (lang: string) => `translations:${lang}`,
  
  // Search caches - normalize query
  search: (query: string, filters?: any) => 
    `search:${normalizeSearchTerm(query)}:${JSON.stringify(normalizeFilters(filters))}`,
  
  // SEO caches
  sitemap: () => 'sitemap:xml',
  pageData: () => 'seo:page-data',

  // Social caches
  userSocial: (email: string) => `social:user:${email}`,
  userFollowers: (userId: string, page: number, limit: number) => `social:followers:${userId}:${page}:${limit}`,
  userFollowing: (userId: string, page: number, limit: number) => `social:following:${userId}:${page}:${limit}`,
  userIsFollowing: (currentUserId: string, targetUserId: string) => `social:is-following:${currentUserId}:${targetUserId}`
};

export async function invalidateSocialCacheForUser(userId: string, email?: string | null): Promise<void> {
  await CacheManager.clearByPattern(`social:followers:${userId}`);
  await CacheManager.clearByPattern(`social:following:${userId}`);
  await CacheManager.clearByPattern(`social:users-followers:${userId}`);
  await CacheManager.clearByPattern(`social:users-following:${userId}`);
  await CacheManager.clearByPattern(`social:is-following:${userId}`);
  if (email) {
    await CacheManager.del(CacheKeys.userSocial(email));
  }
}

export default CacheManager;