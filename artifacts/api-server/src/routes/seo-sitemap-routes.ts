import type { Express, Request } from "express";
import crypto from 'crypto';
import { Station, Country, Genre, AuthToken, AppLog } from '@workspace/db-shared/mongo-schemas';
import { logger } from "../utils/logger";
import { SeoRenderer, buildLocalizedUrl } from "../seo-renderer";
import { SITEMAP_CONFIG, ACTIVE_SITEMAP_LANGUAGES, REQUIRED_STATION_SEO_KEYS, hasCompleteSeoTranslations, SEO_LANGUAGES } from '@workspace/seo-shared/seo-config';

// Map a SEO language code (e.g. "nb") to its BCP47/hreflang tag (e.g. "nb-NO")
// so XML sitemap alternates match the HTML <link rel="alternate"> tags emitted
// by lib/seo-shared/src/seo-config.ts. Without this mapping Google sees a
// HTML/sitemap mismatch and ignores the entire alternate cluster.
function toHreflangTag(code: string): string {
  const lang = SEO_LANGUAGES.find((l) => l.code === code);
  return lang?.iso || code;
}

// Task #349: every <url> entry must carry a self-referential alternate that
// uses the bare SEO code (`it`, `tr`, …) in addition to the BCP47 tag
// (`it-IT`, `tr-TR`). The bare code is what Google's hreflang validator
// surfaces as the canonical "this page targets language X" signal — without
// it the sitemap fails the contract that "every URL must list itself among
// the alternates" for the SEO language code, even if the BCP47 form is
// present. Returns the unique list of hreflang attribute values to emit
// for a single language alternate (preserves order: bare code first, then
// regional/script subtag if it differs).
function hreflangTagsForCode(code: string): string[] {
  const iso = toHreflangTag(code);
  return iso === code ? [code] : [code, iso];
}

// Emit one or two <xhtml:link rel="alternate"> entries for a single
// alternate language, sharing the same href. Centralised so the main /
// genres / stations sitemap handlers stay in lockstep.
function buildHreflangLinks(code: string, href: string): string {
  return hreflangTagsForCode(code)
    .map((tag) => `
    <xhtml:link rel="alternate" hreflang="${tag}" href="${escapeXml(href)}"/>`)
    .join('');
}
import { performanceCache } from "../performance-cache";
import { URL_TRANSLATIONS } from '@workspace/seo-shared/url-translations';
import CacheManager, { CacheKeys } from "../cache";
import { getBaseUrl } from "./shared-utils";
import { loadSitemapTranslations } from "../utils/sitemap-translations";
import { sendSitemapGone } from "../seo/send-sitemap-gone";
import { canonicalizeCountry, countrySlug, getRegionSlugForCountry } from "@workspace/seo-shared/country-regions";
import {
  getCachedQualifiedLanguages,
  getQualifiedLanguagesState,
  QualifiedLanguagesUnavailableError,
} from "../seo/qualified-languages";
import {
  buildAllSitemapManifests,
  getActiveManifest,
  getActiveStationChunk,
  extractTopCountriesFromChunk,
} from "../seo/sitemap-manifest-builder";
import { IndexNowService } from "../services/indexnow";

// Centralized XML escape helper (Architect B P0)
// Escapes the 5 XML predefined entities for safe inclusion in <loc>, <image:loc>,
// <xhtml:link href>, station name fields, etc. Use everywhere instead of ad-hoc replace chains.
// Task #127: extracted to `utils/escape-xml.ts` so the integration test suite can
// import & assert that every <loc> URL is escaped.
import { escapeXml } from '../utils/escape-xml';

/** A4 fix: image:image emit eligibility — only owned/verified hosts.
 * Architect 4 mandate: no arbitrary external favicon URLs. Allowed hosts:
 *   - AWS S3 buckets (anything under amazonaws.com)
 *   - themegaradio.com / *.themegaradio.com
 * Rejects placeholder default-station.* and non-http(s) schemes. */
function isVerifiedImageHost(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  if (!/^https?:\/\//i.test(url)) return false;
  if (/default-station\.(png|webp|jpg|jpeg|svg)$/i.test(url)) return false;
  let parsed: URL;
  try { parsed = new URL(url); } catch { return false; }
  const host = parsed.hostname.toLowerCase();
  return (
    host.endsWith('.amazonaws.com') ||
    host === 'amazonaws.com' ||
    host === 'themegaradio.com' ||
    host.endsWith('.themegaradio.com')
  );
}

/** Pick best image URL for a station — only verified hosts allowed.
 * When `fallbackBaseUrl` is provided AND no verified S3/themegaradio image
 * exists, returns the static fallback `${fallbackBaseUrl}/images/no-image.webp`.
 * This guarantees every station <url> entry can carry an <image:image> child
 * so Google Image Search has *something* to attach (the page itself is still
 * indexed regardless — `image:image` is purely a discovery hint). Without
 * a fallback, stations that haven't run through the S3 backfill yet would
 * have no image entry at all. */
function pickStationImage(station: any, fallbackBaseUrl?: string): string | null {
  const candidates = [
    station?.logoAssets?.webp256,
    station?.logoAssets?.webp96,
    station?.favicon,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && isVerifiedImageHost(candidate.trim())) {
      return candidate.trim();
    }
  }
  if (fallbackBaseUrl) {
    return `${fallbackBaseUrl}/images/no-image.webp`;
  }
  return null;
}

/** Send 503 Service Unavailable when qualified-languages cannot be resolved.
 * Cloudflare/CDN MUST NOT cache this. */
function send503QualifiedLangs(res: any, route: string): void {
  logger.error(`🔴 ${route}: qualified-languages unavailable — returning 503`);
  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Retry-After', '300');
  res.setHeader('Cache-Control', 'no-store');
  res.status(503).send('Sitemap temporarily unavailable — qualified-languages cache cold. Retry in 5 minutes.');
}

/** Format a Date as ISO 8601 (YYYY-MM-DD) for sitemap <lastmod>. Returns empty
 * string if input is not a valid Date — caller should omit <lastmod> entirely
 * (CRITICAL LASTMOD RULE: never use today as fallback). */
function formatLastmod(date?: Date | null): string {
  if (!(date instanceof Date) || isNaN(date.getTime())) return '';
  // W3C Datetime full ISO 8601 with timezone (UTC) — Google/Bing prefer
  // millisecond-precise lastmod when re-crawl decisions matter, and the
  // bare YYYY-MM-DD form was flagged in the SEO audit as too coarse.
  return date.toISOString();
}

/**
 * Architect P1 fix (2026-04-30): emit RFC 7231 `Last-Modified` HTTP header so
 * Yandex/Bing/Google can short-circuit re-fetches via `If-Modified-Since`.
 * No-op when the underlying Date is missing or invalid (we never want a fake
 * "today" lastmod — that's a Google scaled-content spam signal). Caller MUST
 * still emit ETag for non-date-based 304 short-circuits (we keep both).
 */
function setLastModifiedHeader(res: any, date?: Date | null): void {
  if (!(date instanceof Date) || isNaN(date.getTime())) return;
  try {
    res.setHeader('Last-Modified', date.toUTCString());
  } catch { /* best-effort */ }
}

/** 304 Not Modified shortcut for `If-Modified-Since` only. Returns true when
 * response was sent. Use AFTER setLastModifiedHeader has computed the date so
 * the header round-trip is idempotent.
 *
 * RFC 7232 §6 PRECEDENCE GUARD: when client also sent `If-None-Match`, defer
 * to the ETag comparator (`send304IfMatch`) — IMS must NOT short-circuit when
 * INM is present. This is critical because manifest `version` (and ETag)
 * intentionally excludes `maxUpdatedAt` to ignore Mongoose timestamp churn from
 * uptime probes; relying on IMS alone could serve a stale 304 after a station
 * is removed from a chunk (its `maxUpdatedAt` may not bump even though the
 * URL set changed). See replit.md "CRITICAL SITEMAP MANIFEST RULE". */
function send304IfNotModifiedSince(req: any, res: any, date: Date | null | undefined, etag: string, cacheControl: string): boolean {
  if (!(date instanceof Date) || isNaN(date.getTime())) return false;
  // RFC 7232 §6: If-None-Match takes precedence over If-Modified-Since.
  if (req.headers['if-none-match']) return false;
  const ims = req.headers['if-modified-since'];
  if (typeof ims !== 'string') return false;
  const since = Date.parse(ims);
  if (isNaN(since)) return false;
  // Round to second precision (HTTP-Date is second-resolution).
  if (Math.floor(date.getTime() / 1000) <= Math.floor(since / 1000)) {
    res.setHeader('ETag', etag);
    res.setHeader('Last-Modified', date.toUTCString());
    res.setHeader('Cache-Control', cacheControl);
    res.status(304).end();
    return true;
  }
  return false;
}

// Top-countries for sitemap-main-{lang}.xml are computed during the
// SitemapManifest build (see sitemap-manifest-builder.buildMainChunks) and
// baked into the active 'main' manifest's chunks[0].stationIds. The route
// reads them back via extractTopCountriesFromChunk() so:
//   - cache invalidation is deterministic (manifest content-version changes
//     when the country leaderboard shifts → ETag flips automatically),
//   - <lastmod>/Last-Modified bump on station updates within those countries,
//   - admins can force-refresh via POST /api/admin/sitemap/rebuild.

/** Stable ETag = sha256(prefix|hash|version|lastmod). 16-char hex. */
function makeManifestEtag(parts: (string | number | undefined | null)[]): string {
  const joined = parts.map((p) => (p ?? '')).join('|');
  return `"${crypto.createHash('sha256').update(joined).digest('hex').slice(0, 16)}"`;
}

/** 304 Not Modified shortcut. Returns true if response was sent. */
function send304IfMatch(req: any, res: any, etag: string, cacheControl: string): boolean {
  const clientEtag = req.headers['if-none-match'];
  // ETAG FIX (2026-05-08): only accept exact / weak match. The previous
  // `clientEtag.includes(etag)` allowed any header that contained the
  // 16-char hex as a substring to short-circuit, which could trigger
  // false 304s when a longer composite ETag happened to embed the slug.
  if (clientEtag && (clientEtag === etag || clientEtag === `W/${etag}`)) {
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', cacheControl);
    res.status(304).end();
    return true;
  }
  return false;
}

export async function registerSeoSitemapRoutes(app: Express, deps: any, options?: { apiOnly?: boolean }) {
  const { requireAdmin } = deps;
  const seoRenderer = new SeoRenderer();

  // CLIENT-SIDE ERROR LOGGING ENDPOINT
  app.post("/api/stations/report-error", async (req, res) => {
    try {
      const {
        stationId,
        stationName,
        stationUrl,
        errorType,
        errorMessage,
        errorDetails,
        stationMeta,
        browserInfo,
        streamInfo
      } = req.body;

      // Get client info
      const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
      const userAgent = req.headers['user-agent'] || 'unknown';

      const { StationDebugLog } = await import('@workspace/db-shared/mongo-schemas');

      // Create comprehensive error log
      const errorLog = new StationDebugLog({
        stationId: stationId || 'unknown',
        stationName: stationName || 'Unknown Station',
        stationUrl: stationUrl || 'unknown',
        errorType: errorType || 'AUDIO_ERROR',
        errorMessage: errorMessage || 'Unknown error',
        errorDetails: {
          ...errorDetails,
          occurrenceCount: 1,
          audioProperties: errorDetails?.audioProperties || {},
          browserInfo: {
            userAgent,
            platform: browserInfo?.platform || 'unknown',
            language: browserInfo?.language || 'unknown',
            cookieEnabled: browserInfo?.cookieEnabled !== false,
            onLine: browserInfo?.onLine !== false,
            ...browserInfo
          },
          connectionInfo: browserInfo?.connectionInfo || {},
          streamAnalysis: {
            detectedFormat: streamInfo?.detectedFormat || 'unknown',
            contentType: streamInfo?.contentType || 'unknown',
            isHLS: streamInfo?.isHLS || false,
            isPlaylist: streamInfo?.isPlaylist || false,
            ...streamInfo
          }
        },
        stationMeta: stationMeta || {},
        userAgent,
        clientIP,
        timestamp: new Date(),
        isResolved: false,
        reportingUsers: [{
          userAgent,
          clientIP,
          timestamp: new Date()
        }],
        uniqueUserCount: 1,
        totalOccurrences: 1
      });

      // Check if similar error exists for this station in last 24 hours
      const existingError = await StationDebugLog.findOne({
        stationId: stationId || 'unknown',
        errorType: errorType || 'AUDIO_ERROR',
        timestamp: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
      });

      if (existingError) {
        // Update existing error with new occurrence
        const userAlreadyReported = existingError.reportingUsers.some(
          (user: any) => user.userAgent === userAgent && user.clientIP === clientIP
        );

        if (!userAlreadyReported) {
          existingError.reportingUsers.push({
            userAgent,
            clientIP,
            timestamp: new Date()
          });
          existingError.uniqueUserCount = existingError.reportingUsers.length;
        }

        existingError.totalOccurrences += 1;
        existingError.errorDetails = {
          ...existingError.errorDetails,
          occurrenceCount: existingError.totalOccurrences,
          ...errorDetails
        };

        await existingError.save();
        logger.log(`🔄 Updated existing error log for station ${stationName} (${existingError.totalOccurrences} occurrences)`);
        
        res.json({ 
          success: true, 
          message: 'Error updated in existing log',
          errorId: existingError._id,
          totalOccurrences: existingError.totalOccurrences
        });
      } else {
        // Save new error log
        const savedError = await errorLog.save();
        logger.log(`💾 New error logged for station: ${stationName} - ${errorType}: ${errorMessage}`);
        
        res.json({ 
          success: true, 
          message: 'Error logged successfully',
          errorId: savedError._id 
        });
      }

    } catch (error) {
      console.error('Error saving playback error log:', error);
      res.status(500).json({ error: 'Failed to log error' });
    }
  });

  // GET endpoint to retrieve error logs for debugging
  app.get("/api/admin/error-logs", requireAdmin, async (req, res) => {
    try {
      const { StationDebugLog } = await import('@workspace/db-shared/mongo-schemas');
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 50;
      const skip = (page - 1) * limit;
      
      const stationId = req.query.stationId as string;
      const errorType = req.query.errorType as string;
      const resolved = req.query.resolved as string;

      let query: any = {};
      
      if (stationId) query.stationId = stationId;
      if (errorType) query.errorType = errorType;
      if (resolved !== undefined) query.isResolved = resolved === 'true';

      const [errors, total] = await Promise.all([
        StationDebugLog.find(query)
          .sort({ timestamp: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        StationDebugLog.countDocuments(query)
      ]);

      res.json({
        errors,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      });

    } catch (error) {
      console.error('Error fetching error logs:', error);
      res.status(500).json({ error: 'Failed to fetch error logs' });
    }
  });

  // === URL TRANSLATION HELPERS FOR SITEMAP ===
  
  /**
   * Ensures URL translations are loaded from database and merged with static translations
   * Returns forward and reverse Maps for fast lookup
   */
  async function ensureUrlTranslationsLoaded(): Promise<{
    forwardMap: Map<string, string>;
    reverseMap: Map<string, string>;
  }> {
    try {
      logger.log('🗺️ SITEMAP: Loading URL translations...');
      
      // Load database translations using performance cache
      const dbTranslations = await performanceCache.getUrlTranslations();
      logger.log(`🗺️ SITEMAP: Loaded ${dbTranslations.size} database translations`);
      
      // Create forward map: "languageCode:englishPath" -> translatedPath
      const forwardMap = new Map<string, string>(dbTranslations);
      
      // Merge with static translations from URL_TRANSLATIONS
      let staticCount = 0;
      for (const [lang, translations] of Object.entries(URL_TRANSLATIONS)) {
        for (const [english, translated] of Object.entries(translations)) {
          const key = `${lang}:${english}`;
          // Database translations take priority over static translations
          if (!forwardMap.has(key)) {
            forwardMap.set(key, translated);
            staticCount++;
          }
        }
      }
      logger.log(`🗺️ SITEMAP: Merged ${staticCount} static translations, total ${forwardMap.size} translations`);
      
      // Log a few sample translations for debugging
      logger.log('🗺️ SITEMAP: Sample translations:');
      logger.log('  de:stations →', forwardMap.get('de:stations'));
      logger.log('  sq:genres →', forwardMap.get('sq:genres'));
      logger.log('  de:genres →', forwardMap.get('de:genres'));
      
      // Build reverse map: "languageCode:translatedPath" -> englishPath
      const reverseMap = new Map<string, string>();
      for (const [key, translatedPath] of forwardMap.entries()) {
        const [languageCode, englishPath] = key.split(':');
        if (languageCode && englishPath) {
          const reverseKey = `${languageCode}:${translatedPath}`;
          reverseMap.set(reverseKey, englishPath);
        }
      }
      
      logger.log(`🗺️ SITEMAP: Built ${reverseMap.size} reverse translations`);
      return { forwardMap, reverseMap };
    } catch (error) {
      console.error('❌ SITEMAP: Failed to load URL translations:', error);
      // Return empty maps as fallback
      return {
        forwardMap: new Map<string, string>(),
        reverseMap: new Map<string, string>()
      };
    }
  }

  // ==================== Deep Links: iOS Universal Links & Android App Links ====================

  app.get("/.well-known/apple-app-site-association", (req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.json({
      applinks: {
        apps: [],
        details: [
          {
            appID: "M6T85HP76P.com.visiongo.megaradio",
            paths: [
              "/station/*",
              "/*/station/*",
              "/genre/*",
              "/*/genre/*",
              "/user/*",
              "/*/user/*"
            ]
          }
        ]
      }
    });
  });

  app.get("/.well-known/assetlinks.json", (req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.json([
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: "com.visiongo.megaradio",
          sha256_cert_fingerprints: [
            "15:46:3D:5C:AA:67:5D:BE:80:80:09:53:28:E0:9A:24:1F:93:30:CE:D0:8E:96:F2:91:E0:EF:84:2B:FC:D3:CB"
          ]
        }
      }
    ]);
  });

  // SEO ENDPOINTS: Page Data, Sitemap and Robots.txt
  
  // API endpoint for SEO page data with translated canonical URLs
  app.get("/api/seo/page-data", async (req, res) => {
    try {
      const url = req.query.url as string || '/';
      
      // CRITICAL SEO FIX: Always use themegaradio.com as the PRIMARY domain
      const getProductionDomain = (requestHost: string = ''): string => {
        return 'https://themegaradio.com';
      };
      
      const fullDomain = getProductionDomain(req.get('host'));
      
      const seoData = await seoRenderer.renderStaticPage(url, fullDomain);
      res.json(seoData);
    } catch (error) {
      console.error('SEO Page Data error:', error);
      res.status(500).json({ error: 'Failed to fetch SEO page data' });
    }
  });

  // Task #154: admin manual cache-bust / rebuild trigger.
  // Forces a full SitemapManifest rebuild (stations + genres + main). Use after
  // bulk station imports/deletions when you need the published sitemap to
  // refresh before the next 6-hour scheduled refresh — including the top-30
  // country list embedded in /sitemap-main-{lang}.xml.
  app.post("/api/admin/sitemap/rebuild", requireAdmin, async (_req, res) => {
    try {
      const result = await buildAllSitemapManifests({ force: true });
      // Task #201: ping IndexNow with the sitemap index so Google/Bing pick
      // up the freshly-rebuilt sitemap immediately (matches the
      // genre-whitelist admin routes' triggerSearchEnginePush pattern).
      // Fire-and-forget — admins shouldn't wait on an outbound HTTP call,
      // and failures must not fail the rebuild response.
      void (async () => {
        try {
          await IndexNowService.submitSitemaps(undefined, 'sitemap-regen');
        } catch (err: any) {
          logger.error('admin/sitemap/rebuild: IndexNow sitemap ping failed:', err?.message ?? err);
        }
      })();
      res.json({ ok: true, ...result });
    } catch (err: any) {
      logger.error('admin/sitemap/rebuild failed:', err?.message ?? err);
      res.status(500).json({ ok: false, error: err?.message ?? 'rebuild failed' });
    }
  });

  if (options?.apiOnly) {
    return;
  }

  // Task #128: /llms.txt advertises crawl-friendly entry points to AI agents
  // and Google's LLM probes. Must be plain-text — without this route the SPA
  // shell was served as HTML 200, breaking the contract.
  app.get("/llms.txt", (req, res) => {
    const baseUrl = getBaseUrl(req);
    const body = `# MegaRadio
# https://llmstxt.org/
${baseUrl}/

## Sitemaps
${baseUrl}/sitemap-index.xml
${baseUrl}/robots.txt

## Key sections
${baseUrl}/en/stations
${baseUrl}/en/genres
${baseUrl}/en/regions
${baseUrl}/en/about
${baseUrl}/en/faq
${baseUrl}/en/contact
${baseUrl}/en/privacy-policy
${baseUrl}/en/terms-and-conditions
`;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.status(200).send(body);
  });

  // Robots.txt generator
  app.get("/robots.txt", async (req, res) => {
    const baseUrl = getBaseUrl(req);
    // robots.txt rule order (revised 2026-05-08):
    // Strategy: open /api/ broadly so Google's WRS can fetch ANY SSR data
    // endpoint (current OR future) without us having to maintain a whitelist.
    // We only Disallow the few /api/ subtrees that are genuinely sensitive
    // (admin, auth flows, user-scoped data, billing, audio stream proxy,
    // test/sync helpers). Google's "longest match wins" rule means these
    // narrower Disallows correctly override the broad Allow: /api/.
    const robots = `User-agent: *
Allow: /api/
Disallow: /api/admin/
Disallow: /api/auth/
Disallow: /api/user/
Disallow: /api/users/
Disallow: /api/sync/
Disallow: /api/test/
Disallow: /api/payments/
Disallow: /api/iap/
Disallow: /api/push/
Disallow: /api/stream/
Disallow: /api/stream-analysis
Disallow: /api/stream-https-analysis
Disallow: /api/tv/
Disallow: /api/analytics
Disallow: /api/messages/
Disallow: /api/cast/
Disallow: /api/ml/
Disallow: /api/image/
Disallow: /api/internal/
Disallow: /api/cache/
Disallow: /api/logs/
Disallow: /*/admin/
Disallow: /*/admin
Disallow: /*/settings
Disallow: /*/import-export
Disallow: /*/analytics
Disallow: /*/messages
Disallow: /*/profile
Disallow: /search
Disallow: /*/search
Disallow: /*?*q=
Disallow: /*?*utm_
Allow: /

User-agent: Baiduspider
Allow: /api/
Disallow: /api/admin/
Disallow: /api/auth/
Disallow: /api/user/
Disallow: /api/users/
Disallow: /api/sync/
Disallow: /api/test/
Disallow: /api/payments/
Disallow: /api/iap/
Disallow: /api/push/
Disallow: /api/stream/
Disallow: /api/tv/
Disallow: /api/analytics
Disallow: /api/messages/
Disallow: /api/cast/
Disallow: /api/ml/
Disallow: /api/image/
Disallow: /api/internal/
Disallow: /api/cache/
Disallow: /api/logs/
Disallow: /*/admin/
Disallow: /*/admin
Disallow: /*/settings
Disallow: /*/import-export
Disallow: /*/analytics
Disallow: /*/messages
Disallow: /*/profile
Allow: /

User-agent: Sogou
Allow: /api/
Disallow: /api/admin/
Disallow: /api/auth/
Disallow: /api/user/
Disallow: /api/users/
Disallow: /api/sync/
Disallow: /api/test/
Disallow: /api/payments/
Disallow: /api/iap/
Disallow: /api/push/
Disallow: /api/stream/
Disallow: /api/tv/
Disallow: /api/analytics
Disallow: /api/messages/
Disallow: /api/cast/
Disallow: /api/ml/
Disallow: /api/image/
Disallow: /api/internal/
Disallow: /api/cache/
Disallow: /api/logs/
Disallow: /*/admin/
Disallow: /*/admin
Disallow: /*/settings
Disallow: /*/import-export
Disallow: /*/analytics
Disallow: /*/messages
Disallow: /*/profile
Allow: /

User-agent: GPTBot
Disallow: /

User-agent: ChatGPT-User
Disallow: /

User-agent: CCBot
Disallow: /

User-agent: anthropic-ai
Disallow: /

User-agent: Claude-Web
Disallow: /

User-agent: Bytespider
Disallow: /

User-agent: PerplexityBot
Disallow: /

User-agent: Applebot-Extended
Disallow: /

User-agent: cohere-ai
Disallow: /

Sitemap: ${baseUrl}/sitemap-index.xml`;

    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(robots);
  });

  // The qualified-language cache has been hoisted to
  // `server/seo/qualified-languages.ts` so the SSR renderer can consult the
  // same source of truth. Sitemap uses the shared helper below.

  // Language-specific main sitemap route — manifest-driven (refactored 2026-04-30)
  app.get("/sitemap-main-:lang.xml", async (req, res) => {
    const startTime = Date.now();
    const lang = req.params.lang;
    const childCacheControl = `public, max-age=${SITEMAP_CONFIG.childCacheTtlSeconds}, s-maxage=${SITEMAP_CONFIG.childCacheTtlSeconds}, stale-while-revalidate=${SITEMAP_CONFIG.childStaleWhileRevalidateSec}`;

    try {
      let state;
      try { state = await getQualifiedLanguagesState(); }
      catch (err) {
        if (err instanceof QualifiedLanguagesUnavailableError) return send503QualifiedLangs(res, `sitemap-main-${lang}`);
        throw err;
      }
      const qualifiedLanguages = state.languages;
      if (!qualifiedLanguages.includes(lang)) {
        // Manifest-driven 410: lang not qualified -> permanently gone (Bing/Google removal signal)
        return sendSitemapGone(res, SITEMAP_CONFIG.indexCacheTtlSeconds);
      }

      const manifest = await getActiveManifest('main', lang);
      // No manifest yet (cold boot before warm-up complete) -> 503 retry
      if (!manifest) {
        res.setHeader('Content-Type', 'text/plain');
        res.setHeader('Retry-After', '120');
        res.setHeader('Cache-Control', 'no-store');
        return void res.status(503).send('Manifest building — retry shortly');
      }

      // Task #154: top countries are part of the manifest now — reading them
      // from chunks[0].stationIds keeps the country list, the manifest
      // content-version hash, and the ETag in lockstep. No separate cache
      // sig is needed because the manifest version already covers it.
      const topCountries = manifest.chunks.length > 0
        ? extractTopCountriesFromChunk(manifest.chunks[0].stationIds)
        : [];

      const lastmod = formatLastmod(manifest.maxUpdatedAt);
      const etag = makeManifestEtag(['main', lang, state.hash, manifest.version, lastmod]);
      if (send304IfNotModifiedSince(req, res, manifest.maxUpdatedAt as any, etag, childCacheControl)) return;
      if (send304IfMatch(req, res, etag, childCacheControl)) return;

      const cacheKey = `sitemap:main:${lang}:${state.hash}:${manifest.version}`;
      const cached = await CacheManager.get<string>(cacheKey);
      if (cached) {
        res.setHeader('Content-Type', 'application/xml');
        res.setHeader('ETag', etag);
        setLastModifiedHeader(res, manifest.maxUpdatedAt as any);
        res.setHeader('Cache-Control', childCacheControl);
        return void res.send(cached);
      }

      const baseUrl = getBaseUrl(req);
      const { forwardMap: urlTranslations } = await ensureUrlTranslationsLoaded();

      // Static main pages — must mirror MAIN_STATIC_PAGES in
      // sitemap-manifest-builder.ts so urlCount/maxUpdatedAt stay in sync.
      // Task #128: expanded to include FAQ/Contact/Privacy/Terms/Applications
      // so Google has a discovery path to those previously-orphaned pages.
      const mainPages = ['', '/stations', '/genres', '/about', '/regions',
        '/regions/europe', '/regions/asia', '/regions/africa',
        '/regions/north-america', '/regions/south-america', '/regions/oceania',
        '/faq', '/contact', '/privacy-policy', '/terms-and-conditions', '/applications'];

      // topCountries was computed above for ETag/cache-key purposes; reuse it.

      const parts: string[] = [];
      parts.push(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">`);

      // S20 FIX (2026-05-08): emit <lastmod> on main pages too. Without it
      // Google falls back to its own crawl heuristics and recrawls homepage
      // weekly instead of when content actually changes. Use the manifest's
      // maxUpdatedAt — flips when stations/genres/countries shift, which is
      // exactly when home/genres/regions have new content.
      const mainLastmod = manifest.maxUpdatedAt ? formatLastmod(new Date(manifest.maxUpdatedAt as any)) : '';
      for (const page of mainPages) {
        const localizedPath = buildLocalizedUrl(page, lang, undefined, urlTranslations);
        const fullUrl = `${baseUrl}${localizedPath}`;
        const priority = page === '' ? '1.0' : (page === '/stations' || page === '/genres' ? '0.9' : '0.8');
        const changefreq = page === '' || page === '/stations' ? 'daily' : 'weekly';

        parts.push(`
  <url>
    <loc>${escapeXml(fullUrl)}</loc>${mainLastmod ? `
    <lastmod>${mainLastmod}</lastmod>` : ''}
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>`);

        // Self-reference is REQUIRED by Google — the current language must
        // appear in its own xhtml:link list. Iterating qualifiedLanguages
        // already includes `lang`, so no need to dedupe.
        for (const altLang of qualifiedLanguages) {
          const altPath = buildLocalizedUrl(page, altLang, undefined, urlTranslations);
          parts.push(`
${buildHreflangLinks(altLang, baseUrl + altPath).slice(1)}`);
        }
        const enPath = buildLocalizedUrl(page, 'en', undefined, urlTranslations);
        parts.push(`
    <xhtml:link rel="alternate" hreflang="x-default" href="${escapeXml(baseUrl + enPath)}"/>
  </url>`);
      }
      // Top-country region pages (e.g. /<lang>/regions/europe/germany).
      for (const { regionSlug, countrySlug: cSlug } of topCountries) {
        const enginePath = `/regions/${regionSlug}/${cSlug}`;
        const localizedPath = buildLocalizedUrl(enginePath, lang, undefined, urlTranslations);
        const fullUrl = `${baseUrl}${localizedPath}`;
        parts.push(`
  <url>
    <loc>${escapeXml(fullUrl)}</loc>${mainLastmod ? `
    <lastmod>${mainLastmod}</lastmod>` : ''}
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>`);
        for (const altLang of qualifiedLanguages) {
          const altPath = buildLocalizedUrl(enginePath, altLang, undefined, urlTranslations);
          parts.push(`
${buildHreflangLinks(altLang, baseUrl + altPath).slice(1)}`);
        }
        const enPath = buildLocalizedUrl(enginePath, 'en', undefined, urlTranslations);
        parts.push(`
    <xhtml:link rel="alternate" hreflang="x-default" href="${escapeXml(baseUrl + enPath)}"/>
  </url>`);
      }

      parts.push(`
</urlset>`);
      const xml = parts.join('');

      await CacheManager.set(cacheKey, xml, { ttl: SITEMAP_CONFIG.childCacheTtlSeconds });
      res.setHeader('Content-Type', 'application/xml');
      res.setHeader('ETag', etag);
      setLastModifiedHeader(res, manifest.maxUpdatedAt as any);
      res.setHeader('Cache-Control', childCacheControl);
      res.send(xml);

      logger.log(`✅ sitemap-main-${lang}.xml (${mainPages.length + topCountries.length} URLs) ${Date.now() - startTime}ms`);
    } catch (error) {
      logger.error(`❌ Error generating sitemap-main-${lang}.xml:`, error);
      res.status(500).send('Error generating sitemap');
    }
  });

  // Language-specific station sitemap route — manifest-driven (refactored 2026-04-30)
  // Reads station _ids from active SitemapManifest, returns 410 Gone for chunks
  // not present in the manifest (Bing/Google clear-removal signal vs 404 ambiguity).
  app.get("/sitemap-stations-:lang-:chunk.xml", async (req, res) => {
    const startTime = Date.now();
    const lang = req.params.lang;
    // S26 FIX (2026-05-08): strict chunk parsing. `parseInt('abc') || 1`
    // silently coerced any garbage (including `0`, `-5`, `99999`) to chunk 1,
    // returning a 200 OK XML for URLs Google would later flag as duplicate
    // content. Reject anything that isn't a positive integer ≤ 9999 with a
    // 410 Gone so the bad URL drops out of the index cleanly.
    if (!/^[1-9]\d{0,3}$/.test(req.params.chunk)) {
      return sendSitemapGone(res, SITEMAP_CONFIG.indexCacheTtlSeconds);
    }
    const chunk = parseInt(req.params.chunk, 10);
    const childCacheControl = `public, max-age=${SITEMAP_CONFIG.childCacheTtlSeconds}, s-maxage=${SITEMAP_CONFIG.childCacheTtlSeconds}, stale-while-revalidate=${SITEMAP_CONFIG.childStaleWhileRevalidateSec}`;

    try {
      let state;
      try { state = await getQualifiedLanguagesState(); }
      catch (err) {
        if (err instanceof QualifiedLanguagesUnavailableError) return send503QualifiedLangs(res, `sitemap-stations-${lang}-${chunk}`);
        throw err;
      }
      const qualifiedLanguages = state.languages;
      if (!qualifiedLanguages.includes(lang)) {
        return sendSitemapGone(res, SITEMAP_CONFIG.indexCacheTtlSeconds);
      }

      // Manifest lookup — fail early if no active manifest yet (cold boot).
      const chunkInfo = await getActiveStationChunk(lang, chunk);
      if (!chunkInfo) {
        // Distinguish: do we have ANY manifest at all? If yes, this chunk is
        // permanently retired -> 410. If no manifest at all, manifest is still
        // building -> 503.
        const manifest = await getActiveManifest('stations', lang);
        if (manifest) {
          return sendSitemapGone(res, SITEMAP_CONFIG.indexCacheTtlSeconds);
        }
        res.setHeader('Content-Type', 'text/plain');
        res.setHeader('Retry-After', '120');
        res.setHeader('Cache-Control', 'no-store');
        return void res.status(503).send('Manifest building — retry shortly');
      }

      const lastmod = formatLastmod(chunkInfo.maxUpdatedAt);
      const etag = makeManifestEtag(['stations', lang, chunk, state.hash, chunkInfo.version, lastmod]);
      if (send304IfNotModifiedSince(req, res, chunkInfo.maxUpdatedAt as any, etag, childCacheControl)) return;
      if (send304IfMatch(req, res, etag, childCacheControl)) return;

      const cacheKey = `sitemap:stations:${lang}:${chunk}:${state.hash}:${chunkInfo.version}`;
      const cached = await CacheManager.get<string>(cacheKey);
      if (cached) {
        res.setHeader('Content-Type', 'application/xml');
        res.setHeader('ETag', etag);
        setLastModifiedHeader(res, chunkInfo.maxUpdatedAt as any);
        res.setHeader('Cache-Control', childCacheControl);
        return void res.send(cached);
      }

      const baseUrl = getBaseUrl(req);
      const { forwardMap: urlTranslations } = await ensureUrlTranslationsLoaded();
      const { getIndexableLanguagesForStation } = await import('../seo/junk-station-rules');

      // Bulk-fetch the stations from the manifest. Mongo $in is bounded
      // (max 1000 per chunk) so a single round-trip is safe.
      const stationDocs = await Station.find({ _id: { $in: chunkInfo.stationIds } })
        .select('_id slug name url homepage tags bitrate lastCheckOk lastCheckOkTime lastCheckTime country countryCode language languageCodes noIndex updatedAt logoAssets favicon')
        .lean();

      // Re-order by manifest order (Mongo doesn't preserve $in order).
      const byId = new Map<string, any>();
      for (const s of stationDocs) byId.set(String((s as any)._id), s);

      const parts: string[] = [];
      parts.push(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">`);

      let stationCount = 0;
      for (const objId of chunkInfo.stationIds) {
        const station = byId.get(String(objId));
        if (!station || !station.slug) continue; // station deleted between build and serve — skip

        // Defensive double-check: re-run the indexability gate at serve time
        // so a freshly-flagged junk/noIndex station never leaks into XML.
        const indexable = getIndexableLanguagesForStation(station as any, qualifiedLanguages);
        if (!indexable.includes(lang)) continue;

        stationCount++;
        const stationPath = `/station/${station.slug}`;
        const localizedPath = buildLocalizedUrl(stationPath, lang, undefined, urlTranslations);
        const fullUrl = `${baseUrl}${localizedPath}`;
        const stationLastMod = station.updatedAt
          ? formatLastmod(new Date(station.updatedAt))
          : '';

        parts.push(`
  <url>
    <loc>${escapeXml(fullUrl)}</loc>${stationLastMod ? `
    <lastmod>${stationLastMod}</lastmod>` : ''}
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>`);

        // A4: image:image — verified hosts (S3 / themegaradio.com) preferred,
        // otherwise fall back to /images/no-image.webp on our own domain so
        // every station still gets a discoverable image entry.
        const stationImg = pickStationImage(station, baseUrl);
        if (stationImg) {
          const imgTitle = station.name ? `${station.name} logo` : 'Radio station logo';
          const imgCaption = station.name && station.country
            ? `${station.name} — ${station.country} radio station logo`
            : (station.name || 'Radio station logo');
          parts.push(`
    <image:image>
      <image:loc>${escapeXml(stationImg)}</image:loc>
      <image:title>${escapeXml(imgTitle)}</image:title>
      <image:caption>${escapeXml(imgCaption)}</image:caption>
    </image:image>`);
        }

        for (const altLang of indexable) {
          const altPath = buildLocalizedUrl(stationPath, altLang, undefined, urlTranslations);
          parts.push(`
${buildHreflangLinks(altLang, baseUrl + altPath).slice(1)}`);
        }
        const enPath = buildLocalizedUrl(stationPath, 'en', undefined, urlTranslations);
        parts.push(`
    <xhtml:link rel="alternate" hreflang="x-default" href="${escapeXml(baseUrl + enPath)}"/>
  </url>`);
      }
      parts.push(`
</urlset>`);
      const xml = parts.join('');

      await CacheManager.set(cacheKey, xml, { ttl: SITEMAP_CONFIG.childCacheTtlSeconds });
      res.setHeader('Content-Type', 'application/xml');
      res.setHeader('ETag', etag);
      setLastModifiedHeader(res, chunkInfo.maxUpdatedAt as any);
      res.setHeader('Cache-Control', childCacheControl);
      res.send(xml);

      logger.log(`✅ sitemap-stations-${lang}-${chunk}.xml (${stationCount}/${chunkInfo.stationIds.length}) ${Date.now() - startTime}ms`);
    } catch (error) {
      logger.error(`❌ Error generating sitemap-stations-${lang}-${chunk}.xml:`, error);
      res.status(500).send('Error generating sitemap');
    }
  });

  // Language-specific genre sitemap route
  // Genres sitemap — manifest-driven (refactored 2026-04-30)
  app.get("/sitemap-genres-:lang.xml", async (req, res) => {
    const startTime = Date.now();
    const lang = req.params.lang;
    const childCacheControl = `public, max-age=${SITEMAP_CONFIG.childCacheTtlSeconds}, s-maxage=${SITEMAP_CONFIG.childCacheTtlSeconds}, stale-while-revalidate=${SITEMAP_CONFIG.childStaleWhileRevalidateSec}`;

    try {
      let state;
      try { state = await getQualifiedLanguagesState(); }
      catch (err) {
        if (err instanceof QualifiedLanguagesUnavailableError) return send503QualifiedLangs(res, `sitemap-genres-${lang}`);
        throw err;
      }
      const qualifiedLanguages = state.languages;
      if (!qualifiedLanguages.includes(lang)) {
        return sendSitemapGone(res, SITEMAP_CONFIG.indexCacheTtlSeconds);
      }

      const manifest = await getActiveManifest('genres', lang);
      if (!manifest) {
        res.setHeader('Content-Type', 'text/plain');
        res.setHeader('Retry-After', '120');
        res.setHeader('Cache-Control', 'no-store');
        return void res.status(503).send('Manifest building — retry shortly');
      }

      const lastmod = formatLastmod(manifest.maxUpdatedAt);
      const etag = makeManifestEtag(['genres', lang, state.hash, manifest.version, lastmod]);
      if (send304IfNotModifiedSince(req, res, manifest.maxUpdatedAt as any, etag, childCacheControl)) return;
      if (send304IfMatch(req, res, etag, childCacheControl)) return;

      const cacheKey = `sitemap:genres:${lang}:${state.hash}:${manifest.version}`;
      const cached = await CacheManager.get<string>(cacheKey);
      if (cached) {
        res.setHeader('Content-Type', 'application/xml');
        res.setHeader('ETag', etag);
        setLastModifiedHeader(res, manifest.maxUpdatedAt as any);
        res.setHeader('Cache-Control', childCacheControl);
        return void res.send(cached);
      }

      const baseUrl = getBaseUrl(req);
      const { forwardMap: urlTranslations } = await ensureUrlTranslationsLoaded();

      // Manifest stores genre _ids in chunks[0].stationIds (re-using the
      // mongoose array — see sitemap-manifest-builder.buildGenreChunks).
      // NOTE: Genre._id is mixed (ObjectId for new docs, string slugs like
      // 'genre-pop' for legacy seed data). Use the raw native collection to
      // bypass mongoose strict ObjectId casting on the $in array.
      const genreIds = manifest.chunks.flatMap((c) => c.stationIds);
      const genreDocs = genreIds.length > 0
        ? await Genre.collection
            .find({ _id: { $in: genreIds as any[] } }, { projection: { _id: 1, slug: 1, updatedAt: 1 } })
            .toArray()
        : [];
      const genreById = new Map<string, any>();
      for (const g of genreDocs) genreById.set(String((g as any)._id), g);

      const parts: string[] = [];
      parts.push(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">`);

      let genreCount = 0;
      // Task #102: Some legacy Genre.slug values were derived directly from
      // station tag strings and contain XML-unsafe characters (notably `"`),
      // producing malformed <loc> entries like `/en/genres/bassline"/>` that
      // Google indexed as soft-404 thin pages. Restrict slugs to the safe
      // URL/SEO charset (lowercase letters, digits, dash) before emitting.
      // escapeXml(fullUrl) below remains as defense-in-depth.
      const SAFE_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
      for (const objId of genreIds) {
        const genre = genreById.get(String(objId));
        if (!genre || !genre.slug) continue;
        if (!SAFE_SLUG_RE.test(String(genre.slug))) continue;
        genreCount++;
        const genrePath = `/genres/${genre.slug}`;
        const localizedPath = buildLocalizedUrl(genrePath, lang, undefined, urlTranslations);
        const fullUrl = `${baseUrl}${localizedPath}`;
        const genreLastMod = genre.updatedAt ? formatLastmod(new Date(genre.updatedAt)) : '';

        parts.push(`
  <url>
    <loc>${escapeXml(fullUrl)}</loc>${genreLastMod ? `
    <lastmod>${genreLastMod}</lastmod>` : ''}
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>`);

        for (const altLang of qualifiedLanguages) {
          const altPath = buildLocalizedUrl(genrePath, altLang, undefined, urlTranslations);
          parts.push(`
${buildHreflangLinks(altLang, baseUrl + altPath).slice(1)}`);
        }
        const enPath = buildLocalizedUrl(genrePath, 'en', undefined, urlTranslations);
        parts.push(`
    <xhtml:link rel="alternate" hreflang="x-default" href="${escapeXml(baseUrl + enPath)}"/>
  </url>`);
      }
      parts.push(`
</urlset>`);
      const xml = parts.join('');

      await CacheManager.set(cacheKey, xml, { ttl: SITEMAP_CONFIG.childCacheTtlSeconds });
      res.setHeader('Content-Type', 'application/xml');
      res.setHeader('ETag', etag);
      setLastModifiedHeader(res, manifest.maxUpdatedAt as any);
      res.setHeader('Cache-Control', childCacheControl);
      res.send(xml);

      logger.log(`✅ sitemap-genres-${lang}.xml (${genreCount}) ${Date.now() - startTime}ms`);
    } catch (error) {
      logger.error(`❌ Error generating sitemap-genres-${lang}.xml:`, error);
      res.status(500).send('Error generating sitemap');
    }
  });

  // sitemap-main.xml: Redirect to the English language-specific sitemap.
  app.get("/sitemap-main.xml", (req, res) => {
    const baseUrl = getBaseUrl(req);
    res.redirect(301, `${baseUrl}/sitemap-main-en.xml`);
  });

  // 410 Gone for deprecated/removed sitemaps — prevents "soft 404" from SPA catch-all
  app.get("/sitemap-news.xml", (_req, res) => {
    sendSitemapGone(res);
  });
  app.get("/sitemap-videos.xml", (_req, res) => {
    sendSitemapGone(res);
  });
  app.get("/sitemap-images-:i.xml", (_req, res) => {
    sendSitemapGone(res);
  });
  // DALGA 1 W1.2: digit'siz /sitemap-images.xml de SPA fallback yerine 410 dönmeli;
  // aksi halde Google bunu geçerli sitemap sanıp parse hatası / soft-404 raporluyor.
  app.get("/sitemap-images.xml", (_req, res) => {
    sendSitemapGone(res);
  });
  app.get(/^\/sitemap-stations-(\d+)\.xml$/, (_req, res) => {
    sendSitemapGone(res);
  });


  // Sitemap Index — single entry point for Google to discover all sitemaps.
  // References ONLY routes that exist and return valid XML.
  // Architecture:
  //   sitemap-main-{lang}.xml    → main pages per language (home, genres, regions, etc.)
  //   sitemap-genres-{lang}.xml  → genre pages per language
  //   sitemap-stations-{lang}-{chunk}.xml → station pages per language, paginated
  // Sitemap-index — manifest-driven (refactored 2026-04-30)
  // Reads SitemapManifest collection, emits ONLY child sitemaps that have an
  // active manifest with chunkCount > 0. Each <sitemap> entry includes
  // <lastmod> derived from manifest.maxUpdatedAt (omit if missing — never
  // fake today's date per CRITICAL LASTMOD RULE).
  //
  // Cache: 600s (indexCacheTtlSeconds) — short so manifest swaps propagate
  // through Cloudflare within ~10min instead of 24h.
  // Task #128: /sitemap.xml is Google's default probe path. Serve the same
  // sitemap-index XML directly (rather than 301) so the response satisfies
  // GSC's strict "must be a sitemap document" check on the literal URL.
  app.get(["/sitemap-index.xml", "/sitemap.xml"], async (req, res) => {
    const indexCacheControl = `public, max-age=${SITEMAP_CONFIG.indexCacheTtlSeconds}, s-maxage=${SITEMAP_CONFIG.indexCacheTtlSeconds}`;

    try {
      const baseUrl = getBaseUrl(req);

      let state;
      try { state = await getQualifiedLanguagesState(); }
      catch (err) {
        if (err instanceof QualifiedLanguagesUnavailableError) return send503QualifiedLangs(res, 'sitemap-index');
        throw err;
      }
      const qualifiedLanguages = state.languages;

      // Fetch active manifests for all qualified langs, all 3 types.
      const { SitemapManifest } = await import('@workspace/db-shared/mongo-schemas');
      const allActiveManifests = await SitemapManifest.find({
        status: 'active',
        language: { $in: qualifiedLanguages },
        type: { $in: ['main', 'genres', 'stations'] },
      })
        .select('type language version chunks chunkCount totalUrls qualifiedLanguagesHash')
        .lean();

      // If no manifests at all, manifest-builder hasn't run yet (cold boot).
      if (allActiveManifests.length === 0) {
        res.setHeader('Content-Type', 'text/plain');
        res.setHeader('Retry-After', '120');
        res.setHeader('Cache-Control', 'no-store');
        return void res.status(503).send('Sitemap manifest building — retry shortly');
      }

      // ARCHITECT P0 FIX (2026-04-30): atomic swap consistency. The qualified
      // -languages set can change between manifest builds (e.g. a new lang
      // gains 100% translation coverage, hash changes from H1 → H2). During
      // the rolling swap, mixed-hash rows can co-exist. To guarantee the
      // sitemap-index never advertises a stale entry whose child sitemap
      // also drifted on the very same request, pick ONLY rows whose
      // qualifiedLanguagesHash matches the most-recent hash we observe in
      // the manifest set. Prefer the current state.hash if any row carries
      // it, else fall back to the most-common hash (so we don't go empty
      // if state.hash hasn't propagated to any builder yet).
      // Webmaster review (2026-04-30) HIGH-fix: deterministic tie-break.
      // Old code relied on Map insertion order (= Mongo result order) which
      // can differ across replicas → Cloudflare may cache mixed-hash indexes.
      // New ordering when state.hash is unavailable in any active row:
      //   1. count desc       (prefer the bigger cohort)
      //   2. latestGen desc   (newer wins ties — closer to "current" state)
      //   3. hash asc         (lexical fallback — fully deterministic)
      const hashStats = new Map<string, { count: number; latestGen: number }>();
      for (const m of allActiveManifests as any[]) {
        const h = m.qualifiedLanguagesHash || 'unknown';
        const gen = m.generatedAt instanceof Date ? m.generatedAt.getTime() : 0;
        const cur = hashStats.get(h);
        if (cur) {
          cur.count += 1;
          if (gen > cur.latestGen) cur.latestGen = gen;
        } else {
          hashStats.set(h, { count: 1, latestGen: gen });
        }
      }
      let pickedHash: string;
      if (hashStats.has(state.hash)) {
        pickedHash = state.hash;
      } else {
        // Deterministic 3-key sort.
        const sorted = Array.from(hashStats.entries()).sort((a, b) => {
          if (b[1].count !== a[1].count) return b[1].count - a[1].count;
          if (b[1].latestGen !== a[1].latestGen) return b[1].latestGen - a[1].latestGen;
          return a[0].localeCompare(b[0]);
        });
        pickedHash = sorted[0][0];
        logger.warn(`⚠️ sitemap-index: state.hash=${state.hash.slice(0,8)} not in any active manifest; deterministic-fallback hash=${pickedHash.slice(0,8)} (count=${sorted[0][1].count}, rolling-swap drift)`);
      }
      const manifests = allActiveManifests.filter(
        (m: any) => (m.qualifiedLanguagesHash || 'unknown') === pickedHash,
      );

      // Compute ETag from qualified-langs hash + sorted manifest versions.
      const manifestSig = manifests
        .map((m: any) => `${m.type}:${m.language}:${m.version}`)
        .sort()
        .join('|');
      const etag = makeManifestEtag(['index', state.hash, crypto.createHash('sha256').update(manifestSig).digest('hex').slice(0, 16)]);

      // Compute per-(type,lang) max lastmod for the index entries.
      const manifestByKey = new Map<string, any>();
      for (const m of manifests as any[]) {
        const dates = (m.chunks || [])
          .map((c: any) => c.maxUpdatedAt)
          .filter((d: any) => d instanceof Date);
        const maxUpdatedAt = dates.length > 0
          ? new Date(Math.max(...dates.map((d: Date) => d.getTime())))
          : undefined;
        manifestByKey.set(`${m.type}:${m.language}`, { ...m, maxUpdatedAt });
      }

      // Pre-compute index-level Last-Modified so we can offer BOTH
      // If-None-Match (ETag) AND If-Modified-Since 304 short-circuits.
      // Bingbot/Yandex sometimes send only IMS — without this they re-download
      // the full index every poll. (Architect #4 audit, MEDIUM fix.)
      let indexMaxLastmodPrecomputed: Date | null = null;
      for (const m of manifestByKey.values() as any) {
        if (m?.maxUpdatedAt instanceof Date && (!indexMaxLastmodPrecomputed || m.maxUpdatedAt > indexMaxLastmodPrecomputed)) {
          indexMaxLastmodPrecomputed = m.maxUpdatedAt;
        }
        if (Array.isArray(m?.chunks)) {
          for (const chunk of m.chunks) {
            if (chunk?.maxUpdatedAt instanceof Date && (!indexMaxLastmodPrecomputed || chunk.maxUpdatedAt > indexMaxLastmodPrecomputed)) {
              indexMaxLastmodPrecomputed = chunk.maxUpdatedAt;
            }
          }
        }
      }
      if (send304IfMatch(req, res, etag, indexCacheControl)) return;
      if (send304IfNotModifiedSince(req, res, indexMaxLastmodPrecomputed, etag, indexCacheControl)) return;

      const parts: string[] = [];
      parts.push(`<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`);

      const emitEntry = (loc: string, lastmod?: string) => {
        parts.push(`
  <sitemap>
    <loc>${escapeXml(loc)}</loc>${lastmod ? `
    <lastmod>${lastmod}</lastmod>` : ''}
  </sitemap>`);
      };

      // 1. Main sitemaps (one per qualified lang, only if manifest exists)
      for (const lang of qualifiedLanguages) {
        const m = manifestByKey.get(`main:${lang}`);
        if (!m || m.chunkCount === 0) continue;
        emitEntry(`${baseUrl}/sitemap-main-${lang}.xml`, formatLastmod(m.maxUpdatedAt));
      }

      // 2. Genres sitemaps
      for (const lang of qualifiedLanguages) {
        const m = manifestByKey.get(`genres:${lang}`);
        if (!m || m.chunkCount === 0) continue;
        emitEntry(`${baseUrl}/sitemap-genres-${lang}.xml`, formatLastmod(m.maxUpdatedAt));
      }

      // 3. Station sitemaps — emit ONLY existing chunks per language (no
      // global Math.ceil). Sparse languages emit 0-3 chunks instead of 50.
      //
      // Task #344 guard: chunk numbers MUST be 1-based positive integers ≤ 9999
      // because the per-chunk route's `:chunk` regex (`[1-9]\d{0,3}`) responds
      // with 410 Gone for anything outside that range. If a manifest writer
      // ever regresses to 0-based numbering (or stores a negative / 5-digit
      // value), advertising it here would tell Google to fetch a URL that
      // immediately 410s, silently dropping the entire chunk's stations from
      // the index. Skip-and-warn instead so the index stays consistent with
      // what the per-chunk route can actually serve.
      let totalChildSitemaps = 0;
      let indexMaxLastmod: Date | null = null;
      for (const lang of qualifiedLanguages) {
        const m = manifestByKey.get(`stations:${lang}`);
        if (!m || !Array.isArray(m.chunks) || m.chunks.length === 0) continue;
        for (const chunk of m.chunks) {
          if (!chunk || chunk.urlCount === 0) continue;
          if (
            !Number.isInteger(chunk.chunk) ||
            chunk.chunk < 1 ||
            chunk.chunk > 9999
          ) {
            logger.error(
              `🔴 sitemap-index: refusing to advertise station chunk lang=${lang} chunk=${chunk.chunk} ` +
              `(must be 1..9999 to match the per-chunk route regex; would otherwise serve 410 Gone)`,
            );
            continue;
          }
          const chunkLastmod = formatLastmod(chunk.maxUpdatedAt);
          if (chunk.maxUpdatedAt instanceof Date && (!indexMaxLastmod || chunk.maxUpdatedAt > indexMaxLastmod)) {
            indexMaxLastmod = chunk.maxUpdatedAt;
          }
          emitEntry(`${baseUrl}/sitemap-stations-${lang}-${chunk.chunk}.xml`, chunkLastmod);
          totalChildSitemaps++;
        }
      }
      // Sweep main+genres maxUpdatedAt into index Last-Modified.
      for (const m of manifestByKey.values() as any) {
        if (m?.maxUpdatedAt instanceof Date && (!indexMaxLastmod || m.maxUpdatedAt > indexMaxLastmod)) {
          indexMaxLastmod = m.maxUpdatedAt;
        }
      }

      parts.push(`
</sitemapindex>`);
      const xml = parts.join('');

      res.setHeader('Content-Type', 'application/xml');
      res.setHeader('ETag', etag);
      setLastModifiedHeader(res, indexMaxLastmod);
      res.setHeader('Cache-Control', indexCacheControl);
      res.send(xml);

      logger.log(`✅ sitemap-index.xml: ${qualifiedLanguages.length} langs, ${totalChildSitemaps} station chunks, ${manifests.length} total entries`);
    } catch (error) {
      console.error('❌ Error generating sitemap index:', error);
      res.status(500).send('Error generating sitemap index');
    }
  });
}
