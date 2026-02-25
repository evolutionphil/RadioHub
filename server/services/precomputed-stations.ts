import { CacheManager } from '../cache';
import { Station } from '../../shared/mongo-schemas';
import { logger } from '../utils/logger';

interface PrecomputedStation {
  _id: string;
  slug: string;
  name: string;
  url: string;
  url_resolved: string;
  favicon: string;
  logo: string;
  country: string;
  state: string;
  votes: number;
  hasLogo: boolean;
  tags: string;
  codec: string;
  bitrate: number;
  logoAssets?: {
    webp96?: string;
    webp192?: string;
    webp384?: string;
  };
}

interface PrecomputedCountryData {
  stations: PrecomputedStation[];
  total: number;
  computedAt: number;
  countryName: string;
}

const CACHE_TTL = 604800; // 7 days in seconds (weekly refresh)
const CACHE_KEY_PREFIX = 'precomputed_stations:';
const GLOBAL_CACHE_KEY = 'precomputed_stations:global';
const GLOBAL_STATIONS_LIMIT = 10000; // Cache top 10K global stations
const BATCH_SIZE = 5; // Process 5 countries in parallel

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

  static async getAllCountriesFromDB(): Promise<string[]> {
    if (this.allCountries.length > 0) {
      return this.allCountries;
    }
    
    try {
      const countries = await Station.distinct('country').lean();
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

    const stations = await Station.aggregate([
      {
        $match: {
          country: countryName,
          lastCheckOk: true
        }
      },
      {
        $addFields: {
          hasLogo: {
            $cond: {
              if: {
                $or: [
                  { $and: [{ $ne: ['$logoAssets.webp96', null] }, { $ne: ['$logoAssets.webp96', ''] }] },
                  { $and: [{ $ne: ['$favicon', null] }, { $ne: ['$favicon', ''] }] },
                  { $and: [{ $ne: ['$logo', null] }, { $ne: ['$logo', ''] }] }
                ]
              },
              then: true,
              else: false
            }
          }
        }
      },
      {
        $sort: {
          hasLogo: -1,
          votes: -1
        }
      },
      {
        $project: {
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
          logoAssets: 1
        }
      }
    ]).exec();

    const data: PrecomputedCountryData = {
      stations: stations as PrecomputedStation[],
      total: stations.length,
      computedAt: Date.now(),
      countryName
    };

    await CacheManager.set(this.getCacheKey(countryName), data, { ttl: CACHE_TTL });

    return data;
  }

  static async computeCountryStations(countryCode: string): Promise<PrecomputedCountryData> {
    const countryName = COUNTRY_CODE_MAP[countryCode.toUpperCase()];
    if (!countryName) {
      return { stations: [], total: 0, computedAt: Date.now(), countryName: '' };
    }

    const allCountries = await this.getAllCountriesFromDB();
    const matchingCountry = allCountries.find(c => 
      c.toLowerCase() === countryName.toLowerCase() ||
      c.toLowerCase().includes(countryName.toLowerCase()) ||
      countryName.toLowerCase().includes(c.toLowerCase())
    );

    if (!matchingCountry) {
      return { stations: [], total: 0, computedAt: Date.now(), countryName };
    }

    return this.computeCountryStationsByName(matchingCountry);
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

    const allCountries = await this.getAllCountriesFromDB();
    const matchingCountry = allCountries.find(c => 
      c.toLowerCase() === countryName.toLowerCase() ||
      c.toLowerCase().includes(countryName.toLowerCase()) ||
      countryName.toLowerCase().includes(c.toLowerCase())
    );

    if (!matchingCountry) {
      return { stations: [], total: 0, page, totalPages: 0, cached: false };
    }

    const cacheKey = this.getCacheKey(matchingCountry);
    let data = await CacheManager.get<PrecomputedCountryData>(cacheKey);
    let cached = true;

    if (!data) {
      cached = false;
      data = await this.computeCountryStationsByName(matchingCountry);
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
    const cacheKey = this.getCacheKey(countryName);
    let data = await CacheManager.get<PrecomputedCountryData>(cacheKey);
    let cached = true;

    if (!data) {
      cached = false;
      data = await this.computeCountryStationsByName(countryName);
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
   * Stores top 10,000 stations for pagination
   */
  static async computeGlobalStations(): Promise<PrecomputedCountryData> {
    logger.log('🌍 Computing global stations cache...');
    const startTime = Date.now();

    const stations = await Station.aggregate([
      {
        $match: {
          lastCheckOk: true
        }
      },
      {
        $addFields: {
          hasLogo: {
            $cond: {
              if: {
                $or: [
                  { $and: [{ $ne: ['$logoAssets.webp96', null] }, { $ne: ['$logoAssets.webp96', ''] }] },
                  { $and: [{ $ne: ['$favicon', null] }, { $ne: ['$favicon', ''] }] },
                  { $and: [{ $ne: ['$logo', null] }, { $ne: ['$logo', ''] }] }
                ]
              },
              then: true,
              else: false
            }
          }
        }
      },
      {
        $sort: {
          hasLogo: -1,
          votes: -1
        }
      },
      {
        $limit: GLOBAL_STATIONS_LIMIT
      },
      {
        $project: {
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
          logoAssets: 1
        }
      }
    ]).exec();

    // Get total count for pagination info
    const totalCount = await Station.countDocuments({ lastCheckOk: true });

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
