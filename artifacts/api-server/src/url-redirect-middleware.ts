import { Request, Response, NextFunction } from 'express';
import { URL_TRANSLATIONS, normalizeUrlForLanguage, GLOBAL_REVERSE_URL_TRANSLATIONS } from '@workspace/seo-shared/url-translations';
import { SEO_LANGUAGES, COUNTRY_TO_LANGUAGE } from '@workspace/seo-shared/seo-config';
import { logger } from './utils/logger';
import { performanceCache } from './performance-cache';

/**
 * 301 Redirect Middleware for Translated URL Patterns (single-hop edition)
 *
 * Implements permanent redirects from old URL patterns (e.g., /de/station/xyz)
 * to new translated patterns (e.g., /de/sender/xyz) for all 57 languages, AND
 * collapses every applicable transformation into ONE 301 so we never produce
 * a redirect chain.
 *
 * Previously every transformation (duplicate-slash, ?lang=xx → prefix,
 * lowercase, bare-known-route prefix, cross-language segment normalization,
 * old-English path → translated path) was an `if {…; res.redirect(301); return}`
 * block. A request like `/AF/STATION/mangoradio/` chained through 3 redirects
 * (trailing-slash strip → lowercase → cross-lang) which Semrush flagged as a
 * "redirect chain". This middleware now computes the final canonical path in
 * memory and emits a single 301.
 *
 * Uses database translations (performanceCache) first, then fallback to static
 * translations. The DB call is cached and protected by a 2s timeout so a stalled
 * cache cannot hang the request.
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
  'records',
];

const KNOWN_BARE_ROUTES = new Set<string>([
  'radios', 'genres', 'station', 'stations', 'regions', 'discover',
  'favorites', 'trending', 'about', 'contact', 'privacy-policy',
  'terms-and-conditions', 'feedback', 'profile', 'settings', 'notifications',
  'login', 'signup', 'forgot-password', 'change-password', 'request-station',
  'recommendations', 'users', 'pages', 'applications', 'album', 'artist',
  'song', 'records', 'tv',
]);

const BOT_UA_RE = /googlebot|bingbot|yandexbot|baiduspider|duckduckbot|applebot/;

function detectLanguageFromRequest(req: Request): string {
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
}

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

  const originalUrl = req.originalUrl;
  const origQIdx = originalUrl.indexOf('?');
  const originalQueryString = origQIdx >= 0 ? originalUrl.substring(origQIdx) : '';

  // Lazy DB translation cache — only fetched when actually needed.
  // 2s race-timeout so a stalled mongo lookup cannot push us into the 30s
  // gateway timeout (would otherwise become a 504).
  let cachedDbTranslations: Map<string, string> | null = null;
  const getDbTranslations = async (): Promise<Map<string, string>> => {
    if (cachedDbTranslations !== null) return cachedDbTranslations;
    try {
      cachedDbTranslations = await Promise.race([
        performanceCache.getUrlTranslations(),
        new Promise<Map<string, string>>((_, reject) =>
          setTimeout(() => reject(new Error('translation-cache-timeout')), 2000),
        ),
      ]);
    } catch {
      cachedDbTranslations = new Map();
    }
    return cachedDbTranslations;
  };

  // ===============================================================
  // SINGLE-PASS CANONICALIZATION
  // Build the final canonical (path, queryString) by applying every
  // applicable transform to in-memory copies. At the end, if anything
  // changed we emit ONE 301 to the final destination.
  // ===============================================================

  // Working copies
  let segments = urlPath.split('/').filter(Boolean);
  let queryString = originalQueryString;

  // ---- Step 1: ?lang=xx → /xx/<path>, strip lang param ----
  // Done before lowercase so we can detect & strip an existing
  // lang/country prefix in any case.
  const langQuery = typeof req.query.lang === 'string' ? req.query.lang.toLowerCase() : '';
  if (langQuery && /^[a-z]{2}$/.test(langQuery) &&
      SEO_LANGUAGES.some(l => l.code === langQuery && l.enabled)) {
    const first = segments[0]?.toLowerCase();
    const isLangPrefix = first && first.length === 2 &&
      (SEO_LANGUAGES.some(l => l.code === first) || COUNTRY_TO_LANGUAGE[first]);
    if (isLangPrefix) segments.shift();
    segments.unshift(langQuery);

    if (origQIdx >= 0) {
      const params = new URLSearchParams(originalUrl.slice(origQIdx + 1));
      params.delete('lang');
      const remaining = params.toString();
      queryString = remaining ? '?' + remaining : '';
    }
  }

  // ---- Step 2: lowercase every segment ----
  // /EN/Stations and /en/Stations both canonicalize to /en/stations.
  // Slug-case mismatches (/tr/istasyon/ABC) are normalized here too.
  for (let i = 0; i < segments.length; i++) {
    const lower = segments[i].toLowerCase();
    if (lower !== segments[i]) segments[i] = lower;
  }

  // ---- Step 3: empty path = root → bot canonical 301 / user geo 302 ----
  if (segments.length === 0) {
    const userAgent = (req.headers['user-agent'] || '').toLowerCase();
    if (BOT_UA_RE.test(userAgent)) {
      logger.log(`🔀 SEO 301: / → /en (bot canonical)`);
      res.redirect(301, '/en');
      return;
    }
    const detectedLang = detectLanguageFromRequest(req);
    logger.log(`🔀 SEO 302: / → /${detectedLang} (geo-detected)`);
    res.redirect(302, `/${detectedLang}`);
    return;
  }

  const firstSegment = segments[0];
  const isLanguageCode = SEO_LANGUAGES.some(lang => lang.code === firstSegment);
  const isCountryCode = firstSegment.length === 2 && !!COUNTRY_TO_LANGUAGE[firstSegment];

  // ---- Step 4: bare known route → /en/{translated}/{rest} ----
  // CRITICAL: 301 destination MUST be deterministic (not geo-dependent).
  // Browsers and CDNs cache 301s permanently; sending German users to
  // /de/sender and English users to /en/radios for the same /stations URL
  // would poison cross-user cache. Bare known routes ALWAYS go to /en/...,
  // and the user-facing language switcher handles preferred language
  // afterward (with a cookie). Only the root `/` keeps geo-302 because it
  // has no path content to canonicalize.
  if (!isLanguageCode && !isCountryCode && KNOWN_BARE_ROUTES.has(firstSegment)) {
    const db = await getDbTranslations();
    const translated = db.get(`en:${firstSegment}`)
      || URL_TRANSLATIONS.en?.[firstSegment]
      || firstSegment;
    segments[0] = translated;
    segments.unshift('en');
    // /en/{englishTranslation}/... is already canonical — no further
    // cross-lang or old-EN-path transformations apply (English URL
    // segments are themselves the canonical English form).
  } else if ((isLanguageCode || isCountryCode) && segments.length >= 2) {
    // ---- Step 5: cross-lang OR old-EN-path normalization on segments[1] ----
    // These two are mutually exclusive (a segment cannot be both a
    // foreign-language URL token AND an unmapped English URL token).
    const lang = isLanguageCode ? firstSegment : COUNTRY_TO_LANGUAGE[firstSegment];
    const secondSegment = segments[1];

    // 5a. Cross-language: /de/istasyon/x → /de/sender/x
    const globalMapping = GLOBAL_REVERSE_URL_TRANSLATIONS.get(secondSegment);
    if (globalMapping) {
      const { english: englishSegment } = globalMapping;
      const db = await getDbTranslations();
      const correctTranslation = db.get(`${lang}:${englishSegment}`)
        || URL_TRANSLATIONS[lang]?.[englishSegment]
        || englishSegment;
      if (secondSegment !== correctTranslation) {
        segments[1] = correctTranslation;
      }
    } else if (OLD_ENGLISH_PATHS.includes(secondSegment)) {
      // 5b. Old English path in a non-English URL: /tr/station/x → /tr/istasyon/x
      const db = await getDbTranslations();
      const translatedPath = db.get(`${lang}:${secondSegment}`)
        || URL_TRANSLATIONS[lang]?.[secondSegment];
      if (translatedPath && translatedPath !== secondSegment) {
        segments[1] = translatedPath;
      }
    }
  }

  // ---- Final: compare and emit ONE 301 if anything changed ----
  const newPath = '/' + segments.join('/');
  if (newPath === urlPath && queryString === originalQueryString) {
    return next();
  }

  const target = newPath + queryString;
  logger.log(`🔀 SEO 301: ${originalUrl} → ${target} (single-hop canonicalization)`);
  res.redirect(301, target);
}
