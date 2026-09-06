import {
  pgCatalog,
  catalogShape,
  compileCatalogFilter,
} from "../data/postgres-catalog-store";
import { getPostgresPool } from "../postgres-runtime";
import CacheManager, { CacheKeys } from "../cache";
import {
  normalizeCountryFilter,
  resolveToDbName,
} from "../utils/normalize-country";
import { logger } from "../utils/logger";
import { TV_STATION_PROJECTION, tvSlimStation } from "./shared-utils";
import { pgLocalization } from "../data/postgres-localization-store";

export async function fetchTranslationsForLanguage(
  lang: string,
): Promise<Record<string, string>> {
  return pgLocalization().getTranslationsWithDefaults(lang);
}

export async function refreshTranslationsCache(lang: string): Promise<void> {
  try {
    const translationMap = await fetchTranslationsForLanguage(lang);
    const cacheKey = CacheKeys.translations(lang);
    await CacheManager.set(cacheKey, translationMap, {
      ttl: 7200,
      useRedis: true,
    });
  } catch (error) {
    logger.error(`Background refresh failed for ${lang} translations:`, error);
  }
}

export async function refreshCommunityFavoritesCache(
  country?: string,
): Promise<void> {
  try {
    const countryFilter = normalizeCountryFilter(country);

    const { sql, values } = compileCatalogFilter(countryFilter);
    const rows = (
      await getPostgresPool().query(
        `SELECT s.*,count(f.user_id)::int favorite_count FROM user_favorites f
      JOIN stations s ON s.id=f.station_id WHERE ${sql}
      GROUP BY s.id ORDER BY favorite_count DESC,s.id LIMIT 20`,
        values,
      )
    ).rows;
    const visible = [
      "_id",
      "name",
      "url",
      "country",
      "genre",
      "tags",
      "votes",
      "clickCount",
      "codec",
      "bitrate",
      "favicon",
      "homepage",
      "iso_3166_1",
      "language",
      "slug",
    ];
    const communityFavorites = rows.map((row) => {
      const station = catalogShape(row);
      return {
        ...Object.fromEntries(visible.map((field) => [field, station[field]])),
        favoriteCount: row.favorite_count,
      };
    });

    const cacheKey = `community_favorites:${country || "all"}:all:20`;
    await CacheManager.set(cacheKey, communityFavorites, { ttl: 600 });
  } catch (error) {
    logger.log(`⚠️ Failed to cache community favorites for ${country}:`, error);
  }
}

export async function refreshPopularStationsCache(
  country?: string,
): Promise<void> {
  const countryFilter = normalizeCountryFilter(country);
  const resolvedName =
    country && country !== "all" && country !== "null"
      ? resolveToDbName(country) || country
      : "all";

  let featuredFilter: any = { ...countryFilter, isFeatured: true };
  if (!country || country === "all" || country === "null") {
    featuredFilter.showInGlobalPopular = true;
  }

  const featuredStations = await pgCatalog().find(featuredFilter, {
    sort: { votes: -1 },
    limit: 20,
    fields: Object.keys(TV_STATION_PROJECTION),
  });

  const remainingLimit = 20 - featuredStations.length;
  let regularStations: any[] = [];
  if (remainingLimit > 0) {
    regularStations = await pgCatalog().find(
      { ...countryFilter, isFeatured: { $ne: true } },
      {
        sort: { votes: -1 },
        limit: remainingLimit,
        fields: Object.keys(TV_STATION_PROJECTION),
      },
    );
  }

  const popularStations = [...featuredStations, ...regularStations];

  const cacheKey = `popular_stations:${resolvedName}:all:20`;
  await CacheManager.set(cacheKey, popularStations, { ttl: 86400 });

  const tvSlimAll = popularStations
    .filter(
      (s: any) =>
        s.logoAssets?.status === "completed" ||
        (s.favicon && /^https?:\/\/.+/i.test(s.favicon?.trim())),
    )
    .map(tvSlimStation);

  for (const tvLimit of [4, 10, 12]) {
    const tvCacheKey = `popular_stations:${resolvedName}:all:${tvLimit}:false:tv:v2`;
    await CacheManager.set(tvCacheKey, tvSlimAll.slice(0, tvLimit), {
      ttl: 86400,
    });
  }
}
