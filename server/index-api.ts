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
import { logger } from './utils/logger';
import { initLogCollector } from './services/log-collector';

const app = express();

app.set('trust proxy', 1);
app.disable('x-powered-by');

function getFrameOptionsHeader(): string | null {
  if (process.env.CLICKJACKING_MITIGATION) {
    return process.env.CLICKJACKING_MITIGATION;
  }
  return 'DENY';
}

const globalApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: true,
  message: { error: 'Too many requests, please try again later.' },
  skip: (req) => {
    return !req.path.startsWith('/api') || req.path === '/api/health' || req.path === '/health' || req.path === '/healthz';
  }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: true,
  skipSuccessfulRequests: true,
  message: { error: 'Too many login attempts, please try again in 15 minutes.' }
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
app.get('/', (_req, res) => {
  res.sendFile(path.join(process.cwd(), 'public', 'api-docs.html'));
});

app.get(['/healthz', '/health', '/api/health'], async (req, res) => {
  if (req.path === '/healthz') {
    return res.status(200).send('ok');
  }

  const mem = process.memoryUsage();
  const heapMB = Math.round(mem.heapUsed / 1024 / 1024);
  const rssMB = Math.round(mem.rss / 1024 / 1024);
  const uptimeSeconds = Math.round(process.uptime());
  const days = Math.floor(uptimeSeconds / 86400);
  const hours = Math.floor((uptimeSeconds % 86400) / 3600);
  const minutes = Math.floor((uptimeSeconds % 3600) / 60);
  const seconds = uptimeSeconds % 60;

  let mongoStatus = 'unknown';
  try {
    const { default: mongoose } = await import('mongoose');
    const mongoState = mongoose.connection.readyState;
    mongoStatus = ({ 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' } as Record<number, string>)[mongoState] || 'unknown';
  } catch {}

  res.status(200).json({
    status: 'ok',
    service: 'backend-api',
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString(),
    memory: { heapUsed: `${heapMB}MB`, rss: `${rssMB}MB` },
    uptime: { seconds: uptimeSeconds, formatted: `${days}d ${hours}h ${minutes}m ${seconds}s` },
    database: { status: mongoStatus }
  });
});

app.use('/api', globalApiLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/admin/login', authLimiter);

const CORS_ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS || 'https://themegaradio.com').split(',').map(s => s.trim());
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://themegaradio.com';
if (!CORS_ALLOWED_ORIGINS.includes(FRONTEND_URL)) {
  CORS_ALLOWED_ORIGINS.push(FRONTEND_URL);
}

app.use('/api/stream', (req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS, HEAD');
  res.header('Access-Control-Allow-Headers', 'Range, Content-Type, Accept, User-Agent');
  res.header('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, Content-Type');
  res.header('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use('/api/image', (req, res, next) => {
  const origin = req.headers.origin;
  if (origin && CORS_ALLOWED_ORIGINS.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  } else if (!origin) {
    res.header('Access-Control-Allow-Origin', '*');
  }
  res.header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Range, Content-Type, Accept, User-Agent');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use((req, res, next) => {
  if (req.path.startsWith('/api/stream') || req.path.startsWith('/api/image')) {
    return next();
  }

  const origin = req.headers.origin;

  const isAllowedOrigin = origin && CORS_ALLOWED_ORIGINS.includes(origin);

  if (isAllowedOrigin) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Credentials', 'true');
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

import { startOperation, endOperation } from './utils/operation-tracker';

app.use((req, res, next) => {
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

const useSecureCookies = process.env.NODE_ENV === 'production';

if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
  console.error('🚨 FATAL: SESSION_SECRET environment variable is required in production');
  process.exit(1);
}

const sessionConfig: session.SessionOptions = {
  secret: process.env.SESSION_SECRET || 'radio-station-secret-key-dev-only',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: useSecureCookies,
    httpOnly: true,
    maxAge: 3 * 24 * 60 * 60 * 1000,
    sameSite: 'lax',
    domain: undefined,
    path: '/'
  },
  name: 'connect.sid',
  proxy: true,
  rolling: false
};

logger.log(`🔐 API Session config: secure=${useSecureCookies}, NODE_ENV=${process.env.NODE_ENV}`);

const mongoUri = process.env.MONGODB_URI || process.env.DATABASE_URL || 'mongodb://localhost:27017/mega';
const isProduction = process.env.NODE_ENV === 'production';

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

  server.timeout = 300000;
  server.keepAliveTimeout = 10000;
  server.headersTimeout = 15000;
  server.maxConnections = 500;

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
  });

  if (process.env.NODE_ENV !== 'development') {
    const ldPreload = process.env.LD_PRELOAD || 'not set';
    const mallocConf = process.env.MALLOC_CONF || 'not set';
    const allocator = ldPreload.includes('jemalloc') ? 'jemalloc' : 'glibc';
    logger.log(`🔧 Memory allocator: ${allocator}`);
    logger.log(`🔧 LD_PRELOAD=${ldPreload}`);
    logger.log(`🔧 MALLOC_CONF=${mallocConf}`);

    const tryGc = () => { if (typeof global.gc === 'function') { try { global.gc(); } catch {} } };

    const RSS_WARNING_MB = 3000;
    const RSS_CRITICAL_MB = 4000;
    const RSS_RESTART_MB = 5000;

    setInterval(() => { tryGc(); }, 60_000);

    setInterval(async () => {
      const mem = process.memoryUsage();
      const rssMB = Math.round(mem.rss / 1024 / 1024);
      const heapMB = Math.round(mem.heapUsed / 1024 / 1024);
      const heapTotalMB = Math.round(mem.heapTotal / 1024 / 1024);

      if (rssMB >= RSS_RESTART_MB) {
        console.error(`🔄 RSS RESTART: rss=${rssMB}MB exceeds ${RSS_RESTART_MB}MB — initiating graceful restart`);
        process.kill(process.pid, 'SIGTERM');
        return;
      }

      if (rssMB >= RSS_CRITICAL_MB) {
        console.error(`🚨 MEMORY CRITICAL: rss=${rssMB}MB heap=${heapMB}MB — clearing caches + forcing GC`);
        try {
          const { CacheManager } = await import('./cache');
          CacheManager.clearByPrefix('precomputed_');
          CacheManager.clearByPrefix('stations:');
          CacheManager.clearByPrefix('genres:');
        } catch {}
        tryGc();
        return;
      }

      if (rssMB >= RSS_WARNING_MB) {
        console.error(`⚠️ MEMORY WARNING: rss=${rssMB}MB heap=${heapMB}/${heapTotalMB}MB`);
        try {
          const { CacheManager } = await import('./cache');
          CacheManager.clearByPrefix('seo:');
        } catch {}
        tryGc();
      }
    }, 30_000);
  }

  (async () => {
    try {
      if (process.env.NODE_ENV !== 'development') {
        const { performanceCache } = await import('./performance-cache');
        logger.log('🔥 BACKGROUND: Starting cache warmup...');
        await performanceCache.warmupCaches();

        setImmediate(async () => {
          try {
            await performanceCache.warmupSimilarStations();
            logger.log('✅ BACKGROUND: Similar stations warmup completed');
          } catch (err) {
            logger.warn('⚠️ Similar stations warmup failed');
          }
        });

        try {
          const { Genre } = await import('../shared/mongo-schemas');
          const CacheManagerModule = (await import('./cache')).default;
          const genres = await Genre.find({ isDiscoverable: true }).sort({ stationCount: -1 }).limit(13).lean();
          await CacheManagerModule.set('genres:discoverable:all:13', genres, { ttl: 600 });
          logger.log('✅ CACHE: Discoverable genres warmed up');
        } catch (err) {
          logger.warn('⚠️ Discoverable genres warmup failed');
        }
      }

      const { loadDatabaseCountryLanguageMappings } = await import('../shared/seo-config');
      await loadDatabaseCountryLanguageMappings();

      const { loadDatabaseUrlTranslations } = await import('../shared/url-translations');
      await loadDatabaseUrlTranslations();

      if (process.env.NODE_ENV !== 'development') {
        try {
          const { scheduledCacheClearService } = await import('./services/scheduled-cache-clear');
          scheduledCacheClearService.initialize();
          logger.log('✅ BACKGROUND: Scheduled cache clear service initialized');
        } catch (error: any) {
          logger.warn('⚠️ Failed to initialize scheduled cache clear:', error.message);
        }
      }

      logger.log('✅ BACKEND-API: All background tasks completed');
    } catch (error) {
      console.error('❌ BACKGROUND: Cache warmup failed:', error);
    }
  })();
})();
