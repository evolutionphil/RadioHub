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

  // === ADMIN INDEX PROBE ===
  // INCIDENT 2026-05-15 v10 — quick way to see which Station indexes are
  // present + visible on Atlas. The May 14 audit hid 17 indexes; hinting
  // a hidden index throws BadValue and silently 500s public endpoints.
  // Use: GET /api/admin/db/indexes  (admin-only)
  // Returns: [{ name, key, hidden, accesses: { ops, since } }, ...]
  app.get('/api/admin/db/indexes', requireAdmin, async (_req, res) => {
    try {
      if (mongoose.connection.readyState !== 1) {
        return void res.status(503).json({ error: 'Mongo not connected' });
      }
      const [indexes, stats] = await Promise.all([
        Station.collection.indexes(),
        Station.collection.aggregate([{ $indexStats: {} }]).toArray()
      ]);
      const statsByName = new Map(stats.map((s: any) => [s.name, s]));
      const merged = indexes.map((idx: any) => {
        const s: any = statsByName.get(idx.name);
        return {
          name: idx.name,
          key: idx.key,
          hidden: idx.hidden === true,
          accesses: s?.accesses || null,
          host: s?.host || null
        };
      });
      const hiddenCount = merged.filter(i => i.hidden).length;
      res.json({ collection: 'stations', total: merged.length, hidden: hiddenCount, indexes: merged });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'index probe failed' });
    }
  });

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
      // INCIDENT 2026-05-15 v7 — two indexes added to eliminate the
      // 60s "Executor error during getMore" timeouts on
      // /api/stations/precomputed cold-fallback and PrecomputedStations
      // computeCountryStationsByName. Both queries sort by
      // {hasLogo:-1, votes:-1} which previously had NO supporting index
      // → MongoDB executed an in-memory sort over 200k+ docs and hit the
      // 32MB sort memory limit. With these compound indexes the planner
      // can stream results pre-sorted (no SORT stage) and budget falls
      // from 60s+ to <500ms typical, even on M10 cold start.
      await Station.collection.createIndex(
        { lastCheckOk: 1, hasLogo: -1, votes: -1 },
        { background: true, name: 'lastCheckOk_1_hasLogo_-1_votes_-1' },
      );
      await Station.collection.createIndex(
        { country: 1, lastCheckOk: 1, hasLogo: -1, votes: -1 },
        { background: true, name: 'country_1_lastCheckOk_1_hasLogo_-1_votes_-1' },
      );
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

      // 2026-05-15 INCIDENT: PrecomputedCitiesService.warmupCache() runs a
      // heavy $facet/$switch aggregation per country sequentially for 19
      // countries. At boot, when Atlas is already stressed by HTTP self-
      // warmup + popular/community refresh, this hammer pushed the
      // connection pool to exhaustion — every country errored with
      // MongoNetworkTimeoutError or MaxTimeMSExpired (16+ failures in a
      // row in the 2026-05-15 prod log), tripped the circuit breaker, and
      // forced a container restart loop. The cities cache has a 7-day
      // TTL and `getCitiesForCountry()` lazily computes on cache miss, so
      // the first organic request to each country page populates it just
      // fine. Skipping the boot warmup costs the very first visitor of
      // each country one slower page load and protects the cluster.
      logger.log('⚡ SKIPPED: PrecomputedCities boot warmup — will populate on-demand per country (7-day TTL)');

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
    // INCIDENT 2026-05-14 round 8: previous warmup ran the full 25-country
    // loop even when every single request was timing out at 60s — during
    // the Atlas failover this kept the connection pool slammed for 10+
    // minutes. Now we abort the rest of the warmup if 3 hits in a row
    // fail, AND we cap each hit at 10s instead of 60s so a stressed
    // cluster doesn't tie up sockets for a minute apiece.
    let consecutiveFails = 0;
    let aborted = false;

    const hit = async (path: string) => {
      if (aborted) return;
      const t0 = Date.now();
      try {
        const ctrl = new AbortController();
        // INCIDENT 2026-05-15 v7 — bump client abort 10s→35s. The previous
        // 10s budget was SHORTER than every server-side maxTimeMS on the
        // warmed endpoints (12-60s), so cluster-cold aggregations were
        // routinely client-aborted while STILL RUNNING server-side, leaving
        // orphan operations that held connections + planner slots for the
        // remainder of their server budget. With 35s the client waits for
        // the server to either finish or self-terminate via maxTimeMS, so
        // the "abort + orphan" race goes away. The 3-consecutive-fail
        // circuit breaker still protects against a truly dead cluster.
        const to = setTimeout(() => ctrl.abort(), 35000);
        const r = await fetch(base + path, { signal: ctrl.signal, headers: { 'x-warmup': '1' } });
        clearTimeout(to);
        if (r.ok) {
          okCount++;
          consecutiveFails = 0;
          logger.log(`🔥 [warmup] ${path} ${r.status} ${Date.now() - t0}ms`);
        } else {
          failCount++;
          consecutiveFails++;
          logger.warn(`🔥 [warmup] ${path} ${r.status} ${Date.now() - t0}ms`);
        }
      } catch (e: any) {
        failCount++;
        consecutiveFails++;
        logger.warn(`🔥 [warmup] ${path} ERR ${Date.now() - t0}ms ${e?.message || ''}`);
      }
      if (consecutiveFails >= 3 && !aborted) {
        aborted = true;
        logger.warn(`🔥 [warmup] aborting remaining hits after 3 consecutive failures (cluster appears unhealthy — real traffic will warm cache organically)`);
      }
    };

    // INCIDENT 2026-05-14 round 7: per user request, run a slow
    // sequential warmup. Phase 1 (immediate, ~10-15s): all GLOBAL
    // boot keys so the site shell is responsive instantly. Phase 2
    // (background, sequential, one country at a time with a generous
    // gap): fill the per-country caches for the top 25 countries
    // using ONLY the safe/cached endpoints — popular + precomputed.
    // Heavy/uncached endpoints (community-favorites country variant,
    // recommendations/diverse country variant, /api/genres country
    // aggregate) are NOT included because they always time out and
    // emit error logs without writing a cache entry; real user
    // traffic fills those naturally.

    // === Phase 1: global boot keys (fast, every user needs these) ===
    // INCIDENT 2026-05-15 v7 — DROPPED from boot warmup:
    //   • /api/filters/languages — Station.aggregate $group by language
    //     over the full collection (~250k docs); cache TTL is already
    //     24h so the very first organic visitor warms it once and every
    //     subsequent request is a Redis hit. Boot warmup brought no
    //     value AND was the first hit to fail in the 17:42 incident,
    //     blocking the rest of phase 1 on the 3-consecutive-fail
    //     breaker.
    //   • /api/stations/precomputed?countryName=global&page=1&limit=200
    //     — this routes to the cold-fallback Station.find().sort()
    //     branch with a 200-doc page and 60s server budget, the heaviest
    //     single query in the warmup. With the new
    //     {lastCheckOk:1, hasLogo:-1, votes:-1} index it is fast enough
    //     for organic traffic to populate on first hit; we no longer
    //     pay 60s of cluster CPU at boot just to mirror what the
    //     PrecomputedStationsService.warmupPopularCountries() background
    //     job already builds in the global-cache path.
    await hit('/api/filters/countries');
    await hit('/api/filters/genres');
    await hit('/api/countries');
    await hit('/api/countries?format=rich');
    await hit('/api/genres');
    await hit('/api/stations/popular?limit=12');
    await hit('/api/stations/popular?limit=4');
    logger.log(`🔥 [warmup] phase 1 (global boot keys) done in ${Date.now() - startAll}ms`);

    // === Phase 2: top 25 countries, one at a time, slow ===
    // Only popular + precomputed (both cached, both indexed). 4 hits
    // per country, 3s gap between countries → ~25 countries × ~5s =
    // ~2 min steady drip. The site is fully usable from phase 1
    // already; this just pre-warms the per-country leaderboards.
    for (const country of TOP_COUNTRIES) {
      const enc = encodeURIComponent(country);
      const tStart = Date.now();
      await hit(`/api/stations/popular?country=${enc}&limit=12`);
      await hit(`/api/stations/popular?country=${enc}&limit=4`);
      await hit(`/api/stations/precomputed?countryName=${enc}&page=1&limit=50`);
      await hit(`/api/stations/precomputed?countryName=${enc}&page=1&limit=12`);
      logger.log(`🔥 [warmup] ${country} done in ${Date.now() - tStart}ms (ok=${okCount} fail=${failCount})`);
      // Generous gap so the cluster planner / connection pool can
      // recover before the next country.
      await new Promise(r => setTimeout(r, 3000));
    }

    logger.log(`🔥 HTTP self-warmup done in ${Date.now() - startAll}ms (ok=${okCount} fail=${failCount})`);
  }

  // INCIDENT 2026-05-15 v10 — BOOT WARMUP REMOVED per user directive
  // ("ilk gelenler olmaya baslayinca yapsin" / "fill caches when first
  // visitors arrive, not at boot"). All previous warmup paths
  // (warmupViaHttp, warmupPopularStationsCache, warmupTvMobileCache,
  // PrecomputedStations.warmupPopularCountries, PrecomputedGenres
  // boot warmup) hammered the cluster during cold-start and were the
  // root cause of the recurring multiplanner-timeout / pool-exhaustion
  // / 500 cascade. Caches are filled lazily by the first organic
  // visitor via CacheManager.getOrSetSingleFlight (single-flight
  // coalescing prevents stampedes). Off-peak cron refreshes still run.
  if (process.env.NODE_ENV !== 'development') {
    // Lightweight Mongo health probe ONLY — one cheap indexed read so
    // we know the cluster is reachable. No warmup work.
    setTimeout(async () => {
      try {
        const t0 = Date.now();
        await Station.findOne({ lastCheckOk: true })
          .select('_id')
          .lean()
          .maxTimeMS(5000);
        logger.log(`✅ Boot Mongo probe ok (${Date.now() - t0}ms) — caches will fill on first organic request`);
      } catch (err: any) {
        logger.warn('⚠️ Boot Mongo probe failed (cluster cold or unreachable): ' + (err?.message || 'unknown'));
      }
    }, 5000);

    // Reference the unused warmup helpers so esbuild keeps them around
    // for the cron jobs below that still call them on a schedule. The
    // helpers themselves are safe-by-design (per-call try/catch); we
    // just no longer fire them at boot.
    void warmupViaHttp; void warmupPopularStationsCache; void warmupTvMobileCache;

    // Legacy comment retained for context (original v7 code stripped):
    // The GLOBAL PrecomputedStations cache used to be populated at boot.
    // It is now populated by the first organic visitor to the global
    // stations page or by the off-peak cron refresh below. The
    // singleflight wrapper around the precomputed service guarantees
    // exactly one compute pass even under concurrent SSR misses.
  } else {
    logger.log('⚡ Boot warmup skipped (dev mode) — caches fill on demand');
  }

  // === HALOGO MIGRATION (one-time background, production only) ===
  if (process.env.NODE_ENV !== 'development') setTimeout(async () => {
    try {
      const migrationKey = 'migration:hasLogo:v1';
      const alreadyDone = await CacheManager.get(migrationKey);
      if (alreadyDone) return;
      // INCIDENT 2026-05-14 round 8: migration emitted `❌ MIGRATION:
      // hasLogo migration failed: not primary` during the Atlas failover
      // because it tried to bulkWrite while the primary was stepping down.
      // Gate on a successful primary ping; if not primary, skip and let
      // the next periodic warmup retry. The migration is idempotent and
      // not time-sensitive — running it 50 minutes later is fine.
      const mongoose = (await import('mongoose')).default;
      if (mongoose.connection.readyState !== 1) {
        logger.warn('🔧 MIGRATION: hasLogo skipped — Mongo not connected (readyState=' + mongoose.connection.readyState + '), will retry');
        return;
      }
      try {
        await mongoose.connection.db?.admin().ping();
      } catch (pingErr: any) {
        logger.warn('🔧 MIGRATION: hasLogo skipped — primary ping failed (' + (pingErr?.message || 'unknown') + '), will retry');
        return;
      }
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
      // Downgrade to warn — migration is idempotent and retried on the next
      // boot cycle, so a one-off failure (e.g. failover) is not a 5xx event.
      logger.warn(`🔧 MIGRATION: hasLogo migration failed (will retry next boot): ${err?.message || 'unknown'}`);
    }
  }, 30000);

  // === CRON JOBS ===
  const cron = await import('node-cron');

  cron.default.schedule('0 2 */2 * *', async () => {
    logger.log('📱 Scheduled TV/Mobile cache refresh (every 2 days at 2:00 AM)...');
    await warmupTvMobileCache();
  }, { timezone: 'Europe/Berlin' });
  logger.log('⏰ TV/Mobile cache refresh scheduled: every 2 days at 2:00 AM (Europe/Berlin)');

  // INCIDENT 2026-05-15 v10 — PrecomputedGenres boot warmup REMOVED.
  // Caches fill lazily on first organic request via the singleflight
  // wrapper. Cron refresh below still runs daily at 5 AM Berlin.
  void PrecomputedGenresService;

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
