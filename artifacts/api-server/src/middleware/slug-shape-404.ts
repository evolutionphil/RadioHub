/**
 * Task #158: Lightweight slug-shape 404 middleware.
 *
 * The SSR catch-all at index-web.ts only renders a proper 404 for *bots*
 * — non-bot visitors hitting junk URLs (e.g. `/regions/regio's/germany`,
 * `/genres/<unknown>`, `/stations/<unknown>`) fall through to the static
 * SPA shell and see a blank loading screen with HTTP 200.
 *
 * This middleware applies *shape* validation (no DB I/O) to the obvious
 * SEO families and returns HTTP 404 + the SPA index.html (the React
 * router renders its own NotFound page client-side) when the slug shape
 * is clearly invalid. Valid URLs continue to fall through unchanged.
 *
 * Hot-path safe: a few precompiled regex tests + one path split per
 * request, no async work, no DB.
 */

import type { Request, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import {
  VALID_CONTINENT_SLUGS,
  SAFE_REGION_SLUG_RE,
  decodeSegmentSafe,
} from '../seo/url-helpers';
import { SEO_LANGUAGES } from '@workspace/seo-shared/seo-config';
import {
  isSlugExistenceReady,
  hasStationSlug,
  hasGenreSlug,
  hasCountrySlug,
  hasCitySlug,
  hasCityDataForCountry,
} from '../seo/slug-existence';

const BOT_RE = /bot|crawl|spider|slurp|baidu|yandex|duckduck|bingpreview|facebookexternalhit|twitterbot|linkedinbot|whatsapp|telegram|googlebot|google-inspectiontool|chrome-lighthouse|pingdom|uptimerobot|gptbot|chatgpt|ccbot|anthropic|bytespider|perplexitybot|cohere/i;

const ASSET_RE = /\.(?:js|css|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|eot|otf|map|json|xml|txt)$/i;

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
];

let indexHtmlCache: string | null | undefined;
function getIndexHtml(): string | null {
  if (indexHtmlCache !== undefined) return indexHtmlCache;
  try {
    const p = path.resolve(import.meta.dirname, '..', 'public', 'index.html');
    indexHtmlCache = fs.readFileSync(p, 'utf-8');
  } catch {
    indexHtmlCache = null;
  }
  return indexHtmlCache;
}

export interface SlugShape404Options {
  /** Translated alternates of the English `regions` segment. */
  regionsAlts: string[];
  /** Translated alternates of the English `genres` segment. */
  genresAlts: string[];
  /**
   * Translated alternates of singular `station` (the slug-bearing form,
   * e.g. `/station/<slug>`, `/de/sender/<slug>`). Used for existence
   * validation against the in-memory station-slug set.
   */
  stationSingularAlts: string[];
  /**
   * Translated alternates of plural `stations`. The SPA accepts both
   * `/stations/<id>` (24-char hex MongoDB ObjectId, resolved via
   * `findById`) and `/stations/<slug>` (resolved via `findOne({slug})`).
   * Existence-checked when the segment is slug-shaped; ObjectId-shaped
   * segments bypass the existence gate and fall through to the SPA so
   * legitimate by-id station URLs keep working.
   */
  stationsPluralAlts: string[];
}

/**
 * 24-char hex MongoDB ObjectId. Used to bypass the slug-existence gate
 * for `/stations/<id>` URLs — IDs aren't tracked in the slug set, so
 * gating on `hasStationSlug(<id>)` would false-404 every legitimate
 * by-id station URL. The SSR / SPA layers resolve these via `findById`.
 */
const OBJECT_ID_RE = /^[0-9a-f]{24}$/i;

function buildExactMatchRe(alts: string[]): RegExp {
  const escaped = alts
    .map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  return new RegExp(`^(?:${escaped})$`, 'iu');
}

export function createSlugShape404Middleware(opts: SlugShape404Options) {
  const regionsRe = buildExactMatchRe(opts.regionsAlts);
  const genresRe = buildExactMatchRe(opts.genresAlts);
  const stationSingularRe = buildExactMatchRe(opts.stationSingularAlts);
  const stationPluralRe = buildExactMatchRe(opts.stationsPluralAlts);

  return function slugShape404Middleware(
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

    // Bots already get a proper 404 from the SSR catch-all upstream;
    // skip them so the SSR layer can emit its richer SEO-tagged 404 body.
    const ua = req.get('user-agent') || '';
    if (BOT_RE.test(ua)) return next();

    let cleanPath: string;
    try {
      cleanPath = decodeURIComponent(rawPath);
    } catch {
      // Malformed percent-encoding → treat as 404 immediately.
      return send404(res);
    }

    // Strip optional 2-letter language prefix (e.g. `/de/...`). If the prefix
    // looks like a language but isn't in the enabled SEO_LANGUAGES set
    // (e.g. `/xx/anything`), 404 immediately instead of falling through to
    // the English default — Google was indexing those bogus prefixes.
    const langMatch = cleanPath.match(/^\/([a-z]{2})(?=\/|$)/i);
    if (langMatch) {
      const candidate = langMatch[1].toLowerCase();
      const known = SEO_LANGUAGES.some((l) => l.code === candidate && l.enabled);
      if (!known) return send404(res);
    }
    const langStripped = cleanPath.replace(/^\/[a-z]{2}(?=\/|$)/i, '');
    const parts = langStripped.split('/').filter(Boolean);
    if (parts.length === 0) return next();

    const family = parts[0].toLowerCase();
    const slug2 = decodeSegmentSafe(parts[1])?.toLowerCase();
    const slug3 = decodeSegmentSafe(parts[2])?.toLowerCase();
    const slug4 = decodeSegmentSafe(parts[3])?.toLowerCase();

    let invalid = false;

    if (regionsRe.test(family)) {
      // /regions[/<continent>[/<country>[/<city>|/stations]]]
      if (slug2 !== undefined) {
        // Continent whitelist applies only to the canonical English form;
        // the localized aliases use translated continent names that aren't
        // in VALID_CONTINENT_SLUGS, so we stick to shape validation there.
        if (family === 'regions' && !VALID_CONTINENT_SLUGS.has(slug2)) {
          invalid = true;
        } else if (!SAFE_REGION_SLUG_RE.test(slug2)) {
          invalid = true;
        } else if (
          slug3 !== undefined &&
          slug3 !== 'stations' &&
          !SAFE_REGION_SLUG_RE.test(slug3)
        ) {
          invalid = true;
        } else if (
          slug4 !== undefined &&
          slug4 !== 'stations' &&
          !SAFE_REGION_SLUG_RE.test(slug4)
        ) {
          invalid = true;
        } else if (
          // Task #269 + Task #364: country/city existence gate — mirror
          // the SSR's `/regions/<continent>/<country>` empty-country
          // promotion to bot-traffic for non-bot visitors too. Applies
          // to every localized alias of `regions` (e.g. `regionen`,
          // `manatiq`) as well as the canonical English form: country
          // and city slugs in URLs are English-style across every
          // language (URL_TRANSLATIONS only translates the family
          // segment, not country/city names — see the example
          // `/de/regionen/europa/germany` in the task brief), so the
          // English-only existence sets in slug-existence.ts apply
          // verbatim. Only the continent slug differs across locales
          // (e.g. `europa` instead of `europe`), which is why the
          // VALID_CONTINENT_SLUGS whitelist above is still gated to
          // `family === 'regions'`.
          slug3 !== undefined &&
          slug3 !== 'stations' &&
          isSlugExistenceReady() &&
          !hasCountrySlug(slug3)
        ) {
          invalid = true;
        } else if (
          slug3 !== undefined &&
          slug3 !== 'stations' &&
          slug4 !== undefined &&
          slug4 !== 'stations' &&
          isSlugExistenceReady() &&
          hasCountrySlug(slug3) &&
          hasCityDataForCountry(slug3) &&
          !hasCitySlug(slug3, slug4)
        ) {
          invalid = true;
        }
      }
    } else if (family === 'country') {
      // /country/<country>[/<city>|/stations]
      if (slug2 !== undefined && !SAFE_REGION_SLUG_RE.test(slug2)) {
        invalid = true;
      } else if (
        slug3 !== undefined &&
        slug3 !== 'stations' &&
        !SAFE_REGION_SLUG_RE.test(slug3)
      ) {
        invalid = true;
      } else if (
        // Task #269: same country/city existence gate as the regions
        // family above (`/country/<country>[/<city>]`).
        slug2 !== undefined &&
        isSlugExistenceReady() &&
        !hasCountrySlug(slug2)
      ) {
        invalid = true;
      } else if (
        slug2 !== undefined &&
        slug3 !== undefined &&
        slug3 !== 'stations' &&
        isSlugExistenceReady() &&
        hasCountrySlug(slug2) &&
        hasCityDataForCountry(slug2) &&
        !hasCitySlug(slug2, slug3)
      ) {
        invalid = true;
      }
    } else if (genresRe.test(family)) {
      // /genres or /genres/<slug>
      if (slug2 !== undefined) {
        if (!SAFE_REGION_SLUG_RE.test(slug2)) {
          invalid = true;
        } else if (
          slug3 === undefined &&
          isSlugExistenceReady() &&
          !hasGenreSlug(slug2)
        ) {
          // Single-slug genre landing page → must match a known genre.
          // Skip when the existence set hasn't loaded yet (start-up
          // grace period) so we don't false-404 during cold start.
          invalid = true;
        }
      }
    } else if (stationSingularRe.test(family) || stationPluralRe.test(family)) {
      // /station/<slug> and /stations/<slug> are both station-detail
      // routes in the SPA (PublicRouter handles either). Validate the
      // slug shape, then — once the existence set is loaded — confirm
      // the slug actually maps to a real station (or one of its
      // aliases). The existence set includes slugAliases so legitimate
      // alias URLs still pass the gate; the SSR layer will 301 those
      // to the canonical slug.
      //
      // Special case for the plural family: the SPA also serves
      // station-detail by 24-char hex MongoDB ObjectId (e.g.
      // `/stations/<id>`, see App.tsx routes). IDs aren't in the slug
      // set, so we must skip the existence gate for ObjectId-shaped
      // segments under the plural family — otherwise every legitimate
      // by-id URL would false-404. Singular `/station/<id>` isn't a
      // documented route, so we leave it gated to keep junk like
      // `/station/<random-32-hex>` 404'ing.
      if (slug2 !== undefined) {
        if (!SAFE_REGION_SLUG_RE.test(slug2)) {
          invalid = true;
        } else if (
          stationPluralRe.test(family) &&
          OBJECT_ID_RE.test(slug2)
        ) {
          // Valid by-id station URL — fall through to the SPA.
        } else if (
          isSlugExistenceReady() &&
          !hasStationSlug(slug2)
        ) {
          invalid = true;
        }
      }
    }

    if (!invalid) return next();
    return send404(res);
  };
}

function send404(res: Response) {
  const html = getIndexHtml();
  if (!html) {
    // No SPA shell available (dev with no build) — fall back to a tiny
    // text body so the status code itself is still correct.
    res.status(404).set({
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, follow',
    }).send('<!DOCTYPE html><title>404 Not Found</title><h1>404 Not Found</h1>');
    return;
  }
  res.status(404).set({
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, follow',
  }).send(html);
}
