import { Station, UserFavorite, Translation } from '../../shared/mongo-schemas';
import CacheManager, { CacheKeys } from '../cache';
import { normalizeCountryFilter } from '../utils/normalize-country';
import { logger } from '../utils/logger';
import { TV_STATION_PROJECTION, tvSlimStation } from './shared-utils';

export async function fetchTranslationsForLanguage(lang: string): Promise<Record<string, string>> {
  const translations = await Translation.aggregate([
    { $match: { language: lang } },
    {
      $lookup: {
        from: 'translationkeys',
        localField: 'keyId',
        foreignField: '_id',
        as: 'keyInfo'
      }
    },
    {
      $unwind: {
        path: '$keyInfo',
        preserveNullAndEmptyArrays: true
      }
    }
  ]);

  const translationMap: Record<string, string> = {};
  for (const item of translations) {
    const keyName = item.keyInfo?.key || null;
    if (keyName && item.value) {
      translationMap[keyName] = item.value;
    } else if (keyName) {
      translationMap[keyName] = item.keyInfo?.defaultValue || keyName;
    }
  }
  return translationMap;
}

export async function refreshTranslationsCache(lang: string): Promise<void> {
  try {
    const translationMap = await fetchTranslationsForLanguage(lang);
    const cacheKey = CacheKeys.translations(lang);
    await CacheManager.set(cacheKey, translationMap, { ttl: 7200, useRedis: true });
  } catch (error) {
    logger.error(`Background refresh failed for ${lang} translations:`, error);
  }
}

export async function refreshCommunityFavoritesCache(country?: string): Promise<void> {
  try {
    const countryFilter = normalizeCountryFilter(country);

    const communityFavorites = await UserFavorite.aggregate([
      {
        $addFields: {
          stationObjectId: {
            $cond: {
              if: { $type: '$stationId' },
              then: {
                $cond: {
                  if: { $eq: [{ $type: '$stationId' }, 'objectId'] },
                  then: '$stationId',
                  else: { $toObjectId: '$stationId' }
                }
              },
              else: null
            }
          }
        }
      },
      {
        $lookup: {
          from: 'stations',
          localField: 'stationObjectId',
          foreignField: '_id',
          as: 'station'
        }
      },
      { $unwind: { path: '$station', preserveNullAndEmptyArrays: true } },
      {
        $match: Object.keys(countryFilter).length > 0
          ? { 'station': { $exists: true, $ne: null }, ...{ 'station.country': countryFilter.country } }
          : { 'station': { $exists: true, $ne: null } }
      },
      {
        $group: {
          _id: '$station._id',
          name: { $first: '$station.name' },
          url: { $first: '$station.url' },
          country: { $first: '$station.country' },
          genre: { $first: '$station.genre' },
          tags: { $first: '$station.tags' },
          votes: { $first: '$station.votes' },
          clickCount: { $first: '$station.clickCount' },
          codec: { $first: '$station.codec' },
          bitrate: { $first: '$station.bitrate' },
          favicon: { $first: '$station.favicon' },
          homepage: { $first: '$station.homepage' },
          iso_3166_1: { $first: '$station.iso_3166_1' },
          language: { $first: '$station.language' },
          slug: { $first: '$station.slug' },
          favoriteCount: { $sum: 1 }
        }
      },
      { $sort: { favoriteCount: -1 } },
      { $limit: 20 }
    ]);

    const cacheKey = `community_favorites:${country || 'all'}:all:20`;
    await CacheManager.set(cacheKey, communityFavorites, { ttl: 600 });
  } catch (error) {
    logger.log(`⚠️ Failed to cache community favorites for ${country}:`, error);
  }
}

export async function refreshPopularStationsCache(country?: string): Promise<void> {
  const countryFilter = normalizeCountryFilter(country);

  let featuredFilter: any = { ...countryFilter, isFeatured: true };
  if (!country || country === 'all' || country === 'null') {
    featuredFilter.showInGlobalPopular = true;
  }

  const featuredStations = await Station.find(featuredFilter)
    .sort({ votes: -1 })
    .limit(20)
    .select(TV_STATION_PROJECTION)
    .lean();

  const remainingLimit = 20 - featuredStations.length;
  let regularStations: any[] = [];
  if (remainingLimit > 0) {
    regularStations = await Station.find({ ...countryFilter, isFeatured: { $ne: true } })
      .sort({ votes: -1 })
      .limit(remainingLimit)
      .select(TV_STATION_PROJECTION)
      .lean();
  }

  const popularStations = [...featuredStations, ...regularStations];

  const cacheKey = `popular_stations:${country || 'all'}:all:20`;
  await CacheManager.set(cacheKey, popularStations, { ttl: 600 });

  const tvSlimAll = popularStations
    .filter((s: any) => s.logoAssets?.status === 'completed' || (s.favicon && /^https?:\/\/.+/i.test(s.favicon?.trim())))
    .map(tvSlimStation);

  for (const tvLimit of [4, 10, 12]) {
    const tvCacheKey = `popular_stations:${country || 'all'}:all:${tvLimit}:false:tv:v2`;
    await CacheManager.set(tvCacheKey, tvSlimAll.slice(0, tvLimit), { ttl: 86400 });
  }
}
