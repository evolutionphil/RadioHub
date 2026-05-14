import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from 'ws';
import crypto from 'crypto';
import mongoose from 'mongoose';
import passport from './auth/passport-config';
import { TranslationLanguage, Station, Genre, VisitorSession, UserListeningHistory } from '@workspace/db-shared/mongo-schemas';
import { registerCountryLanguageMappingRoutes } from './routes/country-language-mappings';
import urlTranslationsRouter from './routes/url-translations';
import performanceRouter from './routes/performance';
import apiKeysRouter, { apiKeyMiddleware, seedDemoApiKey } from './routes/api-keys';
import { userEngagementRouter } from './routes/user-engagement';
import indexnowMonitoringRouter from './routes/indexnow-monitoring';
import gscInspectionRouter from './routes/gsc-inspection';
import { IndexNowService } from './services/indexnow';
import { COUNTRY_TO_LANGUAGE, CODE_TO_COUNTRY } from '@workspace/seo-shared/seo-config';
import CacheManager, { CacheKeys, invalidateSocialCacheForUser } from './cache';
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
import { getSocialAuthStatus } from './auth/social-auth-simple';
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
import { registerTranslationKeyRoutes, seedSeoTranslationKeys } from './routes/translation-keys-routes';
import { seedSearchPageTranslations } from './seo/search-page-translations-seed';
import { registerSeoSitemapRoutes } from './routes/seo-sitemap-routes';
import { registerStreamProxyRoutes } from './routes/stream-proxy-routes';
import { registerRegionsRecommendationsRoutes } from './routes/regions-recommendations-routes';
import { registerMiscRoutes } from './routes/misc-routes';
import { registerIapValidationRoutes } from './routes/iap-validation-routes';
import { registerAdminIapRoutes } from './routes/admin-iap-routes';
import { registerAppleWebhookRoutes } from './routes/iap-apple-webhook';
import { registerAdminMaintenanceRoutes } from './routes/admin-maintenance-routes';
import { registerAdminPreferencesRoutes } from './routes/admin-preferences-routes';
import { registerAdminCoverageDropSettingsRoutes } from './routes/admin-coverage-drop-settings-routes';
import { registerAdminMappingAuditDigestSettingsRoutes } from './routes/admin-mapping-audit-digest-settings-routes';
import { registerAdminGenreWhitelistRoutes } from './routes/admin-genre-whitelist-routes';
import { startGenreWhitelistRefreshLoop } from './seo/genre-whitelist-store';
import { registerSilentPushRoutes } from './routes/silent-push-routes';
import { registerMessagesRoutes } from './routes/messages-routes';

function stripPlaceholders<T>(obj: T): T {
  if (!obj || typeof obj !== 'object') return obj;
  const placeholderRegex = /^\[(TRANSLATED\s+)?(META|FULL\s+DESCRIPTION|SEO\s+META|FULL|SEO)[^\]]*\]\s*/i;
  const result: any = Array.isArray(obj) ? [] : {};
  for (const [key, val] of Object.entries(obj as any)) {
    if (typeof val === 'string') {
      result[key] = val.replace(placeholderRegex, '');
    } else if (val && typeof val === 'object') {
      result[key] = stripPlaceholders(val);
    } else {
      result[key] = val;
    }
  }
  return result;
}

const deps = {
  requireAuth,
  requireAdmin,
  generateAuthToken,
  apiKeyMiddleware,
  seedDemoApiKey,
  passport,
  getSocialAuthStatus,
  invalidateSocialCacheForUser,
  stripPlaceholders,
};

export interface RegisterRoutesOptions {
  mode?: 'full' | 'api-only';
}

export async function registerRoutes(app: Express, options?: RegisterRoutesOptions): Promise<Server & { metadataWss: InstanceType<typeof WebSocketServer>, castWss: InstanceType<typeof WebSocketServer>, chatWss: InstanceType<typeof WebSocketServer> }> {
  const isApiOnly = options?.mode === 'api-only';
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
    if (req.method === 'OPTIONS') return void res.status(200).end();
    next();
  });

  // === WEBSOCKET SERVERS ===
  const { getStreamMetadataService } = await import('./services/stream-metadata');
  const streamMetadataService = getStreamMetadataService();
  const realtimeMetadataService = new RealtimeMetadataService();
  // 64KB payload cap — prevents WS abuse (default is ~100MB per message).
  // Metadata frames are tiny (<2KB), so 64KB is generous.
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: 64 * 1024 });

  wss.on('connection', (socket: WebSocket, request) => {
    try {
      const clientId = `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      logger.log(`🎵 REALTIME METADATA: WebSocket client connected via ${request.url}`);
      realtimeMetadataService.addClient(clientId, socket);
    } catch (e: any) {
      // Never let a malformed WS upgrade crash the process via fail-fast
      console.error('⚠️ WS metadata connection handler error (caught):', e?.message || e);
      try { socket.close(1011, 'internal error'); } catch {}
    }
  });

  const castWss = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: 64 * 1024 });
  logger.log(`📺 CAST: WebSocket server ready at /ws/cast`);

  const chatWss = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: 256 * 1024 });
  logger.log(`💬 CHAT: WebSocket server ready at /ws/chat`);

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
      return void res.status(404).type('text/plain').send('Not Found');
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
  // Skip on non-DB hot paths (stream/image proxy, health, sitemap/robots) and
  // when MongoDB is not connected — otherwise every stream request queues a
  // write into a disconnected Mongoose buffer and inflates memory.
  const VISITOR_SKIP_PREFIXES = [
    '/api/stream', '/api/image-proxy', '/api/og-image',
    '/health', '/healthz', '/api/health',
    '/sitemap', '/robots.txt'
  ];
  app.use((req, _res, next) => {
    if (!((req.path.startsWith('/api/') || req.path === '/' || !req.path.includes('.')))) return next();
    if (VISITOR_SKIP_PREFIXES.some(p => req.path.startsWith(p))) return next();
    if (mongoose.connection.readyState !== 1) return next();
    const ipAddress = req.ip || req.connection.remoteAddress || 'unknown';
    VisitorSession.findOneAndUpdate(
      { ipAddress },
      { $set: { lastActiveDate: new Date(), userAgent: req.get('user-agent') }, $inc: { visitCount: 1 } },
      { upsert: true, returnDocument: 'after' }
    ).catch(() => {});
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
      await Station.collection.createIndex({ lastCheckOk: 1, isFeatured: 1, votes: -1, clickCount: -1 });
      await Station.collection.createIndex({ lastCheckOk: 1, country: 1, isFeatured: 1, votes: -1, clickCount: -1 });
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
      // Task #339: drop the legacy SitemapUrlSnapshot {type,language} unique
      // index so the new composite {type,language,chunk} index (created by
      // mongoose autoIndex) can coexist without colliding for 'stations'
      // rows that share (type, language) but differ by chunk.
      try {
        const { SitemapUrlSnapshot } = await import('@workspace/db-shared/mongo-schemas');
        await SitemapUrlSnapshot.collection.dropIndex('type_1_language_1');
        logger.log('✅ Dropped legacy SitemapUrlSnapshot.{type,language} unique index');
      } catch (err: any) {
        // IndexNotFound (code 27 / "ns not found") is the steady-state happy
        // path: the legacy index has already been dropped (or the collection
        // doesn't exist yet on a fresh deploy). Anything else is unexpected
        // and means stations rows could fail to upsert under the old unique
        // constraint — surface it loudly so it's visible in boot logs.
        const code = err?.code;
        const msg = err?.message ?? String(err);
        if (code === 27 || /index not found/i.test(msg) || /ns not found/i.test(msg)) {
          logger.log('ℹ️ SitemapUrlSnapshot.{type,language} legacy index already absent — nothing to drop');
        } else {
          logger.warn(`⚠️ Failed to drop legacy SitemapUrlSnapshot.{type,language} unique index (code=${code}): ${msg} — per-chunk station snapshot upserts may collide`);
        }
      }
      // Belt-and-braces: ensure the new composite unique index is present
      // even if mongoose autoIndex is off in this environment, so the
      // nightly sitemap-diff stations branch can rely on it.
      try {
        const { SitemapUrlSnapshot } = await import('@workspace/db-shared/mongo-schemas');
        await SitemapUrlSnapshot.collection.createIndex(
          { type: 1, language: 1, chunk: 1 },
          { unique: true, name: 'type_1_language_1_chunk_1' },
        );
      } catch (err: any) {
        logger.warn(`⚠️ Failed to ensure SitemapUrlSnapshot composite unique index: ${err?.message ?? err}`);
      }
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
        await new Promise(r => setTimeout(r, 50));
      }
      logger.log(`✅ Cached ${cachedCount}/${orderedLanguages.length} language translations`);

      const countriesWithSeoTranslations = Object.entries(COUNTRY_TO_LANGUAGE)
        .filter(([, lang]) => lang !== 'en')
        .map(([code]) => (CODE_TO_COUNTRY as any)[code])
        .filter(Boolean);
      logger.log(`📍 Found ${countriesWithSeoTranslations.length} countries with SEO translations for cache warmup`);

      const popularEnglishCountries = [
        'The United States Of America', 'The United Kingdom Of Great Britain And Northern Ireland',
        'Canada', 'Australia', 'India', 'South Africa', 'Ireland', 'New Zealand',
        'Mexico', 'Argentina', 'Colombia', 'Japan', 'South Korea', 'Indonesia',
        'Philippines', 'Thailand', 'Malaysia', 'Egypt', 'Nigeria', 'Kenya',
        'Saudi Arabia', 'The United Arab Emirates', 'Israel', 'Pakistan'
      ];
      const warmupSet = new Set(['all', ...countriesWithSeoTranslations, ...popularEnglishCountries]);
      const countriesToWarmup = Array.from(warmupSet);
      logger.log(`📍 Total countries for popular stations warmup: ${countriesToWarmup.length} (${countriesWithSeoTranslations.length} SEO + ${popularEnglishCountries.length} popular EN)`);
      for (const country of countriesToWarmup) {
        try {
          await refreshPopularStationsCache(country === 'all' ? undefined : country);
          await refreshCommunityFavoritesCache(country === 'all' ? undefined : country);
        } catch {}
        await new Promise(r => setTimeout(r, 100));
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
        await new Promise(r => setTimeout(r, 50));
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
        await new Promise(r => setTimeout(r, 200));
      }

      logger.log(`📱 TV/Mobile cache warmup completed: ${topCountries.length} countries, ${tvLangs.length} languages (24h TTL)`);
    } catch (error) {
      logger.log('⚠️ TV/Mobile cache warmup failed (non-critical):', error);
    }
  }

  // === HTTP SELF-WARMUP (INCIDENT 2026-05-14) ===
  // The previous warmup wrote cache keys with the OLD shape
  // (e.g. `popular_stations:Germany:all:20`) while the routes now read the
  // v2 shape (`popular_stations:Germany:all:12:false:web:v2`). That key
  // drift made every first user hit a Cache MISS and incurred 8-30s
  // Mongo aggregates against the live cluster.
  //
  // Rather than chase every key shape from the warmup helpers, this
  // self-warmup hits the *real* HTTP endpoints the browser hits, so the
  // cache keys are guaranteed to match by construction. It runs after
  // server startup and re-runs every 50 minutes (just under the 1h TTL)
  // so users never face a cold cache.
  async function warmupViaHttp() {
    const PORT = process.env.PORT || '8080';
    const base = `http://127.0.0.1:${PORT}`;
    const TOP_COUNTRIES = [
      'Germany', 'Turkey', 'The United States Of America',
      'The United Kingdom Of Great Britain And Northern Ireland',
      'France', 'Spain', 'Italy', 'Netherlands', 'Austria',
      'Switzerland', 'Brazil', 'Russia', 'Japan', 'South Korea',
      'India', 'Mexico', 'Canada', 'Australia', 'Poland',
      'South Africa', 'Argentina', 'Colombia', 'Indonesia',
      'Philippines', 'Egypt'
    ];
    const startAll = Date.now();
    let okCount = 0, failCount = 0;

    const hit = async (path: string) => {
      const t0 = Date.now();
      try {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 60000);
        const r = await fetch(base + path, { signal: ctrl.signal, headers: { 'x-warmup': '1' } });
        clearTimeout(to);
        if (r.ok) { okCount++; logger.log(`🔥 [warmup] ${path} ${r.status} ${Date.now() - t0}ms`); }
        else { failCount++; logger.warn(`🔥 [warmup] ${path} ${r.status} ${Date.now() - t0}ms`); }
      } catch (e: any) {
        failCount++;
        logger.warn(`🔥 [warmup] ${path} ERR ${Date.now() - t0}ms ${e?.message || ''}`);
      }
    };

    // INCIDENT 2026-05-14 round 6: previously this looped 25 countries
    // x 8 endpoints sequentially and was itself hammering the cluster
    // (community-favorites + recommendations/diverse country variants
    // run heavy aggregates with no cache and timed out every cycle,
    // re-firing 50 min later). Now that all boot endpoints cache 24h
    // and per-route caches hold 1h+, real user traffic keeps top-
    // country keys hot. Warm only the GLOBAL boot keys + light top-3
    // popular/precomputed.
    await hit('/api/filters/countries');
    await hit('/api/filters/languages');
    await hit('/api/filters/genres');
    await hit('/api/countries');
    await hit('/api/countries?format=rich');
    await hit('/api/genres');
    await hit('/api/stations/popular?limit=12');
    await hit('/api/stations/popular?limit=4');
    await hit('/api/stations/precomputed?countryName=global&page=1&limit=200');

    const TOP3 = ['Germany', 'Turkey', 'The United States Of America'];
    for (const country of TOP3) {
      const enc = encodeURIComponent(country);
      await hit(`/api/stations/popular?country=${enc}&limit=12`);
      await hit(`/api/stations/precomputed?countryName=${enc}&page=1&limit=50`);
      await new Promise(r => setTimeout(r, 1500));
    }

    logger.log(`🔥 HTTP self-warmup done in ${Date.now() - startAll}ms (ok=${okCount} fail=${failCount})`);
  }

  if (process.env.NODE_ENV !== 'development') {
    setTimeout(async () => {
      try {
        // Run HTTP self-warmup FIRST so the cache keys actual users hit
        // get hot before we spend minutes on translations/TV/legacy keys.
        logger.log('⚡ Starting HTTP self-warmup (user-facing keys first)...');
        await warmupViaHttp();
        logger.log('✅ HTTP self-warmup done — running legacy warmups in background...');
        await warmupPopularStationsCache();
        logger.log('⏳ Legacy web warmup done — waiting 10s before TV/Mobile warmup...');
        await new Promise(r => setTimeout(r, 10000));
        await warmupTvMobileCache();
        logger.log('✅ All cache warmups completed successfully');
      } catch (err) {
        logger.log('⚠️ Cache warmup error (non-critical):', err);
      }
    }, 5000);

    // Refresh self-warmup every 50 minutes so cached entries (1h TTL)
    // never expire under live traffic.
    setInterval(() => {
      warmupViaHttp().catch(err => logger.warn('⚠️ Periodic self-warmup failed: ' + err?.message));
    }, 50 * 60 * 1000);
  } else {
    logger.log('⚡ Popular stations & TV/Mobile cache warmup: Skipped in dev mode');
  }

  // === HALOGO MIGRATION (one-time background, production only) ===
  if (process.env.NODE_ENV !== 'development') setTimeout(async () => {
    try {
      const migrationKey = 'migration:hasLogo:v1';
      const alreadyDone = await CacheManager.get(migrationKey);
      if (alreadyDone) return;
      logger.log('🔧 MIGRATION: Populating hasLogo field for all stations...');
      const BATCH = 2000;
      let skip = 0, totalUpdated = 0;
      while (true) {
        const stations = await Station.find({}, { _id: 1, favicon: 1, logo: 1, 'logoAssets.webp256': 1, 'logoAssets.webp96': 1 })
          .skip(skip).limit(BATCH).lean();
        if (stations.length === 0) break;
        const ops = stations.map((s: any) => ({
          updateOne: { filter: { _id: s._id }, update: { $set: { hasLogo: !!(s.logoAssets?.webp256 || s.logoAssets?.webp96 || s.favicon || s.logo) } } }
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
  }, 30000);

  // === CRON JOBS ===
  const cron = await import('node-cron');

  cron.default.schedule('0 2 */2 * *', async () => {
    logger.log('📱 Scheduled TV/Mobile cache refresh (every 2 days at 2:00 AM)...');
    await warmupTvMobileCache();
  }, { timezone: 'Europe/Berlin' });
  logger.log('⏰ TV/Mobile cache refresh scheduled: every 2 days at 2:00 AM (Europe/Berlin)');

  // Genres cache: refresh every 5 minutes (NOT immediate - startup warmup handles initial load)
  // Using a flag to skip the first fire if startup warmup already ran
  let genresWarmupDone = false;
  if (process.env.NODE_ENV !== 'development') {
    setTimeout(async () => {
      try {
        const start = Date.now();
        await PrecomputedGenresService.warmupCache();
        genresWarmupDone = true;
        logger.log(`🔥 PrecomputedGenres startup warmup completed in ${Date.now() - start}ms`);
      } catch (error) { logger.error('PrecomputedGenres startup warmup failed:', error); }
    }, 15000);
  } else {
    genresWarmupDone = true;
    logger.log('⚡ Genres cache warmup: Skipped in dev mode');
  }

  cron.default.schedule('0 5 * * *', async () => {
    try {
      const start = Date.now();
      await PrecomputedGenresService.warmupCache();
      logger.log(`⏰ [Cron] Genres cache refreshed in ${Date.now() - start}ms`);
    } catch (error) { logger.error('[Cron] Genres cache refresh failed:', error); }
  }, { timezone: 'Europe/Berlin' });
  logger.log('⏰ Genres cache refresh scheduled: daily 5:00 AM (on-demand for first request)');

  cron.default.schedule('30 6 * * *', async () => {
    try {
      const start = Date.now();
      const topCountries: (string | undefined)[] = [undefined, 'Turkey', 'Germany',
        'The United States Of America', 'The United Kingdom Of Great Britain And Northern Ireland',
        'France', 'Spain', 'Italy', 'Netherlands', 'Austria', 'Switzerland',
        'Brazil', 'Russia', 'Japan', 'South Korea', 'India', 'Mexico', 'Canada', 'Australia', 'Poland',
        'South Africa', 'Ireland', 'New Zealand', 'Argentina', 'Colombia',
        'Indonesia', 'Philippines', 'Thailand', 'Malaysia', 'Egypt', 'Nigeria', 'Kenya',
        'Saudi Arabia', 'The United Arab Emirates', 'Israel', 'Pakistan'];
      for (const country of topCountries) {
        try { await refreshPopularStationsCache(country); } catch {}
        await new Promise(r => setTimeout(r, 500));
      }
      logger.log(`⏰ [Cron] Popular stations cache refreshed in ${Date.now() - start}ms (${topCountries.length} countries, sequential)`);
    } catch (error) { logger.error('[Cron] Popular stations cache refresh failed:', error); }
  }, { timezone: 'Europe/Berlin' });
  logger.log('⏰ Popular stations cache refresh scheduled: daily 6:30 AM (on-demand for first request)');

  // NOTE: bare /stations is handled by url-redirect-middleware which
  // 301-redirects directly to /{lang}/{translated} in a single hop.
  // The previous /stations → /radios route here caused a redirect chain
  // (/stations → /radios → /en/radios) that hurt Google crawl efficiency.

  // === LISTENING RECORD (not in any module file) ===
  app.post('/api/listening/record', requireAuth, async (req, res) => {
    try {
      const { stationId, stationName, listenDuration, country, genre } = req.body;
      const userId = (req.session as any)?.user?.userId;
      if (!userId || !stationId || !listenDuration || typeof listenDuration !== 'number') {
        return void res.status(400).json({ error: 'Missing required fields' });
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

  // === GSC URL INSPECTION ROUTES (task #191) ===
  // Surfaces cached Google Search Console URL Inspection results so admins
  // can see, without leaving the app, which sitemap URLs Google has actually
  // indexed vs. left in "Discovered – currently not indexed".
  app.use('/api/admin/gsc-inspection', requireAdmin, gscInspectionRouter);

  app.post('/api/admin/indexnow/submit', requireAdmin, async (req, res) => {
    try {
      const { urls } = req.body;
      if (!urls || !Array.isArray(urls) || urls.length === 0) {
        return void res.status(400).json({ error: 'URLs array is required' });
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

  app.get("/api/translations/:lang/critical", async (req, res) => {
    const lang = req.params.lang;
    if (!lang || lang.length > 10) {
      return void res.status(400).json({ error: 'Invalid language code' });
    }

    try {
      const cacheKey = `translations_critical_${lang}`;
      const cached = await CacheManager.get<Record<string, string>>(cacheKey);
      if (cached) {
        res.setHeader('Cache-Control', 'public, max-age=300');
        return void res.json(cached);
      }

      const fullTranslations = await fetchTranslationsForLanguage(lang);
      const criticalKeys = [
        'home_hero_title', 'home_hero_subtitle', 'nav_home', 'nav_genres', 'nav_regions',
        'nav_favorites', 'nav_trending', 'nav_about', 'nav_contact', 'search_placeholder',
        'play', 'pause', 'stop', 'loading', 'error', 'retry', 'close', 'menu', 'back',
        'popular_stations', 'nearby_stations', 'all_stations', 'no_stations_found',
        'country', 'language', 'genre', 'listen_now', 'live', 'share', 'favorite',
        'unfavorite', 'login', 'signup', 'logout', 'profile', 'settings',
        'auth_username_label', 'auth_password_label', 'auth_email_label',
        'footer_about', 'footer_contact', 'footer_privacy', 'footer_terms',
        'mood_selector', 'seo_from', 'seo_listen_live_online', 'seo_description',
        'station_info', 'station_country', 'station_language', 'station_genre',
        'station_bitrate', 'station_codec', 'station_votes',
        'discover_by_genre', 'discover_by_country', 'trending_now',
        'cookie_consent_message', 'cookie_accept', 'cookie_decline'
      ];
      const critical: Record<string, string> = {};
      for (const key of criticalKeys) {
        if (fullTranslations[key]) critical[key] = fullTranslations[key];
      }
      await CacheManager.set(cacheKey, critical, { ttl: 7200, useRedis: true });
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.json(critical);
    } catch (error) {
      logger.error(`Error fetching critical translations for ${lang}:`, error);
      res.status(500).json({ error: 'Failed to fetch critical translations' });
    }
  });

  app.get("/api/translations/:lang", async (req, res) => {
    const lang = req.params.lang;
    if (!lang || lang.length > 10) {
      return void res.status(400).json({ error: 'Invalid language code' });
    }

    try {
      const cacheKey = CacheKeys.translations(lang);
      const cached = await CacheManager.get<Record<string, string>>(cacheKey);
      if (cached) {
        res.setHeader('Cache-Control', 'public, max-age=300');
        return void res.json(cached);
      }

      const translations = await fetchTranslationsForLanguage(lang);
      await CacheManager.set(cacheKey, translations, { ttl: 7200, useRedis: true });
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.json(translations);
    } catch (error) {
      logger.error(`Error fetching translations for ${lang}:`, error);
      res.status(500).json({ error: 'Failed to fetch translations' });
    }
  });

  // === SPECIAL ROUTERS (registered before module routes) ===
  app.use('/api/user-engagement', userEngagementRouter);
  app.use('/api/api-keys', apiKeysRouter);
  seedDemoApiKey();
  seedSeoTranslationKeys();
  // Backfill in-page search_* translations for every SEO_LANGUAGES code.
  // Guarded by tests/search-translations-db-coverage.test.ts (task #298).
  void seedSearchPageTranslations();
  app.use('/api', apiKeyMiddleware);
  app.use('/api/admin/url-translations', urlTranslationsRouter);
  // Admin-only — performance routes include destructive ops (rebuild_indexes,
  // cache clear) plus expensive Cloudflare GraphQL fetches.
  app.use('/api/admin/performance', requireAdmin, performanceRouter);
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
  await registerSeoSitemapRoutes(app, deps, { apiOnly: isApiOnly });
  if (process.env.ENABLE_EMBEDDED_PROXY === 'true' || process.env.NODE_ENV !== 'production') {
    registerStreamProxyRoutes(app, deps);
    console.log('🔌 Stream proxy routes registered (embedded mode)');
  } else {
    console.log('🚫 Stream proxy routes DISABLED — use stream.themegaradio.com');
  }
  registerRegionsRecommendationsRoutes(app, deps);
  registerMiscRoutes(app, deps, { apiOnly: isApiOnly });
  registerIapValidationRoutes(app);
  registerAdminIapRoutes(app, deps);
  registerAppleWebhookRoutes(app);
  registerAdminMaintenanceRoutes(app, deps);
  registerAdminPreferencesRoutes(app, deps);
  registerAdminCoverageDropSettingsRoutes(app, deps);
  registerAdminMappingAuditDigestSettingsRoutes(app, deps);
  registerAdminGenreWhitelistRoutes(app, deps);
  // Task #114: prime the merged whitelist snapshot from Mongo and refresh
  // it periodically so admin overrides made on other replicas propagate.
  startGenreWhitelistRefreshLoop();
  registerSilentPushRoutes(app, deps);
  registerMessagesRoutes(app, chatWss, deps);

  // === RETURN SERVER WITH WEBSOCKET REFERENCES ===
  const result = server as Server & { metadataWss: InstanceType<typeof WebSocketServer>, castWss: InstanceType<typeof WebSocketServer>, chatWss: InstanceType<typeof WebSocketServer> };
  result.metadataWss = wss;
  result.castWss = castWss;
  result.chatWss = chatWss;
  return result;
}
