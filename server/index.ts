import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import MongoStore from "connect-mongo";
import compression from "compression";

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
import { urlRedirectMiddleware } from './url-redirect-middleware';
import { stationCountryValidator } from './station-country-validator';

const app = express();

// Security: Remove X-Powered-By header to prevent technology stack disclosure
app.disable('x-powered-by');

// Clickjacking Protection: Configurable X-Frame-Options strategy
// DENY = Most secure (page cannot be embedded anywhere)
// SAMEORIGIN = Allow embedding only on same domain (if needed)
function getFrameOptionsHeader(): string {
  // Allow manual override via CLICKJACKING_MITIGATION environment variable
  if (process.env.CLICKJACKING_MITIGATION) {
    return process.env.CLICKJACKING_MITIGATION;
  }
  
  // Default to DENY (most secure) - pages cannot be embedded in iframes
  // This is the strongest protection against clickjacking attacks
  // Change to 'SAMEORIGIN' if you need to allow embedding on same domain
  return 'DENY';
}

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

// CRITICAL: Health check endpoint BEFORE all middleware
// Must respond immediately for Replit deployment health checks
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

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
  res.header('X-Frame-Options', getFrameOptionsHeader()); // Clickjacking protection (DENY = most secure)
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
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://www.clarity.ms https://scripts.clarity.ms https://analytics.ahrefs.com https://cdn.jsdelivr.net https://static.cloudflareinsights.com https://pagead2.googlesyndication.com https://www.gstatic.com https://adservice.google.com https://tpc.googlesyndication.com https://*.adtrafficquality.google https://partner.googleadservices.com https://www.googleadservices.com https://googleads.g.doubleclick.net https://securepubads.g.doubleclick.net https://fundingchoicesmessages.google.com https://consent.google.com https://www.google.com",
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: https: blob:",
    "media-src 'self' https: blob:",
    "connect-src 'self' https: wss:",
    "frame-src 'self' https://pagead2.googlesyndication.com https://tpc.googlesyndication.com https://googleads.g.doubleclick.net https://www.google.com https://*.adtrafficquality.google https://securepubads.g.doubleclick.net https://fundingchoicesmessages.google.com https://consent.google.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "upgrade-insecure-requests"
  ].join('; ');
  
  // Only enforce CSP in production; report-only in development
  if (process.env.NODE_ENV === 'production') {
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

// Redirects old English paths to new translated paths for all languages
// Examples: /de/station/xyz → /de/sender/xyz, /tr/station/xyz → /tr/istasyon/xyz
// Must run BEFORE stationCountryValidator so old URLs get translated first
app.use(urlRedirectMiddleware);

// CRITICAL SEO FIX: Station country code validation middleware
// Prevents duplicate content by redirecting stations with wrong country codes to canonical URLs
// Example: /lb/station/colombian-radio → 301 → /station/colombian-radio
app.use(stationCountryValidator);

// Enable compression for all responses - SEO optimization for faster page loads
app.use(compression({
  level: process.env.NODE_ENV === 'production' ? 9 : 6, // Max compression in production for SEO
  threshold: 512, // Compress responses > 512 bytes (more aggressive)
  filter: (req, res) => {
    // Compress all responses except WebSocket upgrades
    if (req.headers['upgrade']) {
      return false;
    }
    
    // Samsung TV Chromium 76 supports gzip - enable compression for slim TV responses
    // Slim response + gzip gives best performance (e.g. 132KB genres → ~15KB compressed)
    
    // Compress HTML, JSON, CSS, JS, SVG, XML for better SEO performance
    const contentType = res.getHeader('Content-Type') as string;
    if (contentType && /text|json|javascript|xml|svg/.test(contentType)) {
      return true;
    }
    return compression.filter(req, res);
  }
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: false, limit: '50mb' }));

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
    sameSite: isReplit ? 'none' : 'lax', // 'none' for Replit preview iframe compatibility
    domain: undefined, // Allow cookie for current domain and subdomains
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
    }
    // Other paths (like Vite HMR) are handled by Vite's own upgrade handler
  });

  // Configure server timeouts for streaming - EXTENDED FOR RADIO STREAMS
  server.timeout = 0; // Disable timeout for continuous radio streaming
  server.keepAliveTimeout = 14400000; // 4 hours (14400 seconds) keep alive for persistent connections
  server.headersTimeout = 14410000; // Must be longer than keepAliveTimeout (4 hours + 10s)

  // Error handler middleware
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // SEO middleware for all pages BEFORE Vite catch-all
  const { SeoRenderer } = await import('./seo-renderer');
  const seoRenderer = new SeoRenderer();

  app.use(async (req, res, next) => {
    const url = req.originalUrl;
    const userAgent = req.get('user-agent') || '';
    const acceptsHtml = req.headers.accept?.includes('text/html');
    
    // Strip query parameters and hash for pattern matching (but keep original URL for rendering)
    // CRITICAL FIX: Decode URL-encoded paths (e.g., %E7%94%B5%E5%8F%B0 → 电台) for non-Latin language matching
    const cleanUrlForMatching = decodeURIComponent(url.split('?')[0].split('#')[0]);
    
    // Expanded SEO page matching - now includes all major page types
    // CRITICAL FIX: Match both English AND all translated URL segments for multilingual SEO
    // Turkish: istasyon/istasyonlar, turler | German: sender, genres | Spanish: estacion, generos | etc.
    // IMPORTANT: Match both singular and plural forms (istasyon AND istasyonlar, station AND stations, etc.)
    // COMPREHENSIVE station URL matching - includes ALL 57 language translations
    // Latin scripts: station, sender, estacion, stazione, estacao, stacja, stanice, etc.
    // Non-Latin: Chinese (电台), Japanese (ステーション), Korean (라디오/스테이션), Arabic (محطات), etc.
    const isStationPage = cleanUrlForMatching.match(/^\/([a-z]{2}\/)?(?:stations?|istasyons?|istasyonlar|senders?|staziones?|stazioni|estacions?|estaciones|estaçoes?|estacoes?|mahtas?|mahtat|stansiya|stansiyas?|stantsiya|stantsii|radiostations?|radyo-istasyonu|taçhana|tachana|tachanot|stacja|stacje|stanice|statie|statii|stanica|stanice|stacija|stacijas|stotis|stotys|jaam|jaamad|postaja|postaje|asema|asemat|stasjon|stasjoner|stasiun|stasiun-stasiun|dai|stesen|stasie|stasies|radio|isiteshi|nilayam|steshan|stesheni|ραδιόφωνο|σταθμος|σταθμοι|станція|станции|ստdelays|ステーション|라디오|스테이션|电台|電台|محطات|محطة|اسٹیشن|ایستگاه|স্টেশন|સ્ટેશન|ஸ்டேஷன்|நிலையம்|స్టేషన్|ನಿಲ್ದಾಣ|സ്റ്റേഷൻ|ราดียว|สถานี)\//u);
    const isHomepage = cleanUrlForMatching.match(/^\/([a-z]{2}\/?)?$/);
    const isRegionsPage = cleanUrlForMatching.match(/^\/([a-z]{2}\/?)?(?:regions|bolgeler|regionen|regioni|regioes|regiones|manatiq|regionlar|regioni)\/?$/u);
    const isGenresPage = cleanUrlForMatching.match(/^\/([a-z]{2}\/?)?(?:genres|turler|zhanroves|anwaa|janrlar|zhanroves|genres|generos|generi|generos|anwaa)\/?/u);
    const isAboutPage = cleanUrlForMatching.match(/^\/([a-z]{2}\/?)?(?:about|hakkinda|uber|sobre|a-propos|chi-siamo|an|haqqinda|za-nas)\/?/u);
    const isContactPage = cleanUrlForMatching.match(/^\/([a-z]{2}\/?)?(?:contact|iletisim|kontakt|contacto|contatto|ittisal|elaqe|kontakti)\/?/u);
    const isStationsPage = cleanUrlForMatching.match(/^\/([a-z]{2}\/?)?(?:stations|istasyonlar|istasyonlar|sender|stazioni|estacoes|emisoras|mahtat|stansiyalar|stantsii|电台|محطات)$/u);
    
    const isSeoEligiblePage = isStationPage || isHomepage || isRegionsPage || isGenresPage || isAboutPage || isContactPage || isStationsPage;
    // Extended bot detection with word boundaries to prevent false positives (Mozilla shouldn't match)
    const isBot = /\b(googlebot|bingbot|slurp|duckduckbot|baiduspider|yandexbot|sogou|facebookexternalhit|twitterbot|linkedinbot|whatsapp|telegram|skype|pinterestbot|redditbot|crawler|spider|seobility|semrush|ahrefs|mozbot|majestic|screaming|frog|nutch|fastcrawler|genieo|demandbase)\b/i.test(userAgent);

    // Only intercept SEO-eligible pages
    if (!isSeoEligiblePage) {
      return next();
    }

    // Only serve server-rendered HTML to bots for SEO
    // Regular users get the full React app for best UX
    if (!isBot) {
      return next();
    }

    logger.log(`🤖 SEO: Bot detected, rendering server-side SEO page: ${url}`);

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
      // Override domain for OG images in dev environment (enables WhatsApp testing)
      seoData.seoTags.domain = ogImageDomain;
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
    ${seoRenderer.generateHtmlHead(seoData.seoTags, seoData.language, seoData.translations || {}, seoData.cleanPath, seoData.pageData?.station, seoData.urlTranslations, seoData.pageData)}
    
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
    {
      "@context": "https://schema.org",
      "@type": "BroadcastService",
      "name": "${seoData.pageData.station.name}",
      "url": "${seoData.seoTags.canonical || ''}",
      "description": "${seoData.seoTags.description}",
      "broadcastFrequency": "Internet Streaming",
      ${seoData.pageData.station.country ? `"areaServed": {
        "@type": "Country",
        "name": "${seoData.pageData.station.country}"
      },` : ''}
      "provider": {
        "@type": "Organization",
        "name": "Mega Radio",
        "url": "https://themegaradio.com"
      },
      "potentialAction": {
        "@type": "ListenAction",
        "target": "${seoData.seoTags.canonical || ''}"
      }
    }
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
          seoTags: seoData.seoTags,
          stationData: seoData.pageData?.station,
          additionalData: seoData.pageData?.additionalData || {}
        })}
      </div>
    </div>
    <!-- CRITICAL: Inject language script to prevent geo-detection override -->
    <script id="initial-translations">
      window.__INITIAL_LANGUAGE__ = "${seoData.language}";
      window.__INITIAL_TRANSLATIONS__ = ${JSON.stringify(seoData.translations || {})};
      window.__PRELOADED__ = true;
    </script>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>`;

      res.status(200).set({ 'Content-Type': 'text/html' }).send(htmlContent);
    } catch (error) {
      console.error('❌ SEO rendering error:', error);
      // Fall back to default behavior
      next();
    }
  });

  // Apply HTML language middleware BEFORE Vite/static serve
  // This injects language-specific content on the server to prevent flash
  app.use(htmlLangMiddleware);
  
  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    // Use computed path to prevent static bundler analysis of vite (devDependency)
    // This ensures vite is never required in production builds
    const viteSetupPath = "./vite";
    const { setupVite } = await import(/* @vite-ignore */ viteSetupPath as any);
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // CRITICAL DEPLOYMENT FIX: Bind port IMMEDIATELY to pass health checks
  // All heavy async operations (cache warming, translations) run in background after this
  const port = parseInt(process.env.PORT || '5000', 10);
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port}`);
    logger.log(`🚀 DEPLOYMENT: Port ${port} bound successfully - health check should pass`);
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
      
      logger.log('🔥 BACKGROUND: Starting cache warmup (non-blocking)...');
      
      // Warm up performance caches for faster SEO response times
      await performanceCache.warmupCaches();
      
      // Warm up precomputed stations cache for ALL countries (ultra-fast /radios page)
      // Runs in background - doesn't block server startup
      try {
        const { PrecomputedStationsService } = await import('./services/precomputed-stations');
        // Start full cache initialization in background (non-blocking)
        PrecomputedStationsService.initializeFullCache().catch(err => 
          console.error('Full precomputed cache initialization failed:', err)
        );
        logger.log('🚀 PRECOMPUTED: Full cache initialization started in background');
      } catch (err) {
        console.error('Precomputed stations warmup failed:', err);
      }
      
      // Warm up similar stations cache (background, non-blocking for main server)
      performanceCache.warmupSimilarStations().catch(err => 
        console.error('Similar stations warmup failed:', err)
      );
      
      // Warm up Community Favorites (public profiles) cache at startup
      try {
        const axios = (await import('axios')).default;
        const warmupPort = process.env.PORT || '5000';
        await axios.get(`http://localhost:${warmupPort}/api/public-profiles`, { timeout: 30000 });
        logger.log('✅ CACHE: Public profiles (Community Favorites) warmed up');
      } catch (err) {
        logger.warn('⚠️ Public profiles warmup failed (will cache on first request)');
      }
      
      // Warm up Discoverable Genres cache at startup (hero section)
      try {
        const axios = (await import('axios')).default;
        await axios.get(`http://localhost:${warmupPort}/api/genres/discoverable`, { timeout: 10000 });
        logger.log('✅ CACHE: Discoverable genres warmed up');
      } catch (err) {
        logger.warn('⚠️ Discoverable genres warmup failed (will cache on first request)');
      }
      
      // Warmup sitemap translations for all enabled languages
      logger.log('🔥 CACHE: Warming up sitemap translations...');
      try {
        const { SEO_LANGUAGES } = await import('../shared/seo-config');
        const { loadSitemapTranslations } = await import('./utils/sitemap-translations');
        const CacheManager = (await import('./cache')).default;
        
        const enabledLanguages = SEO_LANGUAGES.filter(lang => lang.enabled);
        let sitemapTranslationsWarmed = 0;
        
        for (const lang of enabledLanguages) {
          try {
            const sitemapTranslations = await loadSitemapTranslations(lang.code);
            
            await CacheManager.set(
              `sitemap_translations:${lang.code}`, 
              sitemapTranslations,
              { ttl: 3600 } // 1 hour TTL
            );
            sitemapTranslationsWarmed++;
          } catch (error: any) {
            logger.warn(`⚠️ Failed to warm sitemap translations for ${lang.code}:`, error.message);
          }
        }
        
        logger.log(`🔥 CACHE: Warmed up sitemap translations for ${sitemapTranslationsWarmed} languages`);
      } catch (error) {
        console.error('❌ CACHE: Sitemap translation warmup failed:', error);
      }
      
      // Load database country-language mappings for SEO routing
      const { loadDatabaseCountryLanguageMappings } = await import('../shared/seo-config');
      await loadDatabaseCountryLanguageMappings();
      
      // Load database URL translations for multilingual routing
      const { loadDatabaseUrlTranslations } = await import('../shared/url-translations');
      await loadDatabaseUrlTranslations();
      
      // Auto-cleanup: Clean meta descriptions from ALL stations on startup
      // DISABLED: This cleanup was too aggressive and deleting valid content
      // Only clean obvious template patterns that start with brackets
      logger.log('🧹 BACKGROUND: Starting automatic meta description cleanup (safe mode)...');
      try {
        const { Station } = await import('../shared/mongo-schemas');
        const stripPlaceholders = (obj: any): any => {
          if (!obj) return obj;
          
          if (typeof obj === 'string') {
            // SAFE MODE: Only clean obvious template patterns at the START of text
            // Do NOT remove content in the middle of descriptions
            return obj
              .replace(/&quot;/g, '"')
              .replace(/&amp;/g, '&')
              // Only remove bracketed template patterns at the VERY START
              .replace(/^\[TRANSLATED\s+(META|FULL)[^\]]*\]\s*/i, '')
              .replace(/^\[SEO\s+META[^\]]*\]\s*/i, '')
              .replace(/^\[FULL\s+DESCRIPTION[^\]]*\]\s*/i, '')
              .replace(/^\[META[^\]]*\]\s*/i, '')
              .trim();
          }
          
          if (Array.isArray(obj)) {
            return obj.map(item => stripPlaceholders(item));
          }
          
          if (typeof obj === 'object') {
            const cleaned = { ...obj };
            if (cleaned.descriptions && typeof cleaned.descriptions === 'object') {
              cleaned.descriptions = { ...cleaned.descriptions };
              for (const langCode in cleaned.descriptions) {
                const langDesc = cleaned.descriptions[langCode];
                if (typeof langDesc === 'object' && langDesc !== null) {
                  cleaned.descriptions[langCode] = {
                    ...langDesc,
                    full: stripPlaceholders(langDesc.full || ''),
                    meta: stripPlaceholders(langDesc.meta || '')
                  };
                } else if (typeof langDesc === 'string') {
                  cleaned.descriptions[langCode] = stripPlaceholders(langDesc);
                }
              }
            }
            return cleaned;
          }
          return obj;
        };
        
        const allStations = await Station.find({ descriptions: { $exists: true } }).lean();
        let cleanedCount = 0;
        
        logger.log(`🧹 CLEANUP: Found ${allStations.length} stations with descriptions to scan`);
        
        let scannedCount = 0;
        let firstExampleLogged = false;
        let loggedSamples = 0;
        let langCount = 0;
        let metaCount = 0;
        
        for (const station of allStations) {
          scannedCount++;
          if (!station.descriptions) {
            if (loggedSamples === 0) {
              logger.log(`🔍 CLEANUP DEBUG: First station ${station.name} - NO descriptions field`);
              loggedSamples++;
            }
            continue;
          }
          
          if (typeof station.descriptions !== 'object') {
            if (loggedSamples === 1) {
              logger.log(`🔍 CLEANUP DEBUG: First station ${station.name} - descriptions NOT object, type: ${typeof station.descriptions}`);
              loggedSamples++;
            }
            continue;
          }
          
          // Check descriptions structure
          const langCount_local = Object.keys(station.descriptions).length;
          if (langCount_local > 0 && loggedSamples < 3) {
            const firstLang = Object.keys(station.descriptions)[0];
            const firstDesc = station.descriptions[firstLang];
            logger.log(`🔍 SAMPLE: "${station.name}" has ${langCount_local} languages, first lang: ${firstLang}, desc type: ${typeof firstDesc}`);
            if (typeof firstDesc === 'object' && firstDesc !== null) {
              logger.log(`   Fields in first desc: ${Object.keys(firstDesc).join(', ')}`);
              logger.log(`   Meta: ${(firstDesc as any).meta?.substring(0, 80) || 'EMPTY'}`);
            }
            loggedSamples++;
          }
          
          let hasChanges = false;
          const updatedDescriptions: any = {};
          
          // Start with ALL existing descriptions (to avoid losing languages)
          for (const [lang, desc] of Object.entries(station.descriptions)) {
            if (typeof desc === 'object' && desc !== null && 'meta' in desc) {
              let originalMeta = (desc as any).meta || '';
              let originalFull = (desc as any).full || '';
              
              // Log sample before cleanup
              if (loggedSamples < 3 && originalMeta && originalMeta.length > 0) {
                logger.log(`🔍 SAMPLE ${loggedSamples + 1}: "${station.name}" (${lang})`);
                logger.log(`   Meta (first 150): ${originalMeta.substring(0, 150)}`);
                loggedSamples++;
              }
              
              let cleanedMeta = stripPlaceholders(originalMeta);
              let cleanedFull = stripPlaceholders(originalFull);
              
              // Log first cleaned example to debug
              if (!firstExampleLogged && (cleanedMeta !== originalMeta || cleanedFull !== originalFull)) {
                logger.log(`✅ CLEANUP FOUND: Station "${station.name}" (${lang})`);
                logger.log(`   Orig Meta: ${originalMeta.substring(0, 80)}`);
                logger.log(`   Clean Meta: ${cleanedMeta.substring(0, 80)}`);
                firstExampleLogged = true;
              }
              
              if (cleanedMeta !== originalMeta || cleanedFull !== originalFull) {
                hasChanges = true;
              }
              
              // ALWAYS include this language in updatedDescriptions (with cleaned or original)
              updatedDescriptions[lang] = {
                full: cleanedFull,
                meta: cleanedMeta
              };
            } else if (typeof desc === 'string') {
              // Handle string descriptions
              let cleaned = stripPlaceholders(desc);
              if (cleaned !== desc) {
                hasChanges = true;
              }
              updatedDescriptions[lang] = cleaned;
            } else {
              // Keep as-is if not object or string
              updatedDescriptions[lang] = desc;
            }
          }
          
          if (hasChanges) {
            await Station.updateOne(
              { _id: station._id },
              { $set: { descriptions: updatedDescriptions } }
            );
            cleanedCount++;
          }
        }
        
        logger.log(`🧹 CLEANUP: Scanned ${scannedCount} stations, automatically cleaned ${cleanedCount} on startup`);
      } catch (error: any) {
        logger.warn(`⚠️ Automatic cleanup failed:`, error.message);
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
      
      // Scan for new translation keys on startup (no auto-translation, just discovery)
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
    } catch (error) {
      console.error('❌ BACKGROUND: Cache warmup failed:', error);
    }
  })();
})();
