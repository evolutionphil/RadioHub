import { createHash } from 'node:crypto';
import { pgPublicGenres } from '../data/postgres-taxonomy-store';
import { publicStationCache } from '../public-station-cache';
import { getMergedWhitelist } from '../seo/genre-whitelist-store';

// Whitelist edits select a new cache entry without flushing unrelated public data.
export const publicGenreWhitelistVersion = () => 'navigation-v2:' + createHash('sha256')
  .update([...getMergedWhitelist()].sort().join('\0')).digest('hex').slice(0, 16);

/** Share the native membership aggregate between the public API and home SSR.
 * Keep the health-aware absolute deadline: expired station visibility must not
 * survive through a second response/page cache or a stale fallback. */
export function getCachedPublicGenres(country?: string): Promise<any[]> {
  const cacheKey = `genres:precomputed:native-v1:${country || 'global'}:whitelist-${publicGenreWhitelistVersion()}`;
  return publicStationCache.getOrSetSingleFlight(cacheKey,
    () => pgPublicGenres(country, true), { ttl: 60 });
}
