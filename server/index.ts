// Suppress libvips/Sharp fontconfig warnings (no text rendering needed for image processing)
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
import { getSeoRenderStats } from './seo-renderer';

// Extend session type to include user data
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
import path from "path";
import { registerRoutes } from "./routes";
import { serveStatic, log } from "./serve-static";
import { connectToMongoDB } from "./db-mongo";
import { performanceCache } from "./performance-cache";
import { htmlLangMiddleware } from "./html-lang-middleware";
import { logger } from './utils/logger';
import { initLogCollector } from './services/log-collector';
import { urlRedirectMiddleware } from './url-redirect-middleware';
import { stationCountryValidator } from './station-country-validator';
import { geoBlockMiddleware } from './middleware/geo-block';

const app = express();

// Trust proxy: Required when deployed behind Cloudflare/Railway/nginx
// Allows express-rate-limit to correctly identify real client IPs from X-Forwarded-For
app.set('trust proxy', 1);

// Security: Remove X-Powered-By header to prevent technology stack disclosure
app.disable('x-powered-by');

// Geo-block FIRST — drop TCP connection from blocked countries (no response)
app.use(geoBlockMiddleware);

// Clickjacking Protection: Configurable X-Frame-Options strategy
// DENY = Most secure (page cannot be embedded anywhere)
// SAMEORIGIN = Allow embedding only on same domain (if needed)
function getFrameOptionsHeader(): string | null {
  if (process.env.CLICKJACKING_MITIGATION) {
    return process.env.CLICKJACKING_MITIGATION;
  }
  if (process.env.REPLIT_DOMAINS) {
    return null;
  }
  return 'DENY';
}

// RATE LIMITING: Prevent brute-force and DoS attacks
const globalApiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // limit each IP to 100 requests per windowMs
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: true, // Enable the `X-RateLimit-*` headers
  message: { error: 'Too many requests, please try again later.' },
  skip: (req) => {
    // Skip rate limiting for health checks and non-API routes
    return !req.path.startsWith('/api') || req.path === '/api/health' || req.path === '/health' || req.path === '/healthz';
  }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each IP to 10 requests per windowMs
  standardHeaders: true,
  legacyHeaders: true,
  skipSuccessfulRequests: true, // Only count failed attempts — successful logins don't consume quota
  message: { error: 'Too many login attempts, please try again in 15 minutes.' }
});

// HSTS Configuration: Implement gradual rollout strategy as recommended by Lighthouse
// Start with conservative values and gradually increase based on confidence
// Phases: testing (60s) → initial (1h) → confident (1 week) → production (1 year + preload)
function getHstsHeader(): string {
  // Allow manual override via HSTS_MAX_AGE environment variable
  if (process.env.HSTS_MAX_AGE) {
    const maxAge = process.env.HSTS_MAX_AGE;
    const includeSubdomains = process.env.HSTS_INCLUDE_SUBDOMAINS !== 'false' ? '; includeSubDomains' : '';
    const preload = process.env.HSTS_PRELOAD === 'true' ? '; preload' : '';
    return `max-age=${maxAge}${includeSubdomains}${preload}`;
  }

  // Default phase-based configuration
  const hstsPhase = process.env.HSTS_PHASE || 'confident'; // Options: testing, initial, confident, production
  
  const hstsConfigs: Record<string, string> = {
    // Phase 1: Testing phase - short max-age for safe testing without lock-in
    testing: 'max-age=60',
    
    // Phase 2: Initial rollout - 1 hour max-age for gradual deployment
    initial: 'max-age=3600; includeSubDomains',
    
    // Phase 3: Confident phase (default) - 1 week max-age after successful testing
    confident: 'max-age=604800; includeSubDomains',
    
    // Phase 4: Full production - 1 year max-age + preload for maximum security
    production: 'max-age=31536000; includeSubDomains; preload'
  };
  
  return hstsConfigs[hstsPhase] || hstsConfigs.confident;
}

// Global process crash prevention — log and survive instead of dying.
// Transient MongoDB errors are not fatal and are handled by the app-level
// reconnect loop in server/db-mongo.ts. Other errors are logged but the
// process keeps running (this is the embedded/monolith path; the split
// services in index-api.ts use stricter fail-fast semantics).
//
// NOTE: do NOT use a generic "connection.*closed" pattern — it would
// suppress unrelated failures (HTTP, WebSocket, etc.) whose message happens
// to contain that phrase. We rely on Mongo-named errors and well-known
// network errno strings only. MongoNetworkError already covers most
// teardown cases.
const TRANSIENT_MONGO_RE = /MongoNetworkError|MongoServerSelectionError|MongoNotConnectedError|MongoPoolClearedError|MongoExpiredSessionError|PoolClearedError|ECONNRESET|ETIMEDOUT|ENOTFOUND|EHOSTUNREACH|server selection/i;

function isTransientMongo(err: any): boolean {
  const name = err?.name || '';
  if (typeof name === 'string' && name.startsWith('Mongo')) return true;
  const msg = err?.message || (typeof err === 'string' ? err : '');
  return TRANSIENT_MONGO_RE.test(msg);
}

process.on('uncaughtException', (err: any) => {
  if (isTransientMongo(err)) {
    console.warn('⚠️ UNCAUGHT EXCEPTION (transient MongoDB, ignored):', err?.message || err);
    return;
  }
  console.error('🚨 UNCAUGHT EXCEPTION (process survived):', err?.message || err);
  console.error(err?.stack?.split('\n').slice(0, 5).join('\n'));
});
process.on('unhandledRejection', (reason: any) => {
  const msg = reason?.message || reason || 'unknown';
  if (typeof msg === 'string' && msg.includes('over your space quota')) {
    markQuotaExceededFn();
    console.warn('⚠️ MongoDB quota exceeded (unhandled rejection) — writes paused for 10min');
    return;
  }
  if (isTransientMongo(reason)) {
    console.warn('⚠️ UNHANDLED REJECTION (transient MongoDB, ignored):', msg);
    return;
  }
  console.error('🚨 UNHANDLED REJECTION (process survived):', msg);
  if (reason?.stack) console.error(reason.stack.split('\n').slice(0, 5).join('\n'));
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
      seoRender: getSeoRenderStats(),
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

// Apply global API rate limiting to all /api routes
app.use('/api', globalApiLimiter);

// Apply strict rate limiting to sensitive authentication endpoints
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/admin/login', authLimiter);

// Request routing middleware
app.use((req, res, next) => {
  next();
});

// SEO & Security Headers Middleware
app.use((req, res, next) => {
  // CRITICAL SEO FIX: Override any blocking X-Robots-Tag headers from development environment
  // Replit's dev environment may set "X-Robots-Tag: none, noindex" to prevent indexing
  // We MUST override this to allow search engine crawling and indexing
  // NEVER set noindex in production - this is critical for SEO visibility
  
  // Remove any existing X-Robots-Tag that might block crawling
  res.removeHeader('X-Robots-Tag');
  
  // Set proper X-Robots-Tag for production: allow all crawlers to index and follow
  // This explicitly overrides Replit's development noindex header
  res.header('X-Robots-Tag', 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1');
  
  // CORS Configuration for cross-origin streaming & Samsung TV compatibility
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, HEAD');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Range, X-API-Key, X-API-User-Token');
  res.header('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length');
  res.header('Access-Control-Max-Age', '86400'); // 24 hours cache for preflight requests
  
  // Security headers that improve SEO ranking
  res.header('X-Content-Type-Options', 'nosniff');
  const frameOptions = getFrameOptionsHeader();
  if (frameOptions) res.header('X-Frame-Options', frameOptions);
  res.header('X-XSS-Protection', '1; mode=block');
  res.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  
  // Strict-Transport-Security for HTTPS (only in production)
  // Implements gradual HSTS rollout strategy as recommended by Lighthouse
  if (process.env.NODE_ENV === 'production' || req.secure || req.get('x-forwarded-proto') === 'https') {
    const hstsHeader = getHstsHeader();
    res.header('Strict-Transport-Security', hstsHeader);
  }
  
  // Skip CSP for cast-receiver (Chromecast needs ws://localhost:8008 and ajax.googleapis.com)
  if (req.path.startsWith('/cast-receiver')) {
    next();
    return;
  }

  // Content Security Policy - Protects against XSS, injection attacks
  // Allows: self (same domain), trusted CDNs for fonts/images, analytics
  const isProduction = process.env.NODE_ENV === 'production';
  const cspDirectives = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://www.clarity.ms https://scripts.clarity.ms https://analytics.ahrefs.com https://cdn.jsdelivr.net https://static.cloudflareinsights.com https://pagead2.googlesyndication.com https://www.gstatic.com https://adservice.google.com https://tpc.googlesyndication.com https://*.adtrafficquality.google https://partner.googleadservices.com https://www.googleadservices.com https://googleads.g.doubleclick.net https://securepubads.g.doubleclick.net https://fundingchoicesmessages.google.com https://consent.google.com https://www.google.com https://flowalive-sdk.s3.eu-central-1.amazonaws.com",
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: https: blob:",
    "media-src 'self' https: blob:",
    "connect-src 'self' https: wss:",
    "frame-src 'self' https://pagead2.googlesyndication.com https://tpc.googlesyndication.com https://googleads.g.doubleclick.net https://www.google.com https://*.adtrafficquality.google https://securepubads.g.doubleclick.net https://fundingchoicesmessages.google.com https://consent.google.com",
    process.env.REPLIT_DOMAINS ? "frame-ancestors 'self' https://*.replit.com https://*.replit.dev https://*.riker.replit.dev" : "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ];
  if (isProduction) {
    cspDirectives.push("upgrade-insecure-requests");
  }
  const csp = cspDirectives.join('; ');
  
  if (isProduction) {
    res.header('Content-Security-Policy', csp);
  } else {
    res.header('Content-Security-Policy-Report-Only', csp);
  }
  
  // Expect-CT: Enforce Certificate Transparency for HTTPS
  res.header('Expect-CT', 'max-age=86400, enforce');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }
  
  next();
});

// SECURITY: HTTP → HTTPS Redirect Middleware (301 permanent redirect)
// Redirects all HTTP traffic to HTTPS for maximum security and SEO
// Handles both direct HTTPS checks and proxy headers (for Replit deployment)
// DISABLED in development to allow localhost:5000 HTTP access
app.use((req, res, next) => {
  // Skip HTTPS redirect in development (localhost)
  if (process.env.NODE_ENV === 'development' || req.hostname === 'localhost' || req.hostname === '127.0.0.1') {
    return next();
  }

  // Skip HTTPS redirect for health check endpoints (Railway/internal probes use HTTP)
  if (req.path === '/api/health' || req.path === '/health' || req.path === '/healthz') {
    return next();
  }
  
  // Check if connection is HTTP (not secure and no proxy HTTPS header)
  const isHttpOnly = !req.secure && req.get('x-forwarded-proto') !== 'https';
  
  // Only redirect if this is HTTP traffic (not HTTPS)
  if (isHttpOnly) {
    // Build redirect URL: preserve protocol as HTTPS, path, and query string
    const protocol = 'https';
    const host = req.get('host') || req.hostname;
    const redirectUrl = `${protocol}://${host}${req.url}`;
    
    logger.log(`🔒 SECURITY: 301 redirect HTTP → HTTPS: ${req.url} → ${redirectUrl}`);
    
    // Permanent redirect (301) to HTTPS version
    return res.redirect(301, redirectUrl);
  }
  
  next();
});

// CRITICAL SEO FIX: Domain redirect middleware (301 permanent redirect)
// Redirects www subdomain to primary domain for consistency
app.use((req, res, next) => {
  const hostname = req.hostname.toLowerCase();
  
  // Redirect www.themegaradio.com to themegaradio.com for consistency
  if (hostname === 'www.themegaradio.com') {
    const protocol = req.secure || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
    const redirectUrl = `${protocol}://themegaradio.com${req.url}`;
    
    logger.log(`🔀 SEO: 301 redirect www → non-www: ${redirectUrl}`);
    
    return res.redirect(301, redirectUrl);
  }
  
  next();
});

// CRITICAL SEO FIX: Trailing slash redirect middleware
// Fixes "Google chose different canonical than user" issue
// Redirects /path/ to /path (except for root /)
app.use((req, res, next) => {
  // Skip if root path or doesn't end with trailing slash
  if (req.path === '/' || !req.path.endsWith('/')) {
    return next();
  }
  
  // Skip for static files (contain a dot in the last segment)
  const pathSegments = req.path.split('/');
  const lastSegment = pathSegments[pathSegments.length - 2]; // -2 because last is empty after trailing slash
  if (lastSegment && lastSegment.includes('.')) {
    return next();
  }
  
  // Build redirect URL: remove trailing slash and preserve query string
  const query = req.url.slice(req.path.length);
  const redirectPath = req.path.slice(0, -1) + query;
  
  logger.log(`🔀 SEO: 301 redirect ${req.path} → ${redirectPath} (trailing slash removal)`);
  
  // 301 Permanent Redirect to non-trailing slash version
  return res.redirect(301, redirectPath);
});

import { startOperation, endOperation, getActiveOperations, getGcStats } from './utils/operation-tracker';

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

app.use((req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/ws') || req.path.startsWith('/healthz') || req.path.startsWith('/health') || /\.(js|css|png|jpg|jpeg|gif|webp|svg|ico|woff|woff2|map|json)$/i.test(req.path)) {
    return next();
  }
  const opId = startOperation('http-request', `${req.method} ${req.path}`);
  let cleaned = false;
  const cleanup = () => { if (!cleaned) { cleaned = true; endOperation(opId); } };
  res.on('finish', cleanup);
  res.on('close', cleanup);
  next();
});

app.use(urlRedirectMiddleware);

// CRITICAL SEO FIX: Station country code validation middleware
// Prevents duplicate content by redirecting stations with wrong country codes to canonical URLs
// Example: /lb/station/colombian-radio → 301 → /station/colombian-radio
app.use(stationCountryValidator);

// Enable compression for all responses - SEO optimization for faster page loads
const BOT_UA_RE = /bot|crawl|spider|slurp|baidu|yandex|duckduck|bingpreview|facebookexternalhit|twitterbot|linkedinbot|whatsapp|telegram|googlebot|google-inspectiontool|chrome-lighthouse|pingdom|uptimerobot/i;
app.use(compression({
  level: 1,
  threshold: 1024,
  filter: (req, res) => {
    if (req.headers['upgrade']) {
      return false;
    }
    const ua = req.headers['user-agent'] || '';
    if (BOT_UA_RE.test(ua)) {
      return false;
    }
    const contentType = res.getHeader('Content-Type') as string;
    if (contentType && /text|json|javascript|xml|svg/.test(contentType)) {
      return true;
    }
    return compression.filter(req, res);
  }
}));

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false, limit: '2mb' }));

// Cache headers middleware for static assets optimization
app.use((req, res, next) => {
  const url = req.url;
  const ext = url.split('.').pop()?.toLowerCase();
  
  // Apply cache headers for static assets
  if (ext && ['js', 'css', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'woff', 'woff2', 'ttf', 'eot', 'otf', 'json', 'xml'].includes(ext)) {
    // 1 year cache for static assets
    if (url.includes('/assets/') || url.includes('-') || url.includes('.min.')) {
      // Immutable cache for hashed/versioned assets
      res.set({
        'Cache-Control': 'public, max-age=31536000, immutable', // 1 year + immutable
        'Expires': new Date(Date.now() + 31536000 * 1000).toUTCString()
      });
    } else {
      // Long cache with revalidation for non-hashed assets  
      res.set({
        'Cache-Control': 'public, max-age=31536000, must-revalidate', // 1 year with revalidation
        'Expires': new Date(Date.now() + 31536000 * 1000).toUTCString()
      });
    }
    
    // Security headers for static assets
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Vary': 'Accept-Encoding'
    });
  }
  
  next();
});

// Chromecast receiver - serve with CORS headers (required by Google Cast SDK)
app.use('/cast-receiver', (req, res, next) => {
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Range',
    'Cache-Control': 'public, max-age=3600',
  });
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
}, express.static(path.resolve(process.cwd(), "client/public/cast-receiver"), {
  etag: true,
  lastModified: true,
}));

// Serve static files from public directory (for images, etc.)
const publicPath = path.resolve(process.cwd(), "public");
app.use(express.static(publicPath, {
  etag: true,
  lastModified: true,
  setHeaders: (res, path) => {
    // Additional security headers
    res.set('X-Content-Type-Options', 'nosniff');
  }
}));

// Serve station images from images directory with optimized caching
const imagesPath = path.resolve(process.cwd(), "images");
app.use('/station-images', express.static(imagesPath, {
  etag: true,
  lastModified: true,
  setHeaders: (res, path) => {
    // Long cache for station images (24 hours with revalidation)
    res.set({
      'Cache-Control': 'public, max-age=86400, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
      'Vary': 'Accept-Encoding'
    });
  }
}));

// Serve optimized station logos from station-logos directory (WebP assets)
const stationLogosPath = path.resolve(process.cwd(), "station-logos");
app.use('/station-logos', express.static(stationLogosPath, {
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    // Long cache for station logos (1 year for immutable WebP files)
    res.set({
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Vary': 'Accept-Encoding'
    });
  }
}));

// Session configuration - optimized for production HTTPS with MongoDB store
// Enhanced for browser tracking prevention compatibility (Safari ITP, Firefox ETP)
// CRITICAL: Replit uses HTTPS even in development, so we detect actual connection type
const isReplit = !!process.env.REPLIT_DOMAINS;
const useSecureCookies = process.env.NODE_ENV === 'production' || isReplit;

const sessionConfig: session.SessionOptions = {
  secret: process.env.SESSION_SECRET || 'radio-station-secret-key-2025',
  resave: false, // Don't save session if unmodified (prevents race conditions)
  saveUninitialized: false, // CRITICAL: Don't save empty sessions - reduces MongoDB bloat
  cookie: {
    secure: useSecureCookies, // HTTPS-only cookies on Replit and production
    httpOnly: true, // Prevent XSS attacks
    maxAge: 3 * 24 * 60 * 60 * 1000, // 3 days (reduced to save MongoDB space)
    sameSite: (process.env.COOKIE_DOMAIN || isReplit) ? 'none' : 'lax',
    domain: process.env.COOKIE_DOMAIN || undefined,
    path: '/' // Cookie available on all paths
  },
  name: 'connect.sid', // Use standard express-session cookie name
  proxy: true, // Trust proxy headers (for Replit/production deployment)
  rolling: false // Don't reset on every request - only extend on actual changes (saves MongoDB writes)
};

logger.log(`🔐 Session config: secure=${useSecureCookies}, isReplit=${isReplit}, NODE_ENV=${process.env.NODE_ENV}`);

// Use MongoDB session store in production for multi-instance deployments
// MemoryStore doesn't work with load-balanced deployments (each instance has its own memory)
const isProduction = process.env.NODE_ENV === 'production' || isReplit;
const mongoUri = process.env.MONGODB_URI || process.env.DATABASE_URL || 'mongodb://localhost:27017/mega';

if (isProduction && mongoUri) {
  // Production: Use MongoDB for session persistence across instances
  sessionConfig.store = MongoStore.create({
    mongoUrl: mongoUri,
    collectionName: 'sessions',
    ttl: 3 * 24 * 60 * 60, // 3 days in seconds (matches cookie maxAge)
    autoRemove: 'native', // Use MongoDB TTL index for automatic cleanup
    touchAfter: 24 * 60 * 60, // Only update session once per 24 hours (reduces writes)
  });
  logger.log('🔐 Using MongoDB session store for production (persistent across instances)');
} else {
  // Development: Use MemoryStore for simplicity
  logger.log('📦 Using MemoryStore for sessions (development mode - users re-login after server restart)');
}

app.use(session(sessionConfig));

app.use((req, res, next) => {
  if (process.env.NODE_ENV === 'production') return next();

  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  initLogCollector();
  
  // CRITICAL: Connect to MongoDB FIRST (required for routes to work)
  await connectToMongoDB();
  
  // CRITICAL: Register routes and get server instance
  const server = await registerRoutes(app);

  // Handle WebSocket upgrades manually to avoid Vite HMR conflicts
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
    // Other paths (like Vite HMR) are handled by Vite's own upgrade handler
  });

  server.timeout = 300000;
  server.keepAliveTimeout = 10000;
  server.headersTimeout = 15000;
  server.maxConnections = 500;
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
        server.close(() => {
          console.log('✅ HTTP server closed');
          resolve();
        });
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

  // Error handler middleware
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    if (!res.headersSent) {
      res.status(status).json({ message });
    }
    console.error(`❌ Express error [${status}]: ${message}`);
  });

  // SEO middleware for all pages BEFORE Vite catch-all
  const { SeoRenderer } = await import('./seo-renderer');
  const seoRenderer = new SeoRenderer();

  // Build SEO regex patterns dynamically from URL_TRANSLATIONS (covers all 57 languages)
  const { URL_TRANSLATIONS: seoUrlTranslations } = await import('../shared/url-translations');
  function collectSeoTranslations(englishKey: string): string[] {
    const vals = new Set<string>();
    vals.add(englishKey);
    for (const lang of Object.keys(seoUrlTranslations)) {
      const val = (seoUrlTranslations as any)[lang]?.[englishKey];
      if (val) vals.add(val);
    }
    return [...vals].map(v => v.replace(/[.*+?${}()|[\]\\]/g, '\\$&'));
  }

  const seoStationPluralAlts = collectSeoTranslations('stations');
  const seoStationSingularAlts = collectSeoTranslations('station');
  const seoStationAllAlts = [...new Set([...seoStationPluralAlts, ...seoStationSingularAlts])];
  const seoGenreAlts = collectSeoTranslations('genres');
  const seoAboutAlts = collectSeoTranslations('about');
  const seoContactAlts = collectSeoTranslations('contact');
  const seoPrivacyAlts = collectSeoTranslations('privacy-policy');
  const seoRegionAlts = collectSeoTranslations('regions');

  const SEO_PRECOMPILED_REGEX = {
    stationPage: new RegExp(`^\\/([a-z]{2}\\/)?(?:${seoStationAllAlts.join('|')})\\/`, 'u'),
    homepage: /^\/([a-z]{2}\/?)?$/,
    regionsPage: new RegExp(`^\\/([a-z]{2}\\/?)?(?:${seoRegionAlts.join('|')})(\\/.*)?$`, 'u'),
    genresPage: new RegExp(`^\\/([a-z]{2}\\/?)?(?:${seoGenreAlts.join('|')})\\/?(.*)$`, 'u'),
    aboutPage: new RegExp(`^\\/([a-z]{2}\\/?)?(?:${seoAboutAlts.join('|')})\\/?$`, 'u'),
    contactPage: new RegExp(`^\\/([a-z]{2}\\/?)?(?:${seoContactAlts.join('|')})\\/?$`, 'u'),
    privacyPage: new RegExp(`^\\/([a-z]{2}\\/?)?(?:${seoPrivacyAlts.join('|')})\\/?$`, 'u'),
    countryPage: /^\/([a-z]{2}\/?)?country\/.+$/u,
    stationsPage: new RegExp(`^\\/([a-z]{2}\\/?)?(?:${seoStationAllAlts.join('|')})\\/?$`, 'u'),
    botDetect: /\b(googlebot|bingbot|slurp|duckduckbot|baiduspider|yandexbot|sogou|facebookexternalhit|twitterbot|linkedinbot|whatsapp|telegram|skype|pinterestbot|redditbot|crawler|spider|seobility|semrush|ahrefs|mozbot|majestic|screaming|frog|nutch|fastcrawler|genieo|demandbase)\b/i
  };

  const botRateLimitMap = new Map<string, { count: number; resetAt: number }>();
  const BOT_RATE_LIMIT_WINDOW = 60_000;
  const isDev = process.env.NODE_ENV !== 'production';
  const BOT_RATE_LIMIT_MAX_MINOR = isDev ? 500 : 60;
  const BOT_RATE_LIMIT_MAX_MAJOR = isDev ? 500 : 300;
  const MAJOR_SEARCH_BOT_RE = /\b(googlebot|bingbot|yandexbot|slurp|duckduckbot|baiduspider)\b/i;

  setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of botRateLimitMap) {
      if (now > entry.resetAt) botRateLimitMap.delete(ip);
    }
  }, 60_000);

  app.use(async (req, res, next) => {
    const url = req.originalUrl;
    const userAgent = req.get('user-agent') || '';
    const acceptsHtml = req.headers.accept?.includes('text/html');
    
    const cleanUrlForMatching = decodeURIComponent(url.split('?')[0].split('#')[0]);
    
    const isStationPage = SEO_PRECOMPILED_REGEX.stationPage.test(cleanUrlForMatching);
    const isHomepage = SEO_PRECOMPILED_REGEX.homepage.test(cleanUrlForMatching);
    const isRegionsPage = SEO_PRECOMPILED_REGEX.regionsPage.test(cleanUrlForMatching);
    const isGenresPage = SEO_PRECOMPILED_REGEX.genresPage.test(cleanUrlForMatching);
    const isAboutPage = SEO_PRECOMPILED_REGEX.aboutPage.test(cleanUrlForMatching);
    const isContactPage = SEO_PRECOMPILED_REGEX.contactPage.test(cleanUrlForMatching);
    const isPrivacyPage = SEO_PRECOMPILED_REGEX.privacyPage.test(cleanUrlForMatching);
    const isCountryPage = SEO_PRECOMPILED_REGEX.countryPage.test(cleanUrlForMatching);
    const isStationsPage = SEO_PRECOMPILED_REGEX.stationsPage.test(cleanUrlForMatching);
    
    const isSeoEligiblePage = isStationPage || isHomepage || isRegionsPage || isGenresPage || isAboutPage || isContactPage || isPrivacyPage || isCountryPage || isStationsPage;
    const isBot = SEO_PRECOMPILED_REGEX.botDetect.test(userAgent);

    if (!isSeoEligiblePage) {
      return next();
    }

    if (!isBot) {
      return next();
    }

    const isMajorBot = MAJOR_SEARCH_BOT_RE.test(userAgent);
    const maxRequests = isMajorBot ? BOT_RATE_LIMIT_MAX_MAJOR : BOT_RATE_LIMIT_MAX_MINOR;
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    let botEntry = botRateLimitMap.get(clientIp);
    if (!botEntry || now > botEntry.resetAt) {
      botEntry = { count: 0, resetAt: now + BOT_RATE_LIMIT_WINDOW };
      botRateLimitMap.set(clientIp, botEntry);
    }
    botEntry.count++;
    if (botEntry.count > maxRequests) {
      logger.log(`🚫 SEO: Bot rate limited (IP=${clientIp}, count=${botEntry.count}, major=${isMajorBot}): ${url}`);
      res.status(429).set({ 'Retry-After': '60' }).send('Too Many Requests');
      return;
    }

    const cleanUrl = url.split('?')[0].split('#')[0];
    const cachedHtml = performanceCache.getSeoHtml(cleanUrl);
    if (cachedHtml) {
      logger.log(`⚡ SEO: Cache HIT for: ${url}`);
      res.status(200).set({
        'Content-Type': 'text/html',
        'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=3600',
        'X-SEO-Cache': 'HIT'
      }).send(cachedHtml);
      return;
    }

    logger.log(`🤖 SEO: Bot detected, rendering server-side SEO page: ${url}`);

    let responded = false;
    const safeNext = () => {
      if (!responded && !res.headersSent) {
        responded = true;
        clearTimeout(reqTimeout);
        next();
      }
    };

    const reqTimeout = setTimeout(() => {
      logger.log(`⏰ SEO request timeout, falling back to SPA: ${url}`);
      safeNext();
    }, 15000);

    try {
      // Detect production domain based on environment
      const getProductionDomain = (requestHost: string = ''): string => {
        // CRITICAL SEO FIX: ALWAYS use themegaradio.com as the PRIMARY domain
        // This ensures consistent canonical URLs across all requests and prevents:
        // - Bing indexing rejection (canonical pointing to wrong domain)
        // - Duplicate content penalties
        // - Split link equity between domains
        return 'https://themegaradio.com';
      };

      const productionDomain = getProductionDomain(req.get('host'));
      
      // For OG images: use actual request host (enables WhatsApp preview testing in dev)
      // SEO canonical URLs still use themegaradio.com
      const actualHost = req.get('host') || 'themegaradio.com';
      const ogImageDomain = actualHost.includes('replit') ? `https://${actualHost}` : productionDomain;
      
      // Parse preferredLanguage from cookie for SSR language/country separation
      // Supports 2-5 letter codes and hyphenated codes like 'pt-br'
      const cookieHeader = req.headers.cookie || '';
      const preferredLanguageMatch = cookieHeader.match(/preferredLanguage=([a-z]{2,5}(?:-[a-z]{2})?)/i);
      const preferredLanguage = preferredLanguageMatch ? preferredLanguageMatch[1].toLowerCase() : undefined;
      
      // Use seoRenderer to generate page-specific meta tags for any page type
      const seoData = await seoRenderer.renderStaticPage(url, productionDomain, preferredLanguage);
      // Override domain for OG images in dev environment (enables WhatsApp testing).
      // CRITICAL: seoData.seoTags is shared from a `useClones: false` cache and
      // is frozen on write — clone before overriding to avoid corrupting other
      // requests' cached SEO data.
      const seoTags = { ...seoData.seoTags, domain: ogImageDomain };
      const pageType = seoData.pageData?.pageType || 'unknown';
      const identifier = seoData.pageData?.station?.name || pageType;
      logger.log(`📄 SEO: Generated meta tags for ${pageType} page: ${identifier}`);
      
      // Create the enhanced HTML template with SEO data
      const htmlContent = `<!DOCTYPE html>
<html lang="${seoData.language}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1" />
    
    <!-- SEO Meta Tags, Hreflang, JSON-LD (WebSite, Organization, FAQPage, RadioStation, ItemList) -->
    ${seoRenderer.generateHtmlHead(seoTags, seoData.language, seoData.translations || {}, seoData.cleanPath, seoData.pageData?.station, seoData.urlTranslations, seoData.pageData)}
    
    <!-- Favicon and Apple Touch Icons -->
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon.png">
    <link rel="icon" type="image/png" sizes="16x16" href="/favicon.png">
    <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
    
    <!-- Web App Manifest -->
    <link rel="manifest" href="/manifest.json">
    
    <!-- Mobile and PWA Meta Tags -->
    <meta name="apple-mobile-web-app-title" content="Mega Radio">
    <!-- CRITICAL for Safari iOS background audio: prevent PWA mode -->
    <meta name="apple-mobile-web-app-capable" content="no" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <meta name="mobile-web-app-capable" content="yes">
    <meta name="application-name" content="Mega Radio">
    <meta name="msapplication-TileColor" content="#1a1a2e">
    <meta name="msapplication-TileImage" content="/apple-touch-icon.png">
    
    <!-- Core Web Vitals Performance Optimizations -->
    <!-- Local fonts from /public/fonts/ - no external CDN requests -->
    <link rel="preload" as="font" type="font/ttf" href="/fonts/ubuntu-400.ttf" crossorigin>
    <link rel="preload" as="font" type="font/ttf" href="/fonts/ubuntu-700.ttf" crossorigin>
    <link rel="preconnect" href="https://unpkg.com" crossorigin>
    <link rel="dns-prefetch" href="https://flagcdn.com">
    <link rel="dns-prefetch" href="https://api.ipify.org">
    
    <!-- Critical above-the-fold CSS - INLINED FOR FCP OPTIMIZATION -->
    <style>
      /* Critical foundation styles */
      body { 
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Helvetica Neue', Arial, sans-serif;
        margin: 0; padding: 0; background-color: #0a0a0a; color: #ffffff; line-height: 1.5;
        font-display: swap; /* Ensure text visibility during font load */
      }
      *, *::before, *::after { box-sizing: border-box; }
      img { height: auto; max-width: 100%; display: block; }
      
      /* Container and layout critical styles */
      .container-critical { max-width: 1200px; margin: 0 auto; padding: 0 1rem; }
      .container { max-width: 1200px; margin: 0 auto; padding: 0 1rem; }
      
      /* Hero section critical styles to prevent layout shift */
      .hero-container { min-height: 500px; position: relative; overflow: hidden; }
      
      /* Critical button and interactive element styles */
      button { font-family: inherit; }
      a { color: inherit; text-decoration: none; }
      
      /* Critical grid layouts to prevent CLS */
      .grid-stations { display: grid; grid-template-columns: 1fr; gap: 1rem; }
      @media (min-width: 640px) { .grid-stations { grid-template-columns: repeat(2, 1fr); } }
      @media (min-width: 768px) { .grid-stations { grid-template-columns: repeat(3, 1fr); } }
      
      /* Critical loading states to prevent layout shifts */
      .skeleton-placeholder { background: #404040; border-radius: 0.5rem; animation: pulse 2s infinite; }
      @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
    </style>
    
    ${pageType === 'station' && seoData.pageData?.station ? `
    <!-- Structured Data (JSON-LD) for Radio Station Page -->
    <script type="application/ld+json">
    ${JSON.stringify({
      "@context": "https://schema.org",
      "@type": "BroadcastService",
      "name": seoData.pageData.station.name,
      "url": seoTags.canonical || '',
      "description": seoTags.description,
      "broadcastFrequency": "Internet Streaming",
      ...(seoData.pageData.station.country ? { "areaServed": { "@type": "Country", "name": seoData.pageData.station.country } } : {}),
      "provider": {
        "@type": "Organization",
        "name": "Mega Radio",
        "url": "https://themegaradio.com"
      },
      "potentialAction": {
        "@type": "ListenAction",
        "target": seoTags.canonical || ''
      }
    })}
    </script>` : ''}
  </head>
  <body>
    <!-- React App Root -->
    <div id="root">
      <!-- SEO Server-Rendered Content (hidden when React loads) -->
      <div id="ssr-content">
        ${seoRenderer.generateHtmlBody({
          pageType: seoData.pageData?.pageType || 'home',
          language: seoData.language,
          translations: seoData.translations,
          seoTags: seoTags,
          stationData: seoData.pageData?.station,
          additionalData: seoData.pageData?.additionalData || {}
        })}
      </div>
    </div>
    <!-- SSR-only: No React script for bots — pure HTML for reliable indexing -->
  </body>
</html>`;

      if (!responded && !res.headersSent) {
        responded = true;
        clearTimeout(reqTimeout);
        performanceCache.setSeoHtml(cleanUrl, htmlContent);
        res.status(200).set({
          'Content-Type': 'text/html',
          'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=3600',
          'X-SEO-Cache': 'MISS'
        }).send(htmlContent);
      }
    } catch (error: any) {
      if (error?.message === 'SEO_RENDER_OVERLOADED' || error?.message === 'SEO_RENDER_TIMEOUT') {
        logger.log(`⚠️ SEO render ${error.message}, serving minimal HTML: ${url}`);
        if (!responded && !res.headersSent) {
          responded = true;
          clearTimeout(reqTimeout);
          const fallbackJsonLd = JSON.stringify({
            "@context": "https://schema.org",
            "@type": "WebSite",
            "name": "Mega Radio",
            "url": "https://themegaradio.com",
            "description": "Listen to 60,000+ free online radio stations from 120+ countries.",
            "potentialAction": {
              "@type": "SearchAction",
              "target": "https://themegaradio.com/search?q={search_term_string}",
              "query-input": "required name=search_term_string"
            }
          });
          const minimalHtml = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Mega Radio - Free Online Radio</title>
    <meta name="description" content="Listen to 60,000+ free online radio stations from 120+ countries. Stream live radio on Mega Radio.">
    <link rel="canonical" href="https://themegaradio.com${cleanUrl}">
    <script type="application/ld+json">${fallbackJsonLd}</script>
  </head>
  <body>
    <div id="root"><h1>Mega Radio</h1><p>Loading...</p></div>
  </body>
</html>`;
          res.status(503).set({
            'Content-Type': 'text/html',
            'Retry-After': '30',
            'Cache-Control': 'no-cache, no-store'
          }).send(minimalHtml);
          return;
        }
      } else {
        console.error('❌ SEO rendering error:', error);
      }
      safeNext();
    }
  });

  // Apply HTML language middleware BEFORE Vite/static serve
  // This injects language-specific content on the server to prevent flash
  app.use(htmlLangMiddleware);
  
  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    const viteSetupPath = "./vite";
    const { setupVite } = await import(/* @vite-ignore */ viteSetupPath as any);
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // BIND PORT AFTER EVERYTHING IS READY
  const port = parseInt(process.env.PORT || '5000', 10);
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port}`);
    logger.log(`🚀 DEPLOYMENT: Port ${port} bound successfully`);
  });

  // Background tasks: Run cache warming and translation loading AFTER port binding
  // These operations no longer block deployment health checks
  (async () => {
    try {
      // Resume any unfinished bulk AI description jobs from database
      try {
        const { BulkDescriptionJob } = await import('../shared/mongo-schemas');
        const unfinishedJobs = await BulkDescriptionJob.find({ status: 'running' }).sort({ createdAt: -1 }).limit(1);
        
        if (unfinishedJobs.length > 0) {
          const job = unfinishedJobs[0];
          logger.log(`🔄 RESUMING: Found unfinished bulk AI job ${job.jobId}, resuming from station ${job.lastProcessedStationId || 'start'}`);
          
          // Get the routes and resume the job
          const resumeSkip = job.lastProcessedSkip || 0;
          
          // Trigger resume by making internal request (handled by existing job logic)
          // For now, just log that we found it - the route handler will resume it
          logger.log(`📌 Bulk job ${job.jobId} will resume on next manual trigger or server optimization`);
        }
      } catch (resumeError) {
        logger.warn('⚠️ Could not check for unfinished jobs:', (resumeError as Error).message);
      }
      
      // In development, skip ALL heavy cache warmups to prevent OOM in Replit
      // Production (Railway) has enough memory for full warmup
      if (process.env.NODE_ENV === 'development') {
        logger.log('⚡ DEV MODE: All heavy cache warmups skipped (saves ~500MB RAM)');
        logger.log('⚡ Caches will be populated on-demand on first request');
      } else {
        logger.log('🔥 BACKGROUND: Starting LIGHTWEIGHT cache warmup (on-demand for heavy caches)...');
        
        await performanceCache.warmupCaches();
        
        const { precomputeTranslationScripts } = await import('./html-lang-middleware');
        precomputeTranslationScripts();
        
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
          const genres = await Genre.find({ isDiscoverable: true })
            .sort({ stationCount: -1 })
            .limit(13)
            .lean();
          await CacheManagerModule.set('genres:discoverable:all:13', genres, { ttl: 600 });
          logger.log('✅ CACHE: Discoverable genres warmed up');
        } catch (err) {
          logger.warn('⚠️ Discoverable genres warmup failed (will cache on first request)');
        }
        
        logger.log('⚡ SKIPPED: Sitemap translations warmup — will populate on-demand per language');
      }
      
      // Load database country-language mappings for SEO routing
      const { loadDatabaseCountryLanguageMappings } = await import('../shared/seo-config');
      await loadDatabaseCountryLanguageMappings();
      
      // Load database URL translations for multilingual routing
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
      
      // Initialize scheduled cache clear service (runs at 3 AM daily)
      try {
        const { scheduledCacheClearService } = await import('./services/scheduled-cache-clear');
        scheduledCacheClearService.initialize();
        logger.log('✅ BACKGROUND: Scheduled cache clear service initialized');
      } catch (error: any) {
        logger.warn('⚠️ BACKGROUND: Failed to initialize scheduled cache clear:', error.message);
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
      const RSS_WARNING_MB = 3000;
      const RSS_CRITICAL_MB = 4000;
      const RSS_RESTART_MB = 5000;

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
          let streamInfo = '';
          try {
            const { getStreamRegistrySize } = await import('./routes/stream-proxy-routes');
            streamInfo = ` | streams=${getStreamRegistrySize()}`;
          } catch {}
          console.log(`📊 DIAG: rss=${rssMB}MB heap=${heapMB}/${heapTotalMB}MB ext=${externalMB}MB ab=${abMB}MB native≈${nativeMB}MB | conns=${conns}${streamInfo} | handles: ${handleStr}`);
        }

        if (rssMB > RSS_RESTART_MB) {
          try {
            const { forceCloseAllStreams } = await import('./routes/stream-proxy-routes');
            forceCloseAllStreams(`RSS_RESTART rss=${rssMB}MB`);
          } catch {}
          const conns = await getConnectionCount();
          const handles = getHandleDiagnostics();
          const handleStr = Object.entries(handles).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}:${v}`).join(' ');
          console.error(`🔄 RSS RESTART: rss=${rssMB}MB heap=${heapMB}MB ext=${externalMB}MB native≈${nativeMB}MB | conns=${conns} | handles: ${handleStr}`);
          process.kill(process.pid, 'SIGTERM');
          return;
        }

        if (externalMB > 300 || rssMB > RSS_WARNING_MB) {
          try {
            // Under real memory pressure, also force-close ALL streams (not just old ones).
            // Old-only closure left newer streams accumulating external memory during sustained pressure.
            const { forceCloseAllStreams, forceCloseOldStreams, getStreamRegistrySize } = await import('./routes/stream-proxy-routes');
            if (getStreamRegistrySize() > 0) {
              if (externalMB > 500) {
                forceCloseAllStreams(`PRESSURE_ALL rss=${rssMB}MB ext=${externalMB}MB`);
              } else {
                forceCloseOldStreams(5 * 60_000);
              }
            }
          } catch {}
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
            try {
              const { forceCloseAllStreams, getStreamRegistrySize } = await import('./routes/stream-proxy-routes');
              if (getStreamRegistrySize() > 0) {
                forceCloseAllStreams(`MEMORY_CRITICAL rss=${rssMB}MB ext=${externalMB}MB`);
              }
            } catch {}
            console.error(`🚨 MEMORY CRITICAL: rss=${rssMB}MB heap=${heapMB}MB — clearing caches + closing streams + forcing GC`);
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

      const { getActiveOperationsSummary, getGcStats, resetGcStats, initGcTracking } = await import('./utils/operation-tracker');
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
            const gcStats = getGcStats();
            const ops = getActiveOperationsSummary();
            const handles = getHandleDiagnostics();
            const socketCount = (handles['Socket'] || 0) + (handles['TLSSocket'] || 0);
            console.error(`🚨 EVENT LOOP BLOCKED: ${lag}ms | heap=${heapMB}MB rss=${rssMB}MB ext=${extMB}MB native≈${nativeMB}MB sockets=${socketCount} | GC: count=${gcStats.count} max=${gcStats.maxMs}ms total=${gcStats.totalMs}ms | Active: ${ops}`);
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
