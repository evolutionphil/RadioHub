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

export async function registerSeoSitemapRoutes(app: Express, deps: any) {
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
      
      const seoData = await seoRenderer.getPageData(url, fullDomain);
      res.json(seoData);
    } catch (error) {
      console.error('SEO Page Data error:', error);
      res.status(500).json({ error: 'Failed to fetch SEO page data' });
    }
  });

  // Robots.txt generator
  app.get("/robots.txt", async (req, res) => {
    const baseUrl = getBaseUrl(req);
    
    let robots = `User-agent: *
Allow: /

# Sitemaps
Sitemap: ${baseUrl}/sitemap-index.xml
Sitemap: ${baseUrl}/sitemap-main.xml
Sitemap: ${baseUrl}/sitemap-news.xml
Sitemap: ${baseUrl}/sitemap-videos.xml`;

    // Add language-specific sitemaps
    for (const lang of ACTIVE_SITEMAP_LANGUAGES) {
      robots += `\nSitemap: ${baseUrl}/sitemap-main-${lang}.xml`;
      robots += `\nSitemap: ${baseUrl}/sitemap-genres-${lang}.xml`;
      // Check for station chunks (assuming 15 chunks as safe default or better yet, calculate)
      for (let i = 1; i <= 15; i++) {
        robots += `\nSitemap: ${baseUrl}/sitemap-stations-${lang}-${i}.xml`;
      }
    }

    res.setHeader('Content-Type', 'text/plain');
    res.send(robots);
  });

  /**
   * Helper function to check if a language has enough SEO translations to be indexed
   * This prevents Google from indexing low-quality "partially translated" pages
   */
  async function getQualifiedSeoLanguages(allLanguages: string[]): Promise<string[]> {
    const qualified = [];
    
    for (const lang of allLanguages) {
      try {
        // Load translations for this language
        const translations = await performanceCache.getTranslations(lang);
        
        // Check if language has all required SEO keys
        if (hasCompleteSeoTranslations(translations)) {
          qualified.push(lang);
        }
      } catch (error) {
        // Skip languages that fail to load
        logger.warn(`⚠️ Sitemap: Skipping language ${lang} - failed to load translations`);
      }
    }
    
    logger.log(`✅ Sitemap: ${qualified.length}/${allLanguages.length} languages have complete SEO translations`);
    return qualified;
  }

  // Language-specific main sitemap route
  app.get("/sitemap-main-:lang.xml", async (req, res) => {
    const startTime = Date.now();
    const lang = req.params.lang;
    
    try {
      // Validate language is in Phase 1
      if (!ACTIVE_SITEMAP_LANGUAGES.includes(lang)) {
        return res.status(404).send('Language not found');
      }

      // Generate deterministic ETag (changes daily)
      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      const etag = `"${crypto.createHash('md5').update(`main-${lang}-${today}`).digest('hex')}"`;
      
      // Check cache first
      const cacheKey = `sitemap:main:${lang}`;
      const cached = await CacheManager.get<string>(cacheKey);
      
      if (cached) {
        logger.log(`⚡ Sitemap cache HIT: ${cacheKey}`);
        res.setHeader('Content-Type', 'application/xml');
        res.setHeader('ETag', etag);
        res.setHeader('Cache-Control', `public, max-age=${SITEMAP_CONFIG.cacheTtlSeconds}`);
        
        if (req.headers['if-none-match'] === etag) {
          return res.status(304).end();
        }
        return res.send(cached);
      }

      const baseUrl = getBaseUrl(req);
      const lastMod = new Date().toISOString();

      // Load URL translations
      const { forwardMap: urlTranslations } = await ensureUrlTranslationsLoaded();

      let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">`;

      // Main pages to include
      const mainPages = ['', '/stations', '/genres', '/countries', '/about'];

      for (const page of mainPages) {
        // Build localized URL for this language
        const localizedPath = buildLocalizedUrl(page, lang, undefined, urlTranslations);
        const fullUrl = `${baseUrl}${localizedPath}`;

        xml += `
  <url>
    <loc>${fullUrl}</loc>
    <lastmod>${lastMod}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.9</priority>`;

        // Add hreflang tags for all Phase 1 languages
        for (const altLang of ACTIVE_SITEMAP_LANGUAGES) {
          const altLocalizedPath = buildLocalizedUrl(page, altLang, undefined, urlTranslations);
          const altFullUrl = `${baseUrl}${altLocalizedPath}`;
          xml += `
    <xhtml:link rel="alternate" hreflang="${altLang}" href="${altFullUrl}"/>`;
        }

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
      // Validate language is in Phase 1
      if (!ACTIVE_SITEMAP_LANGUAGES.includes(lang)) {
        return res.status(404).send('Language not found');
      }

      // Generate deterministic ETag (changes daily)
      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      const etag = `"${crypto.createHash('md5').update(`stations-${lang}-${chunk}-${today}`).digest('hex')}"`;
      
      // Check cache first
      const cacheKey = `sitemap:stations:${lang}:${chunk}`;
      const cached = await CacheManager.get<string>(cacheKey);
      
      if (cached) {
        logger.log(`⚡ Sitemap cache HIT: ${cacheKey}`);
        res.setHeader('Content-Type', 'application/xml');
        res.setHeader('ETag', etag);
        res.setHeader('Cache-Control', `public, max-age=${SITEMAP_CONFIG.cacheTtlSeconds}`);
        
        if (req.headers['if-none-match'] === etag) {
          return res.status(304).end();
        }
        return res.send(cached);
      }

      const baseUrl = getBaseUrl(req);
      const lastMod = new Date().toISOString();
      const stationsPerChunk = SITEMAP_CONFIG.stationsPerChunk;
      const skip = (chunk - 1) * stationsPerChunk;

      // Load URL translations
      const { forwardMap: urlTranslations } = await ensureUrlTranslationsLoaded();

      // Fetch stations for this chunk
      const stations = await Station.find({ slug: { $exists: true, $ne: '' } })
        .select('slug _id')
        .sort({ votes: -1 })
        .skip(skip)
        .limit(stationsPerChunk)
        .lean();

      let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">`;

      for (const station of stations) {
        // Build localized station URL for this language
        const stationPath = `/station/${station.slug}`;
        const localizedPath = buildLocalizedUrl(stationPath, lang, undefined, urlTranslations);
        const fullUrl = `${baseUrl}${localizedPath}`;

        xml += `
  <url>
    <loc>${fullUrl}</loc>
    <lastmod>${lastMod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>`;

        // Add hreflang tags for all Phase 1 languages
        for (const altLang of ACTIVE_SITEMAP_LANGUAGES) {
          const altLocalizedPath = buildLocalizedUrl(stationPath, altLang, undefined, urlTranslations);
          const altFullUrl = `${baseUrl}${altLocalizedPath}`;
          xml += `
    <xhtml:link rel="alternate" hreflang="${altLang}" href="${altFullUrl}"/>`;
        }

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
      logger.log(`✅ Generated sitemap-stations-${lang}-${chunk}.xml (${stations.length} stations) in ${duration}ms`);

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
      // Validate language is in Phase 1
      if (!ACTIVE_SITEMAP_LANGUAGES.includes(lang)) {
        return res.status(404).send('Language not found');
      }

      // Generate deterministic ETag (changes daily)
      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      const etag = `"${crypto.createHash('md5').update(`genres-${lang}-${today}`).digest('hex')}"`;
      
      // Check cache first
      const cacheKey = `sitemap:genres:${lang}`;
      const cached = await CacheManager.get<string>(cacheKey);
      
      if (cached) {
        logger.log(`⚡ Sitemap cache HIT: ${cacheKey}`);
        res.setHeader('Content-Type', 'application/xml');
        res.setHeader('ETag', etag);
        res.setHeader('Cache-Control', `public, max-age=${SITEMAP_CONFIG.cacheTtlSeconds}`);
        
        if (req.headers['if-none-match'] === etag) {
          return res.status(304).end();
        }
        return res.send(cached);
      }

      const baseUrl = getBaseUrl(req);
      const lastMod = new Date().toISOString();

      // Load URL translations
      const { forwardMap: urlTranslations } = await ensureUrlTranslationsLoaded();

      // Fetch all genres with slugs
      const genres = await Genre.find({ slug: { $exists: true, $ne: '' } })
        .select('slug _id')
        .sort({ stationCount: -1 })
        .lean();

      let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">`;

      for (const genre of genres) {
        // Build localized genre URL for this language
        const genrePath = `/genres/${genre.slug}`;
        const localizedPath = buildLocalizedUrl(genrePath, lang, undefined, urlTranslations);
        const fullUrl = `${baseUrl}${localizedPath}`;

        xml += `
  <url>
    <loc>${fullUrl}</loc>
    <lastmod>${lastMod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>`;

        // Add hreflang tags for all Phase 1 languages
        for (const altLang of ACTIVE_SITEMAP_LANGUAGES) {
          const altLocalizedPath = buildLocalizedUrl(genrePath, altLang, undefined, urlTranslations);
          const altFullUrl = `${baseUrl}${altLocalizedPath}`;
          xml += `
    <xhtml:link rel="alternate" hreflang="${altLang}" href="${altFullUrl}"/>`;
        }

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
      logger.log(`✅ Generated sitemap-genres-${lang}.xml (${genres.length} genres) in ${duration}ms`);

    } catch (error) {
      logger.error(`❌ Error generating sitemap-genres-${lang}.xml:`, error);
      res.status(500).send('Error generating sitemap');
    }
  });

  // Split sitemap by content type for better organization
  app.get("/sitemap-main.xml", async (req, res) => {
    try {
      const baseUrl = getBaseUrl(req);
      
      // Load URL translations from database and static files
      const { forwardMap: urlTranslations } = await ensureUrlTranslationsLoaded();
      
      let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">`;

      // Add main pages with language variants
      const mainPages = ['', '/stations', '/genres', '/countries', '/about'];
      let languages: string[] = ['en']; // Fallback
      let DEFAULT_LANGUAGE = 'en';
      
      try {
        const seoConfig = await import('@shared/seo-config');
        languages = seoConfig.SEO_LANGUAGES.filter(lang => lang.enabled).map(lang => lang.code);
        DEFAULT_LANGUAGE = seoConfig.DEFAULT_LANGUAGE;
      } catch (error) {
        logger.warn('⚠️ Sitemap: Could not load SEO config, using defaults');
      }
      
      const qualifiedLanguages = await getQualifiedSeoLanguages(languages);
      
      // Pre-load country mappings once
      const countryMappings = await import('@shared/seo-config').then(config => config.COUNTRY_TO_LANGUAGE).catch(() => ({}));
      const seoLanguagesConfig = await import('@shared/seo-config').then(config => config.SEO_LANGUAGES).catch(() => []);
      
      // Helper function to generate hreflang links for a page
      const generateHreflangs = (page: string, urlTranslations: Map<string, string>) => {
        let hreflangs = '';
        const addedHreflangs = new Set();
        
        // Add language alternatives
        for (const lang of qualifiedLanguages) {
          const langConfig = seoLanguagesConfig.find((l: any) => l.code === lang);
          const localizedUrl = buildLocalizedUrl(page, lang, undefined, urlTranslations);
          const hreflang = langConfig?.iso || lang;
          if (!addedHreflangs.has(hreflang)) {
            hreflangs += `
    <xhtml:link rel="alternate" hreflang="${hreflang}" href="${baseUrl}${localizedUrl}"/>`;
            addedHreflangs.add(hreflang);
          }
        }
        
        // Add country-specific alternatives
        for (const [countryCode, countryLang] of Object.entries(countryMappings)) {
          if (countryLang && languages.includes(countryLang as string)) {
            const localizedUrl = buildLocalizedUrl(page, countryLang as string, countryCode, urlTranslations);
            const hreflang = `${countryLang}-${countryCode.toUpperCase()}`;
            if (!addedHreflangs.has(hreflang)) {
              hreflangs += `
    <xhtml:link rel="alternate" hreflang="${hreflang}" href="${baseUrl}${localizedUrl}"/>`;
              addedHreflangs.add(hreflang);
            }
          }
        }
        
        // Add x-default
        hreflangs += `
    <xhtml:link rel="alternate" hreflang="x-default" href="${baseUrl}${page}"/>`;
        
        return hreflangs;
      };
      
      for (const page of mainPages) {
        // 1. Default language version (English)
        xml += `
  <url>
    <loc>${baseUrl}${page}</loc>
    <lastmod>${new Date().toISOString()}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.9</priority>${generateHreflangs(page, urlTranslations)}
  </url>`;
        
        // 2. Add separate <url> entries for each LANGUAGE variant
        for (const lang of qualifiedLanguages) {
          if (lang === DEFAULT_LANGUAGE) continue;
          
          const localizedUrl = buildLocalizedUrl(page, lang, undefined, urlTranslations);
          xml += `
  <url>
    <loc>${baseUrl}${localizedUrl}</loc>
    <lastmod>${new Date().toISOString()}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.8</priority>${generateHreflangs(page, urlTranslations)}
  </url>`;
        }
        
        // 3. Add separate <url> entries for each COUNTRY variant
        for (const [countryCode, countryLang] of Object.entries(countryMappings)) {
          if (countryLang && languages.includes(countryLang as string)) {
            if (countryCode === countryLang) continue;
            
            const localizedUrl = buildLocalizedUrl(page, countryLang as string, countryCode, urlTranslations);
            xml += `
  <url>
    <loc>${baseUrl}${localizedUrl}</loc>
    <lastmod>${new Date().toISOString()}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.7</priority>${generateHreflangs(page, urlTranslations)}
  </url>`;
          }
        }
      }

      const seoLanguages = await import('@shared/seo-config').then(config => config.SEO_LANGUAGES).catch(() => []);
      const langCodeToIso = new Map(seoLanguages.map((lang: any) => [lang.code, lang.iso]));
      
      // Add genre pages with language alternatives
      let genres: string[] = [];
      try {
        genres = await Promise.race([
          Station.distinct('tags'),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Query timeout')), 3000))
        ]) as string[];
      } catch (error) {
        logger.warn('⚠️ Sitemap: Could not load genres');
      }
      const topGenres = genres.filter(g => g && g.length > 0).slice(0, 100);
      
      for (const genre of topGenres) {
        const genreSlug = genre.toLowerCase().replace(/[^a-z0-9]/g, '-');
        const genrePath = `/genres/${genreSlug}`;
        const canonicalUrl = buildLocalizedUrl(genrePath, DEFAULT_LANGUAGE, undefined, urlTranslations);
        
        xml += `
  <url>
    <loc>${baseUrl}${canonicalUrl}</loc>
    <lastmod>${new Date().toISOString()}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>`;
        
        const addedHreflangs = new Set();
        for (const lang of qualifiedLanguages) {
          const localizedUrl = buildLocalizedUrl(genrePath, lang, undefined, urlTranslations);
          const hreflang = langCodeToIso.get(lang) || lang;
          if (!addedHreflangs.has(hreflang)) {
            xml += `
    <xhtml:link rel="alternate" hreflang="${hreflang}" href="${baseUrl}${localizedUrl}"/>`;
            addedHreflangs.add(hreflang);
          }
        }
        
        xml += `
    <xhtml:link rel="alternate" hreflang="x-default" href="${baseUrl}${canonicalUrl}"/>
  </url>`;
      }

      // Add country pages
      let countries: string[] = [];
      try {
        countries = await Promise.race([
          Station.distinct('country'),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Query timeout')), 3000))
        ]) as string[];
      } catch (error) {
        logger.warn('⚠️ Sitemap: Could not load countries');
      }
      for (const country of countries.filter(c => c).slice(0, 50)) {
        const countrySlug = country.toLowerCase().replace(/[^a-z0-9]/g, '-');
        const countryPath = `/countries/${countrySlug}`;
        const canonicalUrl = buildLocalizedUrl(countryPath, DEFAULT_LANGUAGE, undefined, urlTranslations);
        
        xml += `
  <url>
    <loc>${baseUrl}${canonicalUrl}</loc>
    <lastmod>${new Date().toISOString()}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>`;
        
        const addedHreflangs = new Set();
        for (const lang of qualifiedLanguages) {
          const localizedUrl = buildLocalizedUrl(countryPath, lang, undefined, urlTranslations);
          const hreflang = langCodeToIso.get(lang) || lang;
          if (!addedHreflangs.has(hreflang)) {
            xml += `
    <xhtml:link rel="alternate" hreflang="${hreflang}" href="${baseUrl}${localizedUrl}"/>`;
            addedHreflangs.add(hreflang);
          }
        }
        
        xml += `
    <xhtml:link rel="alternate" hreflang="x-default" href="${baseUrl}${canonicalUrl}"/>
  </url>`;
      }

      // Add regions pages
      const regionsData = [
        { slug: 'africa', name: 'Africa' },
        { slug: 'asia', name: 'Asia' },
        { slug: 'europe', name: 'Europe' },
        { slug: 'north-america', name: 'North America' },
        { slug: 'south-america', name: 'South America' },
        { slug: 'oceania', name: 'Oceania' }
      ];

      xml += `
  <url>
    <loc>${baseUrl}/regions</loc>
    <lastmod>${new Date().toISOString()}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>`;

      for (const region of regionsData) {
        xml += `
  <url>
    <loc>${baseUrl}/regions/${region.slug}</loc>
    <lastmod>${new Date().toISOString()}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
  </url>`;
      }

      const regionCountryCombinations = [
        { region: 'europe', country: 'germany' },
        { region: 'europe', country: 'france' },
        { region: 'europe', country: 'united-kingdom' },
        { region: 'europe', country: 'spain' },
        { region: 'europe', country: 'italy' },
        { region: 'asia', country: 'turkey' },
        { region: 'asia', country: 'japan' },
        { region: 'asia', country: 'india' },
        { region: 'north-america', country: 'united-states' },
        { region: 'north-america', country: 'canada' },
        { region: 'south-america', country: 'brazil' },
        { region: 'africa', country: 'south-africa' }
      ];

      for (const combo of regionCountryCombinations) {
        xml += `
  <url>
    <loc>${baseUrl}/regions/${combo.region}/${combo.country}</loc>
    <lastmod>${new Date().toISOString()}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.5</priority>
  </url>
  <url>
    <loc>${baseUrl}/regions/${combo.region}/${combo.country}/stations</loc>
    <lastmod>${new Date().toISOString()}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.5</priority>
  </url>`;
      }

      xml += `
</urlset>`;

      res.setHeader('Content-Type', 'application/xml');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send(xml);
      
    } catch (error) {
      console.error('❌ Error generating main sitemap:', error);
      res.status(500).send('Error generating sitemap');
    }
  });

  // News Sitemap for stations with news content
  app.get("/sitemap-news.xml", async (req, res) => {
    try {
      const baseUrl = getBaseUrl(req);
      
      let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">`;

      let newsStations = [];
      try {
        newsStations = await Promise.race([
          Station.find({
            $or: [
              { tags: { $regex: /news/i } },
              { genre: { $regex: /news|talk|current/i } },
              { name: { $regex: /news|talk|radio|fm|am/i } }
            ]
          }, 'slug _id name tags genre country homepage updatedAt')
            .limit(1000)
            .lean(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Query timeout')), 5000))
        ]) as any[];
      } catch (error) {
        console.error('❌ News Sitemap: Database query failed');
        return res.status(503).send('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"></urlset>');
      }
      
      for (const station of newsStations) {
        const stationPath = `/station/${station.slug || station._id}`;
        const pubDate = station.updatedAt ? new Date(station.updatedAt) : new Date();
        const twoDaysAgo = new Date();
        twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
        
        if (pubDate >= twoDaysAgo) {
          xml += `
  <url>
    <loc>${baseUrl}${stationPath}</loc>
    <news:news>
      <news:publication>
        <news:name>${station.name}</news:name>
        <news:language>en</news:language>
      </news:publication>
      <news:publication_date>${pubDate.toISOString()}</news:publication_date>
      <news:title>${station.name} - Live News Radio</news:title>
      <news:keywords>${Array.isArray(station.tags) ? station.tags.join(', ') : (station.tags || 'news, radio, live')}</news:keywords>
    </news:news>
  </url>`;
        }
      }

      xml += `
</urlset>`;

      res.setHeader('Content-Type', 'application/xml');
      res.setHeader('Cache-Control', 'public, max-age=1800');
      res.send(xml);
      
    } catch (error) {
      console.error('❌ Error generating news sitemap:', error);
      res.status(500).send('Error generating news sitemap');
    }
  });

  // Video Sitemap for stations with video streams
  app.get("/sitemap-videos.xml", async (req, res) => {
    try {
      const baseUrl = getBaseUrl(req);
      
      let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">`;

      let videoStations = [];
      try {
        videoStations = await Promise.race([
          Station.find({
            $or: [
              { url: { $regex: /\.m3u8|hls|stream.*video|rtmp|rtsp/i } },
              { tags: { $regex: /tv|video|webcam|visual/i } },
              { name: { $regex: /tv|television|video|webcam/i } }
            ]
          }, 'slug _id name url tags genre country homepage favicon updatedAt')
            .limit(500)
            .lean(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Query timeout')), 5000))
        ]) as any[];
      } catch (error) {
        console.error('❌ Video Sitemap: Database query failed');
        return res.status(503).send('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1"></urlset>');
      }
      
      for (const station of videoStations) {
        const stationPath = `/station/${station.slug || station._id}`;
        const lastMod = station.updatedAt ? new Date(station.updatedAt).toISOString() : new Date().toISOString();
        
        xml += `
  <url>
    <loc>${baseUrl}${stationPath}</loc>
    <lastmod>${lastMod}</lastmod>
    <video:video>
      <video:thumbnail_loc>${station.favicon || `${baseUrl}/images/default-station.jpg`}</video:thumbnail_loc>
      <video:title>${station.name} - Live Video Stream</video:title>
      <video:description>Watch ${station.name} live video stream${station.country ? ` from ${station.country}` : ''}. ${Array.isArray(station.tags) ? station.tags.join(', ') : (station.tags || 'Live streaming video content.')}</video:description>
      <video:content_loc>${station.url}</video:content_loc>
      <video:player_loc>${baseUrl}${stationPath}</video:player_loc>
      <video:duration>0</video:duration>
      <video:live>yes</video:live>
      <video:family_friendly>yes</video:family_friendly>
    </video:video>
  </url>`;
      }

      xml += `
</urlset>`;

      res.setHeader('Content-Type', 'application/xml');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send(xml);
      
    } catch (error) {
      console.error('❌ Error generating video sitemap:', error);
      res.status(500).send('Error generating video sitemap');
    }
  });

  // Sitemap Index - References all specialized sitemaps
  app.get("/sitemap-index.xml", async (req, res) => {
    try {
      const baseUrl = getBaseUrl(req);
      const lastMod = new Date().toISOString();
      
      let totalStations = 0;
      let totalImageStations = 0;
      const stationsPerChunk = 1000;
      const imageStationsPerChunk = 500;
      
      try {
        [totalStations, totalImageStations] = await Promise.all([
          Promise.race([
            Station.countDocuments(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Station count timeout')), 3000))
          ]) as Promise<number>,
          Promise.race([
            Station.countDocuments({ favicon: { $nin: [null, ''] } }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Image count timeout')), 3000))
          ]) as Promise<number>
        ]);
      } catch (error: any) {
        logger.warn('⚠️ Sitemap Index: Could not count stations');
      }
      
      const stationChunks = Math.ceil(totalStations / stationsPerChunk) || 1;
      const imageChunks = Math.ceil(totalImageStations / imageStationsPerChunk) || 1;
      
      let xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>${baseUrl}/sitemap-main.xml</loc>
    <lastmod>${lastMod}</lastmod>
  </sitemap>`;

      for (let i = 1; i <= stationChunks; i++) {
        xml += `
  <sitemap>
    <loc>${baseUrl}/sitemap-stations-${i}.xml</loc>
    <lastmod>${lastMod}</lastmod>
  </sitemap>`;
      }

      for (let i = 1; i <= imageChunks; i++) {
        xml += `
  <sitemap>
    <loc>${baseUrl}/sitemap-images-${i}.xml</loc>
    <lastmod>${lastMod}</lastmod>
  </sitemap>`;
      }

      xml += `
  <sitemap>
    <loc>${baseUrl}/sitemap-news.xml</loc>
    <lastmod>${lastMod}</lastmod>
  </sitemap>
  <sitemap>
    <loc>${baseUrl}/sitemap-videos.xml</loc>
    <lastmod>${lastMod}</lastmod>
  </sitemap>
</sitemapindex>`;

      res.setHeader('Content-Type', 'application/xml');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send(xml);
      
    } catch (error) {
      console.error('❌ Error generating sitemap index:', error);
      res.status(500).send('Error generating sitemap index');
    }
  });
}
