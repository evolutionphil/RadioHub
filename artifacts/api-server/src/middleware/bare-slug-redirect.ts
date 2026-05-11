/**
 * Bare top-level country/genre slug → 301 redirect to canonical URL.
 *
 * Background: the SPA happily renders URLs like `/en/turkey`, `/tr/turkiye`,
 * `/en/pop`, `/tr/pop` (single segment after the language prefix). The SSR
 * dispatcher in index-web.ts only matches the canonical SEO families
 * (`/regions/...`, `/genres/...`, `/station(s)/...`, etc.), so these bare
 * slugs fall through to a ~9KB SPA shell with a generic title and no
 * canonical tag.
 *
 * Googlebot indexes that shell, sees a duplicate-without-canonical (the same
 * site already serves the rich `/en/regions/europe/turkey` SSR page), and
 * either drops the URL or files it under "Crawled — currently not indexed".
 * Worst case it pollutes the crawl budget with thousands of soft-404-ish
 * shells.
 *
 * Fix: when the path is exactly `/{lang}/{slug}` and `{slug}` is a known
 * country (or genre), emit a 301 to the canonical SEO URL the sitemap
 * already advertises. The SSR layer at the redirect target then sets the
 * proper localized canonical/hreflang, so Googlebot consolidates ranking on
 * the right URL in a single hop.
 */
import type { Request, Response, NextFunction } from 'express';
import { SEO_LANGUAGES } from '@workspace/seo-shared/seo-config';
import {
  COUNTRY_TO_REGION_SLUG,
  countrySlug,
} from '@workspace/seo-shared/country-regions';
import {
  isSlugExistenceReady,
  hasCountrySlug,
  hasGenreSlug,
} from '../seo/slug-existence';

const SAFE_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/i;
const ASSET_RE = /\.(?:js|mjs|css|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|eot|otf|map|json|xml|txt)$/i;

const SKIP_PREFIXES = [
  '/api',
  '/ws',
  '/healthz',
  '/health',
  '/admin',
  '/admin-login',
  '/cast-receiver',
  '/station-images',
  '/station-logos',
  '/assets',
  '/fonts',
  '/images',
  '/sitemap',
  '/robots.txt',
];

const ENABLED_LANG_CODES = new Set(
  SEO_LANGUAGES.filter((l) => l.enabled).map((l) => l.code.toLowerCase()),
);

/**
 * Reserved top-level path segments that must NOT be treated as country/genre
 * slugs even if they happen to collide with one. Includes auth/user routes,
 * static SPA pages, and any segment that already routes to its own SSR
 * handler (regions/genres/station(s) families plus their localized aliases
 * are caught upstream by the SSR isSeoEligiblePage check, so this list only
 * needs to guard the SPA-only paths).
 */
const RESERVED_TOP_LEVEL = new Set([
  'login',
  'signup',
  'logout',
  'profile',
  'settings',
  'admin',
  'admin-login',
  'search',
  'favorites',
  'discover',
  'trending',
  'recommendations',
  'notifications',
  'feedback',
  'request-station',
  'change-password',
  'forgot-password',
  'reset-password',
  'pages',
  'records',
  'users',
  'messages',
  'analytics',
  'import-export',
]);

let countrySlugToRegion: Map<string, string> | null = null;
function getCountrySlugToRegion(): Map<string, string> {
  if (countrySlugToRegion) return countrySlugToRegion;
  const m = new Map<string, string>();
  for (const [name, region] of Object.entries(COUNTRY_TO_REGION_SLUG)) {
    const slug = countrySlug(name);
    if (slug && !m.has(slug)) m.set(slug, region);
  }
  countrySlugToRegion = m;
  return m;
}

export function bareSlugRedirectMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();

  const rawPath = req.path;
  if (!rawPath || rawPath === '/') return next();
  if (ASSET_RE.test(rawPath)) return next();
  for (const p of SKIP_PREFIXES) {
    if (rawPath === p || rawPath.startsWith(p + '/')) return next();
  }

  // Skip until the in-memory slug-existence sets are loaded — without them
  // we cannot tell a real country slug from a typo, and a wrong 301 would
  // create a redirect loop or send Google to a dead URL.
  if (!isSlugExistenceReady()) return next();

  let cleanPath: string;
  try {
    cleanPath = decodeURIComponent(rawPath);
  } catch {
    return next();
  }

  const parts = cleanPath.split('/').filter(Boolean);
  if (parts.length === 0) return next();

  // Two acceptable shapes: `/{lang}/{slug}` (preferred) or `/{slug}` (no
  // explicit language). The latter is rare in practice; we still handle it
  // by defaulting to `en` so legacy inbound links also consolidate.
  let lang: string;
  let slug: string;
  if (parts.length === 2) {
    const maybeLang = parts[0].toLowerCase();
    if (!ENABLED_LANG_CODES.has(maybeLang)) return next();
    lang = maybeLang;
    slug = parts[1].toLowerCase();
  } else if (parts.length === 1) {
    // If the single segment looks like a language code, leave it alone —
    // the SSR layer renders `/{lang}` as the localized homepage.
    if (ENABLED_LANG_CODES.has(parts[0].toLowerCase())) return next();
    lang = 'en';
    slug = parts[0].toLowerCase();
  } else {
    return next();
  }

  if (!SAFE_SLUG_RE.test(slug)) return next();
  if (RESERVED_TOP_LEVEL.has(slug)) return next();

  // Country match takes priority over genre — country pages have the
  // higher SEO value and the slug-existence sets are mutually exclusive
  // in practice (no genre is named after a country).
  if (hasCountrySlug(slug)) {
    const regionSlug = getCountrySlugToRegion().get(slug);
    if (!regionSlug) return next();
    const target = `/${lang}/regions/${regionSlug}/${slug}`;
    return send301(req, res, target);
  }

  if (hasGenreSlug(slug)) {
    const target = `/${lang}/genres/${slug}`;
    return send301(req, res, target);
  }

  return next();
}

function send301(req: Request, res: Response, target: string) {
  const qIdx = req.originalUrl.indexOf('?');
  const queryString = qIdx >= 0 ? req.originalUrl.substring(qIdx) : '';
  const location = target + queryString;
  // Short cache so removing a redirect (e.g. country renamed in the DB)
  // clears from CDN/browser within minutes, not days.
  res.set({
    'Cache-Control': 'public, max-age=300, s-maxage=300',
    'Location': location,
  });
  res.status(301).end();
}
