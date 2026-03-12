import type { Express } from "express";
import { Station } from "../../shared/mongo-schemas";
import { logger } from "../utils/logger";

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

  const MAX_IMAGE_DOWNLOAD_BYTES = 2 * 1024 * 1024; // 2 MB max download
  const MAX_CONCURRENT_SHARP = 6; // max simultaneous Sharp operations
  const MAX_TARGET_DIMENSION = 512; // cap resize dimensions
  let activeSharpOps = 0;
  const sharpQueue: Array<() => void> = [];

  function acquireSharpSlot(): Promise<void> {
    if (activeSharpOps < MAX_CONCURRENT_SHARP) {
      activeSharpOps++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      sharpQueue.push(() => { activeSharpOps++; resolve(); });
    });
  }

  function releaseSharpSlot(): void {
    activeSharpOps--;
    if (sharpQueue.length > 0) {
      const next = sharpQueue.shift()!;
      next();
    }
  }

  // IMAGE PROXY: Serves optimized, resized images with WebP conversion
  app.get("/api/image/*", async (req, res) => {
    let slotAcquired = false;
    try {
      const urlPath = (req.params as any)[0];
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

      const width = req.query.w ? parseInt(req.query.w as string) : null;
      const height = req.query.h ? parseInt(req.query.h as string) : null;
      const size = req.query.size ? parseInt(req.query.size as string) : null;
      
      let targetWidth = Math.min(width || size || 180, MAX_TARGET_DIMENSION);
      let targetHeight = Math.min(height || size || 180, MAX_TARGET_DIMENSION);

      const acceptHeader = req.headers.accept || '';

      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type, Accept, User-Agent');

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
            'Cache-Control': 'no-cache'
          }
        });
      } catch (fetchError: any) {
        return res.status(404).json({ error: 'Image not accessible' });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!response.ok) {
        return res.status(404).json({ error: 'Image not found or inaccessible' });
      }

      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('text/html') || contentType.includes('text/xml') || 
          contentType.includes('application/json') || contentType.includes('application/xml')) {
        return res.status(404).json({ error: 'Not an image' });
      }

      const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
      if (contentLength > MAX_IMAGE_DOWNLOAD_BYTES) {
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
      if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: 'Missing url parameter' });
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
  app.get("/api/stream/*", async (req, res) => {
    // Override server timeout for stream connections — these are long-lived by design
    req.setTimeout(0);
    res.setTimeout(0);

    let originalUrl: string | undefined;
    try {
      const urlPath = (req.params as any)[0];
      try {
        const base64 = urlPath.replace(/-/g, '+').replace(/_/g, '/');
        const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
        const decoded = Buffer.from(padded, 'base64').toString('utf8');
        
        if (decoded.startsWith('http://') || decoded.startsWith('https://')) {
          originalUrl = decoded;
        } else {
          throw new Error('Invalid decoded URL format');
        }
      } catch (e) {
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
      
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS, HEAD');
      res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type, Accept, User-Agent');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, Content-Type');
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Connection', 'keep-alive');
      
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
              'Icy-MetaData': '0',
              'Connection': 'keep-alive'
            },
            insecureHTTPParser: true,
            rejectUnauthorized: false
          }, (proxyRes) => {
            if (proxyRes.statusCode && proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
              logger.log(`🔀 Shoutcast redirect (${proxyRes.statusCode}): ${proxyRes.headers.location}`);
              proxyRes.destroy();
              makeShoutcastRequest(proxyRes.headers.location, redirectCount + 1);
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
            proxyRes.pipe(res);

            let cleaned = false;
            const cleanup = (reason: string) => {
              if (cleaned) return;
              cleaned = true;
              try { proxyRes.unpipe(res); } catch {}
              try { proxyRes.destroy(); } catch {}
              try { proxyReq.destroy(); } catch {}
              try { if (!res.writableEnded) res.end(); } catch {}
            };

            proxyRes.on('error', (e) => {
              if (e.message !== 'aborted') {
                console.error('❌ Shoutcast stream error:', e.message);
              }
              if (!res.headersSent) res.status(500).json({ error: 'Stream failed' });
              cleanup('proxyRes-error');
            });

            proxyRes.on('end', () => cleanup('proxyRes-end'));
            proxyRes.on('close', () => cleanup('proxyRes-close'));
          });
          
          proxyReq.on('error', (e: any) => {
            if (e.message !== 'aborted') {
              console.error('❌ Shoutcast request error:', e.message);
            }
            if (!res.headersSent) res.status(500).json({ error: 'Connection failed' });
          });
          
          req.on('close', () => {
            try { proxyReq.destroy(); } catch {}
          });
          
          res.on('close', () => {
            try { proxyReq.destroy(); } catch {}
          });
          
          proxyReq.end();
        };
        
        makeShoutcastRequest(originalUrl);
        return;
      }
      
      logger.log('🎵 Simple direct proxy streaming (no FFmpeg, no multiplexing)');
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000);
      
      const streamResponse = await fetch(originalUrl, {
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (Radio/1.0)',
          'Accept': req.headers['accept'] || 'audio/*, application/vnd.apple.mpegurl, */*',
          'Connection': 'keep-alive',
          ...(req.headers.range && { 'Range': req.headers.range as string })
        }
      });
      
      clearTimeout(timeoutId);
      
      if (!streamResponse.ok) {
        throw new Error(`Stream fetch failed: ${streamResponse.status}`);
      }
      
      const contentType = streamResponse.headers.get('Content-Type') || 'audio/mpeg';
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'no-cache');

      if (streamResponse.body) {
        const body = streamResponse.body;
        body.pipe(res);

        let cleaned = false;
        const cleanup = (reason: string) => {
          if (cleaned) return;
          cleaned = true;
          controller.abort();
          try { body.unpipe(res); } catch {}
          try { body.destroy(); } catch {}
          try { if (!res.writableEnded) res.end(); } catch {}
        };
        
        body.on('error', (e: any) => {
          if (e.message !== 'The operation was aborted') {
            console.error('❌ Stream body error:', e.message);
          }
          cleanup('body-error');
        });

        body.on('end', () => cleanup('body-end'));
        body.on('close', () => cleanup('body-close'));

        req.on('close', () => cleanup('req-close'));
        res.on('close', () => cleanup('res-close'));
      } else {
        throw new Error('Response body is null');
      }

    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error('❌ Simple stream error:', error.message);
      }
      if (!res.headersSent) {
        res.status(500).json({ error: 'Streaming failed' });
      }
      try { if (!res.writableEnded) res.end(); } catch {}
    }
  });
}
