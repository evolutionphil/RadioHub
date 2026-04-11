import axios from 'axios';
import http from 'http';
import https from 'https';

const noKeepAliveHttpAgent = new http.Agent({ keepAlive: false, maxSockets: 10, timeout: 10000 });
const noKeepAliveHttpsAgent = new https.Agent({ keepAlive: false, maxSockets: 10, timeout: 10000 });

export interface MetadataResult {
  title?: string;
  artist?: string;
  station?: string;
  genre?: string;
}

export class StreamMetadataService {
  private metadataCache = new Map<string, { data: MetadataResult; timestamp: number }>();
  private cacheTimeout = 10000;

  async fetchAudioMetaWithAxios(streamUrl: string): Promise<MetadataResult> {
    let stream: any = null;
    const controller = new AbortController();
    const killTimer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await axios.get(streamUrl, {
        timeout: 8000,
        signal: controller.signal,
        headers: {
          'Icy-MetaData': '1',
          'User-Agent': 'MegaRadio/1.0'
        },
        responseType: 'stream',
        maxRedirects: 5,
        httpAgent: noKeepAliveHttpAgent,
        httpsAgent: noKeepAliveHttpsAgent
      });

      stream = response.data;

      const icyName = response.headers['icy-name'];
      const icyGenre = response.headers['icy-genre'];

      const result: MetadataResult = icyName ? {
        title: icyName as string,
        station: icyName as string,
        genre: icyGenre as string || undefined
      } : {};

      return result;
    } catch (error: any) {
      return {};
    } finally {
      clearTimeout(killTimer);
      if (stream) {
        try { stream.destroy(); } catch {}
      }
    }
  }

  async fetchAudioMeta(streamUrl: string): Promise<MetadataResult> {
    const timeoutMs = 10000;
    
    return new Promise((resolve) => {
      let resolved = false;
      let req: http.ClientRequest | undefined;
      let res: http.IncomingMessage | undefined;

      const safeResolve = (result: MetadataResult) => {
        if (resolved) return;
        resolved = true;
        try { if (res) res.destroy(); } catch {}
        try { if (req) req.destroy(); } catch {}
        resolve(result);
      };

      const hardKill = setTimeout(() => safeResolve({}), timeoutMs + 2000);

      try {
        const url = new URL(streamUrl);
        const isHttps = url.protocol === 'https:';
        const httpModule = isHttps ? https : http;
        
        const options = {
          hostname: url.hostname,
          port: url.port || (isHttps ? 443 : 80),
          path: url.pathname + url.search,
          method: 'GET',
          headers: {
            'Icy-MetaData': '1',
            'User-Agent': 'MegaRadio/1.0 MetadataClient',
            'Accept': '*/*',
            'Connection': 'close',
            'Range': 'bytes=0-1024'
          },
          timeout: timeoutMs,
          agent: isHttps ? noKeepAliveHttpsAgent : noKeepAliveHttpAgent
        };

        req = httpModule.request(options, (incomingRes) => {
          res = incomingRes;

          if ([301, 302, 307, 308].includes(res.statusCode || 0) && res.headers['location']) {
            const location = res.headers['location'] as string;
            safeResolve({});
            clearTimeout(hardKill);
            this.fetchAudioMetaWithAxios(location).then(r => {
              if (!resolved) resolve(r);
            });
            return;
          }

          const icyMetaint = res.headers['icy-metaint'];
          const icyName = res.headers['icy-name'];
          const icyGenre = res.headers['icy-genre'];

          if (!icyMetaint || parseInt(icyMetaint as string) <= 0) {
            clearTimeout(hardKill);
            if (icyName) {
              safeResolve({
                title: icyName as string,
                station: icyName as string,
                genre: icyGenre as string || undefined
              });
            } else {
              safeResolve({});
            }
            return;
          }

          const metaInterval = parseInt(icyMetaint as string);
          if (!Number.isFinite(metaInterval) || metaInterval <= 0 || metaInterval > 65536) {
            clearTimeout(hardKill);
            safeResolve({});
            return;
          }

          let buffer = Buffer.alloc(0);
          let bytesRead = 0;

          res.on('data', (chunk: Buffer) => {
            if (resolved) return;
            buffer = Buffer.concat([buffer, chunk]);
            bytesRead += chunk.length;

            if (bytesRead >= metaInterval) {
              const metaLength = buffer[metaInterval] * 16;
              
              if (metaLength > 0 && buffer.length >= metaInterval + 1 + metaLength) {
                const metaBlock = buffer.slice(metaInterval + 1, metaInterval + 1 + metaLength);
                const metaString = metaBlock.toString('utf8');
                const metadata = this.parseMetadataString(metaString);
                
                clearTimeout(hardKill);

                if (metadata.StreamTitle) {
                  const streamTitle = metadata.StreamTitle;
                  
                  if (streamTitle.includes(' - ')) {
                    const [artist, title] = streamTitle.split(' - ', 2);
                    safeResolve({
                      title: title.trim(),
                      artist: artist.trim(),
                      station: icyName as string || undefined,
                      genre: icyGenre as string || undefined
                    });
                  } else {
                    safeResolve({
                      title: streamTitle.trim(),
                      station: icyName as string || undefined,
                      genre: icyGenre as string || undefined
                    });
                  }
                } else {
                  safeResolve({
                    title: 'Live Stream',
                    station: icyName as string || undefined,
                    genre: icyGenre as string || undefined
                  });
                }
              } else {
                return;
              }
              return;
            }

            if (bytesRead > 100000) {
              clearTimeout(hardKill);
              safeResolve({});
            }
          });

          res.on('end', () => {
            clearTimeout(hardKill);
            if (icyName) {
              safeResolve({
                title: 'Live Stream',
                station: icyName as string,
                genre: icyGenre as string || undefined
              });
            } else {
              safeResolve({});
            }
          });

          res.on('error', () => {
            clearTimeout(hardKill);
            safeResolve({});
          });
        });

        req.on('timeout', () => {
          clearTimeout(hardKill);
          safeResolve({});
        });

        req.on('error', () => {
          clearTimeout(hardKill);
          safeResolve({});
        });

        req.end();
      } catch (error: any) {
        clearTimeout(hardKill);
        safeResolve({});
      }
    });
  }

  async fetchPlaylistMeta(streamUrl: string): Promise<MetadataResult> {
    try {
      const response = await axios.get(streamUrl, {
        timeout: 8000,
        httpAgent: noKeepAliveHttpAgent,
        httpsAgent: noKeepAliveHttpsAgent
      });

      if (!response.data.startsWith('#EXTM3U')) {
        return {};
      }

      const extinfRegex = /#EXTINF:[^,]*,(.*)/g;
      const matches = [...response.data.matchAll(extinfRegex)];

      if (matches.length > 0) {
        const currentlyPlaying = matches[matches.length - 1][1];
        
        if (currentlyPlaying && currentlyPlaying.includes(' - ')) {
          const [artist, title] = currentlyPlaying.split(' - ', 2);
          return {
            title: title.trim(),
            artist: artist.trim()
          };
        } else if (currentlyPlaying) {
          return { title: currentlyPlaying.trim() };
        }
      }

      return {};
    } catch (error: any) {
      return {};
    }
  }

  private parseMetadataString(metaString: string): any {
    const result: any = {};
    
    try {
      const cleanedMetaString = metaString.replace(/\0/g, '').trim();
      
      if (!cleanedMetaString) {
        return result;
      }

      const streamTitleMatch = cleanedMetaString.match(/StreamTitle='([^']*)'/);
      if (streamTitleMatch && streamTitleMatch[1]) {
        const title = streamTitleMatch[1].trim();
        if (title && title.length > 1) {
          result.StreamTitle = title;
        }
      }

      const segments = cleanedMetaString.split(';');
      
      for (const segment of segments) {
        const trimmed = segment.trim();
        if (!trimmed) continue;
        
        const equalsIndex = trimmed.indexOf('=');
        if (equalsIndex === -1) continue;
        
        const key = trimmed.substring(0, equalsIndex).trim();
        let value = trimmed.substring(equalsIndex + 1).trim();
        
        if (value.startsWith("'") && value.endsWith("'")) {
          value = value.slice(1, -1);
        }
        
        if (key && value && value.length > 1) {
          result[key] = value;
        }
      }
      
      result.isAdvertisement = !!(result.AdCreativeId || result.adw_ad || result.AdTitle);
      
    } catch (error) {
    }
    
    return result;
  }

  async resolvePlaylistUrl(playlistUrl: string): Promise<string | null> {
    try {
      const response = await axios.get(playlistUrl, {
        timeout: 8000,
        headers: {
          'User-Agent': 'VLC/3.0.20 LibVLC/3.0.20',
          'Accept': '*/*'
        },
        maxRedirects: 5,
        httpAgent: noKeepAliveHttpAgent,
        httpsAgent: noKeepAliveHttpsAgent
      });
      
      const content = response.data;
      if (typeof content !== 'string') return null;
      
      if (playlistUrl.toLowerCase().includes('.pls') || content.includes('[playlist]')) {
        const fileMatch = content.match(/File\d*\s*=\s*(.+)/i);
        if (fileMatch) {
          const streamUrl = fileMatch[1].trim();
          return streamUrl;
        }
      }
      
      if (playlistUrl.toLowerCase().includes('.m3u') || content.startsWith('#EXTM3U')) {
        const lines = content.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
            return trimmed;
          }
        }
      }
      
      if (playlistUrl.toLowerCase().includes('.asx') || content.includes('<asx')) {
        const hrefMatch = content.match(/<ref\s+href\s*=\s*["']([^"']+)["']/i);
        if (hrefMatch) {
          return hrefMatch[1].trim();
        }
      }
      
      return null;
    } catch (error) {
      return null;
    }
  }

  async getStationMetadata(station: any): Promise<MetadataResult> {
    if (!station) {
      return {};
    }

    let streamUrl = station.url_resolved || station.url;
    const cacheKey = `${station._id}-${streamUrl}`;
    const now = Date.now();
    
    const cached = this.metadataCache.get(cacheKey);
    if (cached && (now - cached.timestamp) < this.cacheTimeout) {
      return cached.data;
    }
    
    try {
      const lowerUrl = streamUrl.toLowerCase();
      if (lowerUrl.includes('.pls') || lowerUrl.includes('.m3u') || lowerUrl.includes('.asx')) {
        const resolvedUrl = await this.resolvePlaylistUrl(streamUrl);
        if (resolvedUrl) {
          streamUrl = resolvedUrl;
        }
      }
      
      let result: MetadataResult;
      
      if (station.hls || streamUrl.includes('.m3u8') || streamUrl.includes('playlist')) {
        result = await this.fetchPlaylistMeta(streamUrl);
      } else {
        result = await this.fetchAudioMeta(streamUrl);
      }
      
      if (result && (result.title || result.artist)) {
        this.metadataCache.set(cacheKey, { data: result, timestamp: now });
        
        if (this.metadataCache.size > 50) {
          this.cleanCache();
        }
        if (this.metadataCache.size > 200) {
          this.metadataCache.clear();
        }
      }
      
      return result;
    } catch (error: any) {
      return {};
    }
  }

  private cleanCache(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];
    
    this.metadataCache.forEach((value, key) => {
      if (now - value.timestamp > this.cacheTimeout) {
        keysToDelete.push(key);
      }
    });
    
    keysToDelete.forEach(key => this.metadataCache.delete(key));
  }
}
