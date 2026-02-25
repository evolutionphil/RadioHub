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
  'discover-music',
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
  
  // If path has no language/country prefix, redirect to /en/*
  // Examples: / → /en, /radios → /en/radios, /genres → /en/genres
  if (segments.length === 0) {
    // Root path: / → /en
    logger.log(`🔀 SEO 301: / → /en (English prefix)`);
    res.redirect(301, '/en');
    return;
  }
  
  if (!isLanguageCode && !isCountryCode) {
    // Check if this is a known route segment (not a random path)
    const knownRoutes = ['radios', 'genres', 'station', 'stations', 'regions', 'discover', 
      'discover-music', 'favorites', 'trending', 'about', 'contact', 'privacy-policy',
      'terms-and-conditions', 'feedback', 'profile', 'settings', 'notifications',
      'login', 'signup', 'forgot-password', 'change-password', 'request-station',
      'recommendations', 'users', 'pages', 'applications', 'album', 'artist', 'song', 'records', 'tv'];
    
    if (knownRoutes.includes(firstSegment)) {
      // Redirect to /en/* preserving the rest of the path
      const queryString = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
      const newPath = `/en${urlPath}${queryString}`;
      logger.log(`🔀 SEO 301: ${urlPath} → ${newPath} (English prefix)`);
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
