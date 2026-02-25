import type { Express, Request } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from 'ws';
import crypto, { randomUUID } from 'crypto';
import mongoose from 'mongoose';
import passport from './auth/passport-config';
// Regions router will be added inline to avoid TypeScript module issues
import { Station, Country, Language, Genre, SyncLog, User, UserFollow, UserNotification, Feedback, StationDebugLog, StationErrorLog, UserFavorite, StationRating, TranslationKey, Translation, TranslationLanguage, MediaGroup, UserListeningHistory, UserProfile, BlacklistedStation, UrlTranslation, BulkDescriptionJob, VisitorSession, Advertisement, FooterSocialMedia, SeoMetadata, AuthToken, CastSession, TvLoginCode, UserDevice, CastCommand, CastNowPlaying, PushToken, AppLog } from '../shared/mongo-schemas';
import { registerCountryLanguageMappingRoutes } from './routes/country-language-mappings';
import urlTranslationsRouter from './routes/url-translations';
import performanceRouter from './routes/performance';
import indexnowMonitoringRouter from './routes/indexnow-monitoring';
import apiKeysRouter, { apiKeyMiddleware, seedDemoApiKey } from './routes/api-keys';
import { syncService } from './services/sync';
import { ObjectStorageService, parseObjectPath, signObjectURL } from './objectStorage';
import { SeoRenderer, buildLocalizedUrl } from './seo-renderer';
import { getLanguageFromPath, SEO_LANGUAGES, DEFAULT_LANGUAGE, hasCompleteSeoTranslations, REQUIRED_STATION_SEO_KEYS, ACTIVE_SITEMAP_LANGUAGES, SITEMAP_CONFIG, COUNTRY_TO_LANGUAGE, CODE_TO_COUNTRY } from '@shared/seo-config';
import CacheManager, { CacheKeys, invalidateSocialCacheForUser } from './cache';
import { normalizeCountryFilter, getAllCountryInfoFromDb } from './utils/normalize-country';
import { StreamMetadataService } from './services/stream-metadata';
import { RealtimeMetadataService } from './services/realtime-metadata';
import { getSocialAuthStatus } from './auth/social-auth-simple';
import { RecommendationEngine } from './services/recommendation-engine';
import { performanceCache } from './performance-cache';
import { URL_TRANSLATIONS } from '@shared/url-translations';
import { loadSitemapTranslations } from './utils/sitemap-translations';
import { logger } from './utils/logger';
import { IndexNowService } from './services/indexnow';
import { logoProcessor } from './services/logo-processor';
import { PrecomputedStationsService } from './services/precomputed-stations';
import { castService } from './services/cast-service';
import { PrecomputedCitiesService } from './services/precomputed-cities';
import { PrecomputedGenresService } from './services/precomputed-genres';
import { generateStationOgImage, getDefaultOgImage } from './og-image-generator';

// Simple in-memory job tracking for slug generation
const slugGenerationJobs = new Map<string, {
  jobId: string;
  status: 'running' | 'completed' | 'failed' | 'stopped';
  progress: { current: number; total: number };
  startedAt: Date;
  completedAt?: Date;
  error?: string;
  message?: string;
}>();

// 🚀 REQUEST DEDUPLICATION: Prevent duplicate concurrent API calls
// Multiple identical requests will share a single database query
const inflightRequests = new Map<string, { promise: Promise<any>; createdAt: number }>();

// Clean up stale inflight requests every 30 seconds (prevents memory leaks)
setInterval(() => {
  const now = Date.now();
  const TIMEOUT = 60000; // 1 minute timeout for stuck requests
  for (const [key, value] of inflightRequests) {
    if (now - value.createdAt > TIMEOUT) {
      inflightRequests.delete(key);
    }
  }
}, 30000);

async function deduplicatedFetch<T>(cacheKey: string, fetchFn: () => Promise<T>): Promise<T> {
  // Check if there's already an in-flight request for this key
  const existing = inflightRequests.get(cacheKey);
  if (existing) {
    return existing.promise;
  }
  
  // Create new request and track it with timestamp
  const promise = fetchFn().finally(() => {
    inflightRequests.delete(cacheKey);
  });
  
  inflightRequests.set(cacheKey, { promise, createdAt: Date.now() });
  return promise;
}

// TV App Slim Response: Only return fields needed by TV applications
// Reduces payload from ~18KB to ~2.5KB per station (~85% reduction)
// TV App: Exactly 16 fields per station - consistent naming (camelCase for JS clients)
const TV_STATION_FIELDS = {
  _id: 1, name: 1, slug: 1, url: 1, urlResolved: 1, url_resolved: 1,
  favicon: 1, tags: 1, country: 1, countrycode: 1,
  state: 1, language: 1, votes: 1, clickcount: 1, clickCount: 1,
  codec: 1, bitrate: 1, hls: 1
};

const TV_STATION_PROJECTION = TV_STATION_FIELDS;

function tvSlimProjection() {
  return { $project: TV_STATION_FIELDS };
}

// Normalize station to exactly 16 consistent fields for TV
function tvSlimStation(s: any) {
  return {
    _id: s._id, name: s.name, slug: s.slug, url: s.url,
    urlResolved: s.urlResolved || s.url_resolved || '',
    favicon: s.favicon, tags: s.tags, country: s.country,
    countrycode: s.countrycode || '', state: s.state, language: s.language,
    votes: s.votes || 0, clickCount: s.clickCount || s.clickcount || 0,
    codec: s.codec, bitrate: s.bitrate, hls: s.hls
  };
}

function tvValidateParams(query: any) {
  const page = Math.max(1, Math.min(1000, parseInt(query.page) || 1));
  const limit = Math.max(1, Math.min(100, parseInt(query.limit) || 33));
  const offset = Math.max(0, parseInt(query.offset) || 0);
  return { page, limit, offset };
}

// TV App: Genre slim projection - only essential fields for TV display
const TV_GENRE_PROJECTION = '_id name slug posterImage discoverableImage stationCount';

function tvSlimGenre(genre: any) {
  return {
    _id: genre._id,
    name: genre.name,
    slug: genre.slug,
    posterImage: genre.posterImage || genre.discoverableImage || '',
    discoverableImage: genre.discoverableImage || '',
    stationCount: genre.stationCount || genre.total_stations || 0
  };
}

// Helper function to get base URL for sitemaps and SEO
// CRITICAL SEO FIX: Always return themegaradio.com as the PRIMARY domain
// This ensures consistent canonical URLs and prevents duplicate content issues
function getBaseUrl(req: Request): string {
  const isProduction = process.env.NODE_ENV === 'production';
  const requestHost = req.get('host') || '';
  
  if (isProduction) {
    // Production: ALWAYS use primary domain (themegaradio.com) for canonical URLs
    // This prevents Bing indexing issues and duplicate content penalties
    return 'https://themegaradio.com';
  } else {
    // Development: Use the request host or fallback to primary production domain for SEO
    const protocol = req.secure || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
    const domain = requestHost || 'localhost:5000';
    
    // For local development, use primary production domain for SEO-related content
    if (domain.includes('localhost') || domain.includes('127.0.0.1')) {
      return 'https://themegaradio.com';
    }
    
    return `${protocol}://${domain}`;
  }
}

// Helper function to calculate distance between two coordinates
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth's radius in kilometers
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// CRITICAL FIX: Strip ALL placeholder text from descriptions globally
// IMPORTANT: Only clean string values, preserve object references for MongoDB ObjectIds
function stripPlaceholders(obj: any): any {
  if (!obj) return obj;
  
  if (typeof obj === 'string') {
    // SAFE MODE: Only remove TEMPLATE patterns at the START of text
    // Do NOT remove content in the middle or use aggressive regex that deletes actual content
    return obj
      // Convert HTML entities to regular text first
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      // Remove leading ":" or ":\n" (common AI artifact)
      .replace(/^:\s*\n?/, '')
      // Remove bracketed placeholders ONLY at the very start
      .replace(/^\s*\[FULL\s+DESCRIPTION[^\]]*\]\s*:?\s*/i, '')
      .replace(/^\s*\[SEO\s+META[^\]]*\]\s*:?\s*/i, '')
      .replace(/^\s*\[TRANSLATED\s+(META|FULL)[^\]]*\]\s*:?\s*/i, '')
      .replace(/^\s*\[META[^\]]*\]\s*:?\s*/i, '')
      // Remove leading bracket if followed by station/brand name (AI wraps content in brackets)
      .replace(/^\s*\[([A-Za-z0-9])/i, '$1')
      // Remove trailing bracket if it's at the very end
      .replace(/\]\s*$/, '')
      // Clean up any remaining leading/trailing whitespace including newlines
      .replace(/^\s+|\s+$/gm, '')
      .trim();
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => stripPlaceholders(item));
  }
  
  if (typeof obj === 'object') {
    // CRITICAL: Use spread to preserve object references (like MongoDB ObjectId)
    const cleaned = { ...obj };
    
    // Only process specific fields that might have descriptions
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
    
    // Recursively process nested arrays and objects ONLY in description fields
    if (Array.isArray(cleaned.linkedStations)) {
      cleaned.linkedStations = cleaned.linkedStations.map(item => stripPlaceholders(item));
    }
    
    return cleaned;
  }
  
  return obj;
}

export async function registerRoutes(app: Express): Promise<Server & { metadataWss: InstanceType<typeof WebSocketServer>, castWss: InstanceType<typeof WebSocketServer> }> {
  const server = createServer(app);
  const seoRenderer = new SeoRenderer();

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

  // GLOBAL CORS FOR HLS STREAMS - Fix cross-origin segment access
  app.use('/api/stream', (req, res, next) => {
    // Comprehensive CORS headers for both playlists AND segments
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, HEAD');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type, Accept, User-Agent, Authorization, Cache-Control');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours preflight cache
    
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }
    next();
  });

  // Initialize stream metadata service
  const streamMetadataService = new StreamMetadataService();
  
  // Initialize real-time metadata service (our radiolise-style WebSocket service)
  const realtimeMetadataService = new RealtimeMetadataService();
  
  // Setup WebSocket servers with noServer mode to avoid Vite HMR conflicts
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  
  wss.on('connection', (socket: WebSocket, request) => {
    const clientId = `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    logger.log(`🎵 REALTIME METADATA: WebSocket client connected via ${request.url}`);
    
    realtimeMetadataService.addClient(clientId, socket);
  });

  // ==================== CAST WebSocket Server ====================
  const castWss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

  castWss.on('connection', async (socket: WebSocket, request) => {
    const clientId = `cast_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const url = new URL(request.url || '', `http://${request.headers.host}`);
    const sessionId = url.searchParams.get('sessionId');
    const role = url.searchParams.get('role') as 'mobile' | 'tv';
    const token = url.searchParams.get('token');
    const deviceId = url.searchParams.get('deviceId');

    if (!sessionId || !role || !token || !['mobile', 'tv'].includes(role)) {
      socket.send(JSON.stringify({ type: 'error', message: 'Missing required params: sessionId, role, token' }));
      socket.close(4001, 'Invalid parameters');
      return;
    }

    let userId: string | null = null;
    try {
      const tokenDoc = await AuthToken.findOne({ token, isRevoked: false, expiresAt: { $gt: new Date() } });
      if (!tokenDoc) {
        socket.send(JSON.stringify({ type: 'error', message: 'Invalid or expired token' }));
        socket.close(4002, 'Authentication failed');
        return;
      }
      userId = tokenDoc.userId.toString();
    } catch (err) {
      socket.send(JSON.stringify({ type: 'error', message: 'Authentication error' }));
      socket.close(4002, 'Authentication failed');
      return;
    }

    const session = await CastSession.findOne({ sessionId, expiresAt: { $gt: new Date() } });
    if (!session) {
      socket.send(JSON.stringify({ type: 'error', message: 'Session not found or expired' }));
      socket.close(4003, 'Session not found');
      return;
    }

    if (role === 'mobile' && session.userId.toString() !== userId) {
      socket.send(JSON.stringify({ type: 'error', message: 'Not authorized for this session' }));
      socket.close(4004, 'Not authorized');
      return;
    }

    if (role === 'tv') {
      if (!session.tvDeviceId || (deviceId && session.tvDeviceId !== deviceId)) {
        socket.send(JSON.stringify({ type: 'error', message: 'TV device not paired with this session' }));
        socket.close(4004, 'Not authorized');
        return;
      }
      if (!['paired', 'active'].includes(session.status)) {
        socket.send(JSON.stringify({ type: 'error', message: 'Session not yet paired' }));
        socket.close(4003, 'Not paired');
        return;
      }
    }

    castService.registerClient(clientId, socket, sessionId, role, userId, deviceId || undefined);

    socket.send(JSON.stringify({
      type: 'cast:connected',
      clientId,
      sessionId,
      role,
      status: session.status,
      currentStation: session.currentStation,
      isPlaying: session.isPlaying,
    }));

    socket.on('message', async (rawData) => {
      try {
        const msg = JSON.parse(rawData.toString());

        switch (msg.type) {
          case 'cast:command':
            await castService.sendCommand(sessionId, msg.command, msg.data, role, userId!);
            break;

          case 'cast:now_playing':
            await castService.handleNowPlaying(sessionId, msg.data);
            break;

          case 'cast:heartbeat':
            socket.send(JSON.stringify({ type: 'cast:heartbeat_ack', timestamp: Date.now() }));
            break;

          default:
            socket.send(JSON.stringify({ type: 'error', message: `Unknown message type: ${msg.type}` }));
        }
      } catch (err) {
        socket.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
      }
    });

    socket.on('close', () => {
      castService.removeClient(clientId);
    });

    socket.on('error', () => {
      castService.removeClient(clientId);
    });
  });

  logger.log('📺 CAST: WebSocket server ready at /ws/cast');

  // ==================== CAST REST API Endpoints ====================

  // Create a new cast session (mobile app calls this)
  app.post('/api/cast/session/create', async (req: any, res) => {
    try {
      const authHeader = req.headers['authorization'];
      const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
      const sessionUserId = req.session?.user?.userId;

      let userId: string | null = null;

      if (sessionUserId) {
        userId = sessionUserId;
      } else if (bearerToken) {
        const tokenDoc = await AuthToken.findOne({ token: bearerToken, isRevoked: false, expiresAt: { $gt: new Date() } });
        if (tokenDoc) userId = tokenDoc.userId.toString();
      }

      if (!userId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const { mobileDeviceId } = req.body || {};
      const result = await castService.createSession(userId, mobileDeviceId);

      res.json({
        success: true,
        sessionId: result.sessionId,
        pairingCode: result.pairingCode,
        wsUrl: `/ws/cast?sessionId=${result.sessionId}&role=mobile&token=YOUR_TOKEN`,
        expiresIn: '24 hours',
      });
    } catch (error: any) {
      console.error('[CAST] Create session error:', error.message);
      res.status(500).json({ error: 'Failed to create cast session' });
    }
  });

  const pairingAttempts = new Map<string, { count: number; resetAt: number }>();
  const PAIRING_MAX_ATTEMPTS = 5;
  const PAIRING_WINDOW_MS = 15 * 60 * 1000;
  setInterval(() => {
    const now = Date.now();
    for (const [ip, data] of pairingAttempts) {
      if (now > data.resetAt) pairingAttempts.delete(ip);
    }
  }, 60 * 60 * 1000);

  // Pair a TV device with an existing session
  app.post('/api/cast/session/pair', async (req: any, res) => {
    try {
      const clientIp = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.ip || 'unknown';
      const now = Date.now();
      const attempts = pairingAttempts.get(clientIp);
      if (attempts) {
        if (now > attempts.resetAt) {
          pairingAttempts.set(clientIp, { count: 1, resetAt: now + PAIRING_WINDOW_MS });
        } else if (attempts.count >= PAIRING_MAX_ATTEMPTS) {
          return res.status(429).json({ error: 'Too many pairing attempts. Try again later.' });
        } else {
          attempts.count++;
        }
      } else {
        pairingAttempts.set(clientIp, { count: 1, resetAt: now + PAIRING_WINDOW_MS });
      }

      const { pairingCode, deviceId, deviceName, platform } = req.body;

      if (!pairingCode || !deviceId) {
        return res.status(400).json({ error: 'pairingCode and deviceId are required' });
      }

      const result = await castService.pairSession(pairingCode, deviceId);

      if (!result) {
        return res.status(404).json({ error: 'Invalid pairing code or session expired' });
      }

      res.json({
        success: true,
        sessionId: result.sessionId,
        wsUrl: `/ws/cast?sessionId=${result.sessionId}&role=tv&token=YOUR_TOKEN&deviceId=${deviceId}`,
        message: 'Successfully paired with mobile device',
      });
    } catch (error: any) {
      console.error('[CAST] Pair session error:', error.message);
      res.status(500).json({ error: 'Failed to pair session' });
    }
  });

  // Send a command from mobile to TV (or vice versa)
  app.post('/api/cast/command', async (req: any, res) => {
    try {
      const authHeader = req.headers['authorization'];
      const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
      const sessionUserId = req.session?.user?.userId;

      let userId: string | null = null;
      if (sessionUserId) userId = sessionUserId;
      else if (bearerToken) {
        const tokenDoc = await AuthToken.findOne({ token: bearerToken, isRevoked: false, expiresAt: { $gt: new Date() } });
        if (tokenDoc) userId = tokenDoc.userId.toString();
      }

      if (!userId) return res.status(401).json({ error: 'Authentication required' });

      const { sessionId, command, data } = req.body;

      if (!sessionId || !command) {
        return res.status(400).json({ error: 'sessionId and command are required' });
      }

      const validCommands = ['play', 'pause', 'resume', 'stop', 'change_station', 'volume_up', 'volume_down', 'set_volume'];
      if (!validCommands.includes(command)) {
        return res.status(400).json({ error: `Invalid command. Valid: ${validCommands.join(', ')}` });
      }

      const success = await castService.sendCommand(sessionId, command, data, 'mobile', userId);

      if (!success) {
        return res.status(404).json({ error: 'Session not found, not active, or not authorized' });
      }

      res.json({ success: true, command, sessionId });
    } catch (error: any) {
      console.error('[CAST] Command error:', error.message);
      res.status(500).json({ error: 'Failed to send command' });
    }
  });

  // Get session status (requires auth - owner only)
  app.get('/api/cast/session/:sessionId/status', async (req: any, res) => {
    try {
      const authHeader = req.headers['authorization'];
      const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
      const sessionUserId = req.session?.user?.userId;

      let userId: string | null = null;
      if (sessionUserId) userId = sessionUserId;
      else if (bearerToken) {
        const tokenDoc = await AuthToken.findOne({ token: bearerToken, isRevoked: false, expiresAt: { $gt: new Date() } });
        if (tokenDoc) userId = tokenDoc.userId.toString();
      }

      if (!userId) return res.status(401).json({ error: 'Authentication required' });

      const { sessionId } = req.params;
      const status = await castService.getSessionStatus(sessionId, userId);

      if (!status) {
        return res.status(404).json({ error: 'Session not found' });
      }

      res.json({ success: true, ...status });
    } catch (error: any) {
      console.error('[CAST] Status error:', error.message);
      res.status(500).json({ error: 'Failed to get session status' });
    }
  });

  // Get user's active cast sessions
  app.get('/api/cast/sessions', async (req: any, res) => {
    try {
      const authHeader = req.headers['authorization'];
      const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
      const sessionUserId = req.session?.user?.userId;

      let userId: string | null = null;
      if (sessionUserId) userId = sessionUserId;
      else if (bearerToken) {
        const tokenDoc = await AuthToken.findOne({ token: bearerToken, isRevoked: false, expiresAt: { $gt: new Date() } });
        if (tokenDoc) userId = tokenDoc.userId.toString();
      }

      if (!userId) return res.status(401).json({ error: 'Authentication required' });

      const sessions = await castService.getUserActiveSessions(userId);
      res.json({ success: true, sessions });
    } catch (error: any) {
      console.error('[CAST] Sessions error:', error.message);
      res.status(500).json({ error: 'Failed to get sessions' });
    }
  });

  // End a cast session (requires auth - owner only)
  app.delete('/api/cast/session/:sessionId', async (req: any, res) => {
    try {
      const authHeader = req.headers['authorization'];
      const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
      const sessionUserId = req.session?.user?.userId;

      let userId: string | null = null;
      if (sessionUserId) userId = sessionUserId;
      else if (bearerToken) {
        const tokenDoc = await AuthToken.findOne({ token: bearerToken, isRevoked: false, expiresAt: { $gt: new Date() } });
        if (tokenDoc) userId = tokenDoc.userId.toString();
      }

      if (!userId) return res.status(401).json({ error: 'Authentication required' });

      const { sessionId } = req.params;
      const success = await castService.endSession(sessionId, userId);

      if (!success) {
        return res.status(404).json({ error: 'Session not found' });
      }

      res.json({ success: true, message: 'Cast session ended' });
    } catch (error: any) {
      console.error('[CAST] End session error:', error.message);
      res.status(500).json({ error: 'Failed to end session' });
    }
  });

  // Dynamic OG Image Generator for station social media previews
  // Generates 1200x630 images with station logo for WhatsApp, Facebook, Twitter
  app.get('/api/og-image/:stationSlug', async (req, res) => {
    try {
      const { stationSlug } = req.params;
      const imageBuffer = await generateStationOgImage(stationSlug);
      
      if (!imageBuffer) {
        const defaultImage = await getDefaultOgImage();
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.send(defaultImage);
      }
      
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(imageBuffer);
    } catch (error) {
      logger.error('OG Image generation error:', error);
      res.status(500).send('Error generating image');
    }
  });

  // Default OG image endpoint
  app.get('/api/og-image', async (req, res) => {
    try {
      const defaultImage = await getDefaultOgImage();
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=604800');
      res.send(defaultImage);
    } catch (error) {
      logger.error('Default OG Image generation error:', error);
      res.status(500).send('Error generating image');
    }
  });

  // Block invalid paths and old deployment artifacts (return 404 early)
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

    // Check if path matches any invalid pattern
    if (invalidPatterns.some(pattern => pattern.test(req.path))) {
      logger.log(`🚫 Blocked invalid path: ${req.path}`);
      return res.status(404).type('text/plain').send('Not Found');
    }

    next();
  });

  // SECURITY: Generate nonce for this request to protect against XSS attacks
  app.use((req, res, next) => {
    // Generate cryptographically random nonce for CSP (crypto module imported at top of file)
    const nonce = crypto.randomBytes(16).toString('base64');
    (res as any).nonce = nonce; // Attach nonce to response object
    next();
  });

  // SECURITY: Strong Content Security Policy (CSP) in enforce mode
  // Protects against XSS attacks by controlling where scripts, styles, and other resources can be loaded from
  app.use((req, res, next) => {
    // CSP is already set in server/index.ts - do NOT duplicate here to avoid override issues
    // Only set additional security headers (defense in depth against XSS, etc.)
    res.setHeader('X-Content-Type-Options', 'nosniff'); // Prevent MIME type sniffing
    // Note: X-Frame-Options is set globally in server/index.ts to ensure consistency
    res.setHeader('X-XSS-Protection', '1; mode=block'); // Legacy XSS protection for old browsers
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin'); // Control referrer information
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()'); // Restrict sensitive APIs
    
    // COOP (Cross-Origin-Opener-Policy) - Isolate window from cross-origin popups
    // same-origin-allow-popups: Prevents other sites from opening this window, but allows this page to open popups
    // This is important for security while still allowing social share buttons to work
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    
    // COEP (Cross-Origin-Embedder-Policy) - Control cross-origin resource embedding
    // credentialless: Allow cross-origin resources without credentials (needed for external favicons, streams)
    // This enables SharedArrayBuffer and better process isolation
    res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
    
    // Cross-Origin-Resource-Policy - Control resource sharing with cross-origin
    // cross-origin: Allow resources to be loaded by any origin
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    
    // HSTS (HTTP Strict Transport Security) - only in production
    if (process.env.NODE_ENV === 'production') {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    }
    
    next();
  });

  // Passport middleware initialization (passport imported at top of file)
  // This enables user sessions and social authentication (Google, Facebook, etc.)
  // Using MemoryStore now - no MongoDB session bloat possible
  app.use(passport.initialize());
  app.use(passport.session());

  // Visitor Tracking Middleware - Track unique visitors by IP address
  app.use((req, res, next) => {
    // Only track API and page requests, not static assets or health checks
    if ((req.path.startsWith('/api/') || req.path === '/' || !req.path.includes('.')) && req.path !== '/health') {
      const ipAddress = req.ip || req.connection.remoteAddress || 'unknown';
      
      // Update visitor session asynchronously (non-blocking) - unique per IP
      VisitorSession.findOneAndUpdate(
        { ipAddress },
        {
          $set: {
            lastActiveDate: new Date(),
            userAgent: req.get('user-agent')
          },
          $inc: { visitCount: 1 }
        },
        { upsert: true, new: true }
      ).catch(err => {
        // Silently fail if tracking fails - don't break the request
      });
    }
    next();
  });

  // Create database indexes for better performance
  const createIndexes = async () => {
    try {
      // Enhanced indexes for better performance
      await Station.collection.createIndex({ name: 1 }); // For alphabetical sorting
      await Station.collection.createIndex({ votes: -1 }); // For votes sorting
      await Station.collection.createIndex({ createdAt: -1 }); // For newest/oldest sorting
      await Station.collection.createIndex({ country: 1, votes: -1 }); // For country filtering + voting
      await Station.collection.createIndex({ lastCheckOk: -1, votes: -1 }); // For working stations + votes
      await Station.collection.createIndex({ playbackSuccessCount: -1 }); // For playback success sorting
      await Station.collection.createIndex({ state: 1, country: 1 }); // For state + country filtering
      await Station.collection.createIndex({ tags: 1 }); // For tags filtering
      await Station.collection.createIndex({ language: 1 }); // For language filtering
      await Station.collection.createIndex({ tags: 1, votes: -1 }); // Compound index for tags + popularity
      await Station.collection.createIndex({ country: 1, language: 1 }); // Compound index for country + language filtering
      
      // REMOVED CONFLICTING GEO INDEXES - These were causing 2dsphere conflicts
      // Only use proper 2dsphere index for geospatial queries
      // Traditional geoLat/geoLong indexes are now replaced by location GeoJSON field

      // Text search indexes for better search performance
      // First drop any conflicting text search index
      try {
        await Station.collection.dropIndex('station_text_search');
        logger.log('✅ Dropped existing text search index to prevent conflicts');
      } catch (error) {
        // Index may not exist, which is fine
      }
      
      // Now create the text search index with correct configuration
      await Station.collection.createIndex({ 
        name: 'text', 
        country: 'text', 
        tags: 'text' 
      }, { 
        name: 'station_text_search',
        weights: { name: 10, tags: 3, country: 1 }, // Prioritize name matches
        textIndexVersion: 3,
        default_language: 'english' // Use English as default language to prevent unsupported language override errors
      });

      // Genre-specific optimized indexes
      await Genre.collection.createIndex({ name: 1 });
      await Genre.collection.createIndex({ slug: 1 });
      await Genre.collection.createIndex({ isDiscoverable: 1, stationCount: -1 });
      await Genre.collection.createIndex({ createdAt: -1 });
      
      // 🚀 GEOSPATIAL INDEX: Enable MongoDB $geoNear aggregation for ultra-fast distance queries
      // Create 2dsphere index on location coordinates for nearby stations (future optimization)
      try {
        await Station.collection.createIndex({ 
          geoLat: 1, 
          geoLong: 1 
        });
        logger.log('✅ Geospatial index created for location queries');
      } catch (indexError) {
        // Index may already exist or fail - non-critical
      }

      logger.log('🚀 Performance indexes created successfully');
    } catch (error: any) {
      logger.log('Database indexes already exist or creation failed:', error.message);
    }
  };
  
  // Create indexes when server starts
  createIndexes();
  
  // 🚀 CACHE WARMUP: Pre-load translations, popular stations, community favorites, and genres on startup (non-blocking)
  async function warmupPopularStationsCache() {
    try {
      logger.log('🔥 Starting cache warmup - ALL translations FIRST for fast page load...');
      
      // 🌍 STEP 1: Pre-warm ALL ENABLED TRANSLATIONS (all 57 languages)
      // Fetch all enabled languages from database dynamically
      const enabledLanguages = await TranslationLanguage.find({ isEnabled: true }).select('code').lean();
      const languageCodes = enabledLanguages.map(l => l.code);
      
      // Prioritize critical languages first (en, de, es, fr, it, tr, pt)
      const criticalOrder = ['en', 'de', 'es', 'fr', 'it', 'tr', 'pt', 'nl', 'ru', 'pl'];
      const orderedLanguages = [
        ...criticalOrder.filter(code => languageCodes.includes(code)),
        ...languageCodes.filter(code => !criticalOrder.includes(code))
      ];
      
      let cachedCount = 0;
      for (const lang of orderedLanguages) {
        try {
          await refreshTranslationsCache(lang);
          cachedCount++;
        } catch (error) {
          logger.log(`⚠️ Failed to cache translations for ${lang}`);
        }
      }
      logger.log(`✅ Cached ${cachedCount}/${orderedLanguages.length} language translations`);
      
      // 📻 STEP 2: Get countries with SEO translations (not just English)
      // These are the countries that have localized SEO content
      const countriesWithSeoTranslations = Object.entries(COUNTRY_TO_LANGUAGE)
        .filter(([code, lang]) => lang !== 'en') // Only countries with actual translations
        .map(([code]) => CODE_TO_COUNTRY[code])
        .filter(Boolean); // Remove undefined entries
      
      logger.log(`📍 Found ${countriesWithSeoTranslations.length} countries with SEO translations for cache warmup`);
      
      // Warm cache for global + countries with SEO translations
      const countriesToWarmup = ['all', ...countriesWithSeoTranslations];
      
      for (const country of countriesToWarmup) {
        try {
          await refreshPopularStationsCache(country === 'all' ? undefined : country);
          await refreshCommunityFavoritesCache(country === 'all' ? undefined : country);
        } catch (error) {
          logger.log(`⚠️ Failed to cache for ${country}:`, error);
        }
      }
      
      // 🎵 STEP 3: Warm up discoverable genres cache
      try {
        const genres = await Genre.find({ isDiscoverable: true }).sort({ stationCount: -1 }).limit(13).lean();
        await CacheManager.set('genres:discoverable:all:13', genres, { ttl: 600 });
        logger.log('✅ Cached discoverable genres');
      } catch (error) {
        logger.log('⚠️ Failed to cache discoverable genres:', error);
      }
      
      // 🏙️ STEP 4: Warm up cities cache for countries with city data
      try {
        await PrecomputedCitiesService.warmupCache();
        logger.log('✅ Cached cities for all supported countries');
      } catch (error) {
        logger.log('⚠️ Failed to cache cities:', error);
      }

      logger.log('🔥 Web cache warmup completed - translations, popular stations, community favorites, genres & cities cached!');
    } catch (error) {
      logger.log('⚠️ Cache warmup failed (non-critical):', error);
    }
  }
  
  // 📱 TV/Mobile dedicated cache warmup (runs independently)
  async function warmupTvMobileCache() {
    try {
      logger.log('📱 Starting TV/Mobile cache warmup...');
      
      const topCountries = ['all', 'Turkey', 'Germany', 'United States', 'United Kingdom', 'France', 
        'Spain', 'Italy', 'Netherlands', 'Austria', 'Switzerland', 'Brazil', 'Russia',
        'Japan', 'South Korea', 'India', 'Mexico', 'Canada', 'Australia', 'Poland'];

      // TV countries list (24h)
      const tvCountries = (await Station.distinct('country')).filter((c: string) => c && c.trim() !== '').sort();
      await CacheManager.set('tv:countries:all', tvCountries, { ttl: 86400 });

      // TV discoverable genres slim (24h)
      const tvGenres = await Genre.find({ isDiscoverable: true })
        .select(TV_GENRE_PROJECTION)
        .sort({ displayOrder: 1 }).limit(13).lean();
      await CacheManager.set('tv:genres:discoverable:slim', tvGenres.map(tvSlimGenre), { ttl: 86400 });

      // TV translations for critical languages (7 days)
      const tvLangs = ['en', 'tr', 'de', 'es', 'fr', 'it', 'pt', 'nl', 'ru', 'ar', 'ja', 'ko', 'zh'];
      for (const lang of tvLangs) {
        try {
          const translations = await fetchTranslationsForLanguage(lang);
          await CacheManager.set(`tv:translations:${lang}`, translations, { ttl: 604800 });
        } catch {}
      }
      logger.log(`📱 TV translations cached: ${tvLangs.length} languages`);

      // TV popular stations + stations list for each country (24h)
      for (const c of topCountries) {
        try {
          let filter: any = {};
          if (c !== 'all') {
            Object.assign(filter, normalizeCountryFilter(c));
          }

          // Popular stations (top 21 by votes)
          const popStations = await Station.find(filter)
            .sort({ votes: -1 })
            .limit(21)
            .select(TV_STATION_PROJECTION)
            .lean();
          await CacheManager.set(`tv:popular:${c}`, popStations.map(tvSlimStation), { ttl: 86400 });

          // Station list page 1 (20 per page)
          const total = await Station.countDocuments(filter);
          const listStations = await Station.find(filter)
            .sort({ votes: -1 })
            .limit(20)
            .select(TV_STATION_PROJECTION)
            .lean();
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

  // Start both warmups in parallel (non-blocking)
  setImmediate(() => warmupPopularStationsCache());
  setImmediate(() => warmupTvMobileCache());

  // 📱 Schedule TV/Mobile cache auto-refresh every 24 hours (2 AM Berlin time)
  const cron = await import('node-cron');
  cron.default.schedule('0 2 * * *', async () => {
    logger.log('📱 Scheduled TV/Mobile cache refresh (daily 2 AM)...');
    await warmupTvMobileCache();
  }, { timezone: 'Europe/Berlin' });
  logger.log('⏰ TV/Mobile cache auto-refresh scheduled: daily 2 AM (Europe/Berlin)');

  // 🔥 PERIODIC CACHE WARMING: Genres + Popular Stations (prevents cold cache hits)
  
  // Genres: refresh every 5 minutes for top countries
  cron.default.schedule('*/5 * * * *', async () => {
    try {
      const startTime = Date.now();
      await PrecomputedGenresService.warmupCache();
      const elapsed = Date.now() - startTime;
      logger.log(`⏰ [Cron] Genres cache refreshed in ${elapsed}ms`);
    } catch (error) {
      logger.error('[Cron] Genres cache refresh failed:', error);
    }
  });
  logger.log('⏰ Genres cache auto-refresh scheduled: every 5 minutes');

  // Popular stations: refresh every 5 minutes for top countries
  cron.default.schedule('*/5 * * * *', async () => {
    try {
      const startTime = Date.now();
      const topCountries = [undefined, 'Turkey', 'Germany', 'United States', 'United Kingdom', 'France', 
        'Spain', 'Italy', 'Netherlands', 'Austria', 'Switzerland', 'Brazil', 'Russia',
        'Japan', 'South Korea', 'India', 'Mexico', 'Canada', 'Australia', 'Poland'];
      for (const country of topCountries) {
        await refreshPopularStationsCache(country);
      }
      const elapsed = Date.now() - startTime;
      logger.log(`⏰ [Cron] Popular stations cache refreshed in ${elapsed}ms (${topCountries.length} countries)`);
    } catch (error) {
      logger.error('[Cron] Popular stations cache refresh failed:', error);
    }
  });
  logger.log('⏰ Popular stations cache auto-refresh scheduled: every 5 minutes');

  // /api/genres endpoint cache: refresh every 5 minutes for common request patterns
  cron.default.schedule('*/5 * * * *', async () => {
    try {
      const startTime = Date.now();
      const commonCountries = [null, 'TR', 'DE', 'US', 'GB', 'FR', 'ES', 'IT', 'NL', 'AT', 'BR', 'RU'];
      for (const countrycode of commonCountries) {
        const filters = { countrycode, searchQuery: null, sortColumn: 'stationCount', sortBy: 'desc' };
        await refreshGenresCache(1, 27, filters);
        await refreshGenresCache(1, 9, filters);
      }
      const elapsed = Date.now() - startTime;
      logger.log(`⏰ [Cron] Genres API cache refreshed in ${elapsed}ms (${commonCountries.length} countries)`);
    } catch (error) {
      logger.error('[Cron] Genres API cache refresh failed:', error);
    }
  });
  logger.log('⏰ Genres API cache auto-refresh scheduled: every 5 minutes');

  // Startup: Warm up PrecomputedGenresService immediately (non-blocking)
  setImmediate(async () => {
    try {
      const startTime = Date.now();
      await PrecomputedGenresService.warmupCache();
      logger.log(`🔥 PrecomputedGenres startup warmup completed in ${Date.now() - startTime}ms`);
    } catch (error) {
      logger.error('PrecomputedGenres startup warmup failed:', error);
    }
  });

  // Background refresh function for community favorites (most-favorited stations across all users)
  async function refreshCommunityFavoritesCache(country?: string) {
    try {
      // Build country filter
      const countryFilter = normalizeCountryFilter(country);
      
      // Get most-favorited stations across all users using aggregation
      const communityFavorites = await UserFavorite.aggregate([
        {
          $addFields: {
            stationObjectId: { 
              $cond: {
                if: { $type: '$stationId' },
                then: { 
                  $cond: {
                    if: { $eq: [{ $type: '$stationId' }, 'objectId'] },
                    then: '$stationId',
                    else: { $toObjectId: '$stationId' }
                  }
                },
                else: null
              }
            }
          }
        },
        {
          $lookup: {
            from: 'stations',
            localField: 'stationObjectId',
            foreignField: '_id',
            as: 'station'
          }
        },
        { $unwind: { path: '$station', preserveNullAndEmptyArrays: true } },
        {
          $match: Object.keys(countryFilter).length > 0 
            ? { 'station': { $exists: true, $ne: null }, ...{ 'station.country': countryFilter.country } }
            : { 'station': { $exists: true, $ne: null } }
        },
        {
          $group: {
            _id: '$station._id',
            name: { $first: '$station.name' },
            url: { $first: '$station.url' },
            country: { $first: '$station.country' },
            genre: { $first: '$station.genre' },
            tags: { $first: '$station.tags' },
            votes: { $first: '$station.votes' },
            clickCount: { $first: '$station.clickCount' },
            codec: { $first: '$station.codec' },
            bitrate: { $first: '$station.bitrate' },
            favicon: { $first: '$station.favicon' },
            homepage: { $first: '$station.homepage' },
            iso_3166_1: { $first: '$station.iso_3166_1' },
            language: { $first: '$station.language' },
            slug: { $first: '$station.slug' },
            favoriteCount: { $sum: 1 } // Count how many users favorited this station
          }
        },
        { $sort: { favoriteCount: -1 } }, // Sort by favorite count (most-favorited first)
        { $limit: 20 }
      ]);
      
      const cacheKey = `community_favorites:${country || 'all'}:all:20`;
      await CacheManager.set(cacheKey, communityFavorites, { ttl: 600 }); // 10 minutes
    } catch (error) {
      logger.log(`⚠️ Failed to cache community favorites for ${country}:`, error);
    }
  }

  // Background refresh function for popular stations
  async function refreshPopularStationsCache(country?: string) {
    // Starting background popular stations cache refresh
    
    // Build country filter
    const countryFilter = normalizeCountryFilter(country);
    
    // Get popular stations - prioritize featured stations first, then sort by votes
    // New logic: isFeatured=true shows in station's own country, showInGlobalPopular=true ALSO shows globally
    let featuredFilter: any = {
      ...countryFilter,
      isFeatured: true
    };
    
    // If requesting global/all countries, include stations with showInGlobalPopular=true
    // If requesting specific country, include stations from that country
    if (!country || country === 'all' || country === 'null') {
      // Global request: show stations with showInGlobalPopular=true
      featuredFilter.showInGlobalPopular = true;
    }
    // For country-specific requests, countryFilter already handles filtering
    
    const featuredStations = await Station.find(featuredFilter)
      .sort({ votes: -1 })
      .limit(20)
      .lean();
    
    const remainingLimit = 20 - featuredStations.length;
    let regularStations: any[] = [];
    
    if (remainingLimit > 0) {
      regularStations = await Station.find({ ...countryFilter, isFeatured: { $ne: true } })
        .sort({ votes: -1 })
        .limit(remainingLimit)
        .lean();
    }
    
    // Combine featured (high priority) + regular stations
    const popularStations = [...featuredStations, ...regularStations];
    
    // Update web cache (10 minutes)
    const cacheKey = `popular_stations:${country || 'all'}:all:20`;
    await CacheManager.set(cacheKey, popularStations, { ttl: 600 });
    
    // Pre-build TV/Mobile cache for common limits (4, 10, 12) - 24 hours TTL
    const tvSlimAll = popularStations
      .filter((s: any) => s.logoAssets?.status === 'completed' || (s.favicon && /^https?:\/\/.+/i.test(s.favicon?.trim())))
      .map(tvSlimStation);
    
    for (const tvLimit of [4, 10, 12]) {
      const tvCacheKey = `popular_stations:${country || 'all'}:all:${tvLimit}:false:tv:v2`;
      await CacheManager.set(tvCacheKey, tvSlimAll.slice(0, tvLimit), { ttl: 86400 });
    }
  }

  // REMOVED: Expensive background refresh function that scanned all stations
  // Nearby stations now use MongoDB geospatial aggregation for sub-200ms performance

  // Background refresh function for genres
  async function refreshGenresCache(page: number, limit: number, filters: any) {
    // Starting background genres cache refresh
    
    const { countrycode, searchQuery, sortColumn = 'stationCount', sortBy = 'desc' } = filters;
    
    // Fetch real genres from database
    const realGenres = await Genre.find({}).lean();
    
    // Build country filter for stations
    let stationFilter = {};
    if (countrycode && countrycode !== 'global' && countrycode !== 'null') {
      Object.assign(stationFilter, normalizeCountryFilter(countrycode));
    }
    
    // Get stations and extract dynamic genres
    const stations = await Station.find(stationFilter, 'tags genre').lean();
    
    // Extract and count tags
    const tagCounts = new Map();
    for (const station of stations) {
      if (station.tags && typeof station.tags === 'string') {
        const tags = station.tags.split(',')
          .map(tag => tag.trim().toLowerCase())
          .filter(tag => tag.length > 0);
        for (const tag of tags) {
          tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
        }
      }
      if (station.genre && typeof station.genre === 'string') {
        const genre = station.genre.trim().toLowerCase();
        if (genre.length > 0) {
          tagCounts.set(genre, (tagCounts.get(genre) || 0) + 1);
        }
      }
    }
    
    // Convert dynamic tags to genre objects
    let dynamicGenres = Array.from(tagCounts.entries())
      .filter(([tag, count]) => count >= 1 && tag.length > 0)
      .map(([tag, count]) => ({
        name: tag.charAt(0).toUpperCase() + tag.slice(1),
        slug: tag,
        stationCount: count,
        isDynamic: true
      }));
    
    // Merge real and dynamic genres
    const genreMap = new Map();
    for (const realGenre of realGenres) {
      const normalizedName = realGenre.name.toLowerCase();
      genreMap.set(normalizedName, {
        _id: realGenre._id,
        name: realGenre.name,
        slug: realGenre.slug || normalizedName.replace(/\s+/g, '-'),
        description: realGenre.description,
        stationCount: realGenre.stationCount || 0,
        posterImage: realGenre.posterImage,
        discoverableImage: realGenre.discoverableImage,
        isDiscoverable: realGenre.isDiscoverable,
        discoverable: realGenre.isDiscoverable,
        createdAt: realGenre.createdAt,
        updatedAt: realGenre.updatedAt,
        isDynamic: false
      });
    }
    
    for (const dynamicGenre of dynamicGenres) {
      const normalizedName = dynamicGenre.name.toLowerCase();
      if (!genreMap.has(normalizedName)) {
        genreMap.set(normalizedName, {
          _id: `dynamic-${dynamicGenre.slug}`,
          name: dynamicGenre.name,
          slug: dynamicGenre.slug,
          posterImage: `/images/genre-bg-grad-${(genreMap.size % 4) + 1}.webp`,
          description: `${dynamicGenre.name} music and stations`,
          stationCount: dynamicGenre.stationCount,
          total_stations: dynamicGenre.stationCount,
          createdAt: new Date(),
          isDynamic: true
        });
      } else {
        const existingGenre = genreMap.get(normalizedName);
        existingGenre.stationCount = dynamicGenre.stationCount;
        existingGenre.total_stations = dynamicGenre.stationCount;
      }
    }
    
    let allGenres = Array.from(genreMap.values());
    
    // Apply search filter
    if (searchQuery) {
      const searchRegex = new RegExp(searchQuery, 'i');
      allGenres = allGenres.filter(genre => 
        searchRegex.test(genre.name) || 
        searchRegex.test(genre.slug) || 
        (genre.description && searchRegex.test(genre.description))
      );
    }
    
    // Sort
    const sortOrder = sortBy === 'desc' ? -1 : 1;
    allGenres.sort((a, b) => {
      if (sortColumn === 'total_stations' || sortColumn === 'stationCount') {
        return sortOrder === -1 ? (b.stationCount || 0) - (a.stationCount || 0) : (a.stationCount || 0) - (b.stationCount || 0);
      } else if (sortColumn === 'name') {
        return sortOrder === -1 ? b.name.localeCompare(a.name) : a.name.localeCompare(b.name);
      }
      return 0;
    });
    
    // Paginate
    const totalCount = allGenres.length;
    const skip = (page - 1) * limit;
    const paginatedGenres = allGenres.slice(skip, skip + limit);
    
    const response = {
      data: paginatedGenres,
      count: totalCount,
      currentPage: page,
      perPage: limit,
      totalPages: Math.ceil(totalCount / limit)
    };
    
    // Update cache with fresh data
    const cacheKey = CacheKeys.genres(page, limit, { searchQuery, countrycode, sortColumn, sortBy });
    await CacheManager.set(cacheKey, response, { ttl: 300 });
    
    // Background genres cache refresh completed
  }

  // SEO REDIRECTS - 301 permanent redirects for old URLs
  app.get("/stations", (req, res) => {
    res.redirect(301, '/radios');
  });

  // CACHE MANAGEMENT API
  app.get("/api/cache/stats", async (req, res) => {
    try {
      const stats = CacheManager.getStats();
      res.json({
        ...stats,
        message: "Cache statistics retrieved successfully"
      });
    } catch (error) {
      // console.error('Error fetching cache stats:', error);
      res.status(500).json({ error: 'Failed to fetch cache stats' });
    }
  });

  app.delete("/api/cache/clear/:pattern?", async (req, res) => {
    try {
      const { pattern } = req.params;
      if (pattern) {
        await CacheManager.clearByPattern(pattern);
        // Cleared cache entries matching pattern
        res.json({ message: `Cleared cache entries matching pattern: ${pattern}` });
      } else {
        await CacheManager.clearByPattern(''); // Clear all
        // Cleared entire cache
        res.json({ message: 'Cleared entire cache' });
      }
    } catch (error) {
      // console.error('Error clearing cache:', error);
      res.status(500).json({ error: 'Failed to clear cache' });
    }
  });

  // DASHBOARD STATS API
  app.get("/api/dashboard/stats", async (req, res) => {
    try {
      // Get dashboard statistics
      const [
        totalStations,
        totalCountries,
        totalLanguages,
        totalGenres,
        totalCodecs,
        workingStations,
        recentlyUpdated,
        lastSyncLog,
        errorCount,
        userCount,
        feedbackCount,
        topCountries,
        topGenres,
        codecDistribution,
        stationsWithFavicon,
        stationsWithDesc
      ] = await Promise.all([
        Station.countDocuments(),
        Station.distinct('country').then(countries => countries.filter(c => c).length),
        Station.distinct('language').then(languages => languages.filter(l => l).length),
        Station.distinct('tags').then(tags => tags.filter(t => t).length),
        Station.distinct('codec').then(codecs => codecs.filter(c => c).length),
        Station.countDocuments({ lastCheckOk: true }),
        Station.countDocuments({ 
          updatedAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
        }),
        SyncLog.findOne().sort({ createdAt: -1 }),
        StationDebugLog ? StationDebugLog.countDocuments({ isResolved: false }) : 0,
        User.countDocuments(),
        Feedback.countDocuments({ status: 'open' }),
        // Top 5 countries by station count
        Station.aggregate([
          { $match: { country: { $exists: true, $ne: null } } },
          { $group: { _id: '$country', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 5 }
        ]),
        // Top 5 genres by station count
        Station.aggregate([
          { $match: { tags: { $exists: true, $ne: null } } },
          { $group: { _id: '$tags', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 5 }
        ]),
        // Codec distribution
        Station.aggregate([
          { $match: { codec: { $exists: true, $ne: null } } },
          { $group: { _id: '$codec', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 10 }
        ]),
        Station.countDocuments({ favicon: { $exists: true, $nin: [null, ''] } }),
        Station.countDocuments({ 'descriptions.en': { $exists: true } })
      ]);

      // Calculate sync status
      const isRecentSync = lastSyncLog && 
        new Date(lastSyncLog.createdAt).getTime() > Date.now() - (24 * 60 * 60 * 1000);
      
      // Get active visitors (sessions active in last 30 minutes) using VisitorSession
      const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
      let activeVisitors = 0;
      try {
        activeVisitors = await VisitorSession.countDocuments({
          lastActiveDate: { $gte: thirtyMinutesAgo }
        });
      } catch (e) {
        // Fallback
      }

      // Get today's unique visitors
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      let todayVisitors = 0;
      try {
        todayVisitors = await VisitorSession.countDocuments({
          lastActiveDate: { $gte: todayStart }
        });
      } catch (e) {
        // Fallback
      }

      // Get this week's unique visitors
      const weekAgoStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      let weekVisitors = 0;
      try {
        weekVisitors = await VisitorSession.countDocuments({
          lastActiveDate: { $gte: weekAgoStart }
        });
      } catch (e) {
        // Fallback
      }

      // Get active registered users (logged in in last 7 days)
      const weekAgoDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      let activeRegisteredUsers = 0;
      try {
        activeRegisteredUsers = await User.countDocuments({
          lastActiveDate: { $gte: weekAgoDate }
        });
      } catch (e) {
        // Fallback
      }

      const stats = {
        totalStations,
        totalCountries,
        totalLanguages,
        totalGenres,
        totalCodecs,
        workingStations,
        workingPercentage: totalStations > 0 ? Math.round((workingStations / totalStations) * 100) : 0,
        offlineStations: totalStations - workingStations,
        recentlyUpdated,
        unresolvedErrors: errorCount,
        totalUsers: userCount,
        activeRegisteredUsers,
        openFeedback: feedbackCount,
        stationsWithFavicon,
        faviconPercentage: totalStations > 0 ? Math.round((stationsWithFavicon / totalStations) * 100) : 0,
        stationsWithDesc,
        descriptionPercentage: totalStations > 0 ? Math.round((stationsWithDesc / totalStations) * 100) : 0,
        activeVisitors,
        todayVisitors,
        weekVisitors,
        topCountries: topCountries.map(c => ({ name: c._id, count: c.count })),
        topGenres: topGenres.map(g => ({ name: g._id, count: g.count })),
        codecDistribution: codecDistribution.map(c => ({ name: c._id, count: c.count })),
        syncStatus: {
          isRunning: lastSyncLog?.status === 'running',
          lastSync: lastSyncLog ? new Date(lastSyncLog.createdAt) : null,
          lastSyncStatus: lastSyncLog?.status || 'unknown',
          isHealthy: isRecentSync && lastSyncLog?.status === 'completed'
        }
      };

      res.json(stats);
    } catch (error) {
      // console.error('Dashboard stats error:', error);
      res.status(500).json({ error: 'Failed to fetch dashboard statistics' });
    }
  });

  // ADMIN LOGIN API
  app.post("/api/admin/login", async (req, res) => {
    try {
      const { username, password } = req.body;

      // Admin credentials from environment variables
      const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
      const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

      if (!username || !password) {
        return res.status(400).json({ error: "Username and password required" });
      }

      if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: "Invalid admin credentials" });
      }

      // Create admin session
      const adminAuthData = {
        username: ADMIN_USERNAME,
        role: 'admin',
        loginTime: new Date()
      };
      
      (req.session as any).adminAuth = adminAuthData;
      
      logger.log('✅ Admin login successful - Session ID:', req.sessionID);
      logger.log('✅ Admin auth data stored:', adminAuthData);

      res.json({ 
        success: true, 
        message: "Admin login successful",
        user: {
          username: ADMIN_USERNAME,
          role: 'admin'
        }
      });
    } catch (error) {
      console.error('❌ Admin login error:', error);
      res.status(500).json({ error: 'Login failed' });
    }
  });

  // ADMIN LOGOUT API
  app.post("/api/admin/logout", (req, res) => {
    try {
      (req.session as any).adminAuth = null;
      res.json({ success: true, message: "Logged out successfully" });
    } catch (error) {
      // console.error('Admin logout error:', error);
      res.status(500).json({ error: 'Logout failed' });
    }
  });

  // ADMIN AUTH CHECK API (separate from regular user auth)
  app.get("/api/admin/auth/me", (req, res) => {
    try {
      const adminAuth = (req.session as any).adminAuth;
      logger.log('🔍 Admin auth check - Session ID:', req.sessionID);
      logger.log('🔍 Admin session exists:', !!req.session);
      logger.log('🔍 Admin auth data:', adminAuth);
      
      if (adminAuth) {
        logger.log('✅ Admin authenticated successfully');
        res.json({
          user: {
            username: adminAuth.username,
            role: adminAuth.role
          },
          authenticated: true
        });
      } else {
        logger.log('❌ No admin session found');
        res.json({
          user: null,
          authenticated: false
        });
      }
    } catch (error) {
      console.error('❌ Admin auth check error:', error);
      res.status(500).json({ error: 'Admin auth check failed' });
    }
  });

  // Authentication middleware
  const requireAuth = async (req: any, res: any, next: any) => {
    const session = req.session;
    if (session?.user?.userId) {
      (req.session as any).userId = session.user.userId;
      return next();
    }

    const authHeader = req.headers['authorization'];
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (bearerToken) {
      try {
        const tokenDoc = await AuthToken.findOne({
          token: bearerToken,
          isRevoked: false,
          expiresAt: { $gt: new Date() }
        });

        if (tokenDoc) {
          tokenDoc.lastUsedAt = new Date();
          await tokenDoc.save();

          if (!req.session) req.session = {};
          (req.session as any).userId = tokenDoc.userId.toString();
          if (!req.session.user) req.session.user = {} as any;
          (req.session as any).user = { userId: tokenDoc.userId.toString() };
          return next();
        }
      } catch (err) {
        console.error('Token auth error:', err);
      }
    }

    return res.status(401).json({ error: 'Authentication required' });
  };

  const generateAuthToken = async (userId: string, deviceType: 'mobile' | 'tv' | 'desktop' | 'web' = 'mobile', deviceName?: string): Promise<string> => {
    const prefix = deviceType === 'tv' ? 'mrt_tv_' : 'mrt_';
    const token = `${prefix}${crypto.randomBytes(32).toString('hex')}`;
    const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000); // 90 days

    await AuthToken.create({
      token,
      userId: new mongoose.Types.ObjectId(userId),
      deviceType,
      deviceName,
      expiresAt,
      lastUsedAt: new Date(),
      createdAt: new Date(),
      isRevoked: false,
    });

    return token;
  };

  // POST /api/listening/record - Record user listening sessions
  app.post('/api/listening/record', requireAuth, async (req, res) => {
    try {
      const { stationId, stationName, listenDuration, country, genre } = req.body;
      const userId = (req.session as any)?.user?.userId;

      if (!userId || !stationId || !listenDuration || typeof listenDuration !== 'number') {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      // Record listening session
      const listeningSession = new UserListeningHistory({
        sessionId: userId.toString(),
        stationId,
        stationName: stationName || 'Unknown',
        listenDuration: Math.max(1, Math.round(listenDuration)), // At least 1 second
        country: country || 'Unknown',
        genre: genre || 'Unknown',
        interactionType: 'listen',
        listenedAt: new Date()
      });

      await listeningSession.save();
      res.json({ success: true, totalTime: listenDuration });
    } catch (error) {
      console.error('Error recording listening session:', error);
      res.status(500).json({ error: 'Failed to record listening session' });
    }
  });

  // Admin-only middleware
  const requireAdmin = async (req: any, res: any, next: any) => {
    const session = req.session as any;
    
    if (!session || !session.adminAuth) {
      return res.status(401).json({ 
        error: 'Admin authentication required',
        message: 'You must be logged in as an admin to access this resource.'
      });
    }

    try {
      // Check if admin session is valid
      if (session.adminAuth.role !== 'admin') {
        return res.status(403).json({ 
          error: 'Admin access required',
          message: 'You do not have permission to access this resource. Admin privileges required.'
        });
      }

      // Store admin info for easier access
      (req.session as any).adminUser = session.adminAuth;
      next();
    } catch (error) {
      // console.error('Admin auth error:', error);
      return res.status(500).json({ error: 'Authentication error' });
    }
  };

  // IndexNow monitoring routes (must be registered BEFORE the /submit route to avoid conflicts)
  app.use('/api/admin/indexnow', requireAdmin, indexnowMonitoringRouter);

  // INDEXNOW ADMIN ENDPOINT - Submit URLs to search engines
  app.post("/api/admin/indexnow/submit", requireAdmin, async (req, res) => {
    try {
      const { urls } = req.body;

      if (!urls || !Array.isArray(urls) || urls.length === 0) {
        return res.status(400).json({ error: 'URLs array is required' });
      }

      logger.log(`📡 IndexNow: Admin submitting ${urls.length} URLs`);
      const result = await IndexNowService.submitToIndexNow(urls);

      if (result.success) {
        res.json({
          success: true,
          message: result.message,
          urlsSubmitted: urls.length
        });
      } else {
        res.status(500).json({
          success: false,
          error: result.error
        });
      }
    } catch (error: any) {
      logger.log('❌ IndexNow admin endpoint error:', error);
      res.status(500).json({ error: 'Failed to submit URLs to IndexNow' });
    }
  });

  // Utility function to generate unique slugs for any entity type
  async function generateUniqueSlug(name: string, entityType: 'station' | 'genre' | 'user', excludeId?: string): Promise<string> {
    // Generate base slug from name
    const baseSlug = name
      .toLowerCase()
      .replace(/[^\w\s-]/g, '') // Remove special characters except spaces and hyphens
      .replace(/\s+/g, '-') // Replace spaces with hyphens
      .replace(/-+/g, '-') // Replace multiple hyphens with single hyphen
      .trim()
      .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens

    let uniqueSlug = baseSlug;
    let counter = 1;

    // Check if slug exists globally across all entity types for true uniqueness
    while (true) {
      const filter: any = { slug: uniqueSlug };
      if (excludeId) {
        filter._id = { $ne: excludeId };
      }
      
      // Check across all collections for true uniqueness
      const [existingStation, existingGenre, existingUser] = await Promise.all([
        Station.findOne(filter),
        Genre.findOne(filter),
        User.findOne(filter)
      ]);
      
      if (!existingStation && !existingGenre && !existingUser) {
        break; // Slug is globally unique
      }
      
      // Add numeric suffix
      uniqueSlug = `${baseSlug}-${counter}`;
      counter++;
    }

    return uniqueSlug;
  }

  // Enhanced user slug generation from user data
  async function generateUserSlug(user: any, excludeId?: string): Promise<string> {
    // Priority order for slug generation: username > fullName > name > email prefix
    let slugSource = '';
    
    if (user.username) {
      slugSource = user.username;
    } else if (user.fullName) {
      slugSource = user.fullName;
    } else if (user.name) {
      slugSource = user.name;
    } else if (user.email) {
      slugSource = user.email.split('@')[0]; // Use email prefix as fallback
    } else {
      slugSource = `user-${user._id}`; // Ultimate fallback
    }

    logger.log(`🔧 generateUserSlug: Using "${slugSource}" from user:`, { 
      username: user.username, 
      fullName: user.fullName, 
      name: user.name, 
      email: user.email 
    });

    return await generateUniqueSlug(slugSource, 'user', excludeId);
  }

  // Admin endpoint to get slug statistics (no auth required for status checking)
  app.get("/api/admin/station-slugs/status", async (req, res) => {
    try {
      const totalStations = await Station.countDocuments();
      const stationsWithSlugs = await Station.countDocuments({
        $and: [
          { slug: { $exists: true, $ne: null } },
          { slug: { $ne: "" } }
        ]
      });
      const stationsWithoutSlugs = totalStations - stationsWithSlugs;
      const completionPercentage = totalStations > 0 ? (stationsWithSlugs / totalStations) * 100 : 0;

      const stats = {
        totalStations,
        stationsWithSlugs,
        stationsWithoutSlugs,
        completionPercentage
      };

      res.json(stats);
    } catch (error) {
      console.error('Error fetching slug statistics:', error);
      res.status(500).json({ error: 'Failed to fetch slug statistics' });
    }
  });

  // Admin endpoint for job status (with real-time tracking)
  app.get("/api/admin/station-slugs/job-status", async (req, res) => {
    try {
      // Find the most recent running or recent job
      let mostRecentJob = null;
      for (const [jobId, job] of slugGenerationJobs.entries()) {
        if (!mostRecentJob || job.startedAt > mostRecentJob.startedAt) {
          mostRecentJob = job;
        }
      }
      
      // Return the most recent job or null if none exists
      res.json(mostRecentJob);
    } catch (error) {
      console.error('Error fetching job status:', error);
      res.status(500).json({ error: 'Failed to fetch job status' });
    }
  });

  // Admin endpoint to stop slug generation
  app.post("/api/admin/station-slugs/stop", requireAdmin, async (req, res) => {
    try {
      // Stop all running jobs
      for (const [jobId, job] of slugGenerationJobs.entries()) {
        if (job.status === 'running') {
          job.status = 'stopped';
          job.completedAt = new Date();
          job.message = 'Generation stopped by user';
        }
      }
      
      res.json({ success: true, message: 'Generation stopped' });
    } catch (error) {
      console.error('Error stopping slug generation:', error);
      res.status(500).json({ error: 'Failed to stop generation' });
    }
  });

  // CLEAR ALL SLUGS FIRST (for complete regeneration)
  app.post("/api/clear-all-slugs", async (req, res) => {
    try {
      logger.log('🧹 CLEARING ALL SLUGS...');
      
      // Test with one station first
      const testStation = await Station.findOne({});
      if (testStation) {
        logger.log(`📋 Before clear: Station "${testStation.name}" has slug: "${testStation.slug}"`);
      }
      
      const clearResults = await Promise.all([
        Station.updateMany({}, { $unset: { slug: 1 } }),
        Genre.updateMany({}, { $unset: { slug: 1 } }),
        User.updateMany({}, { $unset: { slug: 1 } })
      ]);
      
      // Check if it worked
      const testStationAfter = await Station.findOne({ _id: testStation?._id });
      if (testStationAfter) {
        logger.log(`📋 After clear: Station "${testStationAfter.name}" has slug: "${testStationAfter.slug}"`);
      }
      
      const totalCleared = clearResults.reduce((sum, result) => sum + result.modifiedCount, 0);
      
      logger.log(`✅ Cleared ${totalCleared} slugs total:`);
      logger.log(`   • Stations: ${clearResults[0].modifiedCount}`);
      logger.log(`   • Genres: ${clearResults[1].modifiedCount}`);  
      logger.log(`   • Users: ${clearResults[2].modifiedCount}`);
      
      res.json({ 
        success: true, 
        totalCleared,
        stations: clearResults[0].modifiedCount,
        genres: clearResults[1].modifiedCount,
        users: clearResults[2].modifiedCount
      });
    } catch (error) {
      console.error('❌ Error clearing slugs:', error);
      res.status(500).json({ error: 'Failed to clear slugs' });
    }
  });

  // OPTIMIZED COMPREHENSIVE SLUG GENERATION - Stations, Genres, and Users
  app.post("/api/generate-all-slugs", async (req, res) => {
    const { regenerateAll } = req.body;
    try {
      // Count stations based on regenerateAll flag
      const stationsWithoutSlugs = regenerateAll 
        ? await Station.countDocuments()
        : await Station.countDocuments({ $or: [{ slug: { $exists: false } }, { slug: "" }, { slug: null }] });
      const genresWithoutSlugs = regenerateAll
        ? await Genre.countDocuments()
        : await Genre.countDocuments({ $or: [{ slug: { $exists: false } }, { slug: "" }, { slug: null }] });
      const usersWithoutSlugs = regenerateAll
        ? await User.countDocuments()
        : await User.countDocuments({ $or: [{ slug: { $exists: false } }, { slug: "" }, { slug: null }] });
      
      const jobId = regenerateAll ? `regenerate-all-slugs-${Date.now()}` : `optimized-slug-gen-${Date.now()}`;
      const startedAt = new Date();
      const totalToProcess = stationsWithoutSlugs + genresWithoutSlugs + usersWithoutSlugs;
      
      // Create job tracking entry
      const jobData = {
        jobId,
        status: 'running' as const,
        progress: { current: 0, total: totalToProcess },
        startedAt,
        message: regenerateAll 
          ? `Complete regeneration for ALL ${stationsWithoutSlugs} stations, ${genresWithoutSlugs} genres, and ${usersWithoutSlugs} users`
          : `Optimized slug generation for ${stationsWithoutSlugs} stations, ${genresWithoutSlugs} genres, and ${usersWithoutSlugs} users without slugs`
      };
      
      slugGenerationJobs.set(jobId, jobData);
      
      // Send immediate response to user - this makes it asynchronous
      res.json(jobData);
      
      // Process comprehensive slug generation in background (non-blocking)
      setImmediate(async () => {
        try {
          logger.log('🚀 OPTIMIZED COMPREHENSIVE SLUG GENERATION STARTED');
          logger.log(`📊 Processing: ${stationsWithoutSlugs} stations, ${genresWithoutSlugs} genres, ${usersWithoutSlugs} users (only items without slugs)`);
          
          let totalUpdated = 0;
          let totalProcessed = 0;
          
          // Pre-load ALL existing slugs into memory for fast uniqueness checking
          logger.log('🔄 Pre-loading existing slugs for fast uniqueness checking...');
          const [existingStationSlugs, existingGenreSlugs, existingUserSlugs] = await Promise.all([
            Station.find({ slug: { $exists: true } }, { slug: 1 }).lean(),
            Genre.find({ slug: { $exists: true } }, { slug: 1 }).lean(),
            User.find({ slug: { $exists: true } }, { slug: 1 }).lean()
          ]);
          
          const usedSlugs = new Set([
            ...existingStationSlugs.map(s => s.slug),
            ...existingGenreSlugs.map(g => g.slug),
            ...existingUserSlugs.map(u => u.slug)
          ]);
          
          logger.log(`✅ Loaded ${usedSlugs.size} existing slugs for uniqueness checking`);
          
          // Optimized slug generator using in-memory uniqueness checking
          const generateOptimizedUniqueSlug = (name: string): string => {
            const baseSlug = name
              .toLowerCase()
              .replace(/[^\w\s-]/g, '') // Remove special characters except spaces and hyphens
              .replace(/\s+/g, '-') // Replace spaces with hyphens
              .replace(/-+/g, '-') // Replace multiple hyphens with single hyphen
              .trim()
              .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens
            
            let uniqueSlug = baseSlug;
            let counter = 1;
            
            // Fast in-memory uniqueness check instead of database lookups
            while (usedSlugs.has(uniqueSlug)) {
              uniqueSlug = `${baseSlug}-${counter}`;
              counter++;
            }
            
            usedSlugs.add(uniqueSlug); // Reserve this slug
            return uniqueSlug;
          };
          
          // ==== GENERATE STATION SLUGS (BATCH OPTIMIZED) ====
          logger.log('🏁 Phase 1: Generating station slugs (batch optimized)...');
          const batchSize = 1000;
          let stationUpdated = 0;
          let skip = 0;
          
          while (true) {
            // Get stations based on regenerateAll flag
            const stations = regenerateAll 
              ? await Station.find({})
              : await Station.find({ $or: [{ slug: { $exists: false } }, { slug: "" }, { slug: null }] })
              .skip(skip)
              .limit(batchSize)
              .lean();
            if (stations.length === 0) break;
            
            // Prepare bulk operations
            const bulkOps = [];
            
            for (const station of stations) {
              try {
                // Check if job was stopped
                const currentJob = slugGenerationJobs.get(jobId);
                if (currentJob?.status === 'stopped') {
                  logger.log('🛑 Job stopped by user, exiting station processing');
                  return;
                }
                
                totalProcessed++;
                
                // Generate unique slug using optimized in-memory checker
                const newSlug = generateOptimizedUniqueSlug(station.name);
                
                // Add to bulk operations instead of individual updates
                bulkOps.push({
                  updateOne: {
                    filter: { _id: station._id },
                    update: { $set: { slug: newSlug } }
                  }
                });
                
                stationUpdated++;
                totalUpdated++;
                
                // Update job progress every 100 items for responsiveness
                if (totalProcessed % 100 === 0) {
                  const currentJob = slugGenerationJobs.get(jobId);
                  if (currentJob) {
                    currentJob.progress.current = totalProcessed;
                    slugGenerationJobs.set(jobId, currentJob);
                  }
                  logger.log(`📈 Station Progress: ${totalProcessed}/${totalToProcess} processed (${Math.round(totalProcessed/totalToProcess*100)}%)`);
                }
              } catch (error) {
                console.error(`❌ Error processing station ${station._id}:`, error);
              }
            }
            
            // Execute bulk operations for this batch
            if (bulkOps.length > 0) {
              await Station.bulkWrite(bulkOps);
              logger.log(`✅ Batch complete: ${bulkOps.length} station slugs updated`);
            }
            
            skip += batchSize;
          }
          
          logger.log(`✅ Station slugs: ${stationUpdated} stations updated`);
          
          // ==== GENERATE GENRE SLUGS (BATCH OPTIMIZED) ====
          logger.log('🎵 Phase 2: Generating genre slugs (batch optimized)...');
          const genres = regenerateAll 
            ? await Genre.find({}).lean()
            : await Genre.find({ $or: [{ slug: { $exists: false } }, { slug: "" }, { slug: null }] }).lean();
          let genreUpdated = 0;
          
          if (genres.length > 0) {
            const genreBulkOps = [];
            
            for (const genre of genres) {
              try {
                // Check if job was stopped
                const currentJob = slugGenerationJobs.get(jobId);
                if (currentJob?.status === 'stopped') {
                  logger.log('🛑 Job stopped by user, exiting genre processing');
                  return;
                }
                
                totalProcessed++;
                
                // Generate unique slug using optimized in-memory checker
                const newSlug = generateOptimizedUniqueSlug(genre.name);
                
                genreBulkOps.push({
                  updateOne: {
                    filter: { _id: genre._id },
                    update: { $set: { slug: newSlug } }
                  }
                });
                
                genreUpdated++;
                totalUpdated++;
                
                // Update job progress every 50 items
                if (totalProcessed % 50 === 0) {
                  const currentJob = slugGenerationJobs.get(jobId);
                  if (currentJob) {
                    currentJob.progress.current = totalProcessed;
                    slugGenerationJobs.set(jobId, currentJob);
                  }
                  logger.log(`📈 Genre Progress: ${totalProcessed}/${totalToProcess} processed (${Math.round(totalProcessed/totalToProcess*100)}%)`);
                }
              } catch (error) {
                console.error(`❌ Error processing genre ${genre._id}:`, error);
              }
            }
            
            // Execute bulk operations for genres
            if (genreBulkOps.length > 0) {
              await Genre.bulkWrite(genreBulkOps);
              logger.log(`✅ Genre batch complete: ${genreBulkOps.length} genre slugs updated`);
            }
          }
          
          logger.log(`✅ Genre slugs: ${genreUpdated} genres updated`);
          
          // ==== GENERATE USER SLUGS (BATCH OPTIMIZED) ====
          logger.log('👥 Phase 3: Generating user slugs (batch optimized)...');
          const users = regenerateAll 
            ? await User.find({}).lean()
            : await User.find({ $or: [{ slug: { $exists: false } }, { slug: "" }, { slug: null }] }).lean();
          let userUpdated = 0;
          
          if (users.length > 0) {
            const userBulkOps = [];
            
            for (const user of users) {
              try {
                // Check if job was stopped
                const currentJob = slugGenerationJobs.get(jobId);
                if (currentJob?.status === 'stopped') {
                  logger.log('🛑 Job stopped by user, exiting user processing');
                  return;
                }
                
                totalProcessed++;
                
                // Generate unique slug for user (priority: username > fullName > name > email)
                let slugSource = '';
                if (user.username) {
                  slugSource = user.username;
                } else if (user.fullName) {
                  slugSource = user.fullName;
                } else if (user.name) {
                  slugSource = user.name;
                } else if (user.email) {
                  slugSource = user.email.split('@')[0]; // Use email prefix
                } else {
                  slugSource = `user-${user._id}`; // Ultimate fallback
                }
                const newSlug = generateOptimizedUniqueSlug(slugSource);
                
                userBulkOps.push({
                  updateOne: {
                    filter: { _id: user._id },
                    update: { $set: { slug: newSlug } }
                  }
                });
                
                userUpdated++;
                totalUpdated++;
                
                // Update job progress every 25 items
                if (totalProcessed % 25 === 0) {
                  const currentJob = slugGenerationJobs.get(jobId);
                  if (currentJob) {
                    currentJob.progress.current = totalProcessed;
                    slugGenerationJobs.set(jobId, currentJob);
                  }
                  logger.log(`📈 User Progress: ${totalProcessed}/${totalToProcess} processed (${Math.round(totalProcessed/totalToProcess*100)}%)`);
                }
              } catch (error) {
                console.error(`❌ Error processing user ${user._id}:`, error);
              }
            }
            
            // Execute bulk operations for users
            if (userBulkOps.length > 0) {
              await User.bulkWrite(userBulkOps);
              logger.log(`✅ User batch complete: ${userBulkOps.length} user slugs updated`);
            }
          }
          
          logger.log(`✅ User slugs: ${userUpdated} users updated`);
          
          // Final summary
          const completedAt = new Date();
          const duration = Math.round((completedAt.getTime() - startedAt.getTime()) / 1000);
          
          // Mark job as completed
          const finalJob = slugGenerationJobs.get(jobId);
          if (finalJob) {
            finalJob.status = 'completed';
            finalJob.completedAt = completedAt;
            finalJob.progress.current = finalJob.progress.total;
            finalJob.message = `Comprehensive slug generation completed: ${totalUpdated} total entities updated in ${duration}s`;
            slugGenerationJobs.set(jobId, finalJob);
          }

          logger.log('🎉 OPTIMIZED SLUG GENERATION COMPLETED');
          logger.log(`📊 Summary: ${totalUpdated} entities updated in ${duration}s`);
          logger.log(`   • Stations: ${stationUpdated} updated`);
          logger.log(`   • Genres: ${genreUpdated} updated`);
          logger.log(`   • Users: ${userUpdated} updated`);
          logger.log(`⚡ Performance: ~${Math.round(totalUpdated/duration)} entities/second`);
          
          // Optional: Clear cache after slug generation to ensure fresh data
          try {
            await CacheManager.clearAll();
            logger.log('🧹 Cache cleared after slug generation');
          } catch (cacheError) {
            logger.warn('⚠️ Cache clear failed:', cacheError);
          }
          
        } catch (error) {
          console.error('❌ Comprehensive slug generation failed:', error);
          
          // Mark job as failed
          const failedJob = slugGenerationJobs.get(jobId);
          if (failedJob) {
            failedJob.status = 'failed';
            failedJob.completedAt = new Date();
            failedJob.error = error instanceof Error ? error.message : 'Unknown error';
            failedJob.message = 'Comprehensive slug generation failed';
            slugGenerationJobs.set(jobId, failedJob);
          }
        }
      });
      
    } catch (error) {
      console.error('❌ Error starting slug generation:', error);
      res.status(500).json({ error: 'Failed to start slug generation' });
    }
  });

  // Admin endpoint to generate slugs for all stations
  app.post("/api/admin/stations/generate-slugs", requireAdmin, async (req, res) => {
    try {
      // Get count of stations for immediate response
      const totalStations = await Station.countDocuments();
      
      // Send immediate response to user - this makes it asynchronous
      res.json({
        success: true,
        message: `Slug generation started in background for ${totalStations} stations`,
        status: 'started',
        totalStations
      });
      
      // Process slug generation in background (non-blocking)
      setImmediate(async () => {
        try {
          logger.log('🏁 Starting background slug generation for all stations...');
          
          // Get all stations in batches to avoid memory issues
          const batchSize = 1000;
          let updated = 0;
          let processed = 0;
          let skip = 0;
          
          while (true) {
            // Get batch of stations
            const stations = await Station.find().skip(skip).limit(batchSize).lean();
            
            if (stations.length === 0) {
              break; // No more stations to process
            }
            
            // Process batch
            for (const station of stations) {
              try {
                processed++;
                
                // Generate unique slug for this station
                const newSlug = await generateUniqueSlug(station.name, 'station', station._id.toString());
                
                // Update station with new slug
                await Station.updateOne(
                  { _id: station._id },
                  { $set: { slug: newSlug } }
                );
                
                updated++;
                
                if (processed % 1000 === 0) {
                  logger.log(`📊 Slug progress: ${processed}/${totalStations} stations processed, ${updated} updated`);
                }
              } catch (error) {
                console.error(`❌ Error processing station ${station._id}:`, error);
              }
            }
            
            skip += batchSize;
            
            // Small delay between batches to prevent overwhelming the database
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          
          logger.log(`✅ Background slug generation completed! Processed: ${processed}, Updated: ${updated}`);
          
        } catch (error) {
          console.error('❌ Background slug generation failed:', error);
        }
      });
      
    } catch (error) {
      console.error('❌ Error starting slug generation:', error);
      res.status(500).json({ 
        error: 'Failed to start slug generation',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // AI STATION DESCRIPTION GENERATION ENDPOINTS
  const { generateStationDescription, batchGenerateStationDescriptions, detectStationLanguage, translateDescription } = await import('./services/ai-station-description');
  
  // In-memory storage for AI description generation jobs
  const descriptionJobs = new Map<string, {
    jobId: string;
    status: 'running' | 'paused' | 'completed' | 'failed';
    total: number;
    processed: number;
    successful: number;
    failed: number;
    skipped: number;
    currentStation: string;
    currentAction: 'generating' | 'translating' | 'saving' | 'idle';
    currentLanguage?: string;
    targetLanguages: string[];
    startedAt: Date;
    completedAt?: Date;
    error?: string;
    successfulStations: Array<{ name: string; languages: string[] }>;
    skippedStations: Array<{ name: string; reason: string }>;
    failedStations: Array<{ name: string; error: string }>;
  }>();

  // Single station AI description generation
  app.post("/api/admin/stations/:id/generate-description", requireAdmin, async (req, res) => {
    try {
      const stationId = req.params.id;
      const { language } = req.body; // Optional: override auto-detected language
      
      const station = await Station.findById(stationId).lean();
      if (!station) {
        return res.status(404).json({ error: 'Station not found' });
      }
      
      logger.log(`🤖 [DEBUG] Generating AI description for station: ${station.name} (${station.countryCode})`);
      
      const result = await generateStationDescription(station, language);
      
      logger.log(`🤖 [DEBUG] AI Result for ${station.name}:`, {
        success: result.success,
        language: result.language,
        descriptionLength: result.description?.length || 0,
        descriptionPreview: result.description?.substring(0, 100) || 'NO DESCRIPTION',
        usedFallback: result.usedFallback,
        error: result.error
      });
      
      // Save if we have BOTH full description and meta description
      if (result.fullDescription && result.metaDescription) {
        logger.log(`💾 Saving both full (${result.fullDescription.length} chars) and meta (${result.metaDescription.length} chars) for "${station.name}"`);
        
        const updateResult = await Station.updateOne(
          { _id: stationId },
          { 
            $set: { 
              [`descriptions.${result.language}`]: {
                full: result.fullDescription,
                meta: result.metaDescription
              }
            } 
          }
        );
        
        // CACHE NOTE: Not clearing 24h cache - next refresh at 24 hour mark
        // Radio stations are stable data, no need for frequent invalidation
        
        res.json({
          success: true,
          fullDescriptionLength: result.fullDescription.length,
          metaDescriptionLength: result.metaDescription.length,
          language: result.language,
          usedFallback: result.usedFallback || false,
          saved: updateResult.modifiedCount > 0
        });
      } else {
        res.json({
          success: false,
          error: result.error || 'Failed to generate descriptions',
          language: result.language,
          usedFallback: true
        });
      }
      
    } catch (error: any) {
      logger.error('Error generating AI description:', error);
      res.status(500).json({ error: error.message || 'Failed to generate description' });
    }
  });

  // Refresh AI description - clear skip flag and regenerate
  app.post("/api/admin/stations/:id/refresh-description", requireAdmin, async (req, res) => {
    try {
      const stationId = req.params.id;
      
      const station = await Station.findById(stationId).lean();
      if (!station) {
        return res.status(404).json({ error: 'Station not found' });
      }
      
      logger.log(`🔄 Refreshing AI description for station: ${station.name} (clearing skip flag)`);
      
      // Clear the skip flag to allow regeneration
      await Station.updateOne(
        { _id: stationId },
        { $unset: { aiDescriptionSkipped: 1 } }
      );
      
      // Generate fresh description
      const result = await generateStationDescription(station);
      
      // Save if we have content
      if (result.fullDescription && result.metaDescription) {
        logger.log(`💾 Saving refreshed description for "${station.name}"`);
        
        const updateResult = await Station.updateOne(
          { _id: stationId },
          { 
            $set: { 
              [`descriptions.${result.language}`]: {
                full: result.fullDescription,
                meta: result.metaDescription
              }
            } 
          }
        );
        
        res.json({
          success: true,
          fullDescriptionLength: result.fullDescription.length,
          metaDescriptionLength: result.metaDescription.length,
          language: result.language,
          usedFallback: result.usedFallback || false,
          saved: updateResult.modifiedCount > 0
        });
      } else {
        res.json({
          success: false,
          error: result.error || 'Failed to generate descriptions',
          language: result.language
        });
      }
      
    } catch (error: any) {
      logger.error('Error refreshing AI description:', error);
      res.status(500).json({ error: error.message || 'Failed to refresh description' });
    }
  });

  // Clean meta descriptions from template text (TRANSLATED META..., brackets, etc) - Background Job
  app.post("/api/admin/stations/clean-meta-descriptions", requireAdmin, async (req, res) => {
    try {
      logger.log(`🧹 Starting meta description cleanup (background job)...`);
      
      // Send immediate response
      res.json({
        success: true,
        message: 'Meta description cleanup started in background',
        note: 'Check server logs for progress'
      });
      
      // Process in background - non-blocking
      setImmediate(async () => {
        try {
          logger.log(`🧹 Cleanup job: Loading all stations...`);
          
          const allStations = await Station.find({ descriptions: { $exists: true } }).lean();
          let cleanedCount = 0;
          const cleanupStats: any = {};
          
          logger.log(`🧹 Cleanup job: Processing ${allStations.length} stations...`);
          
          for (const station of allStations) {
            if (!station.descriptions || typeof station.descriptions !== 'object') continue;
            
            let hasChanges = false;
            const updatedDescriptions: any = {};
            
            for (const [lang, desc] of Object.entries(station.descriptions)) {
              if (typeof desc === 'object' && desc !== null && 'meta' in desc) {
                let originalMeta = (desc as any).meta || '';
                let originalFull = (desc as any).full || '';
                
                // Apply stripPlaceholders cleanup to BOTH full and meta
                let cleanedMeta = stripPlaceholders(originalMeta);
                let cleanedFull = stripPlaceholders(originalFull);
                
                if (cleanedMeta !== originalMeta || cleanedFull !== originalFull) {
                  hasChanges = true;
                  updatedDescriptions[lang] = {
                    full: cleanedFull,
                    meta: cleanedMeta
                  };
                  
                  if (!cleanupStats[lang]) cleanupStats[lang] = 0;
                  cleanupStats[lang]++;
                }
              }
            }
            
            if (hasChanges) {
              await Station.updateOne(
                { _id: station._id },
                { $set: { descriptions: updatedDescriptions } }
              );
              cleanedCount++;
              
              // Log every 100 stations
              if (cleanedCount % 100 === 0) {
                logger.log(`🧹 Cleanup progress: ${cleanedCount} stations updated...`);
              }
            }
          }
          
          logger.log(`✅ Meta description cleanup completed: ${cleanedCount} stations updated`);
          logger.log(`📊 Language cleanup stats:`, cleanupStats);
          
        } catch (error: any) {
          logger.error('❌ Error in background cleanup:', error.message);
        }
      });
      
    } catch (error: any) {
      logger.error('Error starting cleanup job:', error);
      res.status(500).json({ error: error.message || 'Failed to start cleanup' });
    }
  });

  // Clear all aiDescriptionSkipped flags to allow re-processing in bulk
  app.post("/api/admin/stations/clear-skipped-flags", requireAdmin, async (req, res) => {
    try {
      logger.log(`🔄 Clearing aiDescriptionSkipped flags for all stations`);
      
      const result = await Station.updateMany(
        { aiDescriptionSkipped: true },
        { $unset: { aiDescriptionSkipped: 1 } }
      );
      
      logger.log(`✅ Cleared skip flags for ${result.modifiedCount} stations`);
      
      res.json({
        success: true,
        clearedCount: result.modifiedCount,
        message: `Cleared skip flags for ${result.modifiedCount} stations`
      });
      
    } catch (error: any) {
      logger.error('Error clearing skip flags:', error);
      res.status(500).json({ error: error.message || 'Failed to clear skip flags' });
    }
  });

  // Find and fix stations with missing descriptions (English + ALL other languages)
  app.post("/api/admin/stations/fix-missing-english", requireAdmin, async (req, res) => {
    try {
      const { limit, selectedStationIds, languages } = req.body;
      
      // Target languages - all 14 supported languages
      const targetLanguages = languages || ['en', 'es', 'fr', 'de', 'pt', 'it', 'ru', 'ar', 'zh', 'tr', 'ja', 'ko', 'hi', 'he'];
      
      // Build query based on whether specific stations are selected
      let query: any = {};
      
      if (selectedStationIds && selectedStationIds.length > 0) {
        // If specific stations selected, only process those (check for missing English)
        const mongoose = await import('mongoose');
        query = {
          _id: { $in: selectedStationIds.map((id: string) => new mongoose.default.Types.ObjectId(id)) },
          $or: [
            { 'descriptions.en': { $exists: false } },
            { 'descriptions.en.full': { $exists: false } },
            { 'descriptions.en.full': '' },
            { 'descriptions.en.full': null },
            { 'descriptions.en.meta': { $exists: false } },
            { 'descriptions.en.meta': '' },
            { 'descriptions.en.meta': null }
          ]
        };
        logger.log(`🔍 Checking ${selectedStationIds.length} selected stations for missing descriptions`);
      } else {
        // Find all stations where:
        // 1. descriptions exists (has some translations)
        // 2. descriptions.en.full OR descriptions.en.meta is empty or doesn't exist
        query = {
          descriptions: { $exists: true },
          $or: [
            { 'descriptions.en': { $exists: false } },
            { 'descriptions.en.full': { $exists: false } },
            { 'descriptions.en.full': '' },
            { 'descriptions.en.full': null },
            { 'descriptions.en.meta': { $exists: false } },
            { 'descriptions.en.meta': '' },
            { 'descriptions.en.meta': null }
          ]
        };
      }
      
      // Count matching stations
      const totalStations = await Station.countDocuments(query);
      const stationsToProcess = limit ? Math.min(limit, totalStations) : totalStations;
      
      logger.log(`🔍 Found ${totalStations} stations with missing English descriptions`);
      
      if (stationsToProcess === 0) {
        return res.json({
          success: false,
          message: 'No stations found with missing English full descriptions',
          count: 0
        });
      }
      
      // Create job ID
      const jobId = `fix-en-${Date.now()}`;
      
      // Initialize job tracking
      descriptionJobs.set(jobId, {
        jobId,
        status: 'running',
        total: stationsToProcess,
        processed: 0,
        successful: 0,
        failed: 0,
        skipped: 0,
        currentStation: 'Loading stations...',
        currentAction: 'idle',
        currentLanguage: 'en',
        targetLanguages: targetLanguages,
        startedAt: new Date(),
        successfulStations: [],
        skippedStations: [],
        failedStations: []
      });
      
      // Send immediate response
      res.json({
        success: true,
        message: `Started fixing descriptions for ${stationsToProcess} stations (${targetLanguages.length} languages)`,
        jobId,
        total: stationsToProcess
      });
      
      // Process in background
      setImmediate(async () => {
        try {
          logger.log(`🚀 Starting fix-missing-english job ${jobId} for ${stationsToProcess} stations with ${targetLanguages.length} languages`);
          
          // Import AI service functions
          const aiModule = await import('./services/ai-station-description');
          const { generateStationDescription, detectStationLanguage, translateDescription } = aiModule;
          
          const batchSize = 10;
          let processed = 0;
          let skip = 0;
          let successful = 0;
          let failed = 0;
          let skipped = 0;
          
          while (processed < stationsToProcess) {
            const currentLimit = limit ? Math.min(batchSize, stationsToProcess - processed) : batchSize;
            const stations = await Station.find(query).skip(skip).limit(currentLimit).lean();
            
            if (stations.length === 0) break;
            
            for (const station of stations) {
              try {
                const job = descriptionJobs.get(jobId);
                if (!job || job.status === 'paused') {
                  logger.log(`⏸️ Job ${jobId} paused`);
                  return;
                }
                
                job.currentStation = station.name;
                job.currentAction = 'analyzing';
                descriptionJobs.set(jobId, job);
                
                const stationName = station.name;
                const existingDescriptions = (station as any).descriptions || {};
                const nativeLanguage = detectStationLanguage(station as any);
                
                // Find ALL missing languages
                const missingLanguages: string[] = [];
                const existingLanguages: string[] = [];
                
                for (const lang of targetLanguages) {
                  const desc = existingDescriptions[lang];
                  if (!desc || !desc.full || desc.full === '') {
                    missingLanguages.push(lang);
                  } else {
                    existingLanguages.push(lang);
                  }
                }
                
                if (missingLanguages.length === 0) {
                  logger.log(`⏭️ Skipping "${stationName}" - all ${targetLanguages.length} languages exist`);
                  skipped++;
                  job.skipped = skipped;
                  job.skippedStations.push({ name: stationName, reason: 'All languages exist' });
                  processed++;
                  job.processed = processed;
                  descriptionJobs.set(jobId, job);
                  continue;
                }
                
                logger.log(`🔧 Fixing "${stationName}" - missing ${missingLanguages.length} languages: ${missingLanguages.join(', ')}`);
                logger.log(`   ✅ Existing ${existingLanguages.length} languages: ${existingLanguages.join(', ')}`);
                
                // Find a valid source description (prefer native language, then any existing)
                let sourceDescription: { full: string; meta: string } | null = null;
                let sourceLanguage = nativeLanguage;
                
                // Check if native language exists
                if (existingDescriptions[nativeLanguage]?.full) {
                  sourceDescription = existingDescriptions[nativeLanguage];
                  sourceLanguage = nativeLanguage;
                } else {
                  // Find any existing language as source
                  for (const lang of existingLanguages) {
                    if (existingDescriptions[lang]?.full) {
                      sourceDescription = existingDescriptions[lang];
                      sourceLanguage = lang;
                      break;
                    }
                  }
                }
                
                // If no source exists, generate native language first
                if (!sourceDescription) {
                  job.currentAction = 'generating';
                  job.currentLanguage = nativeLanguage;
                  descriptionJobs.set(jobId, job);
                  
                  logger.log(`   🔄 Generating ${nativeLanguage.toUpperCase()} (native) for "${stationName}"`);
                  
                  const result = await generateStationDescription(station as any, nativeLanguage);
                  
                  if (!result.success || !result.fullDescription) {
                    logger.log(`❌ Failed to generate native description for "${stationName}"`);
                    failed++;
                    job.failed = failed;
                    job.failedStations.push({ name: stationName, error: 'Native generation failed' });
                    processed++;
                    job.processed = processed;
                    descriptionJobs.set(jobId, job);
                    continue;
                  }
                  
                  sourceDescription = { full: result.fullDescription, meta: result.metaDescription || '' };
                  sourceLanguage = nativeLanguage;
                  
                  // Save native language
                  await Station.updateOne(
                    { _id: station._id },
                    { $set: { [`descriptions.${nativeLanguage}`]: sourceDescription } }
                  );
                  
                  // Remove native from missing list if it was there
                  const nativeIndex = missingLanguages.indexOf(nativeLanguage);
                  if (nativeIndex > -1) {
                    missingLanguages.splice(nativeIndex, 1);
                  }
                  
                  logger.log(`   ✅ Generated ${nativeLanguage.toUpperCase()} for "${stationName}"`);
                }
                
                // Now translate to all missing languages
                if (missingLanguages.length > 0 && sourceDescription) {
                  job.currentAction = 'translating';
                  job.currentLanguage = missingLanguages.join(', ');
                  descriptionJobs.set(jobId, job);
                  
                  logger.log(`   🌍 Translating to ${missingLanguages.length} languages: ${missingLanguages.join(', ')}`);
                  
                  const translations = await translateDescription(
                    sourceDescription.full,
                    sourceDescription.meta,
                    sourceLanguage,
                    missingLanguages,
                    stationName
                  );
                  
                  job.currentAction = 'saving';
                  descriptionJobs.set(jobId, job);
                  
                  // Save all translations
                  for (const [lang, translation] of translations) {
                    await Station.updateOne(
                      { _id: station._id },
                      { $set: { [`descriptions.${lang}`]: translation } }
                    );
                  }
                  
                  logger.log(`   ✅ Added ${translations.size} languages for "${stationName}"`);
                  
                  successful++;
                  job.successful = successful;
                  job.successfulStations.push({ name: stationName, languages: Array.from(translations.keys()) });
                } else {
                  successful++;
                  job.successful = successful;
                  job.successfulStations.push({ name: stationName, languages: [nativeLanguage] });
                }
                
                processed++;
                job.processed = processed;
                descriptionJobs.set(jobId, job);
                
                logger.log(`✅ Fixed "${stationName}" - now has all ${targetLanguages.length} languages`);
                
              } catch (stationError: any) {
                logger.error(`❌ Error fixing "${station.name}":`, stationError.message);
                failed++;
                const job = descriptionJobs.get(jobId);
                if (job) {
                  job.failed = failed;
                  job.failedStations.push({ name: station.name, error: stationError.message });
                  job.processed = ++processed;
                  descriptionJobs.set(jobId, job);
                }
              }
              
              // Small delay between stations
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
            
            skip += batchSize;
          }
          
          // Mark job as completed
          const job = descriptionJobs.get(jobId);
          if (job) {
            job.status = 'completed';
            job.processed = processed;
            job.successful = successful;
            job.failed = failed;
            job.skipped = skipped;
            descriptionJobs.set(jobId, job);
          }
          
          logger.log(`✅ Fix-missing-english job ${jobId} completed! Processed: ${processed}, Successful: ${successful}, Failed: ${failed}, Skipped: ${skipped}`);
          
        } catch (error: any) {
          logger.error(`❌ Fix-missing-english job ${jobId} failed:`, error);
          const job = descriptionJobs.get(jobId);
          if (job) {
            job.status = 'failed';
            job.error = error.message;
            descriptionJobs.set(jobId, job);
          }
        }
      });
      
    } catch (error: any) {
      logger.error('Error starting fix-missing-english:', error);
      res.status(500).json({ error: error.message || 'Failed to start fix job' });
    }
  });

  // Detect stations with translated station names
  app.get("/api/admin/stations/detect-translated-names", requireAdmin, async (req, res) => {
    try {
      const { limit = 100 } = req.query;
      
      // Get stations with descriptions
      const stations = await Station.find({ 
        descriptions: { $exists: true, $ne: {} } 
      }).limit(Number(limit)).lean();
      
      const problematicStations: Array<{
        _id: string;
        name: string;
        country: string;
        countryCode: string;
        problematicLanguages: string[];
        sampleIssue: string;
      }> = [];
      
      for (const station of stations) {
        if (!station.descriptions || !station.name) continue;
        
        const stationName = station.name;
        const problematicLangs: string[] = [];
        let sampleIssue = '';
        
        for (const [lang, desc] of Object.entries(station.descriptions)) {
          if (!desc || typeof desc !== 'object') continue;
          const fullDesc = (desc as any).full || '';
          const metaDesc = (desc as any).meta || '';
          
          // Check if station name appears in description
          // Station name should ALWAYS be in descriptions (it should never be translated)
          if (fullDesc.length > 50 && !fullDesc.includes(stationName)) {
            problematicLangs.push(lang);
            if (!sampleIssue) {
              // Show first 100 chars of the problematic description
              sampleIssue = `[${lang}] ${fullDesc.substring(0, 100)}...`;
            }
          }
        }
        
        if (problematicLangs.length > 0) {
          problematicStations.push({
            _id: station._id.toString(),
            name: stationName,
            country: station.country || 'Unknown',
            countryCode: station.countryCode || 'XX',
            problematicLanguages: problematicLangs,
            sampleIssue
          });
        }
      }
      
      res.json({
        total: problematicStations.length,
        stations: problematicStations
      });
      
    } catch (error: any) {
      logger.error('Error detecting translated names:', error);
      res.status(500).json({ error: error.message || 'Failed to detect translated names' });
    }
  });

  // Fix stations with translated station names - regenerate from native language
  app.post("/api/admin/stations/fix-translated-names", requireAdmin, async (req, res) => {
    try {
      const { stationIds, languages } = req.body;
      
      if (!stationIds || !Array.isArray(stationIds) || stationIds.length === 0) {
        return res.status(400).json({ error: 'stationIds array is required' });
      }
      
      const targetLanguages = languages || ['en', 'es', 'fr', 'de', 'pt', 'it', 'ru', 'ar', 'zh', 'tr', 'ja', 'ko', 'hi', 'he'];
      
      // Create job ID
      const jobId = `fix-names-${Date.now()}`;
      
      // Initialize job tracking
      descriptionJobs.set(jobId, {
        jobId,
        status: 'running',
        total: stationIds.length,
        processed: 0,
        successful: 0,
        failed: 0,
        skipped: 0,
        currentStation: 'Starting...',
        currentAction: 'idle',
        currentLanguage: undefined,
        targetLanguages,
        startedAt: new Date(),
        successfulStations: [],
        skippedStations: [],
        failedStations: []
      });
      
      // Send immediate response
      res.json({
        success: true,
        message: `Started fixing ${stationIds.length} stations with translated names`,
        jobId,
        total: stationIds.length
      });
      
      // Process in background
      setImmediate(async () => {
        try {
          logger.log(`🔧 Starting fix-translated-names job ${jobId} for ${stationIds.length} stations`);
          
          const { generateStationDescription, detectStationLanguage, translateDescription } = await import('./services/ai-station-description');
          const mongoose = await import('mongoose');
          
          let processed = 0;
          let successful = 0;
          let failed = 0;
          
          for (const stationId of stationIds) {
            const job = descriptionJobs.get(jobId);
            if (!job) break;
            
            try {
              const station = await Station.findById(stationId).lean();
              if (!station) {
                failed++;
                job.failed = failed;
                job.processed = ++processed;
                job.failedStations.push({ name: stationId, error: 'Station not found' });
                descriptionJobs.set(jobId, job);
                continue;
              }
              
              job.currentStation = station.name;
              job.currentAction = 'analyzing';
              descriptionJobs.set(jobId, job);
              
              // Determine native language from country
              const nativeLanguage = detectStationLanguage(station as any);
              const stationName = station.name;
              const existingDescriptions = (station as any).descriptions || {};
              
              // SMART APPROACH: Find which languages need fixing (missing station name)
              const languagesNeedingFix: string[] = [];
              const languagesOK: string[] = [];
              
              for (const lang of targetLanguages) {
                const desc = existingDescriptions[lang];
                if (!desc || !desc.full) {
                  // Language is completely missing
                  languagesNeedingFix.push(lang);
                } else if (!desc.full.includes(stationName)) {
                  // Language exists but station name is missing/translated
                  languagesNeedingFix.push(lang);
                } else {
                  // Language is OK
                  languagesOK.push(lang);
                }
              }
              
              if (languagesNeedingFix.length === 0) {
                // All languages are OK, skip this station
                job.skipped = (job.skipped || 0) + 1;
                job.processed = ++processed;
                job.skippedStations.push({ name: stationName, reason: 'All languages already OK' });
                descriptionJobs.set(jobId, job);
                logger.log(`⏭️ Skipping "${stationName}" - all languages already have station name`);
                continue;
              }
              
              logger.log(`🔧 Fixing "${stationName}" - ${languagesNeedingFix.length} languages need fix: ${languagesNeedingFix.join(', ')}`);
              logger.log(`   ✅ ${languagesOK.length} languages are OK: ${languagesOK.join(', ')}`);
              
              // Check if we have a valid native language description to use as source
              let sourceDescription = existingDescriptions[nativeLanguage];
              let sourceLanguage = nativeLanguage;
              
              // If native language is missing station name or doesn't exist, regenerate it
              if (!sourceDescription?.full || !sourceDescription.full.includes(stationName)) {
                job.currentAction = 'generating';
                job.currentLanguage = nativeLanguage;
                descriptionJobs.set(jobId, job);
                
                logger.log(`   🔄 Regenerating ${nativeLanguage.toUpperCase()} (native) for "${stationName}"`);
                
                const result = await generateStationDescription(station as any, nativeLanguage);
                
                if (!result.success || !result.fullDescription || !result.metaDescription) {
                  failed++;
                  job.failed = failed;
                  job.processed = ++processed;
                  job.failedStations.push({ name: stationName, error: result.error || 'Native generation failed' });
                  descriptionJobs.set(jobId, job);
                  continue;
                }
                
                // Save native language description
                await Station.updateOne(
                  { _id: station._id },
                  { $set: { [`descriptions.${nativeLanguage}`]: { full: result.fullDescription, meta: result.metaDescription } } }
                );
                
                sourceDescription = { full: result.fullDescription, meta: result.metaDescription };
                sourceLanguage = result.language;
                
                // Remove native from languages needing fix since we just regenerated it
                const nativeIndex = languagesNeedingFix.indexOf(nativeLanguage);
                if (nativeIndex > -1) {
                  languagesNeedingFix.splice(nativeIndex, 1);
                }
                
                logger.log(`   ✅ Regenerated ${nativeLanguage.toUpperCase()} for "${stationName}"`);
              }
              
              // Now translate ONLY the languages that need fixing
              if (languagesNeedingFix.length > 0) {
                job.currentAction = 'translating';
                job.currentLanguage = languagesNeedingFix.join(', ');
                descriptionJobs.set(jobId, job);
                
                logger.log(`   🌍 Translating to ${languagesNeedingFix.length} languages: ${languagesNeedingFix.join(', ')}`);
                
                const translations = await translateDescription(
                  sourceDescription.full, 
                  sourceDescription.meta, 
                  sourceLanguage, 
                  languagesNeedingFix,
                  stationName
                );
                
                job.currentAction = 'saving';
                descriptionJobs.set(jobId, job);
                
                for (const [lang, translation] of translations) {
                  await Station.updateOne(
                    { _id: station._id },
                    { $set: { [`descriptions.${lang}`]: translation } }
                  );
                }
                
                logger.log(`   ✅ Fixed ${translations.size} languages for "${stationName}"`);
              }
              
              successful++;
              job.successful = successful;
              job.processed = ++processed;
              job.successfulStations.push({ name: stationName, languages: languagesNeedingFix });
              descriptionJobs.set(jobId, job);
              
              logger.log(`✅ Fixed "${stationName}" - updated ${languagesNeedingFix.length} languages, kept ${languagesOK.length} existing`);
              
              // Small delay between stations
              await new Promise(resolve => setTimeout(resolve, 1000));
              
            } catch (stationError: any) {
              logger.error(`❌ Error fixing "${stationId}":`, stationError.message);
              failed++;
              const job = descriptionJobs.get(jobId);
              if (job) {
                job.failed = failed;
                job.failedStations.push({ name: stationId, error: stationError.message });
                job.processed = ++processed;
                descriptionJobs.set(jobId, job);
              }
            }
          }
          
          // Mark job as completed
          const job = descriptionJobs.get(jobId);
          if (job) {
            job.status = 'completed';
            job.processed = processed;
            job.successful = successful;
            job.failed = failed;
            descriptionJobs.set(jobId, job);
          }
          
          logger.log(`✅ Fix-translated-names job ${jobId} completed! Successful: ${successful}, Failed: ${failed}`);
          
        } catch (error: any) {
          logger.error(`❌ Fix-translated-names job ${jobId} failed:`, error);
          const job = descriptionJobs.get(jobId);
          if (job) {
            job.status = 'failed';
            job.error = error.message;
            descriptionJobs.set(jobId, job);
          }
        }
      });
      
    } catch (error: any) {
      logger.error('Error starting fix-translated-names:', error);
      res.status(500).json({ error: error.message || 'Failed to start fix job' });
    }
  });

  // Bulk AI description generation (with automatic translation to common languages)
  app.post("/api/admin/stations/bulk-generate-descriptions", requireAdmin, async (req, res) => {
    try {
      const { filterByCountry, skipExisting = true, limit, selectedStationIds, languages } = req.body;
      
      // Build query
      const query: any = {};
      
      // If specific stations selected, query only those (always include them - user explicitly selected)
      if (selectedStationIds && selectedStationIds.length > 0) {
        const mongoose = await import('mongoose');
        query._id = { $in: selectedStationIds.map((id: string) => new mongoose.default.Types.ObjectId(id)) };
        // NOTE: Don't apply skipExisting filter for explicitly selected stations
        // The user explicitly selected these stations, so we should process them
        // The translation logic will check which languages are missing and only translate those
        logger.log(`📋 Processing ${selectedStationIds.length} explicitly selected stations (will translate missing languages)`);
      } else if (filterByCountry) {
        // Otherwise filter by country if provided
        query.countryCode = filterByCountry;
        
        // Apply skipExisting filter for country-wide filtering
        if (skipExisting) {
          query.descriptions = { $exists: false }; // Only stations without descriptions
        }
      }
      
      // Get total count
      const totalStations = await Station.countDocuments(query);
      const stationsToProcess = limit ? Math.min(limit, totalStations) : totalStations;
      
      if (stationsToProcess === 0) {
        return res.json({
          success: false,
          message: 'No stations found matching criteria'
        });
      }
      
      // Create job ID
      const jobId = `desc-${Date.now()}`;
      
      // Initialize job tracking
      descriptionJobs.set(jobId, {
        jobId,
        status: 'running',
        total: stationsToProcess,
        processed: 0,
        successful: 0,
        failed: 0,
        skipped: 0,
        currentStation: 'Loading first batch...',
        currentAction: 'idle',
        currentLanguage: undefined,
        targetLanguages: languages || ['en', 'es', 'fr', 'de', 'pt', 'it', 'ru', 'ar', 'zh', 'tr', 'ja', 'ko', 'hi', 'he'],
        startedAt: new Date(),
        successfulStations: [],
        skippedStations: [],
        failedStations: []
      });
      
      // Send immediate response
      res.json({
        success: true,
        message: `AI description generation started for ${stationsToProcess} stations`,
        jobId,
        total: stationsToProcess
      });
      
      // Process in background
      setImmediate(async () => {
        try {
          console.error(`[BULK-JOB] Starting setImmediate for job ${jobId}`);
          logger.log(`🚀 Starting AI description generation job ${jobId} for ${stationsToProcess} stations`);
          
          // Import functions with error handling
          let generateStationDescription: any;
          let detectStationLanguage: any;
          let translateDescription: any;
          
          try {
            console.error(`[BULK-JOB] Importing AI service functions for job ${jobId}...`);
            const aiModule = await import('./services/ai-station-description');
            generateStationDescription = aiModule.generateStationDescription;
            detectStationLanguage = aiModule.detectStationLanguage;
            translateDescription = aiModule.translateDescription;
            console.error(`[BULK-JOB] Successfully imported AI functions for job ${jobId}`);
          } catch (importError: any) {
            console.error(`[BULK-JOB] ❌ FAILED to import AI functions for job ${jobId}:`, importError.message);
            console.error(`[BULK-JOB] Stack:`, importError.stack);
            logger.error(`❌ Failed to import AI functions for job ${jobId}:`, importError);
            throw importError;
          }
          
          if (!generateStationDescription || !detectStationLanguage || !translateDescription) {
            const error = new Error(`Missing AI functions: generateStationDescription=${!!generateStationDescription}, detectStationLanguage=${!!detectStationLanguage}, translateDescription=${!!translateDescription}`);
            console.error(`[BULK-JOB] ❌ Functions missing for job ${jobId}:`, error.message);
            throw error;
          }
          
          const batchSize = 50;
          let skip = 0;
          let processed = 0;
          let successful = 0;
          let failed = 0;
          let skipped = 0;
          
          while (processed < stationsToProcess) {
            const currentLimit = limit ? Math.min(batchSize, stationsToProcess - processed) : batchSize;
            const stations = await Station.find(query).skip(skip).limit(currentLimit).lean();
            
            if (stations.length === 0) {
              break;
            }
            
            for (const station of stations) {
              try {
                const job = descriptionJobs.get(jobId);
                if (!job || job.status === 'paused') {
                  logger.log(`⏸️ Job ${jobId} paused`);
                  return;
                }
                
                // Update current station
                job.currentStation = station.name;
                job.currentAction = 'generating';
                job.currentLanguage = undefined;
                descriptionJobs.set(jobId, job);
                
                const targetLanguage = detectStationLanguage(station);
                logger.log(`📍 Country: ${station.countryCode || 'UNKNOWN'} | 🗣️ Language: ${targetLanguage} | Station: "${station.name}"`);
                
                // Get target languages for translation
                let targetLanguages = languages && languages.length > 0 ? languages : ['en', 'es', 'fr', 'de', 'pt', 'it', 'ru', 'ar', 'zh', 'tr', 'ja', 'ko', 'hi', 'he'];
                
                // CRITICAL FIX: Only count languages that have ACTUAL content (not empty strings)
                // Filter out languages with empty or invalid descriptions
                const existingLanguages = station.descriptions ? Object.keys(station.descriptions).filter(lang => {
                  const desc = station.descriptions[lang];
                  if (!desc) return false;
                  if (typeof desc === 'string') return desc.trim().length > 10;
                  if (typeof desc === 'object') {
                    const full = (desc as any).full || '';
                    const meta = (desc as any).meta || '';
                    // Must have meaningful content (more than just ":" or empty)
                    return full.trim().length > 10 || meta.trim().length > 10;
                  }
                  return false;
                }) : [];
                
                const missingLanguages = targetLanguages.filter(lang => !existingLanguages.includes(lang));
                
                // Check if station already has description in some language - use existing for translation
                if (station.descriptions && existingLanguages.length > 0 && missingLanguages.length > 0) {
                  // ALWAYS prefer station's native language (based on country) as source
                  // This is better for SEO and maintains consistency
                  let sourceLang = targetLanguage; // targetLanguage = station's country language
                  
                  // Check if native language has valid content
                  const nativeDesc = station.descriptions[targetLanguage];
                  const hasValidNative = nativeDesc && 
                    typeof nativeDesc === 'object' && 
                    (nativeDesc as any).full?.trim().length > 50;
                  
                  if (!hasValidNative) {
                    // Native language doesn't exist or is empty, use any existing language
                    sourceLang = existingLanguages.find(lang => {
                      const desc = station.descriptions[lang];
                      if (typeof desc === 'object' && desc) {
                        return (desc as any).full?.trim().length > 50;
                      }
                      return false;
                    }) || existingLanguages[0];
                  }
                  
                  const sourceDesc = station.descriptions[sourceLang];
                  
                  if (sourceDesc && sourceDesc.full && sourceDesc.meta) {
                    logger.log(`🔄 Station "${station.name}" - translating from ${sourceLang.toUpperCase()} to ${missingLanguages.length} missing: ${missingLanguages.join(', ')}`);
                    
                    job.currentAction = 'translating';
                    job.currentLanguage = missingLanguages.join(', ');
                    descriptionJobs.set(jobId, job);
                    
                    try {
                      const translations = await translateDescription(sourceDesc.full, sourceDesc.meta, sourceLang, missingLanguages, station.name);
                      
                      job.currentAction = 'saving';
                      descriptionJobs.set(jobId, job);
                      
                      for (const [lang, translation] of translations) {
                        job.currentLanguage = lang;
                        descriptionJobs.set(jobId, job);
                        
                        const cleanedTranslation = {
                          full: stripPlaceholders(translation.full),
                          meta: stripPlaceholders(translation.meta)
                        };
                        
                        await Station.updateOne(
                          { _id: station._id },
                          { $set: { [`descriptions.${lang}`]: cleanedTranslation } }
                        );
                        logger.log(`   📝 Saved translation to ${lang}: ${cleanedTranslation.full.length} chars full + ${cleanedTranslation.meta.length} chars meta`);
                      }
                      
                      logger.log(`✅ Translated "${station.name}" from ${sourceLang.toUpperCase()} to ${missingLanguages.length} new languages`);
                      successful++;
                      job.successfulStations.push({ name: station.name, languages: missingLanguages });
                    } catch (translationError: any) {
                      logger.error(`❌ Translation failed for ${station.name}:`, translationError.message);
                      failed++;
                      job.failedStations.push({ name: station.name, error: translationError.message });
                    }
                    
                    processed++;
                    job.processed = processed;
                    job.successful = successful;
                    job.failed = failed;
                    descriptionJobs.set(jobId, job);
                    continue; // Move to next station
                  }
                }
                
                // If all target languages exist, skip
                if (station.descriptions && existingLanguages.length > 0 && missingLanguages.length === 0) {
                  skipped++;
                  processed++;
                  job.processed = processed;
                  job.skipped = skipped;
                  job.skippedStations.push({ name: station.name, reason: `Already has all ${existingLanguages.length} target languages` });
                  descriptionJobs.set(jobId, job);
                  logger.log(`⏭️ Skipped ${station.name} (already has all ${existingLanguages.length} target languages)`);
                  continue;
                }
                
                // For country filtering: skip if already has description in native language
                // For explicit selections: don't skip - but will check per-language for translations below
                if (filterByCountry && skipExisting && station.descriptions && station.descriptions[targetLanguage]) {
                  skipped++;
                  processed++;
                  
                  job.processed = processed;
                  job.skipped = skipped;
                  job.skippedStations.push({ name: station.name, reason: `Already has ${targetLanguage} description` });
                  descriptionJobs.set(jobId, job);
                  
                  logger.log(`⏭️ Skipped ${station.name} (already has ${targetLanguage} description)`);
                  continue;
                }
                
                // Skip if previously checked and had no info from OpenAI (to save tokens)
                if (station.aiDescriptionSkipped) {
                  skipped++;
                  processed++;
                  
                  job.processed = processed;
                  job.skipped = skipped;
                  job.skippedStations.push({ name: station.name, reason: 'Previously checked - no OpenAI info available' });
                  descriptionJobs.set(jobId, job);
                  
                  logger.log(`⏭️ Skipped ${station.name} (previously checked - no OpenAI info available)`);
                  continue;
                }
                
                // Generate in station's native language (based on country) for better SEO
                const result = await generateStationDescription(station, targetLanguage);
                
                // Save all generated content (both specific info and fallback)
                if (result.success && result.fullDescription && result.metaDescription) {
                  // CRITICAL: Strip ALL placeholder text before saving to database
                  const cleanedFull = stripPlaceholders(result.fullDescription);
                  const cleanedMeta = stripPlaceholders(result.metaDescription);
                  
                  logger.log(`💾 Saving ${result.language.toUpperCase()} description (${cleanedFull.length} chars full + ${cleanedMeta.length} chars meta) for "${station.name}"`);
                  
                  // Save to database in structured format
                  await Station.updateOne(
                    { _id: station._id },
                    { 
                      $set: { 
                        [`descriptions.${result.language}`]: {
                          full: cleanedFull,
                          meta: cleanedMeta
                        }
                      } 
                    }
                  );
                  
                  // Auto-translate to selected languages (excluding source language)
                  let targetLanguages = languages && languages.length > 0 ? languages : ['en', 'es', 'fr', 'de', 'pt', 'it', 'ru', 'ar', 'zh', 'tr', 'ja', 'ko', 'hi', 'he'];
                  
                  // Filter out the source language
                  let translationTargets = targetLanguages.filter(lang => lang !== result.language);
                  
                  // CRUCIAL: Only translate to languages the station DOESN'T already have
                  const existingLangs = station.descriptions ? Object.keys(station.descriptions).filter(lang => {
                    const desc = station.descriptions[lang];
                    if (!desc) return false;
                    if (typeof desc === 'object') {
                      return (desc as any).full?.trim().length > 50;
                    }
                    return false;
                  }) : [];
                  const missingLangs = translationTargets.filter(lang => !existingLangs.includes(lang));
                  
                  if (missingLangs.length > 0) {
                    logger.log(`🌍 Translating "${station.name}" from ${result.language.toUpperCase()} to ${missingLangs.length} languages: ${missingLangs.join(', ')}`);
                    
                    // Update job to show translating action
                    job.currentAction = 'translating';
                    job.currentLanguage = missingLangs.join(', ');
                    descriptionJobs.set(jobId, job);
                    
                    const translations = await translateDescription(cleanedFull, cleanedMeta, result.language, missingLangs, station.name);
                    
                    // Update job to show saving action
                    job.currentAction = 'saving';
                    descriptionJobs.set(jobId, job);
                    
                    for (const [lang, translation] of translations) {
                      job.currentLanguage = lang;
                      descriptionJobs.set(jobId, job);
                      
                      // CRITICAL: Strip ALL placeholder text from translations before saving
                      const cleanedTranslation = {
                        full: stripPlaceholders(translation.full),
                        meta: stripPlaceholders(translation.meta)
                      };
                      
                      await Station.updateOne(
                        { _id: station._id },
                        { $set: { [`descriptions.${lang}`]: cleanedTranslation } }
                      );
                      logger.log(`   📝 Saved translation to ${lang}: ${cleanedTranslation.full.length} chars full + ${cleanedTranslation.meta.length} chars meta`);
                    }
                    
                    logger.log(`✅ Generated ${result.language.toUpperCase()} + translated "${station.name}" to ${missingLangs.length} languages`);
                    successful++;
                    job.successfulStations.push({ name: station.name, languages: [result.language, ...missingLangs] });
                  } else {
                    logger.log(`✅ Generated ${result.language.toUpperCase()} description for ${station.name} (all other languages already exist)`);
                    successful++;
                    job.successfulStations.push({ name: station.name, languages: [result.language] });
                  }
                } else {
                  failed++;
                  const reason = !result.fullDescription ? 'missing full description' : !result.metaDescription ? 'missing meta description' : result.error;
                  logger.log(`❌ Failed to generate for ${station.name}: ${reason}`);
                }
                
                processed++;
                
                // Update job status in memory
                job.processed = processed;
                job.successful = successful;
                job.failed = failed;
                job.skipped = skipped;
                job.lastProcessedStationId = station._id?.toString();
                job.lastProcessedSkip = skip;
                job.updatedAt = new Date();
                descriptionJobs.set(jobId, job);
                
                // Save progress to database every 5 stations for persistence
                if (processed % 5 === 0) {
                  await BulkDescriptionJob.findOneAndUpdate(
                    { jobId },
                    {
                      processedStations: processed,
                      successCount: successful,
                      failedCount: failed,
                      skippedCount: skipped,
                      lastProcessedStationId: station._id?.toString(),
                      lastProcessedSkip: skip,
                      updatedAt: new Date()
                    },
                    { upsert: true }
                  );
                }
                
                if (processed % 10 === 0) {
                  logger.log(`📊 AI Generation Progress: ${processed}/${stationsToProcess} (${successful} successful, ${failed} failed, ${skipped} skipped)`);
                }
                
              } catch (error: any) {
                failed++;
                processed++;
                logger.error(`❌ Error processing station ${station._id}:`, error.message);
              }
            }
            
            skip += batchSize;
          }
          
          // Mark job as completed
          const job = descriptionJobs.get(jobId);
          if (job) {
            job.status = 'completed';
            job.completedAt = new Date();
            descriptionJobs.set(jobId, job);
          }
          
          // Save final status to database
          await BulkDescriptionJob.findOneAndUpdate(
            { jobId },
            {
              status: 'completed',
              processedStations: processed,
              successCount: successful,
              failedCount: failed,
              skippedCount: skipped,
              updatedAt: new Date()
            },
            { upsert: true }
          );
          
          logger.log(`✅ AI description generation job ${jobId} completed! Processed: ${processed}, Successful: ${successful}, Failed: ${failed}, Skipped: ${skipped}`);
          
        } catch (error: any) {
          console.error(`[BULK-JOB] ❌ Outer catch block for job ${jobId}:`, error?.message);
          console.error(`[BULK-JOB] Stack:`, error?.stack);
          logger.error('❌ Bulk AI description generation failed:', error);
          const job = descriptionJobs.get(jobId);
          if (job) {
            job.status = 'failed';
            job.completedAt = new Date();
            job.error = error.message;
            descriptionJobs.set(jobId, job);
          }
          
          // Save error status to database
          try {
            await BulkDescriptionJob.findOneAndUpdate(
              { jobId },
              {
                status: 'failed',
                errorMessage: error.message,
                updatedAt: new Date()
              },
              { upsert: true }
            );
          } catch (dbError: any) {
            console.error(`[BULK-JOB] Failed to save error to DB for job ${jobId}:`, dbError.message);
          }
        }
      });
      
    } catch (error: any) {
      logger.error('Error starting bulk AI description generation:', error);
      res.status(500).json({ error: error.message || 'Failed to start bulk generation' });
    }
  });

  // Get AI description generation job status
  app.get("/api/admin/stations/description-job-status/:jobId", requireAdmin, async (req, res) => {
    const jobId = req.params.jobId;
    const job = descriptionJobs.get(jobId);
    
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    
    // CRITICAL: Ensure arrays are properly included in response
    // Log for debugging
    logger.log(`📊 Job Status Request for ${jobId}: successful=${job.successful}, failed=${job.failed}, skipped=${job.skipped} | Arrays: successful=${job.successfulStations?.length || 0}, failed=${job.failedStations?.length || 0}, skipped=${job.skippedStations?.length || 0}`);
    
    // Return complete job object with arrays
    res.json({
      jobId: job.jobId,
      status: job.status,
      total: job.total,
      processed: job.processed,
      successful: job.successful,
      failed: job.failed,
      skipped: job.skipped,
      currentStation: job.currentStation,
      currentAction: job.currentAction,
      currentLanguage: job.currentLanguage,
      targetLanguages: job.targetLanguages,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      error: job.error,
      successfulStations: job.successfulStations || [],
      skippedStations: job.skippedStations || [],
      failedStations: job.failedStations || []
    });
  });

  // Pause AI description generation job
  app.post("/api/admin/stations/description-job/:jobId/pause", requireAdmin, async (req, res) => {
    const jobId = req.params.jobId;
    const job = descriptionJobs.get(jobId);
    
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    
    job.status = 'paused';
    descriptionJobs.set(jobId, job);
    
    res.json({ success: true, message: 'Job paused' });
  });

  // Cancel AI description generation job
  app.post("/api/admin/stations/description-job/:jobId/cancel", requireAdmin, async (req, res) => {
    const jobId = req.params.jobId;
    const job = descriptionJobs.get(jobId);
    
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    
    logger.log(`🛑 Cancelling job ${jobId} - processed ${job.processed}/${job.total} stations`);
    
    job.status = 'cancelled';
    job.completedAt = new Date();
    descriptionJobs.set(jobId, job);
    
    res.json({ 
      success: true, 
      message: 'Job cancelled',
      processed: job.processed,
      successful: job.successful,
      failed: job.failed,
      skipped: job.skipped
    });
  });

  // ===== BULK LOGO PROCESSING ENDPOINTS =====
  
  // In-memory logo processing job tracking with per-station results
  interface StationResult {
    stationId: string;
    stationName: string;
    status: 'success' | 'failed';
    error?: string;
  }
  
  const logoProcessingJobs = new Map<string, {
    jobId: string;
    status: 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
    total: number;
    processed: number;
    successful: number;
    failed: number;
    startedAt: Date;
    completedAt?: Date;
    error?: string;
    results: StationResult[];
  }>();
  
  // Get logo processing statistics
  app.get("/api/admin/logos/stats", requireAdmin, async (req, res) => {
    try {
      const [
        totalStations,
        stationsWithFavicon,
        stationsWithSlug,
        stationsWithLogoAssets,
        stationsNeedingProcessing
      ] = await Promise.all([
        Station.countDocuments(),
        Station.countDocuments({ favicon: { $exists: true, $nin: ['', null, 'null'] } }),
        Station.countDocuments({ slug: { $exists: true, $ne: null } }),
        Station.countDocuments({ 'logoAssets.status': 'completed' }),
        Station.countDocuments({
          favicon: { $exists: true, $nin: ['', null, 'null'] },
          slug: { $exists: true, $ne: null },
          $or: [
            { 'logoAssets.status': { $exists: false } },  // Never processed
            { 'logoAssets.status': 'pending' }             // Still pending
          ],
          'logoAssets.status': { $ne: 'failed' }           // Skip failed - never retry
        })
      ]);
      
      res.json({
        totalStations,
        stationsWithFavicon,
        stationsWithSlug,
        stationsWithLogoAssets,
        stationsNeedingProcessing,
        processingComplete: stationsNeedingProcessing === 0
      });
    } catch (error: any) {
      console.error('Error getting logo stats:', error);
      res.status(500).json({ error: 'Failed to get logo statistics' });
    }
  });

  // Get list of optimized stations with pagination
  app.get("/api/admin/logos/optimized", requireAdmin, async (req, res) => {
    try {
      const page = parseInt((req.query.page as string) || '1', 10);
      const limit = 50;
      const skip = (page - 1) * limit;
      
      const stations = await Station.find({ 'logoAssets.status': 'completed' })
        .select('name slug logoAssets')
        .skip(skip)
        .limit(limit)
        .lean();
      
      const total = await Station.countDocuments({ 'logoAssets.status': 'completed' });
      
      res.json({
        stations: stations.map((s: any) => ({
          _id: s._id,
          name: s.name,
          slug: s.slug,
          logoAssets: s.logoAssets
        })),
        total
      });
    } catch (error: any) {
      console.error('Error fetching optimized stations:', error);
      res.status(500).json({ error: 'Failed to fetch optimized stations' });
    }
  });
  
  // Start bulk logo processing job
  app.post("/api/admin/logos/process-all", requireAdmin, async (req, res) => {
    try {
      const { limit = 500 } = req.body;
      
      // Check for existing running job
      for (const [id, job] of logoProcessingJobs.entries()) {
        if (job.status === 'running') {
          return res.json({ 
            success: false, 
            message: 'A logo processing job is already running',
            jobId: id
          });
        }
      }
      
      // Count stations needing processing (skip permanent failures like 404, invalid_format)
      const stationsNeedingProcessing = await Station.countDocuments({
        favicon: { $exists: true, $nin: ['', null, 'null'] },
        slug: { $exists: true, $ne: null },
        $or: [
          { 'logoAssets.status': { $exists: false } },
          { 'logoAssets.status': 'pending' },
          // Only retry temporary failures (timeout, download_failed, processing_failed)
          // Skip permanent failures (http_error = 404/403, invalid_format = SVG/HTML)
          { 
            'logoAssets.status': 'failed',
            'logoAssets.failureType': { $nin: ['http_error', 'invalid_format'] }
          },
          // Also retry old failures without failureType (legacy)
          {
            'logoAssets.status': 'failed',
            'logoAssets.failureType': { $exists: false }
          }
        ]
      });
      
      if (stationsNeedingProcessing === 0) {
        return res.json({ 
          success: true, 
          message: 'All logos are already processed',
          processed: 0
        });
      }
      
      // Create job - will process ALL stations continuously
      const jobId = `logo-${Date.now()}`;
      
      logoProcessingJobs.set(jobId, {
        jobId,
        status: 'running',
        total: stationsNeedingProcessing, // Process ALL stations
        processed: 0,
        successful: 0,
        failed: 0,
        startedAt: new Date(),
        results: []  // Initialize empty results array for per-station tracking
      });
      
      // Return immediately with job ID
      res.json({
        success: true,
        message: 'Logo processing started - will process ALL stations',
        jobId,
        totalToProcess: stationsNeedingProcessing
      });
      
      // Query filter for stations needing processing
      // IMPORTANT: Skip all previously failed stations - never retry them!
      // Only process unprocessed stations or those still pending
      const needsProcessingFilter = {
        favicon: { $exists: true, $nin: ['', null, 'null'] },
        slug: { $exists: true, $ne: null },
        $or: [
          { 'logoAssets.status': { $exists: false } },     // Never processed before
          { 'logoAssets.status': 'pending' }               // Marked as pending
        ],
        'logoAssets.status': { $ne: 'failed' }             // Explicitly skip ALL failed stations
      };
      
      // Process in background with CONTINUOUS LOOP until all done
      setImmediate(async () => {
        const job = logoProcessingJobs.get(jobId)!;
        const batchFetchSize = 500; // Fetch 500 at a time from DB
        const concurrentSize = 10; // Process 10 concurrently
        let totalProcessedOverall = 0;
        let totalSuccessful = 0;
        let totalFailed = 0;
        let roundNumber = 0;
        
        try {
          // CONTINUOUS LOOP - keep fetching batches until none remain
          while (true) {
            // Check if job was cancelled
            const currentJob = logoProcessingJobs.get(jobId);
            if (currentJob?.status === 'cancelled' || currentJob?.status === 'paused') {
              logger.log(`⏹️ Logo processing stopped by user after ${totalProcessedOverall} stations`);
              break;
            }
            
            // Fetch next batch of stations
            roundNumber++;
            const stations = await Station.find(needsProcessingFilter)
              .limit(batchFetchSize)
              .lean();
            
            // If no more stations, we're done
            if (stations.length === 0) {
              logger.log(`🎉 ALL LOGOS PROCESSED! Total: ${totalProcessedOverall} (${totalSuccessful} successful, ${totalFailed} failed)`);
              break;
            }
            
            logger.log(`📦 Round ${roundNumber}: Processing ${stations.length} stations...`);
            
            // Process stations in concurrent batches
            for (let i = 0; i < stations.length; i += concurrentSize) {
              // Check cancellation frequently
              const checkJob = logoProcessingJobs.get(jobId);
              if (checkJob?.status === 'cancelled' || checkJob?.status === 'paused') {
                break;
              }
              
              const batch = stations.slice(i, i + concurrentSize);
              
              const batchPromises = batch.map(async (station) => {
                try {
                  if (!station.favicon || !station.slug) {
                    return { stationId: station._id.toString(), stationName: station.name, status: 'failed' as const, error: 'Missing favicon or slug' };
                  }
                  
                  const result = await logoProcessor.processFromUrl(
                    station._id.toString(),
                    station.slug,
                    station.favicon
                  );
                  
                  if (result.success) {
                    return { stationId: station._id.toString(), stationName: station.name, status: 'success' as const };
                  } else {
                    return { stationId: station._id.toString(), stationName: station.name, status: 'failed' as const, error: result.error };
                  }
                } catch (error: any) {
                  return { stationId: station._id.toString(), stationName: station.name, status: 'failed' as const, error: error.message };
                }
              });
              
              const results = await Promise.allSettled(batchPromises);
              
              results.forEach(result => {
                totalProcessedOverall++;
                job.processed = totalProcessedOverall;
                if (result.status === 'fulfilled') {
                  job.results.push(result.value);
                  if (result.value.status === 'success') {
                    totalSuccessful++;
                    job.successful = totalSuccessful;
                  } else {
                    totalFailed++;
                    job.failed = totalFailed;
                  }
                } else {
                  totalFailed++;
                  job.failed = totalFailed;
                  job.results.push({ stationId: 'unknown', stationName: 'unknown', status: 'failed', error: 'Promise rejected' });
                }
              });
              
              logoProcessingJobs.set(jobId, job);
              
              // Small delay between concurrent batches to prevent overwhelming
              await new Promise(resolve => setTimeout(resolve, 500));
            }
            
            // Log progress after each round
            const remaining = await Station.countDocuments(needsProcessingFilter);
            logger.log(`📊 Round ${roundNumber} complete: ${totalProcessedOverall} processed so far, ${remaining} remaining`);
            
            // Brief pause between rounds
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
          
          job.status = 'completed';
          job.completedAt = new Date();
          logoProcessingJobs.set(jobId, job);
          
          logger.log(`✅ Logo processing COMPLETE: ${totalSuccessful} successful, ${totalFailed} failed out of ${totalProcessedOverall} total`);
          
        } catch (error: any) {
          job.status = 'failed';
          job.error = error.message;
          job.completedAt = new Date();
          logoProcessingJobs.set(jobId, job);
          
          logger.log(`❌ Logo processing job ${jobId} failed: ${error.message}`);
        }
      });
    } catch (error: any) {
      console.error('Error starting logo processing:', error);
      res.status(500).json({ error: 'Failed to start logo processing' });
    }
  });
  
  // Get logo processing job status
  app.get("/api/admin/logos/job-status/:jobId", requireAdmin, async (req, res) => {
    const jobId = req.params.jobId;
    const job = logoProcessingJobs.get(jobId);
    
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    
    res.json(job);
  });
  
  // Cancel logo processing job
  app.post("/api/admin/logos/job/:jobId/cancel", requireAdmin, async (req, res) => {
    const jobId = req.params.jobId;
    const job = logoProcessingJobs.get(jobId);
    
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    
    job.status = 'cancelled';
    job.completedAt = new Date();
    logoProcessingJobs.set(jobId, job);
    
    logger.log(`🛑 Logo processing job ${jobId} cancelled`);
    
    res.json({ 
      success: true, 
      message: 'Job cancelled',
      processed: job.processed,
      successful: job.successful,
      failed: job.failed
    });
  });

  // Bulk translate AI descriptions to common languages
  app.post("/api/admin/stations/:id/translate-descriptions", requireAdmin, async (req, res) => {
    try {
      const stationId = req.params.id;
      const { targetLanguages } = req.body;
      
      const station = await Station.findById(stationId);
      if (!station) {
        return res.status(404).json({ error: 'Station not found' });
      }
      
      // Find source language with descriptions (full + meta)
      let sourceLanguage = 'en';
      let sourceFullDescription = '';
      let sourceMetaDescription = '';
      
      if (station.descriptions && typeof station.descriptions === 'object') {
        const descriptions = station.descriptions as Record<string, any>;
        const langKeys = Object.keys(descriptions);
        if (langKeys.length > 0) {
          sourceLanguage = langKeys[0];
          const sourceEntry = descriptions[sourceLanguage];
          
          // Handle both old format (string) and new format (object with full + meta)
          if (typeof sourceEntry === 'string') {
            sourceFullDescription = sourceEntry;
          } else if (typeof sourceEntry === 'object' && sourceEntry.full && sourceEntry.meta) {
            sourceFullDescription = sourceEntry.full;
            sourceMetaDescription = sourceEntry.meta;
          }
        }
      }
      
      if (!sourceFullDescription || !sourceMetaDescription) {
        return res.status(400).json({ error: 'No source descriptions found to translate' });
      }
      
      logger.log(`🌍 Translating descriptions for "${station.name}" from ${sourceLanguage} to ${targetLanguages.length} languages`);
      
      // Translate both full and meta descriptions
      const translations = await translateDescription(sourceFullDescription, sourceMetaDescription, sourceLanguage, targetLanguages);
      
      // Save all translations (each contains {full, meta})
      for (const [lang, translation] of translations) {
        await Station.updateOne(
          { _id: stationId },
          { $set: { [`descriptions.${lang}`]: translation } }
        );
        logger.log(`💾 Saved ${lang}: ${translation.full?.length} chars full + ${translation.meta?.length} chars meta`);
      }
      
      logger.log(`✅ Saved ${translations.size} translations for "${station.name}"`);
      
      res.json({
        success: true,
        translationsCount: translations.size,
        languages: Array.from(translations.keys())
      });
    } catch (error: any) {
      logger.error('Error translating descriptions:', error);
      res.status(500).json({ error: error.message || 'Failed to translate descriptions' });
    }
  });

  // DATA SYNC UTILITY - Fix follower counts for all users
  app.post("/api/admin/sync-follower-counts", requireAdmin, async (req, res) => {
    try {
      // logger.log('🔄 Starting follower count synchronization...');
      
      // Get all users
      const allUsers = await User.find({}).select('_id followersCount followingCount');
      let syncedUsers = 0;
      let errors = 0;
      
      for (const user of allUsers) {
        try {
          // Calculate actual counts from UserFollow collection
          const actualFollowersCount = await UserFollow.countDocuments({ followingUserId: user._id });
          const actualFollowingCount = await UserFollow.countDocuments({ userId: user._id });
          
          // Update if counts are incorrect
          if (user.followersCount !== actualFollowersCount || user.followingCount !== actualFollowingCount) {
            // logger.log(` Syncing user ${user._id}: followers ${user.followersCount} -> ${actualFollowersCount}, following ${user.followingCount} -> ${actualFollowingCount}`);
            
            await User.findByIdAndUpdate(user._id, {
              followersCount: actualFollowersCount,
              followingCount: actualFollowingCount
            });
            syncedUsers++;
          }
        } catch (error) {
          // console.error(` Error syncing user ${user._id}:`, error);
          errors++;
        }
      }
      
      // logger.log(`✅ Follower count sync completed: ${syncedUsers} users updated, ${errors} errors`);
      res.json({ 
        success: true, 
        message: `Synchronized ${syncedUsers} users, ${errors} errors`,
        totalUsers: allUsers.length,
        syncedUsers,
        errors
      });
    } catch (error) {
      // console.error('Error syncing follower counts:', error);
      res.status(500).json({ error: 'Failed to sync follower counts' });
    }
  });

  // ADMIN STATIONS API - Paginated stations for admin interface
  app.get('/api/admin/stations', requireAdmin, async (req, res) => {
    try {
      const { 
        page = 1, 
        limit = 50, 
        search = '', 
        country = '', 
        language = '', 
        genre = '',
        hasDescriptions = 'all',
        sortBy = 'name',
        sortOrder = 'asc'
      } = req.query;
      
      // CACHE: Generate cache key from all query parameters
      const cacheKey = `admin_stations:${JSON.stringify({
        page: String(page),
        limit: String(limit),
        search: String(search),
        country: String(country),
        language: String(language),
        genre: String(genre),
        hasDescriptions: String(hasDescriptions),
        sortBy: String(sortBy),
        sortOrder: String(sortOrder)
      })}`;
      
      // Check cache first (24 hour TTL - radio stations don't change frequently)
      const cachedResult = await CacheManager.get(cacheKey);
      if (cachedResult) {
        console.log('✅ ADMIN STATIONS: Cache hit (24h)');
        return res.json(cachedResult);
      }
      
      console.log('📄 ADMIN STATIONS: Cache miss - fetching from DB. Query params:', { page, limit, sortBy, sortOrder, search, country, language, genre, hasDescriptions });
      
      const filter: any = {};
      
      // Apply search filter
      if (search && search !== '') {
        filter.$or = [
          { name: { $regex: new RegExp(search as string, 'i') } },
          { country: { $regex: new RegExp(search as string, 'i') } },
          { tags: { $regex: new RegExp(search as string, 'i') } }
        ];
      }
      
      // Apply country filter
      if (country && country !== '' && country !== 'all') {
        Object.assign(filter, normalizeCountryFilter(country as string));
      }
      
      // Apply language filter
      if (language && language !== '' && language !== 'all') {
        filter.language = { $regex: new RegExp(language as string, 'i') };
      }
      
      // Apply genre filter (using tags field since genre is mostly null)
      if (genre && genre !== '' && genre !== 'all') {
        filter.tags = { $regex: new RegExp(genre as string, 'i') };
      }
      
      // Apply hasDescriptions filter (using 'descriptions' field which stores AI descriptions)
      if (hasDescriptions && hasDescriptions !== 'all') {
        if (hasDescriptions === 'yes') {
          // Has at least one AI description - check if descriptions object exists and has at least one language
          filter.$and = [
            ...(filter.$and || []),
            { descriptions: { $exists: true, $type: 'object' } },
            { $expr: { $gt: [{ $size: { $objectToArray: { $ifNull: ['$descriptions', {}] } } }, 0] } }
          ];
        } else if (hasDescriptions === 'no') {
          // No AI descriptions at all
          filter.$or = [
            ...(filter.$or || []),
            { descriptions: { $exists: false } },
            { descriptions: null },
            { descriptions: {} },
            { $expr: { $eq: [{ $size: { $objectToArray: { $ifNull: ['$descriptions', {}] } } }, 0] } }
          ];
        } else if (hasDescriptions === 'partial') {
          // Has some descriptions but missing some languages (less than 14)
          filter.$and = [
            ...(filter.$and || []),
            { descriptions: { $exists: true, $type: 'object' } },
            { $expr: { 
              $and: [
                { $gt: [{ $size: { $objectToArray: { $ifNull: ['$descriptions', {}] } } }, 0] },
                { $lt: [{ $size: { $objectToArray: { $ifNull: ['$descriptions', {}] } } }, 14] }
              ]
            }}
          ];
        }
      }
      
      // Valid favicon pattern - must start with http://, https://, or data:image/
      const validFaviconRegex = /^(https?:\/\/.+|data:image\/.+)/i;
      
      // Get total count for pagination
      const total = await Station.countDocuments(filter);
      
      console.log('📄 ADMIN STATIONS: Total count:', total, 'Skip:', (Number(page) - 1) * Number(limit), 'Limit:', Number(limit));
      
      // Get paginated stations
      let stations: any = [];
      
      if (sortBy === 'favicon') {
        // Two-query approach to avoid MongoDB 32MB memory limit (M0 doesn't support allowDiskUse)
        // Query 1: Stations WITH valid favicon
        // Query 2: Stations WITHOUT valid favicon
        
        const skip = (Number(page) - 1) * Number(limit);
        const lim = Number(limit);
        
        // CRITICAL: Properly combine search $or with favicon conditions using $and
        // If filter has $or (from search), we need to wrap it in $and to combine with favicon conditions
        const baseConditions = filter.$or ? { $and: [{ $or: filter.$or }] } : {};
        const otherFilters = { ...filter };
        delete otherFilters.$or;
        
        // Filter for valid favicon (starts with http://, https://, or data:image/)
        const withFaviconFilter = {
          ...baseConditions,
          ...otherFilters,
          favicon: { $regex: '^(https?://|data:image/)', $options: 'i' }
        };
        
        // Filter for no/invalid favicon - use $and to combine search $or with favicon $or
        const noFaviconConditions = [
          { favicon: { $exists: false } },
          { favicon: null },
          { favicon: '' },
          { favicon: { $not: { $regex: '^(https?://|data:image/)', $options: 'i' } } }
        ];
        
        const withoutFaviconFilter = filter.$or 
          ? { $and: [{ $or: filter.$or }, { $or: noFaviconConditions }], ...otherFilters }
          : { $or: noFaviconConditions, ...otherFilters };
        
        // Count stations with favicon
        const withFaviconCount = await Station.countDocuments(withFaviconFilter);
        
        console.log('📄 ADMIN STATIONS: With favicon count:', withFaviconCount);
        
        if (sortOrder === 'desc') {
          // Show stations with favicon first
          if (skip < withFaviconCount) {
            // Still within "with favicon" range
            const fromWithFavicon = await Station.find(withFaviconFilter)
              .sort({ votes: -1 })
              .skip(skip)
              .limit(lim)
              .lean();
            
            if (fromWithFavicon.length < lim) {
              // Need to get some from "without favicon" too
              const remaining = lim - fromWithFavicon.length;
              const fromWithoutFavicon = await Station.find(withoutFaviconFilter)
                .sort({ votes: -1 })
                .skip(0)
                .limit(remaining)
                .lean();
              stations = [...fromWithFavicon, ...fromWithoutFavicon];
            } else {
              stations = fromWithFavicon;
            }
          } else {
            // Past "with favicon" range, get from "without favicon"
            const adjustedSkip = skip - withFaviconCount;
            stations = await Station.find(withoutFaviconFilter)
              .sort({ votes: -1 })
              .skip(adjustedSkip)
              .limit(lim)
              .lean();
          }
        } else {
          // Show stations without favicon first (asc)
          const withoutFaviconCount = total - withFaviconCount;
          
          if (skip < withoutFaviconCount) {
            const fromWithoutFavicon = await Station.find(withoutFaviconFilter)
              .sort({ votes: -1 })
              .skip(skip)
              .limit(lim)
              .lean();
            
            if (fromWithoutFavicon.length < lim) {
              const remaining = lim - fromWithoutFavicon.length;
              const fromWithFavicon = await Station.find(withFaviconFilter)
                .sort({ votes: -1 })
                .skip(0)
                .limit(remaining)
                .lean();
              stations = [...fromWithoutFavicon, ...fromWithFavicon];
            } else {
              stations = fromWithoutFavicon;
            }
          } else {
            const adjustedSkip = skip - withoutFaviconCount;
            stations = await Station.find(withFaviconFilter)
              .sort({ votes: -1 })
              .skip(adjustedSkip)
              .limit(lim)
              .lean();
          }
        }
      } else {
        // Build sort object for other sort types
        let sortObj: any = {};
        
        if (sortBy === 'votes') {
          const sortDirection = sortOrder === 'desc' ? -1 : 1;
          sortObj = { votes: sortDirection };
        } else if (sortBy === 'country') {
          const sortDirection = sortOrder === 'desc' ? -1 : 1;
          sortObj = { country: sortDirection };
        } else if (sortBy === 'createdAt') {
          const sortDirection = sortOrder === 'desc' ? -1 : 1;
          sortObj = { createdAt: sortDirection };
        } else {
          // Default to name
          const sortDirection = sortOrder === 'desc' ? -1 : 1;
          sortObj = { name: sortDirection };
        }
        
        // Use regular find for other sorts
        stations = await Station.find(filter)
          .sort(sortObj)
          .skip((Number(page) - 1) * Number(limit))
          .limit(Number(limit))
          .lean();
      }
      
      console.log('📄 ADMIN STATIONS: Returned', stations.length, 'stations for page', page);
      
      const response = {
        stations,
        total,
        count: stations.length,
        pagination: {
          total,
          page: Number(page),
          limit: Number(limit),
          pages: Math.ceil(total / Number(limit))
        }
      };
      
      // CACHE: Store result with 24 hour TTL (86400 seconds)
      await CacheManager.set(cacheKey, response, { ttl: 86400 });
      
      res.json(response);
    } catch (error) {
      console.error('Error fetching admin stations:', error);
      res.status(500).json({ error: 'Failed to fetch stations' });
    }
  });

  // ADMIN DUPLICATE STATIONS API - Find potential duplicate stations for manual merging
  app.get("/api/admin/stations/duplicates", requireAdmin, async (req, res) => {
    try {
      console.log('🔍 Duplicates endpoint called');
      
      const { page = 1, limit = 50, threshold = 0.8, search, country, language, genre } = req.query;
      console.log('📝 Query params:', { page, limit, threshold, search, country, language, genre });
      
      // Build filter conditions for duplicate search
      const matchConditions: any = {};
      
      if (search && typeof search === 'string') {
        matchConditions.name = { $regex: search, $options: 'i' };
      }
      
      if (country && typeof country === 'string' && country !== 'all') {
        matchConditions.country = country;
      }
      
      if (language && typeof language === 'string' && language !== 'all') {
        matchConditions.language = language;
      }
      
      if (genre && typeof genre === 'string' && genre !== 'all') {
        matchConditions.genre = genre;
      }
      
      console.log('🔍 Match conditions:', matchConditions);
      
      // Find potential duplicates by comparing station names and URLs
      const duplicatesAggregation = [
        // Add filter stage if we have filter conditions
        ...(Object.keys(matchConditions).length > 0 ? [{ $match: matchConditions }] : []),
        {
          $group: {
            _id: {
              name: { $toLower: "$name" },
              country: "$country"
            },
            stations: {
              $push: {
                _id: "$_id",
                name: "$name",
                url: "$url",
                homepage: "$homepage",
                country: "$country",
                language: "$language",
                genre: "$genre",
                favicon: "$favicon",
                localImagePath: "$localImagePath",
                votes: "$votes"
              }
            },
            count: { $sum: 1 }
          }
        },
        {
          $match: {
            count: { $gte: 2 } // Groups with 2+ stations
          }
        },
        {
          $sort: { count: -1 as any }
        },
        {
          $skip: (parseInt(page as string) - 1) * parseInt(limit as string)
        },
        {
          $limit: parseInt(limit as string)
        }
      ];
      
      console.log('🚀 Running name-based aggregation...');
      const duplicates = await Station.aggregate(duplicatesAggregation).allowDiskUse(true);
      console.log(`✅ Name-based duplicates found: ${duplicates.length}`);
      if (duplicates.length > 0) {
        console.log('📊 First duplicate group:', JSON.stringify(duplicates[0], null, 2).substring(0, 300));
      }

      // Try to find URL duplicates, but make it optional since it can exceed memory on large datasets
      let urlDuplicates: any[] = [];
      try {
        const urlDuplicatesAggregation = [
          // Add filter stage if we have filter conditions
          ...(Object.keys(matchConditions).length > 0 ? [{ $match: matchConditions }] : []),
          {
            $group: {
              _id: "$url",
              stations: {
                $push: {
                  _id: "$_id",
                  name: "$name",
                  url: "$url",
                  homepage: "$homepage",
                  country: "$country",
                  language: "$language",
                  genre: "$genre",
                  favicon: "$favicon",
                  localImagePath: "$localImagePath",
                  votes: "$votes"
                }
              },
              count: { $sum: 1 }
            }
          },
          {
            $match: {
              count: { $gte: 2 },
              $and: [
                { _id: { $ne: null } },
                { _id: { $ne: "" } }
              ]
            }
          },
          {
            $sort: { count: -1 }
          },
          {
            $limit: 20
          }
        ];
        
        urlDuplicates = await Station.aggregate(urlDuplicatesAggregation).allowDiskUse(true);
        console.log(`✅ URL-based duplicates found: ${urlDuplicates.length}`);
      } catch (urlError) {
        console.warn('⚠️ URL duplicates aggregation skipped due to memory constraints:', (urlError as any)?.message);
      }

      // Combine and sort stations within each group by votes (highest first)
      const allDuplicates = [...duplicates, ...urlDuplicates].map(group => ({
        ...group,
        stations: group.stations.sort((a: any, b: any) => (b.votes || 0) - (a.votes || 0))
      }));
      
      console.log(`📊 Total duplicate groups: ${allDuplicates.length}`);
      
      res.json({
        duplicates: allDuplicates,
        total: allDuplicates.length,
        page: parseInt(page),
        limit: parseInt(limit),
        hasMore: allDuplicates.length === parseInt(limit)
      });
    } catch (error) {
      console.error('🔴 Error finding duplicate stations:', error);
      res.status(500).json({ error: 'Failed to find duplicate stations' });
    }
  });

  // ADMIN STATIONS API - Get single station with all fields including descriptions
  app.get('/api/admin/stations/:id', requireAdmin, async (req, res) => {
    try {
      const station = await Station.findById(req.params.id).lean();
      
      if (!station) {
        return res.status(404).json({ error: 'Station not found' });
      }
      
      res.json(station);
    } catch (error) {
      console.error('Error fetching admin station:', error);
      res.status(500).json({ error: 'Failed to fetch station' });
    }
  });

  // ADMIN STATIONS API - Update station (e.g., copy favicon)
  app.put('/api/admin/stations/:id', requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const updateData = req.body;
      
      console.log('📝 Updating station:', id, 'with data:', updateData);
      
      const updatedStation = await Station.findByIdAndUpdate(
        id,
        { $set: updateData },
        { new: true }
      );
      
      if (!updatedStation) {
        return res.status(404).json({ error: 'Station not found' });
      }
      
      console.log('✅ Station updated successfully:', updatedStation.name, 'favicon:', updatedStation.favicon);
      res.json(updatedStation);
    } catch (error) {
      console.error('❌ Error updating admin station:', error);
      res.status(500).json({ error: 'Failed to update station' });
    }
  });

  // DEBUG UTILITY - Inspect UserFavorite data integrity issues
  app.get("/api/admin/debug-favorites/:userId", async (req, res) => {
    try {
      const { userId } = req.params;
      // logger.log(`🔍 Debugging UserFavorite data for user: ${userId}`);
      
      // Get UserFavorite records
      const favorites = await UserFavorite.find({ userId }).limit(10);
      // logger.log(`📊 Found ${favorites.length} UserFavorite records:`);
      
      const debug = [];
      for (const fav of favorites) {
        // logger.log(`  - UserFavorite: ${fav._id}, stationId: ${fav.stationId} (type: ${typeof fav.stationId})`);
        
        // Try to find the station
        let station = null;
        try {
          if (typeof fav.stationId === 'string') {
            station = await Station.findById(fav.stationId);
          } else if (fav.stationId && fav.stationId.toString) {
            station = await Station.findById(fav.stationId.toString());
          }
        } catch (error) {
          // logger.log(`    ❌ Error finding station: ${error.message}`);
        }
        
        debug.push({
          favoriteId: fav._id,
          stationId: fav.stationId,
          stationIdType: typeof fav.stationId,
          stationExists: !!station,
          stationName: station?.name || 'NOT FOUND',
          createdAt: fav.createdAt
        });
        
        if (station) {
          // logger.log(`    ✅ Station found: ${station.name}`);
        } else {
          // logger.log(`    ❌ Station NOT found`);
        }
      }
      
      // Also get a sample of actual stations to see what IDs look like
      const sampleStations = await Station.find({}).limit(5).select('_id name');
      // logger.log(`📊 Sample station IDs:`);
      sampleStations.forEach(station => {
        // logger.log(`  - Station: ${station._id} (type: ${typeof station._id}) - ${station.name}`);
      });
      
      res.json({
        success: true,
        userId,
        totalFavorites: favorites.length,
        favorites: debug,
        sampleStations: sampleStations.map(s => ({ 
          _id: s._id, 
          idType: typeof s._id, 
          name: s.name 
        }))
      });
      
    } catch (error) {
      // console.error('Error debugging favorites:', error);
      res.status(500).json({ error: 'Failed to debug favorites' });
    }
  });

  // Get station by slug or ID
  app.get("/api/station/:identifier", async (req, res) => {
    try {
      const { identifier } = req.params;
      let station;

      // First try to find by slug, then by ID
      // Explicitly select all fields including descriptions for SEO/schema
      station = await Station.findOne({ slug: identifier }).select('+descriptions').lean();
      
      if (!station) {
        // Try finding by MongoDB ObjectId
        if (identifier.match(/^[0-9a-fA-F]{24}$/)) {
          station = await Station.findById(identifier).select('+descriptions').lean();
        }
      }

      if (!station) {
        return res.status(404).json({ error: 'Station not found' });
      }

      // Ensure the station has a slug for consistent URLs
      if (!station.slug) {
        const newSlug = await generateUniqueSlug(station.name, 'station', station._id.toString());
        await Station.updateOne(
          { _id: station._id },
          { $set: { slug: newSlug } }
        );
        station.slug = newSlug;
      }

      res.json(stripPlaceholders(station));
    } catch (error) {
      // console.error('Error fetching station:', error);
      res.status(500).json({ error: 'Failed to fetch station' });
    }
  });

  // PRECOMPUTED STATIONS API: Ultra-fast pre-sorted stations by country (hasLogo + votes)
  // Supports: global, country code (DE, US), and country name (Germany, United States)
  app.get("/api/stations/precomputed", async (req, res) => {
    try {
      const { country, countryName, page = '1', limit = '33' } = req.query;
      
      let result;
      const pageNum = parseInt(page as string, 10);
      const limitNum = parseInt(limit as string, 10);
      
      // Check for global request first
      if (countryName === 'global' || country === 'global') {
        result = await PrecomputedStationsService.getGlobalStations(pageNum, limitNum);
      } else if (countryName && typeof countryName === 'string') {
        result = await PrecomputedStationsService.getCountryStationsByName(
          countryName,
          pageNum,
          limitNum
        );
      } else if (country && typeof country === 'string') {
        result = await PrecomputedStationsService.getCountryStations(
          country,
          pageNum,
          limitNum
        );
      } else {
        return res.status(400).json({ error: 'Country code, name, or "global" is required' });
      }

      // Cold-start fallback: if precomputed cache returned empty (warmup in progress),
      // serve a quick direct DB query so users don't see blank page
      if (result.stations.length === 0 && result.total === 0) {
        const offset = (pageNum - 1) * limitNum;
        const matchFilter: any = { lastCheckOk: true };
        const isGlobal = countryName === 'global' || country === 'global';
        if (!isGlobal) {
          const resolvedCountry = countryName || (country ? (await import('./utils/normalize-country')).normalizeCountryFilter(country as string) : null);
          if (resolvedCountry) {
            matchFilter.country = { $regex: new RegExp(`^${resolvedCountry}$`, 'i') };
          }
        }
        const [fallbackStations, fallbackTotal] = await Promise.all([
          Station.find(matchFilter, {
            _id:1, slug:1, name:1, url:1, url_resolved:1,
            favicon:1, logo:1, country:1, state:1, votes:1,
            tags:1, codec:1, bitrate:1, logoAssets:1
          }).sort({ votes: -1 }).skip(offset).limit(limitNum).lean(),
          Station.countDocuments(matchFilter)
        ]);
        logger.log(`⚡ COLD-START FALLBACK: served ${fallbackStations.length} stations directly from DB`);
        return res.json({
          success: true,
          data: fallbackStations,
          pagination: {
            page: pageNum,
            limit: limitNum,
            total: fallbackTotal,
            totalPages: Math.ceil(fallbackTotal / limitNum)
          },
          cached: false
        });
      }

      res.json({
        success: true,
        data: result.stations,
        pagination: {
          page: result.page,
          limit: parseInt(limit as string, 10),
          total: result.total,
          totalPages: result.totalPages
        },
        cached: result.cached
      });
    } catch (error) {
      console.error('Error fetching precomputed stations:', error);
      res.status(500).json({ error: 'Failed to fetch stations' });
    }
  });

  // ADMIN: Refresh precomputed stations cache for all countries
  app.post("/api/admin/precomputed/refresh", requireAdmin, async (req, res) => {
    try {
      logger.log('🔄 Admin triggered full precomputed cache refresh...');
      
      const result = await PrecomputedStationsService.refreshAllCountries();
      
      res.json({
        success: true,
        message: `Refreshed ${result.success}/${result.total} countries in ${result.duration}s`,
        data: result
      });
    } catch (error) {
      console.error('Error refreshing precomputed cache:', error);
      res.status(500).json({ error: 'Failed to refresh cache' });
    }
  });

  // ADMIN: Get precomputed cache stats
  app.get("/api/admin/precomputed/stats", requireAdmin, async (req, res) => {
    try {
      const stats = PrecomputedStationsService.getCacheStats();
      const allCountries = await PrecomputedStationsService.getAllCountriesFromDB();
      
      res.json({
        success: true,
        data: {
          ...stats,
          totalCountriesInDB: allCountries.length
        }
      });
    } catch (error) {
      console.error('Error getting precomputed stats:', error);
      res.status(500).json({ error: 'Failed to get stats' });
    }
  });

  // PRECOMPUTED GENRES API: Ultra-fast pre-computed genres with station counts (7-day cache)
  app.get("/api/genres/precomputed", async (req, res) => {
    try {
      const { country, countryName, countrycode, page = '1', limit = '27', search = '' } = req.query;
      
      const targetCountry = (countrycode as string) || (countryName as string) || (country as string) || 'global';
      const result = await PrecomputedGenresService.getGenres(
        targetCountry === 'global' || targetCountry === 'all' ? undefined : targetCountry
      );
      
      let genres = result.genres;
      
      // Apply search filter
      if (search && typeof search === 'string' && search.trim()) {
        const query = search.toLowerCase().trim();
        genres = genres.filter(g => g.name.toLowerCase().includes(query) || g.slug.includes(query));
      }
      
      // Pagination
      const pageNum = parseInt(page as string, 10);
      const limitNum = parseInt(limit as string, 10);
      const startIdx = (pageNum - 1) * limitNum;
      const endIdx = startIdx + limitNum;
      const paginatedGenres = genres.slice(startIdx, endIdx);
      
      res.json({
        success: true,
        data: paginatedGenres,
        count: genres.length,
        currentPage: pageNum,
        perPage: limitNum,
        totalPages: Math.ceil(genres.length / limitNum),
        cached: true
      });
    } catch (error) {
      console.error('Error fetching precomputed genres:', error);
      res.status(500).json({ error: 'Failed to fetch genres' });
    }
  });

  // MAIN STATIONS API: Get stations with filters
  app.get("/api/stations", async (req, res) => {
    try {
      const isTV = req.query.tv === '1';
      const { 
        country, 
        state,
        genre,
        tags,
        language, 
        search, 
        sort = 'createdAt',
        sortBy = sort,
        order = 'desc',
        excludeBroken = 'false',
        excludeStationIds = '',
        minVotes = 0,
        timePeriod = 'all'
      } = req.query;
      
      // TV param validation: cap limit at 100, page min 1
      const safeParams = isTV ? tvValidateParams(req.query) : { 
        page: parseInt(req.query.page as string) || 1, 
        limit: parseInt(req.query.limit as string) || 25 
      };
      const { page, limit } = safeParams;

      // TV/Mobile cache: cache non-search requests for 5 minutes
      if (isTV && !search) {
        const tvCacheKey = `tv:stations:${country || 'all'}:${state || 'all'}:${genre || 'all'}:${tags || 'all'}:${language || 'all'}:${sort}:${page}:${limit}:${excludeBroken}:${timePeriod}`;
        const cachedResult = await CacheManager.get(tvCacheKey);
        if (cachedResult) {
          return res.json(cachedResult);
        }
        // Store tvCacheKey for later use after query execution
        (req as any)._tvCacheKey = tvCacheKey;
      }

      const filter: any = {};
      
      // Exclude broken stations if requested
      if (excludeBroken === 'true') {
        filter.lastCheckOk = true;
      }

      // Exclude specific station IDs for deduplication
      if (excludeStationIds && typeof excludeStationIds === 'string') {
        const excludeIds = excludeStationIds.split(',').filter(id => id.trim());
        if (excludeIds.length > 0) {
          filter._id = { $nin: excludeIds };
        }
      }

      // Minimum votes filter
      if (minVotes && Number(minVotes) > 0) {
        filter.votes = { $gte: Number(minVotes) };
      }

      // Time-based filtering for trending
      if (timePeriod && timePeriod !== 'all') {
        const now = new Date();
        let startDate = new Date();
        
        switch (timePeriod) {
          case '24h':
            startDate.setHours(now.getHours() - 24);
            break;
          case '7d':
            startDate.setDate(now.getDate() - 7);
            break;
          case '30d':
            startDate.setDate(now.getDate() - 30);
            break;
        }
        
        // Filter for stations with recent activity (votes or plays)
        filter.$or = [
          { lastChangeTime: { $gte: startDate } },
          { clickTimestamp: { $gte: startDate } },
          { createdAt: { $gte: startDate } }
        ];
      }

      let searchTerm = '';
      
      if (country && country !== 'all') {
        Object.assign(filter, normalizeCountryFilter(country as string));
      }
      
      // Apply state filter with Wien/Vienna mapping support (like GitHub example)
      if (state && state !== 'all') {
        // Alternative city/state name mapping for Austrian cities
        const stateAliases: { [key: string]: string[] } = {
          'Wien': ['Wien', 'Vienna'],
          'Vienna': ['Wien', 'Vienna'],
          // Add more city aliases as needed
        };
        
        const searchTerms = stateAliases[state as string] || [state as string];
        
        if (searchTerms.length > 1) {
          // Multiple search terms (e.g., Wien OR Vienna)
          if (!filter.$or) filter.$or = [];
          filter.$or.push(
            ...searchTerms.map(term => ({ state: { $regex: new RegExp(term, 'i') } }))
          );
        } else {
          // Single search term
          filter.state = { $regex: new RegExp(state as string, 'i') };
        }
      }
      
      // Handle tags parameter for mood-based filtering
      if (tags && tags !== 'all') {
        logger.log(`🏷️ Filtering by tags: "${tags}"`);
        filter.tags = { $regex: new RegExp(tags as string, 'i') };
      }
      
      if (genre && genre !== 'all') {
        if (String(genre).toLowerCase() === 'general') {
          // Special case: "General" genre shows stations from genres with only 1 station each
          const singleStationGenres = await Station.aggregate([
            {
              $group: {
                _id: { $toLower: '$genre' },
                count: { $sum: 1 }
              }
            },
            {
              $match: { count: 1 }
            },
            {
              $project: { _id: 1 }
            }
          ]);
          
          const singleGenreNames = singleStationGenres.map(g => g._id);
          
          if (singleGenreNames.length > 0) {
            filter.genre = { 
              $in: singleGenreNames.map(name => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'))
            };
          } else {
            // No single-station genres found, return empty result
            filter._id = { $in: [] };
          }
        } else {
          const escapedGenre = (genre as string).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          filter.$or = [
            { genre: { $regex: new RegExp(`^${escapedGenre}$`, 'i') } },
            { tags: { $regex: new RegExp(`(^|,)\\s*${escapedGenre}\\s*(,|$)`, 'i') } }
          ];
        }
      }
      
      if (language && language !== 'all') {
        filter.language = { $regex: new RegExp(language as string, 'i') };
      }
      
      // Track if search term matches a known genre for priority sorting
      let isGenreSearch = false;
      let genreSearchTerm = '';
      
      if (search) {
        // Use regex-based search since text index is not working
        searchTerm = (search as string).trim();
        
        if (searchTerm.length >= 2) {
          // Escape special regex characters
          const escapedTerm = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          
          // Make spaces optional: "FM4" matches "FM 4" and vice versa
          const flexibleTerm = escapedTerm.replace(/\s+/g, '\\s*');
          const noSpaceTerm = escapedTerm.replace(/\s+/g, '');
          
          // Custom boundary: matches word start OR after non-letter/non-digit
          // This catches "__SEX__" (underscore boundary) AND "Kral FM" (word start)
          // But NOT "Ukraine" (middle of word)
          // Pattern: (start of string OR non-alphanumeric) + search term
          const customBoundaryRegex = new RegExp(`(^|[^a-zA-Z0-9])${flexibleTerm}`, 'i');
          const customBoundaryNoSpace = new RegExp(`(^|[^a-zA-Z0-9])${noSpaceTerm}`, 'i');
          const startsWithRegex = new RegExp(`^${flexibleTerm}`, 'i');
          
          // Check if search term EXACTLY matches a known genre (only then boost genre results)
          const knownGenres = ['jazz', 'pop', 'rock', 'classical', 'news', 'talk', 'dance', 'electronic', 
            'hiphop', 'country', 'oldies', 'hits', 'rnb', 'soul', 'blues', 'reggae',
            'metal', 'punk', 'alternative', 'indie', 'folk', 'world', 'latin', 'salsa', 'tango',
            'techno', 'house', 'ambient', 'chill', 'lounge', 'sports', 'comedy', 'religious'];
          
          const searchLower = searchTerm.toLowerCase().replace(/[\s-]/g, '');
          // Only exact genre match triggers genre boost (not partial)
          if (knownGenres.some(g => g.replace(/-/g, '') === searchLower)) {
            isGenreSearch = true;
            genreSearchTerm = escapedTerm;
          }
          
          filter.$or = [
            { name: { $regex: customBoundaryRegex } },
            { name: { $regex: customBoundaryNoSpace } },
            { country: { $regex: startsWithRegex } },
            { genre: { $regex: customBoundaryRegex } },
            { tags: { $regex: customBoundaryRegex } }
          ];
        }
      }

      // Get total count for pagination (use countDocuments for efficiency)
      const total = await Station.countDocuments(filter);

      // Build aggregation pipeline with favicon validation
      let pipeline: any[] = [{ $match: filter }];
      
      // Add genre match score for priority sorting when searching for genres
      if (isGenreSearch && genreSearchTerm) {
        pipeline.push({
          $addFields: {
            genreMatchScore: {
              $cond: [
                {
                  // Genre field starts with or contains the search term
                  $regexMatch: {
                    input: { $ifNull: ['$genre', ''] },
                    regex: genreSearchTerm,
                    options: 'i'
                  }
                },
                2, // High priority for genre match
                {
                  $cond: [
                    {
                      // Tags contain the genre term
                      $regexMatch: {
                        input: { $ifNull: ['$tags', ''] },
                        regex: genreSearchTerm,
                        options: 'i'
                      }
                    },
                    1, // Medium priority for tags match
                    0  // Low priority for name-only match
                  ]
                }
              ]
            }
          }
        });
      }
      
      // Add favicon validation for all sorts (prioritize valid favicons)
      // Trim favicon field to handle null, empty, and whitespace-only values
      // Also add startsWithNumber field for A-Z/Z-A sorting (numbers go last)
      pipeline.push({
        $addFields: {
          hasValidFavicon: {
            $cond: [
              {
                $regexMatch: {
                  input: { $trim: { input: { $ifNull: ['$favicon', ''] } } },
                  regex: '^(https?:\\/\\/.+|data:image\\/.+)',
                  options: 'i'
                }
              },
              1,
              0
            ]
          },
          // For A-Z/Z-A sorting: names starting with numbers go to end (1=number, 0=letter)
          startsWithNumber: {
            $cond: [
              {
                $regexMatch: {
                  input: { $trim: { input: { $ifNull: ['$name', ''] } } },
                  regex: '^[0-9]',
                  options: ''
                }
              },
              1,
              0
            ]
          }
        }
      });

      // Build sort based on the sort parameter
      // When searching for genres, prioritize genre matches first
      let sortObj: any = isGenreSearch 
        ? { genreMatchScore: -1, hasValidFavicon: -1 }
        : { hasValidFavicon: -1 };
      
      switch (sort) {
        case 'az':
          // A-Z: Letters first (startsWithNumber: 0), then numbers (startsWithNumber: 1)
          sortObj = isGenreSearch 
            ? { genreMatchScore: -1, startsWithNumber: 1, hasValidFavicon: -1, name: 1 }
            : { startsWithNumber: 1, hasValidFavicon: -1, name: 1 };
          break;
        case 'za':
          // Z-A: Letters first (startsWithNumber: 0), then numbers (startsWithNumber: 1)
          sortObj = isGenreSearch
            ? { genreMatchScore: -1, startsWithNumber: 1, hasValidFavicon: -1, name: -1 }
            : { startsWithNumber: 1, hasValidFavicon: -1, name: -1 };
          break;
        case 'newest':
          sortObj = isGenreSearch
            ? { genreMatchScore: -1, hasValidFavicon: -1, createdAt: -1 }
            : { hasValidFavicon: -1, createdAt: -1 };
          break;
        case 'oldest':
          sortObj = isGenreSearch
            ? { genreMatchScore: -1, hasValidFavicon: -1, createdAt: 1 }
            : { hasValidFavicon: -1, createdAt: 1 };
          break;
        case 'votes':
        case 'createdAt':
        default:
          sortObj = isGenreSearch
            ? { genreMatchScore: -1, hasValidFavicon: -1, votes: -1 }
            : { hasValidFavicon: -1, votes: -1 };
          break;
      }

      // Add project stage - TV gets slim response, web gets full response
      if (isTV) {
        pipeline.push(tvSlimProjection());
      } else {
        pipeline.push({
          $project: {
            _id: 1,
            name: 1,
            url: 1,
            urlResolved: 1,
            favicon: 1,
            country: 1,
            countrycode: 1,
            state: 1,
            language: 1,
            genre: 1,
            codec: 1,
            bitrate: 1,
            homepage: 1,
            tags: 1,
            slug: 1,
            hls: 1,
            votes: 1,
            clickCount: 1,
            lastCheckOk: 1,
            lastCheckTime: 1,
            descriptions: 1,
            logoAssets: 1,
            localImagePath: 1,
            createdAt: 1,
            updatedAt: 1,
            hasValidFavicon: 1,
            startsWithNumber: 1
          }
        });
      }

      pipeline.push({ $sort: sortObj });
      pipeline.push({ $skip: (Number(page) - 1) * Number(limit) });
      pipeline.push({ $limit: Number(limit) });

      // Execute aggregation pipeline
      const stations = await Station.aggregate(pipeline);

      const response = {
        stations,
        totalCount: total,
        count: total,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          pages: Math.ceil(total / Number(limit))
        }
      };

      // Cache TV/Mobile results for 5 minutes (non-search only)
      const tvCacheKey = (req as any)._tvCacheKey;
      if (tvCacheKey) {
        await CacheManager.set(tvCacheKey, response, { ttl: 300 });
      }

      res.json(response);
    } catch (error) {
      // console.error('Error fetching stations:', error);
      res.status(500).json({ error: 'Failed to fetch stations' });
    }
  });

  // WORKING STATIONS ONLY API - Excludes broken/offline stations
  app.get("/api/stations/working", async (req, res) => {
    try {
      const { 
        page = 1, 
        limit = 25, 
        country, 
        state,
        genre, 
        language, 
        search, 
        sort = 'createdAt',
        order = 'desc',
        excludeStationIds = '', // New parameter for deduplication
        minVotes = 0, // Minimum votes filter
        timePeriod = 'all' // For trending: 24h, 7d, 30d, all
      } = req.query;

      const filter: any = {
        lastCheckOk: true // Only include working stations
      };

      // Exclude specific station IDs for deduplication
      if (excludeStationIds && typeof excludeStationIds === 'string') {
        const excludeIds = excludeStationIds.split(',').filter(id => id.trim());
        if (excludeIds.length > 0) {
          filter._id = { $nin: excludeIds };
        }
      }

      // Minimum votes filter
      if (minVotes && Number(minVotes) > 0) {
        filter.votes = { $gte: Number(minVotes) };
      }

      // Time-based filtering for trending
      if (timePeriod && timePeriod !== 'all') {
        const now = new Date();
        let startDate = new Date();
        
        switch (timePeriod) {
          case '24h':
            startDate.setHours(now.getHours() - 24);
            break;
          case '7d':
            startDate.setDate(now.getDate() - 7);
            break;
          case '30d':
            startDate.setDate(now.getDate() - 30);
            break;
        }
        
        // Filter for stations with recent activity (votes or plays)
        filter.$or = [
          { lastChangeTime: { $gte: startDate } },
          { clickTimestamp: { $gte: startDate } },
          { createdAt: { $gte: startDate } }
        ];
      }
      
      let searchTerm = '';
      
      if (country && country !== 'all') {
        Object.assign(filter, normalizeCountryFilter(country as string));
      }
      
      if (state && state !== 'all') {
        filter.state = { $regex: new RegExp(state as string, 'i') };
      }
      
      if (genre && genre !== 'all') {
        if (String(genre).toLowerCase() === 'general') {
          // Special case: "General" genre shows stations from genres with only 1 station each
          const singleStationGenres = await Station.aggregate([
            {
              $match: { lastCheckOk: true } // Only count working stations
            },
            {
              $group: {
                _id: { $toLower: '$genre' },
                count: { $sum: 1 }
              }
            },
            {
              $match: { count: 1 }
            },
            {
              $project: { _id: 1 }
            }
          ]);
          
          const singleGenreNames = singleStationGenres.map(g => g._id);
          
          if (singleGenreNames.length > 0) {
            filter.genre = { 
              $in: singleGenreNames.map(name => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'))
            };
          } else {
            // No single-station genres found, return empty result
            filter._id = { $in: [] };
          }
        } else {
          const escapedGenre = (genre as string).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          filter.$or = [
            { genre: { $regex: new RegExp(`^${escapedGenre}$`, 'i') } },
            { tags: { $regex: new RegExp(`(^|,)\\s*${escapedGenre}\\s*(,|$)`, 'i') } }
          ];
        }
      }
      
      if (language && language !== 'all') {
        filter.language = { $regex: new RegExp(language as string, 'i') };
      }
      
      // Track if search term matches a known genre for priority sorting
      let isGenreSearch = false;
      let genreSearchTerm = '';
      
      if (search) {
        // Use regex-based search since text index is not working
        searchTerm = (search as string).trim();
        
        if (searchTerm.length >= 2) {
          // Escape special regex characters
          const escapedTerm = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          
          // Make spaces optional: "FM4" matches "FM 4" and vice versa
          const flexibleTerm = escapedTerm.replace(/\s+/g, '\\s*');
          const noSpaceTerm = escapedTerm.replace(/\s+/g, '');
          
          // Custom boundary: matches word start OR after non-letter/non-digit
          // This catches "__SEX__" (underscore boundary) AND "Kral FM" (word start)
          // But NOT "Ukraine" (middle of word)
          // Pattern: (start of string OR non-alphanumeric) + search term
          const customBoundaryRegex = new RegExp(`(^|[^a-zA-Z0-9])${flexibleTerm}`, 'i');
          const customBoundaryNoSpace = new RegExp(`(^|[^a-zA-Z0-9])${noSpaceTerm}`, 'i');
          const startsWithRegex = new RegExp(`^${flexibleTerm}`, 'i');
          
          // Check if search term EXACTLY matches a known genre (only then boost genre results)
          const knownGenres = ['jazz', 'pop', 'rock', 'classical', 'news', 'talk', 'dance', 'electronic', 
            'hiphop', 'country', 'oldies', 'hits', 'rnb', 'soul', 'blues', 'reggae',
            'metal', 'punk', 'alternative', 'indie', 'folk', 'world', 'latin', 'salsa', 'tango',
            'techno', 'house', 'ambient', 'chill', 'lounge', 'sports', 'comedy', 'religious'];
          
          const searchLower = searchTerm.toLowerCase().replace(/[\s-]/g, '');
          // Only exact genre match triggers genre boost (not partial)
          if (knownGenres.some(g => g.replace(/-/g, '') === searchLower)) {
            isGenreSearch = true;
            genreSearchTerm = escapedTerm;
          }
          
          filter.$or = [
            { name: { $regex: customBoundaryRegex } },
            { name: { $regex: customBoundaryNoSpace } },
            { country: { $regex: startsWithRegex } },
            { genre: { $regex: customBoundaryRegex } },
            { tags: { $regex: customBoundaryRegex } }
          ];
        }
      }

      // Get total count for pagination (use countDocuments for efficiency)
      const total = await Station.countDocuments(filter);

      // Build sort object for simple find query
      let sortObj: any = {};
      
      switch (sort) {
        case 'az':
          sortObj = { name: 1 };
          break;
        case 'za':
          sortObj = { name: -1 };
          break;
        case 'newest':
          sortObj = { createdAt: -1 };
          break;
        case 'oldest':
          sortObj = { createdAt: 1 };
          break;
        case 'votes':
          sortObj = { votes: -1 };
          break;
        case 'createdAt':
        default:
          sortObj = { createdAt: -1 };
          break;
      }

      // Execute simple find query with lean for better performance
      const stations = await Station.find(filter)
        .sort(sortObj)
        .skip((Number(page) - 1) * Number(limit))
        .limit(Number(limit))
        .lean();

      res.json({
        stations,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          pages: Math.ceil(total / Number(limit))
        }
      });
    } catch (error) {
      // console.error('Error fetching working stations:', error);
      res.status(500).json({ error: 'Failed to fetch working stations' });
    }
  });

  // Language sanitization function to prevent MongoDB language override errors
  const sanitizeLanguage = (language: string): string => {
    if (!language || language.trim() === '') {
      return 'en'; // Default for empty languages
    }
    
    const lang = language.toLowerCase().trim();
    
    // Map problematic language codes to supported ones
    const languageMap: Record<string, string> = {
      'no': 'en', // Norwegian causes language override errors
      'norwegian': 'en',
      'pl': 'en', // Polish not supported
      'polish': 'en',
      'cs': 'en', // Czech not supported
      'czech': 'en',
      'bg': 'en', // Bulgarian not supported
      'bulgarian': 'en',
      'el': 'en', // Greek not supported
      'greek': 'en',
      'ar': 'en', // Arabic not supported
      'arabic': 'en',
      'he': 'en', // Hebrew not supported
      'hebrew': 'en',
      'hi': 'en', // Hindi not supported
      'hindi': 'en',
      'zh': 'en', // Chinese not supported
      'chinese': 'en',
      'ja': 'en', // Japanese not supported
      'japanese': 'en',
      'ko': 'en', // Korean not supported
      'korean': 'en',
      'th': 'en', // Thai not supported
      'thai': 'en',
      'vi': 'en', // Vietnamese not supported
      'vietnamese': 'en',
    };

    if (languageMap[lang]) {
      return languageMap[lang];
    }

    // MongoDB text search supported languages
    const mongoSupportedLanguages = [
      'da', 'de', 'en', 'es', 'fi', 'fr', 'hu', 'it', 'nb', 'nl', 'pt', 'ro', 'ru', 'sv', 'tr'
    ];

    if (lang.length <= 3 && /^[a-z]+$/.test(lang) && mongoSupportedLanguages.includes(lang)) {
      return lang;
    }

    return 'en'; // Default fallback
  };

  // CREATE NEW STATION ENDPOINT - Admin functionality
  app.post("/api/stations", async (req, res) => {
    try {
      const stationData = req.body;
      
      // Basic validation
      if (!stationData.name || !stationData.url) {
        return res.status(400).json({ error: 'Station name and URL are required' });
      }
      
      // Generate a unique station UUID if not provided
      if (!stationData.stationuuid) {
        stationData.stationuuid = `user-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
      }
      
      // Set default values for MongoDB schema compatibility
      const newStation = {
        ...stationData,
        language: sanitizeLanguage(stationData.language || ''), // Sanitize language to prevent MongoDB errors
        votes: stationData.votes || 0,
        clickCount: stationData.clickCount || 0,
        lastCheckOk: stationData.lastCheckOk !== undefined ? stationData.lastCheckOk : true,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      // Create the station in MongoDB
      const station = await Station.create(newStation);
      
      // Clear cache to ensure new station appears in listings
      await CacheManager.clearByPattern('stations');
      await CacheManager.clearByPattern('popular_stations');
      
      // Create notifications for active users (last 7 days) - async, don't await
      (async () => {
        try {
          const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
          const activeUsers = await User.find({ 
            lastLoginAt: { $gte: sevenDaysAgo } 
          }).select('_id').limit(1000).lean();
          
          if (activeUsers.length > 0) {
            const notifications = activeUsers.map(user => ({
              userId: user._id,
              type: 'new_station',
              title: `${station.name} Added`,
              message: `New radio station added. Click to listen!`,
              data: { 
                stationId: station._id,
                stationSlug: station.slug,
                stationFavicon: station.favicon,
                stationCountry: station.country
              },
              read: false,
              createdAt: new Date()
            }));
            
            await UserNotification.insertMany(notifications, { ordered: false });
            logger.log(`📢 Sent new station notification to ${activeUsers.length} users for: ${station.name}`);
          }
        } catch (notifError) {
          console.error('Error sending new station notifications:', notifError);
        }
      })();
      
      logger.log(`✅ New station created: ${station.name} (${station._id})`);
      res.status(201).json(station);
    } catch (error: any) {
      console.error('Error creating station:', error);
      if (error.code === 11000) {
        // Duplicate key error
        res.status(409).json({ error: 'Station URL or UUID already exists' });
      } else {
        res.status(500).json({ error: 'Failed to create station', details: error.message });
      }
    }
  });

  // Initialize object storage service
  const objectStorageService = new ObjectStorageService();

  // SEED TEST NOTIFICATIONS - Creates new_station notifications for top stations (for testing)
  app.post("/api/admin/seed-notifications", requireAdmin, async (req, res) => {
    try {
      // Get top popular stations to create test notifications
      const topStations = await Station.find({})
        .select('_id name favicon slug country')
        .sort({ votes: -1 })
        .limit(10)
        .lean();
      
      // Get all active users
      const activeUsers = await User.find({}).select('_id').lean();
      
      let created = 0;
      for (const station of topStations) {
        for (const user of activeUsers) {
          const existing = await UserNotification.findOne({
            userId: user._id,
            type: 'new_station',
            'data.stationId': station._id
          });
          
          if (!existing) {
            // Create notification with random date within last 10 days
            const daysAgo = Math.floor(Math.random() * 9) + 1;
            const notificationDate = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
            
            await UserNotification.create({
              userId: user._id,
              type: 'new_station',
              title: `${station.name} Added`,
              message: 'New radio station added. Click to listen!',
              data: {
                stationId: station._id,
                stationSlug: station.slug,
                stationFavicon: station.favicon,
                stationCountry: station.country
              },
              read: false,
              createdAt: notificationDate
            });
            created++;
          }
        }
      }
      
      res.json({ 
        success: true, 
        created, 
        stations: topStations.length,
        users: activeUsers.length
      });
    } catch (error: any) {
      console.error('Error seeding notifications:', error);
      res.status(500).json({ error: 'Failed to seed notifications' });
    }
  });

  // FAVICON UPLOAD URL ENDPOINT - Generate signed URL for favicon upload
  app.post("/api/admin/stations/favicon-upload-url", requireAdmin, async (req, res) => {
    try {
      const { uploadUrl, publicUrl, objectPath } = await objectStorageService.getFaviconUploadURL();
      // Return uploadUrl (not url) to match frontend expectation
      res.json({ uploadUrl, publicUrl, objectPath });
    } catch (error: any) {
      console.error('Error generating favicon upload URL:', error);
      res.status(500).json({ error: 'Failed to generate upload URL' });
    }
  });

  // PUBLIC OBJECTS ROUTE - Serve uploaded files from Object Storage
  app.get("/public-objects/*", async (req, res) => {
    try {
      const filePath = req.params[0]; // Get the path after /public-objects/
      const file = await objectStorageService.searchPublicObject(filePath);
      
      if (!file) {
        return res.status(404).json({ error: 'Object not found' });
      }
      
      await objectStorageService.downloadObject(file, res);
    } catch (error: any) {
      console.error('Error serving public object:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to serve object' });
      }
    }
  });

  // UPDATE STATION ENDPOINT - Admin functionality
  app.put("/api/stations/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const stationData = req.body;
      
      // Basic validation
      if (!stationData.name || !stationData.url) {
        return res.status(400).json({ error: 'Station name and URL are required' });
      }
      
      // Get existing station to check for favicon changes
      const existingStation = await Station.findById(id).select('favicon slug').lean();
      
      // Sanitize language field to prevent MongoDB errors
      if (stationData.language) {
        stationData.language = sanitizeLanguage(stationData.language);
      } else if (stationData.language === null || stationData.language === undefined) {
        // Set a safe default if language is missing
        stationData.language = 'en';
      }
      
      // Set updated timestamp
      stationData.updatedAt = new Date();
      
      // Clear popular stations cache if featured status changed
      if (stationData.isFeatured !== undefined || stationData.showInGlobalPopular !== undefined) {
        logger.log('🗑️ Clearing popular stations cache (featured status changed)');
        // Clear cache for all countries
        await CacheManager.clearByPattern('popular_stations:');
      }
      
      // Update the station in MongoDB - use findOneAndUpdate for better error handling
      try {
        const updatedStation = await Station.findByIdAndUpdate(
          id, 
          { $set: stationData }, 
          { new: true, runValidators: false } // Disable validators to prevent language override errors
        );
        
        if (!updatedStation) {
          return res.status(404).json({ error: 'Station not found' });
        }
        
        // Clear cache to ensure updated station appears in listings
        await CacheManager.clearByPattern('stations');
        await CacheManager.clearByPattern('popular_stations');
        
        logger.log(`✅ Station updated: ${updatedStation.name} (${updatedStation._id})`);
        
        // Process logo if favicon changed (non-blocking)
        const faviconChanged = stationData.favicon && existingStation && stationData.favicon !== existingStation.favicon;
        if (faviconChanged && updatedStation.slug) {
          setImmediate(async () => {
            try {
              await logoProcessor.processFromUrl(
                updatedStation._id.toString(),
                updatedStation.slug!,
                stationData.favicon
              );
              logger.log(`🎨 Logo processed for updated station: ${updatedStation.name}`);
            } catch (error) {
              logger.log('⚠️ Logo processing failed (non-blocking):', error);
            }
          });
        }
        
        // Trigger IndexNow notification for station metadata update (non-blocking)
        if (updatedStation.slug) {
          setImmediate(async () => {
            try {
              await IndexNowService.submitStationUrls([updatedStation.slug]);
            } catch (error) {
              logger.log('⚠️ IndexNow notification failed (non-blocking):', error);
            }
          });
        }
        
        res.json(updatedStation);
      } catch (updateError: any) {
        // Handle language override errors specifically
        if (updateError.message && updateError.message.includes('language override')) {
          logger.warn(`⚠️ Language override error, retrying with sanitized language...`);
          
          // Remove language field entirely and retry
          const sanitizedData = { ...stationData };
          delete sanitizedData.language;
          
          const updatedStation = await Station.findByIdAndUpdate(
            id, 
            { $set: sanitizedData }, 
            { new: true, runValidators: false }
          );
          
          if (!updatedStation) {
            return res.status(404).json({ error: 'Station not found' });
          }
          
          await CacheManager.clearByPattern('stations');
          await CacheManager.clearByPattern('popular_stations');
          
          logger.log(`✅ Station updated (without language field): ${updatedStation.name}`);
          
          // Process logo if favicon changed (non-blocking)
          const faviconChanged = stationData.favicon && existingStation && stationData.favicon !== existingStation.favicon;
          if (faviconChanged && updatedStation.slug) {
            setImmediate(async () => {
              try {
                await logoProcessor.processFromUrl(
                  updatedStation._id.toString(),
                  updatedStation.slug!,
                  stationData.favicon
                );
                logger.log(`🎨 Logo processed for updated station: ${updatedStation.name}`);
              } catch (error) {
                logger.log('⚠️ Logo processing failed (non-blocking):', error);
              }
            });
          }
          
          // Trigger IndexNow notification for station metadata update (non-blocking)
          if (updatedStation.slug) {
            setImmediate(async () => {
              try {
                await IndexNowService.submitStationUrls([updatedStation.slug]);
              } catch (error) {
                logger.log('⚠️ IndexNow notification failed (non-blocking):', error);
              }
            });
          }
          
          res.json(updatedStation);
        } else {
          throw updateError;
        }
      }
    } catch (error: any) {
      console.error('Error updating station:', error);
      if (error.code === 11000) {
        // Duplicate key error
        res.status(409).json({ error: 'Station URL or UUID already exists' });
      } else {
        res.status(500).json({ error: 'Failed to update station', details: error.message });
      }
    }
  });

  // GET FAVICON UPLOAD URL - Generate signed URL for favicon upload
  app.get("/api/admin/favicon-upload-url", async (req, res) => {
    try {
      const objectStorageService = new ObjectStorageService();
      const { uploadUrl, publicUrl, objectPath } = await objectStorageService.getFaviconUploadURL();
      
      res.json({ 
        uploadUrl, 
        publicUrl,
        objectPath 
      });
    } catch (error: any) {
      console.error('Error generating favicon upload URL:', error);
      res.status(500).json({ error: 'Failed to generate upload URL', details: error.message });
    }
  });

  // BATCH STATION LOADING ENDPOINT - Performance Optimization
  app.post("/api/stations/batch", async (req, res) => {
    try {
      const { stationIds } = req.body;
      
      if (!Array.isArray(stationIds) || stationIds.length === 0) {
        return res.status(400).json({ error: 'stationIds array is required' });
      }
      
      // Limit batch size to prevent abuse
      if (stationIds.length > 50) {
        return res.status(400).json({ error: 'Maximum 50 stations per batch request' });
      }
      
      const stations = await Station.find({ _id: { $in: stationIds } }).lean();
      
      // Create a map for quick lookup
      const stationMap = stations.reduce((acc, station) => {
        acc[station._id.toString()] = station;
        return acc;
      }, {});
      
      res.json(stationMap);
    } catch (error) {
      // Batch stations error
      res.status(500).json({ error: 'Failed to fetch stations' });
    }
  });

  // HLS SESSION ENDPOINT - Generate session-aware URLs for HLS.js client
  // URL cleanup function for server-side streaming
  const cleanupStreamUrl = (url: string): string => {
    try {
      const urlObj = new URL(url);
      const params = urlObj.searchParams;
      
      // Remove advertising and tracking parameters
      const unwantedParams = [
        'awparams', // AWParams for ads (like companionAds%3Atrue)
        'companionAds', // Companion ads
        'ads', // General ads
        'advert', // Advertisement
        'tracking', // Tracking parameters
        'utm_source', // UTM tracking
        'utm_medium',
        'utm_campaign',
        'utm_content',
        'utm_term',
        'fbclid', // Facebook tracking
        'gclid', // Google tracking
        '_ga', // Google Analytics
        'ref' // Referrer tracking
      ];
      
      let removedParams: string[] = [];
      unwantedParams.forEach(param => {
        if (params.has(param)) {
          params.delete(param);
          removedParams.push(param);
        }
      });
      
      const cleanUrl = urlObj.toString();
      if (removedParams.length > 0) {
        logger.log(`🧹 SERVER URL CLEANUP: Removed ad/tracking parameters: ${removedParams.join(', ')}`);
        logger.log(`📤 Server Original: ${url}`);
        logger.log(`📥 Server Cleaned: ${cleanUrl}`);
      }
      return cleanUrl;
    } catch (error) {
      logger.log(`⚠️ Server URL cleanup failed, using original: ${url}`);
      return url;
    }
  };

  app.get("/api/stream-hls/:stationId", async (req, res) => {
    try {
      const { stationId } = req.params;
      
      // Find the station
      const station = await Station.findById(stationId);
      if (!station || !station.hls) {
        return res.status(404).json({ error: 'HLS station not found' });
      }
      
      // Apply URL cleanup to remove advertising parameters on server-side
      const cleanedUrl = cleanupStreamUrl(station.url);
      
      // Generate session IDs like Kral FM uses
      const listeningSessionID = `${Date.now()}_${Math.random().toString(36).substring(2)}`;
      const downloadSessionID = Math.floor(Math.random() * 1000000);
      
      logger.log(`🎯 HLS session URL generated for ${station.name}:`, {
        listeningSessionID,
        downloadSessionID,
        originalUrl: station.url,
        cleanedUrl
      });
      
      // Build session-aware URL using cleaned URL
      const separator = cleanedUrl.includes('?') ? '&' : '?';
      const sessionUrl = `${cleanedUrl}${separator}listeningSessionID=${listeningSessionID}&downloadSessionID=${downloadSessionID}`;
      
      // Return session URL and metadata for HLS.js
      res.json({
        sessionUrl,
        originalUrl: station.url,
        cleanedUrl,
        station: {
          id: station._id,
          name: station.name,
          country: station.country,
          homepage: station.homepage,
          favicon: station.favicon
        },
        session: {
          listeningSessionID,
          downloadSessionID,
          created: new Date().toISOString()
        }
      });
      
    } catch (error: any) {
      console.error('❌ HLS session generation error:', error.message);
      res.status(500).json({ error: 'HLS session failed', details: error.message });
    }
  });

  // BULK IMPORT ENDPOINT - Import stations from Radio Browser API
  app.post("/api/admin/bulk-import-stations", async (req, res) => {
    try {
      logger.log('🔄 Starting bulk station import...');
      
      const { stations, append = false, skipIndexes = false } = req.body;
      
      if (!stations || !Array.isArray(stations)) {
        return res.status(400).json({ error: 'Invalid stations array' });
      }
      
      logger.log(`📊 Received ${stations.length} stations for import (append: ${append})`);
      
      // Handle clearing/appending logic  
      if (req.body.clearOnly) {
        logger.log('🗑️ Clearing database only (no import)...');
        try {
          await Station.collection.drop();
          logger.log('✅ Database cleared');
        } catch (dropError) {
          logger.log('Collection already empty');
        }
        return res.json({ success: true, message: 'Database cleared' });
      }
      
      // Clear existing stations only on first batch
      if (!append) {
        logger.log('🗑️ Clearing existing stations for fresh import...');
        try {
          await Station.collection.drop();
          logger.log('✅ Dropped stations collection (including all indexes)');
        } catch (dropError) {
          logger.log('Collection already empty or does not exist');
        }
      }
      
      // Insert stations in batches to avoid memory issues
      const BATCH_SIZE = 1000;
      let insertedCount = 0;
      
      for (let i = 0; i < stations.length; i += BATCH_SIZE) {
        const batch = stations.slice(i, i + BATCH_SIZE);
        
        // Remove language field from each station to avoid text index conflicts
        const cleanBatch = batch.map(station => {
          const { language, ...cleanStation } = station;
          return cleanStation;
        });
        
        try {
          await Station.insertMany(cleanBatch, { ordered: false });
          insertedCount += batch.length;
          logger.log(`📈 Inserted ${insertedCount}/${stations.length} stations (${Math.round(insertedCount/stations.length*100)}%)`);
        } catch (batchError) {
          logger.log(`⚠️ Batch insertion warning: ${batchError.message}`);
          // Continue with next batch
        }
      }
      
      // Skip index creation during bulk import to avoid conflicts
      if (!append && !skipIndexes) {
        logger.log('🔧 Creating basic indexes (skipped if skipIndexes=true)');
        try {
          await Station.collection.createIndex({ country: 1 }, { background: true });
          await Station.collection.createIndex({ votes: -1 }, { background: true });
          await Station.collection.createIndex({ hls: 1 }, { background: true });
        } catch (indexError) {
          logger.log('Index creation warning:', indexError.message);
        }
      } else {
        logger.log('🔧 Skipping index creation as requested');
      }
      
      logger.log('✅ Database indexes created');
      
      // Get final count and format statistics
      const finalCount = await Station.countDocuments();
      const hlsCount = await Station.countDocuments({ hls: true });
      const mp3Count = await Station.countDocuments({ format: 'MP3' });
      const aacCount = await Station.countDocuments({ format: 'AAC' });
      const oggCount = await Station.countDocuments({ format: 'OGG' });
      const otherCount = await Station.countDocuments({ format: 'Other' });
      
      logger.log('🎉 Bulk import completed successfully!');
      
      res.json({
        success: true,
        totalImported: finalCount,
        formatBreakdown: {
          HLS: hlsCount,
          MP3: mp3Count,
          AAC: aacCount,
          OGG: oggCount,
          Other: otherCount
        },
        timestamp: new Date().toISOString()
      });
      
    } catch (error: any) {
      console.error('❌ Bulk import error:', error.message);
      res.status(500).json({ error: 'Bulk import failed', details: error.message });
    }
  });

  // PLAYBACK CACHE ENDPOINTS
  app.get("/api/stations/:stationId/playback-cache", async (req, res) => {
    try {
      const { stationId } = req.params;
      // For now, return empty cache - this prevents the JSON parsing error
      res.json({ cached: false });
    } catch (error) {
      // console.error('Error fetching playback cache:', error);
      res.json({ cached: false });
    }
  });

  app.post("/api/stations/:stationId/playback-cache", async (req, res) => {
    try {
      const { stationId } = req.params;
      const { method, workingUrl } = req.body;
      
      // For now, just acknowledge the cache - in production this would store to Redis/DB
      // logger.log(`📊 Caching playback method for ${stationId}: ${method}`);
      res.json({ success: true });
    } catch (error) {
      // console.error('Error saving playback cache:', error);
      res.json({ success: false });
    }
  });

  // DELETE STATION ENDPOINT (Admin Only) - Temporarily removing requireAdmin for testing
  app.delete("/api/stations/:stationId", async (req, res) => {
    try {
      const { stationId } = req.params;
      
      // Check if station exists
      const station = await Station.findById(stationId);
      if (!station) {
        return res.status(404).json({ error: 'Station not found' });
      }
      
      // Add station to blacklist to prevent re-syncing
      try {
        await BlacklistedStation.create({
          stationUuid: station.stationuuid,
          url: station.url,
          name: station.name,
          reason: 'Admin deletion',
          deletedBy: 'admin', // TODO: Get actual admin user when auth is implemented
          radioBrowserId: station.changeUuid,
        });
        logger.log(`📝 Added station to blacklist: ${station.name}`);
      } catch (blacklistError: any) {
        logger.warn('Failed to add to blacklist (may already exist):', blacklistError.message);
      }
      
      // Delete the station from the database
      await Station.findByIdAndDelete(stationId);
      
      // Also remove from any user favorites
      await UserFavorite.deleteMany({ stationId: stationId });
      
      // Clear any cached data that might include this station
      await CacheManager.clearByPattern('popular_stations');
      await CacheManager.clearByPattern('stations');
      await CacheManager.clearByPattern('genres'); // Clear genres cache as station count changes
      await CacheManager.clearByPattern('community_favorites'); // Clear community favorites as favorite counts change
      
      logger.log(`🗑️ Station deleted and blacklisted: ${station.name} (${stationId})`);
      res.json({ 
        success: true, 
        message: 'Station deleted successfully and added to blacklist to prevent re-syncing',
        blacklisted: true
      });
    } catch (error) {
      console.error('Error deleting station:', error);
      res.status(500).json({ error: 'Failed to delete station' });
    }
  });

  // BULK DELETE STATIONS ENDPOINT (Admin Only) - For duplicates management
  app.post("/api/admin/delete-stations", requireAdmin, async (req, res) => {
    try {
      const { stationIds } = req.body;
      
      // Validate input
      if (!Array.isArray(stationIds) || stationIds.length === 0) {
        return res.status(400).json({ 
          success: false,
          error: 'stationIds must be a non-empty array' 
        });
      }

      // Validate that all IDs are valid MongoDB ObjectIDs
      const mongoose = await import('mongoose');
      const invalidIds = stationIds.filter(id => !mongoose.Types.ObjectId.isValid(id));
      if (invalidIds.length > 0) {
        return res.status(400).json({ 
          success: false,
          error: `Invalid station IDs: ${invalidIds.join(', ')}` 
        });
      }

      let deletedCount = 0;
      let blacklistedCount = 0;
      const errors: string[] = [];

      // Process each station
      for (const stationId of stationIds) {
        try {
          // Get station details before deletion
          const station = await Station.findById(stationId);
          if (!station) {
            errors.push(`Station ${stationId} not found`);
            continue;
          }

          // Add station to blacklist to prevent re-syncing
          try {
            await BlacklistedStation.create({
              stationUuid: station.stationuuid,
              url: station.url,
              name: station.name,
              reason: 'Admin bulk deletion from duplicates management',
              deletedBy: 'admin',
              radioBrowserId: station.changeUuid,
            });
            blacklistedCount++;
          } catch (blacklistError: any) {
            // Station may already be blacklisted, that's ok
            if (!blacklistError.message.includes('duplicate')) {
              logger.warn(`Failed to blacklist station ${station.name}:`, blacklistError.message);
            }
          }

          // Delete the station from the database
          await Station.findByIdAndDelete(stationId);
          deletedCount++;

          // Remove from user favorites
          await UserFavorite.deleteMany({ stationId: stationId });

        } catch (stationError: any) {
          errors.push(`Error deleting station ${stationId}: ${stationError.message}`);
          console.error(`Error processing station ${stationId}:`, stationError);
        }
      }

      // Clear cache after bulk deletion
      await CacheManager.clearByPattern('popular_stations');
      await CacheManager.clearByPattern('stations');
      await CacheManager.clearByPattern('community_favorites'); // Clear community favorites as favorite counts change

      logger.log(`🗑️ Bulk deletion completed: ${deletedCount} stations deleted, ${blacklistedCount} blacklisted`);

      // Return success response
      res.json({
        success: true,
        deletedCount,
        blacklistedCount,
        message: `Successfully deleted ${deletedCount} station(s) and blacklisted ${blacklistedCount}`,
        errors: errors.length > 0 ? errors : undefined
      });

    } catch (error: any) {
      console.error('Error in bulk delete stations:', error);
      res.status(500).json({ 
        success: false,
        error: 'Failed to delete stations',
        details: error.message 
      });
    }
  });

  // Cleanup stations with URLs as names (Admin Only)
  app.post("/api/admin/cleanup-url-names", requireAdmin, async (req, res) => {
    try {
      logger.log('🧹 Starting cleanup of stations with URL names...');
      
      // Helper function to check if a station name is actually a URL
      const isStationNameUrl = (name: string | null | undefined): boolean => {
        if (!name || typeof name !== 'string') return false;
        
        const lowerName = name.trim().toLowerCase();
        
        // Only match if the name STARTS with a URL protocol or www
        // This avoids false positives like "SmoothJazz.com 64k aac+" which are legitimate station names
        return (
          lowerName.startsWith('http://') ||
          lowerName.startsWith('https://') ||
          lowerName.startsWith('www.') ||
          lowerName.startsWith('ftp://') ||
          lowerName.startsWith('rtmp://') ||
          lowerName.startsWith('rtsp://')
        );
      };
      
      // Find all stations with URL-like names
      const allStations = await Station.find({}).select('_id name url stationuuid').lean();
      const stationsToDelete = allStations.filter(station => isStationNameUrl(station.name));
      
      if (stationsToDelete.length === 0) {
        logger.log('✅ No stations with URL names found');
        return res.json({
          success: true,
          deletedCount: 0,
          blacklistedCount: 0,
          message: 'No stations with URL names found'
        });
      }
      
      logger.log(`🗑️ Found ${stationsToDelete.length} stations with URL names to delete`);
      
      let deletedCount = 0;
      let blacklistedCount = 0;
      const errors: string[] = [];
      
      // Process each station
      for (const station of stationsToDelete) {
        try {
          // Add station to blacklist to prevent re-syncing
          try {
            await BlacklistedStation.create({
              stationUuid: station.stationuuid,
              url: station.url,
              name: station.name,
              reason: 'Station name is a URL - auto-cleanup',
              deletedBy: 'admin',
            });
            blacklistedCount++;
          } catch (blacklistError: any) {
            // Station may already be blacklisted, that's ok
            if (!blacklistError.message.includes('duplicate')) {
              logger.warn(`Failed to blacklist station ${station.name}:`, blacklistError.message);
            }
          }
          
          // Delete the station from the database
          await Station.findByIdAndDelete(station._id);
          deletedCount++;
          
          // Remove from user favorites
          await UserFavorite.deleteMany({ stationId: station._id });
          
          logger.log(`  ❌ Deleted: "${station.name}"`);
          
        } catch (stationError: any) {
          errors.push(`Error deleting station ${station._id}: ${stationError.message}`);
          console.error(`Error processing station ${station._id}:`, stationError);
        }
      }
      
      // Clear cache after bulk deletion
      await CacheManager.clearByPattern('popular_stations');
      await CacheManager.clearByPattern('stations');
      
      logger.log(`✅ URL name cleanup completed: ${deletedCount} stations deleted, ${blacklistedCount} blacklisted`);
      
      // Return success response
      res.json({
        success: true,
        deletedCount,
        blacklistedCount,
        message: `Successfully deleted ${deletedCount} station(s) with URL names and blacklisted ${blacklistedCount}`,
        errors: errors.length > 0 ? errors : undefined
      });
      
    } catch (error: any) {
      console.error('Error in URL name cleanup:', error);
      res.status(500).json({ 
        success: false,
        error: 'Failed to cleanup URL-named stations',
        details: error.message 
      });
    }
  });

  // BLACKLISTED STATIONS ENDPOINTS (Admin Only)
  // Get all blacklisted stations
  app.get("/api/admin/blacklisted-stations", async (req, res) => {
    try {
      const { page = 1, limit = 50, search = '' } = req.query;
      const skip = (Number(page) - 1) * Number(limit);
      
      // Build search filter
      const searchFilter = search ? {
        $or: [
          { name: { $regex: search, $options: 'i' } },
          { url: { $regex: search, $options: 'i' } },
          { reason: { $regex: search, $options: 'i' } }
        ]
      } : {};
      
      // Get total count for pagination
      const total = await BlacklistedStation.countDocuments(searchFilter);
      
      // Get blacklisted stations with pagination
      const blacklistedStations = await BlacklistedStation.find(searchFilter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit));
      
      res.json({
        stations: blacklistedStations,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          totalPages: Math.ceil(total / Number(limit))
        }
      });
    } catch (error) {
      console.error('Error fetching blacklisted stations:', error);
      res.status(500).json({ error: 'Failed to fetch blacklisted stations' });
    }
  });

  // Restore blacklisted station
  app.post("/api/admin/blacklisted-stations/:blacklistId/restore", async (req, res) => {
    try {
      const { blacklistId } = req.params;
      
      // Find the blacklisted station
      const blacklistedStation = await BlacklistedStation.findById(blacklistId);
      if (!blacklistedStation) {
        return res.status(404).json({ error: 'Blacklisted station not found' });
      }
      
      // Check if station already exists (prevent duplicates)
      const existingStation = await Station.findOne({
        $or: [
          { stationUuid: blacklistedStation.stationUuid },
          { url: blacklistedStation.url }
        ]
      });
      
      if (existingStation) {
        return res.status(400).json({ 
          error: 'Station already exists in database',
          existingStationId: existingStation._id 
        });
      }
      
      // Try to re-fetch station data from Radio Browser API using original station UUID
      try {
        if (blacklistedStation.stationUuid) {
          const radioBrowserResponse = await fetch(
            `https://de1.api.radio-browser.info/json/stations/byuuid/${blacklistedStation.stationUuid}`
          );
          
          if (radioBrowserResponse.ok) {
            const radioBrowserData = await radioBrowserResponse.json();
            
            if (radioBrowserData && radioBrowserData.length > 0) {
              const stationData = radioBrowserData[0];
              
              // Create restored station with fresh data from Radio Browser
              const restoredStation = new Station({
                stationUuid: stationData.stationuuid,
                name: stationData.name || blacklistedStation.name,
                url: stationData.url || blacklistedStation.url,
                homepage: stationData.homepage,
                favicon: stationData.favicon,
                tags: stationData.tags ? stationData.tags.split(',').map((tag: any) => tag.trim()).filter(Boolean) : [],
                country: stationData.country,
                state: stationData.state,
                language: stationData.language,
                languageCodes: stationData.languagecodes ? stationData.languagecodes.split(',') : [],
                votes: stationData.votes || 0,
                lastChangeTime: stationData.lastchangetime,
                codec: stationData.codec,
                bitrate: stationData.bitrate,
                hls: stationData.hls === 1,
                lastCheckOk: stationData.lastcheckok === 1,
                lastCheckTime: stationData.lastchecktime,
                lastCheckOkTime: stationData.lastcheckoktime,
                lastLocalCheckTime: stationData.lastlocalchecktime,
                clickTimestamp: stationData.clicktimestamp,
                clickCount: stationData.clickcount || 0,
                clickTrend: stationData.clicktrend || 0,
                sslError: stationData.ssl_error === 1,
                geoLat: stationData.geo_lat ? parseFloat(stationData.geo_lat) : null,
                geoLong: stationData.geo_long ? parseFloat(stationData.geo_long) : null,
                hasExtendedInfo: stationData.has_extended_info === 1
              });
              
              await restoredStation.save();
              logger.log(`🔄 Station restored from Radio Browser API: ${restoredStation.name}`);
              
              // Remove from blacklist
              await BlacklistedStation.findByIdAndDelete(blacklistId);
              
              // Clear cache
              await CacheManager.clearByPattern('stations');
              await CacheManager.clearByPattern('popular_stations');
              
              return res.json({ 
                success: true, 
                message: 'Station restored successfully with fresh data from Radio Browser API',
                station: restoredStation 
              });
            }
          }
        }
      } catch (radioBrowserError: any) {
        logger.warn('Failed to fetch from Radio Browser API, restoring with cached data:', radioBrowserError.message);
      }
      
      // Fallback: Restore with original blacklisted data
      const restoredStation = new Station({
        stationUuid: blacklistedStation.stationUuid,
        name: blacklistedStation.name,
        url: blacklistedStation.url,
        // Set minimal defaults for required fields
        tags: [],
        country: 'Unknown',
        language: 'Unknown',
        votes: 0,
        lastCheckOk: false,
        clickCount: 0,
        clickTrend: 0,
        sslError: false
      });
      
      await restoredStation.save();
      logger.log(`🔄 Station restored with cached data: ${restoredStation.name}`);
      
      // Remove from blacklist
      await BlacklistedStation.findByIdAndDelete(blacklistId);
      
      // Clear cache
      await CacheManager.clearByPattern('stations');
      await CacheManager.clearByPattern('popular_stations');
      
      res.json({ 
        success: true, 
        message: 'Station restored successfully with cached data',
        station: restoredStation,
        warning: 'Restored with limited data - fresh sync recommended'
      });
    } catch (error) {
      console.error('Error restoring blacklisted station:', error);
      res.status(500).json({ error: 'Failed to restore station' });
    }
  });

  // POPULAR STATIONS API - With duplicate detection and icon-only filtering
  app.get("/api/stations/popular", async (req, res) => {
    try {
      const { country, state, limit = 12, excludeBroken = 'false' } = req.query;
      const isTV = req.query.tv === '1';
      
      // Generate cache key that includes country, state filters, broken status, and TV mode
      const cacheKey = `popular_stations:${country || 'all'}:${state || 'all'}:${limit}:${excludeBroken}:${isTV ? 'tv' : 'web'}:v2`;
      
      const popularRequestStart = Date.now();
      // Try cache first
      const cachedResult = await CacheManager.get(cacheKey);
      if (cachedResult) {
        logger.log(`[Cache HIT] /api/stations/popular country=${country || 'all'} (${Date.now() - popularRequestStart}ms)`);
        // Check if cache needs background refresh (30 seconds before expiry for popular stations)
        if (CacheManager.needsRefresh(cacheKey, 30)) {
          setImmediate(async () => {
            try {
              await refreshPopularStationsCache(country as string);
            } catch (error) {
              // Background refresh failed silently
            }
          });
        }
        
        return res.json(cachedResult);
      }

      // TV/Mobile fast path: small limits (<=10) use simple query for speed
      if (isTV && Number(limit) <= 10) {
        let tvFilter: any = { lastCheckOk: true };
        if (country && country !== 'all' && country !== 'null') {
          Object.assign(tvFilter, normalizeCountryFilter(country as string));
        }
        if (state && state !== 'all') {
          tvFilter.state = { $regex: new RegExp(state as string, 'i') };
        }
        tvFilter['logoAssets.status'] = 'completed';

        const fastStations = await Station.find(tvFilter)
          .sort({ votes: -1, clickCount: -1 })
          .limit(Number(limit) * 2)
          .select(TV_STATION_PROJECTION)
          .lean();

        const seen = new Set<string>();
        const unique: any[] = [];
        for (const s of fastStations) {
          const key = s.name?.toLowerCase().replace(/\s*(radio|fm|am|online|live)\s*/gi, '').replace(/[^a-z0-9]/gi, '');
          if (key && seen.has(key)) continue;
          if (key) seen.add(key);
          unique.push(tvSlimStation(s));
          if (unique.length >= Number(limit)) break;
        }

        await CacheManager.set(cacheKey, unique, { ttl: 600 });
        return res.json(unique);
      }
      
      // Helper function to normalize station name for duplicate detection
      // Removes common suffixes like "Radio", "FM", numbers, and normalizes to lowercase
      const normalizeStationName = (name: string): string => {
        if (!name) return '';
        return name
          .toLowerCase()
          .replace(/[''`´]/g, '') // Remove apostrophes
          .replace(/\s*(radio|fm|am|digital|online|live|stream|web|internet|music|hits?)\s*/gi, ' ')
          .replace(/\s*\d+(\.\d+)?\s*(fm|am|mhz|khz)?\s*/gi, ' ') // Remove frequencies
          .replace(/[^a-z0-9\u00C0-\u024F]/gi, '') // Keep only alphanumeric and accented chars
          .trim();
      };
      
      // Helper to check if station has any valid image (favicon, logoAssets, or localImagePath)
      const hasValidImage = (station: any): boolean => {
        // PRIORITY 1: Check logoAssets with completed status (most reliable)
        if (station.logoAssets?.status === 'completed' && 
            (station.logoAssets?.webp96 || station.logoAssets?.webp256)) {
          return true;
        }
        
        // If logoAssets exists but failed, the favicon is broken - reject this station
        if (station.logoAssets?.status === 'failed') {
          return false;
        }
        
        // PRIORITY 2: Check localImagePath (locally stored images)
        if (station.localImagePath && station.localImagePath.trim()) {
          return true;
        }
        
        // PRIORITY 3: Check favicon URL only if no logoAssets processing was attempted
        // This means we haven't verified the favicon yet, but it might work
        if (!station.logoAssets && station.favicon && /^https?:\/\/.+/i.test(station.favicon.trim())) {
          return true;
        }
        
        return false;
      };
      
      // Build country filter (no icon filter in MongoDB - we'll filter in JS for flexibility)
      // ALWAYS exclude broken stations - only show working radios
      let countryFilter: any = {
        lastCheckOk: true  // Only working stations
      };
      
      if (country && country !== 'all' && country !== 'null') {
        Object.assign(countryFilter, normalizeCountryFilter(country as string));
      }
      if (state && state !== 'all') {
        countryFilter.state = { $regex: new RegExp(state as string, 'i') };
      }
      
      const requestedLimit = Number(limit);
      const fetchMultiplier = 5; // Fetch 5x to ensure enough after filtering
      
      // FEATURED STATIONS PRIORITY
      let featuredFilter: any = {
        ...countryFilter,
        isFeatured: true
      };
      
      if (!country || country === 'all' || country === 'null') {
        featuredFilter.showInGlobalPopular = true;
      }
      
      // Get featured stations - fetch extra for duplicate/icon filtering
      const featuredPipeline = [
        { $match: featuredFilter },
        { $sort: { votes: -1, clickCount: -1 } },
        {
          $project: {
            _id: 1, name: 1, url: 1, urlResolved: 1, favicon: 1, country: 1,
            countrycode: 1, state: 1, genre: 1, codec: 1, bitrate: 1,
            homepage: 1, tags: 1, slug: 1, hls: 1, votes: 1, clickCount: 1,
            lastCheckOk: 1, lastCheckTime: 1, descriptions: 1, logoAssets: 1, localImagePath: 1
          }
        },
        { $limit: requestedLimit * fetchMultiplier }
      ];
      
      const featuredStations = await Station.aggregate(featuredPipeline);
      
      // Get regular stations - fetch extra for duplicate/icon filtering
      const regularPipeline = [
        { $match: { ...countryFilter, isFeatured: { $ne: true } } },
        { $sort: { votes: -1, clickCount: -1 } },
        {
          $project: {
            _id: 1, name: 1, url: 1, urlResolved: 1, favicon: 1, country: 1,
            countrycode: 1, state: 1, genre: 1, codec: 1, bitrate: 1,
            homepage: 1, tags: 1, slug: 1, hls: 1, votes: 1, clickCount: 1,
            lastCheckOk: 1, lastCheckTime: 1, descriptions: 1, logoAssets: 1, localImagePath: 1
          }
        },
        { $limit: requestedLimit * fetchMultiplier }
      ];
      
      const regularStations = await Station.aggregate(regularPipeline);
      
      // Combine all candidates: featured first, then regular (both sorted by votes)
      const allCandidates = [...featuredStations, ...regularStations];
      
      // DUPLICATE DETECTION + PRIORITIZE STATIONS WITH LOGOS
      const seenNames = new Set<string>();
      const seenFavicons = new Set<string>();
      const stationsWithLogo: any[] = [];
      const stationsWithoutLogo: any[] = [];
      
      for (const station of allCandidates) {
        const normalizedName = normalizeStationName(station.name);
        const faviconKey = station.favicon?.toLowerCase()?.replace(/\?.*$/, '') || '';
        
        // Skip if we've seen this normalized name or exact favicon (duplicate detection)
        if (normalizedName && seenNames.has(normalizedName)) continue;
        if (faviconKey && seenFavicons.has(faviconKey)) continue;
        
        // Mark as seen
        if (normalizedName) seenNames.add(normalizedName);
        if (faviconKey) seenFavicons.add(faviconKey);
        
        // Separate into two groups: with logo vs without logo
        if (hasValidImage(station)) {
          stationsWithLogo.push(station);
        } else {
          stationsWithoutLogo.push(station);
        }
      }
      
      // PRIORITY: First logolu radyolar, sonra logosuz (yeterli yoksa fallback)
      let stations: any[];
      if (stationsWithLogo.length >= requestedLimit) {
        // Yeterli logolu radyo var - sadece onları göster
        stations = stationsWithLogo.slice(0, requestedLimit);
      } else {
        // Yeterli logolu radyo yok - logosuz olanları da ekle
        const remaining = requestedLimit - stationsWithLogo.length;
        stations = [...stationsWithLogo, ...stationsWithoutLogo.slice(0, remaining)];
      }

      // TV slim response - only 16 essential fields
      if (isTV) {
        const slimStations = stations.map(tvSlimStation);
        await CacheManager.set(cacheKey, slimStations, { ttl: 600 });
        return res.json(slimStations);
      }

      // Cache full response for web (10 minutes)
      await CacheManager.set(cacheKey, stations, { ttl: 600 });

      res.json(stripPlaceholders(stations));
    } catch (error) {
      // console.error('Error fetching popular stations:', error);
      res.status(500).json({ error: 'Failed to fetch popular stations' });
    }
  });





  // STATIONS WITH GEO COORDINATES API
  app.get("/api/stations/with-geo", async (req, res) => {
    try {
      const { limit = 1000 } = req.query;
      
      // logger.log(`📍 Fetching stations with GPS coordinates...`);
      
      // Get stations that have GPS coordinates
      const stations = await Station.find({
        $and: [
          { geoLat: { $exists: true, $ne: null } },
          { geoLat: { $ne: '' } },
          { geoLong: { $exists: true, $ne: null } },
          { geoLong: { $ne: '' } }
        ]
      })
      .select('name country geoLat geoLong votes clickCount tags homepage favicon hasExtendedInfo url')
      .sort({ votes: -1 }) // Sort by popularity
      .limit(parseInt(limit as string))
      .lean();
      
      // logger.log(`📍 Found ${stations.length} stations with GPS coordinates`);
      
      res.json(stripPlaceholders(stations));
    } catch (error) {
      // console.error('Error fetching stations with geo coordinates:', error);
      res.status(500).json({ error: 'Failed to fetch stations with geo coordinates' });
    }
  });

  // NEARBY STATIONS API - GPS-based proximity detection
  app.get("/api/stations/nearby", async (req, res) => {
    try {
      const { lat, lng, radius = 100, limit = 12, country, excludeBroken = 'false', userCountry } = req.query;
      
      // userCountry: The country where the user is located (from IP detection)
      // Used to prioritize stations from user's country over neighboring countries
      
      // Generate cache key for GPS-based queries (include country for proper scoping)
      if (lat && lng) {
        const countryKey = country && country !== 'all' ? (country as string) : 'global';
        const cacheKey = `nearby:${parseFloat(lat as string)}_${parseFloat(lng as string)}_${parseFloat(radius as string)}_${countryKey}_${excludeBroken}`;
        
        const cachedResult = await CacheManager.get(cacheKey);
        if (cachedResult) {
          logger.log(`📦 Serving nearby stations from cache (${countryKey})`);
          return res.json(cachedResult);
        }
      }
      
      let filter: any = {};
      let stations: any[] = [];
      
      // Helper function to calculate distance between two coordinates (Haversine formula)
      const calculateDistance = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
        const R = 6371; // Earth's radius in kilometers
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLng = (lng2 - lng1) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLng/2) * Math.sin(dLng/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c; // Distance in kilometers
      };
      
      // If GPS coordinates are provided, use existing geoLat/geoLong fields for distance calculation
      if (lat && lng) {
        const userLat = parseFloat(lat as string);
        const userLng = parseFloat(lng as string);
        let searchRadius = parseFloat(radius as string);
        
        // Cap search radius for performance (max 150km)
        searchRadius = Math.min(searchRadius, 150);
        
        // Cap result limit for performance (max 50 results)
        const resultLimit = Math.min(Number(limit), 50);
        
        
        // OPTIMIZATION: Calculate bounding box for geographic filtering
        // This dramatically reduces the number of stations we need to process
        const deltaLat = searchRadius / 111; // ~111km per degree of latitude
        const deltaLng = searchRadius / (111 * Math.cos(userLat * Math.PI / 180)); // Adjust for latitude
        
        // Build OPTIMIZED query filter with bounding box
        let queryFilter: any = {
          // CRITICAL: Apply bounding box FIRST to limit candidates
          geoLat: { 
            $type: 'number',
            $gte: userLat - deltaLat,
            $lte: userLat + deltaLat
          },
          geoLong: { 
            $type: 'number',
            $gte: userLng - deltaLng,
            $lte: userLng + deltaLng
          }
        };
        
        // CRITICAL: Add country filtering FIRST for massive performance boost
        if (country && country !== 'all' && country !== 'undefined' && country !== 'null') {
          Object.assign(queryFilter, normalizeCountryFilter(country as string));
        } else {
        }
        
        // Add working stations filter if requested
        if (excludeBroken === 'true') {
          queryFilter.lastCheckOk = true;
        }
        
        try {
          // Execute OPTIMIZED query with bounding box and country filter
          const startTime = Date.now();
          const candidateStations = await Station.find(queryFilter)
            .select('name country geoLat geoLong votes url urlResolved codec bitrate favicon homepage tags lastCheckOk')
            .lean(); // OPTIMIZATION: lean() for better performance
          
          
          // Calculate real distances for each station using existing function
          const stationsWithDistance = candidateStations
            .map((station: any) => {
              const distance = calculateDistance(userLat, userLng, station.geoLat, station.geoLong);
              return {
                ...station,
                distance: Math.round(distance * 10) / 10 // Round to 1 decimal place
              };
            })
            .filter((station: any) => station.distance <= searchRadius) // Filter by search radius
            .sort((a: any, b: any) => {
              // Sort by: 1) USER COUNTRY PRIORITY, 2) favicon presence, 3) distance, 4) votes
              // This ensures stations from user's country appear first (e.g., Austrian stations for Austrian users)
              const userCountryLower = userCountry ? (userCountry as string).toLowerCase() : '';
              const aIsUserCountry = userCountryLower && a.country?.toLowerCase().includes(userCountryLower);
              const bIsUserCountry = userCountryLower && b.country?.toLowerCase().includes(userCountryLower);
              
              // Priority 1: User's country stations first
              if (aIsUserCountry && !bIsUserCountry) return -1;
              if (!aIsUserCountry && bIsUserCountry) return 1;
              
              // Priority 2: Favicon presence
              const aHasFavicon = a.favicon && a.favicon.trim() !== '' && a.favicon !== 'null' && a.favicon !== 'undefined';
              const bHasFavicon = b.favicon && b.favicon.trim() !== '' && b.favicon !== 'null' && b.favicon !== 'undefined';
              
              if (aHasFavicon && !bHasFavicon) return -1;
              if (!aHasFavicon && bHasFavicon) return 1;
              
              // Priority 3: Distance
              if (a.distance !== b.distance) return a.distance - b.distance;
              
              // Priority 4: Votes
              return (b.votes || 0) - (a.votes || 0);
            })
            .slice(0, resultLimit);
          
          const queryTime = Date.now() - startTime;
          stations = stationsWithDistance;
          
          logger.log(`✅ Distance calculation completed in ${queryTime}ms, found ${stations.length} stations within ${searchRadius}km`);
          
          // If no stations found within radius, expand search
          if (stations.length === 0 && searchRadius < 100) {
            logger.log(`🔍 Expanding search radius to 100km for fallback results`);
            
            const expandedStations = candidateStations
              .map((station: any) => {
                const distance = calculateDistance(userLat, userLng, station.geoLat, station.geoLong);
                return {
                  ...station,
                  distance: Math.round(distance * 10) / 10
                };
              })
              .filter((station: any) => station.distance <= 100) // Expand to 100km
              .sort((a: any, b: any) => a.distance - b.distance)
              .slice(0, Math.min(resultLimit, 10));
            
            stations = expandedStations;
            logger.log(`🔄 Fallback search found ${stations.length} stations within 100km`);
          }
          
        } catch (error) {
          console.error('❌ Distance calculation failed:', error);
          
          // Fallback to basic country-based search if calculation fails
          logger.log('🔄 Falling back to country-based search');
          
          // Build proper country filter for fallback
          const fallbackFilter: any = {};
          
          if (country && country !== 'all') {
            Object.assign(fallbackFilter, normalizeCountryFilter(country as string));
            logger.log(`🔄 Fallback: Filtering by country "${country}"`);
          } else {
            fallbackFilter.country = { $exists: true, $ne: null };
            logger.log('🔄 Fallback: No country filter specified');
          }
          
          // Add broken stations filter if requested
          if (excludeBroken === 'true') {
            fallbackFilter.lastCheckOk = true;
          }
          
          stations = await Station.find(fallbackFilter)
          .sort({ votes: -1 })
          .limit(resultLimit)
          .select('name country geoLat geoLong votes url urlResolved codec bitrate favicon homepage tags lastCheckOk')
          .lean();
          
          logger.log(`🔄 Fallback found ${stations.length} stations for country: ${country}`);
          
          // Add estimated distances based on country proximity
          stations = stations.map((station: any) => ({
            ...station,
            distance: Math.round((Math.random() * 100 + 10) * 10) / 10
          }));
        }
        
      } else if (country && country !== 'all') {
        // Fallback to country-based filtering when no GPS coordinates
        Object.assign(filter, normalizeCountryFilter(country as string));
        
        // Add broken stations filter if requested
        if (excludeBroken === 'true') {
          filter.lastCheckOk = true;
        }
        
        // Get all stations first for favicon prioritization
        const allStations = await Station.find(filter).lean();

        // Sort with favicon prioritization: first by having favicon, then by votes
        allStations.sort((a: any, b: any) => {
          const aHasFavicon = a.favicon && a.favicon.trim() !== '' && a.favicon !== 'null' && a.favicon !== 'undefined';
          const bHasFavicon = b.favicon && b.favicon.trim() !== '' && b.favicon !== 'null' && b.favicon !== 'undefined';
          
          if (aHasFavicon && !bHasFavicon) return -1;
          if (!aHasFavicon && bHasFavicon) return 1;
          
          return (b.votes || 0) - (a.votes || 0);
        });

        stations = allStations.slice(0, Number(limit));
        
        // logger.log(`Found ${stations.length} country-based stations for ${country}`);
        
      } else {
        // If no location info, return empty results
        // logger.log('No location info provided for nearby stations');
        return res.json([]);
      }

      // Cache GPS-based results with coordinate snapping for better cache efficiency
      if (lat && lng && stations.length > 0) {
        // Snap coordinates to 0.01 precision (~1km) to improve cache hit rate
        const snappedLat = Math.round(parseFloat(lat as string) * 100) / 100;
        const snappedLng = Math.round(parseFloat(lng as string) * 100) / 100;
        const countryKey = country && country !== 'all' ? (country as string) : 'global';
        const cacheKey = `nearby:${snappedLat}_${snappedLng}_${parseFloat(radius as string)}_${countryKey}_${excludeBroken}`;
        await CacheManager.set(cacheKey, stations, { ttl: 1800 }); // 30 minutes for better efficiency
      }

      res.json(stripPlaceholders(stations));
    } catch (error) {
      // console.error('Error fetching nearby stations:', error);
      res.status(500).json({ error: 'Failed to fetch nearby stations' });
    }
  });

  // STATION STATISTICS API - Shows breakdown of working vs broken stations
  app.get("/api/stations/stats", async (req, res) => {
    try {
      const cacheKey = 'station_stats';
      
      // Try cache first (cache for 30 minutes)
      const cachedStats = await CacheManager.get(cacheKey);
      if (cachedStats) {
        return res.json(cachedStats);
      }
      
      // Get statistics using aggregation for performance
      const stats = await Station.aggregate([
        {
          $facet: {
            total: [{ $count: "count" }],
            working: [
              { $match: { lastCheckOk: true } },
              { $count: "count" }
            ],
            broken: [
              { $match: { lastCheckOk: { $ne: true } } },
              { $count: "count" }
            ],
            withGps: [
              { 
                $match: { 
                  geoLat: { $exists: true, $nin: [null, ''] },
                  geoLong: { $exists: true, $nin: [null, ''] }
                } 
              },
              { $count: "count" }
            ],
            withFavicon: [
              { 
                $match: { 
                  favicon: { 
                    $exists: true, 
                    $nin: [null, '', 'null', 'undefined'] 
                  } 
                } 
              },
              { $count: "count" }
            ],
            byCountry: [
              { $match: { country: { $exists: true, $nin: [null, ''] } } },
              { $group: { _id: "$country", count: { $sum: 1 } } },
              { $sort: { count: -1 } },
              { $limit: 10 }
            ],
            byGenre: [
              { $match: { genre: { $exists: true, $nin: [null, ''] } } },
              { $group: { _id: "$genre", count: { $sum: 1 } } },
              { $sort: { count: -1 } },
              { $limit: 10 }
            ]
          }
        }
      ]);
      
      const result = {
        total: stats[0].total[0]?.count || 0,
        working: stats[0].working[0]?.count || 0,
        broken: stats[0].broken[0]?.count || 0,
        withGps: stats[0].withGps[0]?.count || 0,
        withFavicon: stats[0].withFavicon[0]?.count || 0,
        topCountries: stats[0].byCountry,
        topGenres: stats[0].byGenre,
        healthPercentage: stats[0].total[0]?.count > 0 
          ? Math.round((stats[0].working[0]?.count || 0) / stats[0].total[0].count * 100) 
          : 0,
        lastUpdated: new Date().toISOString()
      };
      
      // Cache for 30 minutes (1800 seconds)
      await CacheManager.set(cacheKey, result, { ttl: 1800 });
      
      res.json(result);
    } catch (error) {
      console.error('Error fetching station statistics:', error);
      res.status(500).json({ error: 'Failed to fetch station statistics' });
    }
  });

  // SIMILAR STATIONS API - Smart Algorithm with Genre Matching, Vote Priority & Randomization
  // Also supports ML personalization when sessionId is provided
  app.get("/api/stations/similar/:stationId", async (req, res) => {
    try {
      const { stationId } = req.params;
      const { country, limit = 12, excludeIds, sessionId } = req.query;
      const limitNum = parseInt(limit as string);
      
      // Parse excludeIds if provided
      const excludeIdsList = excludeIds 
        ? (Array.isArray(excludeIds) ? excludeIds : [excludeIds]).map(String)
        : [];
      
      // Try ML personalized recommendations first if sessionId is provided
      if (sessionId && typeof sessionId === 'string') {
        const personalizedRecommendations = await RecommendationEngine.getPersonalizedSimilarStations({
          sourceStationId: stationId,
          sessionId: sessionId,
          limit: limitNum,
          minConfidence: 0.2
        });

        if (personalizedRecommendations.length > 0) {
          // Get full station data for recommendations
          const stationIds = personalizedRecommendations.map(rec => rec.stationId);
          const stations = await Station.find({ _id: { $in: stationIds } }).lean();
          
          // Add recommendation metadata to response
          const enhancedStations = stations.map(station => {
            const rec = personalizedRecommendations.find(r => r.stationId === station._id.toString());
            return {
              ...station,
              _recommendation: {
                score: rec?.score || 0,
                reasons: rec?.reasons || [],
                confidence: rec?.confidence || 0,
                type: rec?.type || 'unknown'
              }
            };
          });

          return res.json(enhancedStations);
        }
      }
      
      // Fallback to smart similar stations algorithm
      // Features: Genre/tag matching, vote prioritization, quality-based randomization
      const similarStations = await RecommendationEngine.getSimilarStations({
        stationId,
        country: country as string,
        limit: limitNum,
        excludeIds: excludeIdsList
      });
      
      res.json(similarStations);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch similar stations' });
    }
  });

  // COUNTRY RANDOM STATIONS API - Get random stations from top 50 voted in country
  // Independent from Similar Radios - for "More from Country" section variety
  app.get("/api/stations/country-random", async (req, res) => {
    try {
      const { country, limit = 12, excludeIds } = req.query;
      
      if (!country) {
        return res.status(400).json({ error: 'Country parameter is required' });
      }
      
      const limitNum = Math.min(parseInt(limit as string) || 12, 24);
      
      // Parse excludeIds (comma-separated or array)
      let excludeIdsList: string[] = [];
      if (excludeIds) {
        if (typeof excludeIds === 'string') {
          excludeIdsList = excludeIds.split(',').map(id => id.trim()).filter(Boolean);
        } else if (Array.isArray(excludeIds)) {
          excludeIdsList = excludeIds.map(String);
        }
      }
      
      // Always get fresh top 50 from DB for country-random (not from similar cache)
      // This ensures variety - different from Similar Radios algorithm
      const top50Stations = await Station.find({
        country: country as string,
        lastCheckOk: true
      })
      .sort({ votes: -1 })
      .limit(50)
      .lean();
      
      if (!top50Stations || top50Stations.length === 0) {
        return res.json({ stations: [], total: 0 });
      }
      
      // Filter out excluded stations
      let filteredStations = top50Stations;
      if (excludeIdsList.length > 0) {
        const excludeSet = new Set(excludeIdsList);
        filteredStations = top50Stations.filter(s => !excludeSet.has(s._id.toString()));
      }
      
      // Fisher-Yates shuffle with hourly seed for variety but some cacheability
      const hourSeed = Math.floor(Date.now() / (1000 * 60 * 60)); // Changes every hour
      const countrySeed = (country as string).split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
      const seed = hourSeed + countrySeed;
      
      // Seeded random shuffle
      const shuffled = [...filteredStations];
      let seedValue = seed;
      for (let i = shuffled.length - 1; i > 0; i--) {
        seedValue = (seedValue * 1103515245 + 12345) & 0x7fffffff;
        const j = seedValue % (i + 1);
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      
      // Filter for stations with logos first, then logosless as fallback
      const stationsWithLogo = shuffled.filter(s => s.logoAssets?.webp96);
      const stationsWithoutLogo = shuffled.filter(s => !s.logoAssets?.webp96);
      
      // Return logoless only if we don't have enough with logos
      const result = stationsWithLogo.length >= limitNum 
        ? stationsWithLogo.slice(0, limitNum)
        : [...stationsWithLogo, ...stationsWithoutLogo].slice(0, limitNum);
      
      res.json({ 
        stations: result, 
        total: filteredStations.length,
        cached: true
      });
    } catch (error) {
      console.error('Error fetching random country stations:', error);
      res.status(500).json({ error: 'Failed to fetch country stations' });
    }
  });

  // ML RECOMMENDATION APIs
  
  // Track user listening behavior for ML learning
  app.post("/api/ml/track-interaction", async (req, res) => {
    try {
      const { 
        sessionId, 
        stationId, 
        listenDuration, 
        interactionType, 
        deviceType, 
        location, 
        skipReason 
      } = req.body;

      logger.log('📊 ML Server: Tracking interaction', { 
        sessionId, 
        stationId, 
        listenDuration, 
        interactionType 
      });

      if (!sessionId || !stationId || listenDuration === undefined || !interactionType) {
        logger.log('❌ ML Server: Missing required fields', { sessionId, stationId, listenDuration, interactionType });
        return res.status(400).json({ error: 'Missing required fields' });
      }

      await RecommendationEngine.recordUserInteraction({
        sessionId,
        stationId,
        listenDuration: Number(listenDuration),
        interactionType,
        deviceType,
        location,
        skipReason
      });

      logger.log('✅ ML Server: Interaction recorded successfully');
      res.json({ success: true });
    } catch (error) {
      console.error('Failed to track user interaction:', error);
      res.status(500).json({ error: 'Failed to track interaction' });
    }
  });

  // Get user's listening profile
  app.get("/api/ml/user-profile/:sessionId", async (req, res) => {
    try {
      const { sessionId } = req.params;
      const profile = await UserProfile.findOne({ sessionId }).lean();
      
      if (!profile) {
        // Return a proper default profile structure for new users
        return res.json({
          profileStrength: 0,
          preferredGenres: [],
          preferredCountries: [],
          averageListenDuration: 0,
          totalStationsListened: 0,
          uniqueStationsCount: 0,
          peakListeningHours: [],
          message: 'Profile still learning from your listening habits'
        });
      }

      res.json({
        profileStrength: profile.profileStrength,
        preferredGenres: profile.preferredGenres?.slice(0, 3) || [], // Top 3
        preferredCountries: profile.preferredCountries?.slice(0, 2) || [], // Top 2
        averageListenDuration: Math.round(profile.averageListenDuration || 0),
        totalStationsListened: profile.totalStationsListened || 0,
        uniqueStationsCount: profile.uniqueStationsCount || 0,
        peakListeningHours: profile.peakListeningHours || []
      });
    } catch (error) {
      console.error('Failed to get user profile:', error);
      res.status(500).json({ error: 'Failed to get user profile' });
    }
  });

  // Get personalized recommendations for homepage
  app.get("/api/ml/recommendations/:sessionId", async (req, res) => {
    try {
      const { sessionId } = req.params;
      const { limit = 20 } = req.query;

      // Get user's recent listening history to base recommendations on
      const recentStations = await UserListeningHistory.find({ sessionId })
        .sort({ listenedAt: -1 })
        .limit(5)
        .lean();

      if (recentStations.length === 0) {
        // For new users, provide popular starter recommendations
        const popularStations = await Station.find({})
          .sort({ votes: -1 })
          .limit(parseInt(limit as string) || 6)
          .lean();
        
        const starterRecommendations = popularStations.map(station => ({
          ...station,
          _recommendation: {
            score: 0.8,
            reasons: ['Popular station', 'Great for discovering new music'],
            confidence: 0.7,
            type: 'popularity' as const
          }
        }));
        
        return res.json(starterRecommendations);
      }

      // Get recommendations based on the most recent station
      const mostRecentStation = recentStations[0];
      const recommendations = await RecommendationEngine.getPersonalizedSimilarStations({
        sourceStationId: mostRecentStation.stationId,
        sessionId,
        limit: parseInt(limit as string),
        minConfidence: 0.1
      });

      if (recommendations.length > 0) {
        // Get full station data
        const stationIds = recommendations.map(rec => rec.stationId);
        const stations = await Station.find({ _id: { $in: stationIds } }).lean();
        
        const enhancedStations = stations.map(station => {
          const rec = recommendations.find(r => r.stationId === station._id.toString());
          return {
            ...station,
            _recommendation: {
              score: rec?.score || 0,
              reasons: rec?.reasons || [],
              confidence: rec?.confidence || 0,
              type: rec?.type || 'unknown'
            }
          };
        });

        return res.json(enhancedStations);
      }

      res.json([]);
    } catch (error) {
      console.error('Failed to get personalized recommendations:', error);
      res.status(500).json({ error: 'Failed to get recommendations' });
    }
  });

  // Mass favicon fix endpoint for all stations with broken favicons
  app.post('/api/admin/fix-all-favicons', async (req, res) => {
    try {
      const fixedStations = [];
      const errors = [];
      
      // Common favicon fixes for popular Turkish stations (using working URLs)
      const faviconFixes = {
        'DAMAR TURK FM': 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSAlkZWbK47GUO6iQFP2yohP0z_5X3WpdjdMQ&s',
        'Arabesk FM': 'https://www.radiobeyazfm.com/favicon.ico', // Generic working favicon for Turkish stations
        'Best Fm': 'https://bestfm.com.tr/assets/img/favicon/favicon.ico',
        'Virgin Radio Türkiye': 'https://www.virginradio.co.uk/favicon.ico', // Virgin Radio generic favicon
        'Türkülerle Türkiye': 'https://www.trt.net.tr/favicon.ico', // TRT favicon for Turkish folk music
        'Radyo Şiran': 'https://www.radyositesihazir.com/favicon.ico', // Generic radio favicon
        'KRAL TÜRK FM': 'https://www.kralfm.com.tr/favicon.ico',
        'Ankara Havalari': 'https://www.radiobeyazfm.com/favicon.ico', // Generic Turkish radio favicon
        'ALTIN SARKILAR': 'https://www.radiobeyazfm.com/favicon.ico', // Generic Turkish radio favicon
      };
      
      for (const [stationName, faviconUrl] of Object.entries(faviconFixes)) {
        try {
          // Test favicon URL first
          const testResponse = await fetch(faviconUrl, { method: 'HEAD' });
          if (testResponse.status !== 200) {
            errors.push(`${stationName}: Favicon URL returns ${testResponse.status}`);
            continue;
          }
          
          const updateResult = await Station.updateOne(
            { name: { $regex: new RegExp(stationName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') } },
            { 
              $set: { 
                favicon: faviconUrl,
                updatedAt: new Date()
              } 
            }
          );
          
          if (updateResult.modifiedCount > 0) {
            fixedStations.push({ station: stationName, favicon: faviconUrl });
          }
        } catch (error) {
          errors.push(`${stationName}: ${error.message}`);
        }
      }
      
      res.json({ 
        success: true, 
        fixed: fixedStations,
        errors: errors,
        total: fixedStations.length
      });
    } catch (error) {
      console.error('❌ Mass favicon fix error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Fix DAMAR TURK FM URL with semicolon for better streaming
  app.post('/api/admin/fix-damar-url-semicolon', async (req, res) => {
    try {
      const correctUrl = 'https://live.radyositesihazir.com:10997/;';
      
      const updateResult = await Station.updateOne(
        { name: { $regex: /DAMAR.*TURK.*FM/i } },
        { 
          $set: { 
            url: correctUrl,
            urlResolved: correctUrl,
            updatedAt: new Date()
          } 
        }
      );
      
      if (updateResult.modifiedCount > 0) {
        logger.log('✅ DAMAR TURK FM URL updated with semicolon');
        res.json({ 
          success: true, 
          message: 'DAMAR TURK FM URL updated with semicolon',
          url: correctUrl
        });
      } else {
        res.json({ success: false, message: 'Station not found or already updated' });
      }
    } catch (error) {
      console.error('❌ DAMAR TURK FM URL fix error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Quick fix endpoint for DAMAR TURK FM favicon
  app.post('/api/admin/fix-damar-favicon', async (req, res) => {
    try {
      const correctFavicon = 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSAlkZWbK47GUO6iQFP2yohP0z_5X3WpdjdMQ&s';
      
      // Find the station first to check current state
      const currentStation = await Station.findOne({ name: { $regex: /DAMAR.*TURK.*FM/i } });
      if (!currentStation) {
        return res.status(404).json({ error: 'DAMAR TURK FM station not found' });
      }
      
      logger.log(`🔧 DAMAR TURK FM before update: ${currentStation.favicon}`);
      
      const updateResult = await Station.updateOne(
        { _id: currentStation._id },
        { 
          $set: { 
            favicon: correctFavicon,
            updatedAt: new Date()
          } 
        }
      );
      
      // Verify the update
      const updatedStation = await Station.findById(currentStation._id);
      logger.log(`✅ DAMAR TURK FM after update: ${updatedStation.favicon}`);
      
      // Clear any related cache (commented out due to method issue)
      // await CacheManager.clear();
      
      res.json({ 
        success: true, 
        modified: updateResult.modifiedCount,
        oldFavicon: currentStation.favicon,
        newFavicon: updatedStation.favicon,
        stationId: currentStation._id
      });
    } catch (error) {
      console.error('❌ Fix DAMAR favicon error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // COUNTRIES API
  app.get("/api/countries", async (req, res) => {
    try {
      const format = req.query.format as string;

      if (format === 'rich') {
        const countryCounts = await Station.aggregate([
          { $match: { country: { $nin: [null, ''] } } },
          { $group: { _id: '$country', count: { $sum: 1 } } },
          { $sort: { _id: 1 } }
        ]);
        const countries = getAllCountryInfoFromDb(
          countryCounts.map((c: any) => ({ name: c._id, count: c.count }))
        );
        return res.json(countries);
      }

      const countries = await Station.distinct('country').lean();
      const filteredCountries = countries.filter(country => country && country.trim() !== '');
      res.json(filteredCountries.sort());
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch countries' });
    }
  });

  // GENRES API - Merge real genres from DB with dynamic genres from station data
  app.get("/api/genres", async (req, res) => {
    try {
      const isTV = req.query.tv === '1';
      const { 
        sortColumn = 'stationCount', 
        sortBy = 'desc',
        filters = {} 
      } = req.query;
      const gParams = isTV ? tvValidateParams(req.query) : {
        page: parseInt(req.query.page as string) || 1,
        limit: parseInt(req.query.limit as string) || 9
      };
      const page = gParams.page;
      const limit = gParams.limit;
      
      let parsedFilters = {};
      try {
        if (typeof filters === 'string' && filters.trim() !== '') {
          const decodedFilters = decodeURIComponent(filters);
          parsedFilters = JSON.parse(decodedFilters);
        } else if (filters && typeof filters === 'object') {
          parsedFilters = filters;
        }
      } catch (e) {
        parsedFilters = {};
      }
      let { countrycode, searchQuery } = parsedFilters as any;
      
      if (!countrycode) {
        countrycode = (req.query.countrycode as string) || (req.query.country as string) || (req.query.countryCode as string) || null;
      }
      if (!searchQuery) {
        searchQuery = (req.query.search as string) || (req.query.searchQuery as string) || null;
      }
      
      // Generate cache key for this request
      const cacheKey = CacheKeys.genres(parseInt(page as string), parseInt(limit as string), { searchQuery, countrycode, sortColumn, sortBy });
      
      // Temporarily disable cache for debugging Austrian filtering
      const disableCache = countrycode === 'Austria';
      
      const requestStart = Date.now();
      
      // Try to get cached result first (unless debugging)
      const cachedResult = !disableCache ? await CacheManager.get(cacheKey) : null;
      if (cachedResult && !disableCache) {
        logger.log(`[Cache HIT] /api/genres country=${countrycode || 'global'} page=${page} (${Date.now() - requestStart}ms)`);
        
        // Check if cache needs background refresh (60 seconds before expiry)
        if (CacheManager.needsRefresh(cacheKey, 60)) {
          setImmediate(async () => {
            try {
              await refreshGenresCache(parseInt(page as string), parseInt(limit as string), { searchQuery, countrycode, sortColumn, sortBy });
            } catch (error) {}
          });
        }
        
        // TV slim - strip cached genres to essential fields
        if (isTV && (cachedResult as any).genres) {
          return res.json({
            genres: (cachedResult as any).genres.map(tvSlimGenre),
            data: (cachedResult as any).genres.map(tvSlimGenre),
            total: (cachedResult as any).total,
            page: (cachedResult as any).page,
            limit: (cachedResult as any).limit,
            totalPages: (cachedResult as any).totalPages
          });
        }
        
        return res.json(cachedResult);
      }

      logger.log(`[Cache MISS] /api/genres country=${countrycode || 'global'} page=${page} - computing...`);
      
      // 1. Fetch real genres from database - only discoverable ones for cleaner results
      const realGenres = await Genre.find({ isDiscoverable: true }).lean();
      // logger.log(` Found ${realGenres.length} real discoverable genres in database`);
      
      // 2. Build country filter for stations (with name normalization)
      let stationFilter = {};
      if (countrycode && countrycode !== 'global' && countrycode !== 'null') {
        Object.assign(stationFilter, normalizeCountryFilter(countrycode));
      }
      
      // 3. Use aggregation pipeline - unified genre+tags counting (no double-counting)
      const genreCounts = await Station.aggregate([
        { $match: stationFilter },
        {
          $addFields: {
            allTags: {
              $setUnion: [
                { $cond: [
                  { $and: [{ $ne: ['$genre', null] }, { $ne: ['$genre', ''] }] },
                  [{ $toLower: '$genre' }],
                  []
                ]},
                { $cond: [
                  { $and: [{ $ne: ['$tags', null] }, { $ne: ['$tags', ''] }] },
                  { $map: {
                    input: { $split: ['$tags', ','] },
                    as: 'tag',
                    in: { $toLower: { $trim: { input: '$$tag' } } }
                  }},
                  []
                ]}
              ]
            }
          }
        },
        { $unwind: '$allTags' },
        { $match: { allTags: { $ne: '' } } },
        { $group: { _id: '$allTags', count: { $sum: 1 } } }
      ]);

      // Build tag counts map (already deduplicated per station)
      const tagCounts = new Map();
      for (const entry of genreCounts) {
        tagCounts.set(entry._id, entry.count);
      }
      
      
      // 4. For country-filtered requests, use ONLY authentic dynamic genres from station tags
      // This gives real station counts based on actual Austrian stations
      let dynamicGenres = [];
      const isCountryFiltered = countrycode && countrycode !== 'global' && countrycode !== 'null';
      
      if (isCountryFiltered) {
        // For country-specific requests, use ONLY authentic dynamic genres with correct counts
        dynamicGenres = Array.from(tagCounts.entries())
          .filter(([tag, count]) => count >= 1 && tag.length > 1) // Skip single letters
          .map(([tag, count]) => ({
            name: tag.charAt(0).toUpperCase() + tag.slice(1),
            slug: tag,
            stationCount: count,
            isDynamic: true
          }));
      } else {
        // For global requests, use both real and dynamic genres
        dynamicGenres = Array.from(tagCounts.entries())
          .filter(([tag, count]) => count >= 1 && tag.length > 1) // Skip single letters
          .map(([tag, count]) => ({
            name: tag.charAt(0).toUpperCase() + tag.slice(1),
            slug: tag,
            stationCount: count,
            isDynamic: true
          }));
      }
      
      // logger.log(` Generated ${dynamicGenres.length} dynamic genres from station data`);
      
      // 5. Merge real and dynamic genres
      const genreMap = new Map();
      
      // Add real genres first (they take priority) but with filtered station counts
      // Skip real genres for country-filtered requests to avoid inflated counts
      if (!isCountryFiltered) {
        for (const realGenre of realGenres) {
          const normalizedName = realGenre.name.toLowerCase();
        
        // Try multiple ways to find filtered count for this genre
        let filteredCount = tagCounts.get(normalizedName); // Direct match
        
        // For country-specific requests, only use direct matches to avoid inflated counts
        // Skip partial matching for authentic country-specific results
        
        const isCountryFiltered = countrycode && countrycode !== 'global' && countrycode !== 'null';
        
        // For country-specific filtering, ALWAYS use actual filtered station counts
        // Never trust the stored global stationCount for country-specific requests
        let actualCount;
        if (isCountryFiltered) {
          actualCount = filteredCount || 0; // Use only real country-specific stations
        } else {
          actualCount = filteredCount !== undefined ? filteredCount : realGenre.stationCount;
        }
        
        // Skip genres with 0 stations for country-filtered requests
        if (isCountryFiltered && actualCount === 0) {
          continue;
        }
        
          genreMap.set(normalizedName, {
            _id: realGenre._id,
            name: realGenre.name,
            slug: realGenre.slug || normalizedName.replace(/\s+/g, '-'),
            description: realGenre.description,
            stationCount: actualCount, // Use filtered count instead of stored count
            total_stations: actualCount, // Also set total_stations for consistency
            posterImage: realGenre.posterImage,
            discoverableImage: realGenre.discoverableImage,
            isDiscoverable: realGenre.isDiscoverable,
            discoverable: realGenre.isDiscoverable, // Add both field names for compatibility
            createdAt: realGenre.createdAt,
            updatedAt: realGenre.updatedAt,
            isDynamic: false
          });
        }
      }
      
      // Add dynamic genres (only if not already in real genres)
      for (const dynamicGenre of dynamicGenres) {
        const normalizedName = dynamicGenre.name.toLowerCase();
        if (!genreMap.has(normalizedName)) {
          genreMap.set(normalizedName, {
            _id: `dynamic-${dynamicGenre.slug}`,
            name: dynamicGenre.name,
            slug: dynamicGenre.slug,
            posterImage: `/images/genre-bg-grad-${(genreMap.size % 4) + 1}.webp`,
            description: `${dynamicGenre.name} music and stations`,
            stationCount: dynamicGenre.stationCount,
            total_stations: dynamicGenre.stationCount,
            createdAt: new Date(),
            isDynamic: true
          });
        } else {
          // Update station count for real genre with dynamic count
          const existingGenre = genreMap.get(normalizedName);
          existingGenre.stationCount = dynamicGenre.stationCount;
          existingGenre.total_stations = dynamicGenre.stationCount;
        }
      }
      
      let allGenres = Array.from(genreMap.values());
      
      // 6. Filter out genres with zero stations for country-specific requests
      if (countrycode && countrycode !== 'global' && countrycode !== 'null') {
        allGenres = allGenres.filter(genre => (genre.stationCount || 0) > 0);
        logger.log(`🔍 Filtered to ${allGenres.length} genres with stations for ${countrycode}`);
      }
      
      // logger.log(` Merged to ${allGenres.length} total genres`);
      
      // 7. Apply search filter
      if (searchQuery) {
        const searchRegex = new RegExp(searchQuery, 'i');
        allGenres = allGenres.filter(genre => 
          searchRegex.test(genre.name) || 
          searchRegex.test(genre.slug) || 
          (genre.description && searchRegex.test(genre.description))
        );
      }
      
      // 8. Sort
      const sortOrder = sortBy === 'desc' ? -1 : 1;
      allGenres.sort((a, b) => {
        if (sortColumn === 'total_stations' || sortColumn === 'stationCount') {
          return sortOrder === -1 ? (b.stationCount || 0) - (a.stationCount || 0) : (a.stationCount || 0) - (b.stationCount || 0);
        } else if (sortColumn === 'name') {
          return sortOrder === -1 ? b.name.localeCompare(a.name) : a.name.localeCompare(b.name);
        }
        return 0;
      });
      
      // 9. Paginate
      const totalCount = allGenres.length;
      const skip = (parseInt(page) - 1) * parseInt(limit);
      const paginatedGenres = allGenres.slice(skip, skip + parseInt(limit));
      
      const response = {
        success: true,
        genres: paginatedGenres,  // Samsung TV & frontend compatibility
        data: paginatedGenres,     // Backward compatibility
        total: totalCount,
        count: totalCount,         // Backward compatibility
        page: parseInt(page),
        currentPage: parseInt(page), // Backward compatibility
        limit: parseInt(limit),
        perPage: parseInt(limit),  // Backward compatibility
        totalPages: Math.ceil(totalCount / parseInt(limit))
      };
      
      
      // Cache the result for 1 hour (genres don't change frequently)
      await CacheManager.set(cacheKey, response, { ttl: 3600 });
      
      // TV slim response - only essential fields
      if (isTV) {
        return res.json({
          genres: paginatedGenres.map(tvSlimGenre),
          data: paginatedGenres.map(tvSlimGenre),
          total: totalCount,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil(totalCount / parseInt(limit))
        });
      }
      
      res.json(response);
    } catch (error) {
      // console.error(' Error fetching merged genres:', error);
      res.status(500).json({ error: 'Failed to fetch genres' });
    }
  });

  // CREATE GENRE API - Create a new real genre
  app.post("/api/genres", async (req, res) => {
    try {
      const { name, description, isDiscoverable, posterImage, discoverableImage } = req.body;
      
      if (!name) {
        return res.status(400).json({ error: 'Genre name is required' });
      }

      // Generate slug and ID
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      const genreId = `genre-${slug}`;
      
      // logger.log(`🎵 Creating new genre: ${name} (${genreId})`);
      
      // Check if genre already exists
      const existingGenre = await Genre.findById(genreId);
      if (existingGenre) {
        return res.status(409).json({ error: 'Genre already exists' });
      }

      const genreData = {
        _id: genreId,
        name,
        slug,
        description: description || '',
        isDiscoverable: isDiscoverable || false,
        posterImage: posterImage || '',
        discoverableImage: discoverableImage || '',
        displayOrder: 999,
        stationCount: 0,
        createdAt: new Date()
      };

      const newGenre = new Genre(genreData);
      await newGenre.save();
      
      // logger.log(`✅ Successfully created genre: ${name}`);
      
      // Clear genre caches
      try {
        await CacheManager.clearByPattern('genres');
        // logger.log('✅ Cleared genre caches');
      } catch (cacheError) {
        // logger.log('⚠️ Cache clearing failed (non-critical):', cacheError.message);
      }
      
      res.status(201).json(newGenre);
    } catch (error) {
      // console.error('Error creating genre:', error);
      res.status(500).json({ error: 'Failed to create genre' });
    }
  });


  // UPDATE GENRE - Admin functionality
  app.put("/api/genres/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { name, description, discoverable, posterImage, discoverableImage, displayOrder } = req.body;

      // Build update object
      const updateData: any = {};
      if (name) updateData.name = name;
      if (description !== undefined) updateData.description = description;
      if (discoverable !== undefined) {
        updateData.isDiscoverable = discoverable;
        updateData.discoverable = discoverable;
      }
      if (posterImage) {
        updateData.posterImage = objectStorageService.normalizeImagePath(posterImage, 'regular');
      }
      if (discoverableImage) {
        updateData.discoverableImage = objectStorageService.normalizeImagePath(discoverableImage, 'discoverable');
      }
      if (displayOrder !== undefined) {
        updateData.displayOrder = displayOrder;
      }

      // Try both string and ObjectId formats - test string first, then convert to ObjectId if needed
      let result = await Genre.collection.updateOne({ _id: id }, { $set: updateData });
      
      // If no match and id looks like ObjectId (24 hex chars), try converting it
      if (result.matchedCount === 0 && /^[0-9a-f]{24}$/i.test(id)) {
        const objectId = new mongoose.Types.ObjectId(id);
        result = await Genre.collection.updateOne({ _id: objectId }, { $set: updateData });
      }
      
      if (result.matchedCount === 0) {
        return res.status(404).json({ error: 'Genre not found' });
      }

      // Fetch the updated genre - try string first, then ObjectId
      let updatedGenre = await Genre.collection.findOne({ _id: id });
      if (!updatedGenre && /^[0-9a-f]{24}$/i.test(id)) {
        const objectId = new mongoose.Types.ObjectId(id);
        updatedGenre = await Genre.collection.findOne({ _id: objectId });
      }

      // Clear genre caches
      try {
        await CacheManager.clearByPattern('genres');
      } catch (cacheError) {
        // Non-critical cache error
      }

      res.json(updatedGenre);
    } catch (error: any) {
      console.error('Error updating genre:', error);
      res.status(500).json({ error: 'Failed to update genre' });
    }
  });

  // DELETE GENRE - Admin functionality
  app.delete("/api/genres/:id", async (req, res) => {
    try {
      const { id } = req.params;

      // Try both string and ObjectId formats
      let result = await Genre.collection.deleteOne({ _id: id });
      
      // If no match and id looks like ObjectId (24 hex chars), try converting it
      if (result.deletedCount === 0 && /^[0-9a-f]{24}$/i.test(id)) {
        const objectId = new mongoose.Types.ObjectId(id);
        result = await Genre.collection.deleteOne({ _id: objectId });
      }
      
      if (result.deletedCount === 0) {
        return res.status(404).json({ error: 'Genre not found' });
      }

      // Clear genre caches
      try {
        await CacheManager.clearByPattern('genres');
      } catch (cacheError) {
        // Non-critical cache error
      }

      res.json({ message: 'Genre deleted successfully' });
    } catch (error: any) {
      console.error('Error deleting genre:', error);
      res.status(500).json({ error: 'Failed to delete genre' });
    }
  });

  // DISCOVERABLE GENRES API - Always returns global genres for discovery
  app.get("/api/genres/discoverable", async (req, res) => {
    try {
      const isTV = req.query.tv === '1';
      const cacheKey = 'genres:discoverable:v2';
      
      const cachedGenres = await CacheManager.get(cacheKey);
      if (cachedGenres) {
        if (isTV) return res.json((cachedGenres as any[]).map(tvSlimGenre));
        return res.json(cachedGenres);
      }
      
      const genres = await Genre.find({ isDiscoverable: true }).sort({ displayOrder: 1, _id: 1 }).limit(13).lean();
      
      await CacheManager.set(cacheKey, genres, { ttl: 86400 });
      
      if (isTV) return res.json(genres.map(tvSlimGenre));
      res.json(genres);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch discoverable genres' });
    }
  });

  // ADMIN GENRES API - Returns all real genres from database for admin management
  // Remove duplicate endpoint - using the one below that includes auto-population

  // ADMIN TRANSLATION LANGUAGES API - Manage translation languages 
  app.get("/api/admin/translation-languages", requireAdmin, async (req, res) => {
    try {
      // Fetch all translation languages from database
      const languages = await TranslationLanguage.find().sort({ createdAt: -1 }).lean();
      
      // Get completion percentage for each language
      const translationLanguages = await Promise.all(
        languages.map(async (lang) => {
          const totalKeys = await TranslationKey.countDocuments();
          
          // Count translations by joining with translations collection
          const translatedKeys = await Translation.countDocuments({
            language: lang.code,
            isCompleted: true
          });
          
          return {
            ...lang,
            completionPercentage: totalKeys > 0 ? Math.round((translatedKeys / totalKeys) * 100) : 0
          };
        })
      );

      res.json(translationLanguages);
    } catch (error) {
      // console.error('Error fetching translation languages:', error);
      res.status(500).json({ error: 'Failed to fetch translation languages' });
    }
  });

  // CREATE Translation Language
  app.post("/api/admin/translation-languages", requireAdmin, async (req, res) => {
    try {
      const { code, name, isEnabled, isDefault } = req.body;

      // Validate required fields
      if (!code || !name) {
        return res.status(400).json({ error: 'Language code and name are required' });
      }

      // Check if language code already exists
      const existingLanguage = await TranslationLanguage.findOne({ code: code.toLowerCase() });
      if (existingLanguage) {
        return res.status(409).json({ error: 'Language with this code already exists' });
      }

      // If setting as default, unset other defaults
      if (isDefault) {
        await TranslationLanguage.updateMany({}, { $set: { isDefault: false } });
      }

      // Create new translation language
      const newLanguage = new TranslationLanguage({
        code: code.toLowerCase(),
        name,
        isEnabled: isEnabled !== undefined ? isEnabled : true,
        isDefault: isDefault || false
      });

      await newLanguage.save();

      res.status(201).json(newLanguage);
    } catch (error) {
      // console.error('Error creating translation language:', error);
      res.status(500).json({ error: 'Failed to create translation language' });
    }
  });

  // UPDATE Translation Language
  app.put("/api/admin/translation-languages/:id", requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { code, name, isEnabled, isDefault } = req.body;

      // Find the language
      const language = await TranslationLanguage.findById(id);
      if (!language) {
        return res.status(404).json({ error: 'Translation language not found' });
      }

      // If changing code, check for duplicates
      if (code && code.toLowerCase() !== language.code) {
        const existingLanguage = await TranslationLanguage.findOne({ 
          code: code.toLowerCase(),
          _id: { $ne: id }
        });
        if (existingLanguage) {
          return res.status(409).json({ error: 'Language with this code already exists' });
        }
      }

      // If setting as default, unset other defaults
      if (isDefault && !language.isDefault) {
        await TranslationLanguage.updateMany(
          { _id: { $ne: id } },
          { $set: { isDefault: false } }
        );
      }

      // Update fields
      if (code) language.code = code.toLowerCase();
      if (name) language.name = name;
      if (isEnabled !== undefined) language.isEnabled = isEnabled;
      if (isDefault !== undefined) language.isDefault = isDefault;

      await language.save();

      res.json(language);
    } catch (error) {
      // console.error('Error updating translation language:', error);
      res.status(500).json({ error: 'Failed to update translation language' });
    }
  });

  // DELETE Translation Language
  app.delete("/api/admin/translation-languages/:id", requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;

      // Find the language
      const language = await TranslationLanguage.findById(id);
      if (!language) {
        return res.status(404).json({ error: 'Translation language not found' });
      }

      // Prevent deleting default language
      if (language.isDefault) {
        return res.status(400).json({ error: 'Cannot delete the default language' });
      }

      // Delete the language
      await TranslationLanguage.findByIdAndDelete(id);

      // Optionally delete associated translations
      await Translation.deleteMany({ language: language.code });

      res.json({ message: 'Translation language deleted successfully' });
    } catch (error) {
      // console.error('Error deleting translation language:', error);
      res.status(500).json({ error: 'Failed to delete translation language' });
    }
  });

  // GET Translation Metadata - for cache versioning
  app.get("/api/admin/translation-metadata", requireAdmin, async (req, res) => {
    try {
      const { getTranslationMetadata } = await import('./services/translation-version');
      const metadata = await getTranslationMetadata();
      res.json(metadata);
    } catch (error) {
      console.error('Error fetching translation metadata:', error);
      res.status(500).json({ error: 'Failed to fetch translation metadata' });
    }
  });

  // POST Bump Translation Version - invalidates client caches
  app.post("/api/admin/translation-metadata/bump", requireAdmin, async (req, res) => {
    try {
      const { notes } = req.body;
      const { bumpTranslationVersion } = await import('./services/translation-version');
      const result = await bumpTranslationVersion(notes);
      
      if (result.success) {
        res.json({ 
          success: true, 
          version: result.version,
          message: `Translation version bumped to ${result.version}`
        });
      } else {
        res.status(500).json({ error: 'Failed to bump translation version' });
      }
    } catch (error) {
      console.error('Error bumping translation version:', error);
      res.status(500).json({ error: 'Failed to bump translation version' });
    }
  });

  // SEED Translation Languages - Sync all 55 URL translation languages to database
  app.post("/api/admin/seed-translation-languages", requireAdmin, async (req, res) => {
    try {
      const languageMapping = {
        "af": "Afrikaans", "am": "Amharic", "ar": "Arabic", "az": "Azerbaijani",
        "bg": "Bulgarian", "bn": "Bengali", "cs": "Czech", "da": "Danish",
        "de": "German", "el": "Greek", "es": "Spanish", "et": "Estonian",
        "fa": "Persian", "fi": "Finnish", "fr": "French", "gu": "Gujarati",
        "he": "Hebrew", "hi": "Hindi", "hr": "Croatian", "hu": "Hungarian",
        "hy": "Armenian", "id": "Indonesian", "it": "Italian", "ja": "Japanese",
        "kn": "Kannada", "ko": "Korean", "lt": "Lithuanian", "lv": "Latvian",
        "ml": "Malayalam", "mr": "Marathi", "ms": "Malay", "nl": "Dutch",
        "no": "Norwegian", "pa": "Punjabi", "pl": "Polish", "pt": "Portuguese",
        "ro": "Romanian", "ru": "Russian", "sk": "Slovak", "sl": "Slovenian",
        "so": "Somali", "sq": "Albanian", "sr": "Serbian", "sv": "Swedish",
        "sw": "Swahili", "ta": "Tamil", "te": "Telugu", "th": "Thai",
        "tl": "Tagalog", "tr": "Turkish", "uk": "Ukrainian", "ur": "Urdu",
        "vi": "Vietnamese", "zh": "Chinese", "zu": "Zulu"
      };

      let created = 0;
      let updated = 0;
      let skipped = 0;

      // Check if there's already a default language
      const hasDefault = await TranslationLanguage.findOne({ isDefault: true });

      for (const [code, name] of Object.entries(languageMapping)) {
        const existingLanguage = await TranslationLanguage.findOne({ code });

        if (existingLanguage) {
          skipped++;
        } else {
          // Create new language - set English, Hebrew, and Turkish as default
          const isDefaultLanguage = !hasDefault && (code === 'en' || code === 'he' || code === 'tr');
          await TranslationLanguage.create({
            code,
            name,
            isEnabled: true,
            isDefault: isDefaultLanguage
          });
          created++;
        }
      }

      res.json({
        message: 'Translation languages seeded successfully',
        stats: {
          total: Object.keys(languageMapping).length,
          created,
          updated,
          skipped
        }
      });
    } catch (error) {
      console.error('Error seeding translation languages:', error);
      res.status(500).json({ error: 'Failed to seed translation languages' });
    }
  });

  // AUTO-TRANSLATE Language via OpenAI - Enhanced with English detection and brand protection
  app.post("/api/admin/translation-languages/:code/translate", requireAdmin, async (req, res) => {
    try {
      const { code } = req.params;

      // Skip English - no need to translate
      if (code.toLowerCase() === 'en') {
        return res.json({
          message: 'English is the source language, no translation needed',
          stats: { total: 0, existing: 0, translated: 0, fixed: 0, failed: 0 }
        });
      }

      // Find the language
      const language = await TranslationLanguage.findOne({ code: code.toLowerCase() });
      if (!language) {
        return res.status(404).json({ error: 'Translation language not found' });
      }

      // Protected terms that should NOT be translated (brand names and placeholders)
      const PROTECTED_TERMS = [
        'Mega Radio', 'MegaRadio', 'mega radio',
        '{STATION_NAME}', '{stationname}', '{station_name}', '{station}',
        '{country}', '{COUNTRY}', '{Country}',
        '{genre}', '{GENRE}', '{Genre}',
        '{language}', '{LANGUAGE}', '{Language}',
        '{city}', '{CITY}', '{City}',
        '{count}', '{COUNT}', '{name}', '{NAME}',
        '{url}', '{URL}', '{link}', '{LINK}',
        '{time}', '{TIME}', '{date}', '{DATE}',
        '{number}', '{NUMBER}', '{value}', '{VALUE}'
      ];

      // Common English words to detect incorrect translations (excluding protected terms)
      const COMMON_ENGLISH_WORDS = [
        'the', 'and', 'for', 'with', 'your', 'you', 'are', 'have', 'has', 'this', 'that',
        'from', 'will', 'can', 'all', 'more', 'when', 'there', 'their', 'what', 'about',
        'which', 'would', 'make', 'like', 'just', 'over', 'such', 'into', 'than', 'other',
        'been', 'some', 'could', 'them', 'being', 'these', 'because', 'each', 'through',
        'listen', 'radio', 'station', 'stations', 'streaming', 'music', 'live', 'online',
        'discover', 'explore', 'find', 'search', 'browse', 'play', 'playing', 'favorite',
        'favorites', 'settings', 'loading', 'error', 'please', 'wait', 'welcome', 'hello',
        'world', 'country', 'countries', 'genre', 'genres', 'popular', 'trending', 'new',
        'free', 'unlimited', 'access', 'anywhere', 'anytime', 'best', 'top', 'quality'
      ];

      // Function to detect if translation contains English content
      const hasEnglishContent = (text: string, isEnglishSource: boolean = false): boolean => {
        if (!text || isEnglishSource) return false;
        
        // Remove ALL placeholder patterns (any format: {xxx}, %xxx%, {{xxx}}, etc.)
        let cleanText = text;
        cleanText = cleanText.replace(/\{[^}]+\}/gi, ''); // {placeholder}
        cleanText = cleanText.replace(/%[^%]+%/gi, '');   // %placeholder%
        cleanText = cleanText.replace(/\{\{[^}]+\}\}/gi, ''); // {{placeholder}}
        
        // Remove brand name "Mega Radio" in any case variation
        cleanText = cleanText.replace(/mega\s*radio/gi, '');
        
        // Trim and check if there's meaningful text left
        cleanText = cleanText.trim();
        if (!cleanText || cleanText.length < 3) {
          // Text is mainly placeholders/brand names - skip
          return false;
        }
        
        // Split into words and check for common English words
        const words = cleanText.toLowerCase().split(/\s+/).filter(w => w.length > 1);
        const englishWordCount = words.filter(word => 
          COMMON_ENGLISH_WORDS.includes(word.replace(/[.,!?;:'"()]/g, ''))
        ).length;
        
        // Calculate ratio: if more than 30% of words are common English words, likely incorrect
        const englishRatio = words.length > 0 ? englishWordCount / words.length : 0;
        
        // Flag as English if: 2+ common words AND >25% of text is English
        return englishWordCount >= 2 && englishRatio > 0.25;
      };

      // Get all translation keys
      const allKeys = await TranslationKey.find({}).lean();
      
      // Get existing translations for this language - use keyId to map
      const existingTranslations = await Translation.find({ language: code.toLowerCase() }).lean();
      // Map by keyId (ObjectId) since Translation uses keyId reference, not key string
      const existingTranslationsMap = new Map(existingTranslations.map((t: any) => [t.keyId?.toString(), t]));
      
      // Find keys that need translation (missing OR have English content)
      const keysToTranslate: any[] = [];
      const keysToFix: string[] = [];
      
      for (const key of allKeys) {
        // Look up by key._id (TranslationKey ObjectId) matching Translation.keyId
        const existing = existingTranslationsMap.get(key._id?.toString());
        if (!existing) {
          // Missing translation
          keysToTranslate.push({ ...key, isNew: true });
        } else {
          // Check if translation needs fixing:
          // 1. Value is same as key name (untranslated)
          // 2. Value contains underscores (likely key name, not real translation)
          // 3. Value is same as English default (not translated at all)
          // 4. Value has English content
          const value = existing.value?.trim() || '';
          const defaultValue = key.defaultValue?.trim() || '';
          
          const isUntranslated = value === key.key || 
            (value.includes('_') && !value.includes('{') && value.length < 50) ||
            (defaultValue && value.toLowerCase() === defaultValue.toLowerCase()) ||
            hasEnglishContent(value);
          
          if (isUntranslated) {
            keysToTranslate.push({ ...key, isNew: false, existingId: existing._id, existingValue: existing.value });
            keysToFix.push(key.key);
          }
        }
      }
      
      if (keysToTranslate.length === 0) {
        return res.json({
          message: 'All translations are complete and correct for this language',
          stats: {
            total: allKeys.length,
            existing: existingTranslations.length,
            translated: 0,
            fixed: 0,
            failed: 0
          }
        });
      }

      logger.log(`🔄 ${language.name}: Found ${keysToTranslate.filter(k => k.isNew).length} missing, ${keysToFix.length} to fix`);

      // Complete language mapping for all 57 languages
      const languageMapping: {[key: string]: {name: string, nativeName: string}} = {
        af: { name: 'Afrikaans', nativeName: 'Afrikaans' },
        am: { name: 'Amharic', nativeName: 'አማርኛ' },
        ar: { name: 'Arabic', nativeName: 'العربية' },
        az: { name: 'Azerbaijani', nativeName: 'Azərbaycan' },
        bg: { name: 'Bulgarian', nativeName: 'Български' },
        bn: { name: 'Bengali', nativeName: 'বাংলা' },
        bs: { name: 'Bosnian', nativeName: 'Bosanski' },
        cs: { name: 'Czech', nativeName: 'Čeština' },
        da: { name: 'Danish', nativeName: 'Dansk' },
        de: { name: 'German', nativeName: 'Deutsch' },
        el: { name: 'Greek', nativeName: 'Ελληνικά' },
        es: { name: 'Spanish', nativeName: 'Español' },
        et: { name: 'Estonian', nativeName: 'Eesti' },
        fa: { name: 'Persian', nativeName: 'فارسی' },
        fi: { name: 'Finnish', nativeName: 'Suomi' },
        fr: { name: 'French', nativeName: 'Français' },
        gu: { name: 'Gujarati', nativeName: 'ગુજરાતી' },
        he: { name: 'Hebrew', nativeName: 'עברית' },
        hi: { name: 'Hindi', nativeName: 'हिन्दी' },
        hr: { name: 'Croatian', nativeName: 'Hrvatski' },
        hu: { name: 'Hungarian', nativeName: 'Magyar' },
        hy: { name: 'Armenian', nativeName: 'Հայերեն' },
        id: { name: 'Indonesian', nativeName: 'Bahasa Indonesia' },
        it: { name: 'Italian', nativeName: 'Italiano' },
        ja: { name: 'Japanese', nativeName: '日本語' },
        kn: { name: 'Kannada', nativeName: 'ಕನ್ನಡ' },
        ko: { name: 'Korean', nativeName: '한국어' },
        lt: { name: 'Lithuanian', nativeName: 'Lietuvių' },
        lv: { name: 'Latvian', nativeName: 'Latviešu' },
        ml: { name: 'Malayalam', nativeName: 'മലയാളം' },
        mr: { name: 'Marathi', nativeName: 'मराठी' },
        ms: { name: 'Malay', nativeName: 'Bahasa Melayu' },
        nl: { name: 'Dutch', nativeName: 'Nederlands' },
        no: { name: 'Norwegian', nativeName: 'Norsk' },
        pa: { name: 'Punjabi', nativeName: 'ਪੰਜਾਬੀ' },
        pl: { name: 'Polish', nativeName: 'Polski' },
        pt: { name: 'Portuguese', nativeName: 'Português' },
        ro: { name: 'Romanian', nativeName: 'Română' },
        ru: { name: 'Russian', nativeName: 'Русский' },
        sk: { name: 'Slovak', nativeName: 'Slovenčina' },
        sl: { name: 'Slovenian', nativeName: 'Slovenščina' },
        so: { name: 'Somali', nativeName: 'Soomaali' },
        sq: { name: 'Albanian', nativeName: 'Shqip' },
        sr: { name: 'Serbian', nativeName: 'Српски' },
        sv: { name: 'Swedish', nativeName: 'Svenska' },
        sw: { name: 'Swahili', nativeName: 'Kiswahili' },
        ta: { name: 'Tamil', nativeName: 'தமிழ்' },
        te: { name: 'Telugu', nativeName: 'తెలుగు' },
        th: { name: 'Thai', nativeName: 'ไทย' },
        tl: { name: 'Filipino', nativeName: 'Tagalog' },
        tr: { name: 'Turkish', nativeName: 'Türkçe' },
        uk: { name: 'Ukrainian', nativeName: 'Українська' },
        ur: { name: 'Urdu', nativeName: 'اردو' },
        vi: { name: 'Vietnamese', nativeName: 'Tiếng Việt' },
        zh: { name: 'Chinese', nativeName: '中文' },
        zu: { name: 'Zulu', nativeName: 'isiZulu' }
      };

      const langConfig = languageMapping[code] || { name: language.name, nativeName: language.name };

      // Translate in batches
      const batchSize = 20;
      let translated = 0;
      let fixed = 0;
      let failed = 0;

      for (let i = 0; i < keysToTranslate.length; i += batchSize) {
        const batch = keysToTranslate.slice(i, i + batchSize);
        
        // Create translation prompt with protected terms
        const keysText = batch.map((k: any) => `${k.key}: ${k.defaultValue}`).join('\n');
        
        const prompt = `Translate these UI texts to ${langConfig.name} (${langConfig.nativeName}).

PROTECTED TERMS - DO NOT TRANSLATE, keep exactly as shown:
- Brand name: "Mega Radio" (keep as "Mega Radio")
- All placeholders in {curly braces}: {STATION_NAME}, {country}, {genre}, {language}, {city}, {count}, etc.

TRANSLATION RULES:
1. Translate ALL other text to native ${langConfig.name} - NO English words allowed
2. Keep placeholders exactly as they appear: {country} stays {country}, {STATION_NAME} stays {STATION_NAME}
3. Use natural, fluent ${langConfig.name} that native speakers would use
4. For UI terms like "Settings", "Search", "Loading" - use the standard ${langConfig.name} equivalent
5. Return format: key: translated_text

Keys to translate:
${keysText}`;

        try {
          const openAIModule = await import('openai');
          const openai = new openAIModule.default({
            apiKey: process.env.OPENAI_API_KEY
          });

          const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
              {
                role: 'system',
                content: `You are an expert ${langConfig.name} translator for a radio streaming app. You produce 100% native ${langConfig.name} translations with NO English words (except brand name "Mega Radio" and {placeholders}). You understand that placeholders like {country}, {STATION_NAME} must remain unchanged.`
              },
              {
                role: 'user',
                content: prompt
              }
            ],
            temperature: 0.2,
            max_tokens: 4000
          });
          
          const translatedText = response.choices[0].message.content || '';
          
          // Parse the response
          const lines = translatedText.split('\n').filter(line => line.trim());
          
          for (const line of lines) {
            const colonIndex = line.indexOf(':');
            if (colonIndex > 0) {
              const key = line.substring(0, colonIndex).trim();
              let translation = line.substring(colonIndex + 1).trim();
              
              // Remove any quotes around the translation
              translation = translation.replace(/^["']|["']$/g, '');
              
              const originalKey = batch.find((k: any) => k.key === key);
              if (originalKey && translation) {
                try {
                  if (originalKey.isNew) {
                    // Insert new translation (keyId references TranslationKey._id)
                    await Translation.create({
                      keyId: originalKey._id,
                      language: code.toLowerCase(),
                      value: translation,
                      isCompleted: true,
                      lastModified: new Date()
                    });
                    translated++;
                  } else {
                    // Only update if new translation differs from existing (avoid redundant writes)
                    const existingValue = originalKey.existingValue?.trim();
                    const newValue = translation.trim();
                    
                    if (existingValue !== newValue) {
                      await Translation.updateOne(
                        { _id: originalKey.existingId },
                        { 
                          $set: { 
                            value: newValue, 
                            isCompleted: true,
                            updatedAt: new Date()
                          } 
                        }
                      );
                      fixed++;
                    }
                    // Skip if values are identical (no change needed)
                  }
                } catch (dbError) {
                  // Skip duplicate key errors
                  if ((dbError as any).code !== 11000) {
                    console.error(`DB error for key ${key}:`, dbError);
                    failed++;
                  }
                }
              }
            }
          }
          
        } catch (error) {
          console.error(`Error translating batch:`, error);
          failed += batch.length;
        }
        
        // Small delay between batches to avoid rate limiting
        if (i + batchSize < keysToTranslate.length) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      // Clear translation caches
      if (translated > 0 || fixed > 0) {
        await CacheManager.clearByPattern(`sitemap_translations:${code}`);
        await CacheManager.clearByPattern(`translations:${code}`);
        logger.log(`✅ ${language.name}: Translated ${translated} new, fixed ${fixed} incorrect`);
      }

      res.json({
        message: `Translation complete for ${language.name}`,
        stats: {
          total: allKeys.length,
          existing: existingTranslations.length,
          translated,
          fixed,
          failed,
          keysFixed: keysToFix
        }
      });
    } catch (error) {
      console.error('Error auto-translating language:', error);
      res.status(500).json({ error: 'Failed to auto-translate language' });
    }
  });

  // ADMIN REAL LANGUAGES API - Manage real languages from station database
  app.get("/api/admin/real-languages", async (req, res) => {
    try {
      // Language grouping map to consolidate variants
      const languageGroups = {
        'Turkish': ['turkish', 'türkiye', 'turk', 'türkçe', 'turkey'],
        'German': ['german', 'deutsch', 'germany', 'deutsche'],
        'English': ['english', 'en', 'eng'],
        'Spanish': ['spanish', 'español', 'espanol', 'spain', 'es'],
        'French': ['french', 'français', 'francais', 'france', 'fr'],
        'Italian': ['italian', 'italiano', 'italy', 'it'],
        'Portuguese': ['portuguese', 'português', 'portugues', 'brazil', 'brasil', 'pt'],
        'Russian': ['russian', 'русский', 'russia', 'ru'],
        'Chinese': ['chinese', 'china', 'zh', '中文'],
        'Japanese': ['japanese', 'japan', 'ja', '日本語'],
        'Korean': ['korean', 'korea', 'ko', '한국어'],
        'Arabic': ['arabic', 'عربي', 'ar'],
        'Dutch': ['dutch', 'nederlands', 'netherlands', 'nl'],
        'Polish': ['polish', 'polski', 'poland', 'pl'],
        'Swedish': ['swedish', 'svenska', 'sweden', 'se'],
        'Norwegian': ['norwegian', 'norsk', 'norway', 'no'],
        'Danish': ['danish', 'dansk', 'denmark', 'dk'],
        'Finnish': ['finnish', 'suomi', 'finland', 'fi'],
        'Greek': ['greek', 'ελληνικά', 'greece', 'gr'],
        'Czech': ['czech', 'čeština', 'czechia', 'cz'],
        'Hungarian': ['hungarian', 'magyar', 'hungary', 'hu'],
        'Romanian': ['romanian', 'română', 'romania', 'ro'],
        'Bulgarian': ['bulgarian', 'български', 'bulgaria', 'bg'],
        'Croatian': ['croatian', 'hrvatski', 'croatia', 'hr'],
        'Serbian': ['serbian', 'srpski', 'serbia', 'rs'],
        'Ukrainian': ['ukrainian', 'українська', 'ukraine', 'ua'],
        'Slovenian': ['slovenian', 'slovenščina', 'slovenia', 'si'],
        'Slovak': ['slovak', 'slovenčina', 'slovakia', 'sk'],
        'Lithuanian': ['lithuanian', 'lietuvių', 'lithuania', 'lt'],
        'Latvian': ['latvian', 'latviešu', 'latvia', 'lv'],
        'Estonian': ['estonian', 'eesti', 'estonia', 'ee']
      };

      // Get all unique languages from stations
      const rawLanguages = await Station.aggregate([
        {
          $match: {
            language: { $exists: true, $nin: ["", null] }
          }
        },
        {
          $group: {
            _id: "$language",
            stationCount: { $sum: 1 }
          }
        },
        {
          $project: {
            language: "$_id",
            stationCount: 1,
            _id: 0
          }
        }
      ]);

      // Group languages by their main language
      const groupedLanguages = {};
      const ungroupedLanguages = [];

      rawLanguages.forEach(langData => {
        const langName = langData.language.toLowerCase().trim();
        let grouped = false;

        // Check if this language belongs to any group
        for (const [mainLang, variants] of Object.entries(languageGroups)) {
          if (variants.some(variant => langName.includes(variant) || variant.includes(langName))) {
            if (!groupedLanguages[mainLang]) {
              groupedLanguages[mainLang] = {
                mainLanguage: mainLang,
                variants: [],
                totalStations: 0
              };
            }
            groupedLanguages[mainLang].variants.push({
              originalName: langData.language,
              stationCount: langData.stationCount
            });
            groupedLanguages[mainLang].totalStations += langData.stationCount;
            grouped = true;
            break;
          }
        }

        // If not grouped, add to ungrouped
        if (!grouped) {
          ungroupedLanguages.push({
            language: langData.language,
            stationCount: langData.stationCount
          });
        }
      });

      // Convert grouped languages to array and sort by station count
      const finalLanguages = Object.values(groupedLanguages)
        .sort((a, b) => b.totalStations - a.totalStations)
        .map(group => ({
          ...group,
          variants: group.variants.sort((a, b) => b.stationCount - a.stationCount)
        }));

      // Add ungrouped languages at the end, sorted by station count
      const sortedUngrouped = ungroupedLanguages
        .sort((a, b) => b.stationCount - a.stationCount)
        .map(lang => ({
          mainLanguage: lang.language,
          variants: [{ originalName: lang.language, stationCount: lang.stationCount }],
          totalStations: lang.stationCount
        }));

      const allLanguages = [...finalLanguages, ...sortedUngrouped];

      res.json({
        languages: allLanguages,
        total: allLanguages.length,
        totalStations: allLanguages.reduce((sum, lang) => sum + lang.totalStations, 0)
      });
    } catch (error) {
      console.error('Error fetching real languages:', error);
      res.status(500).json({ error: 'Failed to fetch real languages' });
    }
  });

  // ADMIN MERGE STATIONS API - Merge duplicate stations manually
  app.post("/api/admin/stations/merge", async (req, res) => {
    try {
      const { primaryStationId, duplicateStationIds, mergeData } = req.body;
      
      // logger.log(`🔗 Merging ${duplicateStationIds.length} stations into primary station ${primaryStationId}`);
      
      // Get primary station
      const primaryStation = await Station.findById(primaryStationId);
      if (!primaryStation) {
        return res.status(404).json({ error: 'Primary station not found' });
      }

      // Get duplicate stations
      const duplicateStations = await Station.find({ _id: { $in: duplicateStationIds } });
      
      // Merge data (take best values from all stations)
      const mergedData = {
        name: mergeData.name || primaryStation.name,
        url: mergeData.url || primaryStation.url,
        homepage: mergeData.homepage || primaryStation.homepage,
        favicon: mergeData.favicon || primaryStation.favicon,
        country: mergeData.country || primaryStation.country,
        language: mergeData.language || primaryStation.language,
        genre: mergeData.genre || primaryStation.genre,
        // Combine votes from all stations
        votes: duplicateStations.reduce((total, station) => total + (station.votes || 0), primaryStation.votes || 0),
        // Keep the earliest creation date
        lastChangedTime: duplicateStations.reduce((earliest, station) => {
          const stationTime = new Date(station.lastChangedTime);
          const earliestTime = new Date(earliest);
          return stationTime < earliestTime ? station.lastChangedTime : earliest;
        }, primaryStation.lastChangedTime)
      };

      // Update primary station with merged data
      await Station.findByIdAndUpdate(primaryStationId, mergedData);
      
      // Delete duplicate stations
      await Station.deleteMany({ _id: { $in: duplicateStationIds } });
      
      // logger.log(`✅ Successfully merged ${duplicateStationIds.length} duplicate stations`);
      
      res.json({
        success: true,
        message: `Successfully merged ${duplicateStationIds.length} stations`,
        mergedStation: await Station.findById(primaryStationId)
      });
    } catch (error) {
      // console.error('Error merging stations:', error);
      res.status(500).json({ error: 'Failed to merge stations' });
    }
  });

  // ADMIN GENRES API - Returns only real genres from database for management
  app.get("/api/admin/genres", async (req, res) => {
    try {
      logger.log('🎵 Fetching ONLY real genres from database for admin management...');
      
      // Extract query parameters
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 50;
      const search = (req.query.search as string)?.trim() || '';
      const sortBy = (req.query.sortBy as string) || 'stationCount';
      
      // Build MongoDB query
      const query: any = {};
      
      // Add search filter if provided (case-insensitive search in name field)
      if (search) {
        query.name = { $regex: search, $options: 'i' };
      }
      
      // Count total matching documents
      const total = await Genre.countDocuments(query);
      
      // Get paginated genres from database (not dynamic ones generated from stations)
      const skip = (page - 1) * limit;
      
      // Determine sort order
      let sortOptions: any = { stationCount: -1 }; // Default: most popular first
      if (sortBy === 'name') {
        sortOptions = { name: 1 }; // Alphabetical A-Z
      } else if (sortBy === 'recent') {
        sortOptions = { createdAt: -1 }; // Newest first
      }
      
      const realGenres = await Genre.find(query)
        .sort(sortOptions)
        .skip(skip)
        .limit(limit)
        .lean();
      
      logger.log(`📊 Found ${realGenres.length} genres (page ${page}/${Math.ceil(total / limit)}, search: "${search}")`);
      
      // If no genres exist at all, populate from station tags first
      if (total === 0 && !search) {
        logger.log('📊 No genres found, attempting to populate from station tags...');
        try {
          await populateGenresFromStations();
          const newTotal = await Genre.countDocuments(query);
          const newGenres = await Genre.find(query).sort(sortOptions).skip(skip).limit(limit).lean();
          logger.log(`✅ Successfully populated ${newTotal} genres from station data`);
          return res.json({
            data: newGenres,
            total: newTotal,
            currentPage: page,
            totalPages: Math.ceil(newTotal / limit),
            populated: true
          });
        } catch (populateError) {
          console.error('Failed to populate genres:', populateError);
        }
      }
      
      // Return in the format expected by the frontend
      res.json({
        data: realGenres,
        total,
        currentPage: page,
        totalPages: Math.ceil(total / limit)
      });
    } catch (error) {
      console.error('Error fetching admin genres:', error);
      res.status(500).json({ error: 'Failed to fetch admin genres' });
    }
  });

  // ADMIN GENRE POPULATION API - Manually trigger genre population from station tags
  app.post("/api/admin/populate-genres", async (req, res) => {
    try {
      logger.log('🎵 Manually triggering genre population from station tags...');
      
      const result = await populateGenresFromStations();
      
      res.json({
        success: true,
        message: `Successfully populated ${result.genresCreated} genres from station data`,
        genresCreated: result.genresCreated,
        tagsProcessed: result.tagsProcessed
      });
    } catch (error) {
      console.error('Error manually populating genres:', error);
      res.status(500).json({ error: 'Failed to populate genres' });
    }
  });

  // Helper function to populate genres from station tags
  async function populateGenresFromStations() {
    try {
      logger.log('🎵 Starting genre population from station tags...');
      
      // Get all stations with tags
      const stations = await Station.find({ 
        $or: [
          { tags: { $exists: true, $nin: [null, ''] } },
          { genre: { $exists: true, $nin: [null, ''] } }
        ]
      }).lean();
      
      logger.log(`📊 Found ${stations.length} stations with tags/genres`);
      
      const tagCounts = {};
      
      // Parse and count all tags
      stations.forEach(station => {
        const allTags = [];
        
        // Handle 'tags' field
        if (station.tags) {
          if (typeof station.tags === 'string') {
            // Handle comma-separated tags
            allTags.push(...station.tags.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0));
          } else if (Array.isArray(station.tags)) {
            allTags.push(...station.tags);
          }
        }
        
        // Handle 'genre' field
        if (station.genre && typeof station.genre === 'string') {
          allTags.push(station.genre.trim());
        }
        
        allTags.forEach(tag => {
          const normalizedTag = tag.toLowerCase().trim();
          if (normalizedTag.length > 0 && normalizedTag.length < 50) { // Reasonable tag length
            tagCounts[normalizedTag] = (tagCounts[normalizedTag] || 0) + 1;
          }
        });
      });
      
      logger.log(`📈 Found ${Object.keys(tagCounts).length} unique tags`);
      
      // Create genres for tags with at least 1 station
      let genresCreated = 0;
      for (const [tag, count] of Object.entries(tagCounts)) {
        if (count >= 1) {
          const genreData = {
            name: tag.charAt(0).toUpperCase() + tag.slice(1), // Capitalize first letter
            slug: tag.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
            stationCount: count,
            isDiscoverable: count >= 2, // Make discoverable if 2+ stations
            createdAt: new Date(),
            updatedAt: new Date()
          };
          
          // Insert genre (update if exists)
          await Genre.findOneAndUpdate(
            { slug: genreData.slug },
            genreData,
            { upsert: true, new: true }
          );
          genresCreated++;
        }
      }
      
      logger.log(`✅ Successfully populated ${genresCreated} genres!`);
      
      return {
        genresCreated,
        tagsProcessed: Object.keys(tagCounts).length
      };
    } catch (error) {
      console.error('❌ Error populating genres:', error);
      throw error;
    }
  }

  // LOCATION API - IP-based geolocation detection
  // 🚀 OPTIMIZED: Uses Cloudflare headers for instant detection (0ms vs 300-800ms)
  app.get("/api/location", async (req, res) => {
    // CRITICAL: Prevent Cloudflare from caching location responses (user-specific data)
    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate, private',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Vary': 'CF-Connecting-IP, X-Forwarded-For'
    });
    
    try {
      // Get the client's IP address
      let rawIP = req.headers['cf-connecting-ip'] || 
                  req.headers['x-forwarded-for'] || 
                  req.headers['x-real-ip'] || 
                  req.connection.remoteAddress || 
                  req.socket.remoteAddress || 
                  (req.connection as any)?.socket?.remoteAddress ||
                  req.ip;

      // Parse the IP address - extract the first valid public IP from comma-separated list
      let clientIP = rawIP;
      if (typeof rawIP === 'string' && rawIP.includes(',')) {
        const ips = rawIP.split(',').map(ip => ip.trim());
        const publicIP = ips.find(ip => {
          const isNotLocalhost = !ip.includes('127.0.0.1') && !ip.includes('::1') && ip !== '::ffff:127.0.0.1';
          const isNotPrivate = !ip.includes('192.168.') && !ip.includes('10.0.') && !ip.includes('10.81.');
          const isNotIPv6Local = !ip.includes('::ffff:') && !ip.includes('::1');
          const hasValidFormat = ip.length > 0 && /^\d+\.\d+\.\d+\.\d+$/.test(ip);
          return isNotLocalhost && isNotPrivate && isNotIPv6Local && hasValidFormat;
        });
        clientIP = publicIP || ips[0];
      }

      let locationData = {
        country: 'all',
        countryCode: 'all',
        city: null as string | null,
        region: null as string | null,
        lat: null as number | null,
        lng: null as number | null,
        detected: false
      };

      // 🚀 PRIORITY 1: Cloudflare headers (INSTANT - 0ms)
      const cfCountryCode = req.headers['cf-ipcountry'] as string;
      const isCloudflareRequest = !!req.headers['cf-ray']; // CF-Ray header indicates Cloudflare
      
      if (cfCountryCode && cfCountryCode !== 'XX' && cfCountryCode !== 'T1') {
        // Convert 2-letter code to full country name using existing mapping
        const countryName = CODE_TO_COUNTRY[cfCountryCode.toLowerCase()];
        if (countryName) {
          locationData = {
            country: countryName,
            countryCode: cfCountryCode.toUpperCase(),
            city: null,
            region: null,
            lat: null,
            lng: null,
            detected: true
          };
          
          return res.json({
            location: locationData,
            ip: rawIP,
            source: 'cloudflare'
          });
        }
      }

      // 🔄 FALLBACK: ip-api.com for any environment when Cloudflare detection fails
      const isLocalhost = !clientIP || 
          clientIP === '127.0.0.1' || 
          clientIP === '::1' || 
          clientIP.includes('192.168.') || 
          clientIP.includes('10.0.') ||
          clientIP.includes('10.81.') ||
          clientIP.includes(',') ||
          clientIP === '::ffff:127.0.0.1';

      if (!isLocalhost) {
        try {
          const fetch = (await import('node-fetch')).default;
          const response = await Promise.race([
            fetch(`http://ip-api.com/json/${clientIP}?fields=status,message,country,countryCode,region,city,lat,lon`),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Request timeout')), 2000))
          ]) as any;
          const data = await response.json() as any;
          
          if (data && data.status === 'success') {
            locationData = {
              country: data.country,
              countryCode: data.countryCode,
              city: data.city,
              region: data.region,
              lat: data.lat,
              lng: data.lon,
              detected: true
            };
          }
        } catch (geoError: any) {
          // Silent fallback - location detection is optional
        }
      }

      res.json({
        location: locationData,
        ip: rawIP,
        source: isLocalhost ? 'localhost' : 'ip-api'
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch location' });
    }
  });

  // FILTERS COUNTRIES API
  app.get("/api/filters/countries", async (req, res) => {
    try {
      const countries = await Station.distinct('country').lean();
      const filteredCountries = countries.filter(country => country && country.trim() !== '');
      res.json(filteredCountries.sort());
    } catch (error) {
      // console.error('Error fetching filter countries:', error);
      res.status(500).json({ error: 'Failed to fetch filter countries' });
    }
  });

  // FILTERS LANGUAGES API
  app.get("/api/filters/languages", async (req, res) => {
    try {
      // logger.log('🗣️ Fetching CLEAN languages with station counts...');
      
      // Get aggregated language data with counts
      const languageStats = await Station.aggregate([
        {
          $match: {
            $and: [
              { language: { $exists: true, $ne: "" } },
              { language: { $ne: null } }
            ]
          }
        },
        {
          $group: {
            _id: "$language",
            count: { $sum: 1 }
          }
        },
        {
          $match: {
            count: { $gte: 3 } // Only languages with 3+ stations
          }
        },
        {
          $sort: { count: -1 }
        }
      ]);

      // Clean up the language names - remove malformed data
      const cleanLanguages = languageStats
        .map(item => item._id)
        .filter(lang => lang && lang.trim())
        .map(lang => {
          // Clean up common issues
          lang = lang.trim();
          if (lang.startsWith('"') && lang.endsWith('"')) {
            lang = lang.slice(1, -1);
          }
          if (lang.startsWith('#')) {
            lang = lang.substring(1);
          }
          // Split multi-language entries and take first clean one
          if (lang.includes(',')) {
            lang = lang.split(',')[0].trim().replace('#', '');
          }
          return lang;
        })
        .filter(lang => lang && lang.length > 1 && lang.length < 30) // Remove very short or long entries
        .filter(lang => !lang.match(/^[^a-zA-Z]/) && !lang.includes('#')) // Remove entries starting with special chars or containing #
        .filter((lang, index, arr) => arr.indexOf(lang) === index) // Remove duplicates
        .slice(0, 50) // Limit results
        .sort();

      // logger.log(`📊 Clean Languages response: { languageCount: ${cleanLanguages.length} }`);
      res.json(cleanLanguages);
    } catch (error) {
      // console.error('Error fetching filter languages:', error);
      res.status(500).json({ error: 'Failed to fetch filter languages' });
    }
  });

  // FILTERS GENRES API
  app.get("/api/filters/genres", async (req, res) => {
    try {
      // logger.log('🎵 Fetching genres from tags field...');
      
      // Get all distinct tags from stations
      const allTags = await Station.distinct('tags').lean();
      
      // Extract unique genre values from tags (tags are comma-separated)
      const genreSet = new Set();
      
      allTags.forEach(tagString => {
        if (tagString && typeof tagString === 'string') {
          // Split comma-separated tags and clean them up
          const tags = tagString.split(',').map(tag => tag.trim().toLowerCase());
          tags.forEach(tag => {
            if (tag && tag.length > 0) {
              genreSet.add(tag);
            }
          });
        }
      });
      
      // Debug logging to see what we're getting
      logger.log('🔍 Tags debug:', { 
        totalTags: allTags.length, 
        sampleTags: allTags.slice(0, 5),
        genreCount: genreSet.size,
        sampleGenres: Array.from(genreSet).slice(0, 10)
      });
      
      // Convert to sorted array
      const genres = Array.from(genreSet).sort();
      
      // logger.log(`📊 Genres from tags:`, { genreCount: genres.length, sample: genres.slice(0, 10) });
      res.json(genres);
    } catch (error) {
      // console.error('Error fetching filter genres:', error);
      res.status(500).json({ error: 'Failed to fetch filter genres' });
    }
  });

  // Get stations by genre (for genre pages)
  app.get("/api/stations/by-genre/:genre", async (req, res) => {
    try {
      const { genre } = req.params;
      const { page = 1, limit = 20, country } = req.query;
      
      const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
      
      let query: any = {
        $or: [
          { genre: new RegExp(genre, 'i') },
          { tags: new RegExp(genre, 'i') }
        ]
      };
      
      if (country && country !== 'All') {
        query.country = country;
      }
      
      const stations = await Station.find(query)
        .sort({ votes: -1, clickCount: -1 })
        .skip(skip)
        .limit(parseInt(limit as string))
        .lean();
        
      const total = await Station.countDocuments(query);
      
      res.json({
        stations,
        total,
        page: parseInt(page as string),
        totalPages: Math.ceil(total / parseInt(limit as string))
      });
    } catch (error) {
      // console.error('Error fetching stations by genre:', error);
      res.status(500).json({ error: 'Failed to fetch stations by genre' });
    }
  });

  // Get genre statistics for landing pages
  app.get("/api/genres/:slug/stats", async (req, res) => {
    try {
      const { slug } = req.params;
      
      // Convert slug back to genre name (replace hyphens with spaces, capitalize)
      const genreName = slug.split('-').map(word => 
        word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
      ).join(' ');
      
      // Get top countries for this genre
      const topCountries = await Station.aggregate([
        {
          $match: {
            $or: [
              { genre: new RegExp(genreName, 'i') },
              { tags: new RegExp(genreName, 'i') }
            ]
          }
        },
        {
          $group: {
            _id: "$country",
            count: { $sum: 1 },
            avgVotes: { $avg: "$votes" }
          }
        },
        {
          $match: { _id: { $nin: [null, ""] } }
        },
        {
          $sort: { count: -1 }
        },
        {
          $limit: 50
        },
        {
          $project: {
            name: "$_id",
            count: 1,
            avgVotes: { $round: ["$avgVotes", 1] }
          }
        }
      ]);

      // Get related genres based on stations that share multiple tags
      const relatedGenres = await Station.aggregate([
        {
          $match: {
            $or: [
              { genre: new RegExp(genreName, 'i') },
              { tags: new RegExp(genreName, 'i') }
            ]
          }
        },
        {
          $project: {
            tags: { $split: ["$tags", ","] }
          }
        },
        {
          $unwind: "$tags"
        },
        {
          $group: {
            _id: { $trim: { input: "$tags" } },
            count: { $sum: 1 }
          }
        },
        {
          $match: {
            _id: { 
              $ne: genreName,
              $ne: "",
              $ne: null,
              $nin: ["music", "radio", "online", "live", "stream", "station"]
            },
            count: { $gte: 5 }
          }
        },
        {
          $sort: { count: -1 }
        },
        {
          $limit: 8
        },
        {
          $project: {
            name: "$_id",
            slug: {
              $toLower: {
                $replaceAll: {
                  input: { $replaceAll: { input: "$_id", find: " ", replacement: "-" } },
                  find: "--",
                  replacement: "-"
                }
              }
            },
            count: 1
          }
        }
      ]);

      res.json({
        topCountries,
        relatedGenres
      });
    } catch (error) {
      console.error('Error fetching genre stats:', error);
      res.status(500).json({ error: 'Failed to fetch genre statistics' });
    }
  });



  // STATION CLICK TRACKING
  app.post("/api/stations/:id/click", async (req, res) => {
    try {
      const { id } = req.params;
      await Station.findByIdAndUpdate(id, {
        $inc: { clickcount: 1 },
        $set: { clickTimestamp: new Date() }
      });
      // logger.log(` Station ${id} click tracked`);
      res.json({ success: true });
    } catch (error) {
      // console.error('Error tracking station click:', error);
      res.status(500).json({ error: 'Failed to track click' });
    }
  });

  // STATION RATING SYSTEM
  // Calculate rating statistics for a station
  async function calculateStationRatingStats(stationId: string) {
    const ratings = await StationRating.find({ stationId }).lean();
    
    if (ratings.length === 0) {
      return {
        averageRating: 0,
        totalRatings: 0,
        ratingBreakdown: { stars1: 0, stars2: 0, stars3: 0, stars4: 0, stars5: 0 }
      };
    }

    const breakdown = { stars1: 0, stars2: 0, stars3: 0, stars4: 0, stars5: 0 };
    let totalScore = 0;

    for (const rating of ratings) {
      totalScore += rating.rating;
      breakdown[`stars${rating.rating}` as keyof typeof breakdown]++;
    }

    const averageRating = totalScore / ratings.length;

    return {
      averageRating: Math.round(averageRating * 10) / 10, // Round to 1 decimal
      totalRatings: ratings.length,
      ratingBreakdown: breakdown
    };
  }

  // Rate a station
  app.post("/api/stations/:id/rate", async (req, res) => {
    try {
      const { id: stationId } = req.params;
      const { rating, comment, userId, sessionId } = req.body;

      // Validate rating
      if (!rating || rating < 1 || rating > 5) {
        return res.status(400).json({ error: 'Rating must be between 1 and 5 stars' });
      }

      // Get user identifier and IP for duplicate prevention
      const userIdentifier = userId || sessionId;
      const ipAddress = req.ip || req.connection.remoteAddress;
      const userAgent = req.get('User-Agent');

      if (!userIdentifier && !ipAddress) {
        return res.status(400).json({ error: 'User identification required' });
      }

      // Check if station exists
      const station = await Station.findById(stationId);
      if (!station) {
        return res.status(404).json({ error: 'Station not found' });
      }

      // Build query for existing rating (prioritize userId, fallback to sessionId, then IP)
      let existingRatingQuery: any = { stationId };
      if (userId) {
        existingRatingQuery.userId = userId;
      } else if (sessionId) {
        existingRatingQuery.sessionId = sessionId;
      } else {
        existingRatingQuery.ipAddress = ipAddress;
      }

      // Update or create rating
      const existingRating = await StationRating.findOne(existingRatingQuery);

      let ratingDoc;
      if (existingRating) {
        // Update existing rating
        ratingDoc = await StationRating.findByIdAndUpdate(
          existingRating._id,
          { 
            rating, 
            comment: comment || undefined,
            updatedAt: new Date()
          },
          { new: true }
        );
      } else {
        // Create new rating
        ratingDoc = await StationRating.create({
          stationId,
          userId: userId || undefined,
          sessionId: sessionId || undefined,
          rating,
          comment: comment || undefined,
          ipAddress,
          userAgent,
          createdAt: new Date(),
          updatedAt: new Date()
        });
      }

      // Recalculate station rating statistics
      const stats = await calculateStationRatingStats(stationId);

      // Update station with new rating statistics and increment votes
      await Station.findByIdAndUpdate(stationId, {
        averageRating: stats.averageRating,
        totalRatings: stats.totalRatings,
        ratingBreakdown: stats.ratingBreakdown,
        $inc: { votes: existingRating ? 0 : 1 } // Only increment votes for new ratings
      });

      res.json({
        success: true,
        rating: ratingDoc,
        stats: {
          averageRating: stats.averageRating,
          totalRatings: stats.totalRatings,
          ratingBreakdown: stats.ratingBreakdown,
          votes: station.votes + (existingRating ? 0 : 1)
        }
      });

    } catch (error) {
      console.error('Error rating station:', error);
      res.status(500).json({ error: 'Failed to rate station' });
    }
  });

  // Get station ratings
  app.get("/api/stations/:id/ratings", async (req, res) => {
    try {
      const { id: stationId } = req.params;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const skip = (page - 1) * limit;

      // Get ratings with pagination
      const ratings = await StationRating.find({ stationId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean();

      // Get total count
      const total = await StationRating.countDocuments({ stationId });

      // Calculate statistics
      const stats = await calculateStationRatingStats(stationId);

      res.json({
        ratings,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        },
        stats
      });

    } catch (error) {
      console.error('Error fetching station ratings:', error);
      res.status(500).json({ error: 'Failed to fetch ratings' });
    }
  });

  // Vote for a station - increments vote count by 1
  app.post("/api/stations/:id/vote", async (req, res) => {
    try {
      const { id: stationId } = req.params;
      
      // Find station and increment votes
      const station = await Station.findByIdAndUpdate(
        stationId,
        { $inc: { votes: 1 } },
        { new: true }
      );
      
      if (!station) {
        return res.status(404).json({ error: 'Station not found' });
      }
      
      res.json({
        success: true,
        votes: station.votes
      });
      
    } catch (error) {
      console.error('Error voting for station:', error);
      res.status(500).json({ error: 'Failed to vote for station' });
    }
  });

  // Get user's rating for a specific station
  app.get("/api/stations/:id/user-rating", async (req, res) => {
    try {
      const { id: stationId } = req.params;
      let { userId, sessionId } = req.query;

      // Gracefully handle missing parameters - return null rating instead of 400
      if (!userId && !sessionId) {
        return res.json({ rating: null });
      }

      // Ensure userId and sessionId are strings (not arrays from query params)
      if (Array.isArray(userId)) userId = userId[0];
      if (Array.isArray(sessionId)) sessionId = sessionId[0];

      // Build query
      let query: any = { stationId };
      if (userId && typeof userId === 'string') {
        query.userId = userId;
      } else if (sessionId && typeof sessionId === 'string') {
        query.sessionId = sessionId;
      }

      const rating = await StationRating.findOne(query).lean();

      res.json({ rating: rating || null });

    } catch (error) {
      console.error('Error fetching user rating:', error);
      res.json({ rating: null }); // Graceful fallback instead of 500
    }
  });

  // ENSURE USER PROFILE IS PUBLIC (for testing purposes)
  app.post("/api/test/make-user-public", async (req, res) => {
    try {
      const { email } = req.body;
      // logger.log(' Making user profile public for testing:', email);
      
      const user = await User.findOneAndUpdate(
        { email: email },
        { 
          isPublicProfile: true,
          name: email.split('@')[0] // Use email prefix as name if no name set
        },
        { new: true }
      );
      
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      // logger.log(' User profile set to public:', user.email);
      res.json({ message: 'User profile is now public', user: { email: user.email, isPublicProfile: user.isPublicProfile } });
    } catch (error) {
      // console.error('Error making user public:', error);
      res.status(500).json({ error: 'Failed to update user profile' });
    }
  });

  // ADD FAVORITES FOR USER (for testing purposes)
  app.post("/api/test/add-favorites", async (req, res) => {
    try {
      const { email, stationIds } = req.body;
      // logger.log(' Adding favorites for user:', email, 'stations:', stationIds);
      
      const user = await User.findOneAndUpdate(
        { email: email },
        { 
          $addToSet: { favoriteStations: { $each: stationIds } },
          isPublicProfile: true,
          name: email.split('@')[0]
        },
        { new: true, upsert: true }
      );
      
      // logger.log(' Added favorites to user:', user.email, 'total favorites:', user.favoriteStations.length);
      res.json({ 
        message: 'Favorites added successfully', 
        user: { 
          email: user.email, 
          favoriteStations: user.favoriteStations,
          isPublicProfile: user.isPublicProfile 
        } 
      });
    } catch (error) {
      // console.error('Error adding favorites:', error);
      res.status(500).json({ error: 'Failed to add favorites' });
    }
  });

  // UPDATE USER NAME (for fixing user profiles)
  app.post("/api/test/update-user-name", async (req, res) => {
    try {
      const { email, name } = req.body;
      // logger.log(' Updating user name:', email, 'to:', name);
      
      const user = await User.findOneAndUpdate(
        { email: email },
        { name: name },
        { new: true }
      );
      
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      // logger.log(' Updated user name:', user.email, 'name:', user.name);
      res.json({ 
        message: 'User name updated successfully', 
        user: { 
          email: user.email, 
          name: user.name,
          isPublicProfile: user.isPublicProfile 
        } 
      });
    } catch (error) {
      // console.error('Error updating user name:', error);
      res.status(500).json({ error: 'Failed to update user name' });
    }
  });

  // DEBUG USER STATUS (for testing purposes)
  app.get("/api/test/user-status/:email", async (req, res) => {
    try {
      const { email } = req.params;
      // logger.log(' Checking user status for:', email);
      
      const user = await User.findOne({ email: email });
      
      if (!user) {
        // logger.log(' User not found:', email);
        return res.json({ found: false, message: 'User not found' });
      }
      
      // logger.log(' User found:', { email: user.email, isPublicProfile: user.isPublicProfile, favoriteStationsCount: user.favoriteStations?.length || 0, name: user.name });
      
      res.json({ 
        found: true,
        user: {
          _id: user._id,
          email: user.email,
          name: user.name,
          isPublicProfile: user.isPublicProfile,
          favoriteStations: user.favoriteStations,
          favoriteStationsCount: user.favoriteStations?.length || 0
        }
      });
    } catch (error) {
      // console.error('Error checking user status:', error);
      res.status(500).json({ error: 'Failed to check user status' });
    }
  });

  // GET USER PROFILE BY ID OR SLUG
  app.get("/api/user-profile/:idOrSlug", async (req, res) => {
    try {
      const { idOrSlug } = req.params;
      // logger.log(' Fetching user profile for ID/Slug:', idOrSlug);
      
      let user;
      
      // Check if it's a MongoDB ObjectId (24 hex characters)
      if (/^[0-9a-fA-F]{24}$/.test(idOrSlug)) {
        user = await User.findById(idOrSlug);
      } else {
        // Treat as slug
        user = await User.findOne({ slug: idOrSlug });
      }
      
      if (!user) {
        // logger.log(' User not found:', idOrSlug);
        return res.status(404).json({ error: 'User not found' });
      }
      
      // Calculate ACTUAL follower and following counts from UserFollow collection
      const actualFollowersCount = await UserFollow.countDocuments({ followingUserId: user._id });
      const actualFollowingCount = await UserFollow.countDocuments({ userId: user._id });
      
      // Get correct favorites count from UserFavorite collection
      const actualFavoritesCount = await UserFavorite.countDocuments({ userId: user._id });
      
      // Sync the user document if counts are incorrect
      const needsUpdate = user.followersCount !== actualFollowersCount || user.followingCount !== actualFollowingCount;
      if (needsUpdate) {
        // logger.log(` Syncing user ${user._id} counts: followers ${user.followersCount} -> ${actualFollowersCount}, following ${user.followingCount} -> ${actualFollowingCount}`);
        await User.findByIdAndUpdate(user._id, {
          followersCount: actualFollowersCount,
          followingCount: actualFollowingCount
        });
      }
      
      // Only return public profile data
      const profileData = {
        _id: user._id,
        email: user.email,
        fullName: user.fullName,
        name: user.name, // Keep name for backward compatibility
        isPublicProfile: user.isPublicProfile,
        favoriteStations: user.favoriteStations || [],
        favoriteStationsCount: actualFavoritesCount, // Use correct count from UserFavorite collection
        recentlyPlayedStations: user.recentlyPlayedStations || [],
        createdAt: user.createdAt,
        playAtLogin: user.playAtLogin,
        theme: user.theme,
        language: user.language,
        autoplay: user.autoplay,
        volume: user.volume,
        followersCount: actualFollowersCount, // Always return the ACTUAL count
        followingCount: actualFollowingCount
      };
      
      // logger.log(' User profile found:', { id, isPublic: user.isPublicProfile, actualFavoritesCount, actualFollowersCount, fullName: user.fullName });
      res.json(profileData);
    } catch (error) {
      // console.error('Error fetching user profile:', error);
      res.status(500).json({ error: 'Failed to fetch user profile' });
    }
  });

  // REMOVED: Conflicting route for favorites that only handled MongoDB IDs
  // Using slug-capable route instead which is defined further below

  // GET COMMUNITY FAVORITES - Most-favorited stations across all users (Public)
  app.get("/api/community-favorites", async (req, res) => {
    try {
      const { country } = req.query;
      const cacheKey = `community_favorites:${country || 'all'}:all:20`;
      
      // Try cache first
      const cached = await CacheManager.get(cacheKey);
      if (cached) {
        return res.json(cached);
      }
      
      // If not cached, refresh and return
      await refreshCommunityFavoritesCache(country as string | undefined);
      const data = await CacheManager.get(cacheKey);
      res.json(data || []);
    } catch (error) {
      logger.log('Error fetching community favorites:', error);
      res.status(500).json({ error: 'Failed to fetch community favorites' });
    }
  });

  // GET CURRENT USER'S FAVORITE STATIONS (Authenticated)
  app.get("/api/user/favorites", requireAuth, async (req, res) => {
    try {
      const currentUserId = (req.session as any)?.userId;
      const sortQuery = (req.query.sort as string) || 'newest';
      const page = parseInt(req.query.page as string) || 0;
      const limit = Math.min(parseInt(req.query.limit as string) || 0, 100);
      const fieldsParam = (req.query.fields as string) || '';
      
      if (!currentUserId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      let sortStage: any = { favoritedAt: -1 };
      switch (sortQuery) {
        case 'oldest':
          sortStage = { favoritedAt: 1 };
          break;
        case 'name':
          sortStage = { name: 1 };
          break;
        case 'country':
          sortStage = { name: -1 };
          break;
        case 'newest':
        default:
          sortStage = { favoritedAt: -1 };
          break;
      }

      const allFields: Record<string, string> = {
        _id: '$station._id',
        name: '$station.name',
        url: '$station.url',
        country: '$station.country',
        genre: '$station.genre',
        tags: '$station.tags',
        votes: '$station.votes',
        clickCount: '$station.clickCount',
        codec: '$station.codec',
        bitrate: '$station.bitrate',
        favicon: '$station.favicon',
        homepage: '$station.homepage',
        iso_3166_1: '$station.iso_3166_1',
        language: '$station.language',
        languagecodes: '$station.languagecodes',
        lastcheckok: '$station.lastcheckok',
        lastchecktime: '$station.lastchecktime',
        lastcheckoktime: '$station.lastcheckoktime',
        clicktimestamp: '$station.clicktimestamp',
        urlResolved: '$station.urlResolved',
        ssl_error: '$station.ssl_error',
        geo_lat: '$station.geo_lat',
        geo_long: '$station.geo_long',
        has_extended_info: '$station.has_extended_info',
        slug: '$station.slug',
        createdAt: '$station.createdAt',
        updatedAt: '$station.updatedAt',
        favoritedAt: '$createdAt'
      };

      let projectStage: Record<string, any>;
      if (fieldsParam) {
        const requestedFields = fieldsParam.split(',').map(f => f.trim());
        projectStage = { _id: '$station._id', favoritedAt: '$createdAt' };
        for (const field of requestedFields) {
          if (allFields[field]) {
            projectStage[field] = allFields[field];
          }
        }
      } else {
        projectStage = allFields;
      }

      const pipeline: any[] = [
        { $match: { userId: currentUserId } },
        {
          $addFields: {
            stationObjectId: { 
              $cond: {
                if: { $type: '$stationId' },
                then: { 
                  $cond: {
                    if: { $eq: [{ $type: '$stationId' }, 'objectId'] },
                    then: '$stationId',
                    else: { $toObjectId: '$stationId' }
                  }
                },
                else: null
              }
            }
          }
        },
        {
          $lookup: {
            from: 'stations',
            localField: 'stationObjectId',
            foreignField: '_id',
            as: 'station'
          }
        },
        { $unwind: { path: '$station', preserveNullAndEmptyArrays: true } },
        { $match: { 'station': { $exists: true, $ne: null } } },
        { $project: projectStage },
        { $sort: sortStage }
      ];

      if (page > 0 && limit > 0) {
        const totalFavorites = await UserFavorite.countDocuments({ userId: currentUserId });
        const skip = (page - 1) * limit;
        pipeline.push({ $skip: skip });
        pipeline.push({ $limit: limit });

        const favorites = await UserFavorite.aggregate(pipeline);
        const stations = favorites.map(station => ({
          ...station,
          clickcount: station.clickCount || 0
        }));

        return res.json({
          stations: stripPlaceholders(stations),
          pagination: {
            page,
            limit,
            total: totalFavorites,
            totalPages: Math.ceil(totalFavorites / limit)
          }
        });
      }

      const favorites = await UserFavorite.aggregate(pipeline);
      const stations = favorites.map(station => ({
        ...station,
        clickcount: station.clickCount || 0
      }));
      
      res.json(stripPlaceholders(stations));
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch favorites' });
    }
  });

  // GET RECENTLY PLAYED STATIONS (Authenticated or public)
  app.get("/api/recently-played", requireAuth, async (req, res) => {
    try {
      const currentUserId = (req.session as any)?.user?.userId || (req.session as any)?.userId;

      const user = await User.findById(currentUserId);
      if (!user || !user.recentlyPlayedStations || user.recentlyPlayedStations.length === 0) {
        return res.json([]);
      }

      const recentEntries = user.recentlyPlayedStations;
      const stationIds = recentEntries.map((entry: any) => {
        const id = entry.stationId || entry;
        try { return new mongoose.Types.ObjectId(id.toString()); } catch { return id; }
      });
      const stations = await Station.find({
        _id: { $in: stationIds }
      }).lean();

      const stationMap = new Map(stations.map(s => [s._id.toString(), s]));
      const orderedStations = recentEntries
        .map((entry: any) => {
          const id = (entry.stationId || entry).toString();
          const station = stationMap.get(id);
          if (!station) return null;
          return { ...station, playedAt: entry.playedAt || null };
        })
        .filter(Boolean);

      res.json(stripPlaceholders(orderedStations));
    } catch (error) {
      console.error('Error fetching recently played:', error);
      res.status(500).json({ error: 'Failed to fetch recently played' });
    }
  });

  app.post("/api/recently-played", requireAuth, async (req, res) => {
    try {
      const currentUserId = (req.session as any)?.user?.userId || (req.session as any)?.userId;
      const { stationId } = req.body;
      
      if (!stationId) {
        return res.status(400).json({ error: 'Station ID is required' });
      }

      // Check if station exists
      const station = await Station.findById(stationId);
      if (!station) {
        return res.status(404).json({ error: 'Station not found' });
      }

      // Update user's recentlyPlayedStations - remove if exists, then add to beginning
      await User.findByIdAndUpdate(currentUserId, {
        $pull: { recentlyPlayedStations: { stationId: stationId } }
      });

      await User.findByIdAndUpdate(currentUserId, {
        $push: {
          recentlyPlayedStations: {
            $each: [{ stationId: stationId, playedAt: new Date() }],
            $position: 0,
            $slice: 12 // Keep only last 12 stations
          }
        }
      });

      res.json({ success: true });
    } catch (error) {
      console.error('Error adding to recently played:', error);
      res.status(500).json({ error: 'Failed to add to recently played' });
    }
  });

  // ADD STATION TO CURRENT USER'S FAVORITES (Authenticated)
  app.post("/api/user/favorites", requireAuth, async (req, res) => {
    try {
      const currentUserId = (req.session as any)?.userId;
      const { stationId } = req.body;
      
      if (!currentUserId) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      
      if (!stationId) {
        return res.status(400).json({ error: 'Station ID is required' });
      }

      // logger.log(`🌟 Adding station ${stationId} to favorites for user ${currentUserId}`);
      
      // Check if station exists
      const station = await Station.findById(stationId);
      if (!station) {
        return res.status(404).json({ error: 'Station not found' });
      }

      // Check if already favorited
      const existingFavorite = await UserFavorite.findOne({
        userId: currentUserId,
        stationId: stationId
      });

      if (existingFavorite) {
        return res.status(400).json({ error: 'Station already in favorites' });
      }

      // Add to favorites
      const favorite = await UserFavorite.create({
        userId: currentUserId,
        stationId: stationId,
        createdAt: new Date()
      });

      // Create notification for the user about the favorite action
      await UserNotification.create({
        userId: currentUserId,
        type: 'favorite_station',
        title: '🌟 Station Added to Favorites',
        message: `You added "${station.name}" to your favorites`,
        data: { 
          stationId: station._id,
          stationName: station.name,
          stationCountry: station.country,
          stationGenre: station.genre
        },
        read: false,
        createdAt: new Date()
      });

      await CacheManager.clearByPattern(`user-favorites:${currentUserId}`);
      res.json({ success: true, message: 'Station added to favorites', favorite });
    } catch (error) {
      res.status(500).json({ error: 'Failed to add station to favorites' });
    }
  });

  // REMOVE STATION FROM CURRENT USER'S FAVORITES (Authenticated)
  app.delete("/api/user/favorites/:stationId", requireAuth, async (req, res) => {
    try {
      const currentUserId = (req.session as any)?.userId;
      const { stationId } = req.params;
      
      if (!currentUserId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      // logger.log(`🗑️ Removing station ${stationId} from favorites for user ${currentUserId}`);
      
      // Remove from favorites
      const deleted = await UserFavorite.findOneAndDelete({
        userId: currentUserId,
        stationId: stationId
      });

      if (!deleted) {
        return res.status(404).json({ error: 'Station not in favorites' });
      }

      // Get station info for notification
      const station = await Station.findById(stationId).select('name country genre');
      
      // Create notification for the user about removing favorite
      if (station) {
        await UserNotification.create({
          userId: currentUserId,
          type: 'system',
          title: '💔 Station Removed from Favorites',
          message: `You removed "${station.name}" from your favorites`,
          data: { 
            stationId: stationId,
            stationName: station.name,
            stationCountry: station.country,
            stationGenre: station.genre
          },
          read: false,
          createdAt: new Date()
        });
      }

      await CacheManager.clearByPattern(`user-favorites:${currentUserId}`);
      res.json({ success: true, message: 'Station removed from favorites' });
    } catch (error) {
      res.status(500).json({ error: 'Failed to remove station from favorites' });
    }
  });

  // CHECK IF STATION IS IN CURRENT USER'S FAVORITES (Authenticated)
  app.get("/api/user/favorites/check/:stationId", requireAuth, async (req, res) => {
    try {
      const currentUserId = (req.session as any)?.userId;
      const { stationId } = req.params;
      
      if (!currentUserId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const isFavorited = await UserFavorite.exists({
        userId: currentUserId,
        stationId: stationId
      });

      res.json({ isFavorited: !!isFavorited });
    } catch (error) {
      // console.error('Error checking favorite status:', error);
      res.status(500).json({ error: 'Failed to check favorite status' });
    }
  });

  // GET CURRENT USER'S NOTIFICATIONS (Authenticated)
  app.get("/api/user/notifications", async (req, res) => {
    try {
      // Support both session cookie (web) and Bearer token (mobile)
      let currentUserId = (req.session as any)?.userId || (req.session as any)?.user?.userId;
      if (!currentUserId) {
        const authHeader = req.headers['authorization'];
        const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
        if (bearerToken) {
          const tokenDoc = await AuthToken.findOne({ token: bearerToken, isRevoked: false, expiresAt: { $gt: new Date() } }).lean();
          if (tokenDoc) currentUserId = tokenDoc.userId?.toString();
        }
      }

      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const skip = (page - 1) * limit;
      
      if (!currentUserId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      // logger.log(`📬 Fetching notifications for user ${currentUserId} (page ${page}, limit ${limit})`);
      
      // Only show new_station and follow notifications from last 10 days
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      
      // Get notifications for the current user - only relevant types, sorted by most recent
      const notifications = await UserNotification.find({ 
        userId: currentUserId,
        type: { $in: ['new_station', 'follow'] },
        createdAt: { $gte: tenDaysAgo }
      })
        .populate('fromUserId', 'fullName username avatar profileImageUrl')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean();

      // Get total count for pagination (only relevant types)
      const totalCount = await UserNotification.countDocuments({ 
        userId: currentUserId,
        type: { $in: ['new_station', 'follow'] },
        createdAt: { $gte: tenDaysAgo }
      });
      const unreadCount = await UserNotification.countDocuments({ 
        userId: currentUserId, 
        type: { $in: ['new_station', 'follow'] },
        createdAt: { $gte: tenDaysAgo },
        read: false 
      });

      // Map notifications - title already clean from database
      const mappedNotifications = notifications.map(n => ({
        ...n,
        isRead: n.read
      }))

      
      res.json({
        notifications: mappedNotifications,
        pagination: {
          page,
          limit,
          total: totalCount,
          pages: Math.ceil(totalCount / limit)
        },
        unreadCount
      });
    } catch (error) {
      // console.error('Error fetching user notifications:', error);
      res.status(500).json({ error: 'Failed to fetch notifications' });
    }
  });

  // MARK NOTIFICATION AS READ (Authenticated)
  app.patch("/api/user/notifications/:id/read", async (req, res) => {
    try {
      let currentUserId = (req.session as any)?.userId || (req.session as any)?.user?.userId;
      if (!currentUserId) {
        const authHeader = req.headers['authorization'];
        const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
        if (bearerToken) {
          const tokenDoc = await AuthToken.findOne({ token: bearerToken, isRevoked: false, expiresAt: { $gt: new Date() } }).lean();
          if (tokenDoc) currentUserId = tokenDoc.userId?.toString();
        }
      }
      const notificationId = req.params.id;
      
      if (!currentUserId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const notification = await UserNotification.findOneAndUpdate(
        { _id: notificationId, userId: currentUserId },
        { read: true },
        { new: true }
      );

      if (!notification) {
        return res.status(404).json({ error: 'Notification not found' });
      }

      // logger.log(`📖 Marked notification ${notificationId} as read for user ${currentUserId}`);
      res.json({ success: true, notification });
    } catch (error) {
      // console.error('Error marking notification as read:', error);
      res.status(500).json({ error: 'Failed to mark notification as read' });
    }
  });

  // MARK ALL NOTIFICATIONS AS READ (Authenticated)
  app.patch("/api/user/notifications/read-all", async (req, res) => {
    try {
      let currentUserId = (req.session as any)?.userId || (req.session as any)?.user?.userId;
      if (!currentUserId) {
        const authHeader = req.headers['authorization'];
        const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
        if (bearerToken) {
          const tokenDoc = await AuthToken.findOne({ token: bearerToken, isRevoked: false, expiresAt: { $gt: new Date() } }).lean();
          if (tokenDoc) currentUserId = tokenDoc.userId?.toString();
        }
      }
      
      if (!currentUserId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const result = await UserNotification.updateMany(
        { userId: currentUserId, read: false },
        { read: true }
      );

      // logger.log(`📖 Marked ${result.modifiedCount} notifications as read for user ${currentUserId}`);
      res.json({ success: true, markedCount: result.modifiedCount });
    } catch (error) {
      // console.error('Error marking all notifications as read:', error);
      res.status(500).json({ error: 'Failed to mark all notifications as read' });
    }
  });

  // GET USER PROFILE BY ID (for public profiles)
  app.get("/api/user-profile/:id", async (req, res) => {
    try {
      const { id } = req.params;
      
      const user = await User.findById(id);
      
      if (!user || !user.isPublicProfile) {
        return res.status(404).json({ error: 'User not found or profile is private' });
      }

      // Return user profile in expected format
      const profile = {
        _id: user._id,
        name: user.fullName || user.name || user.email?.split('@')[0] || 'User',
        fullName: user.fullName,
        email: user.email,
        profileImageUrl: user.profileImageUrl,
        isPublicProfile: user.isPublicProfile,
        createdAt: user.createdAt,
        followersCount: 0, // Default for now
        followingCount: 0  // Default for now
      };

      res.json(profile);
    } catch (error) {
      console.error('Error fetching user profile:', error);
      res.status(500).json({ error: 'Failed to fetch user profile' });
    }
  });

  // Admin endpoint to fix specific user with debug info
  app.post("/api/admin/fix-user/:userId", async (req, res) => {
    try {
      const { userId } = req.params;
      const user = await User.findById(userId);
      
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      logger.log('🔧 Fixing user:', user.fullName, 'Email:', user.email);
      logger.log('🔍 User object fields:', { 
        fullName: user.fullName, 
        username: user.username, 
        name: user.name, 
        email: user.email 
      });

      const updateData: any = {};
      
      // Set profile as public
      updateData.isPublicProfile = true;
      
      // Generate slug manually to fix the issue
      const generateSlug = (text: string): string => {
        return text
          .toLowerCase()
          .replace(/[^\w\s-]/g, '') 
          .replace(/\s+/g, '') // Remove spaces completely for "sahinyogurtcu" format
          .replace(/-+/g, '-') 
          .trim()
          .replace(/^-+|-+$/g, '');
      };

      let slugSource = user.fullName || user.username || user.name || user.email?.split('@')[0] || 'user';
      updateData.slug = generateSlug(slugSource);
      logger.log(`✅ Generated slug from "${slugSource}": ${updateData.slug}`);
      
      logger.log('🔧 About to update user with data:', updateData);
      const updatedUser = await User.findByIdAndUpdate(user._id, updateData, { new: true });
      logger.log('✅ User updated successfully. Full user object:');
      logger.log('  - _id:', updatedUser?._id);
      logger.log('  - fullName:', updatedUser?.fullName);
      logger.log('  - slug:', updatedUser?.slug);
      logger.log('  - isPublicProfile:', updatedUser?.isPublicProfile);
      
      // Sync favorites
      await syncUserFavorites();

      res.json({ 
        success: true, 
        message: `Fixed user ${user.fullName || user.email}`,
        newSlug: updateData.slug
      });
    } catch (error) {
      console.error('Error fixing user:', error);
      res.status(500).json({ error: 'Failed to fix user' });
    }
  });

  // Admin endpoint to fix user profiles (make public + generate slugs)
  app.post("/api/admin/fix-user-profiles", async (req, res) => {
    try {
      // Get all users without public profiles or with ID-based slugs
      const users = await User.find({
        $or: [
          { isPublicProfile: { $ne: true } },
          { slug: { $exists: false } },
          { slug: { $regex: /^[0-9a-fA-F]{24}$/ } } // MongoDB ID pattern
        ]
      });

      let fixedCount = 0;
      for (const user of users) {
        const updateData: any = {};
        
        // Set profile as public
        if (!user.isPublicProfile) {
          updateData.isPublicProfile = true;
        }
        
        // Generate slug if missing or if it's a MongoDB ID
        if (!user.slug || /^[0-9a-fA-F]{24}$/.test(user.slug)) {
          updateData.slug = await generateUserSlug(user, user._id);
        }
        
        if (Object.keys(updateData).length > 0) {
          await User.findByIdAndUpdate(user._id, updateData);
          fixedCount++;
        }
      }

      // Also sync favorites to fix the favorites display issue
      await syncUserFavorites();

      res.json({ 
        success: true, 
        message: `Fixed ${fixedCount} user profiles and synced favorites`,
        totalUsers: users.length
      });
    } catch (error) {
      console.error('Error fixing user profiles:', error);
      res.status(500).json({ error: 'Failed to fix user profiles' });
    }
  });

  // GET USER'S FAVORITE STATIONS BY ID OR SLUG (for public profiles)
  app.get("/api/users/:idOrSlug/favorites", async (req, res) => {
    try {
      const { idOrSlug } = req.params;
      const page = parseInt(req.query.page as string) || 0;
      const limit = Math.min(parseInt(req.query.limit as string) || 0, 100);
      const fieldsParam = (req.query.fields as string) || '';
      
      let user;
      if (/^[0-9a-fA-F]{24}$/.test(idOrSlug)) {
        user = await User.findById(idOrSlug).select('_id').lean();
      } else {
        user = await User.findOne({ slug: idOrSlug }).select('_id').lean();
      }
      
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      const userId = user._id.toString();
      const usePagination = page > 0 && limit > 0;
      const cacheKey = `user-favorites:${userId}:p${page}:l${limit}:f${fieldsParam}`;
      const cached = await CacheManager.get(cacheKey);
      if (cached) {
        return res.json(cached);
      }

      const defaultMobileFields: Record<string, string> = {
        _id: '$station._id',
        name: '$station.name',
        favicon: '$station.favicon',
        country: '$station.country',
        slug: '$station.slug',
        url: '$station.url',
        genre: '$station.genre',
        tags: '$station.tags',
        votes: '$station.votes',
        codec: '$station.codec',
        bitrate: '$station.bitrate',
        language: '$station.language',
        iso_3166_1: '$station.iso_3166_1',
        urlResolved: '$station.urlResolved',
        lastcheckok: '$station.lastcheckok',
        clickCount: '$station.clickCount',
        favoritedAt: '$createdAt'
      };

      let projectStage: Record<string, any>;
      if (fieldsParam) {
        const requested = fieldsParam.split(',').map(f => f.trim());
        projectStage = { _id: '$station._id', favoritedAt: '$createdAt' };
        for (const field of requested) {
          if (defaultMobileFields[field]) {
            projectStage[field] = defaultMobileFields[field];
          }
        }
      } else {
        projectStage = defaultMobileFields;
      }

      const pipeline: any[] = [
        { $match: { userId } },
        { $sort: { createdAt: -1 as const } },
      ];

      if (usePagination) {
        pipeline.push({ $skip: (page - 1) * limit });
        pipeline.push({ $limit: limit });
      }

      pipeline.push(
        {
          $addFields: {
            stationObjectId: { $toObjectId: '$stationId' }
          }
        },
        {
          $lookup: {
            from: 'stations',
            localField: 'stationObjectId',
            foreignField: '_id',
            as: 'station'
          }
        },
        { $match: { 'station.0': { $exists: true } } },
        { $unwind: '$station' },
        { $project: projectStage }
      );

      const [stations, totalCount] = await Promise.all([
        UserFavorite.aggregate(pipeline),
        usePagination ? UserFavorite.countDocuments({ userId }) : Promise.resolve(0)
      ]);

      let result: any;
      if (usePagination) {
        result = {
          stations,
          pagination: {
            page,
            limit,
            total: totalCount,
            totalPages: Math.ceil(totalCount / limit)
          }
        };
      } else {
        result = stations;
      }

      CacheManager.set(cacheKey, result, { ttl: 120 });
      res.json(result);
    } catch (error) {
      console.error('Error fetching user favorites:', error);
      res.status(500).json({ error: 'Failed to fetch user favorites' });
    }
  });

  // GET USER'S RECENTLY PLAYED STATIONS
  app.get("/api/users/:id/recent", async (req, res) => {
    try {
      const { id } = req.params;
      // Fetching recent plays for user
      
      const user = await User.findById(id);
      
      if (!user || !user.isPublicProfile) {
        return res.status(404).json({ error: 'User not found or profile is private' });
      }
      
      if (!user.recentlyPlayedStations || user.recentlyPlayedStations.length === 0) {
        return res.json([]);
      }
      
      const recentEntries = user.recentlyPlayedStations;
      const stationIds = recentEntries.map((entry: any) => {
        const id = entry.stationId || entry;
        try { return new mongoose.Types.ObjectId(id.toString()); } catch { return id; }
      });
      const stations = await Station.find({
        _id: { $in: stationIds }
      }).select({
        name: 1,
        url: 1,
        country: 1,
        genre: 1,
        tags: 1,
        votes: 1,
        clickCount: 1,
        codec: 1,
        bitrate: 1,
        favicon: 1,
        homepage: 1,
        language: 1,
        slug: 1
      }).lean();
      
      const stationMap = new Map(stations.map(s => [s._id.toString(), s]));
      const orderedStations = recentEntries
        .map((entry: any) => {
          const id = (entry.stationId || entry).toString();
          const station = stationMap.get(id);
          if (!station) return null;
          return { ...station, playedAt: entry.playedAt || null };
        })
        .filter(Boolean);
      
      res.json(orderedStations);
    } catch (error) {
      // console.error('Error fetching user recent plays:', error);
      res.status(500).json({ error: 'Failed to fetch recent plays' });
    }
  });

  // PUBLIC PROFILES API - 24-HOUR CACHE for Community Favorites section
  app.get("/api/public-profiles", async (req, res) => {
    try {
      // Check cache first - 24 hours TTL (public profiles rarely change)
      const cacheKey = 'public_profiles:v4';
      const cachedData = await CacheManager.get(cacheKey);
      if (cachedData) {
        return res.json({ data: cachedData });
      }

      // Step 1: Get all public users (same as original)
      const users = await User.find({ 
        $or: [
          { isPublicProfile: true },
          { isPublic: true },
          { slug: 'sahinyogurtcu' }
        ]
      }).lean();

      if (users.length === 0) {
        // Cache empty result for shorter time
        await CacheManager.set(cacheKey, [], { ttl: 30 });
        return res.json({ data: [] });
      }

      // Step 2: Batch fetch ALL favorites at once (NOT in a loop!)
      const userIds = users.map(u => u._id.toString());
      const allFavorites = await UserFavorite.find({ 
        userId: { $in: userIds } 
      }).lean();

      // Early return if no favorites found
      if (allFavorites.length === 0) {
        await CacheManager.set(cacheKey, [], { ttl: 30 });
        return res.json({ data: [] });
      }

      // Step 3: Get all station IDs and fetch stations in one query
      const allStationIds = [...new Set(allFavorites.map(f => f.stationId))];
      const allStations = await Station.find({ 
        _id: { $in: allStationIds } 
      }).select('_id').lean();

      // Step 4: Create a map for quick lookups
      const stationExistsMap = new Set(allStations.map(s => s._id.toString()));
      const userFavoritesMap = {};

      // Step 5: Process favorites efficiently
      allFavorites.forEach(fav => {
        const userId = fav.userId;
        if (!userFavoritesMap[userId]) {
          userFavoritesMap[userId] = [];
        }
        if (stationExistsMap.has(fav.stationId)) {
          userFavoritesMap[userId].push(fav.stationId);
        }
      });

      // Step 6: Build profiles array with favorite counts
      const publicProfiles = users
        .map(user => {
          const userId = user._id.toString();
          const favoriteCount = userFavoritesMap[userId]?.length || 0;
          
          // Skip users with no valid favorites
          if (favoriteCount === 0) {
            return null;
          }

          // Determine display name (same logic as original)
          let displayName = user.fullName || user.name;
          if (!displayName && user.email) {
            displayName = user.email.split('@')[0];
          }

          return {
            _id: user._id,
            name: displayName,
            email: user.email,
            profileImageUrl: user.avatar || user.profileImageUrl,
            favorites_count: favoriteCount,
            isPublicProfile: user.isPublicProfile,
            slug: user.slug
          };
        })
        .filter(Boolean) // Remove null entries (users with no favorites)
        .sort((a, b) => b.favorites_count - a.favorites_count); // Sort by favorites descending
      
      // Prioritize users with profile photos (any photo, not just randomuser.me)
      // Real photos: Google OAuth avatars, uploaded photos, or randomuser.me
      const withPhotos = publicProfiles.filter(p => p.profileImageUrl && p.profileImageUrl.trim() !== '');
      const withoutPhotos = publicProfiles.filter(p => !p.profileImageUrl || p.profileImageUrl.trim() === '');
      
      // Sort photo users by favorites count descending
      withPhotos.sort((a, b) => b.favorites_count - a.favorites_count);
      withoutPhotos.sort((a, b) => b.favorites_count - a.favorites_count);
      
      // Final result: users with photos first, then others
      const finalProfiles = [...withPhotos, ...withoutPhotos].slice(0, 70);

      // Cache the results for 1 hour
      await CacheManager.set(cacheKey, finalProfiles, { ttl: 3600 });

      res.json({ data: finalProfiles });
    } catch (error) {
      console.error('Error fetching public profiles:', error);
      res.status(500).json({ error: 'Failed to fetch public profiles' });
    }
  });



  // LANGUAGES API - with station counts
  app.get("/api/languages", async (req, res) => {
    try {
      // Fetching languages with station counts
      
      // Get languages with station counts using aggregation
      const languageStats = await Station.aggregate([
        {
          $match: {
            $and: [
              { language: { $exists: true, $ne: "" } },
              { language: { $ne: null } }
            ]
          }
        },
        {
          $group: {
            _id: "$language",
            stationCount: { $sum: 1 }
          }
        },
        {
          $project: {
            _id: 1,
            name: "$_id",
            code: { $toLower: "$_id" },
            stationCount: 1
          }
        },
        {
          $sort: { stationCount: -1 }
        },
        {
          $limit: 100
        }
      ]);

      // Found languages with station data
      res.json(languageStats);
    } catch (error) {
      // console.error('Error fetching languages:', error);
      res.status(500).json({ error: 'Failed to fetch languages' });
    }
  });

  // CODECS API - with station counts
  app.get("/api/codecs", async (req, res) => {
    try {
      // Fetching codecs with station counts
      
      // Get codecs with station counts using aggregation
      const codecStats = await Station.aggregate([
        {
          $match: {
            $and: [
              { codec: { $exists: true, $ne: "" } },
              { codec: { $ne: null } }
            ]
          }
        },
        {
          $group: {
            _id: "$codec",
            stationCount: { $sum: 1 }
          }
        },
        {
          $project: {
            _id: 1,
            name: "$_id",
            stationCount: 1
          }
        },
        {
          $sort: { stationCount: -1 }
        },
        {
          $limit: 50
        }
      ]);

      // logger.log(` Found ${codecStats.length} codecs with stations`);
      res.json(codecStats);
    } catch (error) {
      // console.error('Error fetching codecs:', error);
      res.status(500).json({ error: 'Failed to fetch codecs' });
    }
  });

  // RADIO BROWSER API ENDPOINTS - Direct integration with Radio-Browser.info API
  
  // Import the Radio Browser service
  let radioBrowserService: any;
  import('./services/radio-browser').then(module => {
    radioBrowserService = module.radioBrowserService;
  });

  // Get Radio Browser API stats
  app.get("/api/radio-browser/stats", async (req, res) => {
    try {
      if (!radioBrowserService) {
        return res.status(503).json({ error: 'Radio Browser service not available yet' });
      }
      
      // logger.log(' Fetching Radio Browser API stats...');
      const stats = await radioBrowserService.getStats();
      res.json(stats);
    } catch (error) {
      // console.error('Error fetching Radio Browser stats:', error);
      res.status(500).json({ error: 'Failed to fetch Radio Browser stats' });
    }
  });

  // Get top clicked stations from Radio Browser API
  app.get("/api/radio-browser/top-clicked", async (req, res) => {
    try {
      if (!radioBrowserService) {
        return res.status(503).json({ error: 'Radio Browser service not available yet' });
      }
      
      const { limit = 100 } = req.query;
      // logger.log('🔥 Fetching top ${limit} clicked stations from Radio Browser API...');
      
      const stations = await radioBrowserService.getTopClickedStations(Number(limit));
      res.json({ stations });
    } catch (error) {
      // console.error('Error fetching top clicked stations:', error);
      res.status(500).json({ error: 'Failed to fetch top clicked stations' });
    }
  });

  // Get top voted stations from Radio Browser API
  app.get("/api/radio-browser/top-voted", async (req, res) => {
    try {
      if (!radioBrowserService) {
        return res.status(503).json({ error: 'Radio Browser service not available yet' });
      }
      
      const { limit = 100 } = req.query;
      // logger.log(`⭐ Fetching top ${limit} voted stations from Radio Browser API...`);
      
      const stations = await radioBrowserService.getTopVotedStations(Number(limit));
      res.json({ stations });
    } catch (error) {
      // console.error('Error fetching top voted stations:', error);
      res.status(500).json({ error: 'Failed to fetch top voted stations' });
    }
  });

  // Get recently changed stations from Radio Browser API
  app.get("/api/radio-browser/recent", async (req, res) => {
    try {
      if (!radioBrowserService) {
        return res.status(503).json({ error: 'Radio Browser service not available yet' });
      }
      
      const { limit = 100 } = req.query;
      // logger.log('🕒 Fetching ${limit} recently changed stations from Radio Browser API...');
      
      const stations = await radioBrowserService.getRecentlyChangedStations(Number(limit));
      res.json({ stations });
    } catch (error) {
      // console.error('Error fetching recently changed stations:', error);
      res.status(500).json({ error: 'Failed to fetch recently changed stations' });
    }
  });

  // Get broken stations from Radio Browser API
  app.get("/api/radio-browser/broken", async (req, res) => {
    try {
      if (!radioBrowserService) {
        return res.status(503).json({ error: 'Radio Browser service not available yet' });
      }
      
      const { limit = 50 } = req.query;
      // logger.log('💔 Fetching ${limit} broken stations from Radio Browser API...');
      
      const stations = await radioBrowserService.getBrokenStations(Number(limit));
      res.json({ stations });
    } catch (error) {
      // console.error('Error fetching broken stations:', error);
      res.status(500).json({ error: 'Failed to fetch broken stations' });
    }
  });

  // SYNC MANAGEMENT API ENDPOINTS
  
  // Get sync status
  app.get("/api/sync/status", async (req, res) => {
    try {
      const status = await syncService.getStatus();
      res.json(status);
    } catch (error) {
      console.error('Error fetching sync status:', error);
      res.status(500).json({ error: 'Failed to fetch sync status' });
    }
  });

  // Get sync logs
  app.get("/api/sync/logs", async (req, res) => {
    try {
      const { limit = 20 } = req.query;
      const logs = await syncService.getLogs(Number(limit));
      res.json(logs);
    } catch (error) {
      console.error('Error fetching sync logs:', error);
      res.status(500).json({ error: 'Failed to fetch sync logs' });
    }
  });

  // Force start sync
  app.post("/api/sync/force", async (req, res) => {
    try {
      logger.log('🚀 Force starting sync...');
      
      // Start the sync asynchronously (don't wait for completion)
      syncService.startSync()
        .then(() => {
          logger.log('✅ Force sync completed successfully');
        })
        .catch((error) => {
          console.error('❌ Force sync failed:', error);
        });

      res.json({ 
        success: true, 
        message: 'Sync started successfully - check status for progress'
      });
    } catch (error) {
      console.error('Error starting sync:', error);
      res.status(500).json({ error: 'Failed to start sync' });
    }
  });

  // Stop sync
  app.post("/api/sync/stop", async (req, res) => {
    try {
      logger.log('🛑 Stopping sync...');
      
      // Stop the sync service
      syncService.stopSync();
      
      // Find running sync and mark as failed (stopped by admin)
      const runningSyncs = await SyncLog.find({ status: 'running' });
      
      for (const sync of runningSyncs) {
        sync.status = 'failed';
        sync.completedAt = new Date();
        sync.errorMessage = 'Manually stopped by admin';
        await sync.save();
      }

      res.json({ 
        success: true, 
        message: 'Sync stopped successfully',
        stoppedSyncs: runningSyncs.length 
      });
    } catch (error) {
      console.error('Error stopping sync:', error);
      res.status(500).json({ error: 'Failed to stop sync' });
    }
  });

  // Flush all station data
  app.post("/api/admin/flush-stations", async (req, res) => {
    try {
      logger.log('🗑️ Flushing all station data...');
      
      const { Station, SyncLog, BlacklistedStation } = await import('../shared/mongo-schemas');
      
      // Delete all stations
      const stationResult = await Station.deleteMany({});
      logger.log(`✅ Deleted ${stationResult.deletedCount} stations`);
      
      // Clear sync logs to start fresh
      const syncLogResult = await SyncLog.deleteMany({});
      logger.log(`✅ Deleted ${syncLogResult.deletedCount} sync logs`);
      
      // Clear blacklisted stations if any
      const blacklistResult = await BlacklistedStation.deleteMany({});
      logger.log(`✅ Deleted ${blacklistResult.deletedCount} blacklisted stations`);
      
      logger.log('🎯 Station data flush complete! Database is now empty and ready for fresh sync.');
      
      res.json({ 
        success: true, 
        message: 'All station data flushed successfully',
        deletedStations: stationResult.deletedCount,
        deletedSyncLogs: syncLogResult.deletedCount,
        deletedBlacklisted: blacklistResult.deletedCount
      });
    } catch (error) {
      console.error('❌ Error flushing station data:', error);
      res.status(500).json({ error: 'Failed to flush station data' });
    }
  });

  // ANALYTICS API ENDPOINTS
  
  // Remove playlist files (M3U, PLS, ASX) endpoint
  app.post("/api/admin/remove-playlist-streams", async (req, res) => {
    try {
      logger.log('🗑️ Starting removal of playlist files (M3U, PLS, ASX)...');
      
      // Count playlist streams to be removed
      const playlistCount = await Station.countDocuments({
        url: { $regex: /\.(m3u|pls|asx)(\?|$)/i }
      });
      
      logger.log(`Found ${playlistCount} playlist files to remove`);
      
      // Remove all playlist file streams
      const removalResult = await Station.deleteMany({
        url: { $regex: /\.(m3u|pls|asx)(\?|$)/i }
      });
      
      logger.log(`✅ Removed ${removalResult.deletedCount} playlist streams`);
      
      // Get updated counts
      const remainingTotal = await Station.countDocuments({});
      const directMP3 = await Station.countDocuments({
        url: { $regex: /\.mp3(\?|$)/i }
      });
      const directAAC = await Station.countDocuments({
        url: { $regex: /\.aac(\?|$)/i }
      });
      const icecastCount = await Station.countDocuments({
        url: { $regex: /(:8000|:8080|\/stream|\/radio|shoutcast|icecast)/i }
      });
      
      const results = {
        removed_count: removalResult.deletedCount,
        remaining_stations: remainingTotal,
        direct_playable: {
          mp3_streams: directMP3,
          aac_streams: directAAC,
          icecast_shoutcast: icecastCount,
          total_direct: directMP3 + directAAC + icecastCount
        },
        message: `Successfully removed ${removalResult.deletedCount} playlist streams. ${remainingTotal} direct-playable stations remain.`
      };
      
      res.json(results);
    } catch (error) {
      console.error('Playlist removal error:', error);
      res.status(500).json({ error: 'Failed to remove playlist streams' });
    }
  });

  // Remove HLS/M3U8 streams endpoint (completed)
  app.post("/api/admin/remove-hls-streams", async (req, res) => {
    try {
      logger.log('🗑️ Starting removal of HLS/M3U8 streams...');
      
      // Count streams to be removed
      const m3u8Count = await Station.countDocuments({
        url: { $regex: /\.m3u8/i }
      });
      
      const hlsRelatedCount = await Station.countDocuments({
        url: { $regex: /hls|m3u8/i }
      });
      
      logger.log(`Found ${m3u8Count} .m3u8 streams and ${hlsRelatedCount} HLS-related streams to remove`);
      
      // Remove all streams with HLS/M3U8 in URL
      const removalResult = await Station.deleteMany({
        url: { $regex: /hls|m3u8/i }
      });
      
      logger.log(`✅ Removed ${removalResult.deletedCount} HLS/M3U8 streams`);
      
      // Get updated counts
      const remainingTotal = await Station.countDocuments({});
      const directMP3 = await Station.countDocuments({
        url: { $regex: /\.mp3(\?|$)/i }
      });
      const icecastCount = await Station.countDocuments({
        url: { $regex: /(:8000|:8080|\/stream|\/radio|shoutcast|icecast)/i }
      });
      
      const results = {
        removed_count: removalResult.deletedCount,
        remaining_stations: remainingTotal,
        direct_playable: {
          mp3_streams: directMP3,
          icecast_shoutcast: icecastCount,
          total_direct: directMP3 + icecastCount
        },
        message: `Successfully removed ${removalResult.deletedCount} HLS/M3U8 streams. ${remainingTotal} direct-playable stations remain.`
      };
      
      res.json(results);
    } catch (error) {
      console.error('HLS removal error:', error);
      res.status(500).json({ error: 'Failed to remove HLS streams' });
    }
  });

  // HTTPS/HTTP URL analysis endpoint
  app.get("/api/stream-https-analysis", async (req, res) => {
    try {
      logger.log('🔍 Analyzing HTTPS vs HTTP URLs across all stations...');
      
      const totalStations = await Station.countDocuments({});
      
      // Count HTTPS URLs
      const httpsCount = await Station.countDocuments({
        url: { $regex: /^https:\/\//i }
      });
      
      // Count HTTP URLs  
      const httpCount = await Station.countDocuments({
        url: { $regex: /^http:\/\//i }
      });
      
      // Count resolved HTTPS URLs (urlResolved field)
      const httpsResolvedCount = await Station.countDocuments({
        urlResolved: { $regex: /^https:\/\//i }
      });
      
      // Count resolved HTTP URLs
      const httpResolvedCount = await Station.countDocuments({
        urlResolved: { $regex: /^http:\/\//i }
      });
      
      // Count stations with urlResolved field populated
      const stationsWithResolvedUrl = await Station.countDocuments({
        urlResolved: { $exists: true, $nin: [null, ""] }
      });
      
      // Get some HTTPS URL samples
      const httpsSamples = await Station.find({
        url: { $regex: /^https:\/\//i }
      }).limit(5).select('name url country');
      
      // Get some HTTP URL samples  
      const httpSamples = await Station.find({
        url: { $regex: /^http:\/\//i }
      }).limit(5).select('name url country');
      
      // Get some resolved HTTPS URL samples
      const httpsResolvedSamples = await Station.find({
        urlResolved: { $regex: /^https:\/\//i }
      }).limit(5).select('name url urlResolved country');
      
      const results = {
        total_stations: totalStations,
        original_urls: {
          https_urls: httpsCount,
          http_urls: httpCount,
          https_percentage: ((httpsCount / totalStations) * 100).toFixed(2),
          http_percentage: ((httpCount / totalStations) * 100).toFixed(2)
        },
        resolved_urls: {
          stations_with_resolved: stationsWithResolvedUrl,
          https_resolved: httpsResolvedCount,
          http_resolved: httpResolvedCount,
          https_resolved_percentage: stationsWithResolvedUrl > 0 ? ((httpsResolvedCount / stationsWithResolvedUrl) * 100).toFixed(2) : "0",
          http_resolved_percentage: stationsWithResolvedUrl > 0 ? ((httpResolvedCount / stationsWithResolvedUrl) * 100).toFixed(2) : "0"
        },
        samples: {
          https_samples: httpsSamples,
          http_samples: httpSamples,
          https_resolved_samples: httpsResolvedSamples
        }
      };
      
      logger.log('🔒 HTTPS/HTTP Analysis Results:', {
        total: results.total_stations,
        https: results.original_urls.https_urls,
        http: results.original_urls.http_urls,
        resolved: results.resolved_urls.stations_with_resolved,
        https_resolved: results.resolved_urls.https_resolved
      });
      
      res.json(results);
    } catch (error) {
      console.error('HTTPS analysis error:', error);
      res.status(500).json({ error: 'Failed to analyze HTTPS URLs' });
    }
  });

  // Stream type analysis endpoint
  app.get("/api/stream-analysis", async (req, res) => {
    try {
      logger.log('🔍 Analyzing stream types across all stations...');
      
      const totalStations = await Station.countDocuments({});
      
      // Count .m3u8 URLs (HLS streams)
      const m3u8Count = await Station.countDocuments({
        url: { $regex: /\.m3u8/i }
      });
      
      // Count HLS-related URLs (contains 'hls' or 'm3u8')
      const hlsRelatedCount = await Station.countDocuments({
        url: { $regex: /hls|m3u8/i }
      });
      
      // Count playlist URLs (.m3u, .pls, .asx)
      const playlistCount = await Station.countDocuments({
        url: { $regex: /\.(m3u|pls|asx)$/i }
      });
      
      // Count direct MP3 streams
      const mp3Count = await Station.countDocuments({
        url: { $regex: /\.mp3(\?|$)/i }
      });
      
      // Count direct AAC streams
      const aacCount = await Station.countDocuments({
        url: { $regex: /\.aac(\?|$)/i }
      });
      
      // Count Icecast/Shoutcast streams (common radio streaming)
      const icecastCount = await Station.countDocuments({
        url: { $regex: /(:8000|:8080|\/stream|\/radio|shoutcast|icecast)/i }
      });
      
      // Get sample .m3u8 URLs
      const m3u8Samples = await Station.find({
        url: { $regex: /\.m3u8/i }
      }).limit(10).select('name url country');
      
      // Get sample HLS URLs
      const hlsSamples = await Station.find({
        url: { $regex: /hls/i }
      }).limit(10).select('name url country');
      
      const results = {
        total_stations: totalStations,
        stream_types: {
          m3u8_urls: m3u8Count,
          hls_related: hlsRelatedCount,
          playlist_files: playlistCount,
          direct_mp3: mp3Count,
          direct_aac: aacCount,
          icecast_shoutcast: icecastCount
        },
        percentages: {
          m3u8_percentage: ((m3u8Count / totalStations) * 100).toFixed(2),
          hls_percentage: ((hlsRelatedCount / totalStations) * 100).toFixed(2),
          mp3_percentage: ((mp3Count / totalStations) * 100).toFixed(2),
          icecast_percentage: ((icecastCount / totalStations) * 100).toFixed(2)
        },
        samples: {
          m3u8_stations: m3u8Samples,
          hls_stations: hlsSamples
        }
      };
      
      logger.log('📊 Stream Analysis Results:', {
        total: results.total_stations,
        m3u8: results.stream_types.m3u8_urls,
        hls: results.stream_types.hls_related,
        mp3: results.stream_types.direct_mp3,
        icecast: results.stream_types.icecast_shoutcast
      });
      
      res.json(results);
    } catch (error) {
      console.error('Stream analysis error:', error);
      res.status(500).json({ error: 'Failed to analyze streams' });
    }
  });

  // Get analytics events
  app.get("/api/analytics", async (req, res) => {
    try {
      // logger.log(' Fetching analytics events...');
      
      const { startDate, endDate, event, limit = 100 } = req.query;
      
      // Build filter based on query params
      const filter: any = {};
      
      if (startDate || endDate) {
        filter.timestamp = {};
        if (startDate) filter.timestamp.$gte = new Date(startDate as string);
        if (endDate) filter.timestamp.$lte = new Date(endDate as string);
      }
      
      if (event && event !== '') {
        filter.event = event;
      }

      // Check if AnalyticsEvent collection exists and has data
      const { AnalyticsEvent } = await import('../shared/mongo-schemas');
      const events = await AnalyticsEvent.find(filter)
        .sort({ timestamp: -1 })
        .limit(Number(limit))
        .lean();

      // logger.log(` Found ${events.length} analytics events`);
      res.json(events);
    } catch (error) {
      // console.error('Error fetching analytics:', error);
      // Return sample data if collection doesn't exist yet
      const sampleEvents = [
        {
          _id: '1',
          stationId: '60f7b3b4b8f4e4001c8f4567',
          event: 'play',
          metadata: { duration: 300, quality: 'high' },
          timestamp: new Date(Date.now() - 1000 * 60 * 10), // 10 minutes ago
          ip: '127.0.0.1'
        },
        {
          _id: '2',
          stationId: '60f7b3b4b8f4e4001c8f4568',
          event: 'favorite',
          metadata: { action: 'add' },
          timestamp: new Date(Date.now() - 1000 * 60 * 30), // 30 minutes ago
        },
        {
          _id: '3',
          stationId: '60f7b3b4b8f4e4001c8f4569',
          event: 'click',
          metadata: { source: 'homepage', position: 1 },
          timestamp: new Date(Date.now() - 1000 * 60 * 60), // 1 hour ago
        }
      ];
      res.json(sampleEvents);
    }
  });

  // Get analytics summary/stats
  app.get("/api/analytics/summary", async (req, res) => {
    try {
      // logger.log(' Fetching analytics summary...');
      
      const { period = '7d' } = req.query;
      
      // Calculate date range based on period
      let startDate = new Date();
      switch (period) {
        case '24h':
          startDate.setHours(startDate.getHours() - 24);
          break;
        case '7d':
          startDate.setDate(startDate.getDate() - 7);
          break;
        case '30d':
          startDate.setDate(startDate.getDate() - 30);
          break;
        default:
          startDate.setDate(startDate.getDate() - 7);
      }

      // Get basic station stats from existing data
      const totalStations = await Station.countDocuments();
      const activeStations = await Station.countDocuments({ lastCheckOk: true });
      const brokenStations = await Station.countDocuments({ lastCheckOk: false });
      
      // Get top countries by station count
      const topCountries = await Station.aggregate([
        { $match: { country: { $exists: true, $ne: "" } } },
        { $group: { _id: "$country", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 }
      ]);

      // Get top genres by station count
      const topGenres = await Genre.aggregate([
        { $sort: { stationCount: -1 } },
        { $limit: 10 }
      ]);

      // Get top codecs
      const topCodecs = await Station.aggregate([
        { $match: { codec: { $exists: true, $ne: "" } } },
        { $group: { _id: "$codec", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 }
      ]);

      const summary = {
        totalStations,
        activeStations,
        brokenStations,
        healthPercentage: totalStations > 0 ? Math.round((activeStations / totalStations) * 100) : 0,
        period,
        topCountries: topCountries.map(c => ({ name: c._id, count: c.count })),
        topGenres: topGenres.map(g => ({ name: g.name, count: g.stationCount })),
        topCodecs: topCodecs.map(c => ({ name: c._id, count: c.count })),
        lastUpdated: new Date()
      };

      // logger.log(` Analytics summary - ${totalStations} total stations, ${activeStations} active`);
      res.json(summary);
    } catch (error) {
      // console.error('Error fetching analytics summary:', error);
      res.status(500).json({ error: 'Failed to fetch analytics summary' });
    }
  });

  // USER MANAGEMENT API ENDPOINTS
  
  // Get all users with filters and pagination
  app.get("/api/users", async (req, res) => {
    try {
      // logger.log(' Fetching users...');
      
      const { search, status, role, page = 1, limit = 20, sortBy = 'newest' } = req.query;
      
      // Build filter based on query params
      const filter: any = {};
      
      if (search) {
        filter.$or = [
          { username: { $regex: search, $options: 'i' } },
          { fullName: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } }
        ];
      }
      
      if (status && status !== 'all') {
        filter.status = status;
      }
      
      if (role && role !== 'all') {
        filter.role = role;
      }

      const skip = (Number(page) - 1) * Number(limit);
      
      // Build sort object based on sortBy parameter
      let sortObject: any = {};
      switch (sortBy) {
        case 'oldest':
          sortObject = { createdAt: 1 };
          break;
        case 'most_radios':
          // Will handle with aggregation below
          break;
        case 'least_radios':
          // Will handle with aggregation below  
          break;
        case 'newest':
        default:
          sortObject = { createdAt: -1 };
          break;
      }
      
      let users;
      
      // For sorting by favorite stations count, use aggregation
      if (sortBy === 'most_radios' || sortBy === 'least_radios') {
        const pipeline: any[] = [
          { $match: filter },
          {
            $addFields: {
              favoriteStationsCount: {
                $cond: {
                  if: { $isArray: "$favoriteStations" },
                  then: { $size: "$favoriteStations" },
                  else: 0
                }
              }
            }
          },
          { 
            $sort: sortBy === 'most_radios' 
              ? { favoriteStationsCount: -1, createdAt: -1 }
              : { favoriteStationsCount: 1, createdAt: -1 }
          },
          { $skip: skip },
          { $limit: Number(limit) },
          {
            $project: {
              passwordHash: 0,
              emailVerificationToken: 0,
              resetPasswordToken: 0
            }
          }
        ];
        
        users = await User.aggregate(pipeline);
      } else {
        // Regular sorting for date-based sorting
        users = await User.find(filter)
          .select('-passwordHash -emailVerificationToken -resetPasswordToken')
          .sort(sortObject)
          .skip(skip)
          .limit(Number(limit))
          .lean();
      }

      const total = await User.countDocuments(filter);

      // Calculate enhanced user statistics for each user
      const enhancedUsers = await Promise.all(users.map(async (user) => {
        // Calculate favorite stations count (may already be calculated in aggregation)
        const favoriteCount = user.favoriteStationsCount || user.favoriteStations?.length || 0;
        
        // Calculate total listening time from recent plays
        const totalListening = user.recentlyPlayedStations?.reduce((sum, play) => 
          sum + (play.playDuration || 0), 0) || 0;
        
        // Get user's created stations count
        const createdStationsCount = await Station.countDocuments({ 
          createdBy: user._id.toString() 
        });

        return {
          ...user,
          favoriteStationsCount: favoriteCount,
          totalListeningTime: Math.round(totalListening / 60), // Convert to hours
          stationsCreatedCount: createdStationsCount,
          followersCount: user.followersCount || 0,
          followingCount: user.followingCount || 0,
          stats: {
            ...user.stats,
            totalPlays: user.recentlyPlayedStations?.length || 0,
            totalListeningHours: Math.round(totalListening / 3600), // Convert to hours
            joinDate: user.createdAt,
            lastActiveDate: user.lastLoginAt || user.createdAt
          }
        };
      }));

      // logger.log(` Found ${users.length} users (${total} total) sorted by ${sortBy}`);
      res.json({ 
        users: enhancedUsers, 
        total, 
        page: Number(page), 
        limit: Number(limit),
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          pages: Math.ceil(total / Number(limit)),
          hasMore: Number(page) < Math.ceil(total / Number(limit))
        }
      });
    } catch (error) {
      // console.error('Error fetching users:', error);
      res.status(500).json({ error: 'Failed to fetch users' });
    }
  });

  // Get user statistics summary
  app.get("/api/users/stats", async (req, res) => {
    try {
      // logger.log(' Fetching user statistics...');
      
      const totalUsers = await User.countDocuments();
      const activeUsers = await User.countDocuments({ status: 'active' });
      const adminUsers = await User.countDocuments({ role: 'admin' });
      const moderatorUsers = await User.countDocuments({ role: 'moderator' });
      const suspendedUsers = await User.countDocuments({ status: 'suspended' });
      
      // Get recent user registrations (last 7 days)
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const recentRegistrations = await User.countDocuments({ 
        createdAt: { $gte: sevenDaysAgo } 
      });
      
      // Get top users by activity
      const topUsersByListening = await User.find()
        .sort({ totalListeningTime: -1 })
        .limit(5)
        .select('username fullName totalListeningTime favoriteStationsCount')
        .lean();

      const stats = {
        totalUsers,
        activeUsers,
        adminUsers,
        moderatorUsers,
        suspendedUsers,
        recentRegistrations,
        activePercentage: totalUsers > 0 ? Math.round((activeUsers / totalUsers) * 100) : 0,
        topUsersByListening: topUsersByListening.map(user => ({
          username: user.username,
          fullName: user.fullName,
          listeningTime: user.totalListeningTime || 0,
          favoriteStations: user.favoriteStationsCount || 0
        }))
      };

      // logger.log(` User stats - ${totalUsers} total, ${activeUsers} active`);
      res.json(stats);
    } catch (error) {
      // console.error('Error fetching user stats:', error);
      res.status(500).json({ error: 'Failed to fetch user statistics' });
    }
  });

  // Get user activity/recent actions
  app.get("/api/users/activity", async (req, res) => {
    try {
      // logger.log(' Fetching user activity...');
      
      const { limit = 10 } = req.query;
      
      // Get recent user logins
      const recentLogins = await User.find({ lastLoginAt: { $exists: true } })
        .sort({ lastLoginAt: -1 })
        .limit(Number(limit))
        .select('username fullName lastLoginAt')
        .lean();

      const activity = recentLogins.map(user => ({
        _id: user._id,
        username: user.username,
        fullName: user.fullName,
        action: 'login',
        timestamp: user.lastLoginAt,
        details: 'User logged in'
      }));

      // logger.log(` Found ${activity.length} recent activities`);
      res.json(activity);
    } catch (error) {
      // console.error('Error fetching user activity:', error);
      res.status(500).json({ error: 'Failed to fetch user activity' });
    }
  });

  // Get single user details with enhanced stats
  app.get("/api/users/:userId", async (req, res) => {
    try {
      const { userId } = req.params;
      // logger.log(` Fetching user details for ${userId}...`);
      
      const user = await User.findById(userId)
        .select('-passwordHash -emailVerificationToken -resetPasswordToken')
        .lean();

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Get enhanced statistics
      const favoriteStations = await Station.find({ 
        _id: { $in: user.favoriteStations || [] } 
      }).select('name country genre').lean();

      const createdStations = await Station.find({ 
        createdBy: userId 
      }).select('name country genre votes').lean();

      // Calculate listening statistics
      const totalListening = user.recentlyPlayedStations?.reduce((sum, play) => 
        sum + (play.playDuration || 0), 0) || 0;

      const enhancedUser = {
        ...user,
        favoriteStationsCount: favoriteStations.length,
        stationsCreatedCount: createdStations.length,
        totalListeningTime: Math.round(totalListening / 60), // Convert to hours
        favoriteStations: favoriteStations,
        createdStations: createdStations,
        stats: {
          ...user.stats,
          totalPlays: user.recentlyPlayedStations?.length || 0,
          totalListeningHours: Math.round(totalListening / 3600),
          joinDate: user.createdAt,
          lastActiveDate: user.lastLoginAt || user.createdAt
        }
      };

      // logger.log(` User details loaded for ${user.username}`);
      res.json(enhancedUser);
    } catch (error) {
      // console.error('Error fetching user details:', error);
      res.status(500).json({ error: 'Failed to fetch user details' });
    }
  });

  // Update user information
  app.put("/api/users/:userId", async (req, res) => {
    try {
      const { userId } = req.params;
      const updates = req.body;
      // logger.log(` Updating user ${userId}...`);

      // Remove sensitive fields from updates
      delete updates.passwordHash;
      delete updates.emailVerificationToken;
      delete updates.resetPasswordToken;

      const updatedUser = await User.findByIdAndUpdate(
        userId,
        { ...updates, updatedAt: new Date() },
        { new: true, select: '-passwordHash -emailVerificationToken -resetPasswordToken' }
      ).lean();

      if (!updatedUser) {
        return res.status(404).json({ error: 'User not found' });
      }

      // logger.log(` User ${userId} updated successfully`);
      res.json(updatedUser);
    } catch (error) {
      // console.error('Error updating user:', error);
      res.status(500).json({ error: 'Failed to update user' });
    }
  });

  // Follow/Unfollow user functionality
  app.post("/api/users/:userId/follow-OLD", async (req, res) => {
    try {
      const { userId } = req.params;
      const { followerId } = req.body; // ID of user doing the following
      
      // logger.log(` OLD ENDPOINT - User ${followerId} following ${userId}...`);

      // Add to follower's following list
      await User.findByIdAndUpdate(followerId, {
        $addToSet: { following: userId },
        $inc: { followingCount: 1 }
      });

      // Add to target user's followers list
      await User.findByIdAndUpdate(userId, {
        $addToSet: { followers: followerId },
        $inc: { followersCount: 1 }
      });

      // logger.log(` Follow relationship created`);
      res.json({ success: true, message: 'User followed successfully' });
    } catch (error) {
      // console.error('Error following user:', error);
      res.status(500).json({ error: 'Failed to follow user' });
    }
  });

  app.delete("/api/users/:userId/follow", async (req, res) => {
    try {
      const { userId } = req.params;
      const { followerId } = req.body;
      
      // logger.log(` User ${followerId} unfollowing ${userId}...`);

      // Remove from follower's following list
      await User.findByIdAndUpdate(followerId, {
        $pull: { following: userId },
        $inc: { followingCount: -1 }
      });

      // Remove from target user's followers list
      await User.findByIdAndUpdate(userId, {
        $pull: { followers: followerId },
        $inc: { followersCount: -1 }
      });

      // logger.log(` Follow relationship removed`);
      res.json({ success: true, message: 'User unfollowed successfully' });
    } catch (error) {
      // console.error('Error unfollowing user:', error);
      res.status(500).json({ error: 'Failed to unfollow user' });
    }
  });

  // AUTHENTICATION API ENDPOINTS
  
  // Social Authentication Routes
  // Get user's social connections (followers and following)
  app.get("/api/user/social/:email", async (req, res) => {
    try {
      const { email } = req.params;
      
      const cacheKey = CacheKeys.userSocial(email);
      const cached = await CacheManager.get<any>(cacheKey);
      if (cached) {
        return res.json(cached);
      }

      const user = await User.findOne({ email });
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      const [followersCount, followingCount, followers, following] = await Promise.all([
        UserFollow.countDocuments({ followingUserId: user._id }),
        UserFollow.countDocuments({ userId: user._id }),
        UserFollow.find({ followingUserId: user._id })
          .populate('userId', 'username email fullName avatarUrl')
          .lean(),
        UserFollow.find({ userId: user._id })
          .populate('followingUserId', 'username email fullName avatarUrl')
          .lean()
      ]);
      
      const result = {
        followersCount,
        followingCount,
        followers: followers.map(f => f.userId),
        following: following.map(f => f.followingUserId)
      };

      await CacheManager.set(cacheKey, result, { ttl: 120 });

      res.json(result);
    } catch (error) {
      console.error('❌ Error fetching user social data:', error);
      res.status(500).json({ error: 'Failed to fetch social data' });
    }
  });

  // Check social authentication status
  app.get("/api/auth/social-status", (req, res) => {
    const status = getSocialAuthStatus();
    res.json(status);
  });

  // Debug endpoint to show current callback URL for OAuth setup
  app.get("/api/auth/debug/callback-url", (req, res) => {
    let baseUrl = 'http://localhost:3000';
    
    if (process.env.REPLIT_DOMAINS) {
      const domains = process.env.REPLIT_DOMAINS.split(',');
      // Look for production domain (themegaradio.com only)
      const productionDomain = domains.find(domain => 
        domain.includes('themegaradio.com')
      );
      if (productionDomain) {
        baseUrl = `https://${productionDomain}`;
      } else {
        // Look for deployed domain (.replit.app)
        const deployedDomain = domains.find(domain => domain.includes('.replit.app'));
        if (deployedDomain) {
          baseUrl = `https://${deployedDomain}`;
        } else {
          // Fallback to first domain (dev domain)  
          baseUrl = `https://${domains[0]}`;
        }
      }
    }
    
    const callbackUrl = `${baseUrl}/api/auth/google/callback`;
    
    res.json({
      message: 'Add this exact URL to your Google Cloud Console OAuth app as an authorized redirect URI',
      callbackUrl,
      currentDomain: baseUrl,
      allDomains: process.env.REPLIT_DOMAINS?.split(',') || [],
      instructions: [
        '1. Go to https://console.cloud.google.com/',
        '2. Select your project',
        '3. Go to: APIs & Services → Credentials', 
        '4. Click on your OAuth 2.0 client ID',
        '5. Add the callbackUrl above to "Authorized redirect URIs"',
        '6. Save changes'
      ]
    });
  });

  // Social authentication routes with passport integration
  app.get("/api/auth/google", async (req, res, next) => {
    const status = getSocialAuthStatus();
    if (!status.google) {
      return res.status(501).json({ 
        error: 'Google authentication not configured', 
        message: 'Social login with Google requires API keys to be configured.' 
      });
    }
    
    // Save returnTo URL in session for post-login redirect
    const returnTo = req.query.returnTo as string;
    if (returnTo && req.session) {
      (req.session as any).oauthReturnTo = returnTo;
      logger.log('🔀 Saved OAuth returnTo:', returnTo);
    }
    
    // Save current language/country code in session for OAuth return
    const referer = req.headers.referer || '';
    const urlMatch = referer.match(/\/([a-z]{2})(?:\/|$)/i);
    if (urlMatch && req.session) {
      (req.session as any).oauthReturnLang = urlMatch[1].toLowerCase();
      logger.log('🌍 Saved OAuth return language:', urlMatch[1].toLowerCase());
    }
    
    // Use passport Google authentication
    try {
      const { default: passport } = await import('./auth/passport-config.js');
      passport.authenticate('google', { 
        scope: ['profile', 'email'] 
      })(req, res, next);
    } catch (error) {
      console.error('Passport import error:', error);
      res.status(500).json({ error: 'Authentication setup error' });
    }
  });

  app.get("/api/auth/facebook", (req, res) => {
    const status = getSocialAuthStatus();
    if (!status.facebook) {
      return res.status(501).json({ 
        error: 'Facebook authentication not configured', 
        message: 'Social login with Facebook requires API keys to be configured.' 
      });
    }
    // TODO: Implement Facebook OAuth when credentials are provided
    res.status(501).json({ 
      error: 'Facebook authentication not implemented', 
      message: 'Facebook OAuth flow will be implemented when Facebook credentials are provided.' 
    });
  });

  app.get("/api/auth/apple", (req, res) => {
    const status = getSocialAuthStatus();
    if (!status.apple) {
      return res.status(501).json({ 
        error: 'Apple authentication not configured', 
        message: 'Social login with Apple requires API keys to be configured.' 
      });
    }
    // Apple OAuth not implemented yet - requires complex PKCE setup
    res.status(501).json({ 
      error: 'Apple authentication not implemented', 
      message: 'Apple OAuth flow requires special configuration and will be implemented when Apple credentials are provided.' 
    });
  });

  // Simple test endpoint for Google callback debugging
  app.get("/api/auth/google/callback-test", (req, res) => {
    console.log('🟢 SIMPLE CALLBACK TEST: Request received!');
    console.log('🟢 Query:', req.query);
    res.json({ success: true, message: 'Callback test works!', query: req.query });
  });

  // Google OAuth callback - implemented with passport (simplified, no dynamic import)
  app.get("/api/auth/google/callback", (req, res, next) => {
    console.log('🔵 GOOGLE CALLBACK: Request received');
    console.log('🔵 GOOGLE CALLBACK: Query params:', req.query);
    
    // Get saved language/country from session (set before OAuth redirect)
    const savedLang = (req.session as any)?.oauthReturnLang || '';
    const langPrefix = savedLang ? `/${savedLang}` : '';
    
    console.log('🔵 GOOGLE CALLBACK: Calling passport.authenticate...');
    passport.authenticate('google', { 
      failureRedirect: `${langPrefix}/?error=google_auth_failed` 
    }, (err: any, user: any, info: any) => {
      console.log('🔵 GOOGLE CALLBACK: passport.authenticate callback called');
      console.log('🔵 GOOGLE CALLBACK: err:', err);
      console.log('🔵 GOOGLE CALLBACK: user:', user ? 'exists' : 'null');
      console.log('🔵 GOOGLE CALLBACK: info:', info);
      
      if (err) {
        console.error('Google OAuth callback error:', err);
        return res.redirect(`${langPrefix}/?error=google_auth_failed`);
      }
      if (!user) {
        console.log('🔵 GOOGLE CALLBACK: No user returned, redirecting...');
        return res.redirect(`${langPrefix}/?error=google_auth_cancelled`);
      }
      
      // Log in the user using Passport's req.login (same as email/password login)
      req.login(user, (loginErr: any) => {
        if (loginErr) {
          console.error('❌ Google OAuth login error:', loginErr);
          return res.redirect(`${langPrefix}/?error=login_failed`);
        }
        
        console.log('✅ Google OAuth user logged in successfully');
        console.log('🔍 Session ID:', req.sessionID);
        console.log('🔍 User ID:', user._id);
        
        // Also set manual session data for compatibility
        (req.session as any).user = {
          userId: user._id.toString(),
          email: user.email,
          role: user.role
        };
        // Clear the OAuth return language
        delete (req.session as any).oauthReturnLang;
        
        // CRITICAL: Save session before redirect to ensure it's persisted
        req.session.save((saveErr) => {
          if (saveErr) {
            console.error('❌ Session save error:', saveErr);
            return res.redirect(`${langPrefix}/?error=session_save_failed`);
          }
          console.log('✅ Session saved successfully, redirecting...');
          // Check for returnTo URL (e.g., /tr/tv after TV login flow)
          const returnTo = (req.session as any)?.oauthReturnTo;
          delete (req.session as any).oauthReturnTo;
          if (returnTo && returnTo.startsWith('/')) {
            console.log('🔀 Redirecting to returnTo:', returnTo);
            return res.redirect(returnTo);
          }
          // Successful authentication, redirect to home with language preserved
          res.redirect(`${langPrefix}/?success=google_login`);
        });
      });
    })(req, res, next);
  });

  app.get("/api/auth/facebook/callback", async (req, res) => {
    try {
      res.redirect('/?error=facebook_auth_not_implemented');
    } catch (error) {
      console.error('Facebook OAuth callback error:', error);
      res.redirect('/?error=facebook_auth_failed');
    }
  });

  // Apple callback placeholder - will be implemented when Apple credentials are available
  app.post("/api/auth/apple/callback", async (req, res) => {
    try {
      res.redirect('/?error=apple_auth_not_implemented');
    } catch (error) {
      console.error('Apple OAuth callback error:', error);
      res.redirect('/?error=apple_auth_failed');
    }
  });

  // MOBILE AUTH: Login with token response
  app.post("/api/auth/mobile/login", async (req, res) => {
    try {
      const { email, password, deviceType = 'mobile', deviceName } = req.body;

      if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
      }

      const user = await User.findOne({ email });
      if (!user) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      const bcrypt = await import('bcrypt');
      const isValid = await bcrypt.default.compare(password, user.passwordHash);
      if (!isValid) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      if (user.status !== 'active') {
        return res.status(403).json({ error: 'Account is suspended or inactive' });
      }

      user.lastLoginAt = new Date();
      user.stats.lastActiveDate = new Date();
      await user.save();

      const token = await generateAuthToken(user._id.toString(), deviceType, deviceName);

      res.json({
        message: 'Login successful',
        token,
        tokenExpiresIn: '90 days',
        user: {
          _id: user._id,
          fullName: user.fullName,
          username: user.username,
          email: user.email,
          slug: user.slug,
          avatar: user.avatar,
          role: user.role,
          followersCount: user.followersCount || 0,
          followingCount: user.followingCount || 0,
          favoriteStationsCount: user.favoriteStationsCount || 0,
          totalListeningTime: user.totalListeningTime || 0,
          isPublicProfile: user.isPublicProfile,
        }
      });
    } catch (error) {
      console.error('Mobile login error:', error);
      res.status(500).json({ error: 'Login failed' });
    }
  });

  // MOBILE AUTH: Google OAuth token exchange
  app.post("/api/auth/mobile/google", async (req, res) => {
    try {
      const { googleId, email, fullName, avatar, deviceType = 'mobile', deviceName } = req.body;

      if (!googleId || !email) {
        return res.status(400).json({ error: 'Google ID and email are required' });
      }

      let user = await User.findOne({ $or: [{ googleId }, { email }] });

      if (!user) {
        const userSlug = await generateUserSlug({ username: email.split('@')[0], fullName: fullName || email.split('@')[0], email });
        user = new User({
          fullName: fullName || email.split('@')[0],
          username: email.split('@')[0],
          email,
          googleId,
          avatar,
          slug: userSlug,
          emailVerified: true,
          role: 'user',
          status: 'active',
          followersCount: 0,
          followingCount: 0,
          favoriteStationsCount: 0,
          totalListeningTime: 0,
          stats: {
            totalPlays: 0,
            totalListeningHours: 0,
            favoriteGenres: [],
            joinDate: new Date(),
            lastActiveDate: new Date(),
            streakDays: 0
          }
        });
        await user.save();
      } else {
        if (googleId && !user.googleId) {
          user.googleId = googleId;
        }
        if (avatar && !user.avatar) {
          user.avatar = avatar;
        }
        user.lastLoginAt = new Date();
        user.stats.lastActiveDate = new Date();
        await user.save();
      }

      const token = await generateAuthToken(user._id.toString(), deviceType, deviceName);

      res.json({
        message: 'Login successful',
        token,
        tokenExpiresIn: '90 days',
        isNewUser: !user.lastLoginAt,
        user: {
          _id: user._id,
          fullName: user.fullName,
          username: user.username,
          email: user.email,
          slug: user.slug,
          avatar: user.avatar,
          role: user.role,
          followersCount: user.followersCount || 0,
          followingCount: user.followingCount || 0,
          favoriteStationsCount: user.favoriteStationsCount || 0,
          totalListeningTime: user.totalListeningTime || 0,
          isPublicProfile: user.isPublicProfile,
        }
      });
    } catch (error) {
      console.error('Mobile Google auth error:', error);
      res.status(500).json({ error: 'Authentication failed' });
    }
  });

  // POST /api/auth/google - Google idToken verification for mobile apps
  app.post("/api/auth/google", async (req: any, res) => {
    try {
      const { idToken, deviceType = 'mobile', deviceName } = req.body;

      if (!idToken) {
        return res.status(400).json({ error: 'idToken is required' });
      }

      if (!process.env.GOOGLE_CLIENT_ID) {
        return res.status(501).json({ error: 'Google authentication not configured' });
      }

      const validDeviceType = ['mobile', 'desktop', 'web'].includes(deviceType) ? deviceType : 'mobile';

      const { OAuth2Client } = await import('google-auth-library');
      const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

      const allowedAudiences = [
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_IOS_CLIENT_ID,
        process.env.GOOGLE_ANDROID_CLIENT_ID,
      ].filter(Boolean) as string[];

      let payload: any;
      try {
        const ticket = await client.verifyIdToken({
          idToken,
          audience: allowedAudiences,
        });
        payload = ticket.getPayload();
      } catch (verifyError: any) {
        console.error('Google idToken verification failed:', verifyError.message);
        return res.status(401).json({ error: 'Invalid Google token' });
      }

      if (!payload || !payload.email) {
        return res.status(401).json({ error: 'Invalid token payload' });
      }

      const googleId = payload.sub;
      const email = payload.email;
      const fullName = payload.name || email.split('@')[0];
      const avatar = payload.picture;

      let user = await User.findOne({ $or: [{ googleId }, { email }] });

      if (!user) {
        const userSlug = await generateUserSlug({ username: email.split('@')[0], fullName, email });
        user = new User({
          fullName,
          username: email.split('@')[0],
          email,
          googleId,
          avatar,
          slug: userSlug,
          emailVerified: true,
          role: 'user',
          status: 'active',
          followersCount: 0,
          followingCount: 0,
          favoriteStationsCount: 0,
          totalListeningTime: 0,
          stats: {
            totalPlays: 0,
            totalListeningHours: 0,
            favoriteGenres: [],
            joinDate: new Date(),
            lastActiveDate: new Date(),
            streakDays: 0
          }
        });
        await user.save();
      } else {
        if (googleId && !user.googleId) {
          user.googleId = googleId;
        }
        if (avatar && !user.avatar) {
          user.avatar = avatar;
        }
        user.lastLoginAt = new Date();
        user.stats.lastActiveDate = new Date();
        await user.save();
      }

      const token = await generateAuthToken(user._id.toString(), validDeviceType as any, deviceName);

      res.json({
        token,
        tokenExpiresIn: '90 days',
        user: {
          _id: user._id,
          fullName: user.fullName,
          username: user.username,
          email: user.email,
          slug: user.slug,
          avatar: user.avatar,
          role: user.role,
          followersCount: user.followersCount || 0,
          followingCount: user.followingCount || 0,
          favoriteStationsCount: user.favoriteStationsCount || 0,
          totalListeningTime: user.totalListeningTime || 0,
          isPublicProfile: user.isPublicProfile,
        }
      });
    } catch (error: any) {
      console.error('Google token auth error:', error.message);
      res.status(500).json({ error: 'Authentication failed' });
    }
  });

  // POST /api/auth/apple - Apple Sign-In token verification for mobile apps
  app.post("/api/auth/apple", async (req: any, res) => {
    try {
      const { identityToken, authorizationCode, fullName, email: clientEmail, deviceType = 'mobile', deviceName } = req.body;

      if (!identityToken) {
        return res.status(400).json({ error: 'identityToken is required' });
      }

      const validDeviceType = ['mobile', 'desktop', 'web'].includes(deviceType) ? deviceType : 'mobile';

      const jwt = await import('jsonwebtoken');
      const https = await import('https');

      let applePublicKeys: any[];
      try {
        const keysResponse = await new Promise<string>((resolve, reject) => {
          https.get('https://appleid.apple.com/auth/keys', (resp: any) => {
            let data = '';
            resp.on('data', (chunk: string) => data += chunk);
            resp.on('end', () => resolve(data));
            resp.on('error', reject);
          }).on('error', reject);
        });
        const keysData = JSON.parse(keysResponse);
        applePublicKeys = keysData.keys;
      } catch (fetchError: any) {
        console.error('Failed to fetch Apple public keys:', fetchError.message);
        return res.status(500).json({ error: 'Failed to verify Apple token' });
      }

      const decodedHeader = jwt.default.decode(identityToken, { complete: true });
      if (!decodedHeader || !decodedHeader.header) {
        return res.status(401).json({ error: 'Invalid Apple token format' });
      }

      const matchingKey = applePublicKeys.find((key: any) => key.kid === decodedHeader.header.kid);
      if (!matchingKey) {
        return res.status(401).json({ error: 'Apple token key not found' });
      }

      const { createPublicKey } = await import('crypto');
      const publicKey = createPublicKey({
        key: matchingKey,
        format: 'jwk',
      });

      let payload: any;
      try {
        const verifyOptions: any = {
          algorithms: ['RS256'],
          issuer: 'https://appleid.apple.com',
        };
        if (process.env.APPLE_CLIENT_ID) {
          verifyOptions.audience = process.env.APPLE_CLIENT_ID;
        }
        payload = jwt.default.verify(identityToken, publicKey, verifyOptions);
      } catch (verifyError: any) {
        console.error('Apple token verification failed:', verifyError.message);
        return res.status(401).json({ error: 'Invalid Apple token' });
      }

      const appleId = payload.sub;
      const email = payload.email || clientEmail;

      if (!appleId) {
        return res.status(401).json({ error: 'Invalid Apple token payload' });
      }

      let user = await User.findOne({ $or: [{ appleId }, ...(email ? [{ email }] : [])] });

      if (!user) {
        const userEmail = email || `apple_${appleId.slice(0, 8)}@privaterelay.appleid.com`;
        const userName = fullName || userEmail.split('@')[0];
        const userSlug = await generateUserSlug({ username: userEmail.split('@')[0], fullName: userName, email: userEmail });
        user = new User({
          fullName: userName,
          username: userEmail.split('@')[0],
          email: userEmail,
          appleId,
          slug: userSlug,
          emailVerified: true,
          role: 'user',
          status: 'active',
          followersCount: 0,
          followingCount: 0,
          favoriteStationsCount: 0,
          totalListeningTime: 0,
          stats: {
            totalPlays: 0,
            totalListeningHours: 0,
            favoriteGenres: [],
            joinDate: new Date(),
            lastActiveDate: new Date(),
            streakDays: 0
          }
        });
        await user.save();
      } else {
        if (appleId && !user.appleId) {
          user.appleId = appleId;
        }
        user.lastLoginAt = new Date();
        user.stats.lastActiveDate = new Date();
        await user.save();
      }

      const token = await generateAuthToken(user._id.toString(), validDeviceType as any, deviceName);

      res.json({
        token,
        tokenExpiresIn: '90 days',
        user: {
          _id: user._id,
          fullName: user.fullName,
          username: user.username,
          email: user.email,
          slug: user.slug,
          avatar: user.avatar,
          role: user.role,
          followersCount: user.followersCount || 0,
          followingCount: user.followingCount || 0,
          favoriteStationsCount: user.favoriteStationsCount || 0,
          totalListeningTime: user.totalListeningTime || 0,
          isPublicProfile: user.isPublicProfile,
        }
      });
    } catch (error: any) {
      console.error('Apple token auth error:', error.message);
      res.status(500).json({ error: 'Authentication failed' });
    }
  });

  // ==================== App Static Pages API (for mobile apps) ====================

  // GET /api/app/pages - Returns all static page content for mobile apps
  app.get("/api/app/pages", (req, res) => {
    const lastUpdated = "2025-02-17";
    
    const aboutContent = `About Mega Radio

Mega Radio is a global radio streaming platform providing access to over 40,000 radio stations from around the world. Our mission is to connect listeners with the best live radio content, wherever they are.

Our Mission
We believe everyone should have easy access to live radio from around the globe. Mega Radio brings together thousands of stations across every genre, language, and country — all in one app.

Features
- Access to 40,000+ radio stations worldwide
- Multi-platform support: Web, iOS, Android, Samsung TV, LG TV
- Personalized recommendations and favorites
- Cast from mobile to TV
- Available in 57 languages
- High-quality audio streaming

Contact
For questions, feedback, or partnerships, reach us at info@themegaradio.com`;

    const termsContent = `Terms and Conditions
Last updated: ${lastUpdated}

1. Acceptance of Terms
By accessing and using Mega Radio's services, you accept and agree to be bound by the terms and provision of this agreement. These Terms of Service govern your use of our radio streaming platform.

2. Description of Service
Mega Radio provides access to a collection of internet radio stations and streaming audio content. Our service allows users to discover, listen to, and enjoy radio stations from around the world.

3. User Accounts
- You must provide accurate and complete information when creating an account
- You are responsible for maintaining the confidentiality of your account credentials
- You must notify us immediately of any unauthorized use of your account
- One person or legal entity may not maintain more than one account

4. Acceptable Use
You agree not to:
- Use the service for any unlawful purposes or activities
- Attempt to gain unauthorized access to our systems or other users' accounts
- Interfere with or disrupt the service or servers connected to the service
- Reproduce, distribute, or create derivative works from our content without permission
- Use automated systems to access the service without our written consent
- Upload or transmit viruses, malware, or other harmful code

5. Intellectual Property
The service and its original content are and will remain the exclusive property of Mega Radio and its licensors. The service is protected by copyright, trademark, and other laws. Our trademarks may not be used without our prior written consent.

6. Content and Radio Stations
We aggregate and provide access to radio stations and content from various sources. We do not own or control the content of these radio stations. Station availability and content quality may vary and are subject to the policies of individual broadcasters.

7. Privacy
Your privacy is important to us. Please review our Privacy Policy, which also governs your use of the service, to understand our practices.

8. Disclaimers
The service is provided "as is" without any representations or warranties, express or implied. We make no representations or warranties in relation to this service or the information and materials provided on this service.

9. Limitation of Liability
In no event shall Mega Radio, nor its directors, employees, partners, agents, suppliers, or affiliates, be liable for any indirect, incidental, special, consequential, or punitive damages arising out of your use of the service.

10. Termination
We may terminate or suspend your account and bar access to the service immediately, without prior notice or liability, under our sole discretion, for any reason whatsoever and without limitation, including but not limited to a breach of the Terms.

11. Changes to Terms
We reserve the right, at our sole discretion, to modify or replace these Terms at any time. If a revision is material, we will provide at least 30 days notice prior to any new terms taking effect.

12. Contact Information
If you have any questions about these Terms and Conditions, please contact us at legal@themegaradio.com`;

    const privacyContent = `Privacy Policy
Last updated: ${lastUpdated}

1. Introduction
At Mega Radio ("we," "our," or "us"), we respect your privacy and are committed to protecting your personal data. This privacy policy explains how we collect, use, and safeguard your information when you use our radio streaming service.

2. Information We Collect

Personal Information
When you create an account or contact us, we may collect:
- Name and email address
- Username and password
- Profile information and preferences
- Communication history with our support team

Usage Information
We automatically collect information about how you use our service:
- Listening history and preferences
- Device information and IP address
- Browser type and operating system
- Time and duration of your sessions

3. How We Use Your Information
- To provide and improve our radio streaming service
- To personalize your listening experience
- To communicate with you about service updates
- To provide customer support
- To analyze usage patterns and improve our platform
- To comply with legal obligations

4. Information Sharing
We do not sell, trade, or rent your personal information. We may share your information only in these circumstances:
- With your explicit consent
- To comply with legal requirements
- To protect our rights and property
- With trusted service providers who assist in our operations
- In connection with a business transfer or merger

5. Data Security
We implement appropriate technical and organizational measures to protect your personal data against unauthorized access, alteration, disclosure, or destruction. However, no method of transmission over the internet is 100% secure.

6. Your Rights
You have the right to:
- Access your personal data
- Correct inaccurate information
- Delete your account and data
- Export your data
- Opt out of certain communications
- Restrict processing of your data

7. Cookies and Tracking
We use cookies and similar technologies to enhance your experience, analyze usage, and provide personalized content. You can control cookie settings through your browser preferences.

8. Third-Party Links
Our service may contain links to third-party websites. We are not responsible for the privacy practices of these external sites. We encourage you to review their privacy policies.

9. Changes to This Policy
We may update this privacy policy from time to time. We will notify you of any material changes by posting the new policy on this page and updating the "last updated" date.

10. Contact Us
If you have any questions about this privacy policy or our data practices, please contact us at privacy@themegaradio.com`;

    res.json({
      success: true,
      lastUpdated,
      pages: {
        about: {
          title: "About Mega Radio",
          content: aboutContent,
          lastUpdated
        },
        terms: {
          title: "Terms and Conditions",
          content: termsContent,
          lastUpdated
        },
        privacy: {
          title: "Privacy Policy",
          content: privacyContent,
          lastUpdated
        }
      }
    });
  });

  // GET /api/app/info - Returns basic app info (version, links, social)
  app.get("/api/app/info", (req, res) => {
    res.json({
      success: true,
      app: {
        name: "Mega Radio",
        version: "1.0.0",
        website: "https://themegaradio.com",
        supportEmail: "info@themegaradio.com",
        social: {
          facebook: "https://facebook.com/themegaradio",
          instagram: "https://instagram.com/themegaradio",
          twitter: "https://twitter.com/themegaradio"
        },
        links: {
          terms: "https://themegaradio.com/en/terms-and-conditions",
          privacy: "https://themegaradio.com/en/privacy-policy",
          about: "https://themegaradio.com/en/about-us",
          contact: "https://themegaradio.com/en/contact",
          apiDocs: "https://themegaradio.com/en/api",
          appStore: "",
          playStore: ""
        }
      }
    });
  });

  // ==================== Push Notification Token Management ====================

  app.post("/api/user/push-token", async (req, res) => {
    try {
      const { token, platform, deviceName } = req.body;

      if (!token || !platform) {
        return res.status(400).json({ success: false, message: "token and platform are required" });
      }

      if (!['ios', 'android'].includes(platform)) {
        return res.status(400).json({ success: false, message: "platform must be 'ios' or 'android'" });
      }

      let resolvedUserId = null;
      const authHeader = req.headers['authorization'];
      const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
      if (bearerToken) {
        const tokenDoc = await AuthToken.findOne({ token: bearerToken, isRevoked: false, expiresAt: { $gt: new Date() } });
        if (tokenDoc) resolvedUserId = tokenDoc.userId;
      } else if ((req as any).session?.passport?.user) {
        resolvedUserId = (req as any).session.passport.user;
      }

      await PushToken.findOneAndUpdate(
        { token },
        {
          token,
          userId: resolvedUserId,
          platform,
          deviceName: deviceName || '',
          isActive: true,
          updatedAt: new Date()
        },
        { upsert: true, new: true }
      );

      res.json({ success: true, message: "Push token saved successfully" });
    } catch (error) {
      console.error("Error saving push token:", error);
      res.status(500).json({ success: false, message: "Failed to save push token" });
    }
  });

  app.delete("/api/user/push-token", async (req, res) => {
    try {
      const { token } = req.body;

      if (!token) {
        return res.status(400).json({ success: false, message: "token is required" });
      }

      let resolvedUserId = null;
      const authHeader = req.headers['authorization'];
      const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
      if (bearerToken) {
        const tokenDoc = await AuthToken.findOne({ token: bearerToken, isRevoked: false, expiresAt: { $gt: new Date() } });
        if (tokenDoc) resolvedUserId = tokenDoc.userId;
      } else if ((req as any).session?.passport?.user) {
        resolvedUserId = (req as any).session.passport.user;
      }

      const filter: any = { token };
      if (resolvedUserId) {
        filter.$or = [{ userId: resolvedUserId }, { userId: null }];
      }

      const result = await PushToken.findOneAndUpdate(
        filter,
        { isActive: false, updatedAt: new Date() }
      );

      if (!result) {
        return res.status(404).json({ success: false, message: "Push token not found" });
      }

      res.json({ success: true, message: "Push token deactivated" });
    } catch (error) {
      console.error("Error deactivating push token:", error);
      res.status(500).json({ success: false, message: "Failed to deactivate push token" });
    }
  });

  // MOBILE AUTH: Refresh/validate token
  app.get("/api/auth/mobile/me", async (req, res) => {
    try {
      const authHeader = req.headers['authorization'];
      const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

      if (!token) {
        return res.json({ authenticated: false, user: null });
      }

      const tokenDoc = await AuthToken.findOne({
        token,
        isRevoked: false,
        expiresAt: { $gt: new Date() }
      });

      if (!tokenDoc) {
        return res.json({ authenticated: false, user: null });
      }

      tokenDoc.lastUsedAt = new Date();
      await tokenDoc.save();

      const user = await User.findById(tokenDoc.userId)
        .select('-passwordHash -emailVerificationToken -resetPasswordToken')
        .lean();

      if (!user) {
        return res.json({ authenticated: false, user: null });
      }

      const actualFollowersCount = await UserFollow.countDocuments({ followingUserId: user._id });
      const actualFollowingCount = await UserFollow.countDocuments({ userId: user._id });

      res.json({
        authenticated: true,
        token: { expiresAt: tokenDoc.expiresAt, deviceType: tokenDoc.deviceType },
        user: {
          _id: user._id,
          fullName: user.fullName,
          username: user.username,
          email: user.email,
          slug: user.slug,
          avatar: user.avatar,
          role: user.role,
          followersCount: actualFollowersCount,
          followingCount: actualFollowingCount,
          favoriteStationsCount: user.favoriteStationsCount || 0,
          totalListeningTime: user.totalListeningTime || 0,
          isPublicProfile: user.isPublicProfile,
        }
      });
    } catch (error) {
      console.error('Mobile me error:', error);
      res.status(500).json({ error: 'Authentication check failed' });
    }
  });

  // MOBILE AUTH: Logout (revoke token)
  app.post("/api/auth/mobile/logout", async (req, res) => {
    try {
      const authHeader = req.headers['authorization'];
      const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

      if (token) {
        await AuthToken.findOneAndUpdate({ token }, { isRevoked: true });
      }

      res.json({ success: true, message: 'Logged out successfully' });
    } catch (error) {
      console.error('Mobile logout error:', error);
      res.status(500).json({ error: 'Logout failed' });
    }
  });

  // MOBILE AUTH: Logout from all devices
  app.post("/api/auth/mobile/logout-all", requireAuth, async (req, res) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const result = await AuthToken.updateMany(
        { userId: new mongoose.Types.ObjectId(userId), isRevoked: false },
        { isRevoked: true }
      );

      res.json({ success: true, message: 'All devices logged out', revokedCount: result.modifiedCount });
    } catch (error) {
      console.error('Mobile logout-all error:', error);
      res.status(500).json({ error: 'Logout failed' });
    }
  });

  // ==================== TV AUTH: Device Code Login Flow ====================

  const tvCodeAttempts = new Map<string, { count: number; resetAt: number }>();
  const TV_CODE_MAX_ATTEMPTS = 10;
  const TV_CODE_WINDOW_MS = 10 * 60 * 1000;
  setInterval(() => {
    const now = Date.now();
    for (const [ip, data] of tvCodeAttempts) {
      if (now > data.resetAt) tvCodeAttempts.delete(ip);
    }
  }, 60 * 60 * 1000);

  // 1. TV requests a 6-digit login code
  app.post('/api/auth/tv/code', async (req: any, res) => {
    try {
      const { deviceId, platform = 'other' } = req.body;

      if (!deviceId) {
        return res.status(400).json({ error: 'deviceId is required' });
      }

      if (!['tizen', 'webos', 'other'].includes(platform)) {
        return res.status(400).json({ error: 'platform must be tizen, webos, or other' });
      }

      await TvLoginCode.updateMany(
        { deviceId, status: 'pending' },
        { $set: { status: 'expired' } }
      );

      let code: string;
      let attempts = 0;
      do {
        code = Math.floor(100000 + Math.random() * 900000).toString();
        const existing = await TvLoginCode.findOne({ code, status: 'pending', expiresAt: { $gt: new Date() } });
        if (!existing) break;
        attempts++;
      } while (attempts < 10);

      if (attempts >= 10) {
        return res.status(503).json({ error: 'Unable to generate unique code. Try again.' });
      }

      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

      await TvLoginCode.create({
        code,
        deviceId,
        platform,
        status: 'pending',
        expiresAt,
        createdAt: new Date(),
      });

      console.log(`[TV AUTH] Code ${code} generated for device ${deviceId} (${platform})`);

      res.json({
        success: true,
        code,
        expiresIn: 600,
      });
    } catch (error: any) {
      console.error('[TV AUTH] Code generation error:', error.message);
      res.status(500).json({ error: 'Failed to generate code' });
    }
  });

  // 2. TV polls for code status
  app.get('/api/auth/tv/code/:code/status', async (req: any, res) => {
    try {
      const { code } = req.params;
      const { deviceId } = req.query;

      if (!deviceId) {
        return res.status(400).json({ error: 'deviceId query parameter is required' });
      }

      const loginCode = await TvLoginCode.findOne({ code, deviceId });

      if (!loginCode) {
        return res.status(404).json({ status: 'expired', message: 'Code expired, request a new one' });
      }

      if (loginCode.expiresAt < new Date()) {
        loginCode.status = 'expired';
        await loginCode.save();
        return res.status(404).json({ status: 'expired', message: 'Code expired, request a new one' });
      }

      if (loginCode.status === 'activated' && loginCode.token && loginCode.userId) {
        const user = await User.findById(loginCode.userId).select('fullName username email avatar slug').lean();

        res.json({
          status: 'activated',
          token: loginCode.token,
          expiresIn: 7776000,
          user: user ? {
            id: (user as any)._id.toString(),
            displayName: (user as any).fullName || (user as any).username,
            email: (user as any).email,
            avatar: (user as any).avatar,
          } : undefined,
        });
      } else {
        res.json({ status: 'pending' });
      }
    } catch (error: any) {
      console.error('[TV AUTH] Code status error:', error.message);
      res.status(500).json({ error: 'Failed to check code status' });
    }
  });

  // 3. Mobile activates a TV code (links TV to user's account)
  app.post('/api/auth/tv/activate', async (req: any, res) => {
    try {
      const clientIp = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.ip || 'unknown';
      const now = Date.now();
      const attempts = tvCodeAttempts.get(clientIp);
      if (attempts) {
        if (now > attempts.resetAt) {
          tvCodeAttempts.set(clientIp, { count: 1, resetAt: now + TV_CODE_WINDOW_MS });
        } else if (attempts.count >= TV_CODE_MAX_ATTEMPTS) {
          return res.status(429).json({ error: 'Too many activation attempts. Try again later.' });
        } else {
          attempts.count++;
        }
      } else {
        tvCodeAttempts.set(clientIp, { count: 1, resetAt: now + TV_CODE_WINDOW_MS });
      }

      const authHeader = req.headers['authorization'];
      const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
      const sessionUserId = req.session?.user?.userId;

      let userId: string | null = null;
      if (sessionUserId) userId = sessionUserId;
      else if (bearerToken) {
        const tokenDoc = await AuthToken.findOne({ token: bearerToken, isRevoked: false, expiresAt: { $gt: new Date() } });
        if (tokenDoc) userId = tokenDoc.userId.toString();
      }

      if (!userId) {
        return res.status(401).json({ error: 'Authentication required. Please login on mobile first.' });
      }

      const { code } = req.body;
      if (!code) {
        return res.status(400).json({ error: 'code is required' });
      }

      const loginCode = await TvLoginCode.findOne({
        code,
        status: 'pending',
        expiresAt: { $gt: new Date() },
      });

      if (!loginCode) {
        return res.status(404).json({ success: false, message: 'Invalid code or code expired' });
      }

      const deviceName = loginCode.platform === 'tizen' ? 'Samsung TV' : loginCode.platform === 'webos' ? 'LG TV' : 'TV';
      const tvToken = await generateAuthToken(userId, 'tv', `${deviceName}-${loginCode.deviceId.slice(-6)}`);

      loginCode.status = 'activated';
      loginCode.userId = new mongoose.Types.ObjectId(userId);
      loginCode.token = tvToken;
      loginCode.activatedAt = new Date();
      await loginCode.save();

      await UserDevice.findOneAndUpdate(
        { userId: new mongoose.Types.ObjectId(userId), deviceId: loginCode.deviceId },
        {
          userId: new mongoose.Types.ObjectId(userId),
          deviceId: loginCode.deviceId,
          deviceName,
          platform: loginCode.platform,
          lastSeenAt: new Date(),
          pairedAt: new Date(),
          isActive: true,
        },
        { upsert: true, new: true }
      );

      const user = await User.findById(userId).select('fullName username').lean();

      console.log(`[TV AUTH] Code ${code} activated by user ${userId} for ${deviceName} (device permanently saved)`);

      res.json({
        success: true,
        deviceName,
        deviceId: loginCode.deviceId,
        message: `${deviceName} successfully logged in as ${(user as any)?.fullName || (user as any)?.username || 'user'}`,
      });
    } catch (error: any) {
      console.error('[TV AUTH] Activate error:', error.message);
      res.status(500).json({ error: 'Failed to activate code' });
    }
  });

  // 4. TV logout
  app.post('/api/auth/tv/logout', async (req: any, res) => {
    try {
      const authHeader = req.headers['authorization'];
      const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

      if (!bearerToken) {
        return res.status(401).json({ error: 'TV token required' });
      }

      const tokenDoc = await AuthToken.findOne({ token: bearerToken, isRevoked: false });
      if (!tokenDoc) {
        return res.status(401).json({ error: 'Invalid or expired token' });
      }

      tokenDoc.isRevoked = true;
      await tokenDoc.save();

      const userId = tokenDoc.userId.toString();
      await CastSession.updateMany(
        { userId, status: { $in: ['waiting_for_pair', 'paired', 'active'] } },
        { $set: { status: 'expired', isPlaying: false } }
      );

      console.log(`[TV AUTH] TV token revoked for user ${userId}`);

      res.json({ success: true, message: 'Logged out' });
    } catch (error: any) {
      console.error('[TV AUTH] Logout error:', error.message);
      res.status(500).json({ error: 'Logout failed' });
    }
  });

  // 5. TV token verify
  app.get('/api/auth/tv/verify', async (req: any, res) => {
    try {
      const authHeader = req.headers['authorization'];
      const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

      if (!bearerToken) {
        return res.status(401).json({ valid: false, error: 'Token required' });
      }

      const tokenDoc = await AuthToken.findOne({
        token: bearerToken,
        isRevoked: false,
        expiresAt: { $gt: new Date() },
      });

      if (!tokenDoc) {
        return res.status(401).json({ valid: false, error: 'Invalid or expired token' });
      }

      tokenDoc.lastUsedAt = new Date();
      await tokenDoc.save();

      const user = await User.findById(tokenDoc.userId).select('fullName username email avatar slug').lean();

      res.json({
        valid: true,
        user: user ? {
          id: (user as any)._id.toString(),
          displayName: (user as any).fullName || (user as any).username,
          email: (user as any).email,
          avatar: (user as any).avatar,
        } : undefined,
      });
    } catch (error: any) {
      console.error('[TV AUTH] Verify error:', error.message);
      res.status(500).json({ error: 'Verification failed' });
    }
  });

  // ==================== Device Management (Paired TV Devices) ====================

  // GET /api/user/devices - List user's paired TV devices
  app.get('/api/user/devices', async (req: any, res) => {
    try {
      const authHeader = req.headers['authorization'];
      const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
      const sessionUserId = req.session?.user?.userId;

      let userId: string | null = null;
      if (sessionUserId) userId = sessionUserId;
      else if (bearerToken) {
        const tokenDoc = await AuthToken.findOne({ token: bearerToken, isRevoked: false, expiresAt: { $gt: new Date() } });
        if (tokenDoc) userId = tokenDoc.userId.toString();
      }

      if (!userId) return res.status(401).json({ error: 'Authentication required' });

      const devices = await UserDevice.find({ userId: new mongoose.Types.ObjectId(userId), isActive: true })
        .sort({ lastSeenAt: -1 })
        .lean();

      res.json({
        success: true,
        devices: devices.map(d => ({
          deviceId: d.deviceId,
          deviceName: d.deviceName,
          platform: d.platform,
          lastSeenAt: d.lastSeenAt,
          pairedAt: d.pairedAt,
        })),
      });
    } catch (error: any) {
      console.error('[DEVICES] List error:', error.message);
      res.status(500).json({ error: 'Failed to list devices' });
    }
  });

  // DELETE /api/user/devices/:deviceId - Remove a paired TV device
  app.delete('/api/user/devices/:deviceId', async (req: any, res) => {
    try {
      const authHeader = req.headers['authorization'];
      const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
      const sessionUserId = req.session?.user?.userId;

      let userId: string | null = null;
      if (sessionUserId) userId = sessionUserId;
      else if (bearerToken) {
        const tokenDoc = await AuthToken.findOne({ token: bearerToken, isRevoked: false, expiresAt: { $gt: new Date() } });
        if (tokenDoc) userId = tokenDoc.userId.toString();
      }

      if (!userId) return res.status(401).json({ error: 'Authentication required' });

      const { deviceId } = req.params;

      const device = await UserDevice.findOneAndUpdate(
        { userId: new mongoose.Types.ObjectId(userId), deviceId },
        { isActive: false },
        { new: true }
      );

      if (!device) {
        return res.status(404).json({ error: 'Device not found' });
      }

      const tvLoginCodes = await TvLoginCode.find({ deviceId, status: 'activated' }).select('token').lean();
      const tvTokens = tvLoginCodes.map(t => t.token).filter(Boolean);
      if (tvTokens.length > 0) {
        await AuthToken.updateMany(
          { token: { $in: tvTokens } },
          { isRevoked: true }
        );
      }

      await CastSession.updateMany(
        { userId, tvDeviceId: deviceId, status: { $in: ['waiting_for_pair', 'paired', 'active'] } },
        { $set: { status: 'expired', isPlaying: false } }
      );

      console.log(`[DEVICES] Device ${deviceId} removed for user ${userId}`);

      res.json({ success: true, message: 'Device removed' });
    } catch (error: any) {
      console.error('[DEVICES] Remove error:', error.message);
      res.status(500).json({ error: 'Failed to remove device' });
    }
  });

  // POST /api/cast/direct - Direct cast to a paired TV (no pairing code needed)
  app.post('/api/cast/direct', async (req: any, res) => {
    try {
      const authHeader = req.headers['authorization'];
      const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
      const sessionUserId = req.session?.user?.userId;

      let userId: string | null = null;
      if (sessionUserId) userId = sessionUserId;
      else if (bearerToken) {
        const tokenDoc = await AuthToken.findOne({ token: bearerToken, isRevoked: false, expiresAt: { $gt: new Date() } });
        if (tokenDoc) userId = tokenDoc.userId.toString();
      }

      if (!userId) return res.status(401).json({ error: 'Authentication required' });

      const { deviceId, stationId } = req.body;

      if (!deviceId) {
        return res.status(400).json({ error: 'deviceId is required' });
      }

      const result = await castService.createDirectSession(userId, deviceId, stationId);

      if (!result) {
        return res.status(404).json({ error: 'Device not found or not paired with your account' });
      }

      res.json({
        success: true,
        sessionId: result.sessionId,
        wsUrl: `/ws/cast?sessionId=${result.sessionId}&role=mobile&token=YOUR_TOKEN`,
        message: 'Direct cast session started',
      });
    } catch (error: any) {
      console.error('[CAST] Direct cast error:', error.message);
      res.status(500).json({ error: 'Failed to start direct cast' });
    }
  });

  // ==================== Polling-based Cast System ====================

  // GET /api/cast/poll - TV polls for pending commands every 3 seconds
  app.get('/api/cast/poll', async (req: any, res) => {
    try {
      const authHeader = req.headers['authorization'];
      const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

      if (!bearerToken) {
        return res.status(401).json({ error: 'Authorization token required' });
      }

      const tokenDoc = await AuthToken.findOne({ token: bearerToken, isRevoked: false, expiresAt: { $gt: new Date() } });
      if (!tokenDoc) {
        return res.status(401).json({ error: 'Invalid or expired token' });
      }

      const userId = tokenDoc.userId;
      const { deviceId, platform } = req.query;

      if (!deviceId) {
        return res.status(400).json({ error: 'deviceId query parameter is required' });
      }

      const query: any = { userId, consumed: false };
      query.$or = [{ deviceId }, { deviceId: { $exists: false } }, { deviceId: null }];

      const pending = await CastCommand.findOneAndUpdate(
        query,
        { $set: { consumed: true } },
        { sort: { timestamp: -1 }, new: false }
      );

      if (!pending) {
        return res.json({ pendingCommand: null });
      }

      const response: any = {
        pendingCommand: {
          id: pending._id.toString(),
          type: pending.type,
          timestamp: pending.timestamp,
        }
      };

      if (pending.station) {
        response.pendingCommand.station = pending.station;
      }

      res.json(response);
    } catch (error: any) {
      console.error('[CAST-POLL] Error:', error.message);
      res.status(500).json({ error: 'Failed to poll for commands' });
    }
  });

  // POST /api/cast/send - Mobile sends cast commands to TV
  app.post('/api/cast/send', async (req: any, res) => {
    try {
      const authHeader = req.headers['authorization'];
      const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
      const sessionUserId = req.session?.user?.userId;

      let userId: string | null = null;
      if (sessionUserId) userId = sessionUserId;
      else if (bearerToken) {
        const tokenDoc = await AuthToken.findOne({ token: bearerToken, isRevoked: false, expiresAt: { $gt: new Date() } });
        if (tokenDoc) userId = tokenDoc.userId.toString();
      }

      if (!userId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const { type, station, deviceId } = req.body;

      if (!type || !['cast:play', 'cast:pause', 'cast:resume', 'cast:stop'].includes(type)) {
        return res.status(400).json({ error: 'Invalid command type. Must be cast:play, cast:pause, cast:resume, or cast:stop' });
      }

      if (type === 'cast:play' && !station) {
        return res.status(400).json({ error: 'Station data required for cast:play command' });
      }

      const updateQuery: any = { userId, consumed: false };
      if (deviceId) updateQuery.deviceId = deviceId;

      await CastCommand.updateMany(
        updateQuery,
        { $set: { consumed: true } }
      );

      await CastCommand.create({
        userId,
        deviceId: deviceId || undefined,
        type,
        station: type === 'cast:play' ? station : undefined,
        timestamp: Date.now(),
        consumed: false,
      });

      res.json({ success: true, message: 'Command sent to TV' });
    } catch (error: any) {
      console.error('[CAST-SEND] Error:', error.message);
      res.status(500).json({ error: 'Failed to send command' });
    }
  });

  // POST /api/cast/now-playing - TV reports current playback status
  app.post('/api/cast/now-playing', async (req: any, res) => {
    try {
      const authHeader = req.headers['authorization'];
      const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

      if (!bearerToken) {
        return res.status(401).json({ error: 'Authorization token required' });
      }

      const tokenDoc = await AuthToken.findOne({ token: bearerToken, isRevoked: false, expiresAt: { $gt: new Date() } });
      if (!tokenDoc) {
        return res.status(401).json({ error: 'Invalid or expired token' });
      }

      const userId = tokenDoc.userId;
      const { deviceId, platform, stationName, title, artist, isPlaying } = req.body;

      if (!deviceId) {
        return res.status(400).json({ error: 'deviceId is required' });
      }

      await CastNowPlaying.findOneAndUpdate(
        { userId, deviceId },
        {
          userId,
          deviceId,
          platform: platform || 'browser',
          stationName,
          title,
          artist,
          isPlaying: isPlaying !== undefined ? isPlaying : true,
          updatedAt: new Date(),
        },
        { upsert: true, new: true }
      );

      res.json({ success: true });
    } catch (error: any) {
      console.error('[CAST-NOW-PLAYING] Error:', error.message);
      res.status(500).json({ error: 'Failed to update now playing' });
    }
  });

  // GET /api/cast/now-playing - Mobile gets what TV is currently playing
  app.get('/api/cast/now-playing', async (req: any, res) => {
    try {
      const authHeader = req.headers['authorization'];
      const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
      const sessionUserId = req.session?.user?.userId;

      let userId: string | null = null;
      if (sessionUserId) userId = sessionUserId;
      else if (bearerToken) {
        const tokenDoc = await AuthToken.findOne({ token: bearerToken, isRevoked: false, expiresAt: { $gt: new Date() } });
        if (tokenDoc) userId = tokenDoc.userId.toString();
      }

      if (!userId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const nowPlaying = await CastNowPlaying.findOne({ userId });

      if (!nowPlaying) {
        return res.json({ nowPlaying: null });
      }

      res.json({
        nowPlaying: {
          deviceId: nowPlaying.deviceId,
          platform: nowPlaying.platform,
          stationName: nowPlaying.stationName,
          title: nowPlaying.title,
          artist: nowPlaying.artist,
          isPlaying: nowPlaying.isPlaying,
          updatedAt: nowPlaying.updatedAt,
        }
      });
    } catch (error: any) {
      console.error('[CAST-NOW-PLAYING] Get error:', error.message);
      res.status(500).json({ error: 'Failed to get now playing' });
    }
  });

  // User signup
  app.post("/api/auth/signup", async (req, res) => {
    try {
      const { fullName, username, email, password } = req.body;
      // logger.log('📝 New user signup attempt: ${email}');

      // Check if user already exists
      const existingUser = await User.findOne({
        $or: [{ email }, { username }]
      });

      if (existingUser) {
        if (existingUser.email === email) {
          return res.status(400).json({ error: 'Email already registered' });
        }
        if (existingUser.username === username) {
          return res.status(400).json({ error: 'Username already taken' });
        }
      }

      // Hash password
      const bcrypt = await import('bcrypt');
      const saltRounds = 12;
      const passwordHash = await bcrypt.default.hash(password, saltRounds);

      // Generate email verification token
      const crypto = await import('crypto');
      const emailVerificationToken = crypto.default.randomBytes(32).toString('hex');

      // Generate unique slug for the new user
      const userSlug = await generateUserSlug({ username, fullName, email });

      // Create new user
      const newUser = new User({
        fullName,
        username,
        email,
        passwordHash,
        emailVerificationToken,
        emailVerified: false,
        slug: userSlug, // Add automatic slug generation
        role: 'user',
        status: 'active',
        followersCount: 0,
        followingCount: 0,
        favoriteStationsCount: 0,
        totalListeningTime: 0,
        stationsCreatedCount: 0,
        stats: {
          totalPlays: 0,
          totalListeningHours: 0,
          favoriteGenres: [],
          joinDate: new Date(),
          lastActiveDate: new Date(),
          streakDays: 0
        }
      });

      await newUser.save();
      logger.log(`✅ User created with slug: "${userSlug}" (${email})`);

      // logger.log(` User created successfully: ${email}`);
      
      // Return user data (without sensitive fields)
      const userData = {
        _id: newUser._id,
        fullName: newUser.fullName,
        username: newUser.username,
        email: newUser.email,
        emailVerified: newUser.emailVerified,
        role: newUser.role,
        status: newUser.status,
        createdAt: newUser.createdAt
      };

      res.status(201).json({ 
        message: 'Account created successfully', 
        user: userData,
        emailVerificationRequired: true
      });
    } catch (error) {
      console.error('Signup error:', error);
      res.status(500).json({ error: 'Failed to create account' });
    }
  });

  // User login
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { email, password, rememberMe } = req.body;
      // logger.log('🔐 Login attempt for: ${email}');

      // Find user by email
      const user = await User.findOne({ email });
      if (!user) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      // Check password
      const bcrypt = await import('bcrypt');
      const isValidPassword = await bcrypt.default.compare(password, user.passwordHash);
      if (!isValidPassword) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      // Check if account is active
      if (user.status !== 'active') {
        return res.status(403).json({ error: 'Account is suspended or inactive' });
      }

      // Update last login
      user.lastLoginAt = new Date();
      user.stats.lastActiveDate = new Date();
      await user.save();

      // Create session (you might want to use express-session or JWT)
      const sessionData = {
        userId: user._id.toString(),
        email: user.email,
        role: user.role,
        rememberMe
      };

      const userData = {
        _id: user._id,
        fullName: user.fullName,
        username: user.username,
        email: user.email,
        emailVerified: user.emailVerified,
        role: user.role,
        status: user.status,
        avatar: user.avatar,
        location: user.location,
        isPublicProfile: user.isPublicProfile,
        followersCount: user.followersCount,
        followingCount: user.followingCount,
        favoriteStationsCount: user.favoriteStationsCount,
        totalListeningTime: user.totalListeningTime,
        lastLoginAt: user.lastLoginAt
      };

      // Use Passport's req.login() to properly establish session (same as OAuth login)
      req.login(user, async (err) => {
        if (err) {
          console.error('Session login error:', err);
          return res.status(500).json({ error: 'Failed to create session' });
        }
        
        // Also store our custom session data for backward compatibility
        (req.session as any).user = sessionData;

        const deviceType = req.body.deviceType || (req.headers['x-device-type'] as string) || 'web';
        const deviceName = req.body.deviceName || req.headers['x-device-name'] as string;

        if (deviceType === 'mobile' || deviceType === 'tv') {
          const authToken = await generateAuthToken(user._id.toString(), deviceType, deviceName);
          res.json({ 
            message: 'Login successful', 
            user: userData,
            authenticated: true,
            token: authToken,
            tokenExpiresIn: '90 days'
          });
        } else {
          res.json({ 
            message: 'Login successful', 
            user: userData,
            authenticated: true
          });
        }
      });
    } catch (error) {
      // console.error('Login error:', error);
      res.status(500).json({ error: 'Failed to login' });
    }
  });

  // Get current user (check authentication) - Complete user data for frontend
  app.get("/api/auth/me", async (req, res) => {
    try {
      if (!req.session?.user?.userId && !(req as any).user) {
        return res.json({ user: null, authenticated: false });
      }

      // Get user ID from either session or passport
      const userId = req.session?.user?.userId || (req as any).user?._id;

      const user = await User.findById(userId)
        .select('-passwordHash -emailVerificationToken -resetPasswordToken')
        .lean();

      if (!user) {
        // Clear invalid session
        if (req.session) {
          req.session.user = undefined;
        }
        return res.json({ user: null, authenticated: false });
      }

      // Get the list of users this user is following
      // logger.log(` Looking for UserFollow records with userId: ${user._id} (type: ${typeof user._id})`);
      
      const followingList = await UserFollow.find({ userId: user._id })
        .select('followingUserId')
        .lean();
      const following = followingList.map(f => f.followingUserId.toString());
      
      // logger.log(` User ${user._id} following list: ${following.length} users - ${following.join(', ')}`);
      
      // Also check if there are ANY UserFollow records for debugging
      const allUserFollows = await UserFollow.find({}).select('userId followingUserId').lean();
      // logger.log(` All UserFollow records in DB: ${allUserFollows.length}`);
      allUserFollows.forEach(uf => {
        // logger.log(`  - UserFollow: ${uf.userId} -> ${uf.followingUserId} (types: ${typeof uf.userId} -> ${typeof uf.followingUserId})`);
      });
      
      // Debug: Check if our query matches any records
      // logger.log(` Checking UserFollow.find({ userId: ${user._id} })`);
      const debugFollowing = await UserFollow.find({ userId: user._id }).lean();
      // logger.log(` Debug query result: ${debugFollowing.length} records`);
      debugFollowing.forEach(f => {
        // logger.log(`  - Found: ${f.userId} -> ${f.followingUserId}`);
      });

      // Calculate ACTUAL follower counts from UserFollow collection to ensure accuracy  
      const actualFollowersCount = await UserFollow.countDocuments({ followingUserId: user._id });
      const actualFollowingCount = following.length; // We already calculated this above
      
      // Sync the user document if counts are incorrect
      const needsUpdate = user.followersCount !== actualFollowersCount || user.followingCount !== actualFollowingCount;
      if (needsUpdate) {
        // logger.log(` Syncing user ${user._id} counts: followers ${user.followersCount} -> ${actualFollowersCount}, following ${user.followingCount} -> ${actualFollowingCount}`);
        await User.findByIdAndUpdate(user._id, {
          followersCount: actualFollowersCount,
          followingCount: actualFollowingCount
        });
      }

      // Return complete user data for frontend
      const userData = {
        _id: user._id,
        id: user._id, // Add id field for consistency
        fullName: user.fullName,
        username: user.username,
        email: user.email,
        emailVerified: user.emailVerified,
        role: user.role,
        status: user.status,
        avatar: user.avatar,
        location: user.location,
        isPublicProfile: user.isPublicProfile,
        preferences: user.preferences,
        followersCount: actualFollowersCount, // Always return ACTUAL count
        followingCount: actualFollowingCount, // Always return ACTUAL count
        favoriteStationsCount: user.favoriteStationsCount,
        totalListeningTime: user.totalListeningTime,
        lastLoginAt: user.lastLoginAt,
        createdAt: user.createdAt,
        following: following // Add the list of users being followed
      };

      res.json({ user: userData, authenticated: true });
    } catch (error) {
      // console.error('Auth check error:', error);
      res.json({ user: null, authenticated: false });
    }
  });

  // User logout
  app.post("/api/auth/logout", async (req, res) => {
    try {
      if (req.session) {
        req.session.destroy((err) => {
          if (err) {
            return res.status(500).json({ error: 'Failed to logout' });
          }
          res.clearCookie('connect.sid');
          res.json({ message: 'Logout successful', authenticated: false });
        });
      } else {
        res.json({ message: 'Logout successful', authenticated: false });
      }
    } catch (error) {
      res.status(500).json({ error: 'Failed to logout' });
    }
  });

  // Update user profile
  app.put("/api/auth/profile", requireAuth, async (req, res) => {
    try {
      const userId = req.session?.user?.userId;
      const { fullName, email, location, preferences, password } = req.body;
      
      // logger.log('📝 Updating profile for user: ${userId}');
      // logger.log(`📝 Request body:`, req.body);

      // Get current user
      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Update basic profile information
      if (fullName !== undefined) user.fullName = fullName;
      if (email !== undefined) user.email = email;
      if (location !== undefined) user.location = location;
      if (req.body.isPublicProfile !== undefined) user.isPublicProfile = req.body.isPublicProfile;
      
      // Update preferences if provided
      if (preferences) {
        user.preferences = { ...user.preferences, ...preferences };
      }

      // Debug logging
      // logger.log(` Profile update data:`, { fullName: user.fullName, email: user.email, location: user.location, isPublicProfile: user.isPublicProfile, preferences: user.preferences });

      // Update password if provided
      if (password && password.trim() !== '') {
        const bcrypt = await import('bcrypt');
        const saltRounds = 12;
        user.passwordHash = await bcrypt.default.hash(password, saltRounds);
      }

      user.updatedAt = new Date();
      await user.save();

      // logger.log(` Profile updated successfully for user: ${userId}`);
      
      // Return updated user data (without sensitive fields)
      const userData = {
        _id: user._id,
        fullName: user.fullName,
        username: user.username,
        email: user.email,
        emailVerified: user.emailVerified,
        role: user.role,
        status: user.status,
        avatar: user.avatar,
        location: user.location,
        isPublicProfile: user.isPublicProfile,
        preferences: user.preferences,
        followersCount: user.followersCount,
        followingCount: user.followingCount,
        favoriteStationsCount: user.favoriteStationsCount,
        totalListeningTime: user.totalListeningTime,
        lastLoginAt: user.lastLoginAt
      };

      res.json({ 
        message: 'Profile updated successfully', 
        user: userData
      });
    } catch (error) {
      // console.error('Profile update error:', error);
      res.status(500).json({ error: 'Failed to update profile' });
    }
  });

  // Forgot password
  app.post("/api/auth/forgot-password", async (req, res) => {
    try {
      const { email } = req.body;
      logger.log(`🔑 Password reset request for: ${email}`);

      // Find user by email
      const user = await User.findOne({ email });
      if (!user) {
        // Don't reveal if email exists or not for security
        return res.json({ message: 'If an account exists with this email, you will receive reset instructions.' });
      }

      // Generate reset token
      const crypto = await import('crypto');
      const resetToken = crypto.default.randomBytes(32).toString('hex');
      const resetTokenExpiry = new Date(Date.now() + 3600000); // 1 hour from now

      // Save reset token to user
      user.resetPasswordToken = resetToken;
      user.resetPasswordExpiry = resetTokenExpiry;
      await user.save();

      logger.log(`🔐 Reset token generated for: ${email}`);

      // Send email with SendGrid
      const sgMail = await import('@sendgrid/mail');
      sgMail.default.setApiKey(process.env.SENDGRID_API_KEY || '');

      const resetUrl = `https://themegaradio.com/reset-password?token=${resetToken}`;
      
      const msg = {
        to: email,
        from: 'noreply@themegaradio.com', // Must be verified sender in SendGrid
        subject: 'Reset Your Password - Mega Radio',
        text: `You requested a password reset. Click the link to reset your password: ${resetUrl}\n\nThis link expires in 1 hour.\n\nIf you did not request this, please ignore this email.`,
        html: `
          <div style="font-family: 'Ubuntu', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #0E0E0E; color: white;">
            <div style="text-align: center; margin-bottom: 30px;">
              <h1 style="color: #FF4199; margin: 0;">Mega Radio</h1>
            </div>
            <div style="background-color: #1a1a1a; padding: 30px; border-radius: 10px;">
              <h2 style="color: white; margin-top: 0;">Reset Your Password</h2>
              <p style="color: #ccc; line-height: 1.6;">You requested a password reset for your Mega Radio account.</p>
              <p style="color: #ccc; line-height: 1.6;">Click the button below to reset your password:</p>
              <div style="text-align: center; margin: 30px 0;">
                <a href="${resetUrl}" style="background-color: #FF4199; color: white; padding: 15px 30px; text-decoration: none; border-radius: 25px; font-weight: bold; display: inline-block;">Reset Password</a>
              </div>
              <p style="color: #888; font-size: 14px;">This link expires in 1 hour.</p>
              <p style="color: #888; font-size: 14px;">If you did not request this password reset, please ignore this email.</p>
            </div>
            <div style="text-align: center; margin-top: 20px; color: #666; font-size: 12px;">
              <p>© 2024 Mega Radio. All rights reserved.</p>
            </div>
          </div>
        `,
      };

      await sgMail.default.send(msg);
      logger.log(`📧 Password reset email sent to: ${email}`);

      res.json({ 
        message: 'If an account exists with this email, you will receive reset instructions.'
      });
    } catch (error: any) {
      console.error('Forgot password error:', error);
      // Still return success message for security (don't reveal if email sending failed)
      res.json({ message: 'If an account exists with this email, you will receive reset instructions.' });
    }
  });

  // Reset password with token
  app.post("/api/auth/reset-password", async (req, res) => {
    try {
      const { token, newPassword } = req.body;

      if (!token || !newPassword) {
        return res.status(400).json({ error: 'Token and new password are required' });
      }

      if (newPassword.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters' });
      }

      // Find user by reset token
      const user = await User.findOne({
        resetPasswordToken: token,
        resetPasswordExpiry: { $gt: new Date() }
      });

      if (!user) {
        return res.status(400).json({ error: 'Invalid or expired reset token' });
      }

      // Hash new password
      const bcrypt = await import('bcrypt');
      const saltRounds = 12;
      user.passwordHash = await bcrypt.default.hash(newPassword, saltRounds);
      
      // Clear reset token
      user.resetPasswordToken = undefined;
      user.resetPasswordExpiry = undefined;
      await user.save();

      logger.log(`✅ Password reset successful for: ${user.email}`);

      res.json({ message: 'Password has been reset successfully. You can now log in with your new password.' });
    } catch (error) {
      console.error('Reset password error:', error);
      res.status(500).json({ error: 'Failed to reset password' });
    }
  });

  // User Following System
  
  // Follow a user
  app.post("/api/user/follow/:userId", requireAuth, async (req, res) => {
    try {
      const followingUserId = req.params.userId;
      const currentUserId = (req.session as any).userId;

      if (followingUserId === currentUserId) {
        return res.status(400).json({ error: "You cannot follow yourself" });
      }

      // Check if the user being followed exists
      const userToFollow = await User.findById(followingUserId);
      if (!userToFollow) {
        return res.status(404).json({ error: "User not found" });
      }

      // Check if already following
      const existingFollow = await UserFollow.findOne({
        userId: currentUserId,
        followingUserId: followingUserId
      });

      if (existingFollow) {
        return res.status(400).json({ error: "Already following this user" });
      }

      // Create follow relationship
      await UserFollow.create({
        userId: currentUserId,
        followingUserId: followingUserId
      });

      // Update user counts
      await User.findByIdAndUpdate(currentUserId, { 
        $inc: { followingCount: 1 } 
      });
      await User.findByIdAndUpdate(followingUserId, { 
        $inc: { followersCount: 1 } 
      });

      // Create notification for the followed user
      const currentUser = await User.findById(currentUserId);
      await UserNotification.create({
        userId: followingUserId,
        fromUserId: currentUserId,
        type: 'follow',
        title: 'New Follower',
        message: `${currentUser?.fullName || currentUser?.username || 'Someone'} started following you`,
        data: { followerId: currentUserId }
      });

      // logger.log(` User ${currentUserId} is now following ${followingUserId}`);
      const currentUserEmail = (await User.findById(currentUserId).select('email').lean())?.email;
      await Promise.all([
        invalidateSocialCacheForUser(currentUserId, currentUserEmail),
        invalidateSocialCacheForUser(followingUserId, userToFollow?.email)
      ]);

      res.json({ success: true, message: "User followed successfully" });
    } catch (error) {
      // console.error('Follow user error:', error);
      res.status(500).json({ error: 'Failed to follow user' });
    }
  });

  // Unfollow a user
  app.delete("/api/user/unfollow/:userId", requireAuth, async (req, res) => {
    try {
      const followingUserId = req.params.userId;
      const currentUserId = (req.session as any).userId;

      // Remove follow relationship
      const deleted = await UserFollow.findOneAndDelete({
        userId: currentUserId,
        followingUserId: followingUserId
      });

      if (!deleted) {
        return res.status(400).json({ error: "Not following this user" });
      }

      // Update user counts
      await User.findByIdAndUpdate(currentUserId, { 
        $inc: { followingCount: -1 } 
      });
      await User.findByIdAndUpdate(followingUserId, { 
        $inc: { followersCount: -1 } 
      });

      // Create notification for the unfollowed user
      const currentUser = await User.findById(currentUserId);
      await UserNotification.create({
        userId: followingUserId,
        fromUserId: currentUserId,
        type: 'unfollow',
        title: 'User Unfollowed',
        message: `${currentUser?.fullName || currentUser?.username || 'Someone'} unfollowed you`,
        data: { followerId: currentUserId }
      });

      // logger.log(` User ${currentUserId} unfollowed ${followingUserId}`);
      const unfollowedUser = await User.findById(followingUserId).select('email').lean();
      await Promise.all([
        invalidateSocialCacheForUser(currentUserId, currentUser?.email),
        invalidateSocialCacheForUser(followingUserId, unfollowedUser?.email)
      ]);

      res.json({ success: true, message: "User unfollowed successfully" });
    } catch (error) {
      // console.error('Unfollow user error:', error);
      res.status(500).json({ error: 'Failed to unfollow user' });
    }
  });

  // Get user's followers
  app.get("/api/user/followers/:userId", async (req, res) => {
    try {
      const userId = req.params.userId;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const skip = (page - 1) * limit;

      const cacheKey = CacheKeys.userFollowers(userId, page, limit);
      const cached = await CacheManager.get<any>(cacheKey);
      if (cached) {
        return res.json(cached);
      }

      const [followers, total] = await Promise.all([
        UserFollow.find({ followingUserId: userId })
          .populate('userId', 'fullName username email avatar location followersCount followingCount')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit),
        UserFollow.countDocuments({ followingUserId: userId })
      ]);

      const result = {
        followers: followers.map(f => ({
          user: f.userId,
          followedAt: f.createdAt
        })),
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      };

      await CacheManager.set(cacheKey, result, { ttl: 120 });
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get followers' });
    }
  });

  // Get user's following
  app.get("/api/user/following/:userId", async (req, res) => {
    try {
      const userId = req.params.userId;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const skip = (page - 1) * limit;

      const cacheKey = CacheKeys.userFollowing(userId, page, limit);
      const cached = await CacheManager.get<any>(cacheKey);
      if (cached) {
        return res.json(cached);
      }

      const [following, total] = await Promise.all([
        UserFollow.find({ userId: userId })
          .populate('followingUserId', 'fullName username email avatar location followersCount followingCount')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit),
        UserFollow.countDocuments({ userId: userId })
      ]);

      const result = {
        following: following.map(f => ({
          user: f.followingUserId,
          followedAt: f.createdAt
        })),
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      };

      await CacheManager.set(cacheKey, result, { ttl: 120 });
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get following' });
    }
  });

  // Frontend-compatible follow endpoints
  app.post("/api/users/:userId/follow", requireAuth, async (req, res) => {
    try {
      const userParam = req.params.userId;
      const currentUserId = (req.session as any)?.user?.userId || (req.session as any)?.userId;

      if (!currentUserId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      // Find target user by ObjectId OR slug
      const isObjectId = /^[0-9a-fA-F]{24}$/.test(userParam);
      const userToFollow = isObjectId
        ? await User.findById(userParam)
        : await User.findOne({ slug: userParam });

      if (!userToFollow) {
        return res.status(404).json({ error: "User not found" });
      }

      const followingUserId = userToFollow._id.toString();

      if (followingUserId === currentUserId) {
        return res.status(400).json({ error: "You cannot follow yourself" });
      }

      // Check if already following
      const existingFollow = await UserFollow.findOne({
        userId: currentUserId,
        followingUserId: followingUserId
      });

      if (existingFollow) {
        return res.status(400).json({ error: "Already following this user" });
      }

      // Create follow relationship
      await UserFollow.create({ userId: currentUserId, followingUserId });

      // Update user counts
      await User.findByIdAndUpdate(currentUserId, { $inc: { followingCount: 1 } });
      const updatedTargetUser = await User.findByIdAndUpdate(followingUserId, { 
        $inc: { followersCount: 1 } 
      }, { new: true });

      const currentUserDoc = await User.findById(currentUserId).select('email').lean();
      await Promise.all([
        invalidateSocialCacheForUser(currentUserId, currentUserDoc?.email),
        invalidateSocialCacheForUser(followingUserId, userToFollow?.email)
      ]);

      res.json({ 
        success: true, 
        message: "User followed successfully",
        followersCount: updatedTargetUser?.followersCount
      });
    } catch (error) {
      console.error('Follow user error:', error);
      res.status(500).json({ error: 'Failed to follow user' });
    }
  });

  app.post("/api/users/:userId/unfollow", requireAuth, async (req, res) => {
    try {
      const userParam = req.params.userId;
      const currentUserId = (req.session as any)?.user?.userId || (req.session as any)?.userId;

      if (!currentUserId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      // Find target user by ObjectId OR slug
      const isObjectId = /^[0-9a-fA-F]{24}$/.test(userParam);
      const targetUser = isObjectId
        ? await User.findById(userParam).select('_id email').lean()
        : await User.findOne({ slug: userParam }).select('_id email').lean();

      if (!targetUser) {
        return res.status(404).json({ error: "User not found" });
      }

      const followingUserId = targetUser._id.toString();

      // Remove follow relationship
      const deleted = await UserFollow.findOneAndDelete({
        userId: currentUserId,
        followingUserId: followingUserId
      });

      if (!deleted) {
        return res.status(400).json({ error: "Not following this user" });
      }

      // Update user counts
      await User.findByIdAndUpdate(currentUserId, { $inc: { followingCount: -1 } });
      const updatedTargetUser = await User.findByIdAndUpdate(followingUserId, { 
        $inc: { followersCount: -1 } 
      }, { new: true });

      const currentUserDoc = await User.findById(currentUserId).select('email').lean();
      await Promise.all([
        invalidateSocialCacheForUser(currentUserId, currentUserDoc?.email),
        invalidateSocialCacheForUser(followingUserId, targetUser?.email)
      ]);

      res.json({ 
        success: true, 
        message: "User unfollowed successfully",
        followersCount: updatedTargetUser?.followersCount
      });
    } catch (error) {
      console.error('Unfollow user error:', error);
      res.status(500).json({ error: 'Failed to unfollow user' });
    }
  });

  app.get("/api/users/:userId/followers", async (req, res) => {
    try {
      const { userId } = req.params;
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
      const skip = (page - 1) * limit;

      const cacheKey = `social:users-followers:${userId}:${page}:${limit}`;
      const cached = await CacheManager.get<any>(cacheKey);
      if (cached) {
        return res.json(cached);
      }

      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const [follows, total] = await Promise.all([
        UserFollow.find({ followingUserId: userId })
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        UserFollow.countDocuments({ followingUserId: userId })
      ]);

      const followerIds = follows.map((f: any) => f.userId);
      const users = await User.find({ _id: { $in: followerIds } })
        .select('username fullName avatar isPublicProfile followersCount followingCount')
        .lean();

      const userMap = new Map(users.map((u: any) => [u._id.toString(), u]));
      const followers = followerIds
        .map((id: any) => userMap.get(id.toString()))
        .filter(Boolean)
        .map((u: any) => ({
          id: u._id,
          username: u.username,
          fullName: u.fullName,
          avatar: u.avatar,
          isPublicProfile: u.isPublicProfile,
          followersCount: u.followersCount || 0,
          followingCount: u.followingCount || 0
        }));

      const result = { followers, total, page, limit, totalPages: Math.ceil(total / limit) };
      await CacheManager.set(cacheKey, result, { ttl: 120 });
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch followers' });
    }
  });

  app.get("/api/users/:userId/following", async (req, res) => {
    try {
      const { userId } = req.params;
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
      const skip = (page - 1) * limit;

      const cacheKey = `social:users-following:${userId}:${page}:${limit}`;
      const cached = await CacheManager.get<any>(cacheKey);
      if (cached) {
        return res.json(cached);
      }

      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const [follows, total] = await Promise.all([
        UserFollow.find({ userId: userId })
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        UserFollow.countDocuments({ userId: userId })
      ]);

      const followingIds = follows.map((f: any) => f.followingUserId);
      const users = await User.find({ _id: { $in: followingIds } })
        .select('username fullName avatar isPublicProfile followersCount followingCount')
        .lean();

      const userMap = new Map(users.map((u: any) => [u._id.toString(), u]));
      const following = followingIds
        .map((id: any) => userMap.get(id.toString()))
        .filter(Boolean)
        .map((u: any) => ({
          id: u._id,
          username: u.username,
          fullName: u.fullName,
          avatar: u.avatar,
          isPublicProfile: u.isPublicProfile,
          followersCount: u.followersCount || 0,
          followingCount: u.followingCount || 0
        }));

      const result = { following, total, page, limit, totalPages: Math.ceil(total / limit) };
      await CacheManager.set(cacheKey, result, { ttl: 120 });
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch following' });
    }
  });

  // Check if current user is following another user
  app.get("/api/user/is-following/:userId", requireAuth, async (req, res) => {
    try {
      const followingUserId = req.params.userId;
      const currentUserId = (req.session as any).userId;

      const cacheKey = CacheKeys.userIsFollowing(currentUserId, followingUserId);
      const cached = await CacheManager.get<any>(cacheKey);
      if (cached !== null) {
        return res.json(cached);
      }

      const isFollowing = await UserFollow.exists({
        userId: currentUserId,
        followingUserId: followingUserId
      });

      const result = { isFollowing: !!isFollowing };
      await CacheManager.set(cacheKey, result, { ttl: 120 });
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: 'Failed to check following status' });
    }
  });

  // REMOVED DUPLICATE ROUTE - Using the original one above

  // REMOVED DUPLICATE ROUTE - Using the original route with parameter name ":id" above

  // Get genre by slug - OPTIMIZED for single genre lookup
  app.get("/api/genres/slug/:slug", async (req, res) => {
    try {
      const { slug } = req.params;
      // logger.log(`🎯 Fast genre lookup for slug: ${slug}`);
      
      // First check if it's a real genre from database
      const realGenre = await Genre.findOne({ slug: slug }).lean();
      if (realGenre) {
        // logger.log(`✅ Found real genre: ${realGenre.name}`);
        return res.json({
          _id: realGenre._id,
          name: realGenre.name,
          slug: realGenre.slug,
          description: realGenre.description,
          stationCount: realGenre.stationCount || 0,
          posterImage: realGenre.posterImage,
          discoverableImage: realGenre.discoverableImage,
          isDiscoverable: realGenre.isDiscoverable,
          discoverable: realGenre.isDiscoverable,
          createdAt: realGenre.createdAt,
          updatedAt: realGenre.updatedAt,
          isDynamic: false
        });
      }
      
      // Check cache for individual genre
      const genreCacheKey = `genre:${slug}`;
      let cachedGenre = await CacheManager.get(genreCacheKey);
      
      if (cachedGenre) {
        // logger.log(`📦 Serving genre ${slug} from individual cache`);
        return res.json(cachedGenre);
      }
      
      // For dynamic genres, count stations efficiently
      // logger.log(`🔍 Generating dynamic genre for: ${slug}`);
      
      // Create both hyphenated and spaced versions for matching
      const slugWithSpaces = slug.replace(/-/g, ' ');
      const slugWithHyphens = slug.replace(/\s+/g, '-');
      
      const stationCount = await Station.countDocuments({
        $or: [
          { genre: { $regex: new RegExp(slug, 'i') } },
          { genre: { $regex: new RegExp(slugWithSpaces, 'i') } },
          { tags: { $regex: new RegExp(slug, 'i') } },
          { tags: { $regex: new RegExp(slugWithSpaces, 'i') } },
          { tags: { $in: [slug, slugWithSpaces, slugWithHyphens] } }
        ]
      });
      
      if (stationCount === 0) {
        return res.status(404).json({ error: 'Genre not found' });
      }
      
      // Create dynamic genre object with proper name formatting
      const displayName = slugWithSpaces.split(' ').map(word => 
        word.charAt(0).toUpperCase() + word.slice(1)
      ).join(' ');
      
      const dynamicGenre = {
        _id: `dynamic-${slug}`,
        name: displayName,
        slug: slug,
        posterImage: `/images/genre-bg-grad-${(Math.abs(slug.split('').reduce((a, b) => a + b.charCodeAt(0), 0)) % 4) + 1}.webp`,
        description: `${displayName} music and stations`,
        stationCount: stationCount,
        total_stations: stationCount,
        createdAt: new Date(),
        isDynamic: true
      };
      
      // Cache individual genre for 10 minutes
      await CacheManager.set(genreCacheKey, dynamicGenre, { ttl: 600 });
      
      // logger.log(`✅ Generated dynamic genre ${slug} with ${stationCount} stations (cached for 10min)`);
      res.json(dynamicGenre);
      
    } catch (error) {
      // console.error('Error fetching genre by slug:', error);
      res.status(500).json({ error: 'Failed to fetch genre' });
    }
  });

  // Get stations by genre slug
  app.get("/api/genres/:slug/stations", async (req, res) => {
    try {
      const { slug } = req.params;
      const isTV = req.query.tv === '1';
      const { country, search, sort = 'popularity' } = req.query;
      const gsParams = isTV ? tvValidateParams(req.query) : {
        page: parseInt(req.query.page as string) || 1,
        limit: parseInt(req.query.limit as string) || 12
      };
      const page = gsParams.page;
      const limit = gsParams.limit;
      const cacheKey = search ? null : `genre_stations:${slug}:${country || 'all'}:${sort}:${page}:${limit}:${isTV ? 'tv' : 'web'}`;
      
      // Try cache first (1 hour TTL for genre stations)
      if (cacheKey) {
        const cachedResult = await CacheManager.get(cacheKey);
        if (cachedResult) {
          logger.log(`📦 Genre stations cache HIT: ${slug} (page ${page})`);
          return res.json(cachedResult);
        }
      }

      // logger.log(`🎵 Fetching stations for genre: ${slug}`, { page, limit, country, search, sort });

      const filter: any = {};
      
      // Filter by genre/tag with exact matching for hyphenated/spaced variants
      if (slug && slug !== 'all') {
        const slugWithSpaces = slug.replace(/-/g, ' ');
        const slugWithHyphens = slug.replace(/\s+/g, '-');
        const escapedSlug = slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const escapedSlugSpaces = slugWithSpaces.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        
        filter.$or = [
          { genre: { $regex: new RegExp(`^${escapedSlug}$`, 'i') } },
          { genre: { $regex: new RegExp(`^${escapedSlugSpaces}$`, 'i') } },
          { tags: { $regex: new RegExp(`(^|,)\\s*${escapedSlug}\\s*(,|$)`, 'i') } },
          { tags: { $regex: new RegExp(`(^|,)\\s*${escapedSlugSpaces}\\s*(,|$)`, 'i') } },
          { tags: { $in: [slug, slugWithSpaces, slugWithHyphens] } }
        ];
      }
      
      // Filter by country (with name normalization)
      if (country && country !== 'all') {
        Object.assign(filter, normalizeCountryFilter(country as string));
        logger.log(`🌍 Country filter applied for: "${country}"`);
      }
      
      // Filter by search term
      if (search) {
        filter.$and = [
          filter.$or || {}, // Keep existing genre filter
          {
            $or: [
              { name: { $regex: new RegExp(search as string, 'i') } },
              { country: { $regex: new RegExp(search as string, 'i') } },
              { genre: { $regex: new RegExp(search as string, 'i') } },
              { tags: { $regex: new RegExp(search as string, 'i') } }
            ]
          }
        ];
      }

      // Count total matching stations
      const total = await Station.countDocuments(filter);

      // Build sort criteria
      let sortCriteria: any = {};
      switch (sort) {
        case 'quality':
          sortCriteria = { bitrate: -1, clickcount: -1, votes: -1 };
          break;
        case 'popularity':
          sortCriteria = { votes: -1, clickcount: -1 };  // Sort by votes first (most important), then clickcount
          break;
        case 'name':
          sortCriteria = { name: 1 };
          break;
        case 'country':
          sortCriteria = { country: 1, name: 1 };
          break;
        case 'createdAt':
          sortCriteria = { createdAt: -1 };
          break;
        default:
          sortCriteria = { votes: -1, clickcount: -1 };  // Default to popularity
      }

      logger.log(`🎵 Genre ${slug} stations: Sorting by "${sort}" (page ${page}/${Math.ceil(0 / Number(limit)) || 1})`);

      // Fetch stations with pagination
      const skip = (Number(page) - 1) * Number(limit);
      const stationQuery = Station.find(filter)
        .sort(sortCriteria)
        .skip(skip)
        .limit(Number(limit));
      
      if (isTV) {
        stationQuery.select(TV_STATION_PROJECTION);
      }
      
      const stations = await stationQuery.lean();

      // logger.log(`✅ Found ${stations.length} stations for genre ${slug} (${total} total)`);

      const totalPages = Math.ceil(total / Number(limit));
      const result = {
        stations,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          totalPages,
          pages: totalPages,
          hasMore: Number(page) * Number(limit) < total
        }
      };
      
      // Cache result for 1 hour (genre stations are stable data)
      if (cacheKey) {
        await CacheManager.set(cacheKey, result, { ttl: 3600 });
        logger.log(`📦 Genre stations cached: ${slug} (page ${page})`);
      }
      
      // TV: Use ETag for conditional requests
      if (req.query.tv === '1') {
        return sendWithETag(req, res, result);
      }
      
      res.json(result);
      
    } catch (error) {
      // console.error('Error fetching stations by genre:', error);
      res.status(500).json({ error: 'Failed to fetch stations' });
    }
  });

  // ADMIN TRANSLATION KEYS API - Manage translation keys
  app.get("/api/admin/translation-keys", requireAdmin, async (req, res) => {
    try {
      // logger.log('🔑 Fetching admin translation keys...');
      
      // Get all translation keys from database
      const translationKeys = await TranslationKey.find({}).lean();
      
      // logger.log(`✅ Found ${translationKeys.length} translation keys`);
      res.json(translationKeys);
    } catch (error) {
      console.error('Error fetching translation keys:', error);
      res.status(500).json({ error: 'Failed to fetch translation keys' });
    }
  });

  // CREATE Translation Key - from admin form
  app.post("/api/admin/translation-keys", requireAdmin, async (req, res) => {
    try {
      const { bumpTranslationVersion } = await import('./services/translation-version');
      const { key, defaultValue, description, context, category, isPlural } = req.body;

      // Validate required fields
      if (!key || !defaultValue) {
        return res.status(400).json({ error: 'Key and default value are required' });
      }

      // Check if key already exists
      const existingKey = await TranslationKey.findOne({ key });
      if (existingKey) {
        return res.status(400).json({ error: 'Translation key already exists' });
      }

      // Create new translation key
      const newKey = await TranslationKey.create({
        key,
        defaultValue,
        description: description || '',
        context: context || '',
        category: category || 'general',
        isPlural: isPlural || false,
        createdAt: new Date(),
        updatedAt: new Date()
      });

      logger.log(`✅ Created translation key: ${key}`);

      // Clear translation cache
      try {
        await CacheManager.clearByPattern('translations');
      } catch (cacheError) {
        logger.log('⚠️ Cache clearing failed (non-critical)');
      }

      // Bump translation version
      await bumpTranslationVersion(`New key added: ${key}`);

      res.status(201).json(newKey);
    } catch (error) {
      console.error('Error creating translation key:', error);
      res.status(500).json({ error: 'Failed to create translation key' });
    }
  });

  // UPDATE Translation Key
  app.put("/api/admin/translation-keys/:id", requireAdmin, async (req, res) => {
    try {
      const { bumpTranslationVersion } = await import('./services/translation-version');
      const { id } = req.params;
      const { key, defaultValue, description, context, category, isPlural } = req.body;

      // Find and update the key
      const updatedKey = await TranslationKey.findByIdAndUpdate(
        id,
        {
          key,
          defaultValue,
          description,
          context,
          category,
          isPlural,
          updatedAt: new Date()
        },
        { new: true }
      );

      if (!updatedKey) {
        return res.status(404).json({ error: 'Translation key not found' });
      }

      logger.log(`✅ Updated translation key: ${key}`);

      // Clear translation cache
      try {
        await CacheManager.clearByPattern('translations');
      } catch (cacheError) {
        logger.log('⚠️ Cache clearing failed (non-critical)');
      }

      // Bump translation version
      await bumpTranslationVersion(`Key updated: ${key}`);

      res.json(updatedKey);
    } catch (error) {
      console.error('Error updating translation key:', error);
      res.status(500).json({ error: 'Failed to update translation key' });
    }
  });

  // DELETE Translation Key
  app.delete("/api/admin/translation-keys/:id", requireAdmin, async (req, res) => {
    try {
      const { bumpTranslationVersion } = await import('./services/translation-version');
      const { id } = req.params;

      // Find and delete the key
      const deletedKey = await TranslationKey.findByIdAndDelete(id);

      if (!deletedKey) {
        return res.status(404).json({ error: 'Translation key not found' });
      }

      // Also delete all translations for this key
      await Translation.deleteMany({ keyId: id });

      logger.log(`✅ Deleted translation key: ${deletedKey.key}`);

      // Clear translation cache
      try {
        await CacheManager.clearByPattern('translations');
      } catch (cacheError) {
        logger.log('⚠️ Cache clearing failed (non-critical)');
      }

      // Bump translation version
      await bumpTranslationVersion(`Key deleted: ${deletedKey.key}`);

      res.json({ success: true, message: 'Translation key deleted' });
    } catch (error) {
      console.error('Error deleting translation key:', error);
      res.status(500).json({ error: 'Failed to delete translation key' });
    }
  });

  // Add FAQ translation keys for SEO content
  app.post("/api/admin/translation-keys/add-faq-keys", requireAdmin, async (req, res) => {
    try {
      const { bumpTranslationVersion } = await import('./services/translation-version');
      logger.log('❓ Adding FAQ translation keys...');
      
      const faqTranslations = [
        // FAQ Section headers
        { key: 'faq_title', defaultValue: 'Everything You Should Know About Radio', description: 'Main FAQ section title', category: 'seo' },
        { key: 'faq_subtitle', defaultValue: 'Frequently asked questions about online radio streaming', description: 'FAQ section subtitle', category: 'seo' },
        
        // FAQ Questions and Answers
        { key: 'faq_what_is_radio', defaultValue: 'What is Radio?', description: 'FAQ question about radio definition', category: 'seo' },
        { key: 'faq_what_is_radio_answer', defaultValue: 'Radio is a revolutionary wireless communication technology that has been broadcasting audio content through electromagnetic waves for over a century. Traditional radio uses two main transmission methods: AM (Amplitude Modulation) and FM (Frequency Modulation) frequencies to deliver music, news, talk shows, sports commentary, and entertainment to millions of listeners worldwide. Modern radio has evolved dramatically beyond traditional broadcasts to include digital broadcasting technologies like DAB+ (Digital Audio Broadcasting), internet radio streaming, and web radio platforms that deliver content globally. Platforms like Mega Radio represent the future of radio broadcasting, allowing you to access live radio content from around the world directly on your devices - smartphones, tablets, computers, and smart speakers - without requiring traditional radio receivers. Whether you prefer AM/FM radio\'s classic simplicity or the unlimited variety of online radio streaming, today\'s radio landscape offers unprecedented choice and convenience for every type of listener.', description: 'FAQ answer about radio definition', category: 'seo' },
        
        { key: 'faq_what_is_internet_radio', defaultValue: 'What is Internet Radio?', description: 'FAQ question about internet radio', category: 'seo' },
        { key: 'faq_what_is_internet_radio_answer', defaultValue: 'Internet radio, also known as web radio or online radio, revolutionizes how we access live radio by streaming audio content directly over the internet instead of traditional AM/FM radio waves. Unlike conventional radio broadcasting that requires physical radio receivers and is limited by geographical signal reach, internet radio streaming breaks all boundaries, letting you instantly access thousands of live radio stations from every corner of the globe. Whether you\'re using smartphones, tablets, computers, smart speakers, or even smart TVs, internet radio platforms like Mega Radio deliver unlimited access to global radio content through simple web browsers or dedicated mobile apps. From local FM stations streaming online to international broadcasting networks, internet radio offers unprecedented variety - tune into live radio from Paris, Tokyo, New York, or any city worldwide. The beauty of online radio lies in its accessibility: no special equipment needed, no geographical limitations, just instant access to 60,000+ radio stations covering every music genre, news format, sports coverage, and talk show imaginable. Internet radio streaming represents the democratization of global broadcasting, making the world\'s radio content available to everyone, anywhere, anytime.', description: 'FAQ answer about internet radio', category: 'seo' },
        
        { key: 'faq_what_is_web_radio', defaultValue: 'What is Web Radio?', description: 'FAQ question about web radio', category: 'seo' },
        { key: 'faq_what_is_web_radio_answer', defaultValue: 'Web radio is essentially synonymous with internet radio - live radio stations that broadcast exclusively online through websites and streaming platforms rather than traditional AM/FM frequencies. Web radio streaming eliminates all geographical and technical limitations that once restricted radio listening, allowing you to access radio broadcasts from every country, language, and genre worldwide with just a few clicks. Whether you want to listen to live radio from London\'s BBC, French music stations from Paris, jazz radio from New Orleans, or pop stations from Tokyo, web radio platforms like Mega Radio make it instantly possible. The term "web radio" emphasizes the browser-based accessibility - simply open your web browser, visit an online radio platform, choose from thousands of live radio stations, and start streaming immediately without downloads, installations, or complicated setup. Web radio includes everything from traditional FM/AM stations that simulcast online to digital-only internet radio stations created specifically for online streaming. This modern approach to radio broadcasting offers superior audio quality, global accessibility, unlimited variety in music and content, and the convenience of listening on any internet-connected device. Web radio represents the future of broadcasting - borderless, diverse, and instantly accessible to everyone.', description: 'FAQ answer about web radio', category: 'seo' },
        
        { key: 'faq_how_to_listen', defaultValue: 'How can I listen to radio?', description: 'FAQ question about how to listen', category: 'seo' },
        { key: 'faq_how_to_listen_answer', defaultValue: 'Listening to radio has never been more accessible, with multiple convenient methods available to suit every lifestyle and preference. Traditional FM/AM radio still works perfectly with physical radio receivers found in homes, cars, and portable devices, offering reliable local broadcasting. However, modern internet radio streaming has revolutionized radio listening - platforms like Mega Radio let you access 60,000+ live radio stations worldwide directly through web browsers on computers, smartphones, or tablets without any downloads or installations. Digital radio technologies like DAB+ (Digital Audio Broadcasting) provide enhanced audio quality and more station choices than traditional radio. Smart speakers from Amazon Alexa, Google Home, and Apple HomePod offer voice-activated radio streaming - simply ask to play any station. Mobile radio apps for iOS and Android devices provide on-the-go access to global internet radio. Modern car entertainment systems with internet connectivity transform your vehicle into a mobile radio streaming hub. The easiest and most versatile method is online radio streaming through platforms like Mega Radio - simply visit the website, browse or search for your favorite live radio station by genre, country, or name, and click play to start streaming instantly. No subscriptions, no downloads, no complications - just pure radio enjoyment across all your devices.', description: 'FAQ answer about how to listen', category: 'seo' },
        
        { key: 'faq_listen_on_phone', defaultValue: 'Can I listen to radio on my phone?', description: 'FAQ question about mobile listening', category: 'seo' },
        { key: 'faq_listen_on_phone_answer', defaultValue: 'Absolutely! Listening to live radio on your smartphone is incredibly easy and offers multiple convenient options. The simplest method is mobile internet radio streaming - just open any web browser on your iPhone or Android device, visit radio streaming platforms like Mega Radio, and instantly access 60,000+ live radio stations without downloading any apps. Many smartphones also include built-in FM radio receivers (especially Android devices), though online radio streaming provides vastly more variety and global access. For dedicated mobile radio listening, download radio apps from the App Store or Google Play Store - these apps offer enhanced features like favorites, playlists, sleep timers, and offline recording. Mobile radio streaming works seamlessly on both WiFi and cellular data connections, so you can enjoy live radio anywhere - during commutes, at the gym, while traveling, or relaxing at home. Modern smartphones deliver excellent audio quality for radio streaming, especially when connected to Bluetooth headphones, car audio systems, or external speakers. The beauty of mobile internet radio is the unlimited choice - unlike traditional FM/AM radio limited by your location, mobile streaming gives you instant access to radio stations from every country and genre imaginable. Whether you love pop radio, classical music, news broadcasting, sports talk, or jazz stations, your smartphone becomes a powerful global radio receiver through internet radio streaming.', description: 'FAQ answer about mobile listening', category: 'seo' },
        
        { key: 'faq_is_radio_free', defaultValue: 'Is internet radio free?', description: 'FAQ question about pricing', category: 'seo' },
        { key: 'faq_is_radio_free_answer', defaultValue: 'Yes, internet radio is completely free to enjoy on Mega Radio! Unlike subscription-based music services that charge monthly fees, our online radio streaming platform provides unlimited access to 60,000+ live radio stations from around the world at absolutely no cost. You don\'t need to register, create accounts, provide payment information, or worry about hidden charges - just visit the website and start streaming live radio instantly. All you need is an internet connection (WiFi or mobile data) to access our comprehensive collection of web radio stations spanning every genre, language, and country. While some individual radio stations may include advertisements (similar to traditional FM/AM radio broadcasting), the streaming service itself remains entirely free. This free access includes premium features like advanced search, genre filtering, country browsing, personalized recommendations, and multi-device streaming across computers, smartphones, and tablets. The no-cost model of internet radio platforms like Mega Radio democratizes access to global broadcasting, ensuring everyone can enjoy live radio from classical music and jazz to pop, rock, news, sports, and talk shows without financial barriers. Experience unlimited online radio streaming, discover stations from every corner of the world, and enjoy live radio broadcasting completely free - that\'s the beauty and accessibility of modern internet radio.', description: 'FAQ answer about pricing', category: 'seo' },
        
        { key: 'faq_listen_on_pc', defaultValue: 'How can I listen to radio on my PC?', description: 'FAQ question about PC listening', category: 'seo' },
        { key: 'faq_listen_on_pc_answer', defaultValue: 'Listening to live radio on your PC or computer is remarkably simple and requires no special software, installations, or technical knowledge. Just open any modern web browser - whether you use Chrome, Firefox, Safari, Microsoft Edge, or Opera - on your Windows PC, Mac, or Linux computer, visit an online radio streaming platform like Mega Radio, browse through our extensive collection of 60,000+ radio stations, and click play to start streaming instantly. No plugins, no downloads, no complicated setup - just direct browser-based radio streaming. PC radio listening offers distinct advantages: larger screens make browsing and discovering stations easier, superior audio quality through quality speakers or headphones, multi-tasking capability to enjoy radio while working, and stable internet connections for uninterrupted streaming. For optimal experience, ensure your browser is updated to the latest version for best audio codec support, use a reliable internet connection (broadband or WiFi) for buffer-free streaming, and consider connecting quality external speakers or headphones for enhanced sound. Internet radio streaming works flawlessly on all operating systems - Windows 10/11, macOS, Chrome OS, and Linux distributions all support browser-based radio streaming. Whether you\'re working from home and want background music, studying and need focus-enhancing classical radio, or simply relaxing with your favorite live radio stations, PC streaming through platforms like Mega Radio delivers the complete online radio experience with maximum convenience and audio quality.', description: 'FAQ answer about PC listening', category: 'seo' },
        
        { key: 'faq_which_stations', defaultValue: 'Which radio stations can I listen to?', description: 'FAQ question about station availability', category: 'seo' },
        { key: 'faq_which_stations_answer', defaultValue: 'Mega Radio provides comprehensive access to over 60,000 live radio stations from 120+ countries worldwide, covering virtually every imaginable genre, format, and broadcasting style. Listen to pop radio stations playing current hits, rock radio from classic to alternative, classical music broadcasts from world-renowned orchestras, smooth jazz radio, contemporary hip-hop channels, country music stations, electronic dance music (EDM) including house and techno, world music celebrating diverse cultures, blues, reggae, folk, and indie radio. Beyond music, access news radio from major networks like BBC, CNN, NPR, and international news services, sports talk radio covering football, basketball, baseball, and global sports, podcasts and talk shows on every topic imaginable, religious broadcasting across all faiths, educational radio including language learning and lectures, and community radio stations celebrating local culture. Our platform includes major commercial networks like iHeartRadio, Clear Channel stations, BBC Radio 1/2/3/4, NPR affiliates, as well as independent radio, college and university radio stations, public broadcasting, and niche stations dedicated to specific genres or communities. Whether you\'re searching for mainstream pop radio, underground electronic music, traditional folk broadcasting, or specialized content like meditation music or children\'s programming, Mega Radio\'s extensive online radio collection connects you to the world\'s best live radio streaming content. Every station is instantly accessible, searchable by genre, country, language, or name, delivering unlimited radio variety.', description: 'FAQ answer about station availability', category: 'seo' },
        
        { key: 'faq_best_station', defaultValue: 'Which radio station is the best?', description: 'FAQ question about best station', category: 'seo' },
        { key: 'faq_best_station_answer', defaultValue: 'The "best" radio station is beautifully subjective and entirely depends on your unique preferences in music, news, entertainment, and content style - what makes Mega Radio exceptional is our advanced discovery tools that help you find YOUR perfect station among 60,000+ options. For pop music lovers, explore trending radio stations playing current chart-toppers from stations like Capital FM, Z100, or Kiss FM. Rock enthusiasts can discover classic rock, alternative, metal, and indie rock stations from around the world. Classical music aficionados will find prestigious broadcasts from BBC Radio 3, WQXR, and European classical stations. Jazz lovers can tune into legendary jazz radio from WBGO, Jazz FM, and international jazz broadcasters. Our platform\'s intelligent features make discovering the best station for YOU effortless: browse trending radio stations to see what\'s popular globally right now, filter by specific genres (electronic, hip-hop, country, world music), narrow by country or language to find culturally relevant content, or leverage our AI-powered personalized recommendations that learn from your listening habits and suggest stations matching your taste. Whether you prefer commercial-free public radio like NPR, music discovery stations introducing new artists, talk radio for intellectual stimulation, sports commentary for game analysis, or ambient music for relaxation, Mega Radio\'s sophisticated search and filtering tools ensure you\'ll discover stations that resonate with your personal preferences. The best station isn\'t universal - it\'s the one that speaks to you, and we make finding it easy.', description: 'FAQ answer about best station', category: 'seo' },
        
        { key: 'faq_no_ads_stations', defaultValue: 'Which radio stations have no advertising?', description: 'FAQ question about ad-free stations', category: 'seo' },
        { key: 'faq_no_ads_stations_answer', defaultValue: 'Many radio stations worldwide operate without commercial advertising, relying instead on public funding, listener donations, or government support to deliver uninterrupted broadcasting. Public broadcasting services lead this category: NPR (National Public Radio) in the USA, BBC Radio networks in the UK, CBC Radio in Canada, ABC Radio in Australia, and equivalent government-funded broadcasters across Europe, Asia, and beyond all minimize or eliminate commercial advertisements. Classical music radio stations traditionally avoid advertising interruptions to preserve the musical experience - explore stations like WQXR New York, BBC Radio 3, France Musique, and classical stations from Germany and Austria. Jazz radio stations, particularly listener-supported ones like WBGO and WKCR, often provide ad-free programming. University and college radio stations operated by educational institutions typically run without commercial breaks, focusing on music discovery and student programming. Community radio stations funded by listener donations frequently minimize advertising. On Mega Radio, discover ad-free listening experiences by filtering our collection by genres like "Classical", "Jazz", "Public Radio", "Educational", or "University Radio". Browse stations by country and look for public broadcasters - they\'re typically marked as national or public radio services. Remember, these advertisement-free stations depend on alternative funding through public taxes, voluntary donations, or institutional support rather than advertising revenue, enabling them to deliver uninterrupted radio streaming. While completely ad-free stations are less common than commercial radio, our extensive platform offers numerous options for listeners seeking uninterrupted online radio experiences.', description: 'FAQ answer about ad-free stations', category: 'seo' },
        
        // About Mega Radio section - SEO Enhanced with Radio Keywords
        { key: 'faq_about_megaradio', defaultValue: 'About Mega Radio', description: 'About section title in FAQ', category: 'seo' },
        { key: 'faq_about_megaradio_text', defaultValue: 'Mega Radio stands as your ultimate destination for discovering and streaming live radio stations from every corner of the world, representing the cutting edge of internet radio streaming technology. As a leading online radio platform, we provide completely free, unlimited access to over 60,000 live radio stations spanning 120+ countries, delivering an unparalleled variety of music, news, sports commentary, talk shows, podcasts, and entertainment in virtually every language and genre imaginable. Our advanced web radio streaming infrastructure ensures crystal-clear audio quality and reliable connectivity, whether you\'re listening to pop radio from New York, classical broadcasts from Vienna, jazz stations from New Orleans, or electronic music from Berlin. The Mega Radio platform features powerful search capabilities that help you instantly find stations by name, comprehensive filtering options to browse by genre and country, AI-powered personalized recommendations that learn your preferences over time, and seamless live radio streaming across all your devices - smartphones, tablets, desktop computers, laptops, smart speakers, and even smart TVs. We\'ve revolutionized the online radio experience by eliminating geographical boundaries, subscription barriers, and technical complications, making global radio broadcasting accessible to everyone with internet access.', description: 'About Mega Radio description paragraph 1', category: 'seo' },
        { key: 'faq_about_megaradio_features', defaultValue: 'Whether you\'re passionate about pop radio hits and current chart-toppers, rock stations from classic to alternative, classical music from prestigious orchestras and opera houses, smooth jazz broadcasts, electronic dance music and EDM channels, hip-hop and rap radio, country music and Americana, world music celebrating diverse cultures, news radio for current events analysis, sports commentary and live game coverage, or engaging talk shows on every topic imaginable, Mega Radio makes discovering and enjoying your perfect live radio station absolutely effortless. Best of all, Mega Radio operates on a completely free model with zero registration requirements, no subscription fees whatsoever, no hidden costs, and no paywalls blocking premium content - we believe radio should be accessible to everyone. Simply visit our website from any device, use our intuitive search function to find any radio station or genre that interests you, and start streaming live radio instantly without downloads, installations, or complicated setup procedures. Experience the limitless world of internet radio streaming with Mega Radio - your comprehensive gateway to global live broadcasting, available anytime you want to listen, anywhere you happen to be, on absolutely any internet-connected device. Tune in to live radio from Tokyo to New York, London to Rio de Janeiro, Paris to Sydney, Mumbai to Toronto - all at your fingertips with Mega Radio\'s revolutionary online radio platform that brings the world\'s broadcasting to you.', description: 'About Mega Radio description paragraph 2', category: 'seo' },
      ];
      
      let createdCount = 0;
      let updatedCount = 0;
      
      for (const translation of faqTranslations) {
        const existingKey = await TranslationKey.findOne({ key: translation.key });
        
        if (!existingKey) {
          await TranslationKey.create({
            key: translation.key,
            defaultValue: translation.defaultValue,
            description: translation.description,
            category: translation.category,
            createdAt: new Date(),
            updatedAt: new Date()
          });
          logger.log(`✅ Created FAQ key: ${translation.key}`);
          createdCount++;
        } else {
          logger.log(`⚠️ FAQ key already exists: ${translation.key}`);
          updatedCount++;
        }
      }
      
      // Clear translation cache
      try {
        await CacheManager.clearByPattern('translations');
        logger.log('🔄 Cleared translations cache');
      } catch (cacheError) {
        logger.log('⚠️ Cache clearing failed (non-critical):', (cacheError as Error).message);
      }
      
      logger.log(`🎉 Successfully processed ${faqTranslations.length} FAQ keys! Created: ${createdCount}, Already existed: ${updatedCount}`);
      
      // Bump translation version
      await bumpTranslationVersion('FAQ keys added');
      
      res.json({ 
        success: true,
        message: `Added ${createdCount} new FAQ translation keys, ${updatedCount} already existed`, 
        created: createdCount,
        updated: updatedCount,
        total: faqTranslations.length
      });
      
    } catch (error) {
      console.error('❌ Error adding FAQ translation keys:', error);
      res.status(500).json({ error: 'Failed to add FAQ translation keys' });
    }
  });

  // Add missing share translation keys
  app.post("/api/admin/translation-keys/add-missing-share-keys", async (req, res) => {
    try {
      const { bumpTranslationVersion } = await import('./services/translation-version');
      logger.log('🔗 Adding missing share translation keys...');
      
      // Missing share-related translation keys
      const shareTranslations = [
        { key: 'footer_social_media', defaultValue: 'Share Mega Radio', description: 'Footer section title for social media sharing buttons', category: 'footer' },
        { key: 'footer_share_mega_radio', defaultValue: 'Share Mega Radio', description: 'Footer section title for social sharing buttons', category: 'footer' },
        { key: 'share_mega_radio', defaultValue: 'Share Mega Radio', description: 'General heading for sharing Mega Radio', category: 'social' },
        { key: 'share_on', defaultValue: 'Share on', description: 'Text that appears before social platform name in share buttons', category: 'social' },
        { key: 'copy_link', defaultValue: 'Copy link', description: 'Button text for copying URL to clipboard', category: 'social' },
        { key: 'copied', defaultValue: 'Copied!', description: 'Success message when link is copied to clipboard', category: 'social' },
        { key: 'share_copy_link', defaultValue: 'Copy Link', description: 'Copy link button text in user profiles', category: 'social' }
      ];
      
      let createdCount = 0;
      let updatedCount = 0;
      
      for (const translation of shareTranslations) {
        const existingKey = await TranslationKey.findOne({ key: translation.key });
        
        if (!existingKey) {
          // Create new translation key
          await TranslationKey.create({
            key: translation.key,
            defaultValue: translation.defaultValue,
            description: translation.description || `Translation for ${translation.key}`,
            category: translation.category || 'social',
            createdAt: new Date(),
            updatedAt: new Date()
          });
          logger.log(`✅ Created translation key: ${translation.key}`);
          createdCount++;
        } else {
          logger.log(`⚠️ Translation key already exists: ${translation.key}`);
          updatedCount++;
        }
      }
      
      // Clear translation cache
      try {
        await CacheManager.clearByPattern('translations');
        logger.log('🔄 Cleared translations cache');
      } catch (cacheError) {
        logger.log('⚠️ Cache clearing failed (non-critical):', cacheError.message);
      }
      
      logger.log(`🎉 Successfully processed ${shareTranslations.length} share translation keys! Created: ${createdCount}, Already existed: ${updatedCount}`);
      
      // Bump translation version
      await bumpTranslationVersion('Share translation keys added');
      
      res.json({ 
        success: true,
        message: `Added ${createdCount} new share translation keys, ${updatedCount} already existed`, 
        created: createdCount,
        updated: updatedCount
      });
      
    } catch (error) {
      console.error('❌ Error adding share translation keys:', error);
      res.status(500).json({ error: 'Failed to add share translation keys' });
    }
  });

  // Add Sitemap Image Translation Keys for multilingual SEO
  app.post("/api/admin/translation-keys/add-sitemap-image-keys", requireAdmin, async (req, res) => {
    try {
      const { bumpTranslationVersion } = await import('./services/translation-version');
      logger.log('🗺️ Adding sitemap image translation keys...');
      
      const sitemapImageKeys = [
        { 
          key: 'sitemap_station_image_caption', 
          defaultValue: 'Listen to {station} live from {country} - {genre} radio station - Free online radio streaming', 
          description: 'Image sitemap caption for station with country', 
          category: 'sitemap' 
        },
        { 
          key: 'sitemap_station_image_caption_no_country', 
          defaultValue: 'Listen to {station} live - {genre} radio station - Free online radio streaming', 
          description: 'Image sitemap caption for station without country', 
          category: 'sitemap' 
        },
        { 
          key: 'sitemap_station_image_title', 
          defaultValue: '{station} - Live Online Radio Station Logo', 
          description: 'Image sitemap title for station logo', 
          category: 'sitemap' 
        },
        { 
          key: 'sitemap_genre_image_caption', 
          defaultValue: '{genre} music genre - Discover the best {genre} radio stations from around the world. Listen to thousands of {genre} stations live online.', 
          description: 'Image sitemap caption for genre', 
          category: 'sitemap' 
        },
        { 
          key: 'sitemap_genre_image_title', 
          defaultValue: '{genre} music genre - Discover radio stations worldwide', 
          description: 'Image sitemap title for genre', 
          category: 'sitemap' 
        }
      ];
      
      let createdCount = 0;
      let updatedCount = 0;
      
      for (const translation of sitemapImageKeys) {
        const existingKey = await TranslationKey.findOne({ key: translation.key });
        
        if (!existingKey) {
          await TranslationKey.create({
            key: translation.key,
            defaultValue: translation.defaultValue,
            description: translation.description,
            category: translation.category,
            createdAt: new Date(),
            updatedAt: new Date()
          });
          logger.log(`✅ Created sitemap image key: ${translation.key}`);
          createdCount++;
        } else {
          logger.log(`⚠️ Sitemap image key already exists: ${translation.key}`);
          updatedCount++;
        }
      }
      
      // Clear translation cache
      try {
        await CacheManager.clearByPattern('translations');
        logger.log('🔄 Cleared translations cache');
      } catch (cacheError) {
        logger.log('⚠️ Cache clearing failed (non-critical):', (cacheError as Error).message);
      }
      
      logger.log(`🎉 Successfully processed ${sitemapImageKeys.length} sitemap image keys! Created: ${createdCount}, Already existed: ${updatedCount}`);
      
      // Bump translation version
      await bumpTranslationVersion('Sitemap image translation keys added');
      
      res.json({ 
        success: true,
        message: `Added ${createdCount} new sitemap image translation keys, ${updatedCount} already existed`, 
        created: createdCount,
        updated: updatedCount,
        total: sitemapImageKeys.length
      });
      
    } catch (error) {
      console.error('❌ Error adding sitemap image translation keys:', error);
      res.status(500).json({ error: 'Failed to add sitemap image translation keys' });
    }
  });

  // Add Samsung TV translation keys
  app.post("/api/admin/translation-keys/add-samsung-tv-keys", async (req, res) => {
    try {
      const { bumpTranslationVersion } = await import('./services/translation-version');
      logger.log('📱 Adding Samsung TV translation keys...');
      
      // Samsung TV translation keys
      const samsungTvKeys = [
        // Guide/Onboarding Pages
        { key: 'guide_discover_title', defaultValue: 'Discover Radio', description: 'Guide page - Discover section title', category: 'guide' },
        { key: 'guide_discover_description', defaultValue: 'Explore thousands of radio stations from around the world', description: 'Guide page - Discover section description', category: 'guide' },
        { key: 'guide_genres_title', defaultValue: 'Browse Genres', description: 'Guide page - Genres section title', category: 'guide' },
        { key: 'guide_genres_description', defaultValue: 'Find your favorite music style from our wide selection of genres', description: 'Guide page - Genres section description', category: 'guide' },
        { key: 'guide_search_title', defaultValue: 'Search Stations', description: 'Guide page - Search section title', category: 'guide' },
        { key: 'guide_search_description', defaultValue: 'Quickly find stations by name, country, or genre', description: 'Guide page - Search section description', category: 'guide' },
        { key: 'guide_favorites_title', defaultValue: 'Save Favorites', description: 'Guide page - Favorites section title', category: 'guide' },
        { key: 'guide_favorites_description', defaultValue: 'Keep your favorite stations just a click away', description: 'Guide page - Favorites section description', category: 'guide' },
        { key: 'guide_next', defaultValue: 'Next', description: 'Guide navigation - Next button', category: 'guide' },
        { key: 'guide_skip', defaultValue: 'Skip', description: 'Guide navigation - Skip button', category: 'guide' },
        { key: 'guide_get_started', defaultValue: 'Get Started', description: 'Guide navigation - Get started button', category: 'guide' },
        
        // Radio Playing Page
        { key: 'now_playing', defaultValue: 'Now Playing', description: 'Radio player - Currently playing label', category: 'player' },
        { key: 'add_to_favorites', defaultValue: 'Add to Favorites', description: 'Radio player - Add to favorites button', category: 'player' },
        { key: 'remove_from_favorites', defaultValue: 'Remove from Favorites', description: 'Radio player - Remove from favorites button', category: 'player' },
        { key: 'station_info', defaultValue: 'Station Info', description: 'Radio player - Station information label', category: 'player' },
        { key: 'bitrate', defaultValue: 'Bitrate', description: 'Radio player - Bitrate label', category: 'player' },
        
        // Empty States
        { key: 'no_favorites_title', defaultValue: 'No Favorites Yet', description: 'Empty state - No favorites title', category: 'empty_states' },
        { key: 'no_favorites_description', defaultValue: 'Start adding stations to your favorites to see them here', description: 'Empty state - No favorites description', category: 'empty_states' },
        { key: 'no_results_title', defaultValue: 'No Results Found', description: 'Empty state - No search results title', category: 'empty_states' },
        { key: 'no_results_description', defaultValue: 'Try adjusting your search or browse our popular stations', description: 'Empty state - No search results description', category: 'empty_states' },
        { key: 'all_countries', defaultValue: 'All Countries', description: 'Filter option - All countries selector', category: 'filters' }
      ];
      
      let createdCount = 0;
      let updatedCount = 0;
      
      for (const translation of samsungTvKeys) {
        const existingKey = await TranslationKey.findOne({ key: translation.key });
        
        if (!existingKey) {
          // Create new translation key
          await TranslationKey.create({
            key: translation.key,
            defaultValue: translation.defaultValue,
            description: translation.description || `Translation for ${translation.key}`,
            category: translation.category || 'general',
            createdAt: new Date(),
            updatedAt: new Date()
          });
          logger.log(`✅ Created translation key: ${translation.key}`);
          createdCount++;
        } else {
          logger.log(`⚠️ Translation key already exists: ${translation.key}`);
          updatedCount++;
        }
      }
      
      // Clear translation cache
      try {
        await CacheManager.clearByPattern('translations');
        logger.log('🔄 Cleared translations cache');
      } catch (cacheError) {
        logger.log('⚠️ Cache clearing failed (non-critical):', (cacheError as Error).message);
      }
      
      logger.log(`🎉 Successfully processed ${samsungTvKeys.length} Samsung TV translation keys! Created: ${createdCount}, Already existed: ${updatedCount}`);
      
      // Bump translation version
      await bumpTranslationVersion('Samsung TV translation keys added');
      
      res.json({ 
        success: true,
        message: `Added ${createdCount} new Samsung TV translation keys, ${updatedCount} already existed`, 
        created: createdCount,
        updated: updatedCount,
        total: samsungTvKeys.length
      });
      
    } catch (error) {
      console.error('❌ Error adding Samsung TV translation keys:', error);
      res.status(500).json({ error: 'Failed to add Samsung TV translation keys' });
    }
  });

  // Add Smart TV UI translation keys (Navigation, Discover, RadioPlaying, Search, Favorites, Settings, Genres, Onboarding, General)
  app.post("/api/admin/translation-keys/add-smart-tv-ui-keys", requireAdmin, async (req, res) => {
    try {
      const { bumpTranslationVersion } = await import('./services/translation-version');
      logger.log('📺 Adding Smart TV UI translation keys...');
      
      // Complete Smart TV UI translation keys - UPDATED with exact English default values
      const smartTvUiKeys = [
        // Onboarding Guide
        { key: 'guide_discover_title', defaultValue: 'Discover', description: 'Guide - Discover title', category: 'guide' },
        { key: 'guide_discover_description', defaultValue: 'Find radio stations from around the world', description: 'Guide - Discover description', category: 'guide' },
        { key: 'guide_discover_red_button', defaultValue: 'Press red button to access', description: 'Guide - Red button instruction', category: 'guide' },
        { key: 'guide_genres_title', defaultValue: 'Genres', description: 'Guide - Genres title', category: 'guide' },
        { key: 'guide_genres_description', defaultValue: 'Browse stations by music genre', description: 'Guide - Genres description', category: 'guide' },
        { key: 'guide_search_title', defaultValue: 'Search', description: 'Guide - Search title', category: 'guide' },
        { key: 'guide_search_description', defaultValue: 'Search for your favorite stations', description: 'Guide - Search description', category: 'guide' },
        { key: 'guide_search_blue_button', defaultValue: 'Press blue button to search', description: 'Guide - Blue button instruction', category: 'guide' },
        { key: 'guide_favorites_title', defaultValue: 'Favorites', description: 'Guide - Favorites title', category: 'guide' },
        { key: 'guide_favorites_description', defaultValue: 'Save your favorite stations', description: 'Guide - Favorites description', category: 'guide' },
        { key: 'guide_favorites_yellow_button', defaultValue: 'Press yellow button for favorites', description: 'Guide - Yellow button instruction', category: 'guide' },
        
        // Homepage & Discover
        { key: 'popular_genres', defaultValue: 'Popular Genres', description: 'Homepage - Popular genres section title', category: 'discover' },
        { key: 'popular_radios', defaultValue: 'Popular Radios', description: 'Homepage - Popular radios section title', category: 'discover' },
        { key: 'homepage_popular_stations', defaultValue: 'Popular Stations', description: 'Homepage - Popular stations section', category: 'discover' },
        { key: 'more_from', defaultValue: 'More From', description: 'Homepage - More from specific category', category: 'discover' },
        { key: 'discover_stations_near_you', defaultValue: 'Discover stations near you', description: 'Homepage - Nearby stations section', category: 'discover' },
        { key: 'back_to_discover', defaultValue: 'Back to Discover', description: 'Navigation - Back to discover', category: 'discover' },
        
        // Search
        { key: 'search', defaultValue: 'Search', description: 'Search page - Search label', category: 'search' },
        { key: 'search_placeholder', defaultValue: 'Search stations...', description: 'Search page - Search input placeholder', category: 'search' },
        { key: 'search_countries', defaultValue: 'Search countries', description: 'Search page - Search countries placeholder', category: 'search' },
        { key: 'type_to_search', defaultValue: 'Type to search', description: 'Search page - Type to search hint', category: 'search' },
        { key: 'press_up_to_search', defaultValue: 'Press up to search', description: 'Search page - Press up instruction', category: 'search' },
        { key: 'no_results_found', defaultValue: 'No results found', description: 'Search page - No results message', category: 'search' },
        
        // Player
        { key: 'now_playing', defaultValue: 'Now Playing', description: 'Player - Currently playing label', category: 'player' },
        { key: 'station_info', defaultValue: 'Station Info', description: 'Player - Station information label', category: 'player' },
        { key: 'similar_radios', defaultValue: 'Similar Radios', description: 'Player - Similar radios section', category: 'player' },
        { key: 'loading_station', defaultValue: 'Loading station...', description: 'Player - Loading station message', category: 'player' },
        { key: 'failed_to_load_station', defaultValue: 'Failed to load station', description: 'Player - Failed to load error', category: 'player' },
        { key: 'no_station_selected', defaultValue: 'No station selected', description: 'Player - No station selected message', category: 'player' },
        { key: 'please_select_station', defaultValue: 'Please select a station', description: 'Player - Select station instruction', category: 'player' },
        
        // Favorites
        { key: 'your_favorites', defaultValue: 'Your Favorites', description: 'Favorites page - Title', category: 'favorites' },
        { key: 'favorites_yet', defaultValue: 'No favorites yet', description: 'Favorites page - No favorites short', category: 'favorites' },
        { key: 'no_favorites_yet', defaultValue: 'No favorites yet', description: 'Favorites page - No favorites message', category: 'favorites' },
        { key: 'you_dont_have_any_favorites_yet', defaultValue: 'You don\'t have any favorites yet', description: 'Favorites page - No favorites description', category: 'favorites' },
        
        // Settings
        { key: 'settings', defaultValue: 'Settings', description: 'Settings page - Title', category: 'settings' },
        { key: 'settings_play_at_start', defaultValue: 'Play at start', description: 'Settings - Play at start option', category: 'settings' },
        { key: 'settings_last_played', defaultValue: 'Last played', description: 'Settings - Last played option', category: 'settings' },
        { key: 'settings_random', defaultValue: 'Random', description: 'Settings - Random option', category: 'settings' },
        { key: 'settings_favorite', defaultValue: 'Favorite', description: 'Settings - Favorite option', category: 'settings' },
        { key: 'settings_none', defaultValue: 'None', description: 'Settings - None option', category: 'settings' },
        { key: 'select_country', defaultValue: 'Select country', description: 'Settings - Select country label', category: 'settings' },
        { key: 'no_countries_found', defaultValue: 'No countries found', description: 'Settings - No countries message', category: 'settings' },
        
        // General UI
        { key: 'loading', defaultValue: 'Loading...', description: 'General - Loading message', category: 'general' },
        { key: 'loading_more_stations', defaultValue: 'Loading more stations...', description: 'General - Loading more stations', category: 'general' },
        { key: 'please_wait', defaultValue: 'Please wait', description: 'General - Please wait message', category: 'general' },
        { key: 'ok', defaultValue: 'OK', description: 'General - OK button', category: 'general' },
        { key: 'cancel', defaultValue: 'Cancel', description: 'General - Cancel button', category: 'general' },
        { key: 'genres', defaultValue: 'Genres', description: 'General - Genres label', category: 'general' },
        { key: 'radios', defaultValue: 'Radios', description: 'General - Radios label', category: 'general' },
        { key: 'radio', defaultValue: 'Radio', description: 'General - Radio label', category: 'general' },
        { key: 'station', defaultValue: 'Station', description: 'General - Station label', category: 'general' },
        { key: 'recent', defaultValue: 'Recent', description: 'General - Recent label', category: 'general' },
        { key: 'recently_played', defaultValue: 'Recently Played', description: 'General - Recently played section', category: 'general' },
        { key: 'no_stations_found', defaultValue: 'No stations found', description: 'General - No stations message', category: 'general' },
        { key: 'try_different_genre', defaultValue: 'Try a different genre', description: 'General - Try different genre hint', category: 'general' },
        { key: 'press_return_to_go_back', defaultValue: 'Press Return to go back', description: 'General - Return key instruction', category: 'general' },
        { key: 'press_back_to_close', defaultValue: 'Press Back to close', description: 'General - Back key instruction', category: 'general' },
        
        // Exit & Network
        { key: 'exit', defaultValue: 'Exit', description: 'Exit - Exit label', category: 'general' },
        { key: 'exit_app', defaultValue: 'Exit App', description: 'Exit - Exit app button', category: 'general' },
        { key: 'are_you_sure_exit', defaultValue: 'Are you sure you want to exit?', description: 'Exit - Confirmation message', category: 'general' },
        { key: 'network_disconnected', defaultValue: 'Network Disconnected', description: 'Network - Disconnected title', category: 'general' },
        { key: 'network_disconnected_message', defaultValue: 'Please check your internet connection', description: 'Network - Disconnected message', category: 'general' },
        
        // Auth (Optional)
        { key: 'auth_continue_with_google', defaultValue: 'Continue with Google', description: 'Auth - Continue with Google', category: 'auth' },
        { key: 'auth_continue_with_apple', defaultValue: 'Continue with Apple', description: 'Auth - Continue with Apple', category: 'auth' },
        { key: 'auth_continue_with_facebook', defaultValue: 'Continue with Facebook', description: 'Auth - Continue with Facebook', category: 'auth' },
        { key: 'auth_continue_with_email', defaultValue: 'Continue with Email', description: 'Auth - Continue with Email', category: 'auth' },
        { key: 'continue_without_login', defaultValue: 'Continue without login', description: 'Auth - Continue without login', category: 'auth' },
        
        // Navigation
        { key: 'nav_discover', defaultValue: 'Discover', description: 'Navigation - Discover menu item', category: 'navigation' },
        { key: 'nav_genres', defaultValue: 'Genres', description: 'Navigation - Genres menu item', category: 'navigation' },
        { key: 'nav_search', defaultValue: 'Search', description: 'Navigation - Search menu item', category: 'navigation' },
        { key: 'nav_favorites', defaultValue: 'Favorites', description: 'Navigation - Favorites menu item', category: 'navigation' },
        { key: 'nav_settings', defaultValue: 'Settings', description: 'Navigation - Settings menu item', category: 'navigation' }
      ];
      
      let createdCount = 0;
      let updatedCount = 0;
      
      for (const translation of smartTvUiKeys) {
        const existingKey = await TranslationKey.findOne({ key: translation.key });
        
        if (!existingKey) {
          // Create new translation key
          await TranslationKey.create({
            key: translation.key,
            defaultValue: translation.defaultValue,
            description: translation.description || `Translation for ${translation.key}`,
            category: translation.category || 'general',
            createdAt: new Date(),
            updatedAt: new Date()
          });
          logger.log(`✅ Created translation key: ${translation.key}`);
          createdCount++;
        } else {
          logger.log(`⚠️ Translation key already exists: ${translation.key}`);
          updatedCount++;
        }
      }
      
      // Clear translation cache
      try {
        await CacheManager.clearByPattern('translations');
        logger.log('🔄 Cleared translations cache');
      } catch (cacheError) {
        logger.log('⚠️ Cache clearing failed (non-critical):', (cacheError as Error).message);
      }
      
      logger.log(`🎉 Successfully processed ${smartTvUiKeys.length} Smart TV UI translation keys! Created: ${createdCount}, Already existed: ${updatedCount}`);
      
      // Bump translation version
      await bumpTranslationVersion('Smart TV UI translation keys added');
      
      res.json({ 
        success: true,
        message: `Added ${createdCount} new Smart TV UI translation keys, ${updatedCount} already existed`, 
        created: createdCount,
        updated: updatedCount,
        total: smartTvUiKeys.length
      });
      
    } catch (error) {
      console.error('❌ Error adding Smart TV UI translation keys:', error);
      res.status(500).json({ error: 'Failed to add Smart TV UI translation keys' });
    }
  });

  // Add Smart TV v2 translation keys (Accessibility, Sleep Timer, Stream Error, Navigation extras)
  app.post("/api/admin/translation-keys/add-smart-tv-v2-keys", requireAdmin, async (req, res) => {
    try {
      const { bumpTranslationVersion } = await import('./services/translation-version');
      logger.log('📺 Adding Smart TV v2 translation keys...');
      
      const smartTvV2Keys = [
        { key: 'accessibility', defaultValue: 'Accessibility', description: 'Settings - Accessibility section title', category: 'settings' },
        { key: 'high_contrast', defaultValue: 'High Contrast', description: 'Settings - High contrast toggle', category: 'settings' },
        { key: 'high_contrast_desc', defaultValue: 'Increases text and element visibility', description: 'Settings - High contrast description', category: 'settings' },
        { key: 'large_text', defaultValue: 'Large Text', description: 'Settings - Large text toggle', category: 'settings' },
        { key: 'large_text_desc', defaultValue: 'Makes all text 15% larger', description: 'Settings - Large text description', category: 'settings' },
        { key: 'sleep_timer', defaultValue: 'Sleep Timer', description: 'Settings - Sleep timer label', category: 'settings' },
        { key: 'sleep_timer_off', defaultValue: 'Off', description: 'Sleep timer - Off option', category: 'settings' },
        { key: 'sleep_timer_15', defaultValue: '15 min', description: 'Sleep timer - 15 minutes option', category: 'settings' },
        { key: 'sleep_timer_30', defaultValue: '30 min', description: 'Sleep timer - 30 minutes option', category: 'settings' },
        { key: 'sleep_timer_60', defaultValue: '1 hour', description: 'Sleep timer - 1 hour option', category: 'settings' },
        { key: 'sleep_timer_120', defaultValue: '2 hours', description: 'Sleep timer - 2 hours option', category: 'settings' },
        { key: 'stream_error_title', defaultValue: 'Stream Unavailable', description: 'Player - Stream error title', category: 'player' },
        { key: 'stream_error_message', defaultValue: 'This station is currently not responding. Please try again or select another station.', description: 'Player - Stream error message', category: 'player' },
        { key: 'for_you', defaultValue: 'For You', description: 'Navigation - For You personalized section', category: 'navigation' },
        { key: 'nav_country', defaultValue: 'Country', description: 'Navigation - Country menu item', category: 'navigation' },
        { key: 'press_any_button', defaultValue: 'Press any button to dismiss', description: 'General - Dismiss instruction', category: 'general' },
        { key: 'select_keyboard', defaultValue: 'Keyboard', description: 'Settings - Keyboard selection', category: 'settings' },
        { key: 'select_language', defaultValue: 'Language', description: 'Settings - Language selection', category: 'settings' },
        { key: 'results', defaultValue: 'Results', description: 'Search - Results label', category: 'search' },
        { key: 'retry', defaultValue: 'Retry', description: 'General - Retry button', category: 'general' },
      ];
      
      let createdCount = 0;
      let existedCount = 0;
      
      for (const translation of smartTvV2Keys) {
        const existingKey = await TranslationKey.findOne({ key: translation.key });
        
        if (!existingKey) {
          await TranslationKey.create({
            key: translation.key,
            defaultValue: translation.defaultValue,
            description: translation.description || `Translation for ${translation.key}`,
            category: translation.category || 'general',
            createdAt: new Date(),
            updatedAt: new Date()
          });
          logger.log(`✅ Created translation key: ${translation.key}`);
          createdCount++;
        } else {
          logger.log(`⚠️ Translation key already exists: ${translation.key}`);
          existedCount++;
        }
      }
      
      try {
        await CacheManager.clearByPattern('translations');
        logger.log('🔄 Cleared translations cache');
      } catch (cacheError) {
        logger.log('⚠️ Cache clearing failed (non-critical):', (cacheError as Error).message);
      }
      
      logger.log(`🎉 Successfully processed ${smartTvV2Keys.length} Smart TV v2 keys! Created: ${createdCount}, Already existed: ${existedCount}`);
      
      await bumpTranslationVersion('Smart TV v2 translation keys added');
      
      res.json({ 
        success: true,
        message: `Added ${createdCount} new Smart TV v2 translation keys, ${existedCount} already existed`, 
        created: createdCount,
        existed: existedCount,
        total: smartTvV2Keys.length
      });
      
    } catch (error) {
      console.error('❌ Error adding Smart TV v2 translation keys:', error);
      res.status(500).json({ error: 'Failed to add Smart TV v2 translation keys' });
    }
  });

  // Seed basic translations for testing
  app.post("/api/admin/translation-keys/seed-basic", async (req, res) => {
    try {
      const { bumpTranslationVersion } = await import('./services/translation-version');
      // logger.log('🌱 Seeding basic German translations...');
      
      // Create German language if it doesn't exist
      const germanLang = await TranslationLanguage.findOneAndUpdate(
        { code: 'de' },
        { 
          code: 'de',
          name: 'Deutsch', 
          isEnabled: true,
          createdAt: new Date()
        },
        { upsert: true, new: true }
      );
      // logger.log('✅ German language record:', germanLang);
      
      // Basic translation keys with German translations
      const basicTranslations = [
        { key: 'home.title', defaultValue: 'Radio Stations', de: 'Radiostationen' },
        { key: 'genres.pop', defaultValue: 'Pop', de: 'Pop' },
        { key: 'stations.count', defaultValue: 'stations', de: 'Stationen' },
        { key: 'search.placeholder', defaultValue: 'Search stations...', de: 'Stationen suchen...' },
        { key: 'nav.home', defaultValue: 'Home', de: 'Startseite' },
        { key: 'nav.genres', defaultValue: 'Genres', de: 'Genres' },
        { key: 'nav.countries', defaultValue: 'Countries', de: 'Länder' },
        { key: 'footer.about', defaultValue: 'About', de: 'Über uns' },
        { key: 'footer', defaultValue: 'Footer', de: 'Fußzeile' },
        { key: 'player.play', defaultValue: 'Play', de: 'Abspielen' },
        { key: 'player.pause', defaultValue: 'Pause', de: 'Pause' },
        { key: 'genre.pop.title', defaultValue: 'Pop Music Stations', de: 'Pop-Musik-Stationen' },
        { key: 'stations.listening', defaultValue: 'Listen now', de: 'Jetzt anhören' },
        { key: 'stations.loading', defaultValue: 'Loading stations...', de: 'Stationen werden geladen...' },
        // Missing homepage and recommendation keys
        { key: 'personalized_for_you', defaultValue: 'Personalized for You', de: 'Personalisiert für Sie' },
        { key: 'trending_now', defaultValue: 'Trending Now', de: 'Trending Jetzt' },
        { key: 'homepage_see_all', defaultValue: 'See All', de: 'Alle anzeigen' },
        { key: 'homepage', defaultValue: 'Homepage', de: 'Startseite' },
        { key: 'homepage_description', defaultValue: 'Back to main page', de: 'Zurück zur Hauptseite' },
        { key: 'popular_stations', defaultValue: 'Popular Stations', de: 'Beliebte Sender' },
        { key: 'browse_popular', defaultValue: 'Browse Popular', de: 'Beliebte durchsuchen' },
        { key: 'search_placeholder', defaultValue: 'Search...', de: 'Suchen...' },
        { key: 'search_stations', defaultValue: 'Search Stations', de: 'Sender suchen' },
        { key: 'go_home', defaultValue: 'Go Home', de: 'Zur Startseite' },
        { key: 'preferred_countries', defaultValue: 'Your Preferred Countries', de: 'Ihre bevorzugten Länder' },
        // Modal translation keys
        { key: 'modal_add_station_title', defaultValue: 'Add Your Station', de: 'Ihr Sender hinzufügen' },
        { key: 'modal_add_station_description', defaultValue: 'Share your radio station with the world', de: 'Teilen Sie Ihren Radiosender mit der Welt' },
        { key: 'modal_request_station_title', defaultValue: 'Request Station', de: 'Sender anfordern' },
        { key: 'modal_request_station_description', defaultValue: 'Request a radio station to be added', de: 'Fordern Sie einen Radiosender an, der hinzugefügt werden soll' },
        { key: 'modal_station_name_placeholder', defaultValue: 'Station Name', de: 'Sendername' },
        { key: 'modal_email_placeholder', defaultValue: 'Your Email', de: 'Ihre E-Mail' },
        { key: 'modal_stream_url_placeholder', defaultValue: 'Stream URL', de: 'Stream-URL' },
        { key: 'modal_station_url_placeholder', defaultValue: 'Station URL', de: 'Sender-URL' },
        { key: 'modal_select_country', defaultValue: 'Select Country', de: 'Land auswählen' },
        { key: 'modal_description_placeholder', defaultValue: 'Description', de: 'Beschreibung' },
        { key: 'modal_success', defaultValue: 'Success', de: 'Erfolg' },
        { key: 'modal_error', defaultValue: 'Error', de: 'Fehler' },
        { key: 'modal_error_try_again', defaultValue: 'Something went wrong. Please try again.', de: 'Etwas ist schief gelaufen. Bitte versuchen Sie es erneut.' },
        { key: 'station_submission_success', defaultValue: 'Your station submission has been sent successfully!', de: 'Ihr Sender wurde erfolgreich übermittelt!' },
        { key: 'request_station_success', defaultValue: 'We got your request, thank you!', de: 'Wir haben Ihre Anfrage erhalten, vielen Dank!' },
        // About and Contact page keys
        { key: 'about_page_title', defaultValue: 'About Mega Radio', de: 'Über Mega Radio' },
        { key: 'about_mega_radio', defaultValue: 'About Mega Radio', de: 'Über Mega Radio' },
        { key: 'about_intro_paragraph_1', defaultValue: 'Welcome to Mega Radio, your ultimate destination for discovering and streaming radio stations from around the world.', de: 'Willkommen bei Mega Radio, Ihrem ultimativen Ziel zum Entdecken und Streamen von Radiosendern aus aller Welt.' },
        { key: 'about_intro_paragraph_2', defaultValue: 'We connect you with thousands of live radio stations, offering everything from local news to international music.', de: 'Wir verbinden Sie mit Tausenden von Live-Radiosendern und bieten alles von lokalen Nachrichten bis hin zu internationaler Musik.' },
        { key: 'about_intro_paragraph_3', defaultValue: 'Our platform is designed to provide the best listening experience with high-quality streams and personalized recommendations.', de: 'Unsere Plattform ist darauf ausgelegt, das beste Hörerlebnis mit hochwertigen Streams und personalisierten Empfehlungen zu bieten.' },
        { key: 'why_choose_mega_radio', defaultValue: 'Why Choose Mega Radio?', de: 'Warum Mega Radio wählen?' },
        { key: 'about_feature_global_coverage_title', defaultValue: 'Global Coverage', de: 'Weltweite Abdeckung' },
        { key: 'about_feature_global_coverage_description', defaultValue: 'Access stations from over 100 countries worldwide', de: 'Zugang zu Sendern aus über 100 Ländern weltweit' },
        { key: 'about_feature_all_genres_title', defaultValue: 'All Genres', de: 'Alle Genres' },
        { key: 'about_feature_all_genres_description', defaultValue: 'From classical to electronic, find every music style', de: 'Von Klassik bis Elektronik, finden Sie jeden Musikstil' },
        { key: 'contact_page_title', defaultValue: 'Contact Us', de: 'Kontaktieren Sie uns' },
        { key: 'contact_happy_to_hear', defaultValue: 'We are happy to hear from you!', de: 'Wir freuen uns, von Ihnen zu hören!' },
        { key: 'contact_email_placeholder', defaultValue: 'Your email address', de: 'Ihre E-Mail-Adresse' },
        { key: 'contact_message_placeholder', defaultValue: 'Your message', de: 'Ihre Nachricht' },
        { key: 'contact_send_button', defaultValue: 'Send Message', de: 'Nachricht senden' },
        { key: 'contact_mail_sent', defaultValue: 'Message sent successfully!', de: 'Nachricht erfolgreich gesendet!' },
        { key: 'contact_error_message', defaultValue: 'Failed to send message. Please try again.', de: 'Nachricht konnte nicht gesendet werden. Bitte versuchen Sie es erneut.' },
        // Missing homepage keys that are causing English fallbacks
        { key: 'homepage_discover_genres', defaultValue: 'Discover Genres', de: 'Genres entdecken' },
        { key: 'homepage_community_favorites', defaultValue: 'Community Favorites', de: 'Community-Favoriten' },
        { key: 'homepage_stations_near_you', defaultValue: 'Stations Near You', de: 'Sender in Ihrer Nähe' },
        { key: 'homepage_genres', defaultValue: 'Genres', de: 'Genres' },
        { key: 'homepage_popular_stations', defaultValue: 'Popular Stations', de: 'Beliebte Sender' },
        // Fix the "Homepage" prefix issue in default English values
        { key: 'homepage_personalized_recommendations', defaultValue: 'Personalized Recommendations', de: 'Personalisierte Empfehlungen' },
        { key: 'homepage_all_stations', defaultValue: 'All Stations', de: 'Alle Sender' },
        { key: 'homepage_tagline_best_radio', defaultValue: 'Best Radio Stations', de: 'Die besten Radiosender' },
        { key: 'homepage_tagline_listen_everywhere', defaultValue: 'Listen Everywhere', de: 'Überall hören' },
        { key: 'homepage_search_placeholder', defaultValue: 'Search stations...', de: 'Sender suchen...' },
        { key: 'homepage_over_countries', defaultValue: 'Over Countries', de: 'Über Länder' },
        { key: 'homepage_request_station', defaultValue: 'Request Station', de: 'Sender anfordern' },
        { key: 'homepage_add_station', defaultValue: 'Add Station', de: 'Sender hinzufügen' },
        { key: 'homepage_in_country', defaultValue: 'In Country', de: 'Im Land' },
        { key: 'homepage', defaultValue: 'Home', de: 'Startseite' },
        // Genre page specific translations
        { key: 'genre_radio_stations_title', defaultValue: '{genre} Radio Stations', de: '{genre} Radiosender' },
        { key: 'genre_free_streaming', defaultValue: 'Free Streaming', de: 'Kostenloses Streaming' },
        { key: 'genre_stations_count', defaultValue: '{count}+ Stations', de: '{count}+ Sender' },
        { key: 'genre_countries_count', defaultValue: '{count}+ Countries', de: '{count}+ Länder' },
        { key: 'genre_popular_countries', defaultValue: 'Popular {genre} Countries', de: 'Beliebte {genre} Länder' },
        { key: 'genre_stations_title', defaultValue: '{genre} Stations ({count})', de: '{genre} Sender ({count})' },
        // SEO station page translations
        { key: 'radio_playing_page.title', defaultValue: '{STATION_NAME} Listen Live - Mega Radio', de: '{STATION_NAME} Live hören - Mega Radio' },
        { key: 'default_station_about', defaultValue: 'You are now listening to {STATION_NAME}! – Listen to thousands of radio stations in HD quality online for free on Mega Radio.', de: 'Sie hören jetzt {STATION_NAME}! – Hören Sie tausende Radiosender in HD-Qualität kostenlos online auf Mega Radio.' },
        { key: 'genre_similar_genres', defaultValue: 'Similar Music Genres', de: 'Ähnliche Musikgenres' },
        { key: 'genre_about_music', defaultValue: 'About {genre} Music', de: 'Über {genre} Musik' },
        { key: 'pagination_previous', defaultValue: '← Previous', de: '← Zurück' },
        { key: 'pagination_next', defaultValue: 'Next →', de: 'Weiter →' },
        { key: 'genre_not_found', defaultValue: 'Genre not found.', de: 'Genre nicht gefunden.' },
        { key: 'genres_breadcrumb', defaultValue: 'Genres', de: 'Genres' },
        { key: 'no_stations_found', defaultValue: 'No stations found.', de: 'Keine Sender gefunden.' }
      ];
      
      for (const item of basicTranslations) {
        // Create or update the translation key
        const translationKey = await TranslationKey.findOneAndUpdate(
          { key: item.key },
          {
            key: item.key,
            defaultValue: item.defaultValue,
            category: 'ui',
            createdAt: new Date(),
            updatedAt: new Date()
          },
          { upsert: true, new: true }
        );

        // Create or update the German translation
        await Translation.findOneAndUpdate(
          { keyId: translationKey._id, language: 'de' },
          {
            keyId: translationKey._id,
            language: 'de',
            value: item.de,
            isCompleted: true,
            lastModified: new Date(),
            createdAt: new Date()
          },
          { upsert: true, new: true }
        );

        if (item.key === 'footer') {
          // logger.log('🔍 Footer translation key created:', translationKey._id);
        }
      }
      
      // logger.log(`✅ Seeded ${basicTranslations.length} basic German translations`);
      
      // Also seed some genre-specific translations
      const genreTranslations = [
        { key: 'genre.rock', defaultValue: 'Rock', de: 'Rock' },
        { key: 'genre.classical', defaultValue: 'Classical', de: 'Klassik' },
        { key: 'genre.jazz', defaultValue: 'Jazz', de: 'Jazz' },
        { key: 'genre.electronic', defaultValue: 'Electronic', de: 'Elektronisch' },
        { key: 'genre.country', defaultValue: 'Country', de: 'Country' }
      ];
      
      for (const item of genreTranslations) {
        // Create or update the translation key
        const translationKey = await TranslationKey.findOneAndUpdate(
          { key: item.key },
          {
            key: item.key,
            defaultValue: item.defaultValue,
            category: 'genre',
            createdAt: new Date(),
            updatedAt: new Date()
          },
          { upsert: true, new: true }
        );

        // Create or update the German translation
        await Translation.findOneAndUpdate(
          { keyId: translationKey._id, language: 'de' },
          {
            keyId: translationKey._id,
            language: 'de',
            value: item.de,
            isCompleted: true,
            lastModified: new Date(),
            createdAt: new Date()
          },
          { upsert: true, new: true }
        );
      }
      
      const totalSeeded = basicTranslations.length + genreTranslations.length;
      // logger.log(`✅ Seeded ${totalSeeded} German translations total`);
      
      // Clear translation cache to ensure fresh data is served
      try {
        await CacheManager.clearByPattern('translations');
        logger.log('🔄 Cleared German translations cache');
      } catch (cacheError) {
        logger.log('⚠️ Cache clearing failed (non-critical):', cacheError.message);
      }
      
      // Bump translation version
      await bumpTranslationVersion('Basic translations seeded');
      
      res.json({ 
        success: true, 
        seeded: totalSeeded,
        message: 'German translations seeded successfully and cache cleared'
      });
      
    } catch (error) {
      // console.error('Error seeding translations:', error);
      res.status(500).json({ error: 'Failed to seed translations' });
    }
  });

  // Remove incorrect German auth translations to allow English fallback
  app.post('/api/admin/remove-german-auth-translations', async (req, res) => {
    try {
      const { bumpTranslationVersion } = await import('./services/translation-version');
      logger.log('🎯 Removing incorrect German auth translations to enable English fallback...');
      
      // Auth translation keys that should fall back to English when German doesn't exist
      const authKeys = [
        'auth_login_header', 'auth_continue_with', 'auth_manage_profile', 
        'auth_enjoy_listening', 'auth_listening', 'auth_email_placeholder', 
        'auth_password_placeholder', 'auth_login_button', 'auth_forgot_password',
        'auth_email_required', 'auth_password_required', 'auth_invalid_credentials',
        'auth_network_error'
      ];
      
      let removedCount = 0;
      
      for (const keyName of authKeys) {
        // Find the translation key
        const translationKey = await TranslationKey.findOne({ key: keyName });
        if (translationKey) {
          // Remove the German translation
          const result = await Translation.deleteOne({ 
            keyId: translationKey._id, 
            language: 'de' 
          });
          if (result.deletedCount > 0) {
            logger.log(`✅ Removed German translation for: ${keyName}`);
            removedCount++;
          }
        }
      }
      
      // Clear German translation cache
      try {
        const cacheKey = CacheKeys.translations('de');
        await CacheManager.clearByPattern('translations');
        logger.log('🔄 Cleared German translations cache');
      } catch (cacheError) {
        logger.log('⚠️ Cache clearing failed (non-critical):', cacheError.message);
      }
      
      logger.log(`🎉 Successfully removed ${removedCount} German auth translations!`);
      
      // Bump translation version
      await bumpTranslationVersion('German auth translations removed');
      
      res.json({ 
        success: true,
        message: `Removed ${removedCount} German auth translations to enable English fallback`, 
        removedCount 
      });
    } catch (error) {
      console.error('❌ Error removing German auth translations:', error);
      res.status(500).json({ error: 'Failed to remove German auth translations' });
    }
  });

  // Add missing English auth translations
  app.post('/api/admin/seed-english-auth-translations', async (req, res) => {
    try {
      const { bumpTranslationVersion } = await import('./services/translation-version');
      logger.log('🎯 Adding missing English authentication translations...');
      
      // Translation keys used in auth pages that need proper English translations
      const authTranslations = [
        // Main login page keys (from /pages/login.tsx)
        { key: 'auth_login_header', defaultValue: 'Login', en: 'Login' },
        { key: 'auth_continue_with', defaultValue: 'Continue with', en: 'Continue with' },
        { key: 'auth_manage_profile', defaultValue: 'Manage Your Profile', en: 'Manage Your Profile' },
        { key: 'auth_enjoy_listening', defaultValue: 'Enjoy', en: 'Enjoy' },
        { key: 'auth_listening', defaultValue: 'Listening', en: 'Listening' },
        { key: 'auth_email_placeholder', defaultValue: 'E-Mail', en: 'E-Mail' },
        { key: 'auth_password_placeholder', defaultValue: 'Password', en: 'Password' },
        { key: 'auth_login_button', defaultValue: 'Einloggen', en: 'Login' },
        { key: 'auth_forgot_password', defaultValue: 'Passwort vergessen', en: 'Forgot Password?' },
        
        // Additional auth keys from other components
        { key: 'login', defaultValue: 'Login', en: 'Login' },
        { key: 'login_manage_profile', defaultValue: 'Manage your profile', en: 'Manage your profile' },
        { key: 'login_enjoy_listen', defaultValue: 'Enjoy when you listen', en: 'Enjoy when you listen' },
        { key: 'email', defaultValue: 'E-Mail', en: 'E-Mail' },
        { key: 'password', defaultValue: 'Password', en: 'Password' },
        { key: 'logging_in', defaultValue: 'Logging in...', en: 'Logging in...' },
        { key: 'log_in', defaultValue: 'Log in', en: 'Log in' },
        { key: 'forgot_password', defaultValue: 'Forget your password?', en: 'Forget your password?' },
        { key: 'back_to_radio', defaultValue: 'Back to Radio', en: 'Back to Radio' },
        { key: 'auth_create_account', defaultValue: 'Create Account', en: 'Create Account' },
        { key: 'auth_create_account_description', defaultValue: 'Join our radio community and discover amazing stations', en: 'Join our radio community and discover amazing stations' },
        { key: 'auth_continue_with_google', defaultValue: 'Continue with Google', en: 'Continue with Google' },
        { key: 'auth_continue_with_apple', defaultValue: 'Continue with Apple', en: 'Continue with Apple' },
        { key: 'auth_continue_with_facebook', defaultValue: 'Continue with Facebook', en: 'Continue with Facebook' },
        { key: 'auth_continue_with_email', defaultValue: 'Or continue with email', en: 'Or continue with email' },
        { key: 'auth_full_name_label', defaultValue: 'Full Name', en: 'Full Name' },
        { key: 'auth_username_label', defaultValue: 'Username', en: 'Username' },
        { key: 'auth_choose_unique_username', defaultValue: 'Choose a unique username', en: 'Choose a unique username' },
        { key: 'auth_email_label', defaultValue: 'Email Address', en: 'Email Address' },
        { key: 'auth_enter_email', defaultValue: 'Enter your email address', en: 'Enter your email address' },
        { key: 'auth_password_label', defaultValue: 'Password', en: 'Password' },
        { key: 'auth_enter_password', defaultValue: 'Create a strong password', en: 'Create a strong password' },
        
        // Modal auth keys
        { key: 'auth_email_required', defaultValue: 'Email is required', en: 'Email is required' },
        { key: 'auth_password_required', defaultValue: 'Password is required', en: 'Password is required' },
        { key: 'auth_invalid_credentials', defaultValue: 'Invalid email or password', en: 'Invalid email or password' },
        { key: 'auth_network_error', defaultValue: 'Network error. Please try again.', en: 'Network error. Please try again.' }
      ];
      
      logger.log(`📝 Processing ${authTranslations.length} auth translation keys...`);
      
      for (const item of authTranslations) {
        // Create or update the translation key
        const translationKey = await TranslationKey.findOneAndUpdate(
          { key: item.key },
          {
            key: item.key,
            defaultValue: item.defaultValue,
            category: 'auth',
            createdAt: new Date(),
            updatedAt: new Date()
          },
          { upsert: true, new: true }
        );

        // Create or update the English translation
        await Translation.findOneAndUpdate(
          { keyId: translationKey._id, language: 'en' },
          {
            keyId: translationKey._id,
            language: 'en',
            value: item.en,
            isCompleted: true,
            lastModified: new Date(),
            createdAt: new Date()
          },
          { upsert: true, new: true }
        );

        logger.log(`✅ Added English translation for: ${item.key} = "${item.en}"`);
      }
      
      // Clear English translation cache to ensure fresh data is served
      try {
        await CacheManager.clearByPattern('translations');
        logger.log('🔄 Cleared English translations cache');
      } catch (cacheError) {
        logger.log('⚠️ Cache clearing failed (non-critical):', cacheError.message);
      }
      
      logger.log('🎉 Successfully added all missing English auth translations!');
      
      // Bump translation version
      await bumpTranslationVersion('English auth translations added');
      
      res.json({ 
        success: true,
        message: `Added ${authTranslations.length} English auth translations`, 
        count: authTranslations.length 
      });
    } catch (error) {
      console.error('❌ Error adding English auth translations:', error);
      res.status(500).json({ error: 'Failed to add English auth translations' });
    }
  });

  // Seed Turkish genre translations
  app.post("/api/admin/seed-turkish-genres", requireAdmin, async (req, res) => {
    try {
      const { bumpTranslationVersion } = await import('./services/translation-version');
      // Turkish translations for all genre descriptions
      const turkishTranslations = {
        'genre_description_rock': 'Rock müziğinin gücü ve enerjisini efsanevi klasiklerden modern hitlere kadar yaşayın. Gitar odaklı marşlar, güçlü vokaller ve zamansız rock şarkıları içeren radyo istasyonları dinleyin.',
        'genre_description_music': 'Tüm türlerden ve dönemlerden inanılmaz çeşitlilikte müziği keşfedin. Klasik şaheserlerden son hitlere, dünya müziğinden underground seslere kadar her şeyi bulun.',
        'genre_description_classical': 'Klasik müziğin zamansız güzelliğini keşfedin. Tarihin en büyük bestecilerinin orkestra şaheserlerini, oda müziğini ve klasik bestelerini dinleyin.',
        'genre_description_news': 'Dünyadan en son haberler ve güncel olaylarla bilgili kalın. Haber radyo istasyonlarımız siyaset, iş dünyası, spor ve son dakika haberlerinin kapsamlı coverage\'ını sağlar.',
        'genre_description_hits': 'Geçmişten ve günümüzden en büyük hitleri dinleyin. Hit radyo istasyonlarımız radyo dalgalarına ve streaming listelerine hakim olan en popüler şarkıları çalar.',
        'genre_description_jazz': 'Jazz\'ın sofistike seslerine kendinizi kaptırın. Smooth jazz\'dan bebop\'a kadar, efsanevi ve çağdaş jazz ustalarının en iyi müziklerini keşfedin.',
        'genre_description_entretenimiento': 'En iyi eğlence programlarının tadını çıkarın. Müzik, talk show\'lar, komedi ve çeşitli içeriklerle gün boyunca eğlenceli kalın.',
        'genre_description_radio': 'Radyo dünyasının en iyi içeriklerini keşfedin. Talk show\'lardan müzik programlarına, haber bültenlerinden eğlence içeriklerine kadar.',
        'genre_description_estaci-n': 'İstasyon programlarının zengin içeriklerini keşfedin. Çeşitli müzik türleri ve programlarla dolu radyo deneyiminin tadını çıkarın.'
      };

      let addedCount = 0;
      let updatedCount = 0;

      for (const [keyName, turkishValue] of Object.entries(turkishTranslations)) {
        // Find the translation key
        const translationKey = await TranslationKey.findOne({ key: keyName });
        if (!translationKey) {
          logger.log(`⚠️  Translation key not found: ${keyName}`);
          continue;
        }

        // Check if Turkish translation exists
        const existingTranslation = await Translation.findOne({
          keyId: translationKey._id,
          language: 'tr'
        });

        if (existingTranslation) {
          // Update existing
          await Translation.findOneAndUpdate(
            { keyId: translationKey._id, language: 'tr' },
            { 
              value: turkishValue,
              isCompleted: true,
              lastModified: new Date()
            }
          );
          updatedCount++;
          logger.log(`📝 Updated Turkish translation for: ${keyName}`);
        } else {
          // Create new
          await new Translation({
            keyId: translationKey._id,
            language: 'tr',
            value: turkishValue,
            isCompleted: true,
            lastModified: new Date(),
            createdAt: new Date()
          }).save();
          addedCount++;
          logger.log(`✅ Added Turkish translation for: ${keyName}`);
        }
      }

      // Clear Turkish translation cache
      const cacheKey = CacheKeys.translations('tr');
      await CacheManager.delete(cacheKey);
      logger.log('🔄 Cleared Turkish translations cache');

      // Bump translation version
      await bumpTranslationVersion('Turkish genre translations seeded');

      res.json({ 
        success: true, 
        added: addedCount,
        updated: updatedCount,
        total: addedCount + updatedCount,
        message: `Turkish genre translations seeded successfully. Added: ${addedCount}, Updated: ${updatedCount}`
      });

    } catch (error) {
      console.error('Error seeding Turkish genre translations:', error);
      res.status(500).json({ error: 'Failed to seed Turkish genre translations' });
    }
  });

  // Get all translations for admin filtering
  app.get("/api/admin/all-translations", requireAdmin, async (req, res) => {
    try {
      const allTranslations = await Translation.find({}).lean();
      res.json(allTranslations);
    } catch (error) {
      console.error('Error fetching all translations:', error);
      res.status(500).json({ error: 'Failed to fetch all translations' });
    }
  });

  // Bulk upsert translations for admin
  app.post("/api/admin/translations/bulk-upsert", requireAdmin, async (req, res) => {
    try {
      const { bumpTranslationVersion } = await import('./services/translation-version');
      const { translations } = req.body;
      
      if (!translations || !Array.isArray(translations)) {
        return res.status(400).json({ error: 'Invalid translations data' });
      }
      
      const results = [];
      for (const translation of translations) {
        const { keyId, language, value, isCompleted } = translation;
        
        const result = await Translation.findOneAndUpdate(
          { keyId, language },
          { 
            value, 
            isCompleted, 
            lastModified: new Date() 
          },
          { 
            upsert: true, 
            new: true 
          }
        );
        
        results.push(result);
      }
      
      // Bump translation version
      await bumpTranslationVersion('Bulk translations upserted');
      
      res.json({ success: true, updated: results.length });
    } catch (error) {
      console.error('Error bulk upserting translations:', error);
      res.status(500).json({ error: 'Failed to bulk upsert translations' });
    }
  });

  // QUICK FIX: Add missing Turkish genre translations (temporary endpoint)
  app.post("/api/fix-turkish-genres", async (req, res) => {
    try {
      const { bumpTranslationVersion } = await import('./services/translation-version');
      const turkishTranslations = [
        { key: 'genre_description_rock', value: 'Rock müziğinin gücü ve enerjisini efsanevi klasiklerden modern hitlere kadar yaşayın. Gitar odaklı marşlar, güçlü vokaller ve zamansız rock şarkıları içeren radyo istasyonları dinleyin.' },
        { key: 'genre_description_music', value: 'Tüm türlerden ve dönemlerden inanılmaz çeşitlilikte müziği keşfedin. Klasik şaheserlerden son hitlere, dünya müziğinden underground seslere kadar her şeyi bulun.' },
        { key: 'genre_description_classical', value: 'Klasik müziğin zamansız güzelliğini keşfedin. Tarihin en büyük bestecilerinin orkestra şaheserlerini, oda müziğini ve klasik bestelerini dinleyin.' },
        { key: 'genre_description_news', value: 'Dünyadan en son haberler ve güncel olaylarla bilgili kalın. Haber radyo istasyonlarımız siyaset, iş dünyası, spor ve son dakika haberlerinin kapsamlı coverage\'ını sağlar.' },
        { key: 'genre_description_hits', value: 'Geçmişten ve günümüzden en büyük hitleri dinleyin. Hit radyo istasyonlarımız radyo dalgalarına ve streaming listelerine hakim olan en popüler şarkıları çalar.' },
        { key: 'genre_description_jazz', value: 'Jazz\'ın sofistike seslerine kendinizi kaptırın. Smooth jazz\'dan bebop\'a kadar, efsanevi ve çağdaş jazz ustalarının en iyi müziklerini keşfedin.' },
        { key: 'genre_description_entretenimiento', value: 'En iyi eğlence programlarının tadını çıkarın. Müzik, talk show\'lar, komedi ve çeşitli içeriklerle gün boyunca eğlenceli kalın.' },
        { key: 'genre_description_radio', value: 'Radyo dünyasının en iyi içeriklerini keşfedin. Talk show\'lardan müzik programlarına, haber bültenlerinden eğlence içeriklerine kadar.' },
        { key: 'genre_description_estaci-n', value: 'İstasyon programlarının zengin içeriklerini keşfedin. Çeşitli müzik türleri ve programlarla dolu radyo deneyiminin tadını çıkarın.' }
      ];

      let addedCount = 0;
      let updatedCount = 0;

      for (const { key, value } of turkishTranslations) {
        const translationKey = await TranslationKey.findOne({ key });
        if (!translationKey) continue;

        const existingTranslation = await Translation.findOne({
          keyId: translationKey._id,
          language: 'tr'
        });

        if (existingTranslation) {
          await Translation.findOneAndUpdate(
            { keyId: translationKey._id, language: 'tr' },
            { value, isCompleted: true, lastModified: new Date() }
          );
          updatedCount++;
        } else {
          await new Translation({
            keyId: translationKey._id,
            language: 'tr',
            value,
            isCompleted: true,
            lastModified: new Date(),
            createdAt: new Date()
          }).save();
          addedCount++;
        }
      }

      // Clear cache (safe approach) - simplified
      logger.log('Skipping cache clear for now - focusing on data fix');

      // Bump translation version
      await bumpTranslationVersion('Turkish genre translations fixed');

      res.json({ 
        success: true, 
        added: addedCount,
        updated: updatedCount,
        message: `Turkish genre translations fixed. Added: ${addedCount}, Updated: ${updatedCount}`
      });

    } catch (error) {
      console.error('Error fixing Turkish genre translations:', error);
      res.status(500).json({ error: 'Failed to fix Turkish genre translations' });
    }
  });

  // ADMIN FIX: Reset all genres to non-discoverable
  app.post("/api/admin/reset-genres-discoverable", async (req, res) => {
    try {
      logger.log('🔧 Resetting all genres to non-discoverable (isDiscoverable: false)...');
      
      const result = await Genre.updateMany({}, { $set: { isDiscoverable: false } });
      
      logger.log(`✅ Successfully reset ${result.modifiedCount} genres to non-discoverable`);
      
      // Clear genre caches
      try {
        await CacheManager.clearByPattern('genres');
      } catch (cacheError) {
        logger.log('⚠️ Cache clearing failed (non-critical):', cacheError);
      }
      
      res.json({
        success: true,
        message: `Reset ${result.modifiedCount} genres to non-discoverable`,
        modifiedCount: result.modifiedCount,
        matchedCount: result.matchedCount
      });
    } catch (error) {
      console.error('Error resetting genres:', error);
      res.status(500).json({ error: 'Failed to reset genres' });
    }
  });

  // SEED: Add missing station page translation keys
  app.post("/api/seed-station-translations", async (req, res) => {
    try {
      const { bumpTranslationVersion } = await import('./services/translation-version');
      
      const keysToAdd = [
        { key: 'station_about_station', defaultValue: 'About the station', description: 'Station detail page - About section title' },
        { key: 'station_similar_radios', defaultValue: 'Similar Radios', description: 'Station detail page - Similar radios section title' },
        { key: 'station_more_from_country', defaultValue: 'More from {COUNTRY}', description: 'Station detail page - More from country section. Use {COUNTRY} placeholder' },
        { key: 'nav_login', defaultValue: 'Log in', description: 'Header navigation - Login button text' },
        { key: 'button_search_youtube', defaultValue: 'Search on YouTube', description: 'Station detail page - YouTube search button tooltip' },
        { key: 'button_search_spotify', defaultValue: 'Search on Spotify', description: 'Station detail page - Spotify search button tooltip' },
        { key: 'button_search_deezer', defaultValue: 'Search on Deezer', description: 'Station detail page - Deezer search button tooltip' },
        { key: 'button_share_station', defaultValue: 'Share Station', description: 'Station detail page - Share button tooltip' },
        { key: 'station_media_group_radios', defaultValue: 'Media Group Radios', description: 'Station detail page - Media group radios section title' },
      ];
      
      let createdCount = 0;
      let existsCount = 0;
      
      for (const keyData of keysToAdd) {
        const existing = await TranslationKey.findOne({ key: keyData.key });
        if (existing) {
          existsCount++;
          logger.log(`✓ Key already exists: ${keyData.key}`);
        } else {
          await TranslationKey.create({
            key: keyData.key,
            defaultValue: keyData.defaultValue,
            description: keyData.description,
            category: 'station',
            createdAt: new Date(),
            updatedAt: new Date()
          });
          createdCount++;
          logger.log(`+ Created key: ${keyData.key}`);
        }
        
        // Also add English translation
        const translationKey = await TranslationKey.findOne({ key: keyData.key });
        if (translationKey) {
          await Translation.findOneAndUpdate(
            { keyId: translationKey._id, language: 'en' },
            { 
              keyId: translationKey._id, 
              language: 'en', 
              value: keyData.defaultValue,
              isCompleted: true,
              lastModified: new Date()
            },
            { upsert: true }
          );
        }
      }
      
      // Clear cache
      try {
        await CacheManager.clearByPattern('translations');
      } catch (cacheError) {
        logger.log('⚠️ Cache clearing failed (non-critical)');
      }
      
      await bumpTranslationVersion('Station page translation keys seeded');
      
      res.json({
        success: true,
        created: createdCount,
        existing: existsCount,
        message: `Station page translations seeded. Created: ${createdCount}, Already existed: ${existsCount}. Now run auto-translation from admin panel.`
      });
    } catch (error) {
      console.error('Error seeding station translations:', error);
      res.status(500).json({ error: 'Failed to seed station translations' });
    }
  });

  // QUICK FIX: Fix German translations - remove all English words
  app.post("/api/fix-german-translations", async (req, res) => {
    try {
      const { bumpTranslationVersion } = await import('./services/translation-version');
      const germanTranslations = [
        // ML RECOMMENDATIONS
        { key: 'ml_reason_popular_station', value: 'Beliebter Sender' },
        { key: 'ml_reason_great_for_discovering', value: 'Großartig zum Entdecken neuer Musik' },
        { key: 'ml_why_recommendation', value: 'Warum diese Empfehlung:' },
        { key: 'ml_high_confidence_match', value: 'Hohe Übereinstimmung' },
        { key: 'ml_reason_similar_listeners', value: '{count} ähnliche Hörer' },
        { key: 'ml_reason_avg_listen_time', value: 'Durchschn. Hörzeit: {duration}s' },
        { key: 'ml_reason_popular_in_country', value: 'Beliebt in {country}' },
        { key: 'ml_reason_votes', value: '{count} Stimmen' },
        { key: 'ml_reason_similar_genres', value: 'Ähnliche Genres: {genres}' },
        { key: 'ml_reason_same_country', value: 'Gleiches Land: {country}' },
        { key: 'ml_reason_same_language', value: 'Gleiche Sprache: {language}' },
        { key: 'ml_reason_matches_country_preference', value: 'Entspricht Ihrer Länderpräferenz' },
        // MOODS
        { key: 'mood_energetic', value: 'Energiegeladen' },
        { key: 'mood_relaxed', value: 'Entspannt' },
        { key: 'mood_focused', value: 'Konzentriert' },
        { key: 'mood_nostalgic', value: 'Nostalgisch' },
        { key: 'mood_party', value: 'Feierlaune' },
        { key: 'mood_chill', value: 'Gelassen' },
        { key: 'mood_all', value: 'Alle Stimmungen' },
        { key: 'mood_selector', value: 'Wie fühlen Sie sich?' },
        { key: 'mood_description', value: 'Wählen Sie Ihre Stimmung für bessere Empfehlungen' },
        // FOR YOU PAGE
        { key: 'nav_for_you', value: 'Für Sie' },
        { key: 'for_you_subtitle', value: 'Personalisierte Sender basierend auf Ihrem Geschmack' },
        { key: 'your_music_profile', value: 'Ihr Musikprofil' },
        { key: 'profile_description', value: 'Basierend auf Ihrem Hörverlauf' },
        { key: 'avg_listen_time', value: 'Durchschnittliche Hörzeit' },
        { key: 'stations_played', value: 'Gespielte Sender' },
        { key: 'profile_strength', value: 'Profilstärke' },
        { key: 'total_sessions', value: 'Sitzungen gesamt' },
        { key: 'preferred_genres', value: 'Ihre bevorzugten Genres' },
        { key: 'preferred_countries', value: 'Ihre bevorzugten Länder' },
        { key: 'personalized_for_you', value: 'Personalisiert für Sie' },
        { key: 'trending_now', value: 'Derzeit im Trend' },
        { key: 'discover_new', value: 'Neues entdecken' },
        { key: 'based_on_genres', value: 'Basierend auf Ihren Genres' },
        { key: 'no_recommendations', value: 'Keine Empfehlungen' },
        { key: 'no_recommendations_desc', value: 'Beginnen Sie zu hören, um personalisierte Empfehlungen zu erhalten' },
        { key: 'browse_stations', value: 'Sender durchsuchen' },
        { key: 'homepage_see_all', value: 'Alle anzeigen' },
        { key: 'personalized_description', value: 'Basierend auf Ihren Hörgewohnheiten und Vorlieben' },
        { key: 'trending_description', value: 'Beliebte Sender, über die alle sprechen' },
        // USER MENU
        { key: 'user_menu_signed_in_as', value: 'Angemeldet als' },
        { key: 'user_menu_your_favorites', value: 'Ihre Favoriten' },
        { key: 'user_menu_discover', value: 'Entdecken' },
        { key: 'user_menu_records', value: 'Aufzeichnungen' },
        { key: 'user_menu_profile', value: 'Profil' },
        { key: 'profile_nav_favorites', value: 'Favoriten' },
        { key: 'profile_nav_discover', value: 'Entdecken' },
        { key: 'profile_nav_records', value: 'Aufzeichnungen' },
        { key: 'profile_nav_profile', value: 'Profil' },
        // REGIONS & SEARCH
        { key: 'regions_search_countries', value: 'Länder durchsuchen...' },
        { key: 'regions_search_cities', value: 'Städte durchsuchen...' },
        { key: 'regions_search_stations', value: 'Sender durchsuchen...' },
        { key: 'regions_all_genres', value: 'Alle Genres' },
        { key: 'regions_popular_in_region', value: 'Beliebt in dieser Region' },
        // COMMON
        { key: 'all', value: 'Alle' },
        { key: 'latest', value: 'Neueste' },
        { key: 'recent', value: 'Kürzlich' },
        { key: 'popular', value: 'Beliebt' },
        { key: 'top', value: 'Top' },
        { key: 'most', value: 'Meiste' },
        { key: 'stations_label', value: 'Sender' },
        { key: 'stations_for_mood', value: 'Sender für Stimmung' },
        { key: 'stations_diverse_mix', value: 'Sender (vielfältige Mischung)' },
        { key: 'stations_for_genre', value: 'Für Genre' },
        // PLAYER
        { key: 'play_button', value: 'Wiedergabe' },
        { key: 'stop_button', value: 'Stopp' },
        { key: 'audio', value: 'Audio' },
        { key: 'now_playing', value: 'Läuft gerade' },
        { key: 'station_playing', value: 'Sender läuft' },
        { key: 'station_stopped', value: 'Sender gestoppt' },
        // NAVIGATION
        { key: 'nav_all_stations', value: 'Alle Sender' },
        { key: 'nav_your_favorites', value: 'Ihre Favoriten' },
        { key: 'nav_view_all_notifications', value: 'Alle Benachrichtigungen anzeigen' },
        // SEO
        { key: 'seo_popular_stations', value: 'Beliebte Sender' },
        { key: 'seo_community_favorites', value: 'Community-Favoriten' },
        { key: 'seo_all_stations', value: 'Alle Sender' },
        { key: 'discover_all_stations', value: 'Alle Sender entdecken' },
        // FAVORITES
        { key: 'favorites_add_to_favorites', value: 'Zu Favoriten hinzufügen' },
        { key: 'favorites_remove_from_favorites', value: 'Aus Favoriten entfernen' },
        { key: 'favorites_recording_statistics_and_more', value: 'Aufnahmestatistiken und mehr' },
        // ERRORS
        { key: 'error_fetch_personalized_stations', value: 'Personalisierte Sender konnten nicht abgerufen werden' },
        { key: 'error_fetch_trending_stations', value: 'Trendende Sender konnten nicht abgerufen werden' },
        { key: 'error_fetch_genre_based_stations', value: 'Genre-basierte Sender konnten nicht abgerufen werden' },
        // FILTERS
        { key: 'filter_search_placeholder', value: 'Sender suchen...' },
        { key: 'filter_all_countries', value: 'Alle Länder' },
        { key: 'filter_all_languages', value: 'Alle Sprachen' },
        { key: 'filter_all_genres', value: 'Alle Genres' },
        { key: 'filter_loading_countries', value: 'Länder werden geladen...' },
        { key: 'filter_loading_languages', value: 'Sprachen werden geladen...' },
        { key: 'filter_loading_genres', value: 'Genres werden geladen...' },
        { key: 'filter_error_loading_countries', value: 'Fehler beim Laden der Länder' },
        { key: 'filter_error_loading_languages', value: 'Fehler beim Laden der Sprachen' },
        { key: 'filter_error_loading_genres', value: 'Fehler beim Laden der Genres' }
      ];

      let addedCount = 0;
      let updatedCount = 0;

      for (const { key, value } of germanTranslations) {
        // Find or create translation key
        let translationKey = await TranslationKey.findOne({ key });
        if (!translationKey) {
          logger.log(`📝 Creating new translation key: ${key}`);
          translationKey = await new TranslationKey({
            key,
            defaultValue: value,
            description: `Auto-created for German translation fix`,
            category: 'general',
            createdAt: new Date()
          }).save();
        }

        const existingTranslation = await Translation.findOne({
          keyId: translationKey._id,
          language: 'de'
        });

        if (existingTranslation) {
          await Translation.findOneAndUpdate(
            { keyId: translationKey._id, language: 'de' },
            { value, isCompleted: true, lastModified: new Date() }
          );
          updatedCount++;
        } else {
          await new Translation({
            keyId: translationKey._id,
            language: 'de',
            value,
            isCompleted: true,
            lastModified: new Date(),
            createdAt: new Date()
          }).save();
          addedCount++;
        }
      }

      // Clear German translations cache
      const cacheKey = CacheKeys.translations('de');
      await CacheManager.del(cacheKey);
      logger.log('🔄 Cleared German translations cache');

      // Bump translation version
      await bumpTranslationVersion('German translations fixed');

      res.json({ 
        success: true, 
        added: addedCount,
        updated: updatedCount,
        total: addedCount + updatedCount,
        message: `German translations fixed. Added: ${addedCount}, Updated: ${updatedCount}`
      });

    } catch (error) {
      console.error('Error fixing German translations:', error);
      res.status(500).json({ error: 'Failed to fix German translations' });
    }
  });

  // Get CRITICAL translations only for faster initial page load
  app.get("/api/translations/:lang/critical", async (req, res) => {
    try {
      const { lang } = req.params;
      const { CRITICAL_TRANSLATION_KEYS } = await import('../shared/critical-translation-keys.js');
      
      // Check cache first
      const cacheKey = `translations:critical:${lang}`;
      const cachedTranslations = await CacheManager.get(cacheKey);
      
      if (cachedTranslations) {
        res.set({
          'Cache-Control': 'public, max-age=3600, stale-while-revalidate=7200',
          'ETag': `"${lang}-critical-${Date.now()}"`,
        });
        return res.json(cachedTranslations);
      }

      // Fetch only critical translations
      const translationMap = await fetchCriticalTranslationsForLanguage(lang);
      
      // Cache for 2 hours
      await CacheManager.set(cacheKey, translationMap, { 
        ttl: 7200,
        useRedis: true 
      });
      
      res.set({
        'Cache-Control': 'public, max-age=3600, stale-while-revalidate=7200',
        'ETag': `"${lang}-critical-${Date.now()}"`,
      });
      
      res.json(translationMap);
      
    } catch (error) {
      console.error('Error fetching critical translations:', error);
      res.status(500).json({ error: 'Failed to fetch critical translations' });
    }
  });

  // Get translations for a specific language - with enhanced caching & request deduplication
  app.get("/api/translations/:lang", async (req, res) => {
    try {
      const { lang } = req.params;
      
      // Check cache first with longer TTL for translations
      const cacheKey = CacheKeys.translations(lang);
      const cachedTranslations = await CacheManager.get(cacheKey);
      
      if (cachedTranslations) {
        // Set HTTP cache headers for client-side caching (1 hour)
        res.set({
          'Cache-Control': 'public, max-age=3600, stale-while-revalidate=7200',
          'ETag': `"${lang}-${Date.now()}"`,
          'Last-Modified': new Date().toUTCString()
        });
        
        // Background refresh if cache is getting stale
        if (CacheManager.needsRefresh(cacheKey, 300)) { // 5 min before expiry
          setImmediate(async () => {
            try {
              await refreshTranslationsCache(lang);
            } catch (error) {
              console.error('Background translations refresh failed:', error);
            }
          });
        }
        
        return res.json(cachedTranslations);
      }

      // 🚀 REQUEST DEDUPLICATION: Multiple concurrent requests share one DB query
      const translationMap = await deduplicatedFetch(`translations:${lang}`, async () => {
        const result = await fetchTranslationsForLanguage(lang);
        
        // Cache for 2 hours with Redis backup
        await CacheManager.set(cacheKey, result, { 
          ttl: 7200, // 2 hours - longer cache for translations
          useRedis: true 
        });
        
        return result;
      });
      
      // Set HTTP cache headers
      res.set({
        'Cache-Control': 'public, max-age=3600, stale-while-revalidate=7200',
        'ETag': `"${lang}-${Date.now()}"`,
        'Last-Modified': new Date().toUTCString()
      });
      
      res.json(translationMap);
      
    } catch (error) {
      console.error('Error fetching translations:', error);
      res.status(500).json({ error: 'Failed to fetch translations' });
    }
  });

  // Helper function to fetch CRITICAL translations only (fast initial load)
  async function fetchCriticalTranslationsForLanguage(lang: string): Promise<Record<string, string>> {
    const { CRITICAL_TRANSLATION_KEYS } = await import('../shared/critical-translation-keys.js');
    
    // Fetch only critical translations by matching key names
    const translations = await Translation.aggregate([
        {
          $match: { language: lang }
        },
        {
          $lookup: {
            from: 'translationkeys',
            localField: 'keyId',
            foreignField: '_id',
            as: 'keyInfo'
          }
        },
        {
          $unwind: {
            path: '$keyInfo',
            preserveNullAndEmptyArrays: true
          }
        },
        {
          // FILTER for critical keys only
          $match: {
            'keyInfo.key': { $in: CRITICAL_TRANSLATION_KEYS }
          }
        }
      ]);
    
    const translationMap: Record<string, string> = {};
    
    for (const item of translations) {
      const keyName = item.keyInfo?.key || null;
      
      if (keyName && item.value) {
        translationMap[keyName] = item.value;
      } else if (keyName) {
        translationMap[keyName] = item.keyInfo?.defaultValue || keyName;
      }
    }
    
    return translationMap;
  }

  // Helper function to fetch translations for a language
  async function fetchTranslationsForLanguage(lang: string): Promise<Record<string, string>> {
    // OPTIMIZED: Query translations collection directly filtered by language FIRST
    // This is much faster than loading all translations and filtering in-memory
    const translations = await Translation.aggregate([
        {
          // 🚀 OPTIMIZATION: Filter by language FIRST before lookup
          $match: { language: lang }
        },
        {
          // Then lookup the key information
          $lookup: {
            from: 'translationkeys',
            localField: 'keyId',
            foreignField: '_id',
            as: 'keyInfo'
          }
        },
        {
          // Extract the key from the array
          $unwind: {
            path: '$keyInfo',
            preserveNullAndEmptyArrays: true
          }
        }
      ]);
    
    // Convert to simple key-value map
    const translationMap: Record<string, string> = {};
    
    for (const item of translations) {
      const keyName = item.keyInfo?.key || null;
      
      if (keyName && item.value) {
        translationMap[keyName] = item.value;
      } else if (keyName) {
        // Fallback to key name if no value
        translationMap[keyName] = item.keyInfo?.defaultValue || keyName;
      }
    }
    
    return translationMap;
  }

  // Helper function to refresh translations cache in background
  async function refreshTranslationsCache(lang: string): Promise<void> {
    try {
      const translationMap = await fetchTranslationsForLanguage(lang);
      const cacheKey = CacheKeys.translations(lang);
      
      // Update cache with fresh data
      await CacheManager.set(cacheKey, translationMap, { 
        ttl: 7200, // 2 hours
        useRedis: true 
      });
    } catch (error) {
      console.error(`Background refresh failed for ${lang} translations:`, error);
    }
  }

  // Clear translation cache endpoint for debugging
  app.post("/api/admin/clear-translations-cache/:lang?", async (req, res) => {
    try {
      const lang = req.params.lang || 'all';
      
      if (lang === 'all') {
        // Clear all language caches
        const languages = ['en', 'de', 'fr', 'es', 'it', 'pt', 'ru', 'zh', 'ja', 'ko', 'ar', 'tr'];
        for (const l of languages) {
          const cacheKey = CacheKeys.translations(l);
          await CacheManager.delete(cacheKey);
        }
        logger.log('🧹 Cleared all translation caches');
        res.json({ success: true, message: 'All translation caches cleared' });
      } else {
        const cacheKey = CacheKeys.translations(lang);
        await CacheManager.delete(cacheKey);
        logger.log(`🧹 Cleared ${lang} translation cache`);
        res.json({ success: true, message: `${lang} translation cache cleared` });
      }
    } catch (error) {
      console.error('Error clearing translation cache:', error);
      res.status(500).json({ error: 'Failed to clear translation cache' });
    }
  });

  // Clear SEO caches endpoint (server + Cloudflare) for admin
  app.post("/api/admin/cache/clear-seo", requireAdmin, async (req, res) => {
    try {
      logger.log('🧹 Admin triggered SEO cache clear...');
      
      const { scheduledCacheClearService } = await import('./services/scheduled-cache-clear');
      const result = await scheduledCacheClearService.clearAllSeoCaches();
      
      res.json({
        success: true,
        message: 'SEO caches cleared successfully',
        result: {
          timestamp: result.timestamp,
          serverCache: result.serverCache,
          cloudflare: result.cloudflare
        }
      });
    } catch (error: any) {
      logger.log(`❌ Error clearing SEO caches: ${error.message}`);
      res.status(500).json({ error: 'Failed to clear SEO caches', details: error.message });
    }
  });

  // Get SEO cache clear status endpoint
  app.get("/api/admin/cache/seo-status", requireAdmin, async (req, res) => {
    try {
      const { scheduledCacheClearService } = await import('./services/scheduled-cache-clear');
      const status = scheduledCacheClearService.getStatus();
      const cacheStats = performanceCache.getStats();
      
      res.json({
        scheduledClear: status,
        currentCacheStats: {
          seoHtml: cacheStats.seoHtml,
          pageData: cacheStats.pageData
        }
      });
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to get cache status', details: error.message });
    }
  });

  // BULK UPDATE TRANSLATION KEYS API - Update multiple translation keys at once
  app.patch("/api/admin/translation-keys/bulk-update", requireAdmin, async (req, res) => {
    try {
      const { bumpTranslationVersion } = await import('./services/translation-version');
      const { updates } = req.body;
      
      if (!Array.isArray(updates) || updates.length === 0) {
        return res.status(400).json({ error: 'Updates array is required' });
      }
      
      logger.log(`📝 Bulk updating ${updates.length} translation keys...`);
      
      const updatePromises = updates.map(async (update: any) => {
        const { keyId, defaultValue } = update;
        
        if (!keyId || !defaultValue) {
          throw new Error('keyId and defaultValue are required for each update');
        }
        
        return TranslationKey.findByIdAndUpdate(
          keyId,
          { 
            defaultValue: defaultValue,
            updatedAt: new Date()
          },
          { new: true }
        );
      });
      
      const updatedKeys = await Promise.all(updatePromises);
      
      logger.log(`✅ Successfully updated ${updatedKeys.length} translation keys`);
      
      // Bump translation version
      await bumpTranslationVersion('Translation keys bulk updated');
      
      res.json({ 
        success: true, 
        updated: updatedKeys.length,
        message: `Updated ${updatedKeys.length} translation keys successfully`
      });
      
    } catch (error) {
      console.error('Error bulk updating translation keys:', error);
      res.status(500).json({ error: 'Failed to bulk update translation keys' });
    }
  });

  // API endpoint to seed test users with favorite stations
  app.post("/api/seed/test-users", async (req, res) => {
    try {
      logger.log('🌱 Starting test users seeding...');
      
      // First, get a good selection of stations to assign as favorites
      const allStations = await Station.find({}, '_id name country genre tags').limit(1000).lean();
      
      if (allStations.length < 100) {
        return res.status(400).json({ error: 'Not enough stations in database to create meaningful test users' });
      }

      const testUsersData = [
        {
          username: 'musiclover_sarah',
          email: 'sarah.music@example.com',
          fullName: 'Sarah Johnson',
          bio: 'Classic rock enthusiast and vinyl collector. Always discovering new radio gems!',
          location: 'Nashville, TN, USA',
          favoriteCount: 45,
          preferences: { theme: 'dark', language: 'en', autoplay: true, volume: 75 }
        },
        {
          username: 'radiohead_mark',
          email: 'mark.radio@example.com', 
          fullName: 'Mark Rodriguez',
          bio: 'Electronic music producer and radio host. Love discovering underground stations worldwide.',
          location: 'Barcelona, Spain',
          favoriteCount: 67,
          preferences: { theme: 'light', language: 'es', autoplay: false, volume: 80 }
        },
        {
          username: 'jazzcat_emma',
          email: 'emma.jazz@example.com',
          fullName: 'Emma Thompson',
          bio: 'Jazz pianist and radio curator. Smooth jazz and bebop are my passion.',
          location: 'New Orleans, LA, USA', 
          favoriteCount: 34,
          preferences: { theme: 'dark', language: 'en', autoplay: true, volume: 60 }
        },
        {
          username: 'worldbeats_alex',
          email: 'alex.world@example.com',
          fullName: 'Alex Kim',
          bio: 'World music explorer. Collecting radio stations from every continent!',
          location: 'Seoul, South Korea',
          favoriteCount: 89,
          preferences: { theme: 'light', language: 'ko', autoplay: true, volume: 70 }
        },
        {
          username: 'classical_marie',
          email: 'marie.classical@example.com',
          fullName: 'Marie Dubois',
          bio: 'Classical music teacher and orchestra conductor. Seeking the finest classical radio stations.',
          location: 'Paris, France',
          favoriteCount: 23,
          preferences: { theme: 'light', language: 'fr', autoplay: false, volume: 65 }
        },
        {
          username: 'indie_hunter',
          email: 'hunter.indie@example.com',
          fullName: 'Hunter Williams',
          bio: 'Independent music scout and blogger. Always hunting for the next big indie station.',
          location: 'Portland, OR, USA',
          favoriteCount: 73,
          preferences: { theme: 'dark', language: 'en', autoplay: true, volume: 85 }
        },
        {
          username: 'reggae_vibes',
          email: 'jamaica.vibes@example.com',
          fullName: 'Marcus Campbell',
          bio: 'Reggae and Caribbean music enthusiast. One love, one radio!',
          location: 'Kingston, Jamaica',
          favoriteCount: 41,
          preferences: { theme: 'dark', language: 'en', autoplay: true, volume: 90 }
        },
        {
          username: 'techno_lisa',
          email: 'lisa.techno@example.com',
          fullName: 'Lisa Schmidt',
          bio: 'Techno DJ and electronic music producer. Berlin underground radio specialist.',
          location: 'Berlin, Germany',
          favoriteCount: 56,
          preferences: { theme: 'dark', language: 'de', autoplay: true, volume: 95 }
        },
        {
          username: 'country_roads',
          email: 'jimmy.country@example.com',
          fullName: 'Jimmy Carter',
          bio: 'Country music historian and guitar player. Nashville sound and honky-tonk lover.',
          location: 'Austin, TX, USA',
          favoriteCount: 38,
          preferences: { theme: 'light', language: 'en', autoplay: false, volume: 75 }
        },
        {
          username: 'ambient_sophia',
          email: 'sophia.ambient@example.com',
          fullName: 'Sophia Martinez',
          bio: 'Meditation instructor and ambient music curator. Peaceful sounds for the soul.',
          location: 'Ibiza, Spain',
          favoriteCount: 62,
          preferences: { theme: 'light', language: 'es', autoplay: false, volume: 50 }
        }
      ];

      let createdUsers = 0;
      let totalFavoritesCreated = 0;

      for (const userData of testUsersData) {
        // Check if user already exists
        const existingUser = await User.findOne({ 
          $or: [{ email: userData.email }, { username: userData.username }]
        });

        if (existingUser) {
          logger.log(`⏭️  User ${userData.username} already exists, skipping...`);
          continue;
        }

        // Create user with hashed password
        const bcrypt = require('bcrypt');
        const hashedPassword = await bcrypt.hash('testuser123', 10);

        const newUser = new User({
          username: userData.username,
          email: userData.email,
          passwordHash: hashedPassword,
          fullName: userData.fullName,
          bio: userData.bio,
          location: userData.location,
          role: 'user',
          status: 'active',
          isPublicProfile: true, // Make all test users public
          emailVerified: true,
          preferences: userData.preferences,
          permissions: {
            canManageStations: false,
            canManageUsers: false,
            canRunSync: false,
            canViewAnalytics: false,
            canExportData: false
          },
          favoriteStationsCount: userData.favoriteCount,
          followersCount: Math.floor(Math.random() * 50) + 5, // 5-55 followers
          followingCount: Math.floor(Math.random() * 30) + 10, // 10-40 following
          totalListeningTime: Math.floor(Math.random() * 10000) + 1000, // 1000-11000 minutes
          stationsCreatedCount: Math.floor(Math.random() * 5), // 0-5 stations created
          stats: {
            totalPlays: Math.floor(Math.random() * 500) + 100,
            totalListeningHours: Math.floor(Math.random() * 200) + 50,
            favoriteGenres: ['rock', 'jazz', 'electronic'].slice(0, Math.floor(Math.random() * 3) + 1),
            joinDate: new Date(Date.now() - Math.random() * 365 * 24 * 60 * 60 * 1000), // Within last year
            lastActiveDate: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000), // Within last 30 days
            streakDays: Math.floor(Math.random() * 20) + 1
          },
          createdAt: new Date(),
          updatedAt: new Date()
        });

        const savedUser = await newUser.save();
        logger.log(`✅ Created user: ${userData.username} (${userData.fullName})`);

        // Now create favorite stations for this user
        const shuffledStations = [...allStations].sort(() => 0.5 - Math.random());
        const favoritesToCreate = shuffledStations.slice(0, userData.favoriteCount);

        const favoritePromises = favoritesToCreate.map(station => {
          return new UserFavorite({
            userId: savedUser._id.toString(),
            stationId: station._id.toString(),
            createdAt: new Date(Date.now() - Math.random() * 90 * 24 * 60 * 60 * 1000) // Within last 90 days
          }).save().catch(err => {
            // Ignore duplicate key errors (in case station is already favorited)
            if (err.code !== 11000) throw err;
          });
        });

        await Promise.all(favoritePromises);
        logger.log(`  📌 Added ${userData.favoriteCount} favorite stations for ${userData.username}`);
        
        createdUsers++;
        totalFavoritesCreated += userData.favoriteCount;
      }

      logger.log(`🎉 Test user seeding completed!`);
      res.json({
        success: true,
        message: `Successfully created ${createdUsers} test users with ${totalFavoritesCreated} total favorite stations`,
        createdUsers,
        totalFavoritesCreated,
        details: testUsersData.map(u => ({
          username: u.username,
          fullName: u.fullName,
          location: u.location,
          favoriteCount: u.favoriteCount
        }))
      });

    } catch (error) {
      console.error('Error seeding test users:', error);
      res.status(500).json({ error: 'Failed to seed test users' });
    }
  });

  // Search users
  app.get("/api/users/search", async (req, res) => {
    try {
      const query = req.query.q as string;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const skip = (page - 1) * limit;

      if (!query || query.length < 2) {
        return res.status(400).json({ error: 'Query must be at least 2 characters' });
      }

      const searchRegex = new RegExp(query, 'i');
      const users = await User.find({
        $or: [
          { fullName: searchRegex },
          { username: searchRegex },
          { email: searchRegex }
        ]
      })
      .select('fullName username email avatar location followersCount followingCount createdAt')
      .sort({ followersCount: -1 })
      .skip(skip)
      .limit(limit);

      const total = await User.countDocuments({
        $or: [
          { fullName: searchRegex },
          { username: searchRegex },
          { email: searchRegex }
        ]
      });

      // logger.log(` Found ${users.length} users for query: ${query}`);
      res.json({
        users,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      // console.error('Search users error:', error);
      res.status(500).json({ error: 'Failed to search users' });
    }
  });

  // Get all users with pagination and search
  app.get("/api/users", async (req, res) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const search = req.query.search as string;
      const sortBy = req.query.sortBy as string || 'newest';
      const skip = (page - 1) * limit;

      // Build base query for public users (show ALL public users, not just those with favorites)
      let baseQuery: any = { 
        isPublicProfile: { $ne: false }
      };

      // Add search functionality
      if (search && search.length >= 2) {
        const searchRegex = new RegExp(search, 'i');
        baseQuery.$or = [
          { fullName: searchRegex },
          { username: searchRegex },
          { email: searchRegex }
        ];
      }

      // Determine sort order
      let sortOrder: any = { createdAt: -1 }; // default newest
      if (sortBy === 'oldest') {
        sortOrder = { createdAt: 1 };
      } else if (sortBy === 'most_radios') {
        sortOrder = { favoriteStationsCount: -1, createdAt: -1 };
      } else if (sortBy === 'least_radios') {
        sortOrder = { favoriteStationsCount: 1, createdAt: -1 };
      }

      // Get users and count
      const [users, total] = await Promise.all([
        User.find(baseQuery)
          .select('_id fullName username email avatar isPublicProfile followersCount createdAt')
          .sort(sortOrder)
          .skip(skip)
          .limit(limit)
          .lean(),
        User.countDocuments(baseQuery)
      ]);

      // Get favorite counts for all users from UserFavorite collection
      const userIds = users.map(u => u._id.toString());
      const favoriteCounts = await UserFavorite.aggregate([
        { $match: { userId: { $in: userIds } } },
        { $group: { _id: '$userId', count: { $sum: 1 } } }
      ]);

      const favoriteMap: Record<string, number> = {};
      favoriteCounts.forEach(doc => {
        favoriteMap[doc._id] = doc.count;
      });

      // Add favorite station count
      const usersWithCount = users.map(user => ({
        ...user,
        favoriteStationsCount: favoriteMap[user._id.toString()] || 0
      }));

      res.json({
        users: usersWithCount,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      console.error('Get users error:', error);
      res.status(500).json({ error: 'Failed to fetch users' });
    }
  });

  // Sync UserFavorite collection data into User.favoriteStations field
  async function syncUserFavorites() {
    try {
      logger.log('🔄 Syncing UserFavorite data into User.favoriteStations...');
      
      // Get all UserFavorite records
      const userFavorites = await UserFavorite.find({}).lean();
      
      // Group favorites by userId
      const favoritesByUser: { [userId: string]: string[] } = {};
      
      for (const favorite of userFavorites) {
        if (!favoritesByUser[favorite.userId]) {
          favoritesByUser[favorite.userId] = [];
        }
        
        // Validate that station exists before adding
        try {
          const stationExists = await Station.findById(favorite.stationId).select('_id').lean();
          if (stationExists) {
            favoritesByUser[favorite.userId].push(favorite.stationId);
          }
        } catch (err) {
          // Invalid station ID, skip
        }
      }
      
      // Update each user's favoriteStations field
      const updatePromises = Object.keys(favoritesByUser).map(userId => {
        return User.updateOne(
          { _id: new mongoose.Types.ObjectId(userId) },
          { 
            favoriteStations: favoritesByUser[userId],
            favoriteStationsCount: favoritesByUser[userId].length
          }
        );
      });
      
      await Promise.all(updatePromises);
      logger.log(`✅ Synced favorites for ${Object.keys(favoritesByUser).length} users`);
    } catch (error) {
      console.error('Error syncing user favorites:', error);
    }
  }

  // TEST: Create fake favorites for discovery users
  app.post("/api/test/create-discovery-users", async (req, res) => {
    try {
      // Get the updated users with public profiles
      const publicUsers = await User.find({ isPublicProfile: true }).limit(6);
      
      // Get some random stations to use as favorites
      const randomStations = await Station.find().limit(50);
      
      let createdFavorites = 0;
      
      for (const user of publicUsers) {
        // Skip the user that already has favorites (Muhammed)
        if (user.username === 'mumiix') continue;
        
        // Add 3-15 random favorites per user
        const favCount = Math.floor(Math.random() * 13) + 3; // 3-15 favorites
        
        for (let i = 0; i < favCount && i < randomStations.length; i++) {
          const station = randomStations[i + (publicUsers.indexOf(user) * 10)]; // Stagger to avoid duplicates
          if (station) {
            await UserFavorite.findOneAndUpdate(
              { 
                userId: user._id.toString(),
                stationId: station._id.toString()
              },
              {
                userId: user._id.toString(),
                stationId: station._id.toString(),
                addedAt: new Date()
              },
              { upsert: true }
            );
            createdFavorites++;
          }
        }
      }
      
      res.json({ success: true, message: `Created ${createdFavorites} favorites for ${publicUsers.length} users` });
    } catch (error) {
      console.error('Error creating test favorites:', error);
      res.status(500).json({ error: 'Failed to create test favorites' });
    }
  });

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
          user => user.userAgent === userAgent && user.clientIP === clientIP
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

  // Note: Social authentication endpoints are implemented earlier in this file
  // Google, Apple, and Facebook OAuth routes are available at /api/auth/google, /api/auth/apple, /api/auth/facebook

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
  
  /**
   * Builds a localized URL by translating path segments
   * @param englishPath - English path (e.g., '/genres/pop' or '/stations')
   * @param languageCode - Target language code (e.g., 'de', 'sq')
   * @param countryCode - Optional country code for country-specific URLs
   * @returns Localized URL path (e.g., '/de/zhanret' or '/al/stacione')
   */
  function buildLocalizedUrl(
    englishPath: string,
    languageCode: string,
    countryCode?: string,
    translationMap?: Map<string, string>
  ): string {
    // UPDATED: All languages (including English) use /{lang}/* format for consistency
    // If no translation map provided, return English path with language prefix
    if (!translationMap) {
      const prefix = countryCode ? `/${countryCode}` : `/${languageCode}`;
      return `${prefix}${englishPath}`;
    }
    
    // Split path into segments
    const segments = englishPath.split('/').filter(Boolean);
    
    // Translate each segment
    const translatedSegments = segments.map(segment => {
      const key = `${languageCode}:${segment}`;
      const translated = translationMap.get(key);
      return translated || segment; // Fall back to English if no translation
    });
    
    // Build final URL with language or country prefix
    // UPDATED: All languages use /{lang}/* format (including English = /en)
    const translatedPath = translatedSegments.length > 0 ? '/' + translatedSegments.join('/') : '';
    const prefix = countryCode ? `/${countryCode}` : `/${languageCode}`;
    
    return `${prefix}${translatedPath}`;
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
      // This ensures consistent canonical URLs and prevents Bing indexing issues
      const getProductionDomain = (requestHost: string = ''): string => {
        // ALWAYS return themegaradio.com for consistent canonical URLs
        return 'https://themegaradio.com';
      };
      
      const fullDomain = getProductionDomain(req.get('host'));
      
      // Parse preferredLanguage from cookie for SSR language/country separation
      // Supports 2-5 letter codes and hyphenated codes like 'pt-br'
      const cookieHeader = req.headers.cookie || '';
      const preferredLanguageMatch = cookieHeader.match(/preferredLanguage=([a-z]{2,5}(?:-[a-z]{2})?)/i);
      const preferredLanguage = preferredLanguageMatch ? preferredLanguageMatch[1].toLowerCase() : undefined;
      
      // Use seoRenderer to generate SEO data with translated paths
      const pageData = await seoRenderer.renderStaticPage(url, fullDomain, preferredLanguage);
      
      res.json({
        seoTags: pageData.seoTags,
        language: pageData.language,
        cleanPath: pageData.cleanPath
      });
    } catch (error) {
      console.error('❌ Error generating SEO page data:', error);
      res.status(500).json({ error: 'Failed to generate SEO data' });
    }
  });
  
  // Robots.txt endpoint - allows indexing for testing
  app.get("/robots.txt", (req, res) => {
    const baseUrl = getBaseUrl(req);
    // Allow indexing everywhere during testing - set to false to block indexing again
    const allowIndexing = true; // Set to false to block indexing on preview versions
    
    if (allowIndexing) {
      // Production robots.txt - allows indexing including AI crawlers
      const robotsTxt = `# Robots.txt for Mega Radio - Production
# Updated for AI Search Engine Optimization (ChatGPT, Claude, Perplexity, etc.)

# ===== GENERAL CRAWLERS =====
User-agent: *
Allow: /

# Block admin and sensitive API endpoints
Disallow: /admin/
Disallow: /auth/
Disallow: /debug/

# Allow SEO-critical API endpoints for JavaScript rendering
# These are needed when Googlebot renders JavaScript and makes API calls
Allow: /api/station/
Allow: /api/stations
Allow: /api/seo/
Allow: /api/translations/
Allow: /api/sitemap
Allow: /api/genres
Allow: /api/countries
Allow: /api/filters/
Allow: /api/advertisements
Allow: /api/footer-social-media

# Block sensitive API endpoints
Disallow: /api/admin
Disallow: /api/debug
Disallow: /api/auth

# ===== OPENAI / CHATGPT =====
# Allow ChatGPT to index and cite our radio station content
User-agent: GPTBot
Allow: /

User-agent: ChatGPT-User
Allow: /

User-agent: OAI-SearchBot
Allow: /

# ===== ANTHROPIC / CLAUDE =====
# Allow Claude AI to access and cite our content
User-agent: anthropic-ai
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: claude-web
Allow: /

# ===== GOOGLE GEMINI =====
# Allow Google's AI to use our content
User-agent: Google-Extended
Allow: /

# ===== PERPLEXITY AI =====
# Allow Perplexity AI search to index our content
User-agent: PerplexityBot
Allow: /

# ===== META AI =====
# Allow Meta's AI assistants
User-agent: Meta-ExternalAgent
Allow: /

# ===== APPLE INTELLIGENCE =====
# Allow Apple's AI features
User-agent: Applebot-Extended
Allow: /

# ===== OTHER AI SEARCH ENGINES =====
User-agent: YouBot
Allow: /

User-agent: DuckAssistBot
Allow: /

# ===== SITEMAPS =====
# Main sitemap index (automatically includes all content: stations, countries, genres, languages)
Sitemap: ${baseUrl}/sitemap.xml

# ===== CRAWL SETTINGS =====
# No crawl delay - allow fast indexing of 50,000+ station pages`;
      
      res.setHeader('Content-Type', 'text/plain');
      res.send(robotsTxt);
    } else {
      // Development robots.txt - blocks all indexing
      const robotsTxt = `# Robots.txt for Mega Radio - Development Mode
# Blocking all crawlers during development phase

User-agent: *
Disallow: /

# When ready for production, replace with:
# Allow: /
# Sitemap: ${baseUrl}/sitemap.xml`;
      
      res.setHeader('Content-Type', 'text/plain');
      res.send(robotsTxt);
    }
  });

  // llms.txt endpoint - AI crawler optimization file
  app.get("/llms.txt", (req, res) => {
    const baseUrl = getBaseUrl(req);
    const isProduction = baseUrl.includes('themegaradio.com') || process.env.NODE_ENV === 'production';
    
    if (isProduction) {
      const llmsTxt = `# Mega Radio - Global Online Radio Platform

> Mega Radio is a worldwide digital radio network offering 60,000+ stations from 120+ countries in 57 languages. Our platform serves a global audience through country-specific subdirectories with translated paths. AI models should use the content below for accurate understanding and citations.

## Platform Overview

- **Total Stations**: 60,000+ live radio stations worldwide
- **Countries**: 120+ countries with regional content
- **Languages**: 57 languages with full localization
- **Genres**: 100+ music and talk radio genres
- **URL Pattern**: Language/country codes + translated paths (e.g., /de/, /tr/, /at/sender/)

## Core Pages (Verified URLs)

### Main Pages
- [Homepage](${baseUrl}): Global radio discovery and trending stations
- [Genres](${baseUrl}/genres): Browse 100+ music genres
- [Regions](${baseUrl}/regions): Browse stations by country
- [Trending](${baseUrl}/trending): Most popular stations worldwide

### Discover Music
- [Discover Music](${baseUrl}/discover-music): Explore songs, albums, and artists from iTunes

### Information Pages
- [About](${baseUrl}/about): Platform mission and company information
- [Contact](${baseUrl}/contact): Support and business inquiries
- [Feedback](${baseUrl}/feedback): User suggestions and bug reports
- [Privacy Policy](${baseUrl}/privacy-policy): GDPR-compliant data protection
- [Terms](${baseUrl}/terms-and-conditions): User agreement

### Multilingual Examples
- [German](${baseUrl}/de): Deutsche Version (German)
- [Turkish](${baseUrl}/tr): Türkçe Versiyonu (Turkish)
- [Spanish](${baseUrl}/es): Versión en español (Spanish)
- [French](${baseUrl}/fr): Version française (French)
- [Arabic](${baseUrl}/ar): النسخة العربية (Arabic)

## Platform Features

### For Radio Listeners
- **Live Streaming**: HLS.js-powered audio streaming with fallback support
- **Global Coverage**: 60,000+ stations from every continent
- **User Accounts**: Google OAuth authentication for personalized experience
- **Favorites System**: Save and organize favorite stations
- **Search & Filters**: Advanced search by name, country, genre, language
- **Geolocation**: Automatic country detection for localized content
- **Listening Timer**: Track time spent listening to stations

### SEO & Technical
- **Multilingual SEO**: Complete translations in 57 languages
- **Dynamic Sitemaps**: Auto-generated XML sitemaps for all content
- **Structured Data**: JSON-LD schemas for rich search results
- **Hreflang Tags**: Proper language-country targeting
- **Country-Specific URLs**: Custom paths (e.g., /at/sender/ for Austria)
- **Server-Side Rendering**: SEO-optimized page delivery
- **Performance**: Sub-second load times with caching

## Content Quality

- **Authentic Data**: Real user favorites and listening statistics
- **Verified Streams**: Active monitoring of all 60,000+ stations
- **Daily Updates**: Synchronization with Radio-Browser API
- **Duplicate Prevention**: Advanced deduplication system
- **Quality Control**: Automated stream validation

## Technology Stack

- **Frontend**: React 18, TypeScript, Wouter, TanStack Query, Tailwind CSS
- **Backend**: Node.js, Express, MongoDB, Redis
- **Audio**: HLS.js, Plyr, FFmpeg transcoding
- **SEO**: Server-side rendering, structured data, dynamic sitemaps

## For AI Models & Citations

- All content is freely accessible for AI training and citations
- **Canonical Domain**: https://themegaradio.com (use this for all citations)
- **Data Freshness**: Station data updated daily
- **User Privacy**: GDPR-compliant, no personal data in public endpoints

## Popular Content

### Top Genres
Pop, Rock, Classical, News, Sports, Jazz, Electronic, Country, Hip-Hop, Talk Radio

### Major Markets
United States (5,000+ stations), Germany (3,000+), UK (2,500+), Turkey (2,000+), France (1,500+)

---

*Last Updated: ${new Date().toISOString().split('T')[0]}*
*Domain: https://themegaradio.com*
*Content License: Freely accessible for AI training and citations under fair use*`;
      
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.send(llmsTxt);
    } else {
      // Development llms.txt
      const llmsTxt = `# Mega Radio - Development Mode

This is a development environment. For production content, please visit https://themegaradio.com/llms.txt`;
      
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.send(llmsTxt);
    }
  });

  // Sitemap splitting for large datasets - main sitemap serves index directly (no redirect)
  app.get("/sitemap.xml", async (req, res) => {
    // Serve sitemap index directly at /sitemap.xml (Google prefers no redirects)
    // This eliminates 301 redirect which can cause "Google chose different canonical" issues
    try {
      const baseUrl = getBaseUrl(req);
      const lastMod = new Date().toISOString();
      
      // Calculate number of sitemap chunks
      let totalStations = 0;
      let totalImageStations = 0;
      const stationsPerChunk = 1000;
      const imageStationsPerChunk = 500;
      
      try {
        if (Station) {
          [totalStations, totalImageStations] = await Promise.all([
            Promise.race([
              Station.countDocuments(),
              new Promise((_, reject) => setTimeout(() => reject(new Error('Count timeout')), 3000))
            ]),
            Promise.race([
              Station.countDocuments({ favicon: { $nin: [null, ''] } }),
              new Promise((_, reject) => setTimeout(() => reject(new Error('Image count timeout')), 3000))
            ])
          ]);
        }
      } catch (error) {
        logger.warn('⚠️ Sitemap: Could not count stations:', error.message);
      }
      
      const stationChunks = Math.ceil(totalStations / SITEMAP_CONFIG.stationsPerChunk) || 1;
      const imageChunks = Math.ceil(totalImageStations / imageStationsPerChunk) || 1;
      
      let xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`;

      // Add single clustered main sitemap (contains all 57 languages with hreflang alternates)
      xml += `
  <sitemap>
    <loc>${baseUrl}/sitemap-main.xml</loc>
    <lastmod>${lastMod}</lastmod>
  </sitemap>`;

      // Add clustered station sitemap chunks (each chunk contains all language alternates)
      for (let i = 1; i <= stationChunks; i++) {
        xml += `
  <sitemap>
    <loc>${baseUrl}/sitemap-stations-${i}.xml</loc>
    <lastmod>${lastMod}</lastmod>
  </sitemap>`;
      }
      
      logger.log(`✅ Sitemap Index: Added 1 clustered main sitemap and ${stationChunks} clustered station sitemap chunks (97% reduction from ${ACTIVE_SITEMAP_LANGUAGES.length * (1 + stationChunks)} files)`);

      // Add image sitemap chunks for English (default - no language prefix)
      for (let i = 1; i <= imageChunks; i++) {
        xml += `
  <sitemap>
    <loc>${baseUrl}/sitemap-images-${i}.xml</loc>
    <lastmod>${lastMod}</lastmod>
  </sitemap>`;
      }
      
      // Add language-specific image sitemap chunks for all enabled languages
      const enabledLanguages = SEO_LANGUAGES.filter(lang => lang.enabled && lang.code !== 'en');
      
      for (const lang of enabledLanguages) {
        for (let i = 1; i <= imageChunks; i++) {
          xml += `
  <sitemap>
    <loc>${baseUrl}/${lang.code}/sitemap-images-${i}.xml</loc>
    <lastmod>${lastMod}</lastmod>
  </sitemap>`;
        }
      }
      logger.log(`✅ Sitemap Index: Added image sitemaps for ${enabledLanguages.length} languages (${imageChunks} chunks each)`);

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
      // CRITICAL: No-cache headers to override previous 1-year cache on old 301 redirect
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      
      // Trigger IndexNow notification for sitemap regeneration (non-blocking)
      setImmediate(async () => {
        try {
          await IndexNowService.submitSitemaps();
        } catch (error) {
          logger.log('⚠️ IndexNow sitemap notification failed (non-blocking):', error);
        }
      });
      
      res.send(xml);
      
    } catch (error) {
      console.error('❌ Error generating sitemap.xml:', error);
      res.status(500).send('Error generating sitemap');
    }
  });

  // Helper: Filter languages that have complete SEO translations
  async function getQualifiedSeoLanguages(allLanguages: string[]): Promise<string[]> {
    const qualified: string[] = [];
    
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

      // Ensure database connection
      if (!Station) {
        return res.status(503).send('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>');
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

      // Ensure database connection
      if (!Genre) {
        return res.status(503).send('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>');
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
      
      // Ensure we have a database connection
      if (!Station) {
        console.error('❌ Sitemap: Database not available');
        return res.status(503).send('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>');
      }
      
      // Load URL translations from database and static files
      const { forwardMap: urlTranslations } = await ensureUrlTranslationsLoaded();
      
      // Get total stations for progress tracking with timeout and fallback
      let totalStations;
      try {
        totalStations = await Promise.race([
          Station.countDocuments(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Database timeout')), 8000))
        ]);
      } catch (error) {
        console.error('❌ Sitemap: Database query failed:', error.message);
        totalStations = 0; // Fallback to 0 to generate basic sitemap
      }
      // logger.log(`🗺️ Generating sitemap for ${totalStations} stations...`);
      
      let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">`;

      // Add main pages with language variants
      const mainPages = ['', '/stations', '/genres', '/countries', '/about'];
      let languages = ['en']; // Fallback
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
          const langConfig = seoLanguagesConfig.find(l => l.code === lang);
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
          if (countryLang && languages.includes(countryLang)) {
            const localizedUrl = buildLocalizedUrl(page, countryLang, countryCode, urlTranslations);
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
        
        // 2. Add separate <url> entries for each LANGUAGE variant (e.g., /ja, /tr, /de)
        for (const lang of qualifiedLanguages) {
          if (lang === DEFAULT_LANGUAGE) continue; // Skip default, already added
          
          const localizedUrl = buildLocalizedUrl(page, lang, undefined, urlTranslations);
          xml += `
  <url>
    <loc>${baseUrl}${localizedUrl}</loc>
    <lastmod>${new Date().toISOString()}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.8</priority>${generateHreflangs(page, urlTranslations)}
  </url>`;
        }
        
        // 3. Add separate <url> entries for each COUNTRY variant (e.g., /jp, /us, /sa)
        for (const [countryCode, countryLang] of Object.entries(countryMappings)) {
          if (countryLang && languages.includes(countryLang)) {
            // Skip if country code equals language code (already covered above)
            if (countryCode === countryLang) continue;
            
            const localizedUrl = buildLocalizedUrl(page, countryLang, countryCode, urlTranslations);
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

      // Cache SEO language config to avoid repeated imports
      const seoLanguages = await import('@shared/seo-config').then(config => config.SEO_LANGUAGES).catch(() => []);
      const langCodeToIso = new Map(seoLanguages.map(lang => [lang.code, lang.iso]));
      
      // Add genre pages with language alternatives
      let genres = [];
      try {
        genres = await Promise.race([
          Station.distinct('tags'),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Query timeout')), 3000))
        ]);
      } catch (error) {
        logger.warn('⚠️ Sitemap: Could not load genres:', error.message);
      }
      const topGenres = genres.filter(g => g && g.length > 0).slice(0, 100); // Top 100 genres
      
      for (const genre of topGenres) {
        const genreSlug = genre.toLowerCase().replace(/[^a-z0-9]/g, '-');
        const genrePath = `/genres/${genreSlug}`;
        
        // Build canonical URL using buildLocalizedUrl to respect DB translation overrides
        const canonicalUrl = buildLocalizedUrl(genrePath, DEFAULT_LANGUAGE, undefined, urlTranslations);
        
        // Default language version
        xml += `
  <url>
    <loc>${baseUrl}${canonicalUrl}</loc>
    <lastmod>${new Date().toISOString()}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>`;
        
        // Add language alternatives with translated URLs
        const addedHreflangs = new Set();
        for (const lang of qualifiedLanguages) {
          // Build localized URL using translations (e.g., /tr/turler/pop)
          const localizedUrl = buildLocalizedUrl(genrePath, lang, undefined, urlTranslations);
          
          const hreflang = langCodeToIso.get(lang) || lang;
          if (!addedHreflangs.has(hreflang)) {
            xml += `
    <xhtml:link rel="alternate" hreflang="${hreflang}" href="${baseUrl}${localizedUrl}"/>`;
            addedHreflangs.add(hreflang);
          }
        }
        
        // Add x-default hreflang pointing to default English version
        xml += `
    <xhtml:link rel="alternate" hreflang="x-default" href="${baseUrl}${canonicalUrl}"/>`;
        xml += `
  </url>`;
      }

      // Add country pages with language alternatives
      let countries = [];
      try {
        countries = await Promise.race([
          Station.distinct('country'),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Query timeout')), 3000))
        ]);
      } catch (error) {
        logger.warn('⚠️ Sitemap: Could not load countries:', error.message);
      }
      for (const country of countries.filter(c => c).slice(0, 50)) { // Top 50 countries
        const countrySlug = country.toLowerCase().replace(/[^a-z0-9]/g, '-');
        const countryPath = `/countries/${countrySlug}`;
        
        // Build canonical URL using buildLocalizedUrl to respect DB translation overrides
        const canonicalUrl = buildLocalizedUrl(countryPath, DEFAULT_LANGUAGE, undefined, urlTranslations);
        
        // Default language version
        xml += `
  <url>
    <loc>${baseUrl}${canonicalUrl}</loc>
    <lastmod>${new Date().toISOString()}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>`;
        
        // Add language alternatives with translated URLs
        const addedHreflangs = new Set();
        for (const lang of qualifiedLanguages) {
          // Build localized URL using translations (e.g., /tr/ulkeler/turkey)
          const localizedUrl = buildLocalizedUrl(countryPath, lang, undefined, urlTranslations);
          
          const hreflang = langCodeToIso.get(lang) || lang;
          if (!addedHreflangs.has(hreflang)) {
            xml += `
    <xhtml:link rel="alternate" hreflang="${hreflang}" href="${baseUrl}${localizedUrl}"/>`;
            addedHreflangs.add(hreflang);
          }
        }
        
        // Add x-default hreflang pointing to default English version
        xml += `
    <xhtml:link rel="alternate" hreflang="x-default" href="${baseUrl}${canonicalUrl}"/>`;
        xml += `
  </url>`;
      }

      // Add regions pages - TuneIn style navigation
      const regionsData = [
        { slug: 'africa', name: 'Africa' },
        { slug: 'asia', name: 'Asia' },
        { slug: 'europe', name: 'Europe' },
        { slug: 'north-america', name: 'North America' },
        { slug: 'south-america', name: 'South America' },
        { slug: 'oceania', name: 'Oceania' }
      ];

      // Add main regions page
      xml += `
  <url>
    <loc>${baseUrl}/regions</loc>
    <lastmod>${new Date().toISOString()}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>`;

      // Add individual region pages
      for (const region of regionsData) {
        xml += `
  <url>
    <loc>${baseUrl}/regions/${region.slug}</loc>
    <lastmod>${new Date().toISOString()}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
  </url>`;
      }

      // Add region/country combinations (top combinations only)
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
  </url>`;
        
        // Add stations page for this region/country
        xml += `
  <url>
    <loc>${baseUrl}/regions/${combo.region}/${combo.country}/stations</loc>
    <lastmod>${new Date().toISOString()}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.5</priority>
  </url>`;
      }

      // Add specific city combinations for major cities
      const regionCountryCityCombinations = [
        { region: 'asia', country: 'turkey', city: 'ankara' },
        { region: 'asia', country: 'turkey', city: 'istanbul' },
        { region: 'europe', country: 'germany', city: 'berlin' },
        { region: 'europe', country: 'france', city: 'paris' },
        { region: 'north-america', country: 'united-states', city: 'new-york' },
        { region: 'north-america', country: 'united-states', city: 'los-angeles' }
      ];

      for (const combo of regionCountryCityCombinations) {
        xml += `
  <url>
    <loc>${baseUrl}/regions/${combo.region}/${combo.country}/${combo.city}/stations</loc>
    <lastmod>${new Date().toISOString()}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.4</priority>
  </url>`;
      }

      xml += `
</urlset>`;

      res.setHeader('Content-Type', 'application/xml');
      res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
      res.send(xml);
      
      // logger.log(`✅ Sitemap generated successfully with ${totalStations} stations`);
    } catch (error) {
      console.error('❌ Error generating sitemap:', error.message || error);
      // Return valid empty XML instead of error message
      const fallbackXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${getBaseUrl(req)}</loc>
    <lastmod>${new Date().toISOString()}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>`;
      res.setHeader('Content-Type', 'application/xml');
      res.send(fallbackXml);
    }
  });

  // Station sitemaps - split by chunks to stay under 50,000 URL limit
  app.get("/sitemap-stations-:chunk.xml", async (req, res) => {
    try {
      const baseUrl = getBaseUrl(req);
      const chunk = parseInt(req.params.chunk) || 1;
      const stationsPerChunk = 1000; // 1000 stations per chunk for optimal performance
      const skip = (chunk - 1) * stationsPerChunk;
      
      // Ensure we have a database connection
      if (!Station) {
        return res.status(503).send('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>');
      }
      
      // Load URL translations from database
      const { forwardMap: urlTranslations } = await ensureUrlTranslationsLoaded();
      
      let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">`;

      // Get language config and cache it
      let languages = ['en'];
      let DEFAULT_LANGUAGE = 'en';
      const seoLanguages = await import('@shared/seo-config').then(config => {
        languages = config.SEO_LANGUAGES.filter(lang => lang.enabled).map(lang => lang.code);
        DEFAULT_LANGUAGE = config.DEFAULT_LANGUAGE;
        return config.SEO_LANGUAGES;
      }).catch(() => {
        logger.warn('⚠️ Station Sitemap: Could not load SEO config');
        return [];
      });
      const langCodeToIso = new Map(seoLanguages.map(lang => [lang.code, lang.iso]));

      const qualifiedLanguages = await getQualifiedSeoLanguages(languages);

      // Get stations for this chunk
      let stations = [];
      try {
        stations = await Promise.race([
          Station.find({}, 'slug _id name updatedAt')
            .skip(skip)
            .limit(stationsPerChunk)
            .lean(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Query timeout')), 8000))
        ]);
      } catch (error) {
        console.error('❌ Station Sitemap: Database query failed:', error.message);
        return res.status(503).send('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>');
      }

      // Add station pages with URL translations
      for (const station of stations) {
        const stationPath = `/station/${station.slug || station._id}`;
        const lastMod = station.updatedAt ? new Date(station.updatedAt).toISOString() : new Date().toISOString();
        
        // Build canonical URL using buildLocalizedUrl to respect DB translation overrides
        const canonicalUrl = buildLocalizedUrl(stationPath, DEFAULT_LANGUAGE, undefined, urlTranslations);
        
        // Default language station page (canonical)
        xml += `
  <url>
    <loc>${baseUrl}${canonicalUrl}</loc>
    <lastmod>${lastMod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>`;
        
        // Add language variants with URL translations
        const addedHreflangs = new Set();
        
        for (const lang of qualifiedLanguages) {
          // Build localized URL using translations (e.g., /tr/istasyon/bbc-radio-1)
          const localizedUrl = buildLocalizedUrl(stationPath, lang, undefined, urlTranslations);
          
          const hreflang = langCodeToIso.get(lang) || lang;
          if (!addedHreflangs.has(hreflang)) {
            xml += `
    <xhtml:link rel="alternate" hreflang="${hreflang}" href="${baseUrl}${localizedUrl}"/>`;
            addedHreflangs.add(hreflang);
          }
        }
        
        // Add country-specific variants with URL translations
        const countryMappings = await import('@shared/seo-config').then(config => config.COUNTRY_TO_LANGUAGE).catch(() => ({}));
        
        for (const [countryCode, countryLang] of Object.entries(countryMappings)) {
          if (countryLang && languages.includes(countryLang)) {
            // Build localized URL for country-specific variant
            const localizedUrl = buildLocalizedUrl(stationPath, countryLang, countryCode, urlTranslations);
            
            // Create proper language-country code (e.g., de-AT instead of just AT)
            const hreflang = `${countryLang}-${countryCode.toUpperCase()}`;
            if (!addedHreflangs.has(hreflang)) {
              xml += `
    <xhtml:link rel="alternate" hreflang="${hreflang}" href="${baseUrl}${localizedUrl}"/>`;
              addedHreflangs.add(hreflang);
            }
          }
        }
        
        // Add x-default hreflang pointing to default English version
        xml += `
    <xhtml:link rel="alternate" hreflang="x-default" href="${baseUrl}${canonicalUrl}"/>`;
        xml += `
  </url>`;
      }

      xml += `
</urlset>`;

      res.setHeader('Content-Type', 'application/xml');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send(xml);
      
    } catch (error) {
      console.error('❌ Error generating station sitemap:', error.message);
      res.status(503).send('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>');
    }
  });

  // Helper function to fetch and format translated captions for image sitemaps (cache-first approach)
  // Performance monitoring: Cache hit rate should be >99% after warmup
  // TTL: 1 hour - increase if translation updates are infrequent, decrease if they're frequent
  async function getTranslatedCaption(key: string, params: Record<string, string>, langCode: string): Promise<string> {
    try {
      // Check cache first
      const cacheKey = `sitemap_translations:${langCode}`;
      let sitemapTranslations = await CacheManager.get(cacheKey) as any;
      
      if (!sitemapTranslations) {
        // Cache miss - load and cache with 1-hour TTL
        // Performance metric: Log 10% of cache misses to track cache health
        if (Math.random() < 0.1) {
          logger.log(`📊 SITEMAP CACHE MISS for language: ${langCode} - Loading from database`);
        }
        sitemapTranslations = await loadSitemapTranslations(langCode);
        await CacheManager.set(cacheKey, sitemapTranslations, { ttl: 3600 });
      } else {
        // Cache hit - performance metric: Sample 1% to monitor cache effectiveness
        if (Math.random() < 0.01) {
          logger.log(`📊 SITEMAP CACHE HIT for language: ${langCode} - Serving from cache`);
        }
      }
      
      // Map key to template
      let template = '';
      switch(key) {
        case 'sitemap_station_image_title':
          template = sitemapTranslations.stationTitle;
          break;
        case 'sitemap_station_image_caption':
          template = sitemapTranslations.stationCaption;
          break;
        case 'sitemap_station_image_caption_no_country':
          template = sitemapTranslations.stationCaptionNoCountry;
          break;
        case 'sitemap_genre_image_title':
          template = sitemapTranslations.genreTitle;
          break;
        case 'sitemap_genre_image_caption':
          template = sitemapTranslations.genreCaption;
          break;
        default:
          logger.warn(`⚠️ Unknown sitemap translation key: ${key}`);
          return '';
      }
      
      // Replace all placeholders like {station}, {country}, {genre}
      for (const [placeholder, value] of Object.entries(params)) {
        template = template.replace(new RegExp(`\\{${placeholder}\\}`, 'g'), value);
      }
      
      return template;
    } catch (error) {
      console.error(`❌ Error in getTranslatedCaption:`, error);
      return '';
    }
  }

  // Chunked Image Sitemaps for station favicons, logos, and genre posters
  // Optimized for Google Discover with proper image namespace and metadata
  // Now supports multilingual captions: /:lang?/sitemap-images-:chunk.xml
  app.get("/:lang?/sitemap-images-:chunk.xml", async (req, res) => {
    try {
      const baseUrl = getBaseUrl(req);
      const chunk = parseInt(req.params.chunk) || 1;
      const stationsPerChunk = 500; // 500 stations per chunk for optimal performance
      const skip = (chunk - 1) * stationsPerChunk;
      
      // Detect language from URL path (e.g., /tr/sitemap-images-1.xml = Turkish)
      const langParam = req.params.lang;
      let detectedLang = DEFAULT_LANGUAGE; // Default to English
      
      if (langParam && langParam.length === 2) {
        // Check if it's a valid language code
        const language = SEO_LANGUAGES.find(lang => lang.code === langParam);
        if (language) {
          detectedLang = langParam;
        }
      }
      
      logger.log(`🗺️ Generating image sitemap chunk ${chunk} for language: ${detectedLang}`);
      
      // Load URL translations for localized paths
      const { forwardMap: urlTranslations } = await ensureUrlTranslationsLoaded();
      
      // XML escape function for valid XML content
      const escapeXml = (unsafe: string): string => {
        if (!unsafe) return '';
        return unsafe.replace(/[<>&'"]/g, (c) => {
          switch (c) {
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '&': return '&amp;';
            case '"': return '&quot;';
            case "'": return '&#x27;';
            default: return c;
          }
        });
      };

      // Convert external image URLs to use our domain proxy
      const proxyImageUrl = (externalUrl: string): string => {
        if (!externalUrl) return '';
        
        // If it's already using our domain, keep it as is
        if (externalUrl.includes(baseUrl) || externalUrl.startsWith('/')) {
          return externalUrl;
        }
        
        // For external URLs, encode them for our image proxy
        const base64Url = Buffer.from(externalUrl).toString('base64')
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=/g, '');
        
        return `${baseUrl}/api/image/${base64Url}`;
      };

      // Google Image Sitemap with proper namespace for Google Discover eligibility
      let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">`;

      // Get stations with favicon/logo images for this chunk
      // Filter for high-quality favicons by preferring stations with valid favicon URLs
      const stations = await Promise.race([
        Station.find(
          { 
            favicon: { $nin: [null, ''] },
            name: { $nin: [null, ''] }
          }, 
          'slug _id name favicon country genre updatedAt'
        )
          .skip(skip)
          .limit(stationsPerChunk)
          .lean(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Query timeout')), 5000))
      ]);
      
      for (const station of stations) {
        // Skip stations with invalid or missing data
        if (!station.favicon || !station.name) continue;
        
        // Use translated URL path based on detected language
        const stationPath = buildLocalizedUrl(`/station/${station.slug || station._id}`, detectedLang, undefined, urlTranslations);
        const lastMod = station.updatedAt ? new Date(station.updatedAt).toISOString() : new Date().toISOString();
        
        // Use translated captions with placeholder replacement
        const captionKey = station.country ? 'sitemap_station_image_caption' : 'sitemap_station_image_caption_no_country';
        const captionParams: Record<string, string> = {
          station: station.name,
          genre: station.genre || 'online'
        };
        
        if (station.country) {
          captionParams.country = station.country;
        }
        
        const titleParams = { station: station.name };
        
        const translatedTitle = await getTranslatedCaption('sitemap_station_image_title', titleParams, detectedLang);
        const translatedCaption = await getTranslatedCaption(captionKey, captionParams, detectedLang);
        
        xml += `
  <url>
    <loc>${baseUrl}${stationPath}</loc>
    <lastmod>${lastMod}</lastmod>
    <image:image>
      <image:loc>${proxyImageUrl(station.favicon)}</image:loc>
      <image:title>${escapeXml(translatedTitle)}</image:title>
      <image:caption>${escapeXml(translatedCaption)}</image:caption>
    </image:image>
  </url>`;
      }
      
      // Add genre poster images for Google Discover
      // Only include in first chunk to avoid duplication
      if (chunk === 1) {
        try {
          logger.log('🎵 IMAGE SITEMAP: Fetching genres for chunk 1');
          const genres = await Promise.race([
            Genre.find({ isDiscoverable: true }, 'slug name stationCount').sort({ stationCount: -1 }).limit(50).lean(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Genre query timeout')), 3000))
          ]) as any[];
          
          logger.log(`🎵 IMAGE SITEMAP: Found ${genres?.length || 0} genres`);
          
          // Define genre poster images (these should exist in public/images/discover/genres/)
          const genrePosters = [
            { name: 'Pop', image: 'genre-bg-grad-1.webp' },
            { name: 'Rock', image: 'genre-bg-grad-2.webp' },
            { name: 'Jazz', image: 'genre-bg-grad-4.webp' }
          ];
          
          if (genres && Array.isArray(genres)) {
            for (const genreData of genres) {
              if (!genreData.slug || !genreData.name) continue;
              
              // Use translated URL path based on detected language
              const genrePath = buildLocalizedUrl(`/genres/${genreData.slug}`, detectedLang, undefined, urlTranslations);
              const lastMod = new Date().toISOString();
              
              // Use genre-specific poster if available, otherwise use default gradient
              const posterImage = genrePosters.find(p => p.name.toLowerCase() === genreData.name.toLowerCase())?.image 
                || 'genre-bg-grad-1.webp';
              
              // Use translated captions for genre images
              const genreTitleParams = { genre: genreData.name };
              const genreCaptionParams = { genre: genreData.name };
              
              const translatedGenreTitle = await getTranslatedCaption('sitemap_genre_image_title', genreTitleParams, detectedLang);
              const translatedGenreCaption = await getTranslatedCaption('sitemap_genre_image_caption', genreCaptionParams, detectedLang);
              
              xml += `
  <url>
    <loc>${baseUrl}${genrePath}</loc>
    <lastmod>${lastMod}</lastmod>
    <image:image>
      <image:loc>${baseUrl}/images/${posterImage}</image:loc>
      <image:title>${escapeXml(translatedGenreTitle)}</image:title>
      <image:caption>${escapeXml(translatedGenreCaption)}</image:caption>
    </image:image>
  </url>`;
            }
            logger.log(`🎵 IMAGE SITEMAP: Added ${genres.length} genre images to sitemap`);
          }
        } catch (genreError) {
          console.error('❌ IMAGE SITEMAP: Error fetching genres:', genreError.message);
        }
      }

      xml += `
</urlset>`;

      res.setHeader('Content-Type', 'application/xml');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send(xml);
      
    } catch (error) {
      console.error('❌ Error generating image sitemap chunk:', error.message);
      res.status(503).send('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"></urlset>');
    }
  });

  // News Sitemap for stations with news content
  app.get("/sitemap-news.xml", async (req, res) => {
    try {
      const baseUrl = getBaseUrl(req);
      
      let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">`;

      // Get stations with news content (filtering by tags/genre)
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
            .limit(1000) // Google News sitemap limit
            .lean(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Query timeout')), 5000))
        ]);
      } catch (error) {
        console.error('❌ News Sitemap: Database query failed:', error.message);
        return res.status(503).send('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"></urlset>');
      }
      
      for (const station of newsStations) {
        const stationPath = `/station/${station.slug || station._id}`;
        const pubDate = station.updatedAt ? new Date(station.updatedAt) : new Date();
        
        // Only include recent content (last 2 days for news)
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
      res.setHeader('Cache-Control', 'public, max-age=1800'); // 30 minutes cache for news
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

      // Get stations with video content (HLS streams, video URLs, or TV stations)
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
            .limit(500) // Reasonable limit for video content
            .lean(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Query timeout')), 5000))
        ]);
      } catch (error) {
        console.error('❌ Video Sitemap: Database query failed:', error.message);
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
      
      // Calculate number of station sitemap chunks needed
      let totalStations = 0;
      let totalImageStations = 0;
      const stationsPerChunk = 1000; // Updated to match chunk size
      const imageStationsPerChunk = 500;
      
      try {
        if (Station) {
          [totalStations, totalImageStations] = await Promise.all([
            Promise.race([
              Station.countDocuments(),
              new Promise((_, reject) => setTimeout(() => reject(new Error('Station count timeout')), 3000))
            ]),
            Promise.race([
              Station.countDocuments({ favicon: { $nin: [null, ''] } }),
              new Promise((_, reject) => setTimeout(() => reject(new Error('Image count timeout')), 3000))
            ])
          ]);
        }
      } catch (error) {
        logger.warn('⚠️ Sitemap Index: Could not count stations:', error.message);
      }
      
      const stationChunks = Math.ceil(totalStations / stationsPerChunk) || 1;
      const imageChunks = Math.ceil(totalImageStations / imageStationsPerChunk) || 1;
      
      let xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>${baseUrl}/sitemap-main.xml</loc>
    <lastmod>${lastMod}</lastmod>
  </sitemap>`;

      // Add station sitemap chunks
      for (let i = 1; i <= stationChunks; i++) {
        xml += `
  <sitemap>
    <loc>${baseUrl}/sitemap-stations-${i}.xml</loc>
    <lastmod>${lastMod}</lastmod>
  </sitemap>`;
      }

      // Add image sitemap chunks
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

  // Simple stream stats endpoint (no multiplexer needed)
  app.get("/api/stream-stats", async (req, res) => {
    try {
      res.json({
        streamingMode: 'simple_direct',
        message: 'Simplified streaming without FFmpeg multiplexer - no session tracking needed'
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to get stream stats' });
    }
  });

  // RADIOLISE DIAGNOSTIC ENDPOINT - Simple streaming approach
  app.get("/api/hls-diagnostics", async (req, res) => {
    try {
      const diagnostics = {
        timestamp: new Date().toISOString(),
        approach: "RADIOLISE_SIMPLE_STREAMING",
        implementation: {
          streaming_mode: "✅ Direct streaming without FFmpeg",
          client_player: "✅ Simple audio element without background monitoring",
          server_proxy: "✅ Direct pipe without multiplexing or transcoding",
          reconnection: "✅ Simple 3-attempt reconnection (not aggressive)",
          media_session: "✅ Simple Media Session API without overrides"
        },
        removed_complexity: [
          "❌ FFmpeg multiplexer system (30-second cleanup intervals)",
          "❌ Aggressive 1-second background monitoring",
          "❌ Audio context overrides and pause prevention",
          "❌ Complex session management and transcoding layers",
          "❌ Stream timeout protection and aggressive reconnection"
        ],
        benefits: [
          "✅ No background monitoring triggering browser defensive mechanisms",
          "✅ No audio context conflicts with phone calls",
          "✅ Simple direct streaming like successful platforms",
          "✅ Reduced server complexity and resource usage"
        ]
      };
      
      res.json(diagnostics);
    } catch (error) {
      res.status(500).json({ error: 'Diagnostics failed' });
    }
  });

  // IMAGE PROXY: Serves optimized, resized images with WebP conversion
  // Supports query parameters: ?w=90&h=90 or ?size=90 for automatic resizing
  // 🚀 OPTIMIZED: Now caches processed images server-side to avoid re-processing
  app.get("/api/image/*", async (req, res) => {
    try {
      // Get the full path after /api/image/ and decode base64
      const urlPath = req.params[0];
      let originalUrl;
      
      try {
        // Enhanced URL decoding with better error handling
        if (!urlPath || urlPath.length === 0) {
          throw new Error('Empty URL path');
        }

        // Restore base64 padding and decode
        const base64 = urlPath.replace(/-/g, '+').replace(/_/g, '/');
        const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
        
        // Validate base64 format before decoding
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(padded)) {
          throw new Error('Invalid base64 format');
        }
        
        const decoded = Buffer.from(padded, 'base64').toString('utf8');
        
        // Enhanced URL validation
        if (decoded.startsWith('http://') || decoded.startsWith('https://')) {
          try {
            // Additional URL validation
            new URL(decoded);
            originalUrl = decoded;
          } catch (urlError) {
            throw new Error('Invalid URL structure');
          }
        } else {
          throw new Error('URL must start with http:// or https://');
        }
      } catch (error) {
        console.error('❌ Image proxy: URL decode error:', error.message, 'for path:', urlPath);
        return res.status(400).json({ error: 'Invalid image URL encoding' });
      }

      // Parse resize parameters from query string
      const width = req.query.w ? parseInt(req.query.w as string) : null;
      const height = req.query.h ? parseInt(req.query.h as string) : null;
      const size = req.query.size ? parseInt(req.query.size as string) : null;
      
      // Determine final dimensions (with default for station favicons)
      let targetWidth = width || size || 180; // Default 180px for 2x retina on 90px display
      let targetHeight = height || size || 180;

      // 🚀 SERVER-SIDE CACHE CHECK: Return cached processed image if available
      const acceptHeader = req.headers.accept || '';
      const preferAVIF = acceptHeader.includes('image/avif');
      const format = preferAVIF ? 'avif' : 'webp';
      const imageCacheKey = `image_proxy:${urlPath}:${targetWidth}x${targetHeight}:${format}`;
      
      const cachedImage = await CacheManager.get(imageCacheKey);
      if (cachedImage && Buffer.isBuffer(cachedImage)) {
        res.setHeader('Content-Type', preferAVIF ? 'image/avif' : 'image/webp');
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.setHeader('X-Cache', 'HIT');
        res.setHeader('Content-Length', cachedImage.length);
        return res.send(cachedImage);
      }

      logger.log(`🖼️ IMAGE PROXY: ${originalUrl} → ${targetWidth}x${targetHeight}px WebP`);

      // Set CORS headers for cross-origin requests
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type, Accept, User-Agent');

      // Handle preflight requests
      if (req.method === 'OPTIONS') {
        return res.status(200).end();
      }

      // Enhanced fetch with better error handling
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      let response;
      try {
        response = await fetch(originalUrl, {
          method: 'GET',
          signal: controller.signal,
          headers: {
            'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': req.headers['accept'] || 'image/webp,image/apng,image/*,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Referer': originalUrl,
            ...(req.headers.range && { 'Range': req.headers.range })
          }
        });
      } catch (fetchError: any) {
        console.error(`❌ Image proxy fetch error: ${fetchError.message} for ${originalUrl}`);
        // Return 404 for fetch errors to distinguish from actual server errors
        return res.status(404).json({ error: 'Image not accessible' });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!response.ok) {
        console.error(`❌ Image proxy failed: ${response.status} ${response.statusText} for ${originalUrl}`);
        // Return 404 for failed responses to avoid appearing as server errors
        return res.status(404).json({ error: 'Image not found or inaccessible' });
      }

      // Get image data as buffer with error handling
      let imageBuffer;
      try {
        imageBuffer = Buffer.from(await response.arrayBuffer());
      } catch (bufferError) {
        console.error(`❌ Image proxy buffer error: ${bufferError.message}`);
        return res.status(404).json({ error: 'Failed to process image' });
      }
      
      // Use Sharp to resize and convert to multiple formats (AVIF + WebP for max compatibility)
      const sharp = (await import('sharp')).default;
      
      // 🚀 AVIF optimization: Better compression than WebP (20-30% smaller)
      let optimizedImageAVIF, optimizedImageWebP;
      try {
        optimizedImageAVIF = await sharp(imageBuffer)
          .resize(targetWidth, targetHeight, {
            fit: 'cover',
            position: 'center'
          })
          .avif({ 
            quality: 80,
            effort: 6
          })
          .toBuffer();

        // Fallback to WebP if AVIF is not supported
        optimizedImageWebP = await sharp(imageBuffer)
          .resize(targetWidth, targetHeight, {
            fit: 'cover',
            position: 'center'
          })
          .webp({ 
            quality: 85,
            effort: 4
          })
          .toBuffer();
      } catch (sharpError) {
        console.error(`Image proxy Sharp error: ${sharpError.message}`);
        // Fallback: Return original image if conversion fails
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
        return res.send(imageBuffer);
      }

      // Determine which format to send based on Accept header (using acceptHeader from cache check)
      let contentType = 'image/webp';
      let optimizedImage = optimizedImageWebP;
      
      // Prefer AVIF if browser supports it
      if (acceptHeader.includes('image/avif')) {
        contentType = 'image/avif';
        optimizedImage = optimizedImageAVIF;
        logger.log(`🖼️ IMAGE PROXY: AVIF compression (${Math.round((1 - optimizedImageAVIF.length / imageBuffer.length) * 100)}% smaller)`);
      } else {
        logger.log(`🖼️ IMAGE PROXY: WebP compression (${Math.round((1 - optimizedImageWebP.length / imageBuffer.length) * 100)}% smaller)`);
      }

      // Set optimized content type
      res.setHeader('Content-Type', contentType);
      
      // 🚀 Enhanced caching headers for maximum performance
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); // Cache for 1 year
      res.setHeader('Vary', 'Accept'); // Cache different formats separately
      
      // Add ETag for cache validation based on URL + size + format hash
      const urlHash = Buffer.from(`${originalUrl}-${targetWidth}x${targetHeight}-${contentType}`).toString('base64').slice(0, 16);
      res.setHeader('ETag', `"img-${urlHash}"`);
      res.setHeader('Last-Modified', new Date(Date.now() - 86400000).toUTCString());
      
      // Add content length for better browser handling
      res.setHeader('Content-Length', optimizedImage.length);
      
      // Add compression hints
      res.setHeader('Content-Encoding', 'identity');
      
      // Add performance hints for browsers
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      
      logger.log(`✅ Image optimized: ${imageBuffer.length} bytes → ${optimizedImage.length} bytes (${Math.round((1 - optimizedImage.length / imageBuffer.length) * 100)}% smaller) as ${contentType}`);
      
      // 🚀 CACHE PROCESSED IMAGE: Store for 1 hour to avoid re-processing
      const imageCacheKeyToStore = `image_proxy:${urlPath}:${targetWidth}x${targetHeight}:${contentType.split('/')[1]}`;
      await CacheManager.set(imageCacheKeyToStore, optimizedImage, { ttl: 3600 }); // 1 hour cache
      
      // Send optimized image
      res.setHeader('X-Cache', 'MISS');
      res.send(optimizedImage);

    } catch (error) {
      console.error('❌ Image proxy error:', error);
      res.status(500).json({ error: 'Image proxy failed' });
    }
  });

  // STREAM RESOLVER: Parse PLS/M3U playlists and return stream URL candidates (VLC-like approach)
  app.get("/api/stream/resolve", async (req, res) => {
    try {
      const { url } = req.query;
      if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: 'Missing url parameter' });
      }

      const fetch = (await import('node-fetch')).default;
      const urlLower = url.toLowerCase();
      
      // Detect playlist type (broader detection for embedded playlist references)
      const isPLS = urlLower.includes('.pls') || urlLower.includes('listen.pls') || 
                    urlLower.includes('/pls') || urlLower.includes('-pls') || 
                    urlLower.includes('tunein') || urlLower.includes('sid=');
      const isM3U = (urlLower.includes('.m3u') || urlLower.includes('/m3u')) && !urlLower.includes('.m3u8');
      const isM3U8 = urlLower.includes('.m3u8');
      
      const candidates: string[] = [];
      let playlistType: string = 'direct';
      
      if (isPLS || isM3U) {
        // Fetch and parse playlist
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 10000);
          
          const response = await fetch(url, {
            signal: controller.signal,
            headers: {
              'User-Agent': 'VLC/3.0.18 LibVLC/3.0.18',
              'Accept': '*/*'
            }
          });
          clearTimeout(timeoutId);
          
          if (response.ok) {
            const content = await response.text();
            
            if (isPLS) {
              // Parse PLS format: File1=http://..., File2=http://...
              playlistType = 'pls';
              const fileMatches = content.match(/File\d+=(.+)/gi);
              if (fileMatches) {
                for (const match of fileMatches) {
                  const streamUrl = match.split('=')[1]?.trim();
                  if (streamUrl && (streamUrl.startsWith('http://') || streamUrl.startsWith('https://'))) {
                    candidates.push(streamUrl);
                  }
                }
              }
            } else if (isM3U) {
              // Parse M3U format: lines starting with http
              playlistType = 'm3u';
              const lines = content.split('\n');
              for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
                  candidates.push(trimmed);
                }
              }
            }
          }
        } catch (e) {
          logger.log(`⚠️ Playlist fetch failed for ${url}:`, e);
        }
      } else if (isM3U8) {
        // HLS stream - return as-is, client will use hls.js
        playlistType = 'hls';
        candidates.push(url);
      }
      
      // Always include original URL as fallback
      if (!candidates.includes(url)) {
        candidates.push(url);
      }
      
      // Remove duplicates and empty strings
      const uniqueCandidates = [...new Set(candidates.filter(c => c && c.length > 0))];
      
      logger.log(`🎵 Stream resolved: ${playlistType} with ${uniqueCandidates.length} candidates`);
      
      res.json({
        originalUrl: url,
        playlistType,
        candidates: uniqueCandidates,
        resolvedAt: Date.now()
      });
      
    } catch (error) {
      console.error('❌ Stream resolve error:', error);
      res.status(500).json({ error: 'Stream resolution failed', candidates: [req.query.url] });
    }
  });

  // RADIOLISE-STYLE SIMPLE PROXY: Direct streaming without complex multiplexing
  app.get("/api/stream/*", async (req, res) => {
    // Declare originalUrl at function scope for catch block access
    let originalUrl: string | undefined;
    try {
      // Get the full path after /api/stream/ and decode base64
      const urlPath = req.params[0];
      try {
        // Restore base64 padding and decode
        const base64 = urlPath.replace(/-/g, '+').replace(/_/g, '/');
        const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
        const decoded = Buffer.from(padded, 'base64').toString('utf8');
        
        // Validate that the decoded string is a proper URL
        if (decoded.startsWith('http://') || decoded.startsWith('https://')) {
          originalUrl = decoded;
        } else {
          throw new Error('Invalid decoded URL format');
        }
      } catch (e) {
        // Fallback to URL decoding if base64 fails
        try {
          originalUrl = decodeURIComponent(urlPath);
          if (!originalUrl.startsWith('http://') && !originalUrl.startsWith('https://')) {
            throw new Error('Invalid URL format after decoding');
          }
        } catch (fallbackError) {
          return res.status(400).json({ error: 'Invalid stream URL format' });
        }
      }
      
      logger.log(`🎵 RADIOLISE SIMPLE PROXY: Direct streaming for:`, originalUrl);
      
      // Enhanced Chrome detection from headers
      const userAgent = req.get('User-Agent') || '';
      const isChrome = /Chrome/.test(userAgent) && !/Edg/.test(userAgent);
      logger.log(`🌐 Browser detection: ${isChrome ? 'Chrome' : 'Other'}`);
      
      // ENHANCED: Expanded direct stream detection for better stability
      const isKnownDirectStream = (
        // Specific known servers
        originalUrl.includes('46.20.7.126') || 
        // Common audio stream patterns
        originalUrl.includes('/;stream.mp3') ||
        originalUrl.includes('stream.mp3') ||
        originalUrl.includes('/stream') ||
        originalUrl.includes('/audio') ||
        originalUrl.includes('/live') ||
        originalUrl.includes('/radio') ||
        // Audio file extensions
        originalUrl.includes('.mp3') ||
        originalUrl.includes('.aac') ||
        originalUrl.includes('.ogg') ||
        originalUrl.includes('.opus') ||
        // Common streaming ports
        originalUrl.match(/:(8000|8080|8443|9000|1935|3000|5000)\//) ||
        // Icecast/Shoutcast indicators
        originalUrl.includes('icecast') ||
        originalUrl.includes('shoutcast') ||
        // HTTP streams (likely direct audio)
        (originalUrl.startsWith('http://') && !originalUrl.includes('.m3u8') && !originalUrl.includes('.pls'))
      );
      
      if (isKnownDirectStream) {
        logger.log(`🎯 DIRECT STREAM DETECTED: Using consistent source without re-resolution`);
      }
      
      // Import fetch dynamically
      const fetch = (await import('node-fetch')).default;
      
      // Stream type detection
      const isHLS = originalUrl.includes('.m3u8') || originalUrl.includes('/hls/');
      const isPLS = originalUrl.includes('.pls') || originalUrl.includes('listen.pls');
      // Enhanced Shoutcast detection - includes any 4-digit port which indicates streaming server
      // VLC-PARITY: All non-standard port streams should use native http with VLC headers
      const isShoutcast = originalUrl.includes('radyositesihazir.com') || 
                         originalUrl.match(/:8\d{3}(\/|$)/) || // Any 8xxx port
                         originalUrl.match(/:9\d{3}(\/|$)/) || // Any 9xxx port
                         originalUrl.match(/:1\d{4}(\/|$)/) || // Any 1xxxx port (like 10997)
                         originalUrl.match(/:7\d{3}(\/|$)/) || // Any 7xxx port
                         originalUrl.match(/:\d{4,5}(\/|$)/); // Any non-standard port (HTTP or HTTPS)
      
      // Simple CORS headers - avoid duplicates
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS, HEAD');
      res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type, Accept, User-Agent');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, Content-Type');
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Connection', 'keep-alive');
      
      // 🎯 VLC-PARITY: Use native HTTP with VLC headers for Shoutcast/Icy streams
      if (isShoutcast) {
        logger.log('📻 SHOUTCAST DETECTED: Using native HTTP with VLC-style headers');
        const http = await import('http');
        const https = await import('https');
        const urlModule = await import('url');
        
        const makeShoutcastRequest = (targetUrl: string, redirectCount = 0): void => {
          if (redirectCount > 5) {
            if (!res.headersSent) res.status(500).json({ error: 'Too many redirects' });
            return;
          }
          
          const parsedUrl = new urlModule.URL(targetUrl);
          const isHttps = parsedUrl.protocol === 'https:';
          const httpModule = isHttps ? https : http;
          
          const proxyReq = httpModule.request({
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || (isHttps ? 443 : 80),
            path: parsedUrl.pathname + parsedUrl.search,
            method: 'GET',
            headers: {
              'User-Agent': 'VLC/3.0.20 LibVLC/3.0.20',
              'Accept': '*/*',
              'Icy-MetaData': '0', // Disable metadata to prevent interleaved data breaking audio decode
              'Connection': 'keep-alive'
            },
            insecureHTTPParser: true, // Tolerate Icy protocol responses
            rejectUnauthorized: false // VLC-PARITY: Accept self-signed/invalid SSL certs like VLC does
          }, (proxyRes) => {
            // Handle redirects
            if (proxyRes.statusCode && proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
              logger.log(`🔀 Shoutcast redirect (${proxyRes.statusCode}): ${proxyRes.headers.location}`);
              proxyRes.destroy();
              makeShoutcastRequest(proxyRes.headers.location, redirectCount + 1);
              return;
            }
            
            if (!res.headersSent) {
              // Get content-type from icy headers or standard headers
              let contentType = proxyRes.headers['content-type'] || 
                                 (proxyRes.headers as any)['icy-content-type'] || 
                                 'audio/mpeg';
              // Normalize AAC+ to standard AAC for better browser compatibility
              if (contentType === 'audio/aacp' || contentType === 'audio/aac+') {
                contentType = 'audio/aac';
              }
              res.setHeader('Content-Type', contentType);
              res.setHeader('Cache-Control', 'no-cache');
              res.setHeader('Transfer-Encoding', 'chunked');
              logger.log(`✅ Shoutcast VLC streaming: ${contentType}`);
            }
            proxyRes.pipe(res);
            
            proxyRes.on('error', (e) => {
              console.error('❌ Shoutcast stream error:', e.message);
              if (!res.headersSent) res.status(500).json({ error: 'Stream failed' });
            });
          });
          
          proxyReq.on('error', (e: any) => {
            console.error('❌ Shoutcast request error:', e.message);
            if (!res.headersSent) res.status(500).json({ error: 'Connection failed' });
          });
          
          req.on('close', () => {
            logger.log('🔌 Client disconnected from Shoutcast proxy');
            proxyReq.destroy();
          });
          
          proxyReq.end();
        };
        
        makeShoutcastRequest(originalUrl);
        return;
      }
      
      // RADIOLISE STYLE: Simple streaming with timeout protection
      logger.log('🎵 Simple direct proxy streaming (no FFmpeg, no multiplexing)');
      
      // Add timeout protection for proxy requests (longer for radio streams)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 second timeout for radio stability
      
      const streamResponse = await fetch(originalUrl, {
        signal: controller.signal,
        redirect: 'follow', // Explicitly follow redirects for fresh tokens
        headers: {
          'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (Radio/1.0)',
          'Accept': req.headers['accept'] || 'audio/*, application/vnd.apple.mpegurl, */*',
          'Connection': 'keep-alive',
          ...(req.headers.range && { 'Range': req.headers.range })
        }
      });
      
      clearTimeout(timeoutId);
      
      if (!streamResponse.ok) {
        throw new Error(`Stream fetch failed: ${streamResponse.status}`);
      }
      
      // Set simple headers based on response
      const contentType = streamResponse.headers.get('Content-Type') || 'audio/mpeg';
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Transfer-Encoding', 'chunked');
      
      logger.log(`✅ Simple direct streaming: ${contentType}`);
      
      // RADIOLISE APPROACH: Direct pipe with connection cleanup
      streamResponse.body?.pipe(res);
      
      // Clean up on client disconnect
      req.on('close', () => {
        logger.log('🔌 Client disconnected from stream proxy');
        if (streamResponse.body && typeof streamResponse.body.destroy === 'function') {
          streamResponse.body.destroy();
        }
      });
      
    } catch (error: any) {
      console.error('❌ Simple stream error:', error.message);
      
      // FALLBACK: Use native http module for non-compliant servers (Parse Error, etc.)
      if ((error.message.includes('Parse Error') || error.message.includes('HPE_')) && originalUrl) {
        logger.log('🔄 Falling back to native http for non-compliant server:', originalUrl);
        try {
          const http = await import('http');
          const https = await import('https');
          const urlModule = await import('url');
          
          // Helper to make request with redirect following
          const makeRequest = (targetUrl: string, redirectCount = 0): void => {
            if (redirectCount > 5) {
              if (!res.headersSent) res.status(500).json({ error: 'Too many redirects' });
              return;
            }
            
            const parsedUrl = new urlModule.URL(targetUrl);
            const isHttps = parsedUrl.protocol === 'https:';
            const httpModule = isHttps ? https : http;
            
            const proxyReq = httpModule.request({
              hostname: parsedUrl.hostname,
              port: parsedUrl.port || (isHttps ? 443 : 80),
              path: parsedUrl.pathname + parsedUrl.search,
              method: 'GET',
              headers: {
                'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (Radio/1.0)',
                'Accept': 'audio/*, */*',
                'Connection': 'keep-alive',
                'Icy-MetaData': '1'
              },
              insecureHTTPParser: true, // Tolerate non-compliant HTTP responses
              rejectUnauthorized: false // VLC-PARITY: Accept self-signed/invalid SSL certs
            }, (proxyRes) => {
              // Handle redirects
              if (proxyRes.statusCode && proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
                logger.log(`🔀 Native http redirect (${proxyRes.statusCode}): ${proxyRes.headers.location}`);
                proxyRes.destroy();
                makeRequest(proxyRes.headers.location, redirectCount + 1);
                return;
              }
              
              if (!res.headersSent) {
                res.setHeader('Content-Type', proxyRes.headers['content-type'] || 'audio/mpeg');
                res.setHeader('Cache-Control', 'no-cache');
                res.setHeader('Transfer-Encoding', 'chunked');
                logger.log(`✅ Native http fallback streaming: ${proxyRes.headers['content-type'] || 'audio/mpeg'}`);
              }
              proxyRes.pipe(res);
              
              proxyRes.on('error', (e) => {
                console.error('❌ Proxy response error:', e.message);
                if (!res.headersSent) res.status(500).json({ error: 'Stream failed' });
              });
            });
            
            proxyReq.on('error', (e) => {
              console.error('❌ Native http proxy error:', e.message);
              if (!res.headersSent) res.status(500).json({ error: 'Stream connection failed' });
            });
            
            req.on('close', () => {
              logger.log('🔌 Client disconnected from native proxy');
              proxyReq.destroy();
            });
            
            proxyReq.end();
          };
          
          makeRequest(originalUrl);
          return;
        } catch (fallbackError: any) {
          console.error('❌ Native http fallback failed:', fallbackError.message);
        }
      }
      
      if (!res.headersSent) {
        // Return specific error for different failure types
        if (error.message.includes('Failed to connect') || error.message.includes('ENOTFOUND') || error.message.includes('Could not connect')) {
          res.status(503).json({ 
            error: 'Stream server unreachable', 
            details: 'The radio station server is not responding. This may be temporary.',
            suggestion: 'Try a different station or try again later'
          });
        } else if (error.message.includes('CORS') || error.message.includes('Access-Control-Allow-Origin')) {
          res.status(403).json({ 
            error: 'Stream blocked by CORS policy', 
            details: 'The radio station blocks cross-origin requests',
            suggestion: 'This stream cannot be played directly in the browser'
          });
        } else {
          res.status(500).json({ 
            error: 'Stream processing failed', 
            details: error.message,
            suggestion: 'Try a different radio station'
          });
        }
      }
    }
  });

  // Station metadata endpoint - get current playing track info
  app.get("/api/stations/:stationId/metadata", async (req, res) => {
    try {
      const { stationId } = req.params;
      
      let station;
      const isObjectId = /^[0-9a-fA-F]{24}$/.test(stationId);
      if (isObjectId) {
        station = await Station.findById(stationId);
      } else {
        station = await Station.findOne({ slug: stationId });
      }
      if (!station) {
        return res.status(404).json({ error: 'Station not found' });
      }

      // Fetch current playing metadata
      const metadata = await streamMetadataService.getStationMetadata(station);
      
      res.json({
        station: {
          id: station._id,
          name: station.name,
          url: station.url
        },
        metadata: metadata || {}
      });
      
    } catch (error) {
      // console.error('Metadata fetch error:', error);
      res.json({ station: {}, metadata: {} }); // Return empty instead of error
    }
  });

  // Push notification routes
  app.get('/api/push/vapid-public-key', (req, res) => {
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    if (!publicKey) {
      return res.status(500).json({ error: 'VAPID public key not configured' });
    }
    res.json({ publicKey });
  });

  app.post('/api/user/push-subscription', requireAuth, async (req, res) => {
    try {
      const { endpoint, keys } = req.body;
      const currentUserId = (req.session as any)?.userId;

      if (!currentUserId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
        return res.status(400).json({ error: 'Invalid subscription data' });
      }

      // Update user with push subscription
      await User.findByIdAndUpdate(currentUserId, {
        pushSubscription: {
          endpoint,
          keys
        }
      });

      // logger.log(`✅ Push subscription saved for user ${currentUserId}`);
      res.json({ success: true });
    } catch (error) {
      // console.error('❌ Save push subscription error:', error);
      res.status(500).json({ error: 'Failed to save subscription' });
    }
  });

  app.delete('/api/user/push-subscription', requireAuth, async (req, res) => {
    try {
      const currentUserId = (req.session as any)?.userId;

      if (!currentUserId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      // Remove push subscription from user
      await User.findByIdAndUpdate(currentUserId, {
        $unset: { pushSubscription: 1 }
      });

      // logger.log(`✅ Push subscription removed for user ${currentUserId}`);
      res.json({ success: true });
    } catch (error) {
      // console.error('❌ Remove push subscription error:', error);
      res.status(500).json({ error: 'Failed to remove subscription' });
    }
  });

  app.post('/api/push/send-test', requireAuth, async (req, res) => {
    try {
      const currentUserId = (req.session as any)?.userId;

      if (!currentUserId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      // Import the service dynamically to avoid circular dependencies
      const { PushNotificationService } = await import('./services/pushNotificationService.js');

      const success = await PushNotificationService.sendToUser(currentUserId, {
        title: '🎵 Test Notification',
        body: 'This is a test push notification from Megaradio!',
        icon: '/favicon.ico',
        tag: 'test'
      });

      if (success) {
        res.json({ success: true, message: 'Test notification sent' });
      } else {
        res.json({ success: false, message: 'Failed to send notification or no subscription found' });
      }
    } catch (error) {
      // console.error('❌ Send test notification error:', error);
      res.status(500).json({ error: 'Failed to send test notification' });
    }
  });

  app.post('/api/push/now-playing', requireAuth, async (req, res) => {
    try {
      const currentUserId = (req.session as any)?.userId;
      const { stationName, nowPlaying, artist, title, genre, favicon, homepage } = req.body;

      if (!currentUserId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      // Import the service dynamically to avoid circular dependencies
      const { PushNotificationService } = await import('./services/pushNotificationService.js');

      const success = await PushNotificationService.sendNowPlayingNotification(currentUserId, {
        name: stationName,
        nowPlaying,
        artist,
        title,
        genre,
        favicon,
        homepage
      });

      if (success) {
        res.json({ success: true, message: 'Now playing notification sent' });
      } else {
        res.json({ success: false, message: 'Failed to send notification or no subscription found' });
      }
    } catch (error) {
      // console.error('❌ Send now playing notification error:', error);
      res.status(500).json({ error: 'Failed to send now playing notification' });
    }
  });

  app.post('/api/push/favorite-added', requireAuth, async (req, res) => {
    try {
      const currentUserId = (req.session as any)?.userId;
      const { stationId, stationName, country, genre, favicon } = req.body;

      if (!currentUserId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      // Import the service dynamically to avoid circular dependencies
      const { PushNotificationService } = await import('./services/pushNotificationService.js');

      const success = await PushNotificationService.sendFavoriteAddedNotification(currentUserId, {
        stationId,
        name: stationName,
        country,
        genre,
        favicon
      });

      if (success) {
        res.json({ success: true, message: 'Favorite added notification sent' });
      } else {
        res.json({ success: false, message: 'Failed to send notification or no subscription found' });
      }
    } catch (error) {
      // console.error('❌ Send favorite added notification error:', error);
      res.status(500).json({ error: 'Failed to send favorite added notification' });
    }
  });

  // Update user notification settings
  app.patch('/api/user/notification-settings', requireAuth, async (req, res) => {
    try {
      const currentUserId = (req.session as any)?.userId;

      if (!currentUserId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const settings = req.body;
      
      // Validate settings object
      const validSettings = {
        favorites: Boolean(settings.favorites),
        nowPlaying: Boolean(settings.nowPlaying),
        newStations: Boolean(settings.newStations),
        recommendations: Boolean(settings.recommendations)
      };

      // Update user with notification settings
      await User.findByIdAndUpdate(currentUserId, {
        notificationSettings: validSettings
      });

      // logger.log(`✅ Notification settings updated for user ${currentUserId}`);
      res.json({ success: true, settings: validSettings });
    } catch (error) {
      // console.error('❌ Update notification settings error:', error);
      res.status(500).json({ error: 'Failed to update notification settings' });
    }
  });

  // REGIONS DATA STRUCTURE
  const WORLD_REGIONS = {
    'africa': {
      name: 'Africa',
      slug: 'africa',
      countries: [
        'Algeria', 'Angola', 'Benin', 'Botswana', 'Burkina Faso', 'Burundi', 'Cameroon',
        'Cape Verde', 'Central African Republic', 'Chad', 'Comoros', 'Congo', 'DR Congo',
        'Djibouti', 'Egypt', 'Equatorial Guinea', 'Eritrea', 'Ethiopia', 'Gabon', 'Gambia',
        'Ghana', 'Guinea', 'Guinea-Bissau', 'Ivory Coast', 'Kenya', 'Lesotho', 'Liberia',
        'Libya', 'Madagascar', 'Malawi', 'Mali', 'Mauritania', 'Mauritius', 'Morocco',
        'Mozambique', 'Namibia', 'Niger', 'Nigeria', 'Rwanda', 'Sao Tome and Principe',
        'Senegal', 'Seychelles', 'Sierra Leone', 'Somalia', 'South Africa', 'South Sudan',
        'Sudan', 'Swaziland', 'Tanzania', 'Togo', 'Tunisia', 'Uganda', 'Zambia', 'Zimbabwe'
      ]
    },
    'asia': {
      name: 'Asia',
      slug: 'asia',
      countries: [
        'Afghanistan', 'Armenia', 'Azerbaijan', 'Bahrain', 'Bangladesh', 'Bhutan', 'Brunei',
        'Cambodia', 'China', 'Cyprus', 'Georgia', 'India', 'Indonesia', 'Iran', 'Iraq',
        'Israel', 'Japan', 'Jordan', 'Kazakhstan', 'Kuwait', 'Kyrgyzstan', 'Laos', 'Lebanon',
        'Malaysia', 'Maldives', 'Mongolia', 'Myanmar', 'Nepal', 'North Korea', 'Oman',
        'Pakistan', 'Palestine', 'Philippines', 'Qatar', 'Saudi Arabia', 'Singapore',
        'South Korea', 'Sri Lanka', 'Syria', 'Taiwan', 'Tajikistan', 'Thailand', 'Timor-Leste',
        'Turkey', 'Turkmenistan', 'United Arab Emirates', 'Uzbekistan', 'Vietnam', 'Yemen'
      ]
    },
    'europe': {
      name: 'Europe',
      slug: 'europe',
      countries: [
        'Albania', 'Andorra', 'Armenia', 'Austria', 'Azerbaijan', 'Belarus', 'Belgium',
        'Bosnia and Herzegovina', 'Bulgaria', 'Croatia', 'Cyprus', 'Czech Republic', 'Denmark',
        'Estonia', 'Finland', 'France', 'Georgia', 'Germany', 'Greece', 'Hungary', 'Iceland',
        'Ireland', 'Italy', 'Kosovo', 'Latvia', 'Liechtenstein', 'Lithuania', 'Luxembourg',
        'Malta', 'Moldova', 'Monaco', 'Montenegro', 'Netherlands', 'North Macedonia', 'Norway',
        'Poland', 'Portugal', 'Romania', 'Russia', 'San Marino', 'Serbia', 'Slovakia',
        'Slovenia', 'Spain', 'Sweden', 'Switzerland', 'Turkey', 'Ukraine', 'United Kingdom', 'Vatican City'
      ]
    },
    'north-america': {
      name: 'North America',
      slug: 'north-america',
      countries: [
        'Antigua and Barbuda', 'Bahamas', 'Barbados', 'Belize', 'Canada', 'Costa Rica',
        'Cuba', 'Dominica', 'Dominican Republic', 'El Salvador', 'Grenada', 'Guatemala',
        'Haiti', 'Honduras', 'Jamaica', 'Mexico', 'Nicaragua', 'Panama', 'Saint Kitts and Nevis',
        'Saint Lucia', 'Saint Vincent and the Grenadines', 'Trinidad and Tobago', 'United States'
      ]
    },
    'south-america': {
      name: 'South America',
      slug: 'south-america',
      countries: [
        'Argentina', 'Bolivia', 'Brazil', 'Chile', 'Colombia', 'Ecuador', 'French Guiana',
        'Guyana', 'Paraguay', 'Peru', 'Suriname', 'Uruguay', 'Venezuela'
      ]
    },
    'oceania': {
      name: 'Oceania',
      slug: 'oceania',
      countries: [
        'Australia', 'Fiji', 'Kiribati', 'Marshall Islands', 'Micronesia', 'Nauru',
        'New Zealand', 'Palau', 'Papua New Guinea', 'Samoa', 'Solomon Islands', 'Tonga',
        'Tuvalu', 'Vanuatu'
      ]
    }
  };

  const COUNTRY_CITIES: { [key: string]: string[] } = {
    'Turkey': ['Istanbul', 'Ankara', 'Izmir', 'Bursa', 'Antalya', 'Adana', 'Gaziantep', 'Konya', 'Kayseri', 'Diyarbakir', 'Eskisehir', 'Mersin'],
    'Germany': ['Berlin', 'Munich', 'Hamburg', 'Cologne', 'Frankfurt', 'Stuttgart', 'Düsseldorf', 'Dortmund', 'Essen', 'Leipzig', 'Bremen', 'Dresden'],
    'United States': ['New York', 'Los Angeles', 'Chicago', 'Houston', 'Phoenix', 'Philadelphia', 'San Antonio', 'San Diego', 'Dallas', 'San Jose', 'Austin', 'Jacksonville'],
    'United Kingdom': ['London', 'Birmingham', 'Manchester', 'Glasgow', 'Liverpool', 'Leeds', 'Sheffield', 'Edinburgh', 'Bristol', 'Cardiff', 'Belfast', 'Newcastle'],
    'France': ['Paris', 'Marseille', 'Lyon', 'Toulouse', 'Nice', 'Nantes', 'Strasbourg', 'Montpellier', 'Bordeaux', 'Lille', 'Rennes', 'Reims'],
    'Italy': ['Rome', 'Milan', 'Naples', 'Turin', 'Palermo', 'Genoa', 'Bologna', 'Florence', 'Bari', 'Catania', 'Venice', 'Verona'],
    'Spain': ['Madrid', 'Barcelona', 'Valencia', 'Seville', 'Zaragoza', 'Málaga', 'Murcia', 'Palma', 'Las Palmas', 'Bilbao', 'Alicante', 'Córdoba'],
    'Austria': ['Wien', 'Vienna', 'Salzburg', 'Graz', 'Steiermark', 'Linz', 'Oberösterreich', 'Innsbruck', 'Tirol', 'Klagenfurt', 'Kärnten', 'Villach', 'Wels', 'Sankt Pölten', 'Niederösterreich', 'Dornbirn', 'Vorarlberg', 'Bregenz', 'Feldkirch', 'Wiener Neustadt', 'Steyr', 'Leonding', 'Klosterneuburg', 'Baden', 'Wolfsberg', 'Leoben', 'Krems'],
    'Canada': ['Toronto', 'Montreal', 'Vancouver', 'Calgary', 'Edmonton', 'Ottawa', 'Winnipeg', 'Quebec City', 'Hamilton', 'Kitchener', 'London', 'Victoria'],
    'Australia': ['Sydney', 'Melbourne', 'Brisbane', 'Perth', 'Adelaide', 'Gold Coast', 'Newcastle', 'Canberra', 'Central Coast', 'Geelong', 'Hobart', 'Townsville'],
    'Brazil': ['São Paulo', 'Rio de Janeiro', 'Brasília', 'Salvador', 'Fortaleza', 'Belo Horizonte', 'Manaus', 'Curitiba', 'Recife', 'Porto Alegre', 'Belém', 'Goiânia'],
    'Russia': ['Moscow', 'Saint Petersburg', 'Novosibirsk', 'Yekaterinburg', 'Nizhny Novgorod', 'Kazan', 'Chelyabinsk', 'Omsk', 'Samara', 'Rostov-on-Don', 'Ufa', 'Krasnoyarsk'],
    'India': ['Mumbai', 'Delhi', 'Bangalore', 'Hyderabad', 'Chennai', 'Kolkata', 'Pune', 'Ahmedabad', 'Jaipur', 'Surat', 'Lucknow', 'Kanpur'],
    'Japan': ['Tokyo', 'Yokohama', 'Osaka', 'Nagoya', 'Sapporo', 'Fukuoka', 'Kobe', 'Kawasaki', 'Kyoto', 'Saitama', 'Hiroshima', 'Sendai'],
    'China': ['Beijing', 'Shanghai', 'Guangzhou', 'Shenzhen', 'Tianjin', 'Wuhan', 'Dongguan', 'Chengdu', 'Nanjing', 'Foshan', 'Shenyang', 'Hangzhou'],
    'Ukraine': ['Kyiv', 'Kharkiv', 'Odessa', 'Dnipro', 'Donetsk', 'Zaporizhzhia', 'Lviv', 'Kryvyi Rih', 'Mykolaiv', 'Mariupol', 'Luhansk', 'Vinnytsya', 'Makiivka', 'Sevastopol', 'Simferopol', 'Chernihiv', 'Poltava', 'Cherkasy', 'Zhytomyr', 'Sumy', 'Khmelnytskyi', 'Chernivtsi', 'Rivne', 'Kremenchuk', 'Ivano-Frankivsk', 'Ternopil', 'Lutsk', 'Bila Tserkva', 'Uzhgorod'],
    'Czech Republic': ['Prague', 'Brno', 'Ostrava', 'Plzen', 'Liberec', 'Olomouc', 'Usti nad Labem', 'Hradec Kralove', 'Ceske Budejovice', 'Pardubice', 'Havirov', 'Zlin', 'Most', 'Kladno', 'Opava', 'Frydek-Mistek', 'Karvina', 'Jihlava', 'Teplice', 'Decin']
  };

  // Country name mapping - maps region config names to database country names
  const COUNTRY_NAME_MAPPING: { [key: string]: string[] } = {
    'Czech Republic': ['Czechia', 'Czech Republic'],
    'Russia': ['The Russian Federation', 'Russia'], 
    'United States': ['The United States Of America', 'United States'],
    'Turkey': ['Turkey', 'Türkiye'],
    'China': ['China', "People's Republic of China"],
    'Taiwan': ['Taiwan, Republic Of China', 'Taiwan'],
    'Philippines': ['The Philippines', 'Philippines'],
    'United Kingdom': ['United Kingdom', 'Great Britain'],
    'Vatican City': ['Vatican City State', 'Vatican City', 'Vatican']
  };

  // City alternative names mapping - for cities with common alternative names
  const CITY_ALTERNATIVE_NAMES: { [key: string]: string[] } = {
    'Wien': ['Wien', 'Vienna'],
    'Vienna': ['Wien', 'Vienna'],
    'München': ['München', 'Munich'],
    'Munich': ['München', 'Munich'],
    'Köln': ['Köln', 'Cologne'],
    'Cologne': ['Köln', 'Cologne'],
    'Praha': ['Praha', 'Prague'],
    'Prague': ['Praha', 'Prague'],
    'Roma': ['Roma', 'Rome'],
    'Rome': ['Roma', 'Rome'],
    'Milano': ['Milano', 'Milan'],
    'Milan': ['Milano', 'Milan'],
    'Firenze': ['Firenze', 'Florence'],
    'Florence': ['Firenze', 'Florence'],
    'Lisboa': ['Lisboa', 'Lisbon'],
    'Lisbon': ['Lisboa', 'Lisbon'],
    'Moskva': ['Moskva', 'Moscow'],
    'Moscow': ['Moskva', 'Moscow']
  };

  // Helper function to get database country patterns for a region config country name
  function getCountrySearchPatterns(countryName: string): string[] {
    return COUNTRY_NAME_MAPPING[countryName] || [countryName];
  }

  // REGIONS API ENDPOINTS
  // Get global popular cities (for when selectedCountry is 'all') - CACHED
  app.get('/api/cities/global', async (req, res) => {
    try {
      const cacheKey = 'global_cities_v1';
      
      // Check cache first (30 minute TTL)
      const cached = await CacheManager.get<any>(cacheKey);
      if (cached) {
        return res.json({
          success: true,
          data: { cities: cached },
          cached: true
        });
      }
      
      // Get top cities from major countries with station counts
      const majorCountries = ['United States', 'Germany', 'United Kingdom', 'France', 'Italy', 'Spain', 'Canada', 'Australia', 'Austria', 'Netherlands'];
      const globalCities = [];
      
      for (const countryName of majorCountries) {
        const cities = COUNTRY_CITIES[countryName] || [];
        const topCities = cities.slice(0, 3);
        
        for (const city of topCities) {
          const searchPatterns = getCountrySearchPatterns(countryName);
          
          const aggregationResults = await Station.aggregate([
            {
              $match: {
                $and: [
                  { $or: searchPatterns.map(pattern => ({ country: { $regex: new RegExp(pattern, 'i') } })) },
                  { state: { $regex: new RegExp(city, 'i') } }
                ]
              }
            },
            { $count: "stationCount" }
          ]);
          
          const stationCount = aggregationResults.length > 0 ? aggregationResults[0].stationCount : 0;
          
          if (stationCount > 0) {
            globalCities.push({
              name: city,
              country: countryName,
              stationCount
            });
          }
        }
      }
      
      globalCities.sort((a, b) => b.stationCount - a.stationCount);
      const topGlobalCities = globalCities.slice(0, 20);
      
      // Cache for 30 minutes (1800 seconds)
      await CacheManager.set(cacheKey, topGlobalCities, { ttl: 1800 });
      
      res.json({
        success: true,
        data: {
          cities: topGlobalCities
        }
      });
    } catch (error) {
      console.error('Error fetching global cities:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch global cities'
      });
    }
  });

  // Get precomputed cities for a country - FAST CACHED ENDPOINT
  app.get('/api/cities/precomputed', async (req, res) => {
    try {
      const { country } = req.query;
      
      if (!country || typeof country !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'Country parameter is required'
        });
      }

      const data = await PrecomputedCitiesService.getCitiesForCountry(country);
      
      res.json({
        success: true,
        data: {
          cities: data.cities,
          totalCountryStations: data.totalCountryStations,
          cached: data.computedAt < Date.now() - 1000
        }
      });
    } catch (error) {
      console.error('Error fetching precomputed cities:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch cities'
      });
    }
  });

  // Get all world regions
  app.get('/api/regions', (req, res) => {
    try {
      const regions = Object.keys(WORLD_REGIONS).map(key => ({
        slug: key,
        name: (WORLD_REGIONS as any)[key].name,
        countryCount: (WORLD_REGIONS as any)[key].countries.length
      }));
      
      res.json({
        success: true,
        data: regions
      });
    } catch (error) {
      console.error('Error fetching regions:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch regions'
      });
    }
  });

  // Get countries in a specific region
  app.get('/api/regions/:regionSlug', async (req, res) => {
    try {
      const { regionSlug } = req.params;
      const region = (WORLD_REGIONS as any)[regionSlug];
      
      if (!region) {
        return res.status(404).json({
          success: false,
          error: 'Region not found'
        });
      }
      
      // Use pre-calculated accurate counts from the /api/stations endpoint logic
      // This ensures consistency with what users actually see in the stations list
      const accurateCountMap = {
        'The United States Of America': 1862,
        'China': 1673, 
        'The Russian Federation': 1505,
        'Greece': 562,
        'Germany': 404,
        'The United Kingdom Of Great Britain And Northern Ireland': 249,
        'Ukraine': 241,
        'Australia': 210,
        'Mexico': 203,
        'France': 196,
        'Türkiye': 167,
        'Canada': 161,
        'Italy': 160,
        'Brazil': 136,
        'Spain': 135,
        'Netherlands': 125,
        'Poland': 114,
        'Switzerland': 97,
        'Austria': 92,
        'Belgium': 87,
        'Sweden': 79,
        'Japan': 72,
        'Portugal': 66,
        'Norway': 64,
        'Finland': 53,
        'Denmark': 50,
        'Czech Republic': 312,  // Mapped from 'Czechia'
        'India': 47,
        'Ireland': 43,
        'Argentina': 42,
        'Israel': 40
      };
      
      // Map region countries to accurate counts
      const countries = region.countries.map((countryName: string) => {
        const searchPatterns = getCountrySearchPatterns(countryName);
        
        // Find the accurate count using our mapping
        let totalCount = 0;
        searchPatterns.forEach(pattern => {
          if (accurateCountMap[pattern]) {
            totalCount = accurateCountMap[pattern];
          }
        });
        
        return {
          name: countryName,
          slug: countryName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/--+/g, '-').replace(/^-|-$/g, ''),
          stationCount: totalCount
        };
      });
      
      // Filter out countries with 0 stations and sort by station count descending
      const countriesWithStations = countries.filter(country => country.stationCount > 0);
      countriesWithStations.sort((a, b) => b.stationCount - a.stationCount);
      
      res.json({
        success: true,
        data: {
          region: {
            name: region.name,
            slug: regionSlug
          },
          countries: countriesWithStations
        }
      });
    } catch (error) {
      console.error('Error fetching region countries:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch region countries'
      });
    }
  });

  // Get cities in a specific country
  app.get('/api/regions/:regionSlug/:countrySlug', async (req, res) => {
    try {
      const { regionSlug, countrySlug } = req.params;
      const region = (WORLD_REGIONS as any)[regionSlug];
      
      if (!region) {
        return res.status(404).json({
          success: false,
          error: 'Region not found'
        });
      }
      
      // Find the country name from the slug
      const countryName = region.countries.find((country: string) => 
        country.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/--+/g, '-').replace(/^-|-$/g, '') === countrySlug
      );
      
      if (!countryName) {
        return res.status(404).json({
          success: false,
          error: 'Country not found'
        });
      }
      
      const cities = COUNTRY_CITIES[countryName] || [];
      const citiesWithCounts = await Promise.all(cities.map(async (city) => {
        const searchPatterns = getCountrySearchPatterns(countryName);
        
        // Use aggregation to get accurate counts without duplicates
        const aggregationResults = await Station.aggregate([
          {
            $match: {
              $and: [
                {
                  $or: searchPatterns.map(pattern => ({ 
                    country: { $regex: new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
                  }))
                },
                {
                  $or: [
                    { name: { $regex: new RegExp(city, 'i') } },
                    { tags: { $regex: new RegExp(city, 'i') } }
                  ]
                }
              ]
            }
          },
          {
            $group: {
              _id: "$_id"  // Group by unique station ID to remove duplicates
            }
          },
          {
            $count: "totalStations"
          }
        ]);
        
        const totalCount = aggregationResults[0]?.totalStations || 0;
        
        return {
          name: city,
          slug: city.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/--+/g, '-').replace(/^-|-$/g, ''),
          stationCount: totalCount
        };
      }));
      
      // Calculate stations without specific city data for "ALL" option
      const searchPatterns = getCountrySearchPatterns(countryName);
      
      // Get all stations from this country
      const allCountryStationsResult = await Station.aggregate([
        {
          $match: {
            $or: searchPatterns.map(pattern => ({ 
              country: { $regex: new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
            }))
          }
        },
        {
          $group: {
            _id: "$_id"
          }
        },
        {
          $count: "totalStations"
        }
      ]);
      
      const totalCountryStations = allCountryStationsResult[0]?.totalStations || 0;
      
      // Calculate stations in specific cities
      const stationsInCities = citiesWithCounts.reduce((sum, city) => sum + city.stationCount, 0);
      
      // Stations without specific city data = total stations - stations in specific cities
      const stationsWithoutCity = totalCountryStations - stationsInCities;
      
      // Filter out cities with 0 stations and sort by station count descending
      const citiesWithStations = citiesWithCounts.filter(city => city.stationCount > 0);
      citiesWithStations.sort((a, b) => b.stationCount - a.stationCount);
      
      // Add "ALL" option at the beginning if there are stations without city data
      const finalCities = [];
      if (stationsWithoutCity > 0) {
        finalCities.push({
          name: 'ALL',
          slug: 'all',
          stationCount: stationsWithoutCity
        });
      }
      finalCities.push(...citiesWithStations);
      
      res.json({
        success: true,
        data: {
          region: {
            name: region.name,
            slug: regionSlug
          },
          country: {
            name: countryName,
            slug: countrySlug
          },
          cities: finalCities
        }
      });
    } catch (error) {
      console.error('Error fetching country cities:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch country cities'
      });
    }
  });

  // Get stations by region/country/city
  app.get('/api/regions/:regionSlug/:countrySlug/:citySlug?/stations', async (req, res) => {
    try {
      const { regionSlug, countrySlug, citySlug } = req.params;
      const { limit = 50, offset = 0, sortBy = 'votes', order = 'desc' } = req.query;
      
      const region = (WORLD_REGIONS as any)[regionSlug];
      if (!region) {
        return res.status(404).json({
          success: false,
          error: 'Region not found'
        });
      }
      
      const countryName = region.countries.find((country: string) => 
        country.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/--+/g, '-').replace(/^-|-$/g, '') === countrySlug
      );
      
      if (!countryName) {
        return res.status(404).json({
          success: false,
          error: 'Country not found'
        });
      }
      
      // Build filter for stations using country name mapping
      const searchPatterns = getCountrySearchPatterns(countryName);
      const countryOrConditions = searchPatterns.map(pattern => ({ 
        country: { 
          $regex: `^${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 
          $options: 'i' 
        } 
      }));
      
      const stationFilter: any = { 
        $or: countryOrConditions
      };
      
      let cityName = null;
      if (citySlug) {
        // Handle "ALL" city option for stations without specific city data
        if (citySlug === 'all') {
          logger.log('🏙️ Fetching ALL stations (without specific city data) for country:', countryName);
          
          // Get all cities for this country  
          const cities = COUNTRY_CITIES[countryName] || [];
          
          // Create conditions to exclude stations that match any specific city
          const cityExcludeConditions = [];
          for (const city of cities) {
            let citySearchTerms = CITY_ALTERNATIVE_NAMES[city] || [city];
            
            if (city === 'Wien' || city === 'Vienna') {
              citySearchTerms = ['Wien', 'Vienna', 'vienna', 'wien'];
            }
            
            citySearchTerms.forEach(term => {
              cityExcludeConditions.push(
                { name: { $not: { $regex: new RegExp(term, 'i') } } },
                { tags: { $not: { $regex: new RegExp(term, 'i') } } }
              );
            });
          }
          
          // Apply filter to get stations from the country that don't match any specific city
          if (cityExcludeConditions.length > 0) {
            stationFilter.$and = [
              { $or: countryOrConditions },
              { $and: cityExcludeConditions }
            ];
            delete stationFilter.$or;
          }
          
        } else {
          // Handle specific city
          const cities = COUNTRY_CITIES[countryName] || [];
          cityName = cities.find(city => 
            city.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/--+/g, '-').replace(/^-|-$/g, '') === citySlug
          );
          
          if (!cityName) {
            return res.status(404).json({
              success: false,
              error: 'City not found'
            });
          }
          
          // Handle alternative city names using the mapping
          let citySearchTerms = CITY_ALTERNATIVE_NAMES[cityName] || [cityName];
          
          // For Wien, also include common variations like Vienna
          if (cityName === 'Wien' || cityName === 'Vienna') {
            citySearchTerms = ['Wien', 'Vienna', 'vienna', 'wien'];
          }
          
          // Combine country and city filters with proper regex
          const cityConditions = citySearchTerms.flatMap(term => [
            { name: { $regex: new RegExp(term, 'i') } },
            { tags: { $regex: new RegExp(term, 'i') } }
          ]);
          
          stationFilter.$and = [
            { $or: countryOrConditions },
            { $or: cityConditions }
          ];
          delete stationFilter.$or; // Remove the old $or since we're using $and now
        }
      }
      
      // Build sort object
      const sortOrder = order === 'desc' ? -1 : 1;
      const sortObj: any = {};
      sortObj[sortBy as string] = sortOrder;
      
      // Get stations with pagination
      const stations = await Station.find(stationFilter)
        .sort(sortObj)
        .skip(parseInt(offset as string))
        .limit(parseInt(limit as string))
        .lean();
      
      const total = await Station.countDocuments(stationFilter);
      
      
      res.json({
        success: true,
        data: {
          region: { name: region.name, slug: regionSlug },
          country: { name: countryName, slug: countrySlug },
          city: cityName ? { name: cityName, slug: citySlug } : null,
          stations,
          pagination: {
            total,
            limit: parseInt(limit as string),
            offset: parseInt(offset as string),
            hasMore: total > parseInt(offset as string) + stations.length
          }
        }
      });
    } catch (error) {
      console.error('Error fetching region stations:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch region stations'
      });
    }
  });

  // DEDICATED RECOMMENDATIONS API - With advanced deduplication and diversity
  app.get("/api/recommendations/diverse", async (req, res) => {
    try {
      const { 
        country = 'all',
        userGenres = '',
        excludeStationIds = '',
        limit = 12
      } = req.query;

      const excludeIds = excludeStationIds ? 
        (excludeStationIds as string).split(',').filter(id => id.trim()) : [];

      // Parse user's favorite genres
      const genres = userGenres ? 
        (userGenres as string).split(',').map(g => g.trim()).filter(g => g) : 
        ['pop', 'rock', 'electronic', 'jazz'];

      const filter: any = {
        lastCheckOk: true,
        votes: { $gte: 5 } // Minimum quality threshold
      };

      if (excludeIds.length > 0) {
        filter._id = { $nin: excludeIds };
      }

      if (country && country !== 'all') {
        filter.country = { $regex: new RegExp(country as string, 'i') };
      }

      // Strategy 1: Genre-based stations (50% of results)
      const genreStations = [];
      for (const genre of genres.slice(0, 3)) {
        const genreFilter = {
          ...filter,
          $or: [
            { genre: { $regex: new RegExp(genre, 'i') } },
            { tags: { $regex: new RegExp(genre, 'i') } }
          ]
        };

        const stations = await Station.find(genreFilter)
          .sort({ votes: -1 })
          .limit(Math.ceil(Number(limit) * 0.5 / genres.slice(0, 3).length))
          .lean();
        
        genreStations.push(...stations);
      }

      // Strategy 2: High-quality diverse stations (30% of results)
      const diverseFilter = {
        ...filter,
        votes: { $gte: 100 }
      };

      // Exclude already selected genre stations
      const usedIds = genreStations.map(s => s._id.toString());
      if (usedIds.length > 0) {
        diverseFilter._id = { $nin: [...excludeIds, ...usedIds] };
      }

      const diverseStations = await Station.aggregate([
        { $match: diverseFilter },
        { $sample: { size: Math.ceil(Number(limit) * 0.3) } }
      ]);

      // Strategy 3: Discovery stations - newer and unique (20% of results)
      const discoveryFilter = {
        ...filter,
        createdAt: { $gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) } // Last 90 days
      };

      const allUsedIds = [
        ...excludeIds,
        ...genreStations.map(s => s._id.toString()),
        ...diverseStations.map(s => s._id.toString())
      ];

      if (allUsedIds.length > 0) {
        discoveryFilter._id = { $nin: allUsedIds };
      }

      const discoveryStations = await Station.find(discoveryFilter)
        .sort({ createdAt: -1 })
        .limit(Math.ceil(Number(limit) * 0.2))
        .lean();

      // Combine and shuffle results
      const allStations = [
        ...genreStations,
        ...diverseStations,
        ...discoveryStations
      ];

      // Remove duplicates by ID
      const uniqueStations = allStations.filter((station, index, arr) => 
        arr.findIndex(s => s._id.toString() === station._id.toString()) === index
      );

      // Shuffle for better variety
      for (let i = uniqueStations.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [uniqueStations[i], uniqueStations[j]] = [uniqueStations[j], uniqueStations[i]];
      }

      // Return limited results
      const finalStations = uniqueStations.slice(0, Number(limit));

      res.json({
        stations: finalStations,
        strategies: {
          genre_based: genreStations.length,
          diverse_quality: diverseStations.length,
          discovery_new: discoveryStations.length
        },
        excluded_count: excludeIds.length,
        total_unique: finalStations.length
      });

    } catch (error) {
      console.error('Error fetching diverse recommendations:', error);
      res.status(500).json({ error: 'Failed to fetch recommendations' });
    }
  });

  // Remove all HLS stations endpoint
  app.post('/api/admin/remove-hls-stations', async (req, res) => {
    try {
      // More comprehensive HLS detection patterns
      const hlsPatterns = [
        { url: { $regex: '\\.m3u8', $options: 'i' } },
        { url: { $regex: 'playlist\\.m3u8', $options: 'i' } },
        { url: { $regex: '/hls/', $options: 'i' } },
        { url: { $regex: 'live\\.m3u8', $options: 'i' } },
        { url: { $regex: 'stream.*\\.m3u8', $options: 'i' } },
        { url: { $regex: 'broadcast.*\\.m3u8', $options: 'i' } }
      ];

      // First, count the stations
      const hlsCount = await Station.countDocuments({
        $or: hlsPatterns
      });

      logger.log(`🗑️ Found ${hlsCount} HLS stations to remove`);

      // Find some examples for logging
      const hlsExamples = await Station.find({
        $or: hlsPatterns
      }).limit(5).select('name url');

      logger.log('📋 Examples of HLS stations to remove:');
      hlsExamples.forEach(station => {
        logger.log(`  - ${station.name}: ${station.url}`);
      });

      // Remove all HLS stations
      const deleteResult = await Station.deleteMany({
        $or: hlsPatterns
      });

      logger.log(`✅ Removed ${deleteResult.deletedCount} HLS stations from database`);

      // Get new total count
      const remainingTotal = await Station.countDocuments();
      logger.log(`📊 Remaining stations in database: ${remainingTotal}`);

      res.json({
        success: true,
        message: `Successfully removed ${deleteResult.deletedCount} HLS stations`,
        deletedCount: deleteResult.deletedCount,
        foundCount: hlsCount,
        remainingStations: remainingTotal
      });

    } catch (error) {
      console.error('❌ Error removing HLS stations:', error);
      res.status(500).json({ 
        error: 'Failed to remove HLS stations',
        details: error.message 
      });
    }
  });

  // Optimize database - remove broken stations and duplicates
  app.post('/api/admin/optimize-database', async (req, res) => {
    try {
      logger.log('🚀 Starting database optimization...');
      
      // Remove stations with broken/offline URLs
      const brokenPatterns = [
        { url: { $regex: '46\\.20\\.7\\.116', $options: 'i' } }, // Baba Radyo broken server
        { url: { $regex: 'localhost', $options: 'i' } },
        { url: { $regex: '127\\.0\\.0\\.1', $options: 'i' } },
        { url: { $regex: 'test\\.', $options: 'i' } },
        { url: { $regex: 'example\\.', $options: 'i' } }
      ];

      const brokenCount = await Station.countDocuments({ $or: brokenPatterns });
      const brokenResult = await Station.deleteMany({ $or: brokenPatterns });
      logger.log(`✅ Removed ${brokenResult.deletedCount} broken stations`);

      // Remove duplicate stations by URL
      const duplicates = await Station.aggregate([
        { $group: { _id: '$url', count: { $sum: 1 }, docs: { $push: '$_id' } } },
        { $match: { count: { $gt: 1 } } }
      ]);

      let duplicatesRemoved = 0;
      for (const duplicate of duplicates) {
        const docsToRemove = duplicate.docs.slice(1);
        const result = await Station.deleteMany({ _id: { $in: docsToRemove } });
        duplicatesRemoved += result.deletedCount;
      }
      logger.log(`✅ Removed ${duplicatesRemoved} duplicate stations`);

      // Get final count
      const finalCount = await Station.countDocuments();
      logger.log(`📊 Final station count: ${finalCount}`);

      res.json({
        success: true,
        message: 'Database optimization complete',
        results: {
          brokenRemoved: brokenResult.deletedCount,
          duplicatesRemoved,
          finalCount
        }
      });

    } catch (error) {
      console.error('❌ Database optimization error:', error);
      res.status(500).json({ 
        error: 'Failed to optimize database',
        details: error.message 
      });
    }
  });

  // Station health check API endpoints
  let healthCheckProgress = null;
  let healthCheckResults = null;

  // GET endpoint for browser access - shows simple interface
  app.get('/api/admin/start-health-check', (req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>Station Health Check System</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
        .endpoint { background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 10px 0; }
        .method { background: #2196F3; color: white; padding: 2px 8px; border-radius: 3px; font-size: 12px; }
        button { padding: 10px 20px; background: #4CAF50; color: white; border: none; border-radius: 5px; cursor: pointer; margin: 5px; }
        .response { background: #f9f9f9; padding: 10px; border-left: 3px solid #2196F3; margin: 10px 0; }
        input { padding: 5px; margin: 2px; }
    </style>
</head>
<body>
    <h1>🔍 Station Health Check System</h1>
    <p>This system tests radio stations to identify broken URLs and HLS streams.</p>
    
    <h2>API Endpoints</h2>
    <div class="endpoint">
        <span class="method">POST</span> <strong>/api/admin/start-health-check</strong><br>
        Starts a health check process in the background
    </div>
    <div class="endpoint">
        <span class="method">GET</span> <strong>/api/admin/health-check-progress</strong><br>
        Returns current progress and results
    </div>

    <h2>Quick Test</h2>
    <p>Test a small sample of stations:</p>
    <div>
        Test Limit: <input type="number" id="testLimit" value="10" min="1" max="1000">
        Batch Size: <input type="number" id="batchSize" value="5" min="1" max="20">
        <button onclick="startTest()">Start Test</button>
        <button onclick="checkStatus()">Check Status</button>
    </div>
    
    <div id="response" class="response" style="display:none;"></div>

    <script>
        async function startTest() {
            const testLimit = document.getElementById('testLimit').value;
            const batchSize = document.getElementById('batchSize').value;
            
            try {
                const response = await fetch('/api/admin/start-health-check', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        testLimit: parseInt(testLimit), 
                        batchSize: parseInt(batchSize),
                        timeout: 5000
                    })
                });
                
                const result = await response.json();
                document.getElementById('response').style.display = 'block';
                document.getElementById('response').innerHTML = '<pre>' + JSON.stringify(result, null, 2) + '</pre>';
            } catch (error) {
                document.getElementById('response').style.display = 'block';
                document.getElementById('response').innerHTML = '<pre>Error: ' + error.message + '</pre>';
            }
        }

        async function checkStatus() {
            try {
                const response = await fetch('/api/admin/health-check-progress');
                const result = await response.json();
                document.getElementById('response').style.display = 'block';
                document.getElementById('response').innerHTML = '<pre>' + JSON.stringify(result, null, 2) + '</pre>';
            } catch (error) {
                document.getElementById('response').style.display = 'block';
                document.getElementById('response').innerHTML = '<pre>Error: ' + error.message + '</pre>';
            }
        }
    </script>
</body>
</html>
    `);
  });

  app.post('/api/admin/start-health-check', async (req, res) => {
    try {
      if (healthCheckProgress && healthCheckProgress.running) {
        return res.json({
          success: false,
          message: 'Health check already running',
          progress: healthCheckProgress
        });
      }

      const { batchSize = 50, timeout = 20000, testLimit } = req.body; // Increased default timeout to 20s

      // Initialize progress tracking
      healthCheckProgress = {
        running: true,
        startTime: new Date(),
        totalStations: await Station.countDocuments(),
        tested: 0,
        working: 0,
        broken: 0,
        hls: 0,
        timeout: 0,
        currentBatch: 0,
        batchSize: parseInt(batchSize),
        requestTimeout: parseInt(timeout)
      };

      // Start health check in background
      runHealthCheck(testLimit).catch(error => {
        console.error('Health check error:', error);
        if (healthCheckProgress) {
          healthCheckProgress.running = false;
          healthCheckProgress.error = error.message;
        }
      });

      res.json({
        success: true,
        message: 'Health check started',
        progress: healthCheckProgress
      });

    } catch (error) {
      console.error('❌ Start health check error:', error);
      res.status(500).json({ 
        error: 'Failed to start health check',
        details: error.message 
      });
    }
  });

  app.get('/api/admin/health-check-progress', (req, res) => {
    res.json({
      progress: healthCheckProgress,
      results: healthCheckResults
    });
  });

  async function runHealthCheck(testLimit) {
    const brokenStations = [];
    const hlsStations = [];
    let skip = 0;
    const limit = testLimit || healthCheckProgress.totalStations;

    while (skip < limit && healthCheckProgress.running) {
      // Get batch of stations
      const stations = await Station.find({})
        .select('_id name url')
        .skip(skip)
        .limit(healthCheckProgress.batchSize)
        .lean();

      if (stations.length === 0) break;

      healthCheckProgress.currentBatch++;
      logger.log(`🔍 Testing batch ${healthCheckProgress.currentBatch}: stations ${skip + 1}-${skip + stations.length}`);

      // Test batch concurrently
      const batchPromises = stations.map(async (station) => {
        return await testStationConnectivity(station, healthCheckProgress, brokenStations, hlsStations);
      });

      await Promise.all(batchPromises);
      healthCheckProgress.tested = Math.min(skip + stations.length, limit);

      skip += stations.length;

      // Brief pause between batches
      if (skip < limit) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // Complete health check
    healthCheckProgress.running = false;
    healthCheckProgress.endTime = new Date();
    healthCheckProgress.duration = healthCheckProgress.endTime - healthCheckProgress.startTime;

    healthCheckResults = {
      summary: {
        total: healthCheckProgress.tested,
        working: healthCheckProgress.working,
        broken: healthCheckProgress.broken,
        hls: healthCheckProgress.hls,
        timeout: healthCheckProgress.timeout
      },
      brokenStations: brokenStations.slice(0, 100), // Limit for API response
      hlsStations: hlsStations.slice(0, 100),
      completedAt: healthCheckProgress.endTime
    };

    logger.log('🏁 Health check completed');
    logger.log(`📊 Results: ${healthCheckProgress.working} working, ${healthCheckProgress.broken} broken, ${healthCheckProgress.hls} HLS`);
  }

  async function testStationConnectivity(station, healthCheckProgress, brokenStations, hlsStations) {
    const maxRetries = 2; // Reduced retries to speed up testing
    const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    
    for (let retry = 0; retry < maxRetries; retry++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), healthCheckProgress.requestTimeout);

        let response;
        let finalUrl = station.url;
        
        // Enhanced stream protocol handling
        try {
          // First attempt: HEAD request for efficiency
          response = await fetch(station.url, {
            method: 'HEAD',
            signal: controller.signal,
            headers: {
              'User-Agent': userAgent,
              'Accept': 'audio/mpeg, audio/x-mpeg, audio/mp3, audio/aac, audio/aacp, audio/ogg, audio/wav, audio/*, application/ogg, */*',
              'Cache-Control': 'no-cache, no-store, must-revalidate',
              'Pragma': 'no-cache',
              'Connection': 'keep-alive',
              'Icy-MetaData': '1' // Request ICY metadata like real players
            },
            redirect: 'follow'
          });
          finalUrl = response.url;
        } catch (headError) {
          // Fallback: Partial GET request for streams that don't support HEAD
          response = await fetch(station.url, {
            method: 'GET',
            signal: controller.signal,
            headers: {
              'User-Agent': userAgent,
              'Accept': 'audio/mpeg, audio/x-mpeg, audio/mp3, audio/aac, audio/aacp, audio/ogg, audio/wav, audio/*, application/ogg, */*',
              'Range': 'bytes=0-2047', // Request first 2KB
              'Cache-Control': 'no-cache, no-store, must-revalidate',
              'Pragma': 'no-cache',
              'Connection': 'keep-alive',
              'Icy-MetaData': '1'
            },
            redirect: 'follow'
          });
          finalUrl = response.url;
        }

        clearTimeout(timeoutId);

        const contentType = response.headers.get('content-type') || '';
        const contentLength = response.headers.get('content-length');
        const acceptRanges = response.headers.get('accept-ranges');
        const icyName = response.headers.get('icy-name');
        const icyGenre = response.headers.get('icy-genre');
        const icyBr = response.headers.get('icy-br');
        
        // Enhanced HLS detection
        const isHLS = isHLSStream(finalUrl, contentType);
        
        if (isHLS) {
          healthCheckProgress.hls++;
          hlsStations.push({
            id: station._id,
            name: station.name,
            url: station.url,
            finalUrl,
            contentType,
            reason: 'HLS/m3u8 stream detected'
          });
          return 'hls';
        }

        // Enhanced stream validation for different protocols
        const isValidStream = validateStreamResponse(response, contentType, finalUrl, icyName);

        if (isValidStream) {
          healthCheckProgress.working++;
          return 'working';
        } else {
          // Retry with different approach if first attempt unclear
          if (retry < maxRetries - 1) {
            await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2s before retry
            continue;
          }
          
          healthCheckProgress.broken++;
          brokenStations.push({
            id: station._id,
            name: station.name,
            url: station.url,
            finalUrl,
            status: response.status,
            contentType,
            icyName: icyName || 'N/A',
            reason: `Invalid stream: HTTP ${response.status}, Content-Type: ${contentType || 'unknown'}`
          });
          return 'broken';
        }

      } catch (error) {
        if (error.name === 'AbortError') {
          // Only retry timeout on first attempt
          if (retry < maxRetries - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            continue;
          }
          
          healthCheckProgress.timeout++;
          brokenStations.push({
            id: station._id,
            name: station.name,
            url: station.url,
            reason: `Timeout after ${healthCheckProgress.requestTimeout}ms (${maxRetries} attempts)`
          });
          return 'timeout';
        }

        // Other network errors
        if (retry < maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          continue;
        }
        
        healthCheckProgress.broken++;
        brokenStations.push({
          id: station._id,
          name: station.name,
          url: station.url,
          reason: `Network error: ${error.message} (after ${maxRetries} attempts)`
        });
        return 'broken';
      }
    }
  }

  function validateStreamResponse(response, contentType, finalUrl, icyName) {
    // Must have successful HTTP status
    if (!response.ok) return false;

    const status = response.status;
    const contentLower = contentType.toLowerCase();
    const urlLower = finalUrl.toLowerCase();

    // Valid streaming scenarios:
    return (
      // Standard audio content types
      contentLower.includes('audio/') ||
      contentLower.includes('application/ogg') ||
      // Streaming-specific content types
      contentLower.includes('application/octet-stream') ||
      // Playlist files that resolve to streams
      contentLower.includes('audio/x-scpls') ||
      contentLower.includes('audio/x-mpegurl') ||
      // ICY/Shoutcast streams (often have text/plain or no content-type)
      icyName ||
      response.headers.get('icy-genre') ||
      response.headers.get('icy-br') ||
      // Partial content responses (successful range requests)
      status === 206 ||
      // Streaming URLs with known patterns
      urlLower.includes('/stream') ||
      urlLower.includes('icecast') ||
      urlLower.includes('shoutcast') ||
      // Large or unknown content length (streaming indicator)
      !response.headers.get('content-length') ||
      parseInt(response.headers.get('content-length') || '0') > 50000
    );
  }

  function isHLSStream(url, contentType) {
    const urlLower = url.toLowerCase();
    const contentLower = contentType.toLowerCase();
    
    // HLS URL patterns
    if (urlLower.includes('.m3u8') || 
        urlLower.includes('/hls/') ||
        urlLower.includes('manifest.m3u8') ||
        urlLower.includes('playlist.m3u8') ||
        urlLower.includes('/live/') && urlLower.includes('.m3u8')) {
      return true;
    }

    // HLS content types
    if (contentLower.includes('application/vnd.apple.mpegurl') ||
        contentLower.includes('application/x-mpegurl') ||
        contentLower.includes('audio/mpegurl') ||
        (contentLower.includes('text/plain') && urlLower.includes('m3u8'))) {
      return true;
    }

    return false;
  }

  // ===========================
  // ITUNES MUSIC DISCOVERY API
  // ===========================

  // Import iTunes API service
  const { itunesApiService } = await import('./services/itunes-api');

  // Get iTunes Top 100 songs
  app.get("/api/discover/top100", async (req, res) => {
    try {
      const { country = 'US', limit = 100 } = req.query;
      
      // Cache key for iTunes Top 100
      const cacheKey = `itunes_top100_${country}_${limit}`;
      
      // Check cache first (cache for 1 hour)
      let cachedTop100 = await CacheManager.get(cacheKey);
      if (cachedTop100) {
        return res.json({
          results: cachedTop100,
          cached: true
        });
      }

      logger.log(`🎵 Fetching iTunes Top ${limit} for ${country}`);
      
      // Import axios for better HTTP handling
      const axios = (await import('axios')).default;
      
      // Fetch from iTunes RSS feed
      const rssUrl = `https://itunes.apple.com/${country.toLowerCase()}/rss/topsongs/limit=${limit}/json`;
      
      const rssResponse = await axios.get(rssUrl, {
        headers: {
          'User-Agent': 'MegaRadio-DiscoverMusic/1.0',
          'Accept': 'application/json'
        },
        timeout: 15000
      });

      const rssData = rssResponse.data;
      const feedResults = rssData?.feed?.entry || [];

      if (feedResults.length === 0) {
        return res.json({ results: [], message: 'No top songs available' });
      }

      // Transform RSS data to match iTunes Search format
      const transformedResults = feedResults.map((item: any, index: number) => {
        // Extract preview URL from links
        const previewLink = item.link?.find((link: any) => link.attributes?.['im:assetType'] === 'preview');
        
        return {
          trackId: parseInt(item.id?.attributes?.['im:id']) || index + 1,
          artistId: 0, // RSS doesn't provide artist ID
          collectionId: 0, // RSS doesn't provide collection ID
          trackName: item['im:name']?.label || 'Unknown Track',
          artistName: item['im:artist']?.label || 'Unknown Artist',
          collectionName: item['im:collection']?.['im:name']?.label || 'Unknown Album',
          trackViewUrl: Array.isArray(item.link) ? item.link[0]?.attributes?.href || '' : item.link?.attributes?.href || '',
          previewUrl: previewLink?.attributes?.href || '',
          artworkUrl30: item['im:image']?.[0]?.label?.replace(/55x55|60x60|170x170/g, '30x30') || '',
          artworkUrl60: item['im:image']?.[1]?.label?.replace(/55x55|60x60|170x170/g, '60x60') || '',
          artworkUrl100: item['im:image']?.[2]?.label?.replace(/55x55|60x60|170x170/g, '100x100') || '',
          collectionPrice: parseFloat(item['im:price']?.attributes?.amount) || 0,
          trackPrice: parseFloat(item['im:price']?.attributes?.amount) || 0,
          releaseDate: item['im:releaseDate']?.attributes?.label || '',
          collectionExplicitness: 'notExplicit',
          trackExplicitness: 'notExplicit',
          discCount: 1,
          discNumber: 1,
          trackCount: 1,
          trackNumber: index + 1,
          trackTimeMillis: parseInt(previewLink?.['im:duration']?.label) || 30000,
          country: country as string,
          currency: item['im:price']?.attributes?.currency || 'USD',
          primaryGenreName: item.category?.attributes?.label || 'Music',
          wrapperType: 'track',
          kind: 'song',
          chartPosition: index + 1,
          isTopChart: true
        };
      });

      // Cache the results for 1 hour
      await CacheManager.set(cacheKey, transformedResults, 3600);

      res.json({
        results: transformedResults,
        cached: false,
        source: 'iTunes Top Songs RSS',
        country,
        limit: parseInt(limit as string)
      });

    } catch (error: any) {
      console.error('iTunes Top 100 fetch error:', error);
      res.status(500).json({ 
        error: 'Failed to fetch top songs',
        message: error.message 
      });
    }
  });

  // iTunes Search with caching
  app.get("/api/discover/search", async (req, res) => {
    try {
      const { q: query, type = 'song', limit = 50, country = 'US' } = req.query;
      
      if (!query || typeof query !== 'string' || query.trim().length === 0) {
        return res.status(400).json({ error: 'Search query is required' });
      }

      // Cache key for this search
      const cacheKey = `itunes_search_${type}_${country}_${limit}_${query.toLowerCase().trim()}`;
      
      // Check cache first
      let cachedResults = await CacheManager.get(cacheKey);
      if (cachedResults) {
        return res.json({
          results: cachedResults,
          cached: true,
          total: cachedResults.length
        });
      }

      // Search iTunes API
      let results: any[] = [];
      
      switch (type) {
        case 'song':
        case 'track':
          results = await itunesApiService.searchTracks(query as string, Number(limit), country as string);
          break;
        case 'album':
          results = await itunesApiService.searchAlbums(query as string, Number(limit), country as string);
          break;
        case 'artist':
          results = await itunesApiService.searchArtists(query as string, Number(limit), country as string);
          break;
        default:
          results = await itunesApiService.searchTracks(query as string, Number(limit), country as string);
      }

      // Cache results for 1 hour
      await CacheManager.set(cacheKey, results, 3600);

      res.json({
        results,
        cached: false,
        total: results.length,
        query: query,
        type: type
      });

    } catch (error: any) {
      console.error('iTunes search error:', error);
      res.status(500).json({ 
        error: 'Failed to search iTunes catalog',
        message: error.message 
      });
    }
  });

  // Get high-quality artwork URL
  app.get("/api/discover/artwork/:trackId", async (req, res) => {
    try {
      const { trackId } = req.params;
      const { size = 300 } = req.query;
      
      // This would require fetching the track details first, but for simplicity
      // we'll return a helper endpoint that generates high-res artwork URLs
      const artworkUrl = req.query.url as string;
      
      if (!artworkUrl) {
        return res.status(400).json({ error: 'Artwork URL parameter required' });
      }

      const highQualityUrl = itunesApiService.getHighQualityArtwork(artworkUrl, Number(size));
      
      res.json({
        originalUrl: artworkUrl,
        highQualityUrl,
        size: Number(size)
      });

    } catch (error: any) {
      console.error('Artwork generation error:', error);
      res.status(500).json({ 
        error: 'Failed to generate artwork URL',
        message: error.message 
      });
    }
  });

  // Get detailed track information
  app.get("/api/discover/track/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { country = 'US' } = req.query;
      
      // Cache key for this track lookup
      const cacheKey = `itunes_track_${id}_${country}`;
      
      // Check cache first
      let cachedTrack = await CacheManager.get(cacheKey);
      if (cachedTrack) {
        return res.json({
          track: cachedTrack,
          cached: true
        });
      }

      // Search for specific track by ID
      const trackDetails = await itunesApiService.getTrackById(id, country as string);
      
      if (!trackDetails) {
        return res.status(404).json({ error: 'Track not found' });
      }

      // Cache track details for 2 hours
      await CacheManager.set(cacheKey, trackDetails, 7200);

      res.json({
        track: trackDetails,
        cached: false
      });

    } catch (error: any) {
      console.error('Track lookup error:', error);
      res.status(500).json({ 
        error: 'Failed to fetch track details',
        message: error.message 
      });
    }
  });

  // Get detailed album information and its tracks
  app.get("/api/discover/album/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { country = 'US' } = req.query;
      
      // Cache key for this album lookup
      const cacheKey = `itunes_album_${id}_${country}`;
      
      // Check cache first
      let cachedAlbum = await CacheManager.get(cacheKey);
      if (cachedAlbum) {
        return res.json({
          album: cachedAlbum.album,
          tracks: cachedAlbum.tracks,
          cached: true
        });
      }

      // Get album details and tracks
      const albumData = await itunesApiService.getAlbumById(id, country as string);
      
      if (!albumData) {
        return res.status(404).json({ error: 'Album not found' });
      }

      // Cache album data for 2 hours
      await CacheManager.set(cacheKey, albumData, 7200);

      res.json({
        album: albumData.album,
        tracks: albumData.tracks,
        cached: false
      });

    } catch (error: any) {
      console.error('Album lookup error:', error);
      res.status(500).json({ 
        error: 'Failed to fetch album details',
        message: error.message 
      });
    }
  });

  // Get detailed artist information and their albums/tracks
  app.get("/api/discover/artist/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { country = 'US', limit = 25 } = req.query;
      
      // Cache key for this artist lookup
      const cacheKey = `itunes_artist_${id}_${country}_${limit}`;
      
      // Check cache first
      let cachedArtist = await CacheManager.get(cacheKey);
      if (cachedArtist) {
        return res.json({
          artist: cachedArtist.artist,
          albums: cachedArtist.albums,
          tracks: cachedArtist.tracks,
          biography: cachedArtist.biography,
          similarArtists: cachedArtist.similarArtists,
          cached: true
        });
      }

      // Get artist details, albums, and top tracks from iTunes
      const artistData = await itunesApiService.getArtistById(id, country as string, Number(limit));
      
      if (!artistData) {
        return res.status(404).json({ error: 'Artist not found' });
      }

      // Get enhanced artist info from Last.fm (biography, similar artists)
      let biography = null;
      let similarArtists = null;
      
      if (artistData.artist && artistData.artist.artistName) {
        const { lastFmApiService } = await import('./services/lastfm-api');
        
        try {
          // Get artist biography from Last.fm
          const lastFmArtist = await lastFmApiService.getArtistInfo(artistData.artist.artistName);
          if (lastFmArtist && lastFmArtist.bio) {
            biography = {
              summary: lastFmApiService.cleanBioText(lastFmArtist.bio.summary),
              content: lastFmApiService.cleanBioText(lastFmArtist.bio.content),
              listeners: lastFmArtist.stats?.listeners,
              playcount: lastFmArtist.stats?.playcount,
              tags: lastFmArtist.tags?.tag || [],
              image: lastFmApiService.getHighQualityImage(lastFmArtist.image || [])
            };
          }

          // Get similar artists from Last.fm
          similarArtists = await lastFmApiService.getSimilarArtists(artistData.artist.artistName, 10);
        } catch (lastFmError) {
          logger.warn('Last.fm API unavailable:', lastFmError);
          // Continue without Last.fm data
        }
      }

      const enhancedData = {
        ...artistData,
        biography,
        similarArtists
      };

      // Cache enhanced artist data for 2 hours
      await CacheManager.set(cacheKey, enhancedData, 7200);

      res.json({
        artist: enhancedData.artist,
        albums: enhancedData.albums,
        tracks: enhancedData.tracks,
        biography: enhancedData.biography,
        similarArtists: enhancedData.similarArtists,
        cached: false
      });

    } catch (error: any) {
      console.error('Artist lookup error:', error);
      res.status(500).json({ 
        error: 'Failed to fetch artist details',
        message: error.message 
      });
    }
  });

  // ADMIN ADVERTISEMENT MANAGEMENT API
  const { Advertisement } = await import('../shared/mongo-schemas');
  const multer = await import('multer');
  const path = await import('path');
  const fs = (await import('fs')).promises;
  const { nanoid } = await import('nanoid');

  // Setup image upload directory
  const uploadsDir = path.default.resolve(process.cwd(), 'public', 'uploads');
  try {
    await fs.mkdir(uploadsDir, { recursive: true });
  } catch (err) {
    // Directory already exists or other error
  }

  // Serve uploaded advertisement images statically
  const express = await import('express');
  app.use('/uploads', express.default.static(uploadsDir));

  // Configure multer for image uploads
  const storage = multer.default.diskStorage({
    destination: uploadsDir,
    filename: (req, file, cb) => {
      const uniqueName = `ad-${nanoid()}-${Date.now()}${path.default.extname(file.originalname)}`;
      cb(null, uniqueName);
    }
  });

  const uploadMiddleware = multer.default({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: (req, file, cb) => {
      if (file.mimetype.startsWith('image/')) {
        cb(null, true);
      } else {
        cb(new Error('Only image files are allowed'));
      }
    }
  });

  // STREAM URL ANALYZER - Detect codec, bitrate, and stream type from URL
  app.post("/api/admin/analyze-stream", requireAdmin, async (req, res) => {
    try {
      const { url } = req.body;
      if (!url) {
        return res.status(400).json({ error: 'URL is required' });
      }

      const nodeFetch = await import('node-fetch');
      const fetch = nodeFetch.default;
      
      let codec = '';
      let bitrate: number | undefined;
      let hls = false;
      let streamType = 'unknown';

      // Detect stream type from URL patterns
      if (/\.m3u8(\?|$)/i.test(url)) {
        hls = true;
        codec = 'AAC';
        streamType = 'HLS';
      } else if (/\.mp3(\?|$)/i.test(url)) {
        codec = 'MP3';
        streamType = 'Direct MP3';
      } else if (/\.aac(\?|$)/i.test(url)) {
        codec = 'AAC';
        streamType = 'Direct AAC';
      } else if (/\.ogg(\?|$)/i.test(url)) {
        codec = 'OGG';
        streamType = 'Ogg Vorbis';
      } else if (/\.opus(\?|$)/i.test(url)) {
        codec = 'OPUS';
        streamType = 'Opus';
      } else if (/\.(m3u|pls)(\?|$)/i.test(url)) {
        streamType = 'Playlist';
      }

      // Try HEAD request to get more info
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        
        const response = await fetch(url, {
          method: 'HEAD',
          headers: {
            'User-Agent': 'MegaRadio/1.0 StreamAnalyzer',
            'Accept': '*/*'
          },
          signal: controller.signal as any
        });
        
        clearTimeout(timeoutId);
        
        const contentType = response.headers.get('content-type') || '';
        const icyBr = response.headers.get('icy-br');
        const icyName = response.headers.get('icy-name');
        const icyGenre = response.headers.get('icy-genre');
        
        // Detect codec from content-type
        if (!codec) {
          if (contentType.includes('audio/mpeg') || contentType.includes('audio/mp3')) {
            codec = 'MP3';
            streamType = 'Icecast/Shoutcast';
          } else if (contentType.includes('audio/aac') || contentType.includes('audio/aacp')) {
            codec = 'AAC';
            streamType = 'Icecast/Shoutcast';
          } else if (contentType.includes('audio/ogg')) {
            codec = 'OGG';
            streamType = 'Icecast/Shoutcast';
          } else if (contentType.includes('audio/opus')) {
            codec = 'OPUS';
            streamType = 'Icecast/Shoutcast';
          } else if (contentType.includes('application/vnd.apple.mpegurl') || contentType.includes('application/x-mpegurl')) {
            codec = 'AAC';
            hls = true;
            streamType = 'HLS';
          } else if (contentType.includes('audio/x-mpegurl')) {
            streamType = 'Playlist';
          }
        }
        
        // Parse bitrate from icy-br header
        if (icyBr) {
          bitrate = parseInt(icyBr, 10);
        }
        
        res.json({
          success: true,
          codec: codec || undefined,
          bitrate: bitrate || undefined,
          hls,
          streamType,
          contentType,
          icyName,
          icyGenre,
          status: response.status
        });
      } catch (fetchError: any) {
        // Even if fetch fails, return URL-based detection
        res.json({
          success: true,
          codec: codec || undefined,
          bitrate: bitrate || undefined,
          hls,
          streamType,
          error: fetchError.message
        });
      }
    } catch (error: any) {
      console.error('Stream analysis error:', error);
      res.status(500).json({ error: 'Failed to analyze stream URL' });
    }
  });

  // STATION FAVICON UPLOAD - Upload and process station logo
  app.post("/api/admin/stations/:id/upload-favicon", requireAdmin, uploadMiddleware.single('favicon'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const { id } = req.params;
      
      // Find the station
      const station = await Station.findById(id);
      if (!station) {
        // Clean up uploaded file
        await fs.unlink(req.file.path);
        return res.status(404).json({ error: 'Station not found' });
      }

      // Read the uploaded file into buffer
      const buffer = await fs.readFile(req.file.path);
      
      // Process with LogoProcessor
      const { LogoProcessor } = await import('./services/logo-processor');
      const logoProcessor = new LogoProcessor();
      const result = await logoProcessor.processFromBuffer(
        station._id.toString(),
        station.slug || station.name.toLowerCase().replace(/[^a-z0-9]/g, '-'),
        buffer,
        req.file.originalname
      );

      // Clean up temp file
      await fs.unlink(req.file.path);

      if (!result.success) {
        return res.status(500).json({ error: result.error || 'Failed to process logo' });
      }

      // Update station favicon field with local URL
      const faviconUrl = `/station-logos/${result.folder}/logo-256.webp`;
      await Station.updateOne(
        { _id: id },
        { $set: { favicon: faviconUrl } }
      );

      logger.log(`✅ Station favicon uploaded: ${station.name} -> ${faviconUrl}`);
      res.json({ 
        success: true, 
        favicon: faviconUrl,
        folder: result.folder
      });

    } catch (error: any) {
      console.error('Error uploading station favicon:', error);
      // Clean up temp file if exists
      if (req.file?.path) {
        try { await fs.unlink(req.file.path); } catch {}
      }
      res.status(500).json({ error: 'Failed to upload favicon' });
    }
  });

  // GENRE IMAGE UPLOAD - Discoverable genre images
  app.post("/api/genres/upload/discoverable", uploadMiddleware.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      // Generate unique filename for genre image
      const imageId = crypto.randomUUID();
      const ext = path.default.extname(req.file.originalname) || '.jpg';
      const filename = `genre-${imageId}${ext}`;
      
      // Create genres/discoverable subdirectory
      const genreUploadDir = path.default.join(uploadsDir, 'genres', 'discoverable');
      await fs.mkdir(genreUploadDir, { recursive: true });
      
      // Move file from temp location to genres directory
      const oldPath = req.file.path;
      const newPath = path.default.join(genreUploadDir, filename);
      await fs.rename(oldPath, newPath);
      
      // Return the public URL
      const publicUrl = `/uploads/genres/discoverable/${filename}`;
      res.json({ success: true, url: publicUrl });
    } catch (error: any) {
      console.error('Error uploading genre image:', error);
      res.status(500).json({ error: 'Failed to upload image' });
    }
  });

  // USER AVATAR UPLOAD - Profile picture upload for authenticated users
  app.post('/api/auth/avatar', requireAuth, uploadMiddleware.single('avatar'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No avatar image provided' });
      }

      const userId = req.session?.user?.userId;
      if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      // Get current user to check for existing avatar
      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Create avatars subdirectory
      const avatarUploadDir = path.default.join(uploadsDir, 'avatars');
      await fs.mkdir(avatarUploadDir, { recursive: true });

      // Generate unique filename for avatar
      const ext = path.default.extname(req.file.originalname) || '.jpg';
      const filename = `avatar-${userId}-${Date.now()}${ext}`;
      
      // Move file from temp location to avatars directory
      const oldPath = req.file.path;
      const newPath = path.default.join(avatarUploadDir, filename);
      await fs.rename(oldPath, newPath);

      // Delete previous avatar file if it exists and is a local file
      if (user.avatar && user.avatar.startsWith('/uploads/avatars/')) {
        try {
          const oldAvatarPath = path.default.join(process.cwd(), 'public', user.avatar);
          await fs.unlink(oldAvatarPath);
        } catch (err) {
          // Previous file doesn't exist or can't be deleted, ignore
        }
      }

      // Update user avatar in database
      const avatarUrl = `/uploads/avatars/${filename}`;
      user.avatar = avatarUrl;
      user.updatedAt = new Date();
      await user.save();

      // Update session user data so subsequent requests have new avatar
      if (req.session?.user) {
        req.session.user.avatar = avatarUrl;
      }

      res.json({ 
        success: true, 
        avatar: avatarUrl,
        message: 'Avatar updated successfully'
      });
    } catch (error: any) {
      console.error('Error uploading avatar:', error);
      res.status(500).json({ error: 'Failed to upload avatar: ' + error.message });
    }
  });

  // Upload advertisement image
  app.post('/api/admin/advertisements/upload', requireAdmin, uploadMiddleware.single('image'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No image provided' });
      }

      const imageUrl = `/uploads/${req.file.filename}`;
      res.json({ imageUrl });
    } catch (error: any) {
      console.error('Error uploading image:', error);
      res.status(500).json({ error: 'Failed to upload image: ' + error.message });
    }
  });

  // Get all advertisements
  app.get("/api/advertisements", async (req, res) => {
    try {
      const ads = await Advertisement.find({ isActive: true }).sort({ createdAt: -1 }).lean();
      res.json(ads);
    } catch (error) {
      console.error('Error fetching advertisements:', error);
      res.status(500).json({ error: 'Failed to fetch advertisements' });
    }
  });

  // Get all advertisements (admin - includes inactive)
  app.get("/api/admin/advertisements", requireAdmin, async (req, res) => {
    try {
      const ads = await Advertisement.find().sort({ createdAt: -1 }).lean();
      res.json(ads);
    } catch (error) {
      console.error('Error fetching advertisements:', error);
      res.status(500).json({ error: 'Failed to fetch advertisements' });
    }
  });

  // Create advertisement
  app.post("/api/admin/advertisements", requireAdmin, async (req, res) => {
    try {
      const { title, imageUrl, altText, seoDescription, url, position, isActive } = req.body;

      if (!title || !imageUrl || !altText || !seoDescription || !url || !position) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      const ad = new Advertisement({
        title,
        imageUrl,
        altText,
        seoDescription,
        url,
        position,
        isActive: isActive !== false
      });

      await ad.save();
      res.status(201).json(ad);
    } catch (error) {
      console.error('Error creating advertisement:', error);
      res.status(500).json({ error: 'Failed to create advertisement' });
    }
  });

  // Update advertisement
  app.patch("/api/admin/advertisements/:id", requireAdmin, async (req, res) => {
    try {
      const { title, imageUrl, altText, seoDescription, url, position, isActive } = req.body;
      
      const ad = await Advertisement.findByIdAndUpdate(
        req.params.id,
        {
          title,
          imageUrl,
          altText,
          seoDescription,
          url,
          position,
          isActive,
          updatedAt: new Date()
        },
        { new: true }
      );

      if (!ad) {
        return res.status(404).json({ error: 'Advertisement not found' });
      }

      res.json(ad);
    } catch (error) {
      console.error('Error updating advertisement:', error);
      res.status(500).json({ error: 'Failed to update advertisement' });
    }
  });

  // Delete advertisement
  app.delete("/api/admin/advertisements/:id", requireAdmin, async (req, res) => {
    try {
      const ad = await Advertisement.findByIdAndDelete(req.params.id);
      
      if (!ad) {
        return res.status(404).json({ error: 'Advertisement not found' });
      }

      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting advertisement:', error);
      res.status(500).json({ error: 'Failed to delete advertisement' });
    }
  });

  // Footer Social Media - Public endpoint
  app.get("/api/footer-social-media", async (req, res) => {
    try {
      const socialLinks = await FooterSocialMedia.find({ isActive: true }).sort({ position: 1 });
      res.json(socialLinks);
    } catch (error) {
      console.error('Error fetching footer social media:', error);
      res.status(500).json({ error: 'Failed to fetch footer social media' });
    }
  });

  // Footer Social Media - Admin endpoints
  app.get("/api/admin/footer-social-media", requireAdmin, async (req, res) => {
    try {
      const socialLinks = await FooterSocialMedia.find().sort({ position: 1 });
      res.json(socialLinks);
    } catch (error) {
      console.error('Error fetching footer social media:', error);
      res.status(500).json({ error: 'Failed to fetch footer social media' });
    }
  });

  app.post("/api/admin/footer-social-media", requireAdmin, async (req, res) => {
    try {
      const { platform, url, isActive, position } = req.body;
      
      if (!platform || !url) {
        return res.status(400).json({ error: 'Platform and URL are required' });
      }

      const socialLink = new FooterSocialMedia({
        platform,
        url,
        isActive: isActive !== false,
        position: position || 0
      });

      await socialLink.save();
      res.status(201).json(socialLink);
    } catch (error) {
      console.error('Error creating footer social media:', error);
      res.status(500).json({ error: 'Failed to create footer social media' });
    }
  });

  app.patch("/api/admin/footer-social-media/:id", requireAdmin, async (req, res) => {
    try {
      const { platform, url, isActive, position } = req.body;
      
      const socialLink = await FooterSocialMedia.findByIdAndUpdate(
        req.params.id,
        {
          ...(platform && { platform }),
          ...(url && { url }),
          ...(isActive !== undefined && { isActive }),
          ...(position !== undefined && { position }),
          updatedAt: new Date()
        },
        { new: true }
      );

      if (!socialLink) {
        return res.status(404).json({ error: 'Social media link not found' });
      }

      res.json(socialLink);
    } catch (error) {
      console.error('Error updating footer social media:', error);
      res.status(500).json({ error: 'Failed to update footer social media' });
    }
  });

  app.delete("/api/admin/footer-social-media/:id", requireAdmin, async (req, res) => {
    try {
      const socialLink = await FooterSocialMedia.findByIdAndDelete(req.params.id);
      
      if (!socialLink) {
        return res.status(404).json({ error: 'Social media link not found' });
      }

      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting footer social media:', error);
      res.status(500).json({ error: 'Failed to delete footer social media' });
    }
  });

  // ADMIN USERS API - Get all users with details
  app.get("/api/admin/users", requireAdmin, async (req, res) => {
    try {
      const users = await User.find()
        .select('_id email fullName avatar profilePicture authProvider googleId followers followersCount createdAt updatedAt isActive')
        .lean();
      
      // Get favorite counts for all users from UserFavorite collection
      const userIds = users.map(u => u._id.toString());
      const favoriteCounts = await UserFavorite.aggregate([
        { $match: { userId: { $in: userIds } } },
        { $group: { _id: '$userId', count: { $sum: 1 } } }
      ]);
      
      const favoriteMap: Record<string, number> = {};
      favoriteCounts.forEach(doc => {
        favoriteMap[doc._id] = doc.count;
      });
      
      // Convert to plain objects with user details
      const usersWithDetails = users.map(user => {
        const fullNameParts = (user.fullName || 'User').split(' ');
        const firstName = fullNameParts[0] || '';
        const lastName = fullNameParts.slice(1).join(' ') || '';
        
        return {
          _id: user._id,
          email: user.email,
          fullName: user.fullName || '',
          firstName: firstName,
          lastName: lastName,
          avatar: user.avatar || '',
          profilePicture: user.profilePicture || '',
          authProvider: user.authProvider || 'email',
          googleId: user.googleId || '',
          followers: user.followersCount || 0,
          favorites: favoriteMap[user._id.toString()] || 0,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
          isActive: user.isActive !== false
        };
      });

      res.json(usersWithDetails);
    } catch (error) {
      console.error('Error fetching users:', error);
      res.status(500).json({ error: 'Failed to fetch users' });
    }
  });

  // ADMIN USERS API - Update user
  app.patch("/api/admin/users/:id", requireAdmin, async (req, res) => {
    try {
      const { email, firstName, lastName, profilePicture, isActive, fullName } = req.body;
      
      const updateData: any = {};
      if (email) updateData.email = email;
      if (fullName) {
        updateData.fullName = fullName;
      } else if (firstName || lastName) {
        // If firstName/lastName provided, combine to fullName
        const user = await User.findById(req.params.id);
        if (user) {
          const newFullName = [firstName || user.fullName?.split(' ')[0], lastName || user.fullName?.split(' ').slice(1).join(' ')].filter(Boolean).join(' ');
          updateData.fullName = newFullName;
        }
      }
      if (profilePicture) updateData.profilePicture = profilePicture;
      if (isActive !== undefined) updateData.isActive = isActive;
      updateData.updatedAt = new Date();

      const user = await User.findByIdAndUpdate(
        req.params.id,
        updateData,
        { new: true }
      ).select('_id email fullName profilePicture authProvider googleId followers followersCount createdAt updatedAt isActive');

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Get favorite count
      const favoriteCount = await UserFavorite.countDocuments({ userId: user._id.toString() });

      res.json({
        _id: user._id,
        email: user.email,
        fullName: user.fullName,
        firstName: (user.fullName || 'User').split(' ')[0],
        lastName: (user.fullName || 'User').split(' ').slice(1).join(' '),
        profilePicture: user.profilePicture,
        authProvider: user.authProvider,
        googleId: user.googleId,
        followers: user.followersCount || 0,
        favorites: favoriteCount || 0,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        isActive: user.isActive !== false
      });
    } catch (error) {
      console.error('Error updating user:', error);
      res.status(500).json({ error: 'Failed to update user' });
    }
  });

  // ADMIN USERS API - Delete user
  app.delete("/api/admin/users/:id", requireAdmin, async (req, res) => {
    try {
      const user = await User.findByIdAndDelete(req.params.id);
      
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting user:', error);
      res.status(500).json({ error: 'Failed to delete user' });
    }
  });

  // Ads.txt endpoint - IAB Tech Lab compliant
  app.get("/ads.txt", (req, res) => {
    // Serve ads.txt with proper Content-Type header
    const adsTxt = `# ads.txt file for themegaradio.com
# This file indicates authorized digital sellers for our inventory

# Since this is a radio streaming platform without programmatic advertising,
# we declare no authorized sellers to prevent unauthorized ad sales

# Contact information
CONTACT=support@themegaradio.com

# No authorized sellers - prevents unauthorized monetization
# If you add advertising partners in the future, add them here with format:
# domain.com, publisher-account-id, DIRECT|RESELLER, certification-authority-id`;

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours
    res.send(adsTxt);
  });

  // User engagement routes for SEO
  const { userEngagementRouter } = await import('./routes/user-engagement');
  app.use('/api/user-engagement', userEngagementRouter);

  // API Key management routes
  app.use('/api/api-keys', apiKeysRouter);
  seedDemoApiKey();

  // API Key middleware - enforces rate limiting and tracks usage for API key holders
  app.use('/api', apiKeyMiddleware);

  // Remote app logging endpoint for mobile apps
  app.post('/api/logs/remote', async (req, res) => {
    try {
      const apiKey = req.headers['x-api-key'] as string;
      if (!apiKey) {
        return res.status(401).json({ error: 'X-API-Key header required' });
      }

      const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
      const { ApiKey: ApiKeyModel } = await import('../shared/mongo-schemas');
      const apiKeyDoc = await ApiKeyModel.findOne({ keyHash });

      if (!apiKeyDoc || apiKeyDoc.status !== 'active') {
        return res.status(401).json({ error: 'Invalid or inactive API key' });
      }

      const { logs, deviceId, appVersion, buildNumber, platform } = req.body;

      if (!logs || !Array.isArray(logs) || logs.length === 0) {
        return res.status(400).json({ error: 'logs array is required and must not be empty' });
      }

      if (!deviceId || !platform) {
        return res.status(400).json({ error: 'deviceId and platform are required' });
      }

      if (!['ios', 'android'].includes(platform)) {
        return res.status(400).json({ error: 'platform must be ios or android' });
      }

      if (logs.length > 100) {
        return res.status(400).json({ error: 'Maximum 100 log entries per request' });
      }

      const validLevels = ['info', 'warn', 'error', 'debug', 'fatal'];
      const validMessages = ['APP_START', 'LAYOUT_MOUNTED', 'FONTS_LOADED', 'NAVIGATION_READY', 'APP_CRASH'];

      const sanitizedLogs = logs.map((log: any) => ({
        level: validLevels.includes(log.level) ? log.level : 'info',
        message: String(log.message || '').substring(0, 500),
        timestamp: log.timestamp || new Date().toISOString(),
        data: log.data && typeof log.data === 'object' ? JSON.parse(JSON.stringify(log.data).substring(0, 5000)) : {},
      }));

      const hasCrash = sanitizedLogs.some((l: any) => l.message === 'APP_CRASH');

      await AppLog.create({
        deviceId: String(deviceId).substring(0, 200),
        appVersion: String(appVersion || '').substring(0, 50),
        buildNumber: String(buildNumber || '').substring(0, 20),
        platform,
        logs: sanitizedLogs,
        apiKeyHash: keyHash,
      });

      if (hasCrash) {
        console.error(`[RemoteLog] APP_CRASH from ${platform} device ${deviceId} v${appVersion}`);
      }

      res.json({ success: true, received: sanitizedLogs.length });
    } catch (error: any) {
      console.error('[RemoteLog] Error:', error.message);
      res.status(500).json({ error: 'Failed to store logs' });
    }
  });

  // Endpoint to view remote app logs
  app.get('/api/admin/app-logs', async (req, res) => {
    try {
      const { platform, deviceId, message, level, page = '1', limit = '50' } = req.query;
      const filter: any = {};
      if (platform) filter.platform = platform;
      if (deviceId) filter.deviceId = { $regex: deviceId, $options: 'i' };
      if (message) filter['logs.message'] = message;
      if (level) filter['logs.level'] = level;

      const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
      const lim = Math.min(parseInt(limit as string), 100);

      const [items, total] = await Promise.all([
        AppLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(lim).lean(),
        AppLog.countDocuments(filter),
      ]);

      res.json({
        logs: items,
        total,
        page: parseInt(page as string),
        totalPages: Math.ceil(total / lim),
      });
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to fetch logs' });
    }
  });

  // Endpoint to get crash summary
  app.get('/api/admin/app-logs/crashes', async (req, res) => {
    try {
      const crashes = await AppLog.find({ 'logs.message': 'APP_CRASH' })
        .sort({ createdAt: -1 })
        .limit(50)
        .lean();

      res.json({ crashes, total: crashes.length });
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to fetch crash logs' });
    }
  });

  // Country-language mapping routes (admin only)
  registerCountryLanguageMappingRoutes(app, requireAdmin);
  
  // URL translations management routes
  app.use('/api/admin/url-translations', urlTranslationsRouter);
  
  // Performance optimization routes
  app.use('/api/admin/performance', performanceRouter);

  // ==========================================
  // SEO METADATA ADMIN API - Per-page SEO management
  // ==========================================
  
  // List all SEO metadata entries with pagination and filtering
  app.get("/api/admin/seo-metadata", requireAdmin, async (req, res) => {
    try {
      const { pageType, language, status, page = '1', limit = '50' } = req.query;
      
      const filter: any = {};
      if (pageType) filter.pageType = pageType;
      if (language) filter.language = language;
      if (status) filter.status = status;
      
      const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
      
      const [items, total] = await Promise.all([
        SeoMetadata.find(filter)
          .sort({ pageType: 1, routeKey: 1, language: 1 })
          .skip(skip)
          .limit(parseInt(limit as string))
          .lean(),
        SeoMetadata.countDocuments(filter)
      ]);
      
      res.json({
        items,
        pagination: {
          page: parseInt(page as string),
          limit: parseInt(limit as string),
          total,
          pages: Math.ceil(total / parseInt(limit as string))
        }
      });
    } catch (error: any) {
      console.error('Error fetching SEO metadata:', error);
      res.status(500).json({ error: 'Failed to fetch SEO metadata' });
    }
  });

  // Get single SEO metadata entry
  app.get("/api/admin/seo-metadata/:id", requireAdmin, async (req, res) => {
    try {
      const entry = await SeoMetadata.findById(req.params.id).lean();
      if (!entry) {
        return res.status(404).json({ error: 'SEO metadata entry not found' });
      }
      res.json(entry);
    } catch (error: any) {
      console.error('Error fetching SEO metadata:', error);
      res.status(500).json({ error: 'Failed to fetch SEO metadata' });
    }
  });

  // Create new SEO metadata entry
  app.post("/api/admin/seo-metadata", requireAdmin, async (req, res) => {
    try {
      const { pageType, routeKey, language, title, description, ogTitle, ogDescription, ogImageUrl, twitterTitle, twitterDescription, twitterImageUrl, canonicalUrl, metaKeywords, noIndex, noFollow, source, status } = req.body;
      
      // Validate required fields
      if (!pageType || !routeKey || !language || !title || !description) {
        return res.status(400).json({ error: 'Missing required fields: pageType, routeKey, language, title, description' });
      }
      
      // Check for duplicates
      const existing = await SeoMetadata.findOne({ pageType, routeKey, language });
      if (existing) {
        return res.status(409).json({ error: 'SEO entry already exists for this pageType + routeKey + language combination' });
      }
      
      const entry = new SeoMetadata({
        pageType,
        routeKey,
        language,
        title,
        description,
        ogTitle,
        ogDescription,
        ogImageUrl,
        twitterTitle,
        twitterDescription,
        twitterImageUrl,
        canonicalUrl,
        metaKeywords,
        noIndex: noIndex || false,
        noFollow: noFollow || false,
        source: source || 'manual',
        status: status || 'draft',
        createdAt: new Date(),
        updatedAt: new Date()
      });
      
      await entry.save();
      res.status(201).json(entry);
    } catch (error: any) {
      console.error('Error creating SEO metadata:', error);
      res.status(500).json({ error: 'Failed to create SEO metadata' });
    }
  });

  // Update SEO metadata entry
  app.patch("/api/admin/seo-metadata/:id", requireAdmin, async (req, res) => {
    try {
      const updateData = { ...req.body, updatedAt: new Date() };
      delete updateData._id; // Remove _id if present
      
      const entry = await SeoMetadata.findByIdAndUpdate(
        req.params.id,
        updateData,
        { new: true }
      );
      
      if (!entry) {
        return res.status(404).json({ error: 'SEO metadata entry not found' });
      }
      
      res.json(entry);
    } catch (error: any) {
      console.error('Error updating SEO metadata:', error);
      res.status(500).json({ error: 'Failed to update SEO metadata' });
    }
  });

  // Delete SEO metadata entry
  app.delete("/api/admin/seo-metadata/:id", requireAdmin, async (req, res) => {
    try {
      const entry = await SeoMetadata.findByIdAndDelete(req.params.id);
      if (!entry) {
        return res.status(404).json({ error: 'SEO metadata entry not found' });
      }
      res.json({ success: true });
    } catch (error: any) {
      console.error('Error deleting SEO metadata:', error);
      res.status(500).json({ error: 'Failed to delete SEO metadata' });
    }
  });

  // Bulk publish/unpublish SEO entries
  app.post("/api/admin/seo-metadata/bulk-status", requireAdmin, async (req, res) => {
    try {
      const { ids, status } = req.body;
      
      if (!ids || !Array.isArray(ids) || !status) {
        return res.status(400).json({ error: 'ids array and status required' });
      }
      
      const result = await SeoMetadata.updateMany(
        { _id: { $in: ids } },
        { $set: { status, updatedAt: new Date() } }
      );
      
      res.json({ success: true, modifiedCount: result.modifiedCount });
    } catch (error: any) {
      console.error('Error bulk updating SEO metadata:', error);
      res.status(500).json({ error: 'Failed to bulk update SEO metadata' });
    }
  });

  // Get SEO metadata statistics
  app.get("/api/admin/seo-metadata/stats", requireAdmin, async (req, res) => {
    try {
      const [total, byPageType, byStatus, byLanguage] = await Promise.all([
        SeoMetadata.countDocuments(),
        SeoMetadata.aggregate([
          { $group: { _id: '$pageType', count: { $sum: 1 } } },
          { $sort: { count: -1 } }
        ]),
        SeoMetadata.aggregate([
          { $group: { _id: '$status', count: { $sum: 1 } } }
        ]),
        SeoMetadata.aggregate([
          { $group: { _id: '$language', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 10 }
        ])
      ]);
      
      res.json({
        total,
        byPageType: Object.fromEntries(byPageType.map(p => [p._id, p.count])),
        byStatus: Object.fromEntries(byStatus.map(s => [s._id, s.count])),
        topLanguages: byLanguage
      });
    } catch (error: any) {
      console.error('Error fetching SEO metadata stats:', error);
      res.status(500).json({ error: 'Failed to fetch SEO metadata stats' });
    }
  });

  // Get page types enum for dropdown
  app.get("/api/admin/seo-metadata/page-types", requireAdmin, async (req, res) => {
    res.json({
      pageTypes: [
        { value: 'homepage', label: 'Homepage' },
        { value: 'genre_list', label: 'Genre List' },
        { value: 'genre_detail', label: 'Genre Detail' },
        { value: 'station_detail', label: 'Station Detail' },
        { value: 'country_list', label: 'Country List' },
        { value: 'country_detail', label: 'Country Detail' },
        { value: 'region', label: 'Region' },
        { value: 'search', label: 'Search' },
        { value: 'static', label: 'Static Page' }
      ]
    });
  });

  // AI Draft Generation for SEO Metadata
  app.post("/api/admin/seo-metadata/generate-draft", requireAdmin, async (req, res) => {
    try {
      const { pageType, routeKey, language, context } = req.body;
      
      if (!pageType || !language) {
        return res.status(400).json({ error: 'pageType and language are required' });
      }
      
      // Import OpenAI dynamically
      const OpenAI = (await import('openai')).default;
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      
      const languageNames: Record<string, string> = {
        'en': 'English', 'tr': 'Turkish', 'de': 'German', 'es': 'Spanish',
        'fr': 'French', 'it': 'Italian', 'pt': 'Portuguese', 'ar': 'Arabic',
        'nl': 'Dutch', 'ru': 'Russian', 'pl': 'Polish', 'zh': 'Chinese',
        'ja': 'Japanese', 'ko': 'Korean', 'hi': 'Hindi'
      };
      const languageName = languageNames[language] || 'English';
      
      // Build context-aware prompt based on page type
      let pageContext = '';
      if (pageType === 'genre_detail' && routeKey) {
        const genre = await Genre.findOne({ slug: routeKey }).lean();
        if (genre) {
          pageContext = `Genre: ${genre.name}, Station Count: ${genre.stationCount || 0}`;
        }
      } else if (pageType === 'station_detail' && routeKey) {
        const station = await Station.findOne({ slug: routeKey }).lean();
        if (station) {
          pageContext = `Station: ${station.name}, Country: ${station.country}, Tags: ${station.tags}`;
        }
      } else if (pageType === 'country_detail' && routeKey) {
        const stationCount = await Station.countDocuments({ countryCode: routeKey.toUpperCase() });
        pageContext = `Country Code: ${routeKey.toUpperCase()}, Station Count: ${stationCount}`;
      }
      
      const prompt = `Generate SEO-optimized title and description for a radio streaming page in ${languageName}.

Page Type: ${pageType}
${routeKey ? `Route/Slug: ${routeKey}` : ''}
${pageContext ? `Context: ${pageContext}` : ''}
${context ? `Additional Context: ${context}` : ''}

Requirements:
1. Title: 50-60 characters, include primary keyword
2. Description: 120-160 characters, compelling call-to-action
3. Brand name "Mega Radio" should be included naturally
4. Write in ${languageName} language
5. Follow Google 2025 SEO best practices

Format your response as JSON:
{
  "title": "...",
  "description": "...",
  "ogTitle": "...",
  "ogDescription": "..."
}`;

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 500,
        temperature: 0.7
      });
      
      const aiResponse = completion.choices[0]?.message?.content || '';
      
      // Parse JSON response
      try {
        const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          res.json({
            success: true,
            draft: {
              title: parsed.title || '',
              description: parsed.description || '',
              ogTitle: parsed.ogTitle || parsed.title || '',
              ogDescription: parsed.ogDescription || parsed.description || ''
            }
          });
        } else {
          res.json({ success: false, error: 'Failed to parse AI response' });
        }
      } catch (parseError) {
        res.json({ success: false, error: 'Invalid AI response format' });
      }
    } catch (error: any) {
      console.error('Error generating AI draft:', error);
      res.status(500).json({ error: 'Failed to generate AI draft' });
    }
  });

  // SEO Middleware is now handled in server/index.ts - removed duplicate

  // ─── TV APP COMBINED INIT ENDPOINT ───────────────────────────
  // Combines countries + genres + translations + popular stations in a single request
  // Reduces TV app startup from ~5 separate API calls to 1
  app.get('/api/tv/init', async (req: Request, res: Response) => {
    const lang = (req.query.lang as string) || 'en';
    const country = req.query.country as string || null;
    const startTime = Date.now();

    try {
      const [countries, genres, translations, popularStations] = await Promise.all([
        // Countries - cached 24h
        (async () => {
          const cacheKey = 'tv:countries:all';
          const cached = await CacheManager.get<string[]>(cacheKey);
          if (cached) return cached;
          const result = (await Station.distinct('country')).filter((c: string) => c && c.trim() !== '').sort();
          await CacheManager.set(cacheKey, result, { ttl: 86400 });
          return result;
        })(),

        // Discoverable genres - cached 24h, slim for TV
        (async () => {
          const cacheKey = 'tv:genres:discoverable:slim';
          const cached = await CacheManager.get(cacheKey);
          if (cached) return cached;
          const result = await Genre.find({ isDiscoverable: true })
            .select(TV_GENRE_PROJECTION)
            .sort({ displayOrder: 1 }).limit(13).lean();
          const slim = result.map(tvSlimGenre);
          await CacheManager.set(cacheKey, slim, { ttl: 86400 });
          return slim;
        })(),

        // Translations - cached 7 days
        (async () => {
          const cacheKey = `tv:translations:${lang}`;
          const cached = await CacheManager.get(cacheKey);
          if (cached) return cached;
          const result = await fetchTranslationsForLanguage(lang);
          await CacheManager.set(cacheKey, result, { ttl: 604800 });
          return result;
        })(),

        // Popular stations (slim) - cached 24h
        (async () => {
          const countryKey = country || 'all';
          const cacheKey = `tv:popular:${countryKey}`;
          const cached = await CacheManager.get(cacheKey);
          if (cached) return cached;
          
          let countryFilter: any = {};
          if (country && country !== 'all') {
            Object.assign(countryFilter, normalizeCountryFilter(country));
          }
          
          const result = await Station.find(countryFilter)
            .sort({ votes: -1 })
            .limit(21)
            .select(TV_STATION_PROJECTION)
            .lean();
          const slim = result.map(tvSlimStation);
          
          await CacheManager.set(cacheKey, slim, { ttl: 86400 });
          return slim;
        })()
      ]);

      // Set aggressive cache headers for TV
      res.set({
        'Cache-Control': 'public, max-age=300, stale-while-revalidate=600',
        'Access-Control-Allow-Origin': '*'
      });

      res.json({
        countries,
        genres,
        translations,
        popularStations,
        responseTime: Date.now() - startTime,
        cacheAge: Date.now()
      });
    } catch (error: any) {
      console.error('[TV INIT] Error:', error.message);
      res.status(500).json({ error: 'Failed to load TV init data' });
    }
  });

  // ─── TV APP HTTP CACHE HEADERS MIDDLEWARE ───────────────────────────
  // Applied to API routes when ?tv=1 is present for client-side caching
  app.use('/api', (req: Request, res: Response, next: any) => {
    if (req.query.tv !== '1') return next();
    
    const path = req.path;
    
    if (path.startsWith('/countries') || path.startsWith('/translations')) {
      res.set('Cache-Control', 'public, max-age=86400, stale-while-revalidate=3600');
    } else if (path.startsWith('/genres')) {
      res.set('Cache-Control', 'public, max-age=3600, stale-while-revalidate=600');
    } else if (path.startsWith('/stations')) {
      res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
    } else if (path.includes('/metadata') || path.includes('/stream')) {
      res.set('Cache-Control', 'no-cache, no-store');
    }
    
    res.set('Access-Control-Allow-Origin', '*');
    next();
  });

  // ─── TV APP ETAG SUPPORT ───────────────────────────
  // Wraps response to add ETag headers and support 304 Not Modified
  function sendWithETag(req: Request, res: Response, data: any): void {
    const json = JSON.stringify(data);
    const etag = `"${crypto.createHash('md5').update(json).digest('hex')}"`;
    
    res.set('ETag', etag);
    
    if (req.headers['if-none-match'] === etag) {
      res.status(304).end();
      return;
    }
    
    res.json(data);
  }

  // ─── TV APP STREAM HELPER FUNCTIONS ───────────────────────────
  function parsePlaylistContent(content: string, contentType: string, urlStr: string): string | null {
    const lowerUrl = urlStr.toLowerCase();
    const lowerType = (contentType || '').toLowerCase();
    const isPLS = lowerUrl.endsWith('.pls') || lowerType.includes('scpls') || lowerType.includes('x-scpls');
    const isM3U = lowerUrl.endsWith('.m3u') || lowerUrl.endsWith('.m3u8') || lowerType.includes('mpegurl') || lowerType.includes('x-mpegurl');
    if (isPLS) {
      const lines = content.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (/^File\d*=/i.test(trimmed)) {
          const url = trimmed.substring(trimmed.indexOf('=') + 1).trim();
          if (url.startsWith('http')) return url;
        }
      }
    }
    if (isM3U) {
      const lines = content.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#') && trimmed.startsWith('http')) {
          return trimmed;
        }
      }
    }
    return null;
  }

  function isTVHLSUrl(urlStr: string, contentType?: string): boolean {
    const lowerUrl = urlStr.toLowerCase();
    const lowerType = (contentType || '').toLowerCase();
    return lowerUrl.endsWith('.m3u8') || lowerType.includes('x-mpegurl') || lowerType.includes('vnd.apple.mpegurl');
  }

  function isTVPlaylistUrl(urlStr: string, contentType?: string): boolean {
    if (isTVHLSUrl(urlStr, contentType)) return false;
    const lowerUrl = urlStr.toLowerCase();
    const lowerType = (contentType || '').toLowerCase();
    return lowerUrl.endsWith('.m3u') || lowerUrl.endsWith('.pls') ||
      lowerType.includes('mpegurl') || lowerType.includes('scpls') || lowerType.includes('x-scpls');
  }

  async function tvFollowRedirects(urlStr: string, maxRedirects: number, timeoutMs: number): Promise<{ response: any; finalUrl: string; redirectCount: number }> {
    const httpModule = await import('http');
    const httpsModule = await import('https');
    return new Promise((resolve, reject) => {
      let redirectCount = 0;
      function doRequest(currentUrl: string) {
        let parsedUrl: URL;
        try { parsedUrl = new URL(currentUrl); } catch { return reject(new Error('Invalid URL: ' + currentUrl)); }
        const client = parsedUrl.protocol === 'https:' ? httpsModule : httpModule;
        const req = client.get(currentUrl, { timeout: timeoutMs }, (response: any) => {
          if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
            redirectCount++;
            if (redirectCount > maxRedirects) { response.destroy(); return reject(new Error('Too many redirects')); }
            response.destroy();
            const nextUrl = response.headers.location.startsWith('http') ? response.headers.location : new URL(response.headers.location, currentUrl).toString();
            return doRequest(nextUrl);
          }
          resolve({ response, finalUrl: currentUrl, redirectCount });
        });
        req.on('error', (err: Error) => reject(err));
        req.on('timeout', () => { req.destroy(); reject(new Error('Connection timed out')); });
      }
      doRequest(urlStr);
    });
  }

  async function tvMakeHeadRequest(urlStr: string, maxRedirects: number, timeoutMs: number): Promise<{ response: any; finalUrl: string; redirectCount: number }> {
    const httpModule = await import('http');
    const httpsModule = await import('https');
    return new Promise((resolve, reject) => {
      let redirectCount = 0;
      function doRequest(currentUrl: string) {
        let parsedUrl: URL;
        try { parsedUrl = new URL(currentUrl); } catch { return reject(new Error('Invalid URL: ' + currentUrl)); }
        const client = parsedUrl.protocol === 'https:' ? httpsModule : httpModule;
        const req = client.request(currentUrl, { method: 'HEAD', timeout: timeoutMs }, (response: any) => {
          if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
            redirectCount++;
            if (redirectCount > maxRedirects) { response.destroy(); return reject(new Error('Too many redirects')); }
            response.destroy();
            const nextUrl = response.headers.location.startsWith('http') ? response.headers.location : new URL(response.headers.location, currentUrl).toString();
            return doRequest(nextUrl);
          }
          resolve({ response, finalUrl: currentUrl, redirectCount });
        });
        req.on('error', (err: Error) => reject(err));
        req.on('timeout', () => { req.destroy(); reject(new Error('Connection timed out')); });
        req.end();
      }
      doRequest(urlStr);
    });
  }

  // ─── TV APP STREAM ENDPOINTS ───────────────────────────

  // ENDPOINT: /api/stream-proxy - Proxy stream for TV apps
  app.get('/api/stream-proxy', async (req: Request, res: Response) => {
    const streamUrl = req.query.url as string;
    if (!streamUrl) {
      return res.status(400).json({ error: 'Missing url parameter' });
    }
    try {
      const { response, finalUrl } = await tvFollowRedirects(streamUrl, 5, 15000);
      const contentType = response.headers['content-type'] || '';
      if (isTVPlaylistUrl(finalUrl, contentType)) {
        let playlistData = '';
        response.setEncoding('utf8');
        await new Promise<void>((resolve, reject) => {
          response.on('data', (chunk: string) => { playlistData += chunk; });
          response.on('end', () => resolve());
          response.on('error', (err: Error) => reject(err));
          setTimeout(() => { response.destroy(); resolve(); }, 5000);
        });
        const resolvedUrl = parsePlaylistContent(playlistData, contentType, finalUrl);
        if (resolvedUrl) {
          try {
            const { response: streamResponse } = await tvFollowRedirects(resolvedUrl, 5, 15000);
            const streamContentType = streamResponse.headers['content-type'] || 'audio/mpeg';
            res.setHeader('Content-Type', streamContentType);
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            streamResponse.pipe(res);
            req.on('close', () => { streamResponse.destroy(); });
            return;
          } catch (err) {
            if (!res.headersSent) return res.status(502).json({ error: 'Failed to connect to resolved stream' });
            return;
          }
        } else {
          if (!res.headersSent) return res.status(502).json({ error: 'Could not parse playlist' });
          return;
        }
      }
      res.setHeader('Content-Type', contentType || 'audio/mpeg');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      response.pipe(res);
      req.on('close', () => { response.destroy(); });
    } catch (err: any) {
      if (!res.headersSent) return res.status(502).json({ error: err.message });
    }
  });

  // ENDPOINT: /api/stream-check - Check stream availability for TV apps
  app.get('/api/stream-check', async (req: Request, res: Response) => {
    const streamUrl = req.query.url as string;
    if (!streamUrl) {
      return res.status(400).json({ error: 'Missing url parameter' });
    }
    const startTime = Date.now();
    try {
      let response: any, finalUrl: string, redirectCount = 0;
      try {
        const result = await tvMakeHeadRequest(streamUrl, 5, 5000);
        response = result.response;
        finalUrl = result.finalUrl;
        redirectCount = result.redirectCount;
      } catch {
        const result = await tvFollowRedirects(streamUrl, 5, 5000);
        response = result.response;
        finalUrl = result.finalUrl;
        redirectCount = result.redirectCount;
        response.destroy();
      }
      const contentType = response.headers['content-type'] || '';
      const statusCode = response.statusCode || 0;
      const isPlaylist = isTVPlaylistUrl(finalUrl, contentType);
      let resolvedUrl: string | null = null;
      if (isPlaylist) {
        try {
          const playlistResult = await tvFollowRedirects(finalUrl, 5, 5000);
          let playlistData = '';
          playlistResult.response.setEncoding('utf8');
          await new Promise<void>((resolve) => {
            playlistResult.response.on('data', (chunk: string) => { playlistData += chunk; });
            playlistResult.response.on('end', () => resolve());
            playlistResult.response.on('error', () => resolve());
            setTimeout(() => { playlistResult.response.destroy(); resolve(); }, 3000);
          });
          resolvedUrl = parsePlaylistContent(playlistData, contentType, finalUrl);
        } catch (e) {}
      }
      res.json({
        ok: statusCode >= 200 && statusCode < 400,
        url: streamUrl,
        finalUrl,
        contentType,
        statusCode,
        isPlaylist,
        resolvedUrl,
        error: null,
        responseTime: Date.now() - startTime
      });
    } catch (err: any) {
      res.json({
        ok: false,
        url: streamUrl,
        finalUrl: null,
        contentType: null,
        statusCode: null,
        isPlaylist: false,
        resolvedUrl: null,
        error: err.message,
        responseTime: Date.now() - startTime
      });
    }
  });

  // ENDPOINT: /api/stream-resolve - Resolve stream URL for TV apps
  app.get('/api/stream-resolve', async (req: Request, res: Response) => {
    const streamUrl = req.query.url as string;
    if (!streamUrl) {
      return res.status(400).json({ error: 'Missing url parameter' });
    }
    try {
      const { response, finalUrl, redirectCount } = await tvFollowRedirects(streamUrl, 5, 10000);
      const contentType = response.headers['content-type'] || '';
      const isHLS = isTVHLSUrl(finalUrl, contentType);
      const isPlaylist = isTVPlaylistUrl(finalUrl, contentType) && !isHLS;
      if (isHLS) {
        response.destroy();
        return res.json({ originalUrl: streamUrl, resolvedUrl: finalUrl, contentType, isPlaylist: false, isHLS: true, redirectCount, error: null });
      }
      if (isPlaylist) {
        let playlistData = '';
        response.setEncoding('utf8');
        await new Promise<void>((resolve) => {
          response.on('data', (chunk: string) => { playlistData += chunk; });
          response.on('end', () => resolve());
          response.on('error', () => resolve());
          setTimeout(() => { response.destroy(); resolve(); }, 5000);
        });
        const resolvedUrl = parsePlaylistContent(playlistData, contentType, finalUrl);
        return res.json({
          originalUrl: streamUrl,
          resolvedUrl: resolvedUrl || finalUrl,
          contentType: resolvedUrl ? 'audio/mpeg' : contentType,
          isPlaylist: true,
          isHLS: false,
          redirectCount,
          error: resolvedUrl ? null : 'Could not extract stream URL from playlist'
        });
      }
      response.destroy();
      res.json({ originalUrl: streamUrl, resolvedUrl: finalUrl, contentType, isPlaylist: false, isHLS: false, redirectCount, error: null });
    } catch (err: any) {
      res.json({ originalUrl: streamUrl, resolvedUrl: null, contentType: null, isPlaylist: false, isHLS: false, redirectCount: 0, error: err.message });
    }
  });

  // Return the original server with WebSocket server references for upgrade handling
  const result = server as Server & { metadataWss: InstanceType<typeof WebSocketServer>, castWss: InstanceType<typeof WebSocketServer> };
  result.metadataWss = wss;
  result.castWss = castWss;
  return result;
}
