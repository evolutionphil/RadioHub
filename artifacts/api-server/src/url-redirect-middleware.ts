import { Request, Response, NextFunction } from 'express';
import { URL_TRANSLATIONS, normalizeUrlForLanguage, GLOBAL_REVERSE_URL_TRANSLATIONS } from '@workspace/seo-shared/url-translations';
import { SEO_LANGUAGES, COUNTRY_TO_LANGUAGE } from '@workspace/seo-shared/seo-config';
import { logger } from './utils/logger';
import { performanceCache } from './performance-cache';
import { getCanonicalStationSlug, isSlugExistenceReady } from './seo/slug-existence';

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

// =====================================================================
// STATION-DETAIL CANONICAL ALIAS MAP
// =====================================================================
// Each language has up to 3 URL synonyms for the station-detail segment:
//   • singular  (station: 'stazione')   ← canonical for /lang/X/slug
//   • plural    (stations: 'stazioni')
//   • radios    (radios: 'radio')
// Without normalization Google sees /it/stazione/X, /it/stazioni/X and
// /it/radio/X as three distinct URLs serving the same page (Semrush flags
// these as "duplicate title" entries). We pick the singular form as the
// canonical detail URL and 301 the other two to it.
//
// Only applied to 3-segment paths (/lang/X/slug). 2-segment paths
// (/lang/X — listing pages) stay as-is because the SPA already routes
// /lang/{radios-translated} as the dedicated listing page in some
// languages.
// =====================================================================
const STATION_DETAIL_ALIASES = new Map<string, { canonical: string; aliases: Set<string> }>();
(function buildStationDetailAliases() {
  for (const [lang, tr] of Object.entries(URL_TRANSLATIONS)) {
    const canonical = tr.station;
    if (!canonical) continue;
    const aliases = new Set<string>();
    if (tr.stations && tr.stations !== canonical) aliases.add(tr.stations);
    if (tr.radios && tr.radios !== canonical) aliases.add(tr.radios);
    if (aliases.size > 0) {
      STATION_DETAIL_ALIASES.set(lang, { canonical, aliases });
    }
  }
  // English is not in URL_TRANSLATIONS (it is the source language) but
  // has the same three-way duplicate (/en/station/X, /en/stations/X,
  // /en/radios/X) — hardcode it.
  STATION_DETAIL_ALIASES.set('en', {
    canonical: 'station',
    aliases: new Set(['stations', 'radios']),
  });
})();

// =====================================================================
// STATION-LIST CANONICAL ALIAS MAP
// =====================================================================
// Listing-page counterpart of the detail-page collapse above.
// Same three URL synonyms but at the 2-segment listing level
// (/lang/{seg}, no slug):
//   /az/stansiya, /az/radio   (singular vs radios)
//   /hr/stanica,  /hr/radio
//   /de/sender,   /de/radios
//   /it/stazione, /it/stazioni, /it/radio
//   /en/station,  /en/stations, /en/radios
// Canonical = URL_TRANSLATIONS[lang].radios (or 'radios' for English)
// because the SPA mounts the listing component at the literal /radios
// route (artifacts/megaradio/src/App.tsx ~line 255), and the SPA's
// reverse-translation already maps /lang/{radios-translated} back to
// the /radios route handler.
//
// NOTE: The bare root /lang vs /lang/{radios-translated} duplicate
// (e.g. /hr vs /hr/radio) is NOT addressed here — redirecting the
// language root would break the home page UX. That requires either a
// rel=canonical link from the SPA or a separate strategy.
// =====================================================================
const STATION_LIST_ALIASES = new Map<string, { canonical: string; aliases: Set<string> }>();
(function buildStationListAliases() {
  for (const [lang, tr] of Object.entries(URL_TRANSLATIONS)) {
    const canonical = tr.radios;
    if (!canonical) continue;
    const aliases = new Set<string>();
    if (tr.station && tr.station !== canonical) aliases.add(tr.station);
    if (tr.stations && tr.stations !== canonical) aliases.add(tr.stations);
    if (aliases.size > 0) {
      STATION_LIST_ALIASES.set(lang, { canonical, aliases });
    }
  }
  STATION_LIST_ALIASES.set('en', {
    canonical: 'radios',
    aliases: new Set(['station', 'stations']),
  });
})();

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

    // ---- Step 6: station-detail synonym collapse ----
    // After steps 5a/5b have normalized to the language's translation,
    // some languages still have multiple synonyms for the detail segment
    // (e.g. Italian stazione/stazioni/radio). Collapse to the canonical
    // singular so /it/stazioni/X, /it/radio/X, /it/stations/X all reach
    // /it/stazione/X in this single pass.
    // Only applies to 3+ segment paths (detail pages with a slug).
    if (segments.length >= 3) {
      const aliasInfo = STATION_DETAIL_ALIASES.get(lang);
      if (aliasInfo && aliasInfo.aliases.has(segments[1])) {
        segments[1] = aliasInfo.canonical;
      }
    }

    // ---- Step 7: station-list synonym collapse ----
    // 2-segment listing pages: /it/stazione, /it/stazioni → /it/radio
    // Canonical = URL_TRANSLATIONS[lang].radios because the SPA mounts
    // the listing component at /radios literal route. Bare root /lang
    // is intentionally untouched (home page).
    else if (segments.length === 2) {
      const listInfo = STATION_LIST_ALIASES.get(lang);
      if (listInfo && listInfo.aliases.has(segments[1])) {
        segments[1] = listInfo.canonical;
      }
    }
  }

  // ---- Step 8: slug-alias collapse (folds the SSR slug-alias 301
  //              into this same hop so old-slug URLs no longer chain
  //              middleware-301 → seo-renderer-301). ----
  // Only applies to 3-segment station-detail paths AFTER step 6 has
  // canonicalized segments[1] to the language's "station" form. The
  // alias map is populated by `loadSlugExistence` from the same
  // Station collection scan that powers the slug-shape 404 gate, so
  // there is no extra DB cost on the request path.
  //
  // Architect-fix notes (2026-05-13):
  //   • Language is RECOMPUTED from the post-Step-4 segments[0] so a
  //     bare `/station/<alias>` (which Step 4 just rewrote to
  //     `/en/station/<alias>`) also gets the alias collapse — without
  //     this it stayed a 2-hop chain.
  //   • `getCanonicalStationSlug` returns null when the canonical
  //     target is junk (`isJunkStation()` or `noIndex:true`). For
  //     those aliases we DELIBERATELY do not 301 — the SSR alias
  //     branch will serve 410 Gone for the original URL instead, so
  //     ranking is not consolidated onto a deindexed canonical.
  //   • A short-lived `Cache-Control` header (5 min) is set on this
  //     class of 301 to mirror the SSR alias-301 in `index-web.ts`.
  //     Default browser/CDN heuristic for permanent redirects with no
  //     cache header can pin them indefinitely; if an alias is later
  //     removed or its canonical re-mapped, that pin would route
  //     visitors to the wrong URL until the cache evicts.
  let aliasRedirectApplied = false;
  if (segments.length === 3 && isSlugExistenceReady()) {
    const currentFirst = segments[0];
    const currentIsLanguageCode = SEO_LANGUAGES.some((l) => l.code === currentFirst);
    const currentIsCountryCode =
      currentFirst.length === 2 && !!COUNTRY_TO_LANGUAGE[currentFirst];
    const lang = currentIsLanguageCode
      ? currentFirst
      : (currentIsCountryCode ? COUNTRY_TO_LANGUAGE[currentFirst] : null);
    if (lang) {
      const canonicalDetailSeg =
        STATION_DETAIL_ALIASES.get(lang)?.canonical
        || URL_TRANSLATIONS[lang]?.station
        || (lang === 'en' ? 'station' : null);
      if (canonicalDetailSeg && segments[1] === canonicalDetailSeg) {
        const canonicalSlug = getCanonicalStationSlug(segments[2]);
        if (canonicalSlug) {
          segments[2] = canonicalSlug;
          aliasRedirectApplied = true;
        }
      }
    }
  }

  // ---- Final: compare and emit ONE 301 if anything changed ----
  const newPath = '/' + segments.join('/');
  if (newPath === urlPath && queryString === originalQueryString) {
    return next();
  }

  const target = newPath + queryString;
  if (aliasRedirectApplied) {
    res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
  }
  logger.log(`🔀 SEO 301: ${originalUrl} → ${target} (single-hop canonicalization${aliasRedirectApplied ? ' + slug-alias' : ''})`);
  res.redirect(301, target);
}
