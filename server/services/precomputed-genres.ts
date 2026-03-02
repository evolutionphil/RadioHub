import { CacheManager } from '../cache';
import { Station, Genre } from '../../shared/mongo-schemas';
import { logger } from '../utils/logger';
import { normalizeCountryFilter, resolveToDbName } from '../utils/normalize-country';

interface PrecomputedGenre {
  _id: string;
  name: string;
  slug: string;
  total_stations: number;
  stationCount: number;
  posterImage?: string;
}

interface PrecomputedGenresData {
  genres: PrecomputedGenre[];
  total: number;
  computedAt: number;
  countryName: string;
}

const CACHE_TTL = 86400; // 24 hours
const CACHE_KEY_PREFIX = 'precomputed_genres:v5:';
const GLOBAL_CACHE_KEY = 'precomputed_genres:v5:global';

export class PrecomputedGenresService {
  private static resolveCountry(input?: string): string | null {
    if (!input || input === 'all' || input === 'global') return null;
    return resolveToDbName(input);
  }

  private static getCacheKey(countryIdentifier: string): string {
    if (!countryIdentifier || countryIdentifier === 'all' || countryIdentifier === 'global') {
      return GLOBAL_CACHE_KEY;
    }
    const dbName = resolveToDbName(countryIdentifier);
    if (!dbName) return GLOBAL_CACHE_KEY;
    const normalized = dbName.toLowerCase().replace(/[^a-z0-9]/g, '_');
    return `${CACHE_KEY_PREFIX}${normalized}`;
  }

  static async computeGenresForCountry(countryIdentifier?: string): Promise<PrecomputedGenresData> {
    const dbName = this.resolveCountry(countryIdentifier);
    const isGlobal = !dbName;
    
    const stationFilter: any = isGlobal ? {} : normalizeCountryFilter(dbName);

    const genreCounts = await Station.aggregate([
      { $match: stationFilter },
      {
        $addFields: {
          allTags: {
            $setUnion: [
              { $cond: [
                { $and: [{ $ne: ['$genre', null] }, { $ne: ['$genre', ''] }] },
                [{ $toLower: '$genre' }],
                []
              ]},
              { $cond: [
                { $and: [{ $ne: ['$tags', null] }, { $ne: ['$tags', ''] }] },
                { $map: {
                  input: { $split: ['$tags', ','] },
                  as: 'tag',
                  in: { $toLower: { $trim: { input: '$$tag' } } }
                }},
                []
              ]}
            ]
          }
        }
      },
      { $unwind: '$allTags' },
      { $match: { allTags: { $ne: '' } } },
      { $group: { _id: '$allTags', count: { $sum: 1 } } }
    ]);

    const tagCounts = new Map<string, number>();
    
    for (const entry of genreCounts) {
      tagCounts.set(entry._id, entry.count);
    }

    const realGenres = await Genre.find({ isDiscoverable: true }).lean();
    const genreSet = new Set(realGenres.map(g => g.slug?.toLowerCase()));

    const allSlugs = new Set<string>();
    const genreEntries: Array<{ id: string; name: string; slug: string; posterImage?: string; isDb: boolean }> = [];

    for (const genre of realGenres) {
      const slug = genre.slug?.toLowerCase() || genre.name?.toLowerCase().replace(/\s+/g, '-');
      if (!allSlugs.has(slug)) {
        allSlugs.add(slug);
        genreEntries.push({
          id: genre._id?.toString() || `db-${slug}`,
          name: genre.name || slug,
          slug,
          posterImage: genre.posterImage,
          isDb: true
        });
      }
    }

    const isCountrySpecific = !!dbName;
    const minThreshold = isCountrySpecific ? 1 : 5;
    
    for (const [tag, count] of tagCounts.entries()) {
      if (!genreSet.has(tag) && !allSlugs.has(tag) && count >= minThreshold) {
        allSlugs.add(tag);
        const displayName = tag.split(/[\s-]+/).map(
          word => word.charAt(0).toUpperCase() + word.slice(1)
        ).join(' ');
        genreEntries.push({
          id: `dynamic-${tag}`,
          name: displayName,
          slug: tag.replace(/\s+/g, '-'),
          isDb: false
        });
      }
    }

    const allGenres: PrecomputedGenre[] = [];
    
    for (const entry of genreEntries) {
      const slug = entry.slug.toLowerCase();
      const count = tagCounts.get(slug) || 0;
      if (count > 0) {
        allGenres.push({
          _id: entry.id,
          name: entry.name,
          slug: entry.slug,
          total_stations: count,
          stationCount: count,
          posterImage: entry.posterImage || `/images/genre-bg-grad-${(Math.abs(entry.slug.split('').reduce((a: number, b: string) => a + b.charCodeAt(0), 0)) % 4) + 1}.webp`
        });
      }
    }

    allGenres.sort((a, b) => b.total_stations - a.total_stations);

    return {
      genres: allGenres,
      total: allGenres.length,
      computedAt: Date.now(),
      countryName: dbName || 'global'
    };
  }

  static async getGenres(countryIdentifier?: string): Promise<PrecomputedGenresData> {
    const cacheKey = this.getCacheKey(countryIdentifier || 'global');
    const startTime = Date.now();
    
    const cached = await CacheManager.get<PrecomputedGenresData>(cacheKey);
    if (cached) {
      logger.log(`[Cache HIT] precomputed genres ${countryIdentifier || 'global'} (${Date.now() - startTime}ms)`);
      return cached;
    }

    logger.log(`[Cache MISS] precomputed genres ${countryIdentifier || 'global'} - computing...`);
    const data = await this.computeGenresForCountry(countryIdentifier);
    
    await CacheManager.set(cacheKey, data, { ttl: CACHE_TTL });
    logger.log(`📦 Cached genres for ${countryIdentifier || 'global'}: ${data.total} genres (${Date.now() - startTime}ms)`);
    
    return data;
  }

  static async warmupCache(): Promise<void> {
    logger.log('🔥 Warming up genres cache...');
    
    await this.getGenres('global');
    
    const topCountries = ['DE', 'US', 'TR', 'FR', 'IT', 'ES', 'GB', 'BR', 'RU', 'JP', 'NL', 'AT', 'CH', 'PL', 'AU', 'CA', 'MX', 'IN', 'KR'];
    
    for (const country of topCountries) {
      try {
        await this.getGenres(country);
      } catch (error) {
        logger.error(`Failed to warmup genres for ${country}:`, error);
      }
    }
    
    logger.log('✅ Genres cache warmup complete');
  }

  static async refreshAll(): Promise<void> {
    logger.log('🔄 Refreshing all genres caches...');
    
    await CacheManager.del(GLOBAL_CACHE_KEY);
    await this.getGenres('global');
    
    const countries = await Station.distinct('country').lean();
    
    for (const country of countries) {
      if (country && typeof country === 'string') {
        const cacheKey = this.getCacheKey(country);
        await CacheManager.del(cacheKey);
        await this.getGenres(country);
      }
    }
    
    logger.log('✅ All genres caches refreshed');
  }
}
