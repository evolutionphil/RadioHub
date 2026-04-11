import fetch, { Request } from 'node-fetch';
import type { Readable } from 'node:stream';
import { logger } from '../utils/logger';

export interface MetadataResult {
  title?: string;
  artist?: string;
  station?: string;
  genre?: string;
}

interface StreamAnalysis {
  title: string;
  contentType: string | null;
  icyName: string | null;
  icyGenre: string | null;
}

interface StreamConnection {
  controller: AbortController;
  sockets: Set<string>;
  nowPlaying: string | undefined;
  metadata: MetadataResult;
  lastUpdate: number;
  destroy: () => void;
}

enum ReadAction {
  PASS_SEGMENT,
  DECODE_META_SIZE,
  EXTRACT_TITLE,
}

function safeRead(stream: Readable, bytes: number, handler: (chunk: Buffer) => void) {
  if (stream.readableLength >= bytes) {
    const data = stream.read(bytes);
    if (data) handler(data);
  }
}

function parseIcyMetadata(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of raw.split("';")) {
    const eqIdx = match.indexOf("='");
    if (eqIdx === -1) continue;
    const key = match.substring(0, eqIdx).trim();
    const value = match.substring(eqIdx + 2);
    if (key && value) result[key] = value;
  }
  return result;
}

function isAdvertisement(metadata: Record<string, string>): boolean {
  return !!(metadata['AdCreativeId'] || metadata['adw_ad'] || metadata['AdTitle']);
}

function parseArtistTitle(streamTitle: string): MetadataResult {
  if (!streamTitle || streamTitle.length < 2) return {};
  if (streamTitle.includes(' - ')) {
    const [artist, title] = streamTitle.split(' - ', 2);
    return { title: title.trim(), artist: artist.trim() };
  }
  return { title: streamTitle.trim() };
}

const FETCH_HEADERS = {
  'Icy-MetaData': '1',
  'User-Agent': 'MegaRadio/2.0 (Radiolise-style)',
};

export class StreamMetadataService {
  private connections = new Map<string, StreamConnection>();
  private maxConnections = 50;

  private analyzeStream(
    url: string,
    controller: AbortController,
    onTitle: (title: string, headers: any) => void,
    onError: (err: Error) => void
  ): void {
    const request = new Request(url, {
      signal: controller.signal as any,
      headers: FETCH_HEADERS,
    });

    const doAnalyze = () => {
      fetch(request).then((response) => {
        if (!response.ok || !response.body) {
          onError(new Error(`HTTP ${response.status}`));
          return;
        }

        const metaIntervalHeader = response.headers.get('icy-metaint');
        const icyName = response.headers.get('icy-name');
        const icyGenre = response.headers.get('icy-genre');

        if (icyName) {
          onTitle(icyName, { icyName, icyGenre });
        }

        if (!metaIntervalHeader) {
          return;
        }

        const stream = response.body as unknown as Readable;
        const metaInterval = Number(metaIntervalHeader);

        if (!Number.isFinite(metaInterval) || metaInterval <= 0 || metaInterval > 65536) {
          return;
        }

        let currentRaw = '';
        let action = ReadAction.PASS_SEGMENT;
        let decodedMetaSize = 0;

        const passSegment = () => {
          action = ReadAction.PASS_SEGMENT;
          safeRead(stream, metaInterval, () => decodeMetaSize());
        };

        const decodeMetaSize = () => {
          action = ReadAction.DECODE_META_SIZE;
          safeRead(stream, 1, (chunk) => {
            decodedMetaSize = chunk[0] << 4;
            if (decodedMetaSize === 0) {
              return passSegment();
            }
            extractTitle();
          });
        };

        const extractTitle = () => {
          action = ReadAction.EXTRACT_TITLE;
          safeRead(stream, decodedMetaSize, (chunk) => {
            const decoded = chunk.toString('utf8').replace(/\0/g, '').trim();
            if (currentRaw === decoded || !decoded) {
              return passSegment();
            }
            currentRaw = decoded;
            const parsed = parseIcyMetadata(decoded);
            if (isAdvertisement(parsed)) {
              return passSegment();
            }
            if (parsed.StreamTitle) {
              onTitle(parsed.StreamTitle, { icyName, icyGenre });
            }
            passSegment();
          });
        };

        stream.on('readable', () => {
          if (action === ReadAction.PASS_SEGMENT) return passSegment();
          if (action === ReadAction.DECODE_META_SIZE) return decodeMetaSize();
          if (action === ReadAction.EXTRACT_TITLE) return extractTitle();
        });

        stream.on('end', () => {
          if (!controller.signal.aborted) {
            setTimeout(() => doAnalyze(), 2000);
          }
        });

        stream.on('error', () => {
          if (!controller.signal.aborted) {
            setTimeout(() => doAnalyze(), 5000);
          }
        });
      }).catch((err: any) => {
        if (controller.signal.aborted) return;
        setTimeout(() => doAnalyze(), 5000);
      });
    };

    doAnalyze();
  }

  private getOrCreateConnection(streamUrl: string): StreamConnection {
    const existing = this.connections.get(streamUrl);
    if (existing) return existing;

    if (this.connections.size >= this.maxConnections) {
      let oldestUrl = '';
      let oldestTime = Infinity;
      Array.from(this.connections.entries()).forEach(([url, conn]) => {
        if (conn.sockets.size === 0 && conn.lastUpdate < oldestTime) {
          oldestTime = conn.lastUpdate;
          oldestUrl = url;
        }
      });
      if (oldestUrl) {
        this.connections.get(oldestUrl)?.destroy();
        this.connections.delete(oldestUrl);
      }
    }

    const controller = new AbortController();
    const sockets = new Set<string>();
    const conn: StreamConnection = {
      controller,
      sockets,
      nowPlaying: undefined,
      metadata: {},
      lastUpdate: Date.now(),
      destroy: () => {
        controller.abort();
        this.connections.delete(streamUrl);
      },
    };

    this.connections.set(streamUrl, conn);

    this.analyzeStream(
      streamUrl,
      controller,
      (title, headers) => {
        const parsed = parseArtistTitle(title);
        conn.metadata = {
          ...parsed,
          station: headers?.icyName || undefined,
          genre: headers?.icyGenre || undefined,
        };
        conn.nowPlaying = title;
        conn.lastUpdate = Date.now();
      },
      (err) => {
        logger.log(`❌ Stream metadata error for ${streamUrl}: ${err.message}`);
      }
    );

    return conn;
  }

  subscribe(streamUrl: string, clientId: string): void {
    const conn = this.getOrCreateConnection(streamUrl);
    conn.sockets.add(clientId);
  }

  unsubscribe(streamUrl: string, clientId: string): void {
    const conn = this.connections.get(streamUrl);
    if (!conn) return;
    conn.sockets.delete(clientId);

    if (conn.sockets.size === 0) {
      setTimeout(() => {
        const check = this.connections.get(streamUrl);
        if (check && check.sockets.size === 0) {
          check.destroy();
          logger.log(`🛑 Stream connection closed (no listeners): ${streamUrl}`);
        }
      }, 30000);
    }
  }

  getMetadata(streamUrl: string): MetadataResult {
    const conn = this.connections.get(streamUrl);
    if (!conn) return {};
    return conn.metadata;
  }

  async getStationMetadata(station: any): Promise<MetadataResult> {
    if (!station) return {};
    const streamUrl = station.url_resolved || station.url;
    if (!streamUrl) return {};

    const conn = this.getOrCreateConnection(streamUrl);
    if (conn.nowPlaying) {
      return conn.metadata;
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(conn.metadata), 8000);
      const check = setInterval(() => {
        if (conn.nowPlaying) {
          clearTimeout(timeout);
          clearInterval(check);
          resolve(conn.metadata);
        }
      }, 500);
    });
  }

  getActiveConnections(): number {
    return this.connections.size;
  }

  getConnectionStats(): { url: string; listeners: number; lastUpdate: number }[] {
    const stats: { url: string; listeners: number; lastUpdate: number }[] = [];
    this.connections.forEach((conn, url) => {
      stats.push({
        url: url.substring(0, 60),
        listeners: conn.sockets.size,
        lastUpdate: Date.now() - conn.lastUpdate,
      });
    });
    return stats;
  }

  cleanup(): void {
    this.connections.forEach((conn) => {
      conn.destroy();
    });
    this.connections.clear();
    logger.log('🧹 StreamMetadataService: All connections closed');
  }
}
