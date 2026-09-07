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
 *   3. For all other languages: 301 to the English canonical unconditionally.
 *      These languages are never in the qualified-languages set and never in a
 *      sitemap, so their pages can never be indexable — no DB lookup needed.
 *      Station URLs → /en/station/{slug}; every other page → reverse-translated
 *      /en path.
 *
 * The redirect target is always the English canonical, matching what
 * seo-renderer.ts would have issued anyway. SSR handles junk/noindex (e.g. a
 * junk station resolves to 410 Gone at the /en canonical) after this redirect.
 */

import type { Request, Response, NextFunction } from 'express';
import { SEO_LANGUAGES } from '@workspace/seo-shared/seo-config';
import { reverseTranslateUrl, URL_TRANSLATIONS } from '@workspace/seo-shared/url-translations';

// Universal 14 languages: always eligible for every station.
const UNIVERSAL_14 = new Set([
  'en', 'es', 'fr', 'de', 'pt', 'it', 'ru', 'ar', 'zh', 'tr', 'ja', 'ko', 'hi', 'he',
]);

// All enabled language codes, to identify the lang prefix in a URL path.
const ENABLED_LANGS = new Set(
  SEO_LANGUAGES.filter((l) => l.enabled).map((l) => l.code.toLowerCase()),
);

// URL_TRANSLATIONS is language -> route names, not route -> languages.
// Recognize localized detail routes before generic reverse translation, which
// would otherwise translate a station slug that happens to match a UI word.
const stationSegments = new Set([
  'station',
  ...Object.values(URL_TRANSLATIONS)
    .map(translations => translations.station?.toLowerCase())
    .filter((segment): segment is string => !!segment),
]);

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

  let parts: string[];
  try {
    // Decode each segment separately: an encoded slash belongs to the slug,
    // not to the route structure.
    parts = rawPath.split('/').filter(Boolean).map(decodeURIComponent);
  } catch {
    return next();
  }

  if (parts.length === 0) return next();

  const lang = parts[0].toLowerCase();

  // Only act on known language codes.
  if (!ENABLED_LANGS.has(lang)) return next();

  // Universal-14: always eligible / always indexable — no redirect, no DB hit.
  if (UNIVERSAL_14.has(lang)) return next();

  const isStationUrl = parts.length === 3 && stationSegments.has(parts[1].toLowerCase());

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

  // Station URL (exactly 3 parts, valid station segment).
  //
  // SIMPLIFIED 2026-06-20: non-universal-14 languages are NEVER in the
  // qualified-languages set (`qualifiedLangs ⊆ universal14`) and are never
  // published in any sitemap, so a station page in one of these languages can
  // NEVER be indexable. The previous per-station DB lookup + eligibility check
  // was dead weight: `getIndexableLanguagesForStation(...) ∩ qualifiedLangs`
  // can never contain a non-14 language, so the branch always resolved to
  // "redirect to /en". Redirect unconditionally instead. This:
  //   (a) removes a per-request Atlas lookup on a hot crawl path — that load
  //       fed the GSC "Server error (5xx)" / soft-timeout buckets,
  //   (b) guarantees no /am, /bn, /af, … station page ever renders, and
  //   (c) emits a single clean hop to the English canonical.
  // Junk stations resolve to 410 Gone at the /en canonical, so the "gone"
  // signal is preserved exactly one hop downstream.
  // Preserve the slug as one URL component. Raw Unicode can make Node reject
  // Location, and decoded ?/# must not become query/fragment delimiters.
  const slug = encodeURIComponent(parts[2].toLowerCase());
  return send301(req, res, `/en/station/${slug}`);
}

function send301(req: Request, res: Response, target: string): void {
  const qIdx = req.originalUrl.indexOf('?');
  const qs = qIdx >= 0 ? req.originalUrl.substring(qIdx) : '';
  res.set({
    // Short cache so removing a redirect (e.g. a language becomes universal)
    // clears from CDN/browser within minutes.
    'Cache-Control': 'public, max-age=300, s-maxage=300',
  });
  res.location(target + qs).status(301).end();
}
