import { generateSeoTags, getLanguageFromPath, DEFAULT_LANGUAGE, generateLanguageUrls, COUNTRY_TO_LANGUAGE, SEO_LANGUAGES, generateLocalizedStationTitle } from '@shared/seo-config';
import { Translation, Station, SeoMetadata } from '../shared/mongo-schemas';
import { performanceCache } from './performance-cache';
import { logger } from './utils/logger';
import { URL_TRANSLATIONS } from '@shared/url-translations';
import { trackOperation } from './utils/operation-tracker';

const SEO_RENDER_MAX_CONCURRENT = 5;
const SEO_RENDER_TIMEOUT_MS = 5000;
let seoRenderActive = 0;
let seoRenderRejected = 0;

const DB_QUERY_TIMEOUT_MS = SEO_RENDER_TIMEOUT_MS - 500;

function withSignal<T>(query: any, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
  if (!signal) return query;
  
  query.setOptions({ maxTimeMS: DB_QUERY_TIMEOUT_MS });
  
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      if (!settled) {
        settled = true;
        reject(new DOMException('Aborted', 'AbortError'));
      }
    };
    signal.addEventListener('abort', onAbort, { once: true });
    (query as Promise<T>).then(
      (val) => { if (!settled) { settled = true; signal.removeEventListener('abort', onAbort); resolve(val); } },
      (err) => { if (!settled) { settled = true; signal.removeEventListener('abort', onAbort); reject(err); } }
    );
  });
}

export function getSeoRenderStats() {
  return { active: seoRenderActive, rejected: seoRenderRejected };
}

export interface StaticPageData {
  language: string;
  cleanPath: string;
  seoTags: any;
  translations: Record<string, string>;
  pageData?: any;
  urlTranslations?: Map<string, string>;
}

/**
 * Build localized URL path using URL translations from database
 * @param englishPath - English path (e.g., '/genres/pop' or '/stations')
 * @param languageCode - Target language code (e.g., 'de', 'sq')
 * @param countryCode - Optional country code for country-specific URLs
 * @param translationMap - Map of "languageCode:englishPath" -> translatedPath
 * @returns Localized URL path (e.g., '/de/genres' or '/sq/zhanret')
 */
export function buildLocalizedUrl(
  englishPath: string,
  languageCode: string,
  countryCode?: string,
  translationMap?: Map<string, string>
): string {
  // UPDATED: All languages (including English) use /{lang}/* format for consistency
  // If no translation map provided, return English path with language prefix
  if (!translationMap) {
    const prefix = countryCode ? `/${countryCode}` : `/${languageCode}`;
    return `${prefix}${englishPath}`;
  }
  
  // Split path into segments
  const segments = englishPath.split('/').filter(Boolean);
  
  // Translate each segment
  const translatedSegments = segments.map(segment => {
    const key = `${languageCode}:${segment}`;
    const translated = translationMap.get(key);
    return translated || segment; // Fall back to English if no translation
  });
  
  // Build final URL with language or country prefix
  // UPDATED: All languages use /{lang}/* format (including English = /en)
  const translatedPath = translatedSegments.length > 0 ? '/' + translatedSegments.join('/') : '';
  const prefix = countryCode ? `/${countryCode}` : `/${languageCode}`;
  
  return `${prefix}${translatedPath}`;
}

export class SeoRenderer {
  
  async getTranslationsForLanguage(language: string, signal?: AbortSignal): Promise<Record<string, string>> {
    const cached = performanceCache.getTranslations(language);
    if (cached) {
      return cached;
    }
    
    try {
      const translations = await withSignal(Translation.find({ language }).populate('keyId').lean(), signal);
      const translationMap: Record<string, string> = {};
      
      translations.forEach((t: any) => {
        if (t.keyId?.key && t.value) {
          translationMap[t.keyId.key] = t.value;
        }
      });
      
      // Cache for future requests
      performanceCache.setTranslations(language, translationMap);
      
      return translationMap;
    } catch (error: any) {
      if (error?.name === 'AbortError' || signal?.aborted) throw error;
      console.error(`❌ Failed to fetch translations for ${language}:`, error);
      return {};
    }
  }
  
  /**
   * Fetch custom SEO metadata from database for a specific page
   * Returns null if no published metadata exists
   */
  async getCustomSeoMetadata(pageType: string, routeKey: string, language: string, signal?: AbortSignal): Promise<any | null> {
    try {
      const metadata = await withSignal(SeoMetadata.findOne({
        pageType,
        routeKey: routeKey || '',
        language,
        status: 'published'
      }).lean(), signal);
      
      return metadata;
    } catch (error: any) {
      if (error?.name === 'AbortError' || signal?.aborted) throw error;
      logger.error(`❌ Failed to fetch custom SEO metadata:`, error);
      return null;
    }
  }
  
  /**
   * Apply custom SEO metadata to base SEO tags if available
   */
  applyCustomSeoMetadata(baseSeoTags: any, customMetadata: any): any {
    if (!customMetadata) return baseSeoTags;
    
    // Override with custom values if present
    if (customMetadata.title) baseSeoTags.title = customMetadata.title;
    if (customMetadata.description) baseSeoTags.description = customMetadata.description;
    if (customMetadata.ogTitle) baseSeoTags.ogTitle = customMetadata.ogTitle;
    if (customMetadata.ogDescription) baseSeoTags.ogDescription = customMetadata.ogDescription;
    if (customMetadata.ogImageUrl) baseSeoTags.ogImage = customMetadata.ogImageUrl;
    if (customMetadata.twitterTitle) baseSeoTags.twitterTitle = customMetadata.twitterTitle;
    if (customMetadata.twitterDescription) baseSeoTags.twitterDescription = customMetadata.twitterDescription;
    if (customMetadata.twitterImageUrl) baseSeoTags.twitterImage = customMetadata.twitterImageUrl;
    if (customMetadata.canonicalUrl) baseSeoTags.canonical = customMetadata.canonicalUrl;
    if (customMetadata.metaKeywords) baseSeoTags.keywords = customMetadata.metaKeywords;
    if (customMetadata.noIndex) baseSeoTags.noIndex = customMetadata.noIndex;
    if (customMetadata.noFollow) baseSeoTags.noFollow = customMetadata.noFollow;
    
    return baseSeoTags;
  }
  
  async renderStaticPage(url: string, domain: string = '', preferredLanguage?: string): Promise<StaticPageData> {
    if (seoRenderActive >= SEO_RENDER_MAX_CONCURRENT) {
      seoRenderRejected++;
      logger.log(`⚠️ SEO render rejected (active=${seoRenderActive}, rejected=${seoRenderRejected}): ${url}`);
      throw new Error('SEO_RENDER_OVERLOADED');
    }

    seoRenderActive++;

    const abortController = new AbortController();
    let timerId: ReturnType<typeof setTimeout> | undefined;

    try {
      const result = await Promise.race([
        this._doRenderStaticPage(url, domain, preferredLanguage, abortController.signal),
        new Promise<never>((_, reject) => {
          timerId = setTimeout(() => {
            abortController.abort();
            reject(new Error('SEO_RENDER_TIMEOUT'));
          }, SEO_RENDER_TIMEOUT_MS);
        })
      ]);
      clearTimeout(timerId);
      return result;
    } catch (err: any) {
      clearTimeout(timerId);
      if (!abortController.signal.aborted) abortController.abort();
      if (err?.message === 'SEO_RENDER_TIMEOUT' || err?.name === 'AbortError') {
        throw new Error('SEO_RENDER_TIMEOUT');
      }
      throw err;
    } finally {
      seoRenderActive--;
    }
  }

  private async _doRenderStaticPage(url: string, domain: string = '', preferredLanguage?: string, signal?: AbortSignal): Promise<StaticPageData> {
    return trackOperation('seo-render', async () => {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const cleanUrl = url.split('?')[0].split('#')[0];

    // Get language from URL path, but prefer user's stored preference if available
    let { language, cleanPath } = getLanguageFromPath(cleanUrl);
    
    // CRITICAL: Language/Country separation
    // If user has a stored language preference (from cookie), use that instead of country-derived language
    // This ensures a Turkish user viewing /de/ sees Turkish UI, not German
    if (preferredLanguage && preferredLanguage.toLowerCase() !== language.toLowerCase()) {
      // Validate the preferred language is enabled (case-insensitive comparison for hyphenated codes like pt-BR)
      const normalizedPref = preferredLanguage.toLowerCase();
      const matchedLang = SEO_LANGUAGES.find(l => l.code.toLowerCase() === normalizedPref && l.enabled);
      if (matchedLang) {
        logger.log(`🌍 SSR: Using stored language preference '${matchedLang.code}' instead of URL-derived '${language}'`);
        language = matchedLang.code; // Use the canonical casing from SEO_LANGUAGES
      }
    }
    
    // CRITICAL: Cache key uses cleanUrl (query/hash stripped) + preferredLanguage to avoid collision
    // Without this, /de/ cached in German would be served to Turkish users
    // Using cleanUrl prevents unbounded cache key cardinality from query params
    const normalizedLang = preferredLanguage?.toLowerCase();
    const cacheKey = normalizedLang ? `${cleanUrl}|lang=${normalizedLang}` : cleanUrl;
    
    // Check cache for complete page data first
    const cachedPageData = performanceCache.getPageData(cacheKey);
    if (cachedPageData) {
      return cachedPageData;
    }
    
    const translations = await this.getTranslationsForLanguage(language, signal);
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    
    const urlTranslations = await performanceCache.getUrlTranslations();
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    
    // Detect if this is a country-specific URL (e.g., /al/zhanret)
    const urlParts = url.split('/').filter(Boolean);
    let countryCode: string | undefined;
    // CRITICAL: Keep the language we already determined (possibly from cookie preference)
    // Only extract country code for URL building, NOT for language determination
    let actualLanguage = language;
    
    if (urlParts.length > 0) {
      const firstSegment = urlParts[0].toLowerCase();
      // Check if first segment is a country code
      if (COUNTRY_TO_LANGUAGE[firstSegment]) {
        countryCode = firstSegment;
        // DO NOT override actualLanguage here - language was already determined above
        // (either from path translation or preferredLanguage cookie)
        // This ensures a Turkish user on /de/ sees Turkish UI
      }
    }
    
    // Build localized URL path for canonical URL
    // This translates English paths like /genres to language-specific paths like /zhanret (Albanian)
    const localizedPath = buildLocalizedUrl(cleanPath, actualLanguage, countryCode, urlTranslations);
    
    // Determine page type from path and extract relevant data
    let pageType = 'home';
    let stationData: any = null;
    let additionalData: any = {};
    
    // Helper function to detect if path is a station path in ANY language
    const isStationPath = (path: string): { isStation: boolean; stationSlug?: string } => {
      // Check English paths (both singular and plural - some languages reverse-translate to 'stations')
      if (path.startsWith('/station/')) {
        return { isStation: true, stationSlug: path.split('/station/')[1] };
      }
      if (path.startsWith('/stations/')) {
        return { isStation: true, stationSlug: path.split('/stations/')[1] };
      }
      
      // Check all language translations for 'station' and 'stations' paths
      for (const [langCode, translations] of Object.entries(URL_TRANSLATIONS)) {
        const stationTranslation = translations.station;
        if (stationTranslation && path.startsWith(`/${stationTranslation}/`)) {
          return { isStation: true, stationSlug: path.split(`/${stationTranslation}/`)[1] };
        }
        
        // Also check 'stations' (plural) in case reverse translation gives plural form
        const stationsTranslation = translations.stations;
        if (stationsTranslation && stationsTranslation !== stationTranslation && path.startsWith(`/${stationsTranslation}/`)) {
          return { isStation: true, stationSlug: path.split(`/${stationsTranslation}/`)[1] };
        }
      }
      
      return { isStation: false };
    };
    
    // Enhanced page type detection with more specific routing
    const stationCheck = isStationPath(cleanPath);
    if (stationCheck.isStation) {
      pageType = 'station';
      // Extract station slug from path
      const stationSlug = stationCheck.stationSlug;
      if (stationSlug) {
        try {
          stationData = await withSignal(Station.findOne({ slug: stationSlug }).lean(), signal);
          
          if (!stationData && stationSlug.match(/^[0-9a-fA-F]{24}$/)) {
            stationData = await withSignal(Station.findById(stationSlug).lean(), signal);
          }
          
          // DEFENSIVE GUARD: If station not found, create minimal placeholder data
          // This prevents 500 errors when SEO tag generation expects station data
          if (!stationData) {
            // Create minimal station data from slug for SEO purposes
            const stationName = stationSlug
              .replace(/-/g, ' ')
              .replace(/\b\w/g, (l: string) => l.toUpperCase());
            stationData = {
              _id: null,
              name: stationName,
              slug: stationSlug,
              country: '',
              tags: '',
              url: '',
              favicon: '',
              description: ''
            };
          }
        } catch (error: any) {
          if (error?.name === 'AbortError' || signal?.aborted) throw error;
          const stationName = stationSlug
            .replace(/-/g, ' ')
            .replace(/\b\w/g, (l: string) => l.toUpperCase());
          stationData = {
            _id: null,
            name: stationName,
            slug: stationSlug,
            country: '',
            tags: '',
            url: '',
            favicon: '',
            description: ''
          };
        }
      }
    } else if (cleanPath.startsWith('/genres')) {
      pageType = 'genres';
      // Extract genre slug if present for more specific SEO
      const pathParts = cleanPath.split('/');
      if (pathParts.length > 2) {
        additionalData.genreSlug = pathParts[2];
        additionalData.genreName = pathParts[2].replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
      }
    } else if (cleanPath.startsWith('/stations')) {
      pageType = 'stations';
    } else if (cleanPath.startsWith('/regions')) {
      pageType = 'regions';
      // Extract region/country information for more specific SEO
      const pathParts = cleanPath.split('/');
      if (pathParts.length > 2) {
        additionalData.region = pathParts[2];
        // Set regionName for title generation (capitalize properly)
        additionalData.regionName = pathParts[pathParts.length - 1]
          .split('-')
          .map(word => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' ');
        if (pathParts.length > 3) {
          additionalData.country = pathParts[3];
        }
        if (pathParts.length > 4) {
          additionalData.city = pathParts[4];
        }
      }
    } else if (cleanPath === '/tv') {
      pageType = 'tv';
    } else if (cleanPath.startsWith('/about')) {
      pageType = 'about';
    } else if (cleanPath.startsWith('/contact')) {
      pageType = 'contact';
    } else if (cleanPath.startsWith('/applications')) {
      pageType = 'applications';
    } else if (cleanPath.startsWith('/terms-and-conditions') || cleanPath.startsWith('/pages/terms-and-conditions')) {
      pageType = 'terms';
    } else if (cleanPath.startsWith('/privacy-policy') || cleanPath.startsWith('/pages/privacy-policy')) {
      pageType = 'privacy';
    } else if (cleanPath === '/' || cleanPath === '') {
      pageType = 'home';
      try {
        const popularStations = await withSignal(
          Station.find({ votes: { $gt: 0 } })
            .sort({ votes: -1 })
            .limit(10)
            .select('name slug favicon logoAssets country tags votes')
            .lean(),
          signal
        );
        additionalData.popularStations = popularStations;
      } catch (error: any) {
        if (error?.name === 'AbortError' || signal?.aborted) throw error;
      }
    }
    
    // Generate enhanced SEO tags with additional context
    // Pass localized path to use translated paths in canonical URL
    // Also pass urlTranslations map for hreflang tags with translated paths
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    let seoTags = this.generateEnhancedSeoTags(pageType, language, translations, cleanPath, domain, stationData, additionalData, cleanUrl, localizedPath, urlTranslations);
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    // Map internal pageTypes to database format
    const dbPageTypeMap: Record<string, string> = {
      'home': 'homepage',
      'station': 'station_detail',
      'genres': 'genre_detail',
      'regions': 'country_detail',
      'about': 'static',
      'contact': 'static',
      'terms': 'static',
      'privacy': 'static',
      'applications': 'static',
      'tv': 'static'
    };
    
    const dbPageType = dbPageTypeMap[pageType] || pageType;
    
    // Extract routeKey for the page (matches admin UI storage format)
    // Admin stores full cleanPath minus language prefix (e.g., "genres/rock", "station/bbc-radio-1")
    let routeKey = '';
    if (pageType === 'station' && stationData?.slug) {
      // Station pages use slug directly for cleaner lookups
      routeKey = stationData.slug;
    } else if (pageType === 'genres') {
      // Genre pages: use cleanPath starting from /genres (e.g., "genres/rock")
      routeKey = cleanPath.startsWith('/') ? cleanPath.slice(1) : cleanPath;
    } else if (pageType === 'regions') {
      // Region pages: use cleanPath starting from /regions (e.g., "regions/europe/germany")
      routeKey = cleanPath.startsWith('/') ? cleanPath.slice(1) : cleanPath;
    } else if (pageType === 'home') {
      // Homepage: empty routeKey
      routeKey = '';
    } else if (['about', 'contact', 'terms', 'privacy', 'applications'].includes(pageType)) {
      // Static pages: use pageType as routeKey
      routeKey = pageType;
    }
    
    const customMetadata = await this.getCustomSeoMetadata(dbPageType, routeKey, language, signal);
    if (customMetadata) {
      logger.log(`🎯 Using custom SEO metadata for ${dbPageType}/${routeKey}/${language}`);
      seoTags = this.applyCustomSeoMetadata(seoTags, customMetadata);
    }
    
    // Compile the static page data
    const pageData = {
      language,
      cleanPath,
      seoTags,
      translations,
      urlTranslations,
      pageData: { pageType, station: stationData, seoTags, ...additionalData, additionalData }
    };
    
    performanceCache.setPageData(cacheKey, pageData);
    
    return pageData;
    }, url);
  }

  generateEnhancedSeoTags(
    pageType: string, 
    language: string, 
    translations: Record<string, string>, 
    cleanPath: string, 
    domain: string, 
    stationData?: any, 
    additionalData?: any,
    originalPath?: string,  // Original URL path to preserve country codes
    translatedPath?: string,  // Translated path from database for canonical URL
    urlTranslations?: Map<string, string>  // URL translations map for all languages
  ): any {
    // Use the existing generateSeoTags function as base
    // Pass translated path to use localized paths in canonical URL (e.g., /sq/zhanret instead of /sq/genres)
    // Also pass urlTranslations map for generating hreflang tags with translated paths
    const baseSeoTags = generateSeoTags(pageType, language, translations, cleanPath, domain, stationData, originalPath, translatedPath, urlTranslations);
    
    // Helper to get translations from database — with English fallbacks for critical SEO keys
    // These keys are often empty in non-English DB → without fallbacks titles become "Pop  -  | Mega Radio"
    const SEO_KEY_FALLBACKS: Record<string, string> = {
      seo_radio_stations: 'Radio Stations',
      seo_listen_live_online: 'Listen Live Online',
      seo_listen_to_live_radio_from: 'Listen to live radio from',
      seo_discover_local: 'Discover local',
      seo_music_and_shows: 'music and shows',
      seo_radio_broadcasting_free: 'radio broadcasting for free',
      seo_regional_broadcasting: 'Regional Broadcasting',
      seo_explore_radio_stations_from: 'Explore radio stations from',
      seo_listen_to_regional_broadcasting: 'Listen to regional broadcasting',
    };
    const getTranslation = (key: string): string => translations[key] || SEO_KEY_FALLBACKS[key] || '';

    // Enhance with more specific content based on page type and additional data
    // Same logic as before, but using database translations
    if (pageType === 'regions' && additionalData) {
      if (additionalData.country) {
        const countryName = additionalData.country.replace(/-/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase());
        baseSeoTags.title = `${countryName} ${getTranslation('seo_radio_stations')} - ${getTranslation('seo_listen_live_online')} | Mega Radio`;
        baseSeoTags.description = `${getTranslation('seo_listen_to_live_radio_from')} ${countryName}. ${getTranslation('seo_discover_local')} ${countryName} ${getTranslation('seo_radio_broadcasting_free')}.`;
        baseSeoTags.keywords = `${countryName} radio, ${countryName} radio stations, ${countryName} live radio`;
      } else if (additionalData.region) {
        const regionName = additionalData.region.replace(/-/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase());
        baseSeoTags.title = `${regionName} ${getTranslation('seo_radio_stations')} - ${getTranslation('seo_regional_broadcasting')} | Mega Radio`;
        baseSeoTags.description = `${getTranslation('seo_explore_radio_stations_from')} ${regionName}. ${getTranslation('seo_listen_to_regional_broadcasting')}.`;
        baseSeoTags.keywords = `${regionName} radio, ${regionName} broadcasting, regional radio`;
      }
    }
    
    if (pageType === 'genres' && additionalData?.genreName) {
      baseSeoTags.title = `${additionalData.genreName} ${getTranslation('seo_radio_stations')} - ${getTranslation('seo_listen_live_online')} | Mega Radio`;
      baseSeoTags.description = `${getTranslation('seo_listen_to_live_radio_from')} ${additionalData.genreName}. ${getTranslation('seo_discover_local')} ${additionalData.genreName} ${getTranslation('seo_music_and_shows')}.`;
      baseSeoTags.keywords = `${additionalData.genreName} radio, ${additionalData.genreName} music, ${additionalData.genreName} stations`;
    }
    
    if (pageType === 'about') {
      baseSeoTags.title = getTranslation('about_mega_radio');
      baseSeoTags.description = getTranslation('about_mega_radio_description');
      baseSeoTags.ogType = 'website';
    }
    
    if (pageType === 'contact') {
      baseSeoTags.title = getTranslation('contact_page_title');
      baseSeoTags.description = getTranslation('contact_page_description');
      baseSeoTags.ogType = 'website';
    }
    
    if (pageType === 'applications') {
      baseSeoTags.title = 'Mega Radio Apps - Download for iOS, Android, Smart TV & Desktop';
      baseSeoTags.description = 'Download Mega Radio apps for your iOS, Android, Smart TV, and desktop devices. Stream 60,000+ radio stations on all your favorite platforms.';
      baseSeoTags.ogType = 'website';
    }
    
    if (pageType === 'tv') {
      baseSeoTags.title = `${getTranslation('tv_login_title') || 'Connect Your TV'} | Mega Radio`;
      baseSeoTags.description = getTranslation('tv_enter_code_description') || 'Open Mega Radio on your TV and enter the 6-digit code displayed on the screen.';
      baseSeoTags.ogType = 'website';
    }
    
    if (pageType === 'terms') {
      baseSeoTags.title = 'Terms and Conditions - Mega Radio';
      baseSeoTags.description = 'Read the Terms and Conditions for using Mega Radio\'s online radio streaming platform. Learn about our service policies and user agreements.';
      baseSeoTags.ogType = 'website';
    }
    
    if (pageType === 'privacy') {
      baseSeoTags.title = 'Privacy Policy - Mega Radio';
      baseSeoTags.description = 'Learn how Mega Radio protects your privacy and handles your personal data. Read our comprehensive privacy policy and data protection practices.';
      baseSeoTags.ogType = 'website';
    }
    
    // Generate comprehensive hreflang tags for all pages with translated paths
    // CRITICAL SEO FIX: Pass canonical URL for self-referential hreflang
    baseSeoTags.hreflangs = generateLanguageUrls(cleanPath, domain, language, urlTranslations, baseSeoTags.canonical);
    
    return baseSeoTags;
  }
  
  private escapeHtml(input: string): string {
    if (!input) return '';
    return input
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;');
  }

  private getH1Text(pageType: string, language: string, translations: Record<string, string>, seoTags?: any, stationData?: any, additionalData?: any): string {
    // Helper function to get localized text from DATABASE ONLY (no hardcoded translations)
    const getLocalizedText = (key: string): string => {
      // Use database translations ONLY - everything comes from backend
      return translations[key] || '';
    };

    switch (pageType) {
      case 'home':
        // CRITICAL SEO FIX: H1 MUST match page title for SEO optimization
        // Use the EXACT same text that appears in <title> tag to guarantee alignment
        // This ensures "Words from page title are used in H1" requirement is met
        return seoTags?.title || getLocalizedText('hero_worlds_best_radio');
      
      case 'station':
        if (stationData) {
          return seoTags?.title || this.escapeHtml(generateLocalizedStationTitle(stationData, language, translations));
        }
        return getLocalizedText('stations_page_title');
      
      case 'genres':
        if (additionalData?.genreName) {
          const genreName = this.escapeHtml(additionalData.genreName);
          const radioStationsText = translations['seo_radio_stations'] || 'Radio Stations';
          const listenLiveText = translations['seo_listen_live_online'] || 'Listen Live Online';
          return `${genreName} ${radioStationsText} — ${listenLiveText} | Mega Radio`;
        }
        return getLocalizedText('genres_page_title');
      
      case 'regions':
        if (additionalData?.regionName) {
          const regionName = this.escapeHtml(additionalData.regionName);
          const radioStationsText = translations['seo_radio_stations'] || 'Radio Stations';
          const listenLiveText = translations['seo_listen_live_online'] || 'Listen Live Online';
          return `${regionName} ${radioStationsText} — ${listenLiveText} | Mega Radio`;
        }
        return getLocalizedText('regions_page_title');
      
      case 'stations':
        return getLocalizedText('stations_page_title');
      
      case 'about':
        return getLocalizedText('about_mega_radio');
      
      case 'contact':
        return getLocalizedText('contact_page_title');
      
      case 'applications':
        return 'Mega Radio Apps - Download for iOS, Android, Smart TV & Desktop';
      
      case 'terms':
        return 'Terms and Conditions - Mega Radio';
      
      case 'privacy':
        return 'Privacy Policy - Mega Radio';
      
      default:
        return getLocalizedText('hero_worlds_best_radio');
    }
  }

  generateHtmlBody(pageData: { pageType: string; language: string; translations: Record<string, string>; seoTags?: any; stationData?: any; additionalData?: any }): string {
    const { pageType, language, translations, seoTags, stationData, additionalData } = pageData;
    const h1Text = this.getH1Text(pageType, language, translations, seoTags, stationData, additionalData);
    
    // Generate a minimal but semantic HTML body for SEO
    const getLocalizedText = (key: string, fallback: string): string => {
      return translations[key] || fallback;
    };

    let content = '';
    
    switch (pageType) {
      case 'home':
        content = `
          <main>
            <div class="hero-section text-center">
              <p class="text-md font-medium">${this.escapeHtml(getLocalizedText('hero_over_100_countries', '60,000+ radio stations from 120+ countries'))}</p>
              <h1 class="text-xl font-bold sm:text-3xl lg:text-[44px]">${this.escapeHtml(h1Text)}</h1>
              <h2 class="text-lg sm:text-2xl">${this.escapeHtml(getLocalizedText('hero_listen_everywhere', 'Listen everywhere, anytime, for free'))}</h2>
            </div>
            
            <!-- SEO Opening Paragraph - Uses H1 Keywords -->
            <section class="intro-section">
              <p>${this.escapeHtml(getLocalizedText('seo_opening_paragraph', `${h1Text} - your gateway to unlimited radio streaming worldwide. Discover and listen to free live radio stations, music, news, sports, and entertainment from every corner of the globe. With thousands of online radio broadcasts available 24/7, you can enjoy crystal-clear audio streaming on any device, completely free of charge.`).replace('{h1}', h1Text))}</p>
            </section>
            
            <!-- SEO Navigation Links -->
            <nav class="main-navigation">
              <h2>${this.escapeHtml(getLocalizedText('explore_mega_radio', 'Explore Mega Radio'))}</h2>
              <ul>
                <li><a href="/${language === 'en' ? '' : language + '/'}genres">${this.escapeHtml(getLocalizedText('nav_genres', 'Radio Genres'))}</a></li>
                <li><a href="/${language === 'en' ? '' : language + '/'}regions">${this.escapeHtml(getLocalizedText('nav_regions', 'Radio by Country'))}</a></li>
                <li><a href="/${language === 'en' ? '' : language + '/'}stations">${this.escapeHtml(getLocalizedText('nav_stations', 'All Stations'))}</a></li>
                <li><a href="/${language === 'en' ? '' : language + '/'}recommendations">${this.escapeHtml(getLocalizedText('nav_for_you', 'For You'))}</a></li>
                <li><a href="/${language === 'en' ? '' : language + '/'}users">${this.escapeHtml(getLocalizedText('nav_users', 'Community'))}</a></li>
              </ul>
            </nav>
            
            <!-- Popular Genres Links -->
            <section class="popular-genres">
              <h2>${this.escapeHtml(getLocalizedText('popular_genres_title', 'Popular Radio Genres'))}</h2>
              <ul>
                <li><a href="/${language === 'en' ? '' : language + '/'}genres/pop">${this.escapeHtml(getLocalizedText('genre_pop_radio', 'Pop Radio Stations'))}</a></li>
                <li><a href="/${language === 'en' ? '' : language + '/'}genres/rock">${this.escapeHtml(getLocalizedText('genre_rock_radio', 'Rock Radio Stations'))}</a></li>
                <li><a href="/${language === 'en' ? '' : language + '/'}genres/jazz">${this.escapeHtml(getLocalizedText('genre_jazz_radio', 'Jazz Radio Stations'))}</a></li>
                <li><a href="/${language === 'en' ? '' : language + '/'}genres/classical">${this.escapeHtml(getLocalizedText('genre_classical_radio', 'Classical Radio Stations'))}</a></li>
                <li><a href="/${language === 'en' ? '' : language + '/'}genres/electronic">${this.escapeHtml(getLocalizedText('genre_electronic_radio', 'Electronic Radio Stations'))}</a></li>
                <li><a href="/${language === 'en' ? '' : language + '/'}genres/country">${this.escapeHtml(getLocalizedText('genre_country_radio', 'Country Radio Stations'))}</a></li>
                <li><a href="/${language === 'en' ? '' : language + '/'}genres/hip-hop">${this.escapeHtml(getLocalizedText('genre_hiphop_radio', 'Hip Hop Radio Stations'))}</a></li>
                <li><a href="/${language === 'en' ? '' : language + '/'}genres/reggae">${this.escapeHtml(getLocalizedText('genre_reggae_radio', 'Reggae Radio Stations'))}</a></li>
              </ul>
            </section>
            
            <!-- Major Countries Links -->
            <section class="popular-countries">
              <h2>${this.escapeHtml(getLocalizedText('popular_countries_title', 'Radio Stations by Country'))}</h2>
              <ul>
                <li><a href="/${language === 'en' ? '' : language + '/'}regions/united-states">${this.escapeHtml(getLocalizedText('country_usa_radio', 'United States Radio'))}</a></li>
                <li><a href="/${language === 'en' ? '' : language + '/'}regions/united-kingdom">${this.escapeHtml(getLocalizedText('country_uk_radio', 'United Kingdom Radio'))}</a></li>
                <li><a href="/${language === 'en' ? '' : language + '/'}regions/germany">${this.escapeHtml(getLocalizedText('country_germany_radio', 'Germany Radio'))}</a></li>
                <li><a href="/${language === 'en' ? '' : language + '/'}regions/france">${this.escapeHtml(getLocalizedText('country_france_radio', 'France Radio'))}</a></li>
                <li><a href="/${language === 'en' ? '' : language + '/'}regions/canada">${this.escapeHtml(getLocalizedText('country_canada_radio', 'Canada Radio'))}</a></li>
                <li><a href="/${language === 'en' ? '' : language + '/'}regions/australia">${this.escapeHtml(getLocalizedText('country_australia_radio', 'Australia Radio'))}</a></li>
                <li><a href="/${language === 'en' ? '' : language + '/'}regions/brazil">${this.escapeHtml(getLocalizedText('country_brazil_radio', 'Brazil Radio'))}</a></li>
                <li><a href="/${language === 'en' ? '' : language + '/'}regions/italy">${this.escapeHtml(getLocalizedText('country_italy_radio', 'Italy Radio'))}</a></li>
                <li><a href="/${language === 'en' ? '' : language + '/'}regions/spain">${this.escapeHtml(getLocalizedText('country_spain_radio', 'Spain Radio'))}</a></li>
                <li><a href="/${language === 'en' ? '' : language + '/'}regions/turkey">${this.escapeHtml(getLocalizedText('country_turkey_radio', 'Turkey Radio'))}</a></li>
                <li><a href="/${language === 'en' ? '' : language + '/'}regions/japan">${this.escapeHtml(getLocalizedText('country_japan_radio', 'Japan Radio'))}</a></li>
                <li><a href="/${language === 'en' ? '' : language + '/'}regions/india">${this.escapeHtml(getLocalizedText('country_india_radio', 'India Radio'))}</a></li>
              </ul>
            </section>
            
            <!-- About Mega Radio -->
            <section class="about-section">
              <h2>${this.escapeHtml(getLocalizedText('faq_about_megaradio', 'About Mega Radio'))}</h2>
              <p>${this.escapeHtml(getLocalizedText('faq_seo_intro', 'Mega Radio is your ultimate destination for discovering and streaming live radio stations from around the world. With over 60,000 free radio stations spanning 120+ countries, we deliver unlimited access to music, news, sports, and entertainment across every language and genre.'))}</p>
              
              <nav class="footer-links">
                <ul>
                  <li><a href="/${language === 'en' ? '' : language + '/'}about">${this.escapeHtml(getLocalizedText('nav_about', 'About Us'))}</a></li>
                  <li><a href="/${language === 'en' ? '' : language + '/'}contact">${this.escapeHtml(getLocalizedText('nav_contact', 'Contact'))}</a></li>
                  <li><a href="/${language === 'en' ? '' : language + '/'}privacy-policy">${this.escapeHtml(getLocalizedText('nav_privacy', 'Privacy Policy'))}</a></li>
                  <li><a href="/${language === 'en' ? '' : language + '/'}terms-and-conditions">${this.escapeHtml(getLocalizedText('nav_terms', 'Terms of Service'))}</a></li>
                  <li><a href="/${language === 'en' ? '' : language + '/'}applications">${this.escapeHtml(getLocalizedText('nav_apps', 'Mobile Apps'))}</a></li>
                </ul>
              </nav>
            </section>
          </main>
        `;
        break;
      
      case 'station':
        content = `
          <main>
            <h1>${this.escapeHtml(h1Text)}</h1>
            ${stationData ? `
              <div class="station-info">
                <!-- AI-Generated Description (unique per station) -->
                <h2>${this.escapeHtml(getLocalizedText('about_station', 'About ' + stationData.name))}</h2>
                ${stationData.descriptions && stationData.descriptions[language] ? (() => {
                  const desc = stationData.descriptions[language];
                  let fullText = '';
                  if (typeof desc === 'object' && desc.full) {
                    fullText = desc.full;
                  } else if (typeof desc === 'string') {
                    fullText = desc;
                  }
                  fullText = fullText
                    .replace(/^\s*\[TRANSLATED\s+FULL\s+DESCRIPTION\]\s*/i, '')
                    .replace(/^\s*\[TRANSLATED\s+META[^\]]*\]\s*/i, '')
                    .replace(/^\s*\[FULL\s+DESCRIPTION[^\]]*\]\s*/i, '')
                    .replace(/^\s*\[[^\]]*DESCRIPTION[^\]]*\]\s*/i, '')
                    .replace(/^\s*\[[^\]]*\]\s*/g, '')
                    .replace(/\{STATION_NAME\}/g, stationData.name)
                    .trim();
                  if (fullText && fullText.length > 300) {
                    const sentences = fullText.match(/[^.!?]+[.!?]+/g) || [fullText];
                    const paragraphs = [];
                    let currentParagraph = '';
                    for (const sentence of sentences) {
                      currentParagraph += sentence;
                      if (currentParagraph.length > 400) {
                        paragraphs.push(currentParagraph.trim());
                        currentParagraph = '';
                      }
                    }
                    if (currentParagraph.trim()) {
                      paragraphs.push(currentParagraph.trim());
                    }
                    return paragraphs.map(p => '<p>' + this.escapeHtml(p) + '</p>').join('');
                  } else if (fullText) {
                    return '<p>' + this.escapeHtml(fullText) + '</p>';
                  }
                  return '';
                })() : (stationData.description ? `<p>${this.escapeHtml(stationData.description)}</p>` : '')}
                
                <!-- Station Details -->
                <section class="station-details">
                  <h2>${this.escapeHtml(getLocalizedText('station_information', 'Station Information'))}</h2>
                  ${stationData.country ? `
                  <p><strong>${this.escapeHtml(getLocalizedText('country', 'Country'))}:</strong> ${this.escapeHtml(stationData.country)}</p>
                  ` : ''}
                  ${stationData.tags ? `
                  <p><strong>${this.escapeHtml(getLocalizedText('genres', 'Genres'))}:</strong> ${stationData.tags.split(',').slice(0, 6).map((tag: string) => this.escapeHtml(tag.trim())).join(', ')}</p>
                  ` : ''}
                  ${stationData.url ? `
                  <p><strong>${this.escapeHtml(getLocalizedText('website', 'Official Website'))}:</strong> <a href="${this.escapeHtml(stationData.url)}" target="_blank" rel="noopener noreferrer nofollow">${this.escapeHtml(stationData.url)}</a></p>
                  ` : ''}
                </section>
                
                <!-- Navigation -->
                <nav class="explore-nav">
                  <ul>
                    <li><a href="/${language === 'en' ? '' : language + '/'}genres">${this.escapeHtml(getLocalizedText('nav_genres', 'Browse All Radio Genres'))}</a></li>
                    <li><a href="/${language === 'en' ? '' : language + '/'}regions">${this.escapeHtml(getLocalizedText('nav_regions', 'Radio Stations by Country'))}</a></li>
                    <li><a href="/${language === 'en' ? '' : language + '/'}stations">${this.escapeHtml(getLocalizedText('nav_stations', 'Explore All Stations'))}</a></li>
                    <li><a href="/${language === 'en' ? '' : language + '/'}">${this.escapeHtml(getLocalizedText('nav_home', 'Home'))}</a></li>
                  </ul>
                </nav>
              </div>
            ` : ''}
          </main>
        `;
        break;
      
      case 'genres':
        {
          const genreName = additionalData?.genreName || '';
          const langPrefix = language === 'en' ? '' : `/${language}`;
          content = `
          <main>
            <h1>${this.escapeHtml(h1Text)}</h1>
            ${genreName ? `
            <section>
              <p>${this.escapeHtml(getLocalizedText('seo_listen_to_live_radio_from', 'Listen to live radio from'))} ${this.escapeHtml(genreName)}. ${this.escapeHtml(getLocalizedText('seo_discover_local', 'Discover local'))} ${this.escapeHtml(genreName)} ${this.escapeHtml(getLocalizedText('seo_music_and_shows', 'music and shows'))} ${this.escapeHtml(getLocalizedText('streaming_free', 'streaming for free on Mega Radio'))}.</p>
              <p>${this.escapeHtml(getLocalizedText('hero_over_100_countries', 'Browse 60,000+ radio stations from 120+ countries'))} — ${this.escapeHtml(genreName)} ${this.escapeHtml(getLocalizedText('seo_radio_stations', 'Radio Stations'))} ${this.escapeHtml(getLocalizedText('streaming_available_24_7', 'available 24/7 for free streaming'))}.</p>
            </section>` : ''}
            <nav>
              <ul>
                <li><a href="${langPrefix}/genres">${this.escapeHtml(getLocalizedText('nav_genres', 'All Radio Genres'))}</a></li>
                <li><a href="${langPrefix}/stations">${this.escapeHtml(getLocalizedText('nav_stations', 'All Stations'))}</a></li>
                <li><a href="${langPrefix}/regions">${this.escapeHtml(getLocalizedText('nav_regions', 'Radio by Country'))}</a></li>
                <li><a href="${langPrefix}/">${this.escapeHtml(getLocalizedText('nav_home', 'Home'))}</a></li>
              </ul>
            </nav>
          </main>
        `;
        }
        break;

      case 'regions':
        {
          const regionName = additionalData?.regionName || additionalData?.country || additionalData?.region || '';
          const langPrefix = language === 'en' ? '' : `/${language}`;
          content = `
          <main>
            <h1>${this.escapeHtml(h1Text)}</h1>
            ${regionName ? `
            <section>
              <p>${this.escapeHtml(getLocalizedText('seo_explore_radio_stations_from', 'Explore radio stations from'))} ${this.escapeHtml(regionName)}. ${this.escapeHtml(getLocalizedText('seo_listen_to_regional_broadcasting', 'Listen to regional broadcasting'))} ${this.escapeHtml(getLocalizedText('streaming_free', 'for free on Mega Radio'))}.</p>
              <p>${this.escapeHtml(getLocalizedText('hero_over_100_countries', 'Browse 60,000+ radio stations from 120+ countries'))} — ${this.escapeHtml(regionName)} ${this.escapeHtml(getLocalizedText('seo_radio_stations', 'Radio Stations'))} ${this.escapeHtml(getLocalizedText('streaming_available_24_7', 'available 24/7'))}.</p>
            </section>` : ''}
            <nav>
              <ul>
                <li><a href="${langPrefix}/regions">${this.escapeHtml(getLocalizedText('nav_regions', 'All Regions'))}</a></li>
                <li><a href="${langPrefix}/stations">${this.escapeHtml(getLocalizedText('nav_stations', 'All Stations'))}</a></li>
                <li><a href="${langPrefix}/genres">${this.escapeHtml(getLocalizedText('nav_genres', 'Radio Genres'))}</a></li>
                <li><a href="${langPrefix}/">${this.escapeHtml(getLocalizedText('nav_home', 'Home'))}</a></li>
              </ul>
            </nav>
          </main>
        `;
        }
        break;

      default:
        content = `
          <main>
            <h1>${this.escapeHtml(h1Text)}</h1>
          </main>
        `;
        break;
    }

    return content;
  }

  generateHtmlHead(seoTags: any, language: string = 'en', translations: Record<string, string> = {}, cleanPath: string = '', stationData?: any, urlTranslations?: Map<string, string>, additionalData?: any): string {
    
    // Enhanced social media meta tags
    // CRITICAL: WhatsApp requires minimum 600x315px images for preview
    // Use dynamic OG image generator for station pages (1200x630 with station logo)
    // For OG images: use actual domain from seoTags (supports dev testing)
    // Extract just the domain without protocol for og:image URLs
    let ogDomain = 'themegaradio.com';
    if (seoTags.domain) {
      ogDomain = seoTags.domain.replace(/^https?:\/\//, '');
    }
    const defaultSocialImage = `https://${ogDomain}/api/og-image`;
    let ogImage = seoTags.ogImage || defaultSocialImage;
    
    // For station pages, use dynamic OG image with station logo
    if (stationData && stationData.slug) {
      ogImage = `https://${ogDomain}/api/og-image/${stationData.slug}`;
    }
    
    const twitterImage = seoTags.twitterImage || ogImage;
    
    // Get base domain for structured data
    const baseDomain = seoTags.canonical ? new URL(seoTags.canonical).origin : 'https://themegaradio.com';
    
    // Helper to get localized text
    const getLocalizedText = (key: string, fallback: string): string => {
      return translations[key] || fallback;
    };

    // LOCALIZED: WebSite Schema with SearchAction (language-aware URLs)
    const searchPath = language === 'en' ? '/search' : `/${language}/search`;
    const websiteSchema = {
      "@context": "https://schema.org",
      "@type": "WebSite",
      "@id": `${baseDomain}/#website`,
      "name": "Mega Radio",
      "alternateName": "Mega Radio - Free Online Radio",
      "url": baseDomain,
      "inLanguage": language,
      "description": getLocalizedText('faq_seo_intro', 'Mega Radio is your ultimate destination for discovering and streaming live radio stations from around the world.'),
      "potentialAction": {
        "@type": "SearchAction",
        "target": {
          "@type": "EntryPoint",
          "urlTemplate": `${baseDomain}${searchPath}?q={search_term_string}`
        },
        "query-input": "required name=search_term_string"
      }
    };
    
    // LOCALIZED: Organization Schema for Google Knowledge Panel with ALL 57 languages
    const organizationSchema = {
      "@context": "https://schema.org",
      "@type": "Organization",
      "@id": `${baseDomain}/#organization`,
      "name": "Mega Radio",
      "url": baseDomain,
      "logo": {
        "@type": "ImageObject",
        "url": `${baseDomain}/images/logo-icon.webp`,
        "width": 80,
        "height": 80
      },
      "description": getLocalizedText('faq_seo_intro', 'Free online radio platform featuring 60,000+ radio stations from 120+ countries worldwide'),
      "inLanguage": language,
      "contactPoint": {
        "@type": "ContactPoint",
        "contactType": "Customer Service",
        "availableLanguage": SEO_LANGUAGES.filter(lang => lang.enabled).map(lang => lang.name)
      }
    };

    // LOCALIZED: BreadcrumbList with proper translated paths
    // Show breadcrumbs on all pages except homepage (including country homepages)
    let breadcrumbSchema: any = null;
    if (additionalData?.pageType !== 'home') {
      const breadcrumbItems: any[] = [
        {
          "@type": "ListItem",
          "position": 1,
          "name": getLocalizedText('nav_home', 'Home'),
          "item": baseDomain + `/${language}/`
        }
      ];

      // Extract breadcrumb path segments
      const pathSegments = cleanPath.split('/').filter(Boolean);
      let currentPath = '';

      for (let i = 0; i < pathSegments.length; i++) {
        const segment = pathSegments[i];
        currentPath += '/' + segment;

        // Skip if it's a detailed identifier (like station slug)
        if (i === pathSegments.length - 1 && (cleanPath.includes('/station/') || cleanPath.includes('/stations/'))) {
          // Use station name if available, otherwise use segment
          const name = stationData?.name || segment.replace(/-/g, ' ').split(' ').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
          breadcrumbItems.push({
            "@type": "ListItem",
            "position": breadcrumbItems.length + 1,
            "name": name,
            "item": baseDomain + `/${language}` + currentPath
          });
        } else if (segment !== 'stations' && segment !== 'station') {
          // Use translated names for main navigation
          const translationKey = `nav_${segment}`;
          const displayName = getLocalizedText(translationKey, segment.replace(/-/g, ' ').split(' ').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' '));
          breadcrumbItems.push({
            "@type": "ListItem",
            "position": breadcrumbItems.length + 1,
            "name": displayName,
            "item": baseDomain + `/${language}` + currentPath
          });
        }
      }

      // Special handling for stations path - use translated segment
      if (cleanPath.includes('/stations') || cleanPath.includes('/station/')) {
        const idx = breadcrumbItems.findIndex(b => !b.item.includes('/station'));
        if (idx >= 0 && !breadcrumbItems.find(b => b.name.toLowerCase() === getLocalizedText('nav_stations', 'Stations').toLowerCase())) {
          // Determine the correct translated segment for "station"
          let stationSegment = 'stations'; // default English
          if (language !== 'en' && urlTranslations && urlTranslations.size > 0) {
            // Look for translated "station" or "stations" in the map
            const stationKey = `${language}:station`;
            const stationsKey = `${language}:stations`;
            const translated = urlTranslations.get(stationKey) || urlTranslations.get(stationsKey);
            if (translated) {
              stationSegment = translated;
            }
          }
          
          breadcrumbItems.splice(idx + 1, 0, {
            "@type": "ListItem",
            "position": idx + 2,
            "name": getLocalizedText('nav_stations', 'Stations'),
            "item": baseDomain + `/${language}/${stationSegment}`
          });
        }
      }

      breadcrumbItems.forEach((item, idx) => { item.position = idx + 1; });

      breadcrumbSchema = {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": breadcrumbItems
      };
    }

    // FAQPage Schema for homepage and country pages
    // Uses the actual 10 FAQ accordion questions from RadioFAQ.tsx
    // Check pageType instead of cleanPath to include country homepages like /at, /de, etc.
    let faqPageSchema: any = null;
    if (additionalData?.pageType === 'home') {
      faqPageSchema = {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": [
          {
            "@type": "Question",
            "name": getLocalizedText('faq_what_is_radio', 'What is Radio?'),
            "acceptedAnswer": {
              "@type": "Answer",
              "text": getLocalizedText('faq_what_is_radio_answer', 'Radio is a technology that uses electromagnetic waves to transmit audio signals wirelessly. It allows broadcasting of music, news, talk shows, and other content to listeners through AM, FM, and digital frequencies.')
            }
          },
          {
            "@type": "Question",
            "name": getLocalizedText('faq_what_is_internet_radio', 'What is Internet Radio?'),
            "acceptedAnswer": {
              "@type": "Answer",
              "text": getLocalizedText('faq_what_is_internet_radio_answer', 'Internet radio is audio broadcasting transmitted over the internet. Unlike traditional radio, it allows you to listen to stations from anywhere in the world through streaming technology on your computer, smartphone, or smart device.')
            }
          },
          {
            "@type": "Question",
            "name": getLocalizedText('faq_what_is_web_radio', 'What is Web Radio?'),
            "acceptedAnswer": {
              "@type": "Answer",
              "text": getLocalizedText('faq_what_is_web_radio_answer', 'Web radio is another term for internet radio - audio content streamed through websites and web applications. It offers the convenience of listening to live radio directly in your web browser without additional software.')
            }
          },
          {
            "@type": "Question",
            "name": getLocalizedText('faq_how_to_listen', 'How can I listen to Radio?'),
            "acceptedAnswer": {
              "@type": "Answer",
              "text": getLocalizedText('faq_how_to_listen_answer', 'You can listen to radio through traditional FM/AM receivers, car radios, smart speakers, or online through platforms like Mega Radio. Simply visit our website, choose a station, and click play to start streaming instantly.')
            }
          },
          {
            "@type": "Question",
            "name": getLocalizedText('faq_listen_on_phone', 'Can I listen to Radio on my Phone?'),
            "acceptedAnswer": {
              "@type": "Answer",
              "text": getLocalizedText('faq_listen_on_phone_answer', 'Yes! Mega Radio works perfectly on smartphones and tablets. Our mobile-optimized website provides seamless streaming on both iOS and Android devices. Simply open your browser and enjoy free radio anywhere.')
            }
          },
          {
            "@type": "Question",
            "name": getLocalizedText('faq_is_radio_free', 'Is Internet Radio Free?'),
            "acceptedAnswer": {
              "@type": "Answer",
              "text": getLocalizedText('faq_is_radio_free_answer', 'Yes, listening to internet radio on Mega Radio is completely free! We offer access to over 60,000 radio stations worldwide with no subscription fees, no registration required, and no hidden costs.')
            }
          },
          {
            "@type": "Question",
            "name": getLocalizedText('faq_listen_on_pc', 'How can I listen to Radio on my PC?'),
            "acceptedAnswer": {
              "@type": "Answer",
              "text": getLocalizedText('faq_listen_on_pc_answer', 'Listening on your PC is easy! Just visit Mega Radio in any web browser (Chrome, Firefox, Safari, Edge), find a station you like, and click play. No downloads or installations needed.')
            }
          },
          {
            "@type": "Question",
            "name": getLocalizedText('faq_which_stations', 'Which Radio Stations can I listen to?'),
            "acceptedAnswer": {
              "@type": "Answer",
              "text": getLocalizedText('faq_which_stations_answer', 'Mega Radio offers over 60,000 radio stations from 120+ countries. You can explore stations by genre (pop, rock, jazz, classical, news, sports), by country, or by language to find exactly what you want to hear.')
            }
          },
          {
            "@type": "Question",
            "name": getLocalizedText('faq_best_station', 'Which Radio Station is the best?'),
            "acceptedAnswer": {
              "@type": "Answer",
              "text": getLocalizedText('faq_best_station_answer', 'The best station depends on your personal taste! Use our popularity rankings to discover trending stations, or explore by genre to find stations that match your music preferences. Our recommendation system helps you discover new favorites.')
            }
          },
          {
            "@type": "Question",
            "name": getLocalizedText('faq_no_ads_stations', 'Which Radio Stations have no Advertising?'),
            "acceptedAnswer": {
              "@type": "Answer",
              "text": getLocalizedText('faq_no_ads_stations_answer', 'Many stations on Mega Radio are commercial-free, including public broadcasters, community stations, and specialty music channels. Use our filters to explore stations and find those with minimal or no advertising.')
            }
          }
        ]
      };
    }

    // ItemList Schema for popular stations on homepage
    let popularStationsSchema: any = null;
    if (additionalData?.popularStations && additionalData.popularStations.length > 0) {
      const stationItems = additionalData.popularStations.map((station: any, index: number) => {
        const stationUrl = `${baseDomain}${language === 'en' ? '' : '/' + language}/station/${station.slug || station._id}`;
        const stationLogo = station.logoAssets?.webp256 || station.logoAssets?.webp96 || station.favicon || `${baseDomain}/images/default-station.png`;
        
        return {
          "@type": "ListItem",
          "position": index + 1,
          "item": {
            "@type": "RadioStation",
            "@id": stationUrl,
            "name": station.name,
            "url": stationUrl,
            "image": stationLogo,
            ...(station.country && { "areaServed": station.country }),
            "genre": station.tags?.slice(0, 3) || [],
            "isAccessibleForFree": true
          }
        };
      });

      popularStationsSchema = {
        "@context": "https://schema.org",
        "@type": "ItemList",
        "name": getLocalizedText('popular_stations', 'Popular Radio Stations'),
        "description": getLocalizedText('faq_seo_intro', 'Discover the most popular radio stations on Mega Radio'),
        "numberOfItems": stationItems.length,
        "itemListElement": stationItems
      };
    }

    // RadioStation Schema for individual station pages
    let radioStationSchema: any = null;
    if (stationData) {
      const stationUrl = `${baseDomain}${language === 'en' ? '' : '/' + language}/station/${stationData.slug || stationData._id}`;
      const stationLogo = stationData.logoAssets?.webp256 || stationData.logoAssets?.webp96 || stationData.favicon || `${baseDomain}/images/default-station.png`;
      
      radioStationSchema = {
        "@context": "https://schema.org",
        "@type": "RadioStation",
        "@id": stationUrl,
        "name": stationData.name,
        "description": stationData.aiDescription || stationData.description || `Listen to ${stationData.name} live online. Free radio streaming on Mega Radio.`,
        "url": stationUrl,
        "logo": stationLogo,
        "image": stationLogo,
        "sameAs": stationData.homepage || undefined,
        ...(stationData.country && { "areaServed": stationData.country }),
        ...(stationData.language && { "broadcastLanguage": stationData.language }),
        ...(stationData.codec && { "broadcastFormat": stationData.codec }),
        ...(stationData.bitrate && { "additionalProperty": { "@type": "PropertyValue", "name": "bitrate", "value": `${stationData.bitrate} kbps` } }),
        "broadcaster": {
          "@type": "Organization",
          "name": stationData.name,
          ...(stationData.homepage && { "url": stationData.homepage })
        },
        "potentialAction": {
          "@type": "ListenAction",
          "target": {
            "@type": "EntryPoint",
            "urlTemplate": stationUrl,
            "actionPlatform": [
              "http://schema.org/DesktopWebPlatform",
              "http://schema.org/MobileWebPlatform",
              "http://schema.org/IOSPlatform",
              "http://schema.org/AndroidPlatform"
            ]
          }
        },
        "genre": stationData.tags?.slice(0, 5) || [],
        "isAccessibleForFree": true,
        "inLanguage": stationData.language || language
      };
    }
    
    return `
    <title>${seoTags.title}</title>
    <meta name="description" content="${seoTags.description}">
    <meta name="keywords" content="${seoTags.keywords || 'online radio, live radio, free music, radio stations'}">
    <meta name="author" content="MegaRadio">
    
    <!-- Enhanced Open Graph tags -->
    <meta property="og:title" content="${seoTags.ogTitle || seoTags.title}">
    <meta property="og:description" content="${seoTags.ogDescription || seoTags.description}">
    <meta property="og:type" content="${seoTags.ogType || 'website'}">
    <meta property="og:url" content="${seoTags.canonical || ''}">
    <meta property="og:image" content="${ogImage}">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta property="og:site_name" content="MegaRadio">
    <meta property="og:locale" content="${seoTags.ogLocale || 'en_US'}">
    ${(seoTags.ogLocaleAlternates || []).map((locale: string) => `<meta property="og:locale:alternate" content="${locale}">`).join('\n    ')}
    
    <!-- Enhanced Twitter Card tags -->
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${seoTags.twitterTitle || seoTags.title}">
    <meta name="twitter:description" content="${seoTags.twitterDescription || seoTags.description}">
    <meta name="twitter:image" content="${twitterImage}">
    <meta name="twitter:site" content="@MegaRadio">
    <meta name="twitter:creator" content="@MegaRadio">
    
    <!-- Additional meta tags -->
    <meta name="robots" content="${seoTags.robots || 'index, follow'}">
    <meta name="theme-color" content="#000000">
    <meta name="msapplication-TileColor" content="#000000">
    
    ${seoTags.canonical ? `<link rel="canonical" href="${seoTags.canonical}">` : ''}
    ${seoTags.hreflangs ? seoTags.hreflangs.filter((h: any) => h.hreflang === 'x-default').map((h: any) => `<link rel="alternate" hreflang="x-default" href="${h.url}">`).join('') : ''}
    
    <!-- JSON-LD Structured Data for Rich Snippets -->
    <script type="application/ld+json">
    ${JSON.stringify(websiteSchema, null, 2)}
    </script>
    
    <script type="application/ld+json">
    ${JSON.stringify(organizationSchema, null, 2)}
    </script>
    ${breadcrumbSchema ? `
    <script type="application/ld+json">
    ${JSON.stringify(breadcrumbSchema, null, 2)}
    </script>` : ''}
    ${faqPageSchema ? `
    <script type="application/ld+json">
    ${JSON.stringify(faqPageSchema, null, 2)}
    </script>` : ''}
    ${radioStationSchema ? `
    <script type="application/ld+json">
    ${JSON.stringify(radioStationSchema, null, 2)}
    </script>` : ''}
    ${popularStationsSchema ? `
    <script type="application/ld+json">
    ${JSON.stringify(popularStationsSchema, null, 2)}
    </script>` : ''}`;
  }
}