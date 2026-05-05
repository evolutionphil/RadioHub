import type { Request } from 'express';

export const slugGenerationJobs = new Map<string, {
  jobId: string;
  status: 'running' | 'completed' | 'failed' | 'stopped';
  progress: { current: number; total: number };
  startedAt: Date;
  completedAt?: Date;
  error?: string;
  message?: string;
}>();

const inflightRequests = new Map<string, { promise: Promise<any>; createdAt: number }>();

setInterval(() => {
  const now = Date.now();
  const TIMEOUT = 60000;
  for (const [key, value] of inflightRequests) {
    if (now - value.createdAt > TIMEOUT) inflightRequests.delete(key);
  }
}, 30000);

export async function deduplicatedFetch<T>(cacheKey: string, fetchFn: () => Promise<T>): Promise<T> {
  const existing = inflightRequests.get(cacheKey);
  if (existing) return existing.promise;
  const promise = fetchFn().finally(() => inflightRequests.delete(cacheKey));
  inflightRequests.set(cacheKey, { promise, createdAt: Date.now() });
  return promise;
}

export const TV_STATION_FIELDS = {
  _id: 1, name: 1, slug: 1, url: 1, urlResolved: 1, url_resolved: 1,
  favicon: 1, tags: 1, country: 1, countrycode: 1,
  state: 1, language: 1, votes: 1, clickcount: 1, clickCount: 1,
  codec: 1, bitrate: 1, hls: 1, logoAssets: 1
};

export const TV_STATION_PROJECTION = TV_STATION_FIELDS;

export function tvSlimProjection() {
  return { $project: TV_STATION_FIELDS };
}

export function tvSlimStation(s: any) {
  return {
    _id: s._id, name: s.name, slug: s.slug, url: s.url,
    urlResolved: s.urlResolved || s.url_resolved || '',
    favicon: s.favicon, tags: s.tags, country: s.country,
    countrycode: s.countrycode || '', state: s.state, language: s.language,
    votes: s.votes || 0, clickCount: s.clickCount || s.clickcount || 0,
    codec: s.codec, bitrate: s.bitrate, hls: s.hls,
    logoAssets: s.logoAssets || null
  };
}

export function tvValidateParams(query: any) {
  const page = Math.max(1, Math.min(1000, parseInt(query.page) || 1));
  const limit = Math.max(1, Math.min(100, parseInt(query.limit) || 33));
  const offset = Math.max(0, parseInt(query.offset) || 0);
  return { page, limit, offset };
}

export const TV_GENRE_PROJECTION = '_id name slug posterImage discoverableImage stationCount';

export function tvSlimGenre(genre: any) {
  return {
    _id: genre._id,
    name: genre.name,
    slug: genre.slug,
    posterImage: genre.posterImage || genre.discoverableImage || '',
    discoverableImage: genre.discoverableImage || '',
    stationCount: genre.stationCount || genre.total_stations || 0
  };
}

export function getBaseUrl(req: Request): string {
  const isProduction = process.env.NODE_ENV === 'production';
  const requestHost = req.get('host') || '';

  if (isProduction) {
    return 'https://themegaradio.com';
  } else {
    const protocol = req.secure || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
    const domain = requestHost || 'localhost:5000';
    if (domain.includes('localhost') || domain.includes('127.0.0.1')) {
      return 'https://themegaradio.com';
    }
    return `${protocol}://${domain}`;
  }
}

export function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function stripPlaceholders(obj: any): any {
  if (!obj) return obj;

  if (typeof obj === 'string') {
    return obj
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/^:\s*\n?/, '')
      .replace(/^\s*\[FULL\s+DESCRIPTION[^\]]*\]\s*:?\s*/i, '')
      .replace(/^\s*\[SEO\s+META[^\]]*\]\s*:?\s*/i, '')
      .replace(/^\s*\[TRANSLATED\s+(META|FULL)[^\]]*\]\s*:?\s*/i, '')
      .replace(/^\s*\[META[^\]]*\]\s*:?\s*/i, '')
      .replace(/^\s*\[([A-Za-z0-9])/i, '$1')
      .replace(/\]\s*$/, '')
      .replace(/^\s+|\s+$/gm, '')
      .trim();
  }

  if (Array.isArray(obj)) return obj.map(item => stripPlaceholders(item));

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
    if (Array.isArray(cleaned.linkedStations)) {
      cleaned.linkedStations = cleaned.linkedStations.map((item: any) => stripPlaceholders(item));
    }
    return cleaned;
  }

  return obj;
}
