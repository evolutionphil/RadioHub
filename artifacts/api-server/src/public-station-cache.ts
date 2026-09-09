import CacheManager from './cache';
import { publicStationDeadlineContext as loaderDeadline } from './utils/public-station-deadline';

// Health is native, not the archived station.source payload. Never reuse the
// former day/week-long public caches after this visibility policy changes.
export const PUBLIC_STATION_CACHE_MAX_TTL = 60;
export const publicStationCacheKey = (key: string): string => `public-health:v1:${key}`;
const ttl = (value?: number): number => Number.isFinite(value) && value! > 0
  ? Math.min(value!, PUBLIC_STATION_CACHE_MAX_TTL) : PUBLIC_STATION_CACHE_MAX_TTL;
type Options = { ttl?: number; useRedis?: boolean; refreshThreshold?: number };
type Envelope<T> = { value: T; expiresAt: number };
const inflight = new Map<string, Promise<unknown>>();

async function get<T>(key: string): Promise<T | null> {
  const entry = await CacheManager.get<Envelope<T>>(publicStationCacheKey(key));
  // Redis reads can be promoted to a longer-lived process-local cache. The
  // original absolute deadline must survive that promotion (and cache layers).
  if (!entry || typeof entry.expiresAt !== 'number' || entry.expiresAt <= Date.now()) return null;
  const context = loaderDeadline.getStore();
  if (context) context.expiresAt = Math.min(context.expiresAt, entry.expiresAt);
  return entry.value;
}
async function set<T>(key: string, value: T, options: Options = {}): Promise<void> {
  const seconds = ttl(options.ttl);
  const expiresAt = Math.min(Date.now() + seconds * 1000, loaderDeadline.getStore()?.expiresAt ?? Infinity);
  const context = loaderDeadline.getStore();
  if (context) context.expiresAt = expiresAt;
  await CacheManager.set(publicStationCacheKey(key), { value, expiresAt }, { ...options, ttl: seconds });
}
async function singleFlight<T>(key: string, loader: () => Promise<T>, options: Options = {}): Promise<T> {
  const cached = await get<T>(key);
  if (cached !== null) return cached;
  const pending = inflight.get(key);
  if (pending) { const value = await pending as T; await get(key); return value; }
  const inherited = loaderDeadline.getStore();
  const deadline = { expiresAt: inherited?.expiresAt ?? Infinity };
  const loading = loaderDeadline.run(deadline, async () => {
    try {
      const value = await loader(); await set(key, value, options);
      if (inherited) inherited.expiresAt = Math.min(inherited.expiresAt, deadline.expiresAt);
      return value;
    }
    finally { inflight.delete(key); }
  });
  inflight.set(key, loading);
  return loading;
}

export const publicStationCache = {
  get, set, getOrSetSingleFlight: singleFlight,
  // An unavailable loader must not extend stale public visibility. Keep the
  // existing API, but expire the payload at the earlier bounded deadline.
  getOrSetSWR: <T>(key: string, loader: () => Promise<T>, options: { freshTtl: number; staleTtl: number }) =>
    singleFlight(`${key}:swr`, loader, { ttl: Math.min(ttl(options.freshTtl), ttl(options.staleTtl)) }),
  getSWR: <T>(key: string) => get<T>(`${key}:swr`),
  setSWR: <T>(key: string, value: T, options: { freshTtl: number; staleTtl: number }) =>
    set(`${key}:swr`, value, { ttl: Math.min(ttl(options.freshTtl), ttl(options.staleTtl)) }),
  del: (key: string) => CacheManager.del(publicStationCacheKey(key)),
  delSWR: (key: string) => CacheManager.del(publicStationCacheKey(`${key}:swr`)),
  clearByPattern: (pattern: string) => CacheManager.clearByPattern(publicStationCacheKey(pattern)),
};
