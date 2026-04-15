if (!process.env.FONTCONFIG_FILE || process.env.FONTCONFIG_FILE === '/dev/null') {
  process.env.FONTCONFIG_FILE = process.cwd() + '/fontconfig.conf';
}

import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import MongoStore from "connect-mongo";
import compression from "compression";
import crypto from "crypto";
import { rateLimit } from 'express-rate-limit';
import { markQuotaExceeded as markQuotaExceededFn } from './utils/quota-guard';

declare module "express-session" {
  interface SessionData {
    user?: {
      userId: string;
      email: string;
      role: string;
      rememberMe: boolean;
    };
  }
}
import { registerRoutes } from "./routes";
import { connectToMongoDB } from "./db-mongo";
import { performanceCache } from "./performance-cache";
import { logger } from './utils/logger';
import { initLogCollector } from './services/log-collector';
import { startOperation, endOperation, getActiveOperations, getGcStats, getActiveOperationsSummary, resetGcStats, initGcTracking } from './utils/operation-tracker';

const app = express();

app.set('trust proxy', 1);
app.disable('x-powered-by');

function getFrameOptionsHeader(): string | null {
  if (process.env.CLICKJACKING_MITIGATION) {
    return process.env.CLICKJACKING_MITIGATION;
  }
  if (process.env.REPLIT_DOMAINS) {
    return null;
  }
  return 'DENY';
}

const SEARCH_BOT_RE = /\b(googlebot|google-inspectiontool|apis-google|adsbot-google|mediapartners-google|storebot-google|bingbot|bingpreview|slurp|duckduckbot|baiduspider|yandexbot|applebot)\b/i;

const globalApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: true,
  message: { error: 'Too many requests, please try again later.' },
  skip: (req) => {
    if (!req.path.startsWith('/api') || req.path === '/api/health' || req.path === '/health' || req.path === '/healthz') return true;
    const ua = req.headers['user-agent'] || '';
    if (SEARCH_BOT_RE.test(ua)) return true;
    return false;
  }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: true,
  skipSuccessfulRequests: true,
  message: { error: 'Too many login attempts, please try again in 15 minutes.' },
  skip: (req) => {
    const ua = req.headers['user-agent'] || '';
    return SEARCH_BOT_RE.test(ua);
  }
});

function getHstsHeader(): string {
  if (process.env.HSTS_MAX_AGE) {
    const maxAge = process.env.HSTS_MAX_AGE;
    const includeSubdomains = process.env.HSTS_INCLUDE_SUBDOMAINS !== 'false' ? '; includeSubDomains' : '';
    const preload = process.env.HSTS_PRELOAD === 'true' ? '; preload' : '';
    return `max-age=${maxAge}${includeSubdomains}${preload}`;
  }
  const hstsPhase = process.env.HSTS_PHASE || 'confident';
  const hstsConfigs: Record<string, string> = {
    testing: 'max-age=60',
    initial: 'max-age=3600; includeSubDomains',
    confident: 'max-age=604800; includeSubDomains',
    production: 'max-age=31536000; includeSubDomains; preload'
  };
  return hstsConfigs[hstsPhase] || hstsConfigs.confident;
}

process.on('uncaughtException', (err) => {
  console.error('🚨 UNCAUGHT EXCEPTION (process survived):', err.message);
  console.error(err.stack?.split('\n').slice(0, 5).join('\n'));
});
process.on('unhandledRejection', (reason: any) => {
  const msg = reason?.message || reason || 'unknown';
  if (typeof msg === 'string' && msg.includes('over your space quota')) {
    markQuotaExceededFn();
    console.warn('⚠️ MongoDB quota exceeded (unhandled rejection) — writes paused for 10min');
    return;
  }
  console.error('🚨 UNHANDLED REJECTION (process survived):', msg);
  if (reason?.stack) console.error(reason.stack.split('\n').slice(0, 5).join('\n'));
});

import path from 'path';

const distPublicPath = path.join(process.cwd(), 'dist', 'public');
const publicPath = path.join(process.cwd(), 'public');

app.get('/robots.txt', (_req, res) => {
  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send(`User-agent: *
Disallow: /`);
});

app.get(['/healthz', '/health', '/api/health'], async (req, res) => {
  if (req.path === '/healthz') {
    return res.status(200).send('ok');
  }

  const mem = process.memoryUsage();
  const heapMB = Math.round(mem.heapUsed / 1024 / 1024);
  const rssMB = Math.round(mem.rss / 1024 / 1024);
  const heapTotalMB = Math.round(mem.heapTotal / 1024 / 1024);
  const externalMB = Math.round(mem.external / 1024 / 1024);
  const arrayBuffersMB = Math.round((mem.arrayBuffers || 0) / 1024 / 1024);

  const uptimeSeconds = Math.round(process.uptime());
  const days = Math.floor(uptimeSeconds / 86400);
  const hours = Math.floor((uptimeSeconds % 86400) / 3600);
  const minutes = Math.floor((uptimeSeconds % 3600) / 60);
  const seconds = uptimeSeconds % 60;
  const uptimeFormatted = `${days}d ${hours}h ${minutes}m ${seconds}s`;

  let mongoStatus = 'unknown';
  let mongoLatency = -1;
  try {
    const { default: mongoose } = await import('mongoose');
    const mongoState = mongoose.connection.readyState;
    mongoStatus = ({ 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' } as Record<number, string>)[mongoState] || 'unknown';
    if (mongoState === 1) {
      const start = Date.now();
      await mongoose.connection.db!.admin().ping();
      mongoLatency = Date.now() - start;
    }
  } catch {}

  const os = await import('os');
  const cpus = os.cpus();
  const loadAvg = os.loadavg();
  const totalMemGB = Math.round(os.totalmem() / 1024 / 1024 / 1024 * 10) / 10;
  const freeMemGB = Math.round(os.freemem() / 1024 / 1024 / 1024 * 10) / 10;

  const heapPercent = Math.round((heapMB / 4096) * 100);
  let memoryHealth = 'healthy';
  if (heapMB > 3500) memoryHealth = 'critical';
  else if (heapMB > 3000) memoryHealth = 'warning';

  res.status(200).json({
    status: 'ok',
    service: 'backend-api',
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString(),
    memory: {
      heapUsed: `${heapMB}MB`,
      heapTotal: `${heapTotalMB}MB`,
      heapLimit: '4096MB',
      heapUsagePercent: `${heapPercent}%`,
      rss: `${rssMB}MB`,
      external: `${externalMB}MB`,
      arrayBuffers: `${arrayBuffersMB}MB`,
      health: memoryHealth
    },
    uptime: {
      seconds: uptimeSeconds,
      formatted: uptimeFormatted
    },
    database: {
      status: mongoStatus,
      latencyMs: mongoLatency
    },
    system: {
      cpuCores: cpus.length,
      loadAverage: {
        '1min': Math.round(loadAvg[0] * 100) / 100,
        '5min': Math.round(loadAvg[1] * 100) / 100,
        '15min': Math.round(loadAvg[2] * 100) / 100
      },
      totalMemory: `${totalMemGB}GB`,
      freeMemory: `${freeMemGB}GB`
    },
    node: {
      version: process.version,
      maxOldSpaceSize: '4096MB',
      execArgv: process.execArgv,
      gcAvailable: typeof (globalThis as any).gc === 'function'
    },
    diagnostics: {
      activeOperations: (() => { try { return getActiveOperations().slice(0, 10); } catch { return []; } })(),
      gcStats: (() => { try { return getGcStats(); } catch { return {}; } })(),
      nativeMemoryMB: rssMB - heapTotalMB,
      activeHandles: (() => {
        try {
          const handles = (process as any)._getActiveHandles();
          const tc: Record<string, number> = {};
          for (const h of handles) { const n = h?.constructor?.name || 'Unknown'; tc[n] = (tc[n] || 0) + 1; }
          return tc;
        } catch { return {}; }
      })(),
      ldPreload: process.env.LD_PRELOAD || 'not set',
      mallocConf: process.env.MALLOC_CONF || 'not set',
      allocator: process.env.LD_PRELOAD?.includes('jemalloc') ? 'jemalloc' : 'glibc'
    }
  });
});

const CORS_ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS || 'https://themegaradio.com').split(',').map(s => s.trim());
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://themegaradio.com';
if (!CORS_ALLOWED_ORIGINS.includes(FRONTEND_URL)) {
  CORS_ALLOWED_ORIGINS.push(FRONTEND_URL);
}

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && CORS_ALLOWED_ORIGINS.some(o => origin === o || origin.endsWith('.themegaradio.com'))) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Credentials', 'true');
  } else {
    res.header('Access-Control-Allow-Origin', '*');
  }
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, HEAD');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Range, X-API-Key, X-API-User-Token');
  res.header('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length');
  res.header('Access-Control-Max-Age', '86400');

  res.header('X-Content-Type-Options', 'nosniff');
  const frameOptions = getFrameOptionsHeader();
  if (frameOptions) res.header('X-Frame-Options', frameOptions);
  res.header('X-XSS-Protection', '1; mode=block');
  res.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

  if (process.env.NODE_ENV === 'production' || req.secure || req.get('x-forwarded-proto') === 'https') {
    res.header('Strict-Transport-Security', getHstsHeader());
  }

  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }

  next();
});

app.use('/api', globalApiLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/admin/login', authLimiter);

app.use((req, res, next) => {
  if (req.path === '/healthz' || req.path === '/health' || req.path === '/api/health') return next();
  if (!req.path.startsWith('/api')) return next();
  const nonDbPaths = ['/api/stream/', '/api/image-proxy/'];
  if (nonDbPaths.some(p => req.path.startsWith(p))) return next();
  try {
    const mongoose = require('mongoose');
    const state = mongoose.connection.readyState;
    if (state !== 1) {
      const stateNames: Record<number, string> = { 0: 'disconnected', 2: 'connecting', 3: 'disconnecting' };
      console.error(`🚫 MongoDB circuit breaker: rejecting ${req.method} ${req.path} (state=${stateNames[state] || 'unknown'})`);
      return res.status(503).json({ error: 'Service temporarily unavailable, please retry in a few seconds' });
    }
  } catch {}
  next();
});

const enableEmbeddedProxy = process.env.ENABLE_EMBEDDED_PROXY === 'true' || process.env.NODE_ENV !== 'production';

app.use((req, res, next) => {
  if (process.env.NODE_ENV === 'development' || req.hostname === 'localhost' || req.hostname === '127.0.0.1') {
    return next();
  }
  if (req.path === '/api/health' || req.path === '/health' || req.path === '/healthz') {
    return next();
  }
  const isHttpOnly = !req.secure && req.get('x-forwarded-proto') !== 'https';
  if (isHttpOnly) {
    const host = req.get('host') || req.hostname;
    return res.redirect(301, `https://${host}${req.url}`);
  }
  next();
});

app.use((req, res, next) => {
  if (/\.(js|css|png|jpg|jpeg|gif|webp|svg|ico|woff|woff2|map|json)$/i.test(req.path)) {
    return next();
  }

  req.setTimeout(30000, () => {
    if (!res.headersSent) {
      console.error(`⏰ Request timeout (30s): ${req.method} ${req.path}`);
      res.status(504).send('Gateway Timeout');
    }
  });
  next();
});

const BOT_UA_RE = /bot|crawl|spider|slurp|baidu|yandex|duckduck|bingpreview|facebookexternalhit|twitterbot|linkedinbot|whatsapp|telegram|googlebot|google-inspectiontool|chrome-lighthouse|pingdom|uptimerobot/i;
app.use(compression({
  level: 1,
  threshold: 1024,
  filter: (req, res) => {
    if (req.headers['upgrade']) return false;
    const ua = req.headers['user-agent'] || '';
    if (BOT_UA_RE.test(ua)) return false;
    const contentType = res.getHeader('Content-Type') as string;
    if (contentType && /text|json|javascript|xml|svg/.test(contentType)) return true;
    return compression.filter(req, res);
  }
}));

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false, limit: '2mb' }));

app.get('/', (_req, res) => {
  res.sendFile(path.join(publicPath, 'api-docs.html'));
});

app.use('/assets', express.static(path.join(distPublicPath, 'assets'), { maxAge: '1y', immutable: true }));
app.use('/admin', express.static(distPublicPath, { index: false }));

app.get('/admin', (_req, res) => {
  res.sendFile(path.join(distPublicPath, 'index.html'));
});
app.get('/admin/*', (_req, res) => {
  res.sendFile(path.join(distPublicPath, 'index.html'));
});
app.get('/admin-login', (_req, res) => {
  res.sendFile(path.join(distPublicPath, 'index.html'));
});

const isReplit = !!process.env.REPLIT_DOMAINS;
const useSecureCookies = process.env.NODE_ENV === 'production' || isReplit;

if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
  console.error('🚨 FATAL: SESSION_SECRET environment variable is required in production');
  process.exit(1);
}

const cookieDomain = process.env.COOKIE_DOMAIN || undefined;

const sessionConfig: session.SessionOptions = {
  secret: process.env.SESSION_SECRET || 'radio-station-secret-key-2025',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: useSecureCookies,
    httpOnly: true,
    maxAge: 3 * 24 * 60 * 60 * 1000,
    sameSite: cookieDomain ? 'none' : (isReplit ? 'none' : 'lax'),
    domain: cookieDomain,
    path: '/'
  },
  name: 'connect.sid',
  proxy: true,
  rolling: false
};

logger.log(`🔐 API Session config: secure=${useSecureCookies}, isReplit=${isReplit}, NODE_ENV=${process.env.NODE_ENV}, cookieDomain=${cookieDomain || 'auto'}, sameSite=${cookieDomain ? 'none' : (isReplit ? 'none' : 'lax')}`);

const mongoUri = process.env.MONGODB_URI || process.env.DATABASE_URL || 'mongodb://localhost:27017/mega';
const isProduction = process.env.NODE_ENV === 'production' || isReplit;

if (isProduction && mongoUri) {
  sessionConfig.store = MongoStore.create({
    mongoUrl: mongoUri,
    collectionName: 'sessions',
    ttl: 3 * 24 * 60 * 60,
    autoRemove: 'native',
    touchAfter: 24 * 60 * 60,
  });
  logger.log('🔐 Using MongoDB session store for production');
}

app.use(session(sessionConfig));

(async () => {
  initLogCollector();
  await connectToMongoDB();

  const server = await registerRoutes(app, { mode: 'api-only' });

  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url || '', `http://${request.headers.host}`).pathname;

    if (pathname === '/ws/metadata') {
      server.metadataWss.handleUpgrade(request, socket, head, (ws) => {
        server.metadataWss.emit('connection', ws, request);
      });
    } else if (pathname === '/ws/cast') {
      server.castWss.handleUpgrade(request, socket, head, (ws) => {
        server.castWss.emit('connection', ws, request);
      });
    } else if (pathname === '/ws/chat') {
      server.chatWss.handleUpgrade(request, socket, head, (ws) => {
        server.chatWss.emit('connection', ws, request);
      });
    }
  });

  server.timeout = 120000;
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 70000;
  server.maxConnections = 300;
  (app as any)._httpServer = server;

  let isShuttingDown = false;
  const gracefulShutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`\n🛑 ${signal} received — starting graceful shutdown...`);
    const shutdownTimeout = setTimeout(() => {
      console.error('🚨 Graceful shutdown timed out (15s) — forcing exit');
      process.exit(1);
    }, 15000);

    try {
      await new Promise<void>((resolve) => {
        server.close(() => { console.log('✅ HTTP server closed'); resolve(); });
        setTimeout(resolve, 10000);
      });

      const mongooseModule = (await import('mongoose')).default;
      if (mongooseModule.connection.readyState === 1) {
        await mongooseModule.connection.close(false);
        console.log('✅ MongoDB connection closed');
      }

      clearTimeout(shutdownTimeout);
      console.log('✅ Graceful shutdown complete');
      process.exit(0);
    } catch (err: any) {
      console.error('❌ Error during shutdown:', err.message);
      clearTimeout(shutdownTimeout);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    if (!res.headersSent) {
      res.status(status).json({ message });
    }
    console.error(`❌ Express error [${status}]: ${message}`);
  });

  const port = parseInt(process.env.PORT || '5000', 10);
  server.listen({ port, host: "0.0.0.0", reusePort: true }, () => {
    logger.log(`🚀 BACKEND-API: Listening on port ${port}`);
    logger.log(`🔗 CORS allowed origins: ${CORS_ALLOWED_ORIGINS.join(', ')}`);
    logger.log(`🔗 Frontend URL: ${FRONTEND_URL}`);

    let watchdogFailures = 0;
    const WATCHDOG_MAX_FAILURES = 3;
    const WATCHDOG_INTERVAL = 30_000;
    const WATCHDOG_TIMEOUT = 5_000;

    const watchdogTimer = setInterval(async () => {
      if (isShuttingDown) { clearInterval(watchdogTimer); return; }
      try {
        const http = await import('http');
        const result = await new Promise<boolean>((resolve) => {
          const req = http.request(
            { hostname: '127.0.0.1', port, path: '/healthz', method: 'GET', timeout: WATCHDOG_TIMEOUT },
            (res) => {
              res.resume();
              resolve(res.statusCode === 200);
            }
          );
          req.on('error', () => resolve(false));
          req.on('timeout', () => { req.destroy(); resolve(false); });
          req.end();
        });

        if (result) {
          if (watchdogFailures > 0) {
            console.log(`🐕 Watchdog: recovered after ${watchdogFailures} failure(s)`);
          }
          watchdogFailures = 0;
        } else {
          watchdogFailures++;
          console.error(`🐕 Watchdog: self-ping failed (${watchdogFailures}/${WATCHDOG_MAX_FAILURES})`);
          if (watchdogFailures >= WATCHDOG_MAX_FAILURES) {
            console.error(`🐕 Watchdog: ${WATCHDOG_MAX_FAILURES} consecutive failures — forcing restart`);
            process.kill(process.pid, 'SIGTERM');
          }
        }
      } catch (err: any) {
        watchdogFailures++;
        console.error(`🐕 Watchdog error: ${err.message} (${watchdogFailures}/${WATCHDOG_MAX_FAILURES})`);
        if (watchdogFailures >= WATCHDOG_MAX_FAILURES) {
          console.error(`🐕 Watchdog: forcing restart after error`);
          process.kill(process.pid, 'SIGTERM');
        }
      }
    }, WATCHDOG_INTERVAL);

    logger.log(`🐕 Watchdog: enabled (interval=${WATCHDOG_INTERVAL/1000}s, maxFailures=${WATCHDOG_MAX_FAILURES})`);
  });

  (async () => {
    try {
      try {
        const { BulkDescriptionJob } = await import('../shared/mongo-schemas');
        const unfinishedJobs = await BulkDescriptionJob.find({ status: 'running' }).sort({ createdAt: -1 }).limit(1);

        if (unfinishedJobs.length > 0) {
          const job = unfinishedJobs[0];
          logger.log(`🔄 RESUMING: Found unfinished bulk AI job ${job.jobId}, resuming from station ${job.lastProcessedStationId || 'start'}`);
          logger.log(`📌 Bulk job ${job.jobId} will resume on next manual trigger or server optimization`);
        }
      } catch (resumeError) {
        logger.warn('⚠️ Could not check for unfinished jobs:', (resumeError as Error).message);
      }

      if (process.env.NODE_ENV !== 'development') {
        logger.log('🔥 BACKGROUND: Starting LIGHTWEIGHT cache warmup (on-demand for heavy caches)...');

        await performanceCache.warmupCaches();

        logger.log('⚡ SKIPPED: PrecomputedStations full cache — will populate on-demand per country');

        setImmediate(async () => {
          try {
            await performanceCache.warmupSimilarStations();
            logger.log('✅ BACKGROUND: Similar stations warmup completed');
          } catch (err) {
            logger.warn('⚠️ Similar stations warmup failed (will use MongoDB fallback)');
          }
        });

        try {
          const { Genre } = await import('../shared/mongo-schemas');
          const CacheManagerModule = (await import('./cache')).default;
          const genres = await Genre.find({ isDiscoverable: true }).sort({ stationCount: -1 }).limit(13).lean();
          await CacheManagerModule.set('genres:discoverable:all:13', genres, { ttl: 600 });
          logger.log('✅ CACHE: Discoverable genres warmed up');
        } catch (err) {
          logger.warn('⚠️ Discoverable genres warmup failed (will cache on first request)');
        }

        logger.log('⚡ SKIPPED: Sitemap translations warmup — will populate on-demand per language');
      } else {
        logger.log('⚡ DEV MODE: All heavy cache warmups skipped (saves ~500MB RAM)');
        logger.log('⚡ Caches will be populated on-demand on first request');
      }

      const { loadDatabaseCountryLanguageMappings } = await import('../shared/seo-config');
      await loadDatabaseCountryLanguageMappings();

      const { loadDatabaseUrlTranslations } = await import('../shared/url-translations');
      await loadDatabaseUrlTranslations();

      if (process.env.NODE_ENV !== 'development') {
        try {
          const CacheManagerModule = (await import('./cache')).default;
          const CLEANUP_CACHE_KEY = 'startup:description_cleanup:last_run';
          const lastRun = await CacheManagerModule.get(CLEANUP_CACHE_KEY);
          if (lastRun) {
            logger.log('🧹 CLEANUP: Skipping (already ran within 24h)');
          } else {
            const { Station } = await import('../shared/mongo-schemas');
            let cleanedCount = 0;
            const placeholderRegex = /^\[(TRANSLATED\s+)?(META|FULL\s+DESCRIPTION|SEO\s+META)[^\]]*\]\s*/i;
            const cursor = Station.find({
              $or: [
                { 'descriptions': { $regex: /^\[(TRANSLATED\s+)?(META|FULL|SEO)[^\]]*\]/i } }
              ]
            }).select('_id descriptions').lean().cursor({ batchSize: 2000 });

            for await (const station of cursor) {
              if (!station.descriptions || typeof station.descriptions !== 'object') continue;
              const updatedDescriptions: any = {};
              let hasChanges = false;
              for (const [lang, desc] of Object.entries(station.descriptions as any)) {
                if (typeof desc === 'object' && desc !== null) {
                  const d = desc as any;
                  const cleanedMeta = (d.meta || '').replace(placeholderRegex, '').trim();
                  const cleanedFull = (d.full || '').replace(placeholderRegex, '').trim();
                  if (cleanedMeta !== d.meta || cleanedFull !== d.full) hasChanges = true;
                  updatedDescriptions[lang] = { ...d, meta: cleanedMeta, full: cleanedFull };
                } else {
                  updatedDescriptions[lang] = desc;
                }
              }
              if (hasChanges) {
                await Station.updateOne({ _id: station._id }, { $set: { descriptions: updatedDescriptions } });
                cleanedCount++;
              }
            }
            await CacheManagerModule.set(CLEANUP_CACHE_KEY, Date.now(), { ttl: 86400 });
            if (cleanedCount > 0) logger.log(`🧹 CLEANUP: Cleaned placeholder prefixes from ${cleanedCount} stations`);
          }
        } catch (error: any) {
          logger.warn(`⚠️ Automatic cleanup failed:`, error.message);
        }
      }

      logger.log('✅ BACKGROUND: All cache warmup operations completed');

      if (process.env.NODE_ENV !== 'development') {
        try {
          const { scheduledCacheClearService } = await import('./services/scheduled-cache-clear');
          scheduledCacheClearService.initialize();
          logger.log('✅ BACKGROUND: Scheduled cache clear service initialized');
        } catch (error: any) {
          logger.warn('⚠️ Failed to initialize scheduled cache clear:', error.message);
        }
      }

      if (process.env.NODE_ENV !== 'development') {
        try {
          const { TranslationSyncService } = await import('./services/translation-sync');
          logger.log('🌍 BACKGROUND: Scanning for new translation keys...');
          const result = await TranslationSyncService.scanForNewKeys();
          if (result.keysAdded > 0) {
            logger.log(`✅ BACKGROUND: Found ${result.keysAdded} new translation keys (run 'Translate All Languages' in admin to translate)`);
          } else {
            logger.log('✅ BACKGROUND: All translation keys already synced');
          }
        } catch (error: any) {
          logger.warn('⚠️ BACKGROUND: Translation key scan failed:', error.message);
        }
      }

      logger.log('✅ BACKEND-API: All background tasks completed');
    } catch (error) {
      console.error('❌ BACKGROUND: Cache warmup failed:', error);
    }

    if (process.env.NODE_ENV !== 'development') {
      const { CacheManager } = await import('./cache');

      const ldPreload = process.env.LD_PRELOAD || 'not set';
      const mallocConf = process.env.MALLOC_CONF || 'not set';
      const allocator = ldPreload.includes('jemalloc') ? 'jemalloc ✅' : 'glibc (⚠️ RSS fragmentation risk)';
      console.log(`🔧 Memory allocator: ${allocator}`);
      console.log(`🔧 LD_PRELOAD=${ldPreload}`);
      console.log(`🔧 MALLOC_CONF=${mallocConf}`);

      let lastMemoryGcTime = 0;
      const MEMORY_GC_COOLDOWN = 2 * 60 * 1000;
      let lastProactiveClearTime = 0;
      const PROACTIVE_CLEAR_COOLDOWN = 5 * 60 * 1000;
      let lastMemoryWarningTime = 0;
      const MEMORY_WARNING_INTERVAL = 3 * 60 * 1000;
      const RSS_WARNING_MB = parseInt(process.env.RSS_WARNING_MB || '600', 10);
      const RSS_CRITICAL_MB = parseInt(process.env.RSS_CRITICAL_MB || '800', 10);
      const RSS_RESTART_MB = parseInt(process.env.RSS_RESTART_MB || '1200', 10);

      const tryGc = () => {
        try {
          if (typeof (globalThis as any).gc === 'function') {
            (globalThis as any).gc();
          }
        } catch {}
      };

      const getHandleDiagnostics = () => {
        try {
          const handles = (process as any)._getActiveHandles();
          const typeCounts: Record<string, number> = {};
          for (const h of handles) {
            const name = h?.constructor?.name || 'Unknown';
            typeCounts[name] = (typeCounts[name] || 0) + 1;
          }
          return typeCounts;
        } catch { return {}; }
      };

      const getConnectionCount = (): Promise<number> => {
        return new Promise((resolve) => {
          const srv = (app as any)._httpServer;
          if (srv && typeof srv.getConnections === 'function') {
            srv.getConnections((err: any, count: number) => resolve(err ? -1 : count));
          } else {
            resolve(-1);
          }
        });
      };

      let lastDiagLogTime = Date.now();
      const DIAG_LOG_INTERVAL = 2 * 60 * 1000;

      setTimeout(async () => {
        const mem = process.memoryUsage();
        const conns = await getConnectionCount();
        const handles = getHandleDiagnostics();
        const handleStr = Object.entries(handles).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}:${v}`).join(' ');
        const rssMB = Math.round(mem.rss / 1024 / 1024);
        const heapMB = Math.round(mem.heapUsed / 1024 / 1024);
        const heapTotalMB = Math.round(mem.heapTotal / 1024 / 1024);
        const extMB = Math.round(mem.external / 1024 / 1024);
        const abMB = Math.round((mem.arrayBuffers || 0) / 1024 / 1024);
        console.log(`📊 STARTUP DIAG: rss=${rssMB}MB heap=${heapMB}/${heapTotalMB}MB ext=${extMB}MB ab=${abMB}MB native≈${rssMB - heapTotalMB}MB | conns=${conns} | handles: ${handleStr}`);
      }, 10_000);

      setInterval(() => { tryGc(); }, 60_000);

      setInterval(async () => {
        const mem = process.memoryUsage();
        const heapMB = Math.round(mem.heapUsed / 1024 / 1024);
        const rssMB = Math.round(mem.rss / 1024 / 1024);
        const heapTotalMB = Math.round(mem.heapTotal / 1024 / 1024);
        const externalMB = Math.round(mem.external / 1024 / 1024);
        const abMB = Math.round((mem.arrayBuffers || 0) / 1024 / 1024);
        const nativeMB = rssMB - heapTotalMB;
        const now = Date.now();

        if ((now - lastDiagLogTime) > DIAG_LOG_INTERVAL) {
          lastDiagLogTime = now;
          const conns = await getConnectionCount();
          const handles = getHandleDiagnostics();
          const handleStr = Object.entries(handles).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}:${v}`).join(' ');
          console.log(`📊 DIAG: rss=${rssMB}MB heap=${heapMB}/${heapTotalMB}MB ext=${externalMB}MB ab=${abMB}MB native≈${nativeMB}MB | conns=${conns} | handles: ${handleStr}`);
        }

        if (rssMB > RSS_RESTART_MB) {
          const conns = await getConnectionCount();
          const handles = getHandleDiagnostics();
          const handleStr = Object.entries(handles).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}:${v}`).join(' ');
          console.error(`🔄 RSS RESTART: rss=${rssMB}MB heap=${heapMB}MB ext=${externalMB}MB native≈${nativeMB}MB | conns=${conns} | handles: ${handleStr}`);
          process.kill(process.pid, 'SIGTERM');
          return;
        }

        if (rssMB > RSS_WARNING_MB && (now - lastProactiveClearTime) > PROACTIVE_CLEAR_COOLDOWN) {
          console.log(`🧹 RSS MEMORY RELIEF: rss=${rssMB}MB heap=${heapMB}MB ext=${externalMB}MB native≈${nativeMB}MB — clearing SEO & quick caches`);
          performanceCache.clearSeoAndQuickCaches();
          tryGc();
          lastProactiveClearTime = now;
        }

        if (rssMB > RSS_CRITICAL_MB || heapMB > 3500) {
          if ((now - lastMemoryWarningTime) > MEMORY_WARNING_INTERVAL) {
            const conns = await getConnectionCount();
            console.warn(`⚠️ MEMORY WARNING: rss=${rssMB}MB heap=${heapMB}MB/${heapTotalMB}MB ext=${externalMB}MB native≈${nativeMB}MB conns=${conns}`);
            lastMemoryWarningTime = now;
          }
          if ((now - lastMemoryGcTime) > MEMORY_GC_COOLDOWN) {
            lastMemoryGcTime = now;
            console.error(`🚨 MEMORY CRITICAL: rss=${rssMB}MB heap=${heapMB}MB — clearing caches + forcing GC`);
            performanceCache.clearAllForMemoryRelief();
            await CacheManager.clearByPattern('precomputed_');
            await CacheManager.clearByPattern('stations:');
            await CacheManager.clearByPattern('genres:');
            try {
              const { clearOgCache } = await import('./og-image-generator');
              clearOgCache();
            } catch {}
            tryGc();
          }
        }
      }, 30_000);

      await initGcTracking();

      let lastEventLoopCheck = Date.now();
      let lastBlockedLogTime = 0;
      const LAG_LOG_INTERVAL = 30 * 1000;
      setInterval(() => {
        const now = Date.now();
        const lag = now - lastEventLoopCheck - 5000;
        lastEventLoopCheck = now;
        if (lag > 5000) {
          if ((now - lastBlockedLogTime) > LAG_LOG_INTERVAL) {
            lastBlockedLogTime = now;
            const mem = process.memoryUsage();
            const heapMB = Math.round(mem.heapUsed / 1024 / 1024);
            const rssMB = Math.round(mem.rss / 1024 / 1024);
            const extMB = Math.round(mem.external / 1024 / 1024);
            const nativeMB = rssMB - Math.round(mem.heapTotal / 1024 / 1024);
            const gcStatsLocal = getGcStats();
            const ops = getActiveOperationsSummary();
            const handles = getHandleDiagnostics();
            const socketCount = (handles['Socket'] || 0) + (handles['TLSSocket'] || 0);
            console.error(`🚨 EVENT LOOP BLOCKED: ${lag}ms | heap=${heapMB}MB rss=${rssMB}MB ext=${extMB}MB native≈${nativeMB}MB sockets=${socketCount} | GC: count=${gcStatsLocal.count} max=${gcStatsLocal.maxMs}ms total=${gcStatsLocal.totalMs}ms | Active: ${ops}`);
            resetGcStats();
          }
        }
      }, 5000);

      const mongoose = (await import('mongoose')).default;
      setInterval(() => {
        const state = mongoose.connection.readyState;
        if (state !== 1) {
          const stateNames: Record<number, string> = { 0: 'disconnected', 2: 'connecting', 3: 'disconnecting' };
          console.error(`🚨 MONGODB STATE: ${stateNames[state] || 'unknown'} (readyState=${state})`);
        }
      }, 30000);
    }

  })();
})();
