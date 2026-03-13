import axios from 'axios';
import http from 'http';
import https from 'https';

export interface MetadataResult {
  title?: string;
  artist?: string;
  station?: string;
  genre?: string;
}

export class StreamMetadataService {
  private metadataCache = new Map<string, { data: MetadataResult; timestamp: number }>();
  private cacheTimeout = 10000; // 10 seconds cache
  // Simplified metadata fetch using axios for redirects
  async fetchAudioMetaWithAxios(streamUrl: string): Promise<MetadataResult> {
    try {
      // Fetching ICY metadata with axios
      
      const response = await axios.get(streamUrl, {
        timeout: 10000, // Increased from 3s to 10s for better reliability
        headers: {
          'Icy-MetaData': '1',
          'User-Agent': 'MegaRadio/1.0'
        },
        responseType: 'stream',
        maxRedirects: 5
      });

      const icyName = response.headers['icy-name'];
      const icyGenre = response.headers['icy-genre'];
      const icyMetaint = response.headers['icy-metaint'];

      // ICY headers received from axios

      if (icyName) {
        return {
          title: icyName as string,
          station: icyName as string,
          genre: icyGenre as string || undefined
        };
      }

      return {};
    } catch (error: any) {
      // ICY metadata fetch failed
      return {};
    }
  }

  // Extract real ICY metadata from radio streams using native HTTP
  async fetchAudioMeta(streamUrl: string): Promise<MetadataResult> {
    const timeoutMs = 15000; // Increased timeout for better stream reliability
    
    return new Promise((resolve) => {
      try {
        // Fetching ICY metadata from stream
        
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
            'Range': 'bytes=0-1024' // Only request first chunk for metadata
          },
          timeout: timeoutMs
        };

        const req = httpModule.request(options, (res) => {
          // ICY headers found and processed

          // Handle redirects (301, 302, 307, 308)
          if ([301, 302, 307, 308].includes(res.statusCode || 0) && res.headers['location']) {
            // Following redirect
            // Use axios for redirect to avoid context issues
            this.fetchAudioMetaWithAxios(res.headers['location'] as string).then(resolve);
            return;
          }

          const icyMetaint = res.headers['icy-metaint'];
          const icyName = res.headers['icy-name'];
          const icyGenre = res.headers['icy-genre'];

          if (!icyMetaint || parseInt(icyMetaint as string) <= 0) {
            // No ICY metadata interval, using station info
            // Return station info even without live metadata
            if (icyName) {
              resolve({
                title: icyName as string,
                station: icyName as string,
                genre: icyGenre as string || undefined
              });
            } else {
              resolve({});
            }
            return;
          }

          const metaInterval = parseInt(icyMetaint as string);
          if (!Number.isFinite(metaInterval) || metaInterval <= 0 || metaInterval > 65536) {
            req.destroy();
            resolve({});
            return;
          }
          let buffer = Buffer.alloc(0);
          let bytesRead = 0;

          res.on('data', (chunk: Buffer) => {
            buffer = Buffer.concat([buffer, chunk]);
            bytesRead += chunk.length;

            // Check if we've reached the metadata block
            if (bytesRead >= metaInterval) {
              const metaLength = buffer[metaInterval] * 16;
              
              if (metaLength > 0 && buffer.length >= metaInterval + 1 + metaLength) {
                const metaBlock = buffer.slice(metaInterval + 1, metaInterval + 1 + metaLength);
                const metaString = metaBlock.toString('utf8');
                
                // Raw metadata block parsed
                
                // Enhanced metadata parsing based on Radiolise implementation
                const metadata = this.parseMetadataString(metaString);
                
                if (metadata.StreamTitle) {
                  const streamTitle = metadata.StreamTitle;
                  // ICY metadata extracted successfully
                  
                  // Parse "Artist - Title" format
                  if (streamTitle.includes(' - ')) {
                    const [artist, title] = streamTitle.split(' - ', 2);
                    resolve({
                      title: title.trim(),
                      artist: artist.trim(),
                      station: icyName as string || undefined,
                      genre: icyGenre as string || undefined
                    });
                  } else {
                    resolve({
                      title: streamTitle.trim(),
                      station: icyName as string || undefined,
                      genre: icyGenre as string || undefined
                    });
                  }
                } else {
                  // Fallback to station name
                  resolve({
                    title: 'Live Stream',
                    station: icyName as string || undefined,
                    genre: icyGenre as string || undefined
                  });
                }
              } else {
                // Not enough data yet, continue
                return;
              }
              
              req.destroy(); // Close connection
              return;
            }

            // Prevent reading too much data
            if (bytesRead > 100000) {
              req.destroy();
              resolve({});
            }
          });

          res.on('end', () => {
            // Fallback to station name if available
            if (icyName) {
              resolve({
                title: 'Live Stream',
                station: icyName as string,
                genre: icyGenre as string || undefined
              });
            } else {
              resolve({});
            }
          });

          res.on('error', (error) => {
            // Silently handle common connection errors for metadata fetching
            resolve({});
          });
        });

        req.on('timeout', () => {
          req.destroy();
          resolve({});
        });

        req.on('error', (error) => {
          // Silently handle connection errors for metadata requests
          resolve({});
        });

        req.end();
      } catch (error: any) {
        // ICY metadata extraction failed
        resolve({});
      }
    });
  }

  // Extract metadata from HLS/M3U8 playlists
  async fetchPlaylistMeta(streamUrl: string): Promise<MetadataResult> {
    try {
      // Fetching HLS metadata from stream
      
      const response = await axios.get(streamUrl, { timeout: 12000 }); // Increased for HLS playlist reliability

      // Validate if the response is an M3U8 manifest
      if (!response.data.startsWith('#EXTM3U')) {
        // Invalid M3U8 stream
        return {};
      }

      // Extract metadata from #EXTINF tags
      const extinfRegex = /#EXTINF:[^,]*,(.*)/g;
      const matches = [...response.data.matchAll(extinfRegex)];

      if (matches.length > 0) {
        // Use the last EXTINF as the currently playing info
        const currentlyPlaying = matches[matches.length - 1][1];
        // HLS metadata extracted successfully
        
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
      // HLS metadata fetch error
      return {};
    }
  }

  /**
   * Parse ICY metadata string into structured format
   * Enhanced based on Radiolise's metadata parsing approach
   */
  private parseMetadataString(metaString: string): any {
    const result: any = {};
    
    try {
      // Clean up the metadata string first to prevent corruption
      const cleanedMetaString = metaString.replace(/\0/g, '').trim();
      
      if (!cleanedMetaString) {
        return result;
      }

      // First, try to extract StreamTitle using regex (most reliable method)
      const streamTitleMatch = cleanedMetaString.match(/StreamTitle='([^']*)'/);
      if (streamTitleMatch && streamTitleMatch[1]) {
        const title = streamTitleMatch[1].trim();
        // Only set if title is meaningful (not empty and more than 1 character)
        if (title && title.length > 1) {
          result.StreamTitle = title;
        }
      }

      // Handle Radiolise-style metadata parsing
      // Look for key='value' patterns, split by semicolons
      const segments = cleanedMetaString.split(';');
      
      for (const segment of segments) {
        const trimmed = segment.trim();
        if (!trimmed) continue;
        
        const equalsIndex = trimmed.indexOf('=');
        if (equalsIndex === -1) continue;
        
        const key = trimmed.substring(0, equalsIndex).trim();
        let value = trimmed.substring(equalsIndex + 1).trim();
        
        // Remove quotes if present
        if (value.startsWith("'") && value.endsWith("'")) {
          value = value.slice(1, -1);
        }
        
        // Only set if key and value are meaningful
        if (key && value && value.length > 1) {
          result[key] = value;
        }
      }
      
      // Handle advertisement detection (inspired by Radiolise)
      result.isAdvertisement = !!(result.AdCreativeId || result.adw_ad || result.AdTitle);
      
    } catch (error) {
      // ICY metadata parsing error
    }
    
    return result;
  }

  // Resolve PLS/M3U playlist to get actual stream URL
  async resolvePlaylistUrl(playlistUrl: string): Promise<string | null> {
    try {
      const response = await axios.get(playlistUrl, {
        timeout: 8000,
        headers: {
          'User-Agent': 'VLC/3.0.20 LibVLC/3.0.20',
          'Accept': '*/*'
        },
        maxRedirects: 5
      });
      
      const content = response.data;
      if (typeof content !== 'string') return null;
      
      // PLS format: File1=http://...
      if (playlistUrl.toLowerCase().includes('.pls') || content.includes('[playlist]')) {
        const fileMatch = content.match(/File\d*\s*=\s*(.+)/i);
        if (fileMatch) {
          const streamUrl = fileMatch[1].trim();
          return streamUrl;
        }
      }
      
      // M3U format: lines starting with http
      if (playlistUrl.toLowerCase().includes('.m3u') || content.startsWith('#EXTM3U')) {
        const lines = content.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
            return trimmed;
          }
        }
      }
      
      // ASX format: <ref href="..."/>
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

  // Main metadata extraction method - matches original getMeta() logic with caching
  async getStationMetadata(station: any): Promise<MetadataResult> {
    if (!station) {
      // No station provided for metadata extraction
      return {};
    }

    let streamUrl = station.url_resolved || station.url;
    const cacheKey = `${station._id}-${streamUrl}`;
    const now = Date.now();
    
    // Check cache first
    const cached = this.metadataCache.get(cacheKey);
    if (cached && (now - cached.timestamp) < this.cacheTimeout) {
      return cached.data;
    }
    
    // Extracting metadata for station
    
    try {
      // Check if URL is a playlist file (PLS, M3U, ASX) - resolve to actual stream first
      const lowerUrl = streamUrl.toLowerCase();
      if (lowerUrl.includes('.pls') || lowerUrl.includes('.m3u') || lowerUrl.includes('.asx')) {
        const resolvedUrl = await this.resolvePlaylistUrl(streamUrl);
        if (resolvedUrl) {
          streamUrl = resolvedUrl;
        }
      }
      
      let result: MetadataResult;
      
      const hardDeadline = new Promise<MetadataResult>((resolve) => setTimeout(() => resolve({}), 20000));

      if (station.hls || streamUrl.includes('.m3u8') || streamUrl.includes('playlist')) {
        result = await Promise.race([this.fetchPlaylistMeta(streamUrl), hardDeadline]);
      } else {
        result = await Promise.race([this.fetchAudioMeta(streamUrl), hardDeadline]);
      }
      
      // Cache the result if it's meaningful
      if (result && (result.title || result.artist)) {
        this.metadataCache.set(cacheKey, { data: result, timestamp: now });
        
        // Clean old cache entries periodically
        if (this.metadataCache.size > 100) {
          this.cleanCache();
        }
      }
      
      // ICY metadata processing complete
      return result;
    } catch (error: any) {
      // Metadata extraction failed for station
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

export const streamMetadataService = new StreamMetadataService();