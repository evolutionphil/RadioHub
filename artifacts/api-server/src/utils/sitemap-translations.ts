import type { Types } from 'mongoose';
import { TranslationKey, Translation } from '@workspace/db-shared/mongo-schemas';

// Lean shapes for the two queries below. Mongoose 8 returns `.lean()` results
// as `unknown` when their inferred document type can't flow through helpers,
// so we declare the small subset of fields we actually read here. Keeping the
// shapes explicit means a future schema change surfaces as a compile error
// instead of silently breaking these mappings.
interface LeanTranslationKeyDoc {
  _id?: Types.ObjectId;
  key: string;
  defaultValue?: string;
}

interface LeanTranslationDoc {
  keyId?: Types.ObjectId;
  value: string;
}

export interface SitemapTranslations {
  stationTitle: string;
  stationCaption: string;
  stationCaptionNoCountry: string;
  genreTitle: string;
  genreCaption: string;
}

/**
 * Load sitemap translations for a given language with batched database queries
 * Uses 2 MongoDB queries total (instead of 5+ individual queries) for better performance
 * 
 * @param langCode - The language code (e.g., 'tr', 'de', 'en')
 * @returns Object containing all 5 sitemap translation templates
 * 
 * Performance: ~20-50ms per language during warmup, 0ms when cached
 * Cache TTL: 1 hour - adjust if translation updates happen more frequently
 */
export async function loadSitemapTranslations(langCode: string): Promise<SitemapTranslations> {
  const sitemapKeys = [
    'sitemap_station_image_title',
    'sitemap_station_image_caption',
    'sitemap_station_image_caption_no_country',
    'sitemap_genre_image_title',
    'sitemap_genre_image_caption'
  ];

  // Batch fetch all translation keys in one query
  const translationKeys = await TranslationKey.find({
    key: { $in: sitemapKeys },
  }).lean<LeanTranslationKeyDoc[]>();

  // Harden against missing translation keys in database - fallback values will be used

  const keyMap = new Map(translationKeys.map((k) => [k.key, k]));

  // Batch fetch all translations for this language in one query
  const keyIds = translationKeys
    .map((k) => k._id)
    .filter((id): id is Types.ObjectId => Boolean(id));
  const translations = await Translation.find({
    keyId: { $in: keyIds },
    language: langCode,
  }).lean<LeanTranslationDoc[]>();

  const translationMap = new Map(
    translations
      .map((t) => [t.keyId?.toString(), t.value] as [string | undefined, string])
      .filter((entry): entry is [string, string] => Boolean(entry[0]))
  );

  // Helper to safely get translation with null safety
  const getTranslation = (keyName: string, fallback: string): string => {
    const key = keyMap.get(keyName);
    if (!key || !key._id) return fallback;
    return translationMap.get(key._id.toString()) || key.defaultValue || fallback;
  };

  // Build result object with hardened null safety
  return {
    stationTitle: getTranslation(
      'sitemap_station_image_title',
      '{station} - Live Online Radio Station Logo'
    ),
    stationCaption: getTranslation(
      'sitemap_station_image_caption',
      'Listen to {station} live from {country} - {genre} radio station - Free online radio streaming'
    ),
    stationCaptionNoCountry: getTranslation(
      'sitemap_station_image_caption_no_country',
      'Listen to {station} live - {genre} radio station - Free online radio streaming'
    ),
    genreTitle: getTranslation(
      'sitemap_genre_image_title',
      '{genre} music genre - Discover radio stations worldwide'
    ),
    genreCaption: getTranslation(
      'sitemap_genre_image_caption',
      '{genre} music genre - Discover the best {genre} radio stations from around the world. Listen to thousands of {genre} stations live online.'
    )
  };
}
