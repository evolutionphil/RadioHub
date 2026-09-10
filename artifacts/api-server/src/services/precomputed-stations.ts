import { publicStationCache as CacheManager } from '../public-station-cache';
import { pgCatalog, type CatalogFilter } from '../data/postgres-catalog-store';
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
    const dbCountry = await pgCatalog().findOne({ country: { $regex: new RegExp(`^${escapedName}$`, 'i') } }, { fields: ['country'] });
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
      const countries = (await pgCatalog().groupCount('country')).map(row => row._id);
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
    const fields = ['_id', 'slug', 'name', 'url', 'urlResolved', 'favicon', 'country', 'state', 'votes', 'hasLogo', 'tags', 'codec', 'bitrate', 'logoAssets'];
    let stations = await pgCatalog().find({ country: countryName, isListVisible: true },
      { sort: { hasLogo: -1, votes: -1 }, limit: 3000, fields });
    if (stations.length === 0) {
      const escapedName = countryName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      stations = await pgCatalog().find({ country: { $regex: new RegExp(`^${escapedName}$`, 'i') }, isListVisible: true },
        { sort: { hasLogo: -1, votes: -1 }, limit: 3000, fields });
    }
    stations = stations.map(station => ({ ...station, url_resolved: station.urlResolved }));

    const data: PrecomputedCountryData = {
      stations: stations as PrecomputedStation[],
      total: stations.length,
      computedAt: Date.now(),
      countryName
    };

    // INCIDENT 2026-05-15 v10.2 — read side is now SWR (getCountryStations
    // / getCountryStationsByName); write through `setSWR` so cron
    // refreshes actually populate the envelope getOrSetSWR reads from.
    await CacheManager.setSWR(this.getCacheKey(countryName), data, { freshTtl: CACHE_TTL, staleTtl: CACHE_TTL * 7 });

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
    // INCIDENT 2026-05-15 v10.2 — same SWR wrapper as the by-name path.
    let cached = true;
    const data = await CacheManager.getOrSetSWR<PrecomputedCountryData>(cacheKey, async () => {
      cached = false;
      return await this.computeCountryStationsByName(resolvedName);
    }, { freshTtl: 86400, staleTtl: 86400 * 7 });

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
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 200 ||
        !Number.isSafeInteger((page - 1) * limit)) {
      throw new RangeError('Country catalogue page must be a positive safe integer and limit must be 1–200');
    }
    const resolvedName = await this.resolveCountryName(countryName);
    // This is the crawlable country directory, not the capped popular pool.
    // Cache each bounded page separately, with a true native count; page51
    // must not become a false404 just because the popular cache stops at3000.
    const cacheKey = `${CACHE_KEY_PREFIX}catalog:v1:${encodeURIComponent(resolvedName)}:${page}:${limit}`;
    let cached = true;
    const data = await CacheManager.getOrSetSWR<PrecomputedCountryData>(cacheKey, async () => {
      cached = false;
      const catalog = pgCatalog();
      let filter: CatalogFilter = { country: resolvedName, isListVisible: true };
      let total = await catalog.count(filter);
      if (total === 0) {
        const escapedName = resolvedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        filter = { country: { $regex: new RegExp(`^${escapedName}$`, 'i') }, isListVisible: true };
        total = await catalog.count(filter);
      }
      // DB errors must propagate to the renderer's retryable503 path rather
      // than becoming a cached empty directory. Huge past-end pages count
      // only; they never issue an expensive OFFSET query.
      if (!Number.isSafeInteger(total) || total < 0) throw new Error('Invalid country catalogue count');
      const offset = (page - 1) * limit;
      const fields = ['_id', 'slug', 'name', 'url', 'urlResolved', 'favicon', 'country', 'state',
        'votes', 'hasLogo', 'tags', 'codec', 'bitrate', 'logoAssets', 'noIndex', 'lastCheckOk'];
      const stations = offset < total ? await catalog.find(filter, {
        sort: { hasLogo: -1, votes: -1, _id: 1 }, limit, offset, fields,
      }) : [];
      return { stations: stations.map(station => ({ ...station, url_resolved: station.urlResolved })) as PrecomputedStation[],
        total, computedAt: Date.now(), countryName: resolvedName };
    }, { freshTtl: CACHE_TTL, staleTtl: CACHE_TTL * 7 });

    return {
      stations: data.stations,
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
  static async computeGlobalStations(options: { writeCache?: boolean } = {}): Promise<PrecomputedCountryData> {
    logger.log('🌍 Computing global stations cache (native PostgreSQL ranking)...');
    const startTime = Date.now();

    // Rank compact IDs once, retain country diversity, then fetch only the
    // winning cards. Never cache a partial country merge after a DB failure.
    const [stations, totalCount] = await Promise.all([
      pgCatalog().globalStationCards(GLOBAL_STATIONS_LIMIT, 200),
      pgCatalog().count({ isListVisible: true }),
    ]);

    const data: PrecomputedCountryData = {
      stations: stations as PrecomputedStation[],
      total: totalCount, // Real total for pagination display
      computedAt: Date.now(),
      countryName: 'global'
    };

    // Direct refresh callers still publish the SWR envelope. When invoked as
    // an SWR loader, CacheManager owns publication; writing here as well
    // serializes the full pool and awaits the same Redis write twice.
    if (options.writeCache !== false) {
      await CacheManager.setSWR(GLOBAL_CACHE_KEY, data, { freshTtl: CACHE_TTL, staleTtl: CACHE_TTL * 7 });
    }

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
    // INCIDENT 2026-05-15 v10.2 — global cache is the heaviest compute
    // (per-country aggregate × ~200 countries). SWR is essential here:
    // freshTtl 24h, staleTtl 7d so a stressed cluster keeps serving
    // last-known-good while a single coalesced refresh runs in the
    // background.
    let cached = true;
    const data = await CacheManager.getOrSetSWR<PrecomputedCountryData>(GLOBAL_CACHE_KEY, async () => {
      cached = false;
      return await this.computeGlobalStations({ writeCache: false });
    }, { freshTtl: 86400, staleTtl: 86400 * 7 });

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
   * Check if global cache exists.
   * INCIDENT 2026-05-15 v10.2 — read side migrated to SWR, so writes
   * now land under `<key>:swr`. This probe MUST read the SWR envelope
   * via `getSWR(...)`; the previous `CacheManager.get(GLOBAL_CACHE_KEY)`
   * was always returning false after the migration, gating every
   * global request onto the cold-fallback Mongo path and bypassing
   * the new singleflight/SWR protections.
   */
  static async hasGlobalCache(): Promise<boolean> {
    const data = await CacheManager.getSWR<PrecomputedCountryData>(GLOBAL_CACHE_KEY);
    return !!data;
  }
}
