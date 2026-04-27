import type { Express, Request } from "express";
import crypto from 'crypto';
import { Station, Country, Genre, AuthToken, AppLog } from "../../shared/mongo-schemas";
import { logger } from "../utils/logger";
import { SeoRenderer, buildLocalizedUrl } from "../seo-renderer";
import { SITEMAP_CONFIG, ACTIVE_SITEMAP_LANGUAGES, REQUIRED_STATION_SEO_KEYS, hasCompleteSeoTranslations } from "@shared/seo-config";
import { performanceCache } from "../performance-cache";
import { URL_TRANSLATIONS } from "@shared/url-translations";
import CacheManager, { CacheKeys } from "../cache";
import { getBaseUrl } from "./shared-utils";
import { loadSitemapTranslations } from "../utils/sitemap-translations";
import { getCachedQualifiedLanguages } from "../seo/qualified-languages";

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

      const { StationDebugLog } = await import('../../shared/mongo-schemas');

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
      const { StationDebugLog } = await import('../../shared/mongo-schemas');
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

  if (options?.apiOnly) {
    return;
  }

  // Robots.txt generator
  app.get("/robots.txt", async (req, res) => {
    const baseUrl = getBaseUrl(req);
    const robots = `User-agent: *
Allow: /
Allow: /api/station/
Allow: /api/stations/
Allow: /api/genres
Allow: /api/translations
Allow: /api/location
Allow: /api/advertisements
Allow: /api/og-image
Disallow: /api/
Disallow: /*/admin/
Disallow: /*/admin
Disallow: /*/settings
Disallow: /*/import-export
Disallow: /*/analytics
Disallow: /*/search*
Disallow: /*/messages
Disallow: /*/profile

User-agent: Baiduspider
Crawl-delay: 10

User-agent: Sogou
Crawl-delay: 30

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

  // Language-specific main sitemap route
  app.get("/sitemap-main-:lang.xml", async (req, res) => {
    const startTime = Date.now();
    const lang = req.params.lang;
    
    try {
      // Validate language is qualified (Phase 1 + complete SEO translations).
      // Languages without REQUIRED_HOMEPAGE/STATION SEO keys are dropped from
      // the sitemap until translations land — this is the gate that prevents
      // bare /sl, /da etc. from being indexed (task #17).
      const qualifiedLanguages = await getCachedQualifiedLanguages();
      if (!qualifiedLanguages.includes(lang)) {
        return res.status(404).send('Language not found');
      }

      const today = new Date().toISOString().split('T')[0];
      const etag = `"${crypto.createHash('md5').update(`main-${lang}-${today}`).digest('hex')}"`;
      
      const clientEtag = req.headers['if-none-match'];
      if (clientEtag && (clientEtag === etag || clientEtag === `W/${etag}` || clientEtag.includes(etag))) {
        res.setHeader('ETag', etag);
        res.setHeader('Cache-Control', `public, max-age=${SITEMAP_CONFIG.cacheTtlSeconds}`);
        return res.status(304).end();
      }

      const cacheKey = `sitemap:main:${lang}`;
      const cached = await CacheManager.get<string>(cacheKey);
      
      if (cached) {
        logger.log(`⚡ Sitemap cache HIT: ${cacheKey}`);
        res.setHeader('Content-Type', 'application/xml');
        res.setHeader('ETag', etag);
        res.setHeader('Cache-Control', `public, max-age=${SITEMAP_CONFIG.cacheTtlSeconds}`);
        return res.send(cached);
      }

      const baseUrl = getBaseUrl(req);

      // Load URL translations
      const { forwardMap: urlTranslations } = await ensureUrlTranslationsLoaded();

      let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">`;

      // NOTE: '/countries' is not a real route — use '/regions' instead. Keeping /countries here
      // creates soft-404 entries in Google Search Console.
      const mainPages = ['', '/stations', '/genres', '/about', '/regions',
        '/regions/europe', '/regions/asia', '/regions/africa',
        '/regions/north-america', '/regions/south-america', '/regions/oceania'];

      for (const page of mainPages) {
        const localizedPath = buildLocalizedUrl(page, lang, undefined, urlTranslations);
        const fullUrl = `${baseUrl}${localizedPath}`;
        const priority = page === '' ? '1.0' : (page === '/stations' || page === '/genres' ? '0.9' : '0.8');
        const changefreq = page === '' || page === '/stations' ? 'daily' : 'weekly';

        xml += `
  <url>
    <loc>${fullUrl}</loc>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>`;

        // Add hreflang tags only for languages with complete SEO translations
        // (task #17 — never advertise thin /sl, /da, etc. as alternates).
        for (const altLang of qualifiedLanguages) {
          const altLocalizedPath = buildLocalizedUrl(page, altLang, undefined, urlTranslations);
          const altFullUrl = `${baseUrl}${altLocalizedPath}`;
          xml += `
    <xhtml:link rel="alternate" hreflang="${altLang}" href="${altFullUrl}"/>`;
        }

        // x-default points to English version
        const enLocalizedPath = buildLocalizedUrl(page, 'en', undefined, urlTranslations);
        xml += `
    <xhtml:link rel="alternate" hreflang="x-default" href="${baseUrl}${enLocalizedPath}"/>`;

        xml += `
  </url>`;
      }

      xml += `
</urlset>`;

      // Cache for 24 hours
      await CacheManager.set(cacheKey, xml, { ttl: SITEMAP_CONFIG.cacheTtlSeconds });

      // Set caching headers
      res.setHeader('Content-Type', 'application/xml');
      res.setHeader('ETag', etag);
      res.setHeader('Cache-Control', `public, max-age=${SITEMAP_CONFIG.cacheTtlSeconds}`);
      res.send(xml);

      const duration = Date.now() - startTime;
      logger.log(`✅ Generated sitemap-main-${lang}.xml in ${duration}ms`);

    } catch (error) {
      logger.error(`❌ Error generating sitemap-main-${lang}.xml:`, error);
      res.status(500).send('Error generating sitemap');
    }
  });

  // Language-specific station sitemap route with chunking
  app.get("/sitemap-stations-:lang-:chunk.xml", async (req, res) => {
    const startTime = Date.now();
    const lang = req.params.lang;
    const chunk = parseInt(req.params.chunk) || 1;
    
    try {
      // Gate by qualified languages (task #17).
      const qualifiedLanguages = await getCachedQualifiedLanguages();
      if (!qualifiedLanguages.includes(lang)) {
        return res.status(404).send('Language not found');
      }

      const today = new Date().toISOString().split('T')[0];
      const etag = `"${crypto.createHash('md5').update(`stations-${lang}-${chunk}-${today}`).digest('hex')}"`;
      
      const clientEtag = req.headers['if-none-match'];
      if (clientEtag && (clientEtag === etag || clientEtag === `W/${etag}` || clientEtag.includes(etag))) {
        res.setHeader('ETag', etag);
        res.setHeader('Cache-Control', `public, max-age=${SITEMAP_CONFIG.cacheTtlSeconds}`);
        return res.status(304).end();
      }

      const cacheKey = `sitemap:stations:${lang}:${chunk}`;
      const cached = await CacheManager.get<string>(cacheKey);
      
      if (cached) {
        logger.log(`⚡ Sitemap cache HIT: ${cacheKey}`);
        res.setHeader('Content-Type', 'application/xml');
        res.setHeader('ETag', etag);
        res.setHeader('Cache-Control', `public, max-age=${SITEMAP_CONFIG.cacheTtlSeconds}`);
        return res.send(cached);
      }

      const baseUrl = getBaseUrl(req);
      const stationsPerChunk = SITEMAP_CONFIG.stationsPerChunk;
      const skip = (chunk - 1) * stationsPerChunk;

      // Load URL translations
      const { forwardMap: urlTranslations } = await ensureUrlTranslationsLoaded();

      // Unified indexability gate — sitemap, SSR robots, and hreflang must
      // all agree on which (station × language) pairs are indexable. See
      // `server/seo/junk-station-rules.ts` for the gate; `qualifiedLanguages`
      // comes from the shared `server/seo/qualified-languages.ts` cache.
      const { getIndexableLanguagesForStation } = await import('../seo/junk-station-rules');

      // Stream stations via cursor — bounded memory regardless of chunk size.
      // Exclude stations explicitly marked noIndex (junk migration sets this)
      // and pull the extra fields needed for junk + eligibility evaluation.
      const stationCursor = Station.find({
        slug: { $exists: true, $ne: '' },
        $or: [{ noIndex: { $exists: false } }, { noIndex: { $ne: true } }],
      })
        .select('slug name url country countryCode language languageCodes bitrate _id updatedAt')
        .sort({ votes: -1 })
        .skip(skip)
        .limit(stationsPerChunk)
        .lean()
        .cursor({ batchSize: 200 });

      // Build XML using array buffer (avoids string-concat quadratic allocation)
      const parts: string[] = [];
      parts.push(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">`);

      let stationCount = 0;
      for await (const station of stationCursor as any) {
        // Unified gate: intersection of (eligible per country/language) AND
        // (qualified UI translations) AND (not junk / not noIndex). Returns
        // `[]` for junk/noIndex stations so they are silently skipped.
        const indexable = getIndexableLanguagesForStation(station, qualifiedLanguages);
        if (!indexable.includes(lang)) continue;

        stationCount++;
        // Build localized station URL for this language
        const stationPath = `/station/${station.slug}`;
        const localizedPath = buildLocalizedUrl(stationPath, lang, undefined, urlTranslations);
        const fullUrl = `${baseUrl}${localizedPath}`;
        const stationLastMod = station.updatedAt
          ? new Date(station.updatedAt).toISOString().split('T')[0]
          : undefined;

        parts.push(`
  <url>
    <loc>${fullUrl}</loc>${stationLastMod ? `
    <lastmod>${stationLastMod}</lastmod>` : ''}
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>`);

        // Hreflang alternates come from the same unified gate — guarantees
        // sitemap + SSR advertise the exact same alternate set.
        for (const altLang of indexable) {
          const altLocalizedPath = buildLocalizedUrl(stationPath, altLang, undefined, urlTranslations);
          parts.push(`
    <xhtml:link rel="alternate" hreflang="${altLang}" href="${baseUrl}${altLocalizedPath}"/>`);
        }

        // x-default points to English version (always eligible)
        const enLocalizedPath = buildLocalizedUrl(stationPath, 'en', undefined, urlTranslations);
        parts.push(`
    <xhtml:link rel="alternate" hreflang="x-default" href="${baseUrl}${enLocalizedPath}"/>
  </url>`);
      }

      parts.push(`
</urlset>`);

      const xml = parts.join('');

      // Cache for 24 hours
      await CacheManager.set(cacheKey, xml, { ttl: SITEMAP_CONFIG.cacheTtlSeconds });

      // Set caching headers
      res.setHeader('Content-Type', 'application/xml');
      res.setHeader('ETag', etag);
      res.setHeader('Cache-Control', `public, max-age=${SITEMAP_CONFIG.cacheTtlSeconds}`);
      res.send(xml);

      const duration = Date.now() - startTime;
      logger.log(`✅ Generated sitemap-stations-${lang}-${chunk}.xml (${stationCount} stations) in ${duration}ms`);

    } catch (error) {
      logger.error(`❌ Error generating sitemap-stations-${lang}-${chunk}.xml:`, error);
      res.status(500).send('Error generating sitemap');
    }
  });

  // Language-specific genre sitemap route
  app.get("/sitemap-genres-:lang.xml", async (req, res) => {
    const startTime = Date.now();
    const lang = req.params.lang;
    
    try {
      // Gate by qualified languages (task #17).
      const qualifiedLanguages = await getCachedQualifiedLanguages();
      if (!qualifiedLanguages.includes(lang)) {
        return res.status(404).send('Language not found');
      }

      const today = new Date().toISOString().split('T')[0];
      const etag = `"${crypto.createHash('md5').update(`genres-${lang}-${today}`).digest('hex')}"`;
      
      const clientEtag = req.headers['if-none-match'];
      if (clientEtag && (clientEtag === etag || clientEtag === `W/${etag}` || clientEtag.includes(etag))) {
        res.setHeader('ETag', etag);
        res.setHeader('Cache-Control', `public, max-age=${SITEMAP_CONFIG.cacheTtlSeconds}`);
        return res.status(304).end();
      }

      const cacheKey = `sitemap:genres:${lang}`;
      const cached = await CacheManager.get<string>(cacheKey);
      
      if (cached) {
        logger.log(`⚡ Sitemap cache HIT: ${cacheKey}`);
        res.setHeader('Content-Type', 'application/xml');
        res.setHeader('ETag', etag);
        res.setHeader('Cache-Control', `public, max-age=${SITEMAP_CONFIG.cacheTtlSeconds}`);
        return res.send(cached);
      }

      const baseUrl = getBaseUrl(req);

      // Load URL translations
      const { forwardMap: urlTranslations } = await ensureUrlTranslationsLoaded();

      // Stream genres via cursor + array buffer (bounded memory, no quadratic string concat)
      const genreCursor = Genre.find({ slug: { $exists: true, $ne: '' } })
        .select('slug _id updatedAt')
        .sort({ stationCount: -1 })
        .lean()
        .cursor({ batchSize: 200 });

      const parts: string[] = [];
      parts.push(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">`);

      let genreCount = 0;
      for await (const genre of genreCursor as any) {
        genreCount++;
        const genrePath = `/genres/${genre.slug}`;
        const localizedPath = buildLocalizedUrl(genrePath, lang, undefined, urlTranslations);
        const fullUrl = `${baseUrl}${localizedPath}`;

        parts.push(`
  <url>
    <loc>${fullUrl}</loc>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>`);

        for (const altLang of qualifiedLanguages) {
          const altLocalizedPath = buildLocalizedUrl(genrePath, altLang, undefined, urlTranslations);
          parts.push(`
    <xhtml:link rel="alternate" hreflang="${altLang}" href="${baseUrl}${altLocalizedPath}"/>`);
        }

        const enLocalizedPath = buildLocalizedUrl(genrePath, 'en', undefined, urlTranslations);
        parts.push(`
    <xhtml:link rel="alternate" hreflang="x-default" href="${baseUrl}${enLocalizedPath}"/>
  </url>`);
      }

      parts.push(`
</urlset>`);

      const xml = parts.join('');

      // Cache for 24 hours
      await CacheManager.set(cacheKey, xml, { ttl: SITEMAP_CONFIG.cacheTtlSeconds });

      // Set caching headers
      res.setHeader('Content-Type', 'application/xml');
      res.setHeader('ETag', etag);
      res.setHeader('Cache-Control', `public, max-age=${SITEMAP_CONFIG.cacheTtlSeconds}`);
      res.send(xml);

      const duration = Date.now() - startTime;
      logger.log(`✅ Generated sitemap-genres-${lang}.xml (${genreCount} genres) in ${duration}ms`);

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
    res.status(410).setHeader('Content-Type', 'text/plain').send('Gone');
  });
  app.get("/sitemap-videos.xml", (_req, res) => {
    res.status(410).setHeader('Content-Type', 'text/plain').send('Gone');
  });
  app.get("/sitemap-images-:i.xml", (_req, res) => {
    res.status(410).setHeader('Content-Type', 'text/plain').send('Gone');
  });
  app.get(/^\/sitemap-stations-(\d+)\.xml$/, (_req, res) => {
    res.status(410).setHeader('Content-Type', 'text/plain').send('Gone');
  });


  // Sitemap Index — single entry point for Google to discover all sitemaps.
  // References ONLY routes that exist and return valid XML.
  // Architecture:
  //   sitemap-main-{lang}.xml    → main pages per language (home, genres, regions, etc.)
  //   sitemap-genres-{lang}.xml  → genre pages per language
  //   sitemap-stations-{lang}-{chunk}.xml → station pages per language, paginated
  app.get("/sitemap-index.xml", async (req, res) => {
    try {
      const baseUrl = getBaseUrl(req);

      let totalStations = 0;
      const countCacheKey = 'sitemap:stationCount';
      const cachedCount = await CacheManager.get<number>(countCacheKey);
      if (cachedCount) {
        totalStations = cachedCount;
      } else {
        try {
          totalStations = await Promise.race([
            Station.countDocuments({ slug: { $exists: true, $ne: '' } }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000))
          ]) as number;
          await CacheManager.set(countCacheKey, totalStations, { ttl: 86400 });
        } catch {
          logger.warn('⚠️ Sitemap Index: Station count timed out — using safe fallback');
          totalStations = 50000;
        }
      }

      const stationChunks = Math.max(1, Math.ceil(totalStations / SITEMAP_CONFIG.stationsPerChunk));

      // task #17: only emit sitemap entries for languages that pass the
      // strict translation-completeness gate. This is what actually keeps
      // /sl, /da, etc. out of the index until their translations land.
      const qualifiedLanguages = await getCachedQualifiedLanguages();

      let xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`;

      for (const lang of qualifiedLanguages) {
        xml += `
  <sitemap>
    <loc>${baseUrl}/sitemap-main-${lang}.xml</loc>
  </sitemap>`;
      }

      for (const lang of qualifiedLanguages) {
        xml += `
  <sitemap>
    <loc>${baseUrl}/sitemap-genres-${lang}.xml</loc>
  </sitemap>`;
      }

      for (const lang of qualifiedLanguages) {
        for (let i = 1; i <= stationChunks; i++) {
          xml += `
  <sitemap>
    <loc>${baseUrl}/sitemap-stations-${lang}-${i}.xml</loc>
  </sitemap>`;
        }
      }

      xml += `
</sitemapindex>`;

      res.setHeader('Content-Type', 'application/xml');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(xml);

    } catch (error) {
      console.error('❌ Error generating sitemap index:', error);
      res.status(500).send('Error generating sitemap index');
    }
  });
}
