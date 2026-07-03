// Utility functions for generating and handling station slugs
// RESTORED: Simple version without localStorage country detection (working version from 10+ days ago)

import { URL_TRANSLATIONS } from '@workspace/seo-shared/url-translations';

// PageSpeed 2026-07-03: @workspace/seo-shared/slug-utils statically pulls the
// `transliteration` package — 185 KB raw / 58 KB gz that loaded in the home
// page's critical chain (station-card imports this module for getStationUrl).
// generateSlug is only a FALLBACK for the rare station/user without a `slug`
// field (every API station has one), so the transliterator is now loaded
// lazily in the background on first use. Until it arrives, a lightweight
// sanitiser that mirrors slugifyStationName's Latin path handles the
// fallback; non-Latin names get the same 'station-unknown' placeholder
// slugifyStationName itself uses for untransliterable input.
let realSlugify: ((name: string, idFallback?: string) => string) | null = null;
let realSlugifyLoading: Promise<void> | null = null;
function ensureRealSlugify(): void {
  if (realSlugify || realSlugifyLoading) return;
  realSlugifyLoading = import('@workspace/seo-shared/slug-utils')
    .then((m) => {
      realSlugify = m.slugifyStationName;
    })
    .catch(() => {
      realSlugifyLoading = null; // allow retry on next call
    });
}

/** Mirrors slugifyStationName()'s sanitisation for Latin input. */
function fallbackSlugify(name: string): string {
  if (!name || typeof name !== 'string') return 'station-unknown';
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining accents (é → e)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!slug || /^\d+$/.test(slug)) return 'station-unknown';
  return slug;
}

/**
 * Generate a URL slug from a station or user name.
 *
 * Delegates to slugifyStationName() from @workspace/seo-shared (lazily
 * loaded, see above) so that non-Latin scripts (Arabic, Cyrillic, Thai,
 * CJK, Hangul, etc.) are transliterated rather than stripped — the old
 * regex-only path produced empty strings that became numeric-only `-<id>`
 * slugs and got noindex'd.
 */
export function generateSlug(stationName: string): string {
  if (realSlugify) return realSlugify(stationName);
  ensureRealSlugify();
  return fallbackSlugify(stationName);
}

// Get current language from URL path
// CRITICAL: Only reads from URL - never from localStorage
function getCurrentLanguage(): string {
  if (typeof window === 'undefined') return '';
  const path = window.location.pathname;
  // FIXED: Match country code with OR without trailing slash
  const match = path.match(/^\/([a-z]{2})(?:\/|$)/);
  return match ? match[1] : '';
}

export function getStationUrl(station: { _id?: string; slug?: string; name: string }): string {
  const currentLang = getCurrentLanguage();
  const langPrefix = currentLang ? `/${currentLang}` : '';

  // Translate the "station" URL segment for non-English languages so internal
  // links match the canonical URL (e.g. /bg/stantsiya/slug, /tr/istasyon/slug,
  // /ar/mahta/slug). Without this every station card emitted /<lang>/station/<slug>
  // which 301-redirected via url-redirect-middleware — Google saw both URLs,
  // wasted crawl budget, and flagged the source as "Crawled - currently not indexed".
  const stationSegment =
    currentLang && currentLang !== 'en'
      ? (URL_TRANSLATIONS[currentLang]?.station || 'station')
      : 'station';

  const slug = station.slug || generateSlug(station.name);
  return `${langPrefix}/${stationSegment}/${slug}`;
}

// Generate SEO-friendly user profile URLs
export function getUserUrl(user: { _id?: string; slug?: string; fullName?: string; name?: string; email?: string }): string {
  const currentLang = getCurrentLanguage();
  const langPrefix = currentLang ? `/${currentLang}` : '';
  
  // Always prefer slug-based URLs for SEO
  if (user.slug) {
    return `${langPrefix}/users/${user.slug}`;
  }
  
  // Generate slug from user data if no slug exists (fallback)
  const userName = user.fullName || user.name || user.email?.split('@')[0] || 'user';
  const generatedSlug = generateSlug(userName);
  return `${langPrefix}/users/${generatedSlug}`;
}

// Universal function to add country code to any path
// CRITICAL: Only uses country code from CURRENT URL - never from localStorage
//
// 2026-05-12 SEO audit: previously this prepended /<lang> WITHOUT
// translating the URL segments — so callers like
// `getLocalizedPath('/regions/europe/germany')` produced
// `/tr/regions/europe/germany`, which 404s because the per-language route
// expects `/tr/bolgeler/europe/germany`. We now look up each segment in
// URL_TRANSLATIONS for the current language and translate matching keys
// (regions → bolgeler, genres → türler, …). Slugs that aren't translation
// keys (country/region/city slugs, IDs) pass through unchanged.
export function getLocalizedPath(path: string): string {
  // Don't add country code to admin paths
  if (path.startsWith('/admin')) return path;

  const currentLang = getCurrentLanguage();
  if (!currentLang) return path;

  // Guard: if the caller already passed a /<lang>/... prefixed path,
  // don't double-prefix it (e.g. getLocalizedPath('/tr/regions/x') stays
  // /tr/regions/x rather than becoming /tr/tr/regions/x).
  if (path === `/${currentLang}` || path.startsWith(`/${currentLang}/`)) {
    return path;
  }

  // Preserve trailing query/hash if present
  const [pathOnly, ...tail] = path.split(/(?=[?#])/);
  const suffix = tail.join('');

  const translations = URL_TRANSLATIONS[currentLang];
  if (!translations) return `/${currentLang}${pathOnly}${suffix}`;

  const segments = pathOnly.split('/').filter(Boolean);
  const translated = segments.map(seg => {
    // Only translate exact matches against the URL_TRANSLATIONS dictionary
    // for this language. Country / region / station slugs are not in the
    // dictionary, so they pass through unchanged.
    const t = translations[seg];
    return (typeof t === 'string' && t) ? t : seg;
  });

  return `/${currentLang}/${translated.join('/')}${suffix}`;
}

export function navigateToStation(station: { _id?: string; slug?: string; name: string }) {
  const url = getStationUrl(station);
  // Use pushState to navigate without page reload
  window.history.pushState({}, '', url);
  // Trigger a popstate event to notify React Router
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function extractStationIdFromUrl(url: string): string | null {
  // Extract ID from /stations/:id format
  const idMatch = url.match(/\/stations\/([^\/]+)/);
  if (idMatch) {
    return idMatch[1];
  }
  
  return null;
}

export function extractStationSlugFromUrl(url: string): string | null {
  // Extract slug from /station/:slug or any localized /<station-translation>/:slug.
  // Check English path first, then iterate URL_TRANSLATIONS for translated forms.
  const englishMatch = url.match(/\/station\/([^\/]+)/);
  if (englishMatch) return englishMatch[1];

  for (const langTranslations of Object.values(URL_TRANSLATIONS)) {
    const seg = langTranslations.station;
    if (!seg) continue;
    const re = new RegExp(`/${seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/([^/]+)`);
    const m = url.match(re);
    if (m) return m[1];
  }

  return null;
}
