/**
 * Pre-SSR language-ineligibility redirect middleware.
 *
 * With 57 languages × 43K stations, millions of language variants exist for
 * stations that have no content in those languages. Previously seo-renderer.ts
 * performed a full SSR render (100–300ms) before detecting the ineligibility
 * and issuing a 301 to /en. This middleware fires BEFORE SSR:
 *
 *   1. Parse the URL — must look like /{lang}/{station-segment}/{slug}
 *   2. Universal-14 languages (en, es, fr, de, pt, it, ru, ar, zh, tr, ja, ko,
 *      hi, he) are always eligible → pass through immediately (no DB hit).
 *   3. For all other languages: single lean DB query + cached qualified-languages
 *      check. If the station is ineligible → 301 to /en/{station}/{slug}.
 *
 * The redirect target is always the English canonical, matching what
 * seo-renderer.ts would have issued anyway. SSR handles junk/noindex after
 * this middleware passes.
 */

import type { Request, Response, NextFunction } from 'express';
import { Station } from '@workspace/db-shared/mongo-schemas';
import { SEO_LANGUAGES } from '@workspace/seo-shared/seo-config';
import { reverseTranslateUrl } from '@workspace/seo-shared/url-translations';

// Universal 14 languages: always eligible for every station.
const UNIVERSAL_14 = new Set([
  'en', 'es', 'fr', 'de', 'pt', 'it', 'ru', 'ar', 'zh', 'tr', 'ja', 'ko', 'hi', 'he',
]);

// All enabled language codes, to identify the lang prefix in a URL path.
const ENABLED_LANGS = new Set(
  SEO_LANGUAGES.filter((l) => l.enabled).map((l) => l.code.toLowerCase()),
);

// Station URL segments across all languages (e.g. "station", "istasyon",
// "sender", "stazione" …) — sourced lazily from the in-memory URL translations.
let stationSegments: Set<string> | null = null;

function getStationSegments(): Set<string> {
  if (stationSegments) return stationSegments;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { URL_TRANSLATIONS } = require('@workspace/seo-shared/url-translations') as {
      URL_TRANSLATIONS: Record<string, Record<string, string>>;
    };
    const segs = new Set<string>();
    const stationMap = URL_TRANSLATIONS['station'];
    if (stationMap) {
      for (const seg of Object.values(stationMap)) {
        if (seg) segs.add(seg.toLowerCase());
      }
    }
    // Always include the English fallback
    segs.add('station');
    stationSegments = segs;
  } catch {
    stationSegments = new Set(['station']);
  }
  return stationSegments;
}

// Minimal station projection needed for eligibility check.
const STATION_PROJECTION = {
  slug: 1,
  name: 1,
  url: 1,
  country: 1,
  countryCode: 1,
  language: 1,
  languageCodes: 1,
  tags: 1,
  bitrate: 1,
  lastCheckOk: 1,
  lastCheckOkTime: 1,
  noIndex: 1,
  descriptions: 1,
} as const;

// TTL for per-station eligibility cache: 5 minutes (matches SSR cache).
const STATION_CACHE_TTL_MS = 5 * 60 * 1000;
const stationEligibilityCache = new Map<
  string,
  { eligibleLangs: string[]; expiresAt: number }
>();

export async function langIneligibilityRedirectMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();

  const rawPath = req.path;
  if (!rawPath || rawPath === '/') return next();
  // Never touch static-asset requests (e.g. /xx/something.js) — only HTML routes.
  if (/\.[a-z0-9]{2,5}$/i.test(rawPath)) return next();

  let cleanPath: string;
  try {
    cleanPath = decodeURIComponent(rawPath);
  } catch {
    return next();
  }

  const parts = cleanPath.split('/').filter(Boolean);
  if (parts.length === 0) return next();

  const lang = parts[0].toLowerCase();

  // Only act on known language codes.
  if (!ENABLED_LANGS.has(lang)) return next();

  // Universal-14: always eligible / always indexable — no redirect, no DB hit.
  if (UNIVERSAL_14.has(lang)) return next();

  const segments = getStationSegments();
  const isStationUrl = parts.length === 3 && segments.has(parts[1].toLowerCase());

  // BROWSE-PAGE REDIRECT (2026-06-18): for non-universal languages, every
  // non-station page (homepage, genres, regions, search, about, faq, …) is
  // a self-canonical 200 that is NOT in the sitemap — a duplicate-thin-content
  // surface Google wastes crawl budget on. 301 these to the English
  // equivalent. Station URLs fall through to the per-station eligibility check
  // below (which may legitimately keep some non-universal variants indexable).
  if (!isStationUrl) {
    // Homepage `/{lang}` → `/en`
    if (parts.length === 1) {
      return send301(req, res, '/en');
    }
    // Reverse-translate the localized segments back to English and 301 to /en.
    // Unknown segments (country/genre slugs) pass through unchanged.
    let englishPath: string;
    try {
      englishPath = reverseTranslateUrl('/' + parts.slice(1).join('/'), lang);
    } catch {
      englishPath = '/' + parts.slice(1).join('/');
    }
    if (!englishPath.startsWith('/')) englishPath = '/' + englishPath;
    return send301(req, res, `/en${englishPath}`);
  }

  // Station URL (exactly 3 parts, valid station segment) — check eligibility.
  const segment = parts[1].toLowerCase();
  const slug = parts[2].toLowerCase();
  try {
    const {
      getCachedQualifiedLanguages,
    } = await import('../seo/qualified-languages');
    const {
      isStationIndexableInLanguage,
      isJunkStation,
    } = await import('../seo/junk-station-rules');

    const qualifiedLangs = await getCachedQualifiedLanguages();

    // Check station-level eligibility (use per-slug cache to avoid redundant
    // DB hits when the same station is requested in multiple languages).
    const cacheKey = slug;
    const now = Date.now();
    let cached = stationEligibilityCache.get(cacheKey);
    if (!cached || cached.expiresAt < now) {
      const station = await Station.findOne({ slug }, STATION_PROJECTION).lean();
      if (!station) return next(); // Not found — SSR handles 410
      if (isJunkStation(station) || station.noIndex === true) return next(); // SSR handles 410

      const { getIndexableLanguagesForStation } = await import('../seo/junk-station-rules');
      const eligibleLangs = getIndexableLanguagesForStation(station, qualifiedLangs);
      cached = { eligibleLangs, expiresAt: now + STATION_CACHE_TTL_MS };
      stationEligibilityCache.set(cacheKey, cached);

      // Prevent unbounded cache growth
      if (stationEligibilityCache.size > 10_000) {
        const oldest = stationEligibilityCache.keys().next().value;
        if (oldest) stationEligibilityCache.delete(oldest);
      }
    }

    const isEligible = isStationIndexableInLanguage(
      { slug },
      lang,
      cached.eligibleLangs,
    );

    if (!isEligible) {
      // Redirect to English canonical — same target seo-renderer.ts would use.
      return send301(req, res, `/en/station/${slug}`);
    }
  } catch {
    // On any error (DB down, cache miss), pass through to SSR which handles
    // eligibility gracefully.
  }

  return next();
}

function send301(req: Request, res: Response, target: string): void {
  const qIdx = req.originalUrl.indexOf('?');
  const qs = qIdx >= 0 ? req.originalUrl.substring(qIdx) : '';
  res.set({
    // Short cache so removing a redirect (e.g. a language becomes universal)
    // clears from CDN/browser within minutes.
    'Cache-Control': 'public, max-age=300, s-maxage=300',
    'Location': target + qs,
  });
  res.status(301).end();
}
