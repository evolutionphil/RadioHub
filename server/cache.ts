import NodeCache from 'node-cache';
import { createClient } from 'redis';
import { logger } from './utils/logger';
import { startOperation, endOperation } from './utils/operation-tracker';

// In-memory cache with TTL
// CRITICAL: Sitemap XMLs are ~6MB each. maxKeys=200 × 6MB = ~1.2GB worst case.
// Use maxKeys=200 to prevent OOM on frontend-web (2GB heap limit).
const memoryCache = new NodeCache({ 
  stdTTL: 600,
  checkperiod: 120,
  useClones: false,
  maxKeys: 200
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
  static async getOrSetSingleFlight<T>(
    key: string,
    loader: () => Promise<T>,
    options: CacheOptions = {}
  ): Promise<T> {
    const cached = await CacheManager.get<T>(key);
    if (cached !== null) return cached;
    const existing = CacheManager.inflight.get(key);
    if (existing) return existing as Promise<T>;
    const p = (async () => {
      try {
        const value = await loader();
        await CacheManager.set(key, value, options);
        return value;
      } finally {
        CacheManager.inflight.delete(key);
      }
    })();
    CacheManager.inflight.set(key, p);
    return p;
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

      // Clear Redis cache
      if (redisClient && redisClient.isOpen) {
        const redisKeys = await redisClient.keys(`*${pattern}*`);
        if (redisKeys.length > 0) {
          await redisClient.del(redisKeys);
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