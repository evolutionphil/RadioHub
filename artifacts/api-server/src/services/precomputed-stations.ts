import { CacheManager } from '../cache';
import { Station } from '@workspace/db-shared/mongo-schemas';
import { logger } from '../utils/logger';
import { sleep } from '../utils/event-loop-yield';
import { trackOperation } from '../utils/operation-tracker';

interface PrecomputedStation {
  _id: string;
  slug: string;
  name: string;
  url: string;
  url_resolved: string;
  favicon: string;
  country: string;
  state: string;
  votes: number;
  hasLogo: boolean;
  tags: string;
  codec: string;
  bitrate: number;
  logoAssets?: {
    webp96?: string;
    webp256?: string;
    folder?: string;
  };
}

interface PrecomputedCountryData {
  stations: PrecomputedStation[];
  total: number;
  computedAt: number;
  countryName: string;
}

const CACHE_TTL = 86400; // 24 hours
const CACHE_KEY_PREFIX = 'precomputed_stations:';
const GLOBAL_CACHE_KEY = 'precomputed_stations:global';
const GLOBAL_STATIONS_LIMIT = 2000;
const BATCH_SIZE = 3;

const COUNTRY_CODE_MAP: Record<string, string> = {
  'DE': 'Germany', 'IT': 'Italy', 'FR': 'France', 'ES': 'Spain', 'GB': 'United Kingdom',
  'US': 'United States', 'TR': 'Turkey', 'RU': 'Russia', 'JP': 'Japan', 'CN': 'China',
  'BR': 'Brazil', 'MX': 'Mexico', 'AR': 'Argentina', 'AU': 'Australia', 'CA': 'Canada',
  'NL': 'Netherlands', 'BE': 'Belgium', 'AT': 'Austria', 'CH': 'Switzerland', 'PL': 'Poland',
  'SE': 'Sweden', 'NO': 'Norway', 'DK': 'Denmark', 'FI': 'Finland', 'PT': 'Portugal',
  'GR': 'Greece', 'CZ': 'Czech Republic', 'HU': 'Hungary', 'RO': 'Romania', 'BG': 'Bulgaria',
  'SK': 'Slovakia', 'SI': 'Slovenia', 'HR': 'Croatia', 'RS': 'Serbia', 'UA': 'Ukraine',
  'IE': 'Ireland', 'IN': 'India', 'ID': 'Indonesia', 'TH': 'Thailand', 'VN': 'Vietnam',
  'KR': 'South Korea', 'SA': 'Saudi Arabia', 'AE': 'United Arab Emirates', 'EG': 'Egypt', 'ZA': 'South Africa',
  'NG': 'Nigeria', 'KE': 'Kenya', 'PH': 'Philippines', 'MY': 'Malaysia', 'SG': 'Singapore',
  'NZ': 'New Zealand', 'CL': 'Chile', 'CO': 'Colombia', 'PE': 'Peru', 'VE': 'Venezuela'
};

const COUNTRY_NAME_ALIASES: Record<string, string[]> = {
  'Turkey': ['Türkiye', 'Turkiye'],
  'Türkiye': ['Turkey'],
  'Czech Republic': ['Czechia', 'Česko'],
  'Czechia': ['Czech Republic', 'Česko'],
  'United Kingdom': ['The United Kingdom of Great Britain and Northern Ireland', 'The United Kingdom Of Great Britain And Northern Ireland', 'UK', 'Great Britain'],
  'United States': ['The United States of America', 'USA', 'US', 'The United States Of America'],
  'South Korea': ['The Republic Of Korea', 'Korea, Republic of', 'Republic of Korea'],
  'The Republic Of Korea': ['South Korea', 'Korea'],
  'North Korea': ['The Democratic Peoples Republic Of Korea'],
  'The Democratic Peoples Republic Of Korea': ['North Korea'],
  'Russia': ['The Russian Federation', 'Russian Federation'],
  'The Russian Federation': ['Russia'],
  'The Netherlands': ['Netherlands', 'Holland'],
  'Netherlands': ['The Netherlands', 'Holland'],
  'United Arab Emirates': ['The United Arab Emirates', 'UAE'],
  'The United Arab Emirates': ['United Arab Emirates', 'UAE'],
};

const REVERSE_COUNTRY_MAP: Record<string, string> = Object.entries(COUNTRY_CODE_MAP).reduce(
  (acc, [code, name]) => ({ ...acc, [name.toLowerCase()]: code }),
  {}
);

export class PrecomputedStationsService {
  private static allCountries: string[] = [];
  private static initialized = false;

  private static getCacheKey(countryName: string): string {
    const normalized = countryName.toLowerCase().replace(/[^a-z0-9]/g, '_');
    return `${CACHE_KEY_PREFIX}${normalized}`;
  }

  private static getCodeFromName(countryName: string): string | null {
    const lowerName = countryName.toLowerCase();
    if (REVERSE_COUNTRY_MAP[lowerName]) {
      return REVERSE_COUNTRY_MAP[lowerName];
    }
    for (const [code, name] of Object.entries(COUNTRY_CODE_MAP)) {
      if (lowerName.includes(name.toLowerCase()) || name.toLowerCase().includes(lowerName)) {
        return code;
      }
    }
    return null;
  }

  private static resolvedCache = new Map<string, string>();
  private static readonly RESOLVED_CACHE_MAX = 500;

  private static setResolvedCache(key: string, value: string): void {
    // Bounded LRU-lite: evict oldest when full (Map preserves insertion order)
    if (this.resolvedCache.size >= this.RESOLVED_CACHE_MAX) {
      const oldest = this.resolvedCache.keys().next().value;
      if (oldest !== undefined) this.resolvedCache.delete(oldest);
    }
    this.resolvedCache.set(key, value);
  }

  private static async resolveCountryName(countryName: string): Promise<string> {
    const cacheKey = countryName.toLowerCase();
    if (this.resolvedCache.has(cacheKey)) {
      const val = this.resolvedCache.get(cacheKey)!;
      // Refresh recency: re-insert to mark as most-recent
      this.resolvedCache.delete(cacheKey);
      this.resolvedCache.set(cacheKey, val);
      return val;
    }

    const allCountries = await this.getAllCountriesFromDB();
    
    const exactMatch = allCountries.find(c => c.toLowerCase() === cacheKey);
    if (exactMatch) {
      this.setResolvedCache(cacheKey, exactMatch);
      return exactMatch;
    }

    const aliases = COUNTRY_NAME_ALIASES[countryName] || [];
    for (const alias of aliases) {
      const aliasMatch = allCountries.find(c => c.toLowerCase() === alias.toLowerCase());
      if (aliasMatch) {
        this.setResolvedCache(cacheKey, aliasMatch);
        return aliasMatch;
      }
    }

    for (const [key, aliasList] of Object.entries(COUNTRY_NAME_ALIASES)) {
      if (aliasList.some(a => a.toLowerCase() === cacheKey)) {
        const keyMatch = allCountries.find(c => c.toLowerCase() === key.toLowerCase());
        if (keyMatch) {
          this.setResolvedCache(cacheKey, keyMatch);
          return keyMatch;
        }
      }
    }

    const escapedName = countryName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const dbCountry = await Station.findOne(
      { country: { $regex: new RegExp(`^${escapedName}$`, 'i') } }
    ).select('country').lean() as any;
    if (dbCountry?.country) {
      this.setResolvedCache(cacheKey, dbCountry.country);
      return dbCountry.country;
    }

    this.setResolvedCache(cacheKey, countryName);
    return countryName;
  }

  static async getAllCountriesFromDB(): Promise<string[]> {
    if (this.allCountries.length > 0) {
      return this.allCountries;
    }
    
    try {
      const countries = await Station.distinct('country');
      this.allCountries = countries
        .filter((c: any) => c && typeof c === 'string' && c.trim().length > 0)
        .map((c: any) => c.trim());
      
      logger.log(`📊 Found ${this.allCountries.length} unique countries in database`);
      return this.allCountries;
    } catch (error) {
      logger.error('Failed to fetch countries from DB:', error);
      return [];
    }
  }

  static async computeCountryStationsByName(countryName: string): Promise<PrecomputedCountryData> {
    if (!countryName || countryName.trim().length === 0) {
      return { stations: [], total: 0, computedAt: Date.now(), countryName: '' };
    }

    return trackOperation('precompute-country', async () => {
    // INCIDENT 2026-05-15 v10 — REMOVED `.hint('country_1_lastCheckOk_1_hasLogo_-1_votes_-1')`.
    // The May 14 Atlas index audit hid several stations indexes;
    // hinting a hidden index throws BadValue and silently 500'd this
    // service. Trust the planner. New hints require HINT-VERIFIED tag.
    let stations = await Station.aggregate([
      {
        $match: {
          country: countryName,
          lastCheckOk: true
        }
      },
      {
        $sort: {
          hasLogo: -1,
          votes: -1
        }
      },
      { $limit: 1500 },
      {
        $project: {
          _id: 1,
          slug: 1,
          name: 1,
          url: 1,
          url_resolved: 1,
          favicon: 1,
          country: 1,
          state: 1,
          votes: 1,
          hasLogo: 1,
          tags: 1,
          codec: 1,
          bitrate: 1,
          logoAssets: { webp96: 1, webp256: 1, folder: 1 }
        }
      }
    ]).option({ maxTimeMS: 15000, allowDiskUse: true }).exec();

    if (stations.length === 0) {
      const escapedName = countryName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      stations = await Station.aggregate([
        { $match: { country: { $regex: new RegExp(`^${escapedName}$`, 'i') }, lastCheckOk: true } },
        { $sort: { hasLogo: -1, votes: -1 } },
        { $limit: 1500 },
        { $project: { _id: 1, slug: 1, name: 1, url: 1, url_resolved: 1, favicon: 1, country: 1, state: 1, votes: 1, hasLogo: 1, tags: 1, codec: 1, bitrate: 1, logoAssets: { webp96: 1, webp256: 1, folder: 1 } } }
      ]).option({ maxTimeMS: 15000, allowDiskUse: true }).exec();
    }

    const data: PrecomputedCountryData = {
      stations: stations as PrecomputedStation[],
      total: stations.length,
      computedAt: Date.now(),
      countryName
    };

    await CacheManager.set(this.getCacheKey(countryName), data, { ttl: CACHE_TTL });

    return data;
    }, countryName);
  }

  static async computeCountryStations(countryCode: string): Promise<PrecomputedCountryData> {
    const countryName = COUNTRY_CODE_MAP[countryCode.toUpperCase()];
    if (!countryName) {
      return { stations: [], total: 0, computedAt: Date.now(), countryName: '' };
    }

    const resolvedName = await this.resolveCountryName(countryName);
    return this.computeCountryStationsByName(resolvedName);
  }

  static async getCountryStations(
    countryCode: string, 
    page: number = 1, 
    limit: number = 33
  ): Promise<{ stations: PrecomputedStation[]; total: number; page: number; totalPages: number; cached: boolean }> {
    const countryName = COUNTRY_CODE_MAP[countryCode.toUpperCase()];
    if (!countryName) {
      return { stations: [], total: 0, page, totalPages: 0, cached: false };
    }

    const resolvedName = await this.resolveCountryName(countryName);
    const cacheKey = this.getCacheKey(resolvedName);
    let data = await CacheManager.get<PrecomputedCountryData>(cacheKey);
    let cached = true;

    if (!data) {
      cached = false;
      data = await this.computeCountryStationsByName(resolvedName);
    }

    const offset = (page - 1) * limit;
    const paginatedStations = data.stations.slice(offset, offset + limit);

    return {
      stations: paginatedStations,
      total: data.total,
      page,
      totalPages: Math.ceil(data.total / limit),
      cached
    };
  }

  static async getCountryStationsByName(
    countryName: string, 
    page: number = 1, 
    limit: number = 33
  ): Promise<{ stations: PrecomputedStation[]; total: number; page: number; totalPages: number; cached: boolean }> {
    const resolvedName = await this.resolveCountryName(countryName);
    const cacheKey = this.getCacheKey(resolvedName);
    let data = await CacheManager.get<PrecomputedCountryData>(cacheKey);
    let cached = true;

    if (!data) {
      cached = false;
      data = await this.computeCountryStationsByName(resolvedName);
    }

    const offset = (page - 1) * limit;
    const paginatedStations = data.stations.slice(offset, offset + limit);

    return {
      stations: paginatedStations,
      total: data.total,
      page,
      totalPages: Math.ceil(data.total / limit),
      cached
    };
  }

  private static async processBatch(countries: string[]): Promise<{ success: number; failed: number }> {
    const results = await Promise.allSettled(
      countries.map(country => this.computeCountryStationsByName(country))
    );

    let success = 0;
    let failed = 0;

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        success++;
      } else {
        failed++;
        logger.error(`Failed to precompute stations for ${countries[index]}:`, result.reason);
      }
    });

    return { success, failed };
  }

  static async refreshAllCountries(): Promise<{ total: number; success: number; failed: number; duration: number }> {
    const startTime = Date.now();
    const allCountries = await this.getAllCountriesFromDB();
    
    if (allCountries.length === 0) {
      logger.log('⚠️ No countries found in database');
      return { total: 0, success: 0, failed: 0, duration: 0 };
    }

    logger.log(`🔄 Starting precomputation for ${allCountries.length} countries (batch size: ${BATCH_SIZE})...`);
    
    let totalSuccess = 0;
    let totalFailed = 0;

    for (let i = 0; i < allCountries.length; i += BATCH_SIZE) {
      const batch = allCountries.slice(i, i + BATCH_SIZE);
      const { success, failed } = await this.processBatch(batch);
      totalSuccess += success;
      totalFailed += failed;
      
      const progress = Math.round(((i + batch.length) / allCountries.length) * 100);
      if (progress % 20 === 0 || i + batch.length === allCountries.length) {
        logger.log(`📊 Precomputation progress: ${progress}% (${i + batch.length}/${allCountries.length})`);
      }
      await sleep(500);
    }
    
    const duration = Math.round((Date.now() - startTime) / 1000);
    logger.log(`✅ PRECOMPUTED: Refreshed ${totalSuccess} countries, ${totalFailed} failed (${duration}s)`);
    
    return { total: allCountries.length, success: totalSuccess, failed: totalFailed, duration };
  }

  static async warmupPopularCountries(): Promise<void> {
    // First, compute global cache (highest priority)
    try {
      await this.computeGlobalStations();
      logger.log('✅ PRECOMPUTED: Global cache warmed up');
    } catch (error) {
      logger.error('Failed to warmup global cache:', error);
    }

    const popularCountries = ['DE', 'US', 'GB', 'FR', 'IT', 'ES', 'TR', 'AT', 'NL', 'CA'];
    
    for (const code of popularCountries) {
      try {
        await this.computeCountryStations(code);
        await sleep(200);
      } catch (error) {
        logger.error(`Failed to warmup ${code}:`, error);
      }
    }
    
    logger.log(`✅ PRECOMPUTED: Warmed up cache for ${popularCountries.length} popular countries + global`);
  }

  static async initializeFullCache(): Promise<void> {
    if (this.initialized) {
      logger.log('⏭️ Precomputed cache already initialized, skipping...');
      return;
    }

    logger.log('🚀 Initializing full precomputed stations cache for ALL countries...');
    
    const result = await this.refreshAllCountries();
    
    this.initialized = true;
    logger.log(`✅ Full cache initialization complete: ${result.success}/${result.total} countries cached in ${result.duration}s`);
  }

  static getCacheStats(): { initialized: boolean; countriesCount: number; hasGlobalCache: boolean } {
    return {
      initialized: this.initialized,
      countriesCount: this.allCountries.length,
      hasGlobalCache: false // Will be checked async
    };
  }

  // ==================== GLOBAL CACHE METHODS ====================

  /**
   * Compute and cache global stations (all countries, sorted by hasLogo + votes)
   * Stores top stations for pagination (limit: GLOBAL_STATIONS_LIMIT)
   */
  static async computeGlobalStations(): Promise<PrecomputedCountryData> {
    logger.log('🌍 Computing global stations cache (batched per-country)...');
    const startTime = Date.now();

    // BATCH STRATEGY (2026-05-11): the previous single-pipeline aggregation
    //   { $match: { lastCheckOk: true } } → $sort { hasLogo:-1, votes:-1 } → $limit 2000
    // routinely tripped Mongo's 32MB in-memory sort cap on prod
    // (`QueryExceededMemoryLimitNoDiskUseAllowed`, code 292) because the
    // multi-planner sometimes picked an in-memory sort plan over the
    // available `{ lastCheckOk:1, hasLogo:-1, votes:-1 }` index.
    //
    // Instead of opting into disk-spill (which the user explicitly rejected),
    // we now collect the global top list COUNTRY BY COUNTRY: each per-country
    // sort runs against the `{ country:1, lastCheckOk:1, votes:-1 }` index
    // and processes ~hundreds-to-low-thousands of docs — well under the cap.
    // We periodically trim the running candidate pool to keep its memory
    // footprint bounded too.
    const PER_COUNTRY_LIMIT = 200;             // top stations to take per country
    const TRIM_THRESHOLD = GLOBAL_STATIONS_LIMIT * 4; // start trimming when pool grows

    const PROJECT = {
      _id: 1,
      slug: 1,
      name: 1,
      url: 1,
      url_resolved: 1,
      favicon: 1,
      logo: 1,
      country: 1,
      state: 1,
      votes: 1,
      hasLogo: 1,
      tags: 1,
      codec: 1,
      bitrate: 1,
      logoAssets: 1,
    } as const;

    const trimPool = (pool: any[]): any[] => {
      pool.sort((a, b) => {
        const logoDiff = (b.hasLogo ? 1 : 0) - (a.hasLogo ? 1 : 0);
        if (logoDiff !== 0) return logoDiff;
        return (b.votes ?? 0) - (a.votes ?? 0);
      });
      if (pool.length > GLOBAL_STATIONS_LIMIT) {
        pool.length = GLOBAL_STATIONS_LIMIT;
      }
      return pool;
    };

    const countries = await Station.distinct('country', { lastCheckOk: true });
    const validCountries = countries
      .filter((c: any) => c && typeof c === 'string' && c.trim().length > 0)
      .map((c: any) => c.trim());

    let pool: any[] = [];
    let processed = 0;
    let perCountryFailures = 0;

    for (const country of validCountries) {
      try {
        const batch = await Station.aggregate([
          { $match: { country, lastCheckOk: true } },
          { $sort: { hasLogo: -1, votes: -1 } },
          { $limit: PER_COUNTRY_LIMIT },
          { $project: PROJECT },
        ])
          .option({ maxTimeMS: 10000, allowDiskUse: true })
          .exec();
        if (batch.length > 0) pool.push(...batch);
      } catch (err) {
        perCountryFailures++;
        logger.warn(`⚠️ global-batch: ${country} failed — ${(err as Error).message}`);
      }

      processed++;
      if (pool.length > TRIM_THRESHOLD) {
        pool = trimPool(pool);
      }

      // tiny yield to avoid hogging the event loop on large country lists
      if (processed % 25 === 0) {
        await sleep(20);
      }
    }

    pool = trimPool(pool);
    const stations = pool;

    // Get total count for pagination info
    const totalCount = await Station.countDocuments({ lastCheckOk: true });
    if (perCountryFailures > 0) {
      logger.warn(
        `⚠️ global-batch: ${perCountryFailures}/${validCountries.length} per-country batches failed — using best-effort merged top ${stations.length}`,
      );
    }

    const data: PrecomputedCountryData = {
      stations: stations as PrecomputedStation[],
      total: totalCount, // Real total for pagination display
      computedAt: Date.now(),
      countryName: 'global'
    };

    await CacheManager.set(GLOBAL_CACHE_KEY, data, { ttl: CACHE_TTL });

    const duration = Math.round((Date.now() - startTime) / 1000);
    logger.log(`✅ GLOBAL CACHE: Computed ${stations.length} stations (total: ${totalCount}) in ${duration}s`);

    return data;
  }

  /**
   * Get global stations with pagination (from cache or compute if missing)
   */
  static async getGlobalStations(
    page: number = 1, 
    limit: number = 33
  ): Promise<{ stations: PrecomputedStation[]; total: number; page: number; totalPages: number; cached: boolean }> {
    let data = await CacheManager.get<PrecomputedCountryData>(GLOBAL_CACHE_KEY);
    let cached = true;

    if (!data) {
      cached = false;
      data = await this.computeGlobalStations();
    }

    const offset = (page - 1) * limit;
    const paginatedStations = data.stations.slice(offset, offset + limit);

    // Calculate pages based on cached stations count (not total DB count)
    const cachedTotal = data.stations.length;

    return {
      stations: paginatedStations,
      total: data.total, // Show real total for UI
      page,
      totalPages: Math.ceil(cachedTotal / limit), // Pages based on cached data
      cached
    };
  }

  /**
   * Check if global cache exists
   */
  static async hasGlobalCache(): Promise<boolean> {
    const data = await CacheManager.get<PrecomputedCountryData>(GLOBAL_CACHE_KEY);
    return !!data;
  }
}
