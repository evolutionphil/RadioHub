import NodeCache from 'node-cache';
import { createClient } from 'redis';
import { logger } from './utils/logger';

// In-memory cache with TTL
const memoryCache = new NodeCache({ 
  stdTTL: 600, // 10 minutes default TTL
  checkperiod: 60, // Check for expired keys every 1 minute (faster cleanup)
  useClones: false, // Don't clone objects for better performance
  maxKeys: 2000 // Hard cap: prevents unbounded memory growth (OOM protection)
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

      // Try Redis if available
      if (redisClient && redisClient.isOpen) {
        const redisResult = await redisClient.get(key);
        if (redisResult) {
          const parsed = JSON.parse(redisResult) as T;
          // Store in memory cache for faster future access
          memoryCache.set(key, parsed, 300); // 5 min in memory
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

  // Set cached data
  static async set<T>(key: string, value: T, options: CacheOptions = {}): Promise<void> {
    try {
      const ttl = options.ttl || 600; // 10 minutes default

      // Always store in memory cache
      memoryCache.set(key, value, ttl);

      // Store in Redis if available
      if (redisClient && redisClient.isOpen && (!options.useRedis || options.useRedis)) {
        await redisClient.setEx(key, ttl, JSON.stringify(value));
      }
    } catch (error) {
      // console.error('Cache set error:', error);
    }
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