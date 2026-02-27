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

  // IMAGE PROXY: Serves optimized, resized images with WebP conversion
  app.get("/api/image/*", async (req, res) => {
    try {
      // Get the full path after /api/image/ and decode base64
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
        console.error('❌ Image proxy: URL decode error:', error.message, 'for path:', urlPath);
        return res.status(400).json({ error: 'Invalid image URL encoding' });
      }

      const width = req.query.w ? parseInt(req.query.w as string) : null;
      const height = req.query.h ? parseInt(req.query.h as string) : null;
      const size = req.query.size ? parseInt(req.query.size as string) : null;
      
      let targetWidth = width || size || 180;
      let targetHeight = height || size || 180;

      const acceptHeader = req.headers.accept || '';
      const preferAVIF = acceptHeader.includes('image/avif');
      const format = preferAVIF ? 'avif' : 'webp';
      const imageCacheKey = `image_proxy:${urlPath}:${targetWidth}x${targetHeight}:${format}`;
      
      const CacheManager = (await import('../cache')).default;
      const cachedImage = await CacheManager.get(imageCacheKey);
      if (cachedImage && Buffer.isBuffer(cachedImage)) {
        res.setHeader('Content-Type', preferAVIF ? 'image/avif' : 'image/webp');
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.setHeader('X-Cache', 'HIT');
        res.setHeader('Content-Length', cachedImage.length);
        return res.send(cachedImage);
      }

      logger.log(`🖼️ IMAGE PROXY: ${originalUrl} → ${targetWidth}x${targetHeight}px WebP`);

      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type, Accept, User-Agent');

      if (req.method === 'OPTIONS') {
        return res.status(200).end();
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      let response;
      try {
        const fetch = (await import('node-fetch')).default;
        response = await fetch(originalUrl, {
          method: 'GET',
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Cache-Control': 'no-cache',
            ...(req.headers.range && { 'Range': req.headers.range as string })
          }
        });
      } catch (fetchError: any) {
        // Downgrade network errors to warn (noisy in production)
        console.warn(`Image proxy network error: ${fetchError.message}`);
        return res.status(404).json({ error: 'Image not accessible' });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!response.ok) {
        if (response.status !== 404) {
          console.warn(`⚠️ Image proxy: ${response.status} for ${originalUrl}`);
        }
        return res.status(404).json({ error: 'Image not found or inaccessible' });
      }

      let imageBuffer;
      try {
        imageBuffer = Buffer.from(await response.arrayBuffer());
      } catch (bufferError: any) {
        console.error(`❌ Image proxy buffer error: ${bufferError.message}`);
        return res.status(404).json({ error: 'Failed to process image' });
      }
      
      const sharp = (await import('sharp')).default;
      
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
      } catch (sharpError: any) {
        console.error(`Image proxy Sharp error: ${sharpError.message}`);
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        return res.send(imageBuffer);
      }

      let contentType = 'image/webp';
      let optimizedImage = optimizedImageWebP;
      
      if (acceptHeader.includes('image/avif')) {
        contentType = 'image/avif';
        optimizedImage = optimizedImageAVIF;
        logger.log(`🖼️ IMAGE PROXY: AVIF compression (${Math.round((1 - optimizedImageAVIF.length / imageBuffer.length) * 100)}% smaller)`);
      } else {
        logger.log(`🖼️ IMAGE PROXY: WebP compression (${Math.round((1 - optimizedImageWebP.length / imageBuffer.length) * 100)}% smaller)`);
      }

      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('Vary', 'Accept');
      
      const urlHash = Buffer.from(`${originalUrl}-${targetWidth}x${targetHeight}-${contentType}`).toString('base64').slice(0, 16);
      res.setHeader('ETag', `"img-${urlHash}"`);
      res.setHeader('Last-Modified', new Date(Date.now() - 86400000).toUTCString());
      res.setHeader('Content-Length', optimizedImage.length);
      res.setHeader('Content-Encoding', 'identity');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      
      logger.log(`✅ Image optimized: ${imageBuffer.length} bytes → ${optimizedImage.length} bytes (${Math.round((1 - optimizedImage.length / imageBuffer.length) * 100)}% smaller) as ${contentType}`);
      
      const imageCacheKeyToStore = `image_proxy:${urlPath}:${targetWidth}x${targetHeight}:${contentType.split('/')[1]}`;
      await CacheManager.set(imageCacheKeyToStore, optimizedImage, { ttl: 3600 });
      
      res.setHeader('X-Cache', 'MISS');
      res.send(optimizedImage);

    } catch (error) {
      console.error('❌ Image proxy error:', error);
      res.status(500).json({ error: 'Image proxy failed' });
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
        streamResponse.body.pipe(res);
      } else {
        throw new Error('Response body is null');
      }

      req.on('close', () => {
        controller.abort();
      });

    } catch (error: any) {
      console.error('❌ Simple stream error:', error.message);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Streaming failed' });
      }
    }
  });
}
