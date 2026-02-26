import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from 'ws';
import crypto from 'crypto';
import mongoose from 'mongoose';
import passport from './auth/passport-config';
import { TranslationLanguage, Station, Genre, VisitorSession, UserListeningHistory } from '../shared/mongo-schemas';
import { registerCountryLanguageMappingRoutes } from './routes/country-language-mappings';
import urlTranslationsRouter from './routes/url-translations';
import performanceRouter from './routes/performance';
import apiKeysRouter, { apiKeyMiddleware, seedDemoApiKey } from './routes/api-keys';
import { userEngagementRouter } from './routes/user-engagement';
import indexnowMonitoringRouter from './routes/indexnow-monitoring';
import { IndexNowService } from './services/indexnow';
import { COUNTRY_TO_LANGUAGE, CODE_TO_COUNTRY } from '@shared/seo-config';
import CacheManager from './cache';
import { normalizeCountryFilter } from './utils/normalize-country';
import { StreamMetadataService } from './services/stream-metadata';
import { RealtimeMetadataService } from './services/realtime-metadata';
import { logger } from './utils/logger';
import { PrecomputedCitiesService } from './services/precomputed-cities';
import { PrecomputedGenresService } from './services/precomputed-genres';
import {
  refreshTranslationsCache,
  refreshPopularStationsCache,
  refreshCommunityFavoritesCache,
  fetchTranslationsForLanguage
} from './routes/cache-refresh-utils';
import { TV_GENRE_PROJECTION, TV_STATION_PROJECTION, tvSlimStation, tvSlimGenre } from './routes/shared-utils';
import { requireAuth, requireAdmin, generateAuthToken } from './middleware/auth';
import { registerCastRoutes } from './routes/cast-routes';
import { registerOgImageRoutes } from './routes/og-image-routes';
import { registerCacheDashboardRoutes } from './routes/cache-dashboard-routes';
import { registerAdminAuthRoutes } from './routes/admin-auth-routes';
import { registerSlugRoutes } from './routes/slug-routes';
import { registerAiDescriptionRoutes } from './routes/ai-description-routes';
import { registerLogoRoutes } from './routes/logo-routes';
import { registerAdminStationRoutes } from './routes/admin-station-routes';
import { registerPublicStationRoutes } from './routes/station-public-routes';
import { registerGenresCountriesRoutes } from './routes/genres-countries-routes';
import { registerTranslationAdminRoutes } from './routes/translation-admin-routes';
import { registerUserAuthRoutes } from './routes/user-auth-routes';
import { registerMobileTvRoutes } from './routes/mobile-tv-routes';
import { registerTranslationKeyRoutes } from './routes/translation-keys-routes';
import { registerSeoSitemapRoutes } from './routes/seo-sitemap-routes';
import { registerStreamProxyRoutes } from './routes/stream-proxy-routes';
import { registerRegionsRecommendationsRoutes } from './routes/regions-recommendations-routes';
import { registerMiscRoutes } from './routes/misc-routes';
import { registerMessagesRoutes } from './routes/messages-routes';

const deps = {
  requireAuth,
  requireAdmin,
  generateAuthToken,
  apiKeyMiddleware,
  seedDemoApiKey
};

export async function registerRoutes(app: Express): Promise<Server & { metadataWss: InstanceType<typeof WebSocketServer>, castWss: InstanceType<typeof WebSocketServer> }> {
  const server = createServer(app);

  // === HEALTH CHECK ===
  app.get('/api/health', (_req, res) => {
    const mongoStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
    res.json({
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      mongo: mongoStatus,
      env: process.env.NODE_ENV || 'development'
    });
  });

  // === CORS FOR HLS STREAMS ===
  app.use('/api/stream', (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, HEAD');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type, Accept, User-Agent, Authorization, Cache-Control');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
    if (req.method === 'OPTIONS') return res.status(200).end();
    next();
  });

  // === WEBSOCKET SERVERS ===
  const streamMetadataService = new StreamMetadataService();
  const realtimeMetadataService = new RealtimeMetadataService();
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

  wss.on('connection', (socket: WebSocket, request) => {
    const clientId = `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    logger.log(`🎵 REALTIME METADATA: WebSocket client connected via ${request.url}`);
    realtimeMetadataService.addClient(clientId, socket);
  });

  const castWss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  logger.log(`📺 CAST: WebSocket server ready at /ws/cast`);

  // === CAST ROUTES (WebSocket + REST, registered before middleware) ===
  registerCastRoutes(app, castWss, deps);

  // === OG IMAGE ROUTES ===
  registerOgImageRoutes(app, deps);

  // === INVALID PATH BLOCKING ===
  app.use((req, res, next) => {
    const invalidPatterns = [
      /^\/vercel\//,
      /^\/path0\//,
      /^\/locales\/.*\.json$/,
      /^\/node_modules\//,
      /^\/\.env/,
      /^\/package\.json$/,
      /^\/tsconfig\.json$/,
      /^\/server\//,
      /^\/client\//,
    ];
    if (invalidPatterns.some(pattern => pattern.test(req.path))) {
      logger.log(`🚫 Blocked invalid path: ${req.path}`);
      return res.status(404).type('text/plain').send('Not Found');
    }
    next();
  });

  // === SECURITY: NONCE GENERATION ===
  app.use((req, res, next) => {
    const nonce = crypto.randomBytes(16).toString('base64');
    (res as any).nonce = nonce;
    next();
  });

  // === SECURITY: RESPONSE HEADERS ===
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    if (process.env.NODE_ENV === 'production') {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    }
    next();
  });

  // === PASSPORT INITIALIZATION ===
  app.use(passport.initialize());
  app.use(passport.session());

  // === VISITOR TRACKING ===
  app.use((req, _res, next) => {
    if ((req.path.startsWith('/api/') || req.path === '/' || !req.path.includes('.')) && req.path !== '/health') {
      const ipAddress = req.ip || req.connection.remoteAddress || 'unknown';
      VisitorSession.findOneAndUpdate(
        { ipAddress },
        { $set: { lastActiveDate: new Date(), userAgent: req.get('user-agent') }, $inc: { visitCount: 1 } },
        { upsert: true, new: true }
      ).catch(() => {});
    }
    next();
  });

  // === DB INDEX CREATION ===
  const createIndexes = async () => {
    try {
      await Station.collection.createIndex({ name: 1 });
      await Station.collection.createIndex({ votes: -1 });
      await Station.collection.createIndex({ createdAt: -1 });
      await Station.collection.createIndex({ country: 1, votes: -1 });
      await Station.collection.createIndex({ lastCheckOk: -1, votes: -1 });
      await Station.collection.createIndex({ playbackSuccessCount: -1 });
      await Station.collection.createIndex({ state: 1, country: 1 });
      await Station.collection.createIndex({ tags: 1 });
      await Station.collection.createIndex({ language: 1 });
      await Station.collection.createIndex({ tags: 1, votes: -1 });
      await Station.collection.createIndex({ country: 1, language: 1 });
      try {
        await Station.collection.dropIndex('station_text_search');
        logger.log('✅ Dropped existing text search index to prevent conflicts');
      } catch {}
      await Station.collection.createIndex(
        { name: 'text', country: 'text', tags: 'text' },
        { name: 'station_text_search', weights: { name: 10, tags: 3, country: 1 }, textIndexVersion: 3, default_language: 'english' }
      );
      await Genre.collection.createIndex({ name: 1 });
      await Genre.collection.createIndex({ slug: 1 });
      await Genre.collection.createIndex({ isDiscoverable: 1, stationCount: -1 });
      await Genre.collection.createIndex({ createdAt: -1 });
      try {
        await Station.collection.createIndex({ geoLat: 1, geoLong: 1 });
        logger.log('✅ Geospatial index created for location queries');
      } catch {}
      logger.log('🚀 Performance indexes created successfully');
    } catch (error: any) {
      logger.log('Database indexes already exist or creation failed:', error.message);
    }
  };
  createIndexes();

  // === CACHE WARMUP FUNCTIONS ===
  async function warmupPopularStationsCache() {
    try {
      logger.log('🔥 Starting cache warmup - ALL translations FIRST for fast page load...');
      const enabledLanguages = await TranslationLanguage.find({ isEnabled: true }).select('code').lean();
      const languageCodes = enabledLanguages.map((l: any) => l.code);
      const criticalOrder = ['en', 'de', 'es', 'fr', 'it', 'tr', 'pt', 'nl', 'ru', 'pl'];
      const orderedLanguages = [
        ...criticalOrder.filter(code => languageCodes.includes(code)),
        ...languageCodes.filter((code: string) => !criticalOrder.includes(code))
      ];
      let cachedCount = 0;
      for (const lang of orderedLanguages) {
        try { await refreshTranslationsCache(lang); cachedCount++; } catch {}
      }
      logger.log(`✅ Cached ${cachedCount}/${orderedLanguages.length} language translations`);

      const countriesWithSeoTranslations = Object.entries(COUNTRY_TO_LANGUAGE)
        .filter(([, lang]) => lang !== 'en')
        .map(([code]) => (CODE_TO_COUNTRY as any)[code])
        .filter(Boolean);
      logger.log(`📍 Found ${countriesWithSeoTranslations.length} countries with SEO translations for cache warmup`);

      const countriesToWarmup = ['all', ...countriesWithSeoTranslations];
      for (const country of countriesToWarmup) {
        try {
          await refreshPopularStationsCache(country === 'all' ? undefined : country);
          await refreshCommunityFavoritesCache(country === 'all' ? undefined : country);
        } catch {}
      }

      try {
        const genres = await Genre.find({ isDiscoverable: true }).sort({ stationCount: -1 }).limit(13).lean();
        await CacheManager.set('genres:discoverable:all:13', genres, { ttl: 600 });
        logger.log('✅ Cached discoverable genres');
      } catch {}

      try {
        await PrecomputedCitiesService.warmupCache();
        logger.log('✅ Cached cities for all supported countries');
      } catch {}

      logger.log('🔥 Web cache warmup completed - translations, popular stations, community favorites, genres & cities cached!');
    } catch (error) {
      logger.log('⚠️ Cache warmup failed (non-critical):', error);
    }
  }

  async function warmupTvMobileCache() {
    try {
      logger.log('📱 Starting TV/Mobile cache warmup...');
      const topCountries = ['all', 'Turkey', 'Germany', 'United States', 'United Kingdom', 'France',
        'Spain', 'Italy', 'Netherlands', 'Austria', 'Switzerland', 'Brazil', 'Russia',
        'Japan', 'South Korea', 'India', 'Mexico', 'Canada', 'Australia', 'Poland'];

      const tvCountries = (await Station.distinct('country')).filter((c: string) => c && c.trim() !== '').sort();
      await CacheManager.set('tv:countries:all', tvCountries, { ttl: 86400 });

      const tvGenres = await Genre.find({ isDiscoverable: true })
        .select(TV_GENRE_PROJECTION)
        .sort({ displayOrder: 1 }).limit(13).lean();
      await CacheManager.set('tv:genres:discoverable:slim', tvGenres.map(tvSlimGenre), { ttl: 86400 });

      const tvLangs = ['en', 'tr', 'de', 'es', 'fr', 'it', 'pt', 'nl', 'ru', 'ar', 'ja', 'ko', 'zh'];
      for (const lang of tvLangs) {
        try {
          const translations = await fetchTranslationsForLanguage(lang);
          await CacheManager.set(`tv:translations:${lang}`, translations, { ttl: 604800 });
        } catch {}
      }
      logger.log(`📱 TV translations cached: ${tvLangs.length} languages`);

      for (const c of topCountries) {
        try {
          let filter: any = {};
          if (c !== 'all') Object.assign(filter, normalizeCountryFilter(c));

          const popStations = await Station.find(filter)
            .sort({ votes: -1 }).limit(21).select(TV_STATION_PROJECTION).lean();
          await CacheManager.set(`tv:popular:${c}`, popStations.map(tvSlimStation), { ttl: 86400 });

          const total = await Station.countDocuments(filter);
          const listStations = await Station.find(filter)
            .sort({ votes: -1 }).limit(20).select(TV_STATION_PROJECTION).lean();
          await CacheManager.set(`tv:stations:${c}:all:all:all:all:createdAt:1:20:false:all`, {
            stations: listStations.map(tvSlimStation),
            totalCount: total,
            count: total,
            pagination: { page: 1, limit: 20, total, pages: Math.ceil(total / 20) }
          }, { ttl: 86400 });
        } catch {}
      }

      logger.log(`📱 TV/Mobile cache warmup completed: ${topCountries.length} countries, ${tvLangs.length} languages (24h TTL)`);
    } catch (error) {
      logger.log('⚠️ TV/Mobile cache warmup failed (non-critical):', error);
    }
  }

  setImmediate(() => warmupPopularStationsCache());
  setImmediate(() => warmupTvMobileCache());

  // === HALOGO MIGRATION (one-time background) ===
  setImmediate(async () => {
    try {
      const migrationKey = 'migration:hasLogo:v1';
      const alreadyDone = await CacheManager.get(migrationKey);
      if (alreadyDone) return;
      logger.log('🔧 MIGRATION: Populating hasLogo field for all stations...');
      const BATCH = 2000;
      let skip = 0, totalUpdated = 0;
      while (true) {
        const stations = await Station.find({}, { _id: 1, favicon: 1, logo: 1, 'logoAssets.webp96': 1 })
          .skip(skip).limit(BATCH).lean();
        if (stations.length === 0) break;
        const ops = stations.map((s: any) => ({
          updateOne: { filter: { _id: s._id }, update: { $set: { hasLogo: !!(s.logoAssets?.webp96 || s.favicon || s.logo) } } }
        }));
        await Station.bulkWrite(ops, { ordered: false });
        totalUpdated += ops.length;
        skip += BATCH;
        await new Promise(r => setTimeout(r, 100));
      }
      await CacheManager.set(migrationKey, true, { ttl: 86400 * 365 });
      logger.log(`✅ MIGRATION: hasLogo populated for ${totalUpdated} stations`);
    } catch (err: any) {
      logger.error(`❌ MIGRATION: hasLogo migration failed: ${err.message}`);
    }
  });

  // === CRON JOBS ===
  const cron = await import('node-cron');

  cron.default.schedule('0 2 * * *', async () => {
    logger.log('📱 Scheduled TV/Mobile cache refresh (daily 2 AM)...');
    await warmupTvMobileCache();
  }, { timezone: 'Europe/Berlin' });
  logger.log('⏰ TV/Mobile cache auto-refresh scheduled: daily 2 AM (Europe/Berlin)');

  cron.default.schedule('*/5 * * * *', async () => {
    try {
      const start = Date.now();
      await PrecomputedGenresService.warmupCache();
      logger.log(`⏰ [Cron] Genres cache refreshed in ${Date.now() - start}ms`);
    } catch (error) { logger.error('[Cron] Genres cache refresh failed:', error); }
  });
  logger.log('⏰ Genres cache auto-refresh scheduled: every 5 minutes');

  cron.default.schedule('*/15 * * * *', async () => {
    try {
      const start = Date.now();
      const topCountries = [undefined, 'Turkey', 'Germany', 'United States', 'United Kingdom', 'France',
        'Spain', 'Italy', 'Netherlands', 'Austria', 'Switzerland', 'Brazil', 'Russia',
        'Japan', 'South Korea', 'India', 'Mexico', 'Canada', 'Australia', 'Poland'];
      await Promise.all(topCountries.map(country => refreshPopularStationsCache(country)));
      logger.log(`⏰ [Cron] Popular stations cache refreshed in ${Date.now() - start}ms (${topCountries.length} countries, parallel)`);
    } catch (error) { logger.error('[Cron] Popular stations cache refresh failed:', error); }
  });
  logger.log('⏰ Popular stations cache auto-refresh scheduled: every 15 minutes (parallel)');

  setImmediate(async () => {
    try {
      const start = Date.now();
      await PrecomputedGenresService.warmupCache();
      logger.log(`🔥 PrecomputedGenres startup warmup completed in ${Date.now() - start}ms`);
    } catch (error) { logger.error('PrecomputedGenres startup warmup failed:', error); }
  });

  // === SEO REDIRECT ===
  app.get('/stations', (_req, res) => res.redirect(301, '/radios'));

  // === LISTENING RECORD (not in any module file) ===
  app.post('/api/listening/record', requireAuth, async (req, res) => {
    try {
      const { stationId, stationName, listenDuration, country, genre } = req.body;
      const userId = (req.session as any)?.user?.userId;
      if (!userId || !stationId || !listenDuration || typeof listenDuration !== 'number') {
        return res.status(400).json({ error: 'Missing required fields' });
      }
      const listeningSession = new UserListeningHistory({
        sessionId: userId.toString(),
        stationId,
        stationName: stationName || 'Unknown',
        listenDuration: Math.max(1, Math.round(listenDuration)),
        country: country || 'Unknown',
        genre: genre || 'Unknown',
        interactionType: 'listen',
        listenedAt: new Date()
      });
      await listeningSession.save();
      res.json({ success: true, totalTime: listenDuration });
    } catch (error: any) {
      logger.error(`Error recording listening session: ${error.message}`);
      res.status(500).json({ error: 'Failed to record listening session' });
    }
  });

  // === INDEXNOW ROUTES ===
  app.use('/api/admin/indexnow', requireAdmin, indexnowMonitoringRouter);

  app.post('/api/admin/indexnow/submit', requireAdmin, async (req, res) => {
    try {
      const { urls } = req.body;
      if (!urls || !Array.isArray(urls) || urls.length === 0) {
        return res.status(400).json({ error: 'URLs array is required' });
      }
      logger.log(`📡 IndexNow: Admin submitting ${urls.length} URLs`);
      const result = await IndexNowService.submitToIndexNow(urls);
      if (result.success) {
        res.json({ success: true, message: result.message, urlsSubmitted: urls.length });
      } else {
        res.status(500).json({ success: false, error: result.error });
      }
    } catch (error: any) {
      logger.log('❌ IndexNow admin endpoint error:', error);
      res.status(500).json({ error: 'Failed to submit URLs to IndexNow' });
    }
  });

  // === SPECIAL ROUTERS (registered before module routes) ===
  app.use('/api/user-engagement', userEngagementRouter);
  app.use('/api/api-keys', apiKeysRouter);
  seedDemoApiKey();
  app.use('/api', apiKeyMiddleware);
  app.use('/api/admin/url-translations', urlTranslationsRouter);
  app.use('/api/admin/performance', performanceRouter);
  registerCountryLanguageMappingRoutes(app, requireAdmin);

  // === REGISTER ALL ROUTE MODULES ===
  registerCacheDashboardRoutes(app, deps);
  registerAdminAuthRoutes(app, deps);
  registerSlugRoutes(app, deps);
  await registerAiDescriptionRoutes(app, deps);
  registerLogoRoutes(app, deps);
  registerAdminStationRoutes(app, deps);
  registerPublicStationRoutes(app, deps);
  registerGenresCountriesRoutes(app, deps);
  registerTranslationAdminRoutes(app, deps);
  registerUserAuthRoutes(app, deps);
  registerMobileTvRoutes(app, deps);
  await registerTranslationKeyRoutes(app, deps);
  await registerSeoSitemapRoutes(app, deps);
  registerStreamProxyRoutes(app, deps);
  registerRegionsRecommendationsRoutes(app, deps);
  registerMiscRoutes(app, deps);
  registerMessagesRoutes(app, deps);

  // === RETURN SERVER WITH WEBSOCKET REFERENCES ===
  const result = server as Server & { metadataWss: InstanceType<typeof WebSocketServer>, castWss: InstanceType<typeof WebSocketServer> };
  result.metadataWss = wss;
  result.castWss = castWss;
  return result;
}
