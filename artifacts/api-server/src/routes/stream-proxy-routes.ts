import type { Express } from "express";
import { logger } from "../utils/logger";
import { validateOutboundUrl } from "../utils/safe-fetch";

// Shared port BLOCKLIST for radio stream / Shoutcast / Icecast endpoints.
//
// Radio stations legitimately bind to thousands of non-standard ports
// (DB audit: 3418 distinct ports across 51.797 stations). A narrow
// allowlist silently rejected legitimate streams (e.g. Shoutcast hosts
// on :5032, :8201, :2199, :8200). SSRF defense remains: validateOutboundUrl
// rejects any private/loopback/link-local/CGNAT/cloud-metadata IP — so
// even with a permissive port policy, an attacker cannot pivot into
// internal infrastructure. This blocklist only blocks well-known
// internal-service ports that public hosts should never expose.
const STREAM_BLOCKED_PORTS: ReadonlySet<number> = new Set([
  21,    // FTP control
  22,    // SSH
  23,    // Telnet
  25,    // SMTP
  53,    // DNS
  110,   // POP3
  111,   // Portmapper / RPC
  135,   // MSRPC
  139,   // NetBIOS
  143,   // IMAP
  389,   // LDAP
  445,   // SMB
  465,   // SMTPS
  587,   // SMTP submission
  631,   // CUPS
  636,   // LDAPS
  993,   // IMAPS
  995,   // POP3S
  1433,  // MSSQL
  1521,  // Oracle
  2049,  // NFS
  2375,  // Docker daemon (unauthenticated)
  2376,  // Docker daemon (TLS)
  2379,  // etcd client
  2380,  // etcd peer
  3306,  // MySQL
  3389,  // RDP
  4444,  // Metasploit default
  5432,  // PostgreSQL
  5672,  // AMQP / RabbitMQ
  5984,  // CouchDB
  6379,  // Redis
  6380,  // Redis alt
  6443,  // Kubernetes API server
  9092,  // Kafka broker
  9200,  // Elasticsearch HTTP
  9300,  // Elasticsearch transport
  10250, // kubelet API
  10255, // kubelet read-only
  11211, // Memcached
  15672, // RabbitMQ management
  27017, // MongoDB
  27018, // MongoDB shard
  27019, // MongoDB config
]);

const MAX_CONCURRENT_STREAMS = parseInt(process.env.MAX_CONCURRENT_STREAMS || '25', 10);
const MAX_STREAM_DURATION_MS = parseInt(process.env.MAX_STREAM_DURATION_MIN || '120', 10) * 60 * 1000;
const STREAM_IDLE_TIMEOUT_MS = 60 * 1000;
const MAX_STREAMS_PER_IP = 5;
const PRESSURE_STREAM_TTL_MS = 5 * 60 * 1000;
let activeStreamCount = 0;
const activeStreamsPerIp = new Map<string, number>();

interface StreamEntry {
  cleanup: () => void;
  startedAt: number;
  ip: string;
}
const activeStreamRegistry = new Map<number, StreamEntry>();
let streamIdCounter = 0;

export function getActiveStreamCount(): number {
  return activeStreamCount;
}

export function getStreamRegistrySize(): number {
  return activeStreamRegistry.size;
}

export function forceCloseAllStreams(reason: string): number {
  const count = activeStreamRegistry.size;
  if (count === 0) return 0;
  console.log(`🔪 FORCE CLOSING ${count} active streams: ${reason}`);
  for (const [id, entry] of activeStreamRegistry) {
    try { entry.cleanup(); } catch {}
  }
  activeStreamRegistry.clear();
  activeStreamCount = 0;
  activeStreamsPerIp.clear();
  return count;
}

export function forceCloseOldStreams(maxAgeMs: number): number {
  const now = Date.now();
  let closed = 0;
  for (const [id, entry] of activeStreamRegistry) {
    if (now - entry.startedAt > maxAgeMs) {
      try { entry.cleanup(); } catch {}
      activeStreamRegistry.delete(id);
      closed++;
    }
  }
  if (closed > 0) {
    console.log(`🔪 PRESSURE: Closed ${closed} streams older than ${Math.round(maxAgeMs / 60000)}min`);
  }
  return closed;
}

function getClientIp(req: any): string {
  return req.ip || req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
}

function incrementIpStream(ip: string): boolean {
  const current = activeStreamsPerIp.get(ip) || 0;
  if (current >= MAX_STREAMS_PER_IP) return false;
  activeStreamsPerIp.set(ip, current + 1);
  return true;
}

function decrementIpStream(ip: string): void {
  const current = activeStreamsPerIp.get(ip) || 0;
  if (current <= 1) activeStreamsPerIp.delete(ip);
  else activeStreamsPerIp.set(ip, current - 1);
}

export function registerStreamProxyRoutes(app: Express, deps: any) {
  const { requireAdmin } = deps;

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

  const MAX_IMAGE_DOWNLOAD_BYTES = 2 * 1024 * 1024;
  const MAX_CONCURRENT_SHARP = 6;
  const MAX_SHARP_QUEUE = 20;
  const MAX_TARGET_DIMENSION = 512;
  let activeSharpOps = 0;
  const sharpQueue: Array<{ resolve: () => void; reject: (err: Error) => void }> = [];

  function acquireSharpSlot(): Promise<void> {
    if (activeSharpOps < MAX_CONCURRENT_SHARP) {
      activeSharpOps++;
      return Promise.resolve();
    }
    if (sharpQueue.length >= MAX_SHARP_QUEUE) {
      return Promise.reject(new Error('Image processing queue full'));
    }
    return new Promise<void>((resolve, reject) => {
      sharpQueue.push({ resolve: () => { activeSharpOps++; resolve(); }, reject });
    });
  }

  function releaseSharpSlot(): void {
    activeSharpOps--;
    if (sharpQueue.length > 0) {
      const next = sharpQueue.shift()!;
      next.resolve();
    }
  }

  // IMAGE PROXY: Serves optimized, resized images with WebP conversion
  app.get("/api/image/*path", async (req, res) => {
    let slotAcquired = false;
    try {
      const rawParam = (req.params as any).path ?? (req.params as any)[0];
      const urlPath = Array.isArray(rawParam) ? rawParam.join('/') : (rawParam ?? '');
      let originalUrl;
      
      try {
        if (!urlPath || urlPath.length === 0) {
          throw new Error('Empty URL path');
        }

        const base64 = urlPath.replace(/-/g, '+').replace(/_/g, '/');
        const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
        
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(padded)) {
          throw new Error('Invalid base64 format');
        }
        
        const decoded = Buffer.from(padded, 'base64').toString('utf8');
        
        if (decoded.startsWith('http://') || decoded.startsWith('https://')) {
          try {
            new URL(decoded);
            originalUrl = decoded;
          } catch (urlError) {
            throw new Error('Invalid URL structure');
          }
        } else {
          throw new Error('URL must start with http:// or https://');
        }
      } catch (error: any) {
        return res.status(400).json({ error: 'Invalid image URL encoding' });
      }

      // SSRF guard: image proxy can be invoked with arbitrary URL, so verify
      // the destination is public before fetching. Allow any port — many radio
      // hosts serve logos from non-standard CDN ports.
      {
        const guarded = await validateOutboundUrl(originalUrl, {
          allowHttp: true,
          blockedPorts: STREAM_BLOCKED_PORTS,
        });
        if (!guarded.ok) {
          return res.status(400).json({ error: 'URL not allowed' });
        }
      }

      const width = req.query.w ? parseInt(req.query.w as string) : null;
      const height = req.query.h ? parseInt(req.query.h as string) : null;
      const size = req.query.size ? parseInt(req.query.size as string) : null;
      
      let targetWidth = Math.min(width || size || 180, MAX_TARGET_DIMENSION);
      let targetHeight = Math.min(height || size || 180, MAX_TARGET_DIMENSION);

      const acceptHeader = req.headers.accept || '';

      if (req.method === 'OPTIONS') {
        return res.status(200).end();
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      let response;
      try {
        const fetch = (await import('node-fetch')).default;
        response = await fetch(originalUrl, {
          method: 'GET',
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Cache-Control': 'no-cache',
            'Connection': 'close'
          }
        });
      } catch (fetchError: any) {
        return res.status(404).json({ error: 'Image not accessible' });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!response.ok) {
        try { response.body?.destroy?.(); } catch {}
        return res.status(404).json({ error: 'Image not found or inaccessible' });
      }

      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('text/html') || contentType.includes('text/xml') || 
          contentType.includes('application/json') || contentType.includes('application/xml')) {
        try { response.body?.destroy?.(); } catch {}
        return res.status(404).json({ error: 'Not an image' });
      }

      const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
      if (contentLength > MAX_IMAGE_DOWNLOAD_BYTES) {
        try { response.body?.destroy?.(); } catch {}
        return res.status(413).json({ error: 'Image too large' });
      }

      let imageBuffer: Buffer | null = null;
      try {
        const chunks: Buffer[] = [];
        let totalSize = 0;
        for await (const chunk of response.body as any) {
          totalSize += chunk.length;
          if (totalSize > MAX_IMAGE_DOWNLOAD_BYTES) {
            throw new Error('Image exceeds size limit');
          }
          chunks.push(Buffer.from(chunk));
        }
        imageBuffer = Buffer.concat(chunks);
      } catch (bufferError: any) {
        return res.status(413).json({ error: 'Image too large or download failed' });
      }

      if (!imageBuffer || imageBuffer.length < 8) {
        return res.status(404).json({ error: 'Empty or invalid image' });
      }

      const header = imageBuffer.slice(0, 16).toString('hex');
      const headerStr = imageBuffer.slice(0, 5).toString('ascii');
      const isLikelyImage = (
        header.startsWith('89504e47') ||    // PNG
        header.startsWith('ffd8ff') ||      // JPEG
        header.startsWith('47494638') ||    // GIF
        header.startsWith('52494646') ||    // WEBP (RIFF)
        header.startsWith('424d') ||        // BMP
        header.startsWith('00000') ||       // ICO / AVIF
        headerStr.startsWith('<?xml') ||    // SVG
        headerStr.startsWith('<svg')         // SVG
      );

      if (!isLikelyImage && (headerStr.startsWith('<!DOC') || headerStr.startsWith('<html') || headerStr.startsWith('<HTML'))) {
        imageBuffer = null;
        return res.status(404).json({ error: 'HTML page returned instead of image' });
      }

      await acquireSharpSlot();
      slotAcquired = true;

      const sharp = (await import('sharp')).default;
      
      const useAVIF = acceptHeader.includes('image/avif');
      const outputContentType = useAVIF ? 'image/avif' : 'image/webp';
      
      let optimizedImage: Buffer;
      try {
        const pipeline = sharp(imageBuffer, { limitInputPixels: 50_000_000 })
          .resize(targetWidth, targetHeight, { fit: 'cover', position: 'center' });
        optimizedImage = useAVIF
          ? await pipeline.avif({ quality: 75, effort: 2 }).toBuffer()
          : await pipeline.webp({ quality: 80, effort: 3 }).toBuffer();
      } catch (sharpError: any) {
        imageBuffer = null;
        return res.status(404).json({ error: 'Image format not supported' });
      }

      imageBuffer = null;

      res.setHeader('Content-Type', outputContentType);
      res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800');
      res.setHeader('Vary', 'Accept');
      res.setHeader('Content-Length', optimizedImage.length);
      res.setHeader('Content-Encoding', 'identity');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      
      res.send(optimizedImage);

    } catch (error) {
      if (!res.headersSent) {
        res.status(500).json({ error: 'Image proxy failed' });
      }
    } finally {
      if (slotAcquired) releaseSharpSlot();
    }
  });

  // STREAM RESOLVER: Parse PLS/M3U playlists and return stream URL candidates
  app.get("/api/stream/resolve", async (req, res) => {
    try {
      const { url } = req.query;
      if (!url || typeof url !== 'string' || url.length > 2048) {
        return res.status(400).json({ error: 'Missing url parameter' });
      }
      // SSRF guard. Stream URLs use a wide port range so we permit any port
      // except well-known internal-service ports.
      {
        const guarded = await validateOutboundUrl(url, {
          allowHttp: true,
          blockedPorts: STREAM_BLOCKED_PORTS,
        });
        if (!guarded.ok) {
          return res.status(400).json({ error: 'URL not allowed' });
        }
      }

      const fetch = (await import('node-fetch')).default;
      const urlLower = url.toLowerCase();
      
      const isPLS = urlLower.includes('.pls') || urlLower.includes('listen.pls') || 
                    urlLower.includes('/pls') || urlLower.includes('-pls') || 
                    urlLower.includes('tunein') || urlLower.includes('sid=');
      const isM3U = (urlLower.includes('.m3u') || urlLower.includes('/m3u')) && !urlLower.includes('.m3u8');
      const isM3U8 = urlLower.includes('.m3u8');
      
      const candidates: string[] = [];
      let playlistType: string = 'direct';
      
      if (isPLS || isM3U) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        try {
          const response = await fetch(url, {
            signal: controller.signal,
            headers: {
              'User-Agent': 'VLC/3.0.18 LibVLC/3.0.18',
              'Accept': '*/*'
            }
          });

          if (response.ok) {
            // Cap playlist body at 256KB. Real PLS/M3U files are well under
            // 8KB; without this cap a malicious server can return a multi-MB
            // body and amplify ext memory pressure.
            const MAX_PLAYLIST_BYTES = 256 * 1024;
            let content = '';
            try {
              const ct = (response.headers.get('content-type') || '').toLowerCase();
              // Streamtheworld and many shoutcast/icecast hosts serve .pls
              // with `audio/x-scpls` and .m3u with `audio/x-mpegurl`. We MUST
              // accept those, otherwise the body is dropped, the candidate
              // list is empty, and the resolver falls back to returning the
              // playlist URL itself as a "candidate" — which Chrome then
              // tries to play as audio and fails with FFmpegDemuxer error.
              if (ct && !/text|playlist|mpegurl|scpls|audio|x-mixed|application\/(?:x-)?(?:m3u|pls|octet-stream)|^$/.test(ct)) {
                // unexpected binary type — refuse
                content = '';
              } else if ((response as any).body && typeof (response as any).body.getReader === 'function') {
                const reader = (response as any).body.getReader();
                let received = 0;
                const decoder = new TextDecoder('utf-8', { fatal: false });
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  received += value.length;
                  if (received > MAX_PLAYLIST_BYTES) { try { await reader.cancel(); } catch {}; break; }
                  content += decoder.decode(value, { stream: true });
                }
                content += decoder.decode();
              } else {
                const buf = await response.buffer();
                content = buf.subarray(0, MAX_PLAYLIST_BYTES).toString('utf8');
              }
            } catch {
              content = '';
            }

            if (isPLS) {
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
        } finally {
          clearTimeout(timeoutId);
        }
      } else if (isM3U8) {
        playlistType = 'hls';
        candidates.push(url);
      }
      
      if (!candidates.includes(url)) {
        candidates.push(url);
      }
      
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
  app.get("/api/stream/*path", async (req, res) => {
    if (activeStreamCount >= MAX_CONCURRENT_STREAMS) {
      return res.status(503).json({ error: 'Server at stream capacity, try again later' });
    }

    const clientIp = getClientIp(req);
    if (!incrementIpStream(clientIp)) {
      return res.status(429).json({ error: 'Too many concurrent streams from this IP' });
    }

    activeStreamCount++;
    const streamId = ++streamIdCounter;
    let streamReleased = false;
    const releaseSlot = () => {
      if (streamReleased) return;
      streamReleased = true;
      if (activeStreamCount > 0) activeStreamCount--;
      decrementIpStream(clientIp);
    };

    // Stream termination signal: any of close/error/aborted on req or res
    // resolves the promise. The outer try/finally below awaits this and then
    // unconditionally removes the registry entry, so leaked entries cannot
    // outlive the underlying connection.
    const streamTerminated = new Promise<void>((resolve) => {
      const done = () => resolve();
      res.once('close', done);
      res.once('error', done);
      req.once('close', done);
      req.once('aborted', done);
      req.once('error', done);
    });

    let originalUrl: string | undefined;
    try {
      const rawParam = (req.params as any).path ?? (req.params as any)[0];
      const urlPath = Array.isArray(rawParam) ? rawParam.join('/') : (rawParam ?? '');
      try {
        const base64 = urlPath.replace(/-/g, '+').replace(/_/g, '/');
        const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
        const decoded = Buffer.from(padded, 'base64').toString('utf8');
        
        if (decoded.startsWith('http://') || decoded.startsWith('https://')) {
          // SSRF guard: stream proxy is the largest attack surface (any user
          // can craft a base64-encoded URL). Reject internal/private IPs.
          const guarded = await validateOutboundUrl(decoded, {
            allowHttp: true,
            blockedPorts: STREAM_BLOCKED_PORTS,
          });
          if (!guarded.ok) {
            releaseSlot();
            return res.status(400).json({ error: 'Stream URL not allowed' });
          }
          originalUrl = decoded;
        } else {
          throw new Error('Invalid decoded URL format');
        }
      } catch (e) {
        try {
          const fallback = decodeURIComponent(urlPath);
          if (!fallback.startsWith('http://') && !fallback.startsWith('https://')) {
            throw new Error('Invalid URL format after decoding');
          }
          // SSRF: this fallback path was previously unguarded — an attacker
          // could URL-encode an internal target and bypass the base64 guard.
          const guardedFallback = await validateOutboundUrl(fallback, {
            allowHttp: true,
            blockedPorts: STREAM_BLOCKED_PORTS,
          });
          if (!guardedFallback.ok) {
            releaseSlot();
            return res.status(400).json({ error: 'Stream URL not allowed' });
          }
          originalUrl = fallback;
        } catch (fallbackError) {
          releaseSlot();
          return res.status(400).json({ error: 'Invalid stream URL format' });
        }
      }
      
      logger.log(`🎵 RADIOLISE SIMPLE PROXY: Direct streaming for:`, originalUrl);
      
      const userAgent = req.get('User-Agent') || '';
      const isChrome = /Chrome/.test(userAgent) && !/Edg/.test(userAgent);
      logger.log(`🌐 Browser detection: ${isChrome ? 'Chrome' : 'Other'}`);
      
      const isKnownDirectStream = (
        originalUrl.includes('46.20.7.126') || 
        originalUrl.includes('/;stream.mp3') ||
        originalUrl.includes('stream.mp3') ||
        originalUrl.includes('/stream') ||
        originalUrl.includes('/audio') ||
        originalUrl.includes('/live') ||
        originalUrl.includes('/radio') ||
        originalUrl.includes('.mp3') ||
        originalUrl.includes('.aac') ||
        originalUrl.includes('.ogg') ||
        originalUrl.includes('.opus') ||
        originalUrl.match(/:(8000|8080|8443|9000|1935|3000|5000)\//) ||
        originalUrl.includes('icecast') ||
        originalUrl.includes('shoutcast') ||
        (originalUrl.startsWith('http://') && !originalUrl.includes('.m3u8') && !originalUrl.includes('.pls'))
      );
      
      if (isKnownDirectStream) {
        logger.log(`🎯 DIRECT STREAM DETECTED: Using consistent source without re-resolution`);
      }
      
      const fetch = (await import('node-fetch')).default;
      
      const isHLS = originalUrl.includes('.m3u8') || originalUrl.includes('/hls/');
      const isShoutcast = originalUrl.includes('radyositesihazir.com') || 
                         originalUrl.match(/:8\d{3}(\/|$)/) || 
                         originalUrl.match(/:9\d{3}(\/|$)/) || 
                         originalUrl.match(/:1\d{4}(\/|$)/) || 
                         originalUrl.match(/:7\d{3}(\/|$)/) || 
                         originalUrl.match(/:\d{4,5}(\/|$)/);
      
      res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, Content-Type');
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Connection', 'close');
      
      if (isShoutcast) {
        logger.log('📻 SHOUTCAST DETECTED: Using native HTTP with VLC-style headers');
        const http = await import('http');
        const https = await import('https');
        const urlModule = await import('url');
        
        let activeProxyReq: any = null;
        let activeCleanup: (() => void) | null = null;

        let shoutcastMaxTimer: ReturnType<typeof setTimeout> | null = null;

        const destroyActiveProxy = () => {
          if (shoutcastMaxTimer) { clearTimeout(shoutcastMaxTimer); shoutcastMaxTimer = null; }
          if (activeCleanup) activeCleanup();
          else {
            if (activeProxyReq) { try { activeProxyReq.destroy(); } catch {} }
            releaseSlot();
          }
        };

        req.once('close', destroyActiveProxy);
        req.once('aborted', destroyActiveProxy);
        req.once('error', destroyActiveProxy);
        res.once('close', destroyActiveProxy);
        res.once('error', destroyActiveProxy);

        activeStreamRegistry.set(streamId, { cleanup: destroyActiveProxy, startedAt: Date.now(), ip: clientIp });

        shoutcastMaxTimer = setTimeout(() => {
          logger.log('⏰ Shoutcast max duration reached, closing stream');
          shoutcastMaxTimer = null;
          destroyActiveProxy();
        }, MAX_STREAM_DURATION_MS);

        const makeShoutcastRequest = (targetUrl: string, redirectCount = 0): void => {
          if (redirectCount > 5) {
            if (!res.headersSent) res.status(500).json({ error: 'Too many redirects' });
            destroyActiveProxy();
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
              'Icy-MetaData': '0',
              'Connection': 'close'
            },
            insecureHTTPParser: true
          }, (proxyRes) => {
            if (proxyRes.statusCode && proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
              logger.log(`🔀 Shoutcast redirect (${proxyRes.statusCode}): ${proxyRes.headers.location}`);
              proxyRes.destroy();
              // SSRF: re-validate redirect target — a malicious origin could
              // 302 us into 169.254.169.254 or other internal addresses.
              const nextUrl = (() => {
                try { return new urlModule.URL(proxyRes.headers.location!, targetUrl).toString(); }
                catch { return null; }
              })();
              if (!nextUrl) {
                if (!res.headersSent) res.status(502).json({ error: 'Malformed redirect' });
                destroyActiveProxy();
                return;
              }
              validateOutboundUrl(nextUrl, { allowHttp: true, blockedPorts: STREAM_BLOCKED_PORTS })
                .then((guard) => {
                  if (!guard.ok) {
                    logger.log(`🚫 Shoutcast redirect blocked by SSRF guard: ${guard.reason}`);
                    if (!res.headersSent) res.status(502).json({ error: 'Redirect blocked' });
                    destroyActiveProxy();
                    return;
                  }
                  makeShoutcastRequest(nextUrl, redirectCount + 1);
                })
                .catch(() => {
                  if (!res.headersSent) res.status(502).json({ error: 'Redirect validation failed' });
                  destroyActiveProxy();
                });
              return;
            }
            
            if (!res.headersSent) {
              let contentType = proxyRes.headers['content-type'] || 
                                 (proxyRes.headers as any)['icy-content-type'] || 
                                 'audio/mpeg';
              if (contentType === 'audio/aacp' || contentType === 'audio/aac+') {
                contentType = 'audio/aac';
              }
              res.setHeader('Content-Type', contentType);
              res.setHeader('Cache-Control', 'no-cache');
              res.setHeader('Transfer-Encoding', 'chunked');
              logger.log(`✅ Shoutcast VLC streaming: ${contentType}`);
            }

            let lastDataTime = Date.now();
            proxyRes.on('data', () => { lastDataTime = Date.now(); });

            const idleCheckInterval = setInterval(() => {
              if (Date.now() - lastDataTime > STREAM_IDLE_TIMEOUT_MS) {
                logger.log('⏰ Shoutcast stream idle timeout, closing');
                clearInterval(idleCheckInterval);
                cleanup();
              }
            }, 15_000);

            proxyRes.pipe(res);

            let cleaned = false;
            const cleanup = () => {
              if (cleaned) return;
              cleaned = true;
              if (shoutcastMaxTimer) { clearTimeout(shoutcastMaxTimer); shoutcastMaxTimer = null; }
              clearInterval(idleCheckInterval);
              try { proxyRes.unpipe(res); } catch {}
              try { proxyRes.destroy(); } catch {}
              try { proxyReq.destroy(); } catch {}
              try { if (!res.writableEnded) res.end(); } catch {}
              releaseSlot();
            };
            activeCleanup = cleanup;

            proxyRes.on('error', (e) => {
              if (!e.message?.includes('aborted')) {
                console.error('❌ Shoutcast stream error:', e.message);
              }
              if (!res.headersSent) res.status(500).json({ error: 'Stream failed' });
              cleanup();
            });

            proxyRes.on('end', cleanup);
            proxyRes.on('close', cleanup);
          });

          activeProxyReq = proxyReq;
          
          proxyReq.on('error', (e: any) => {
            if (shoutcastMaxTimer) { clearTimeout(shoutcastMaxTimer); shoutcastMaxTimer = null; }
            if (!e.message?.includes('aborted')) {
              console.error('❌ Shoutcast request error:', e.message);
            }
            if (!res.headersSent) res.status(500).json({ error: 'Connection failed' });
            releaseSlot();
          });
          
          proxyReq.end();
        };
        
        makeShoutcastRequest(originalUrl);
        await streamTerminated;
        return;
      }
      
      logger.log('🎵 Simple direct proxy streaming (no FFmpeg, no multiplexing)');
      
      const controller = new AbortController();
      const connectTimeoutId = setTimeout(() => controller.abort(), 30000);

      let streamResponse;
      try {
        // SSRF: manually follow redirects and revalidate every hop. A public
        // origin could 30x us into 169.254.169.254 / internal IPs otherwise.
        let currentUrl = originalUrl;
        const MAX_REDIRECTS = 5;
        let lastRes: Response | null = null;
        for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
          const guard = await validateOutboundUrl(currentUrl, {
            allowHttp: true,
            blockedPorts: STREAM_BLOCKED_PORTS,
          });
          if (!guard.ok) {
            throw new Error(`Stream redirect blocked by SSRF guard: ${guard.reason}`);
          }
          // Always present as a media player UA. Forwarding the browser UA
          // causes some origins (e.g. stream.zeno.fm) to reject us with HTTP
          // 401 because they gate streaming behind "real player" checks.
          // VLC is accepted by virtually every Shoutcast/Icecast/CDN host.
          lastRes = await fetch(currentUrl, {
            signal: controller.signal,
            redirect: 'manual',
            headers: {
              'User-Agent': 'VLC/3.0.20 LibVLC/3.0.20',
              'Accept': 'audio/*, application/vnd.apple.mpegurl, */*',
              'Connection': 'close',
              ...(req.headers.range && { 'Range': req.headers.range as string })
            }
          });
          if (lastRes.status >= 300 && lastRes.status < 400) {
            const loc = lastRes.headers.get('location');
            if (!loc) break;
            if (hop === MAX_REDIRECTS) {
              throw new Error('Stream redirect: too many hops');
            }
            try {
              currentUrl = new URL(loc, currentUrl).toString();
            } catch {
              throw new Error('Stream redirect: malformed Location');
            }
            try { await (lastRes.body as any)?.cancel?.(); } catch {}
            continue;
          }
          break;
        }
        streamResponse = lastRes!;
      } finally {
        clearTimeout(connectTimeoutId);
      }

      if (!streamResponse.ok) {
        throw new Error(`Stream fetch failed: ${streamResponse.status}`);
      }

      const contentType = streamResponse.headers.get('Content-Type') || 'audio/mpeg';
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'no-cache');

      if (streamResponse.body) {
        const body = streamResponse.body as any;

        let lastDataTime = Date.now();
        body.on('data', () => { lastDataTime = Date.now(); });

        let cleaned = false;
        const cleanup = (reason: string) => {
          if (cleaned) return;
          cleaned = true;
          clearTimeout(maxDurationTimer);
          clearInterval(idleCheckInterval);
          try { controller.abort(); } catch {}
          try { body.unpipe(res); } catch {}
          try { if (typeof body.destroy === 'function') body.destroy(); } catch {}
          try { if (!res.writableEnded) res.end(); } catch {}
          releaseSlot();
        };

        activeStreamRegistry.set(streamId, { cleanup: () => cleanup('memory-pressure'), startedAt: Date.now(), ip: clientIp });

        const maxDurationTimer = setTimeout(() => {
          logger.log('⏰ Direct stream max duration reached, closing');
          cleanup('max-duration');
        }, MAX_STREAM_DURATION_MS);

        const idleCheckInterval = setInterval(() => {
          if (Date.now() - lastDataTime > STREAM_IDLE_TIMEOUT_MS) {
            logger.log('⏰ Direct stream idle timeout, closing');
            cleanup('idle-timeout');
          }
        }, 15_000);

        body.pipe(res);

        body.on('error', (e: any) => {
          if (!e.message?.includes('aborted')) {
            console.error('❌ Stream body error:', e.message);
          }
          cleanup('body-error');
        });

        body.on('end', () => cleanup('body-end'));
        body.on('close', () => cleanup('body-close'));

        // Cover every termination signal so cleanup() releases pipe/timer
        // resources promptly. The outer try/finally is the authoritative
        // guarantee that the registry entry itself is removed.
        req.on('close', () => cleanup('req-close'));
        req.on('aborted', () => cleanup('req-aborted'));
        req.on('error', () => cleanup('req-error'));
        res.on('close', () => cleanup('res-close'));
        res.on('error', () => cleanup('res-error'));

        await streamTerminated;
      } else {
        throw new Error('Response body is null');
      }

    } catch (error: any) {
      if (error?.name !== 'AbortError' && !error?.message?.includes('aborted')) {
        console.error('❌ Stream proxy error:', error.message);
      }
      if (!res.headersSent) {
        res.status(500).json({ error: 'Streaming failed' });
      }
      try { if (!res.writableEnded) res.end(); } catch {}
    } finally {
      // Authoritative lifecycle close: regardless of which branch ran or how
      // it terminated (success, throw, abort, pipe error), the registry entry
      // and per-IP / global counters are released exactly once here.
      activeStreamRegistry.delete(streamId);
      releaseSlot();
    }
  });
}
