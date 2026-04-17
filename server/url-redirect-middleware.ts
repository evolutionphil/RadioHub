import { Request, Response, NextFunction } from 'express';
import { URL_TRANSLATIONS, normalizeUrlForLanguage, GLOBAL_REVERSE_URL_TRANSLATIONS } from '../shared/url-translations';
import { SEO_LANGUAGES, COUNTRY_TO_LANGUAGE } from '../shared/seo-config';
import { logger } from './utils/logger';
import { performanceCache } from './performance-cache';

/**
 * 301 Redirect Middleware for Translated URL Patterns
 * 
 * Implements permanent redirects from old URL patterns (e.g., /de/station/xyz)
 * to new translated patterns (e.g., /de/sender/xyz) for all 57 languages.
 * 
 * NEW: Also handles cross-language URL normalization:
 * - /de/istasyon/slug → /de/sender/slug (Turkish segment in German URL → German translation)
 * - /fr/station/slug → /fr/station/slug (English segment in French URL → French uses "station")
 * 
 * Uses database translations (performanceCache) first, then fallback to static translations.
 * This preserves SEO equity and prevents 404 errors when URL structure changes.
 */

// Old English path segments that need redirects
const OLD_ENGLISH_PATHS = [
  'station',
  'stations',
  'radios',
  'regions',
  'genres',
  'discover',
  'favorites',
  'trending',
  'about',
  'contact',
  'privacy-policy',
  'terms-and-conditions',
  'feedback',
  'profile',
  'settings',
  'notifications',
  'login',
  'signup',
  'forgot-password',
  'change-password',
  'request-station',
  'recommendations',
  'users',
  'pages',
  'applications',
  'album',
  'artist',
  'song',
  'records'
];

export async function urlRedirectMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const urlPath = req.path;
  
  // Skip static assets, API routes, and special paths
  if (
    urlPath.startsWith('/api/') ||
    urlPath.startsWith('/src/') ||
    urlPath.startsWith('/node_modules/') ||
    urlPath.startsWith('/@') ||
    urlPath.startsWith('/assets/') ||
    urlPath.startsWith('/public/') ||
    urlPath.includes('.') // Skip files with extensions
  ) {
    return next();
  }
  
  // =================================================================
  // CRITICAL: Redirect bare English paths to /en/* format
  // This ensures all languages (including English) use /{lang}/* pattern
  // =================================================================
  const segments = urlPath.split('/').filter(Boolean);
  const firstSegment = segments[0]?.toLowerCase();
  
  // Check if first segment is NOT a valid language code or country code
  const isLanguageCode = SEO_LANGUAGES.some(lang => lang.code === firstSegment);
  const isCountryCode = firstSegment && firstSegment.length === 2 && COUNTRY_TO_LANGUAGE[firstSegment];
  
  const detectLanguageFromRequest = (req: Request): string => {
    const cfCountry = (req.headers['cf-ipcountry'] as string || '').toLowerCase();
    if (cfCountry && cfCountry !== 'xx' && cfCountry !== 't1' && COUNTRY_TO_LANGUAGE[cfCountry]) {
      return COUNTRY_TO_LANGUAGE[cfCountry];
    }
    const cookieHeader = req.headers.cookie || '';
    const prefLangMatch = cookieHeader.match(/preferredLanguage=([a-z]{2,5})/i);
    if (prefLangMatch) {
      const cookieLang = prefLangMatch[1].toLowerCase();
      if (SEO_LANGUAGES.some(lang => lang.code === cookieLang)) return cookieLang;
    }
    const acceptLang = req.headers['accept-language'];
    if (acceptLang) {
      const primaryLang = acceptLang.split(',')[0].split('-')[0].toLowerCase().trim();
      if (SEO_LANGUAGES.some(lang => lang.code === primaryLang)) return primaryLang;
    }
    return 'en';
  };

  // =================================================================
  // BOT-AWARE ROOT REDIRECT
  // For bots: hard-301 to /en (the canonical default English URL) so
  //   crawlers don't waste budget on geo-detected 302s and so canonical
  //   signal is unambiguous.
  // For users: 302 with geo-detection so a German visitor lands on /de.
  // 302 is correct here because the chosen language depends on the
  //   request (geo + cookie + accept-language).
  // =================================================================
  const userAgent = (req.headers['user-agent'] || '').toLowerCase();
  const isMajorBot = /googlebot|bingbot|yandexbot|baiduspider|duckduckbot|applebot/.test(userAgent);

  if (segments.length === 0) {
    if (isMajorBot) {
      logger.log(`🔀 SEO 301: / → /en (bot canonical)`);
      res.redirect(301, '/en');
      return;
    }
    const detectedLang = detectLanguageFromRequest(req);
    logger.log(`🔀 SEO 302: / → /${detectedLang} (geo-detected)`);
    res.redirect(302, `/${detectedLang}`);
    return;
  }

  // =================================================================
  // LOWERCASE NORMALIZATION
  // /En/Radios → /en/radios (single 301). Without this Google may
  // index both casings as duplicate content.
  // =================================================================
  const firstSegRaw = segments[0];
  if (firstSegRaw !== firstSegRaw.toLowerCase()) {
    const lowered = '/' + segments.map((s, i) => i === 0 ? s.toLowerCase() : s).join('/');
    // Preserve raw query (originalUrl is undecoded; req.url may differ in
    // length from req.path for percent-encoded segments).
    const qIdx = req.originalUrl.indexOf('?');
    const queryString = qIdx >= 0 ? req.originalUrl.substring(qIdx) : '';
    logger.log(`🔀 SEO 301: ${urlPath} → ${lowered} (lowercase language code)`);
    res.redirect(301, lowered + queryString);
    return;
  }

  if (!isLanguageCode && !isCountryCode) {
    const knownRoutes = ['radios', 'genres', 'station', 'stations', 'regions', 'discover',
      'favorites', 'trending', 'about', 'contact', 'privacy-policy',
      'terms-and-conditions', 'feedback', 'profile', 'settings', 'notifications',
      'login', 'signup', 'forgot-password', 'change-password', 'request-station',
      'recommendations', 'users', 'pages', 'applications', 'album', 'artist', 'song', 'records', 'tv'];

    if (knownRoutes.includes(firstSegment)) {
      // CRITICAL: 301 destination MUST be deterministic (not geo-dependent).
      // Browsers and CDNs cache 301s permanently — if we send German users to
      // /de/sender and English users to /en/radios for the same /stations URL,
      // the cache poisons cross-user. Worse, Google sees inconsistent canonical
      // signals. So: bare known routes ALWAYS go to /en/{englishTranslation},
      // and the user-facing language switcher handles preferred language
      // afterward (with a cookie). Only the root `/` keeps geo-302 because it
      // has no path content to canonicalize.
      const targetLang = 'en';
      let translatedFirstSeg = firstSegment;
      try {
        // Tight 2s timeout so a stalled cache lookup can't hang the request
        // (would otherwise wait until the 30s gateway timeout and 504).
        const dbTranslations = await Promise.race([
          performanceCache.getUrlTranslations(),
          new Promise<Map<string, string>>((_, reject) =>
            setTimeout(() => reject(new Error('translation-cache-timeout')), 2000)
          ),
        ]);
        translatedFirstSeg = dbTranslations.get(`${targetLang}:${firstSegment}`)
          || URL_TRANSLATIONS[targetLang]?.[firstSegment]
          || firstSegment;
      } catch {
        translatedFirstSeg = URL_TRANSLATIONS[targetLang]?.[firstSegment] || firstSegment;
      }
      const rest = segments.length > 1 ? '/' + segments.slice(1).join('/') : '';
      // Use originalUrl-based query extraction so percent-encoded paths
      // don't corrupt the Location header (req.path is decoded; raw query
      // must be preserved verbatim).
      const qIdx = req.originalUrl.indexOf('?');
      const queryString = qIdx >= 0 ? req.originalUrl.substring(qIdx) : '';
      const newPath = `/${targetLang}/${translatedFirstSeg}${rest}${queryString}`;
      logger.log(`🔀 SEO 301: ${urlPath} → ${newPath} (prefix+translation, deterministic /en target)`);
      res.redirect(301, newPath);
      return;
    }
  }
  
  // Skip very short paths
  if (urlPath.length < 4) {
    return next();
  }
  
  // Continue with translated URL redirect logic
  if (segments.length < 2) {
    return next();
  }
  
  const secondSegment = segments[1];
  
  // NOTE: Country codes (like /at/, /li/) are NOT redirected to language codes
  // They serve content directly using their mapped language (e.g., /at/ uses German content)
  // This allows country-specific URLs to work without redirects
  
  // Reuse language/country check from above
  if (!isLanguageCode && !isCountryCode) {
    return next();
  }
  
  // Get the actual language code for translation lookup
  const languageCode = isLanguageCode ? firstSegment : COUNTRY_TO_LANGUAGE[firstSegment];
  
  // ===============================================================
  // CROSS-LANGUAGE URL NORMALIZATION (DATABASE-AWARE)
  // Handle cases like /de/istasyon/slug → /de/sender/slug
  // When a segment is in the wrong language, redirect to correct translation
  // CRITICAL: Use database translations first (admin overrides), then static
  // ===============================================================
  
  // Check if second segment needs cross-language normalization
  const globalMapping = GLOBAL_REVERSE_URL_TRANSLATIONS.get(secondSegment);
  if (globalMapping) {
    const { english: englishSegment, sourceLanguage } = globalMapping;
    
    // Get correct translation for target language (database first, then static)
    let correctTranslation: string | undefined;
    
    try {
      // PRIORITY 1: Database translations (admin-configured)
      const dbTranslations = await performanceCache.getUrlTranslations();
      const translationKey = `${languageCode}:${englishSegment}`;
      correctTranslation = dbTranslations.get(translationKey);
    } catch (error) {
      // Database not available, fall back to static
    }
    
    // PRIORITY 2: Static file translations
    if (!correctTranslation) {
      correctTranslation = URL_TRANSLATIONS[languageCode]?.[englishSegment] || englishSegment;
    }
    
    // Check if current segment differs from correct translation
    if (secondSegment !== correctTranslation) {
      // Build redirect URL with correct segment
      const remainingSegments = segments.slice(2);
      const newPath = `/${firstSegment}/${correctTranslation}${remainingSegments.length > 0 ? '/' + remainingSegments.join('/') : ''}`;
      const queryString = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
      const redirectUrl = newPath + queryString;
      
      logger.log(`🔀 CROSS-LANG 301: ${urlPath} → ${redirectUrl} (segment language mismatch)`);
      res.redirect(301, redirectUrl);
      return;
    }
  }
  
  // Check if second segment is an old English path that should be redirected
  const isOldEnglishPath = OLD_ENGLISH_PATHS.includes(secondSegment);
  
  if (!isOldEnglishPath) {
    return next();
  }
  
  // Get the translated path - prioritize database translations, fallback to static
  let translatedPath: string | undefined;
  
  try {
    // Try to get from database via performance cache (exact database values)
    const dbTranslations = await performanceCache.getUrlTranslations();
    const translationKey = `${languageCode}:${secondSegment}`;
    translatedPath = dbTranslations.get(translationKey);
  } catch (error) {
    logger.log(`⚠️ Could not fetch database translations, falling back to static: ${error}`);
  }
  
  // Fallback to static translations if database translation not found
  if (!translatedPath) {
    const staticTranslations = URL_TRANSLATIONS[languageCode];
    if (staticTranslations) {
      translatedPath = staticTranslations[secondSegment];
    }
  }
  
  // If no translation exists or it's the same as original, no redirect needed
  if (!translatedPath || translatedPath === secondSegment) {
    return next();
  }
  
  // Build the new URL with translated path (preserving original country/language code)
  const remainingSegments = segments.slice(2); // Everything after the second segment
  const newPath = `/${firstSegment}/${translatedPath}${remainingSegments.length > 0 ? '/' + remainingSegments.join('/') : ''}`;
  
  // Preserve query string
  const queryString = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
  const redirectUrl = newPath + queryString;
  
  // Log the redirect for monitoring
  logger.log(`🔀 SEO 301: ${urlPath} → ${redirectUrl} (translated URL)`);
  
  // Perform 301 permanent redirect
  res.redirect(301, redirectUrl);
}
