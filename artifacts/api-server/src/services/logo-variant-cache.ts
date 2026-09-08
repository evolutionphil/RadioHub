import CacheManager from '../cache';
import { performanceCache } from '../performance-cache';
import { resolveToDbName } from '../utils/normalize-country';
import type { LogoVariantStation } from '../data/postgres-logo-variant-store';

/** Invalidate only this station and its card pools; no site-wide cache reset.
 * CacheManager also reaches Redis when configured. Other processes' private
 * in-memory caches still follow their existing TTL; this is not a CDN purge.
 */
export async function invalidateLogoVariantCaches(station: LogoVariantStation): Promise<void> {
  const identifiers = [...new Set([station.id, station.slug, ...(station.slugAliases || [])].filter((value): value is string => !!value))];
  const countries = [...new Set([station.country, station.countryCode && resolveToDbName(station.countryCode)]
    .filter((value): value is string => !!value))];
  const operations: Array<() => Promise<unknown>> = [];
  for (const identifier of identifiers) {
    operations.push(async () => { performanceCache.invalidateStationCache(identifier); });
    operations.push(() => CacheManager.del(`station:detail:${identifier}`));
    operations.push(() => CacheManager.del(`station:${identifier}`));
  }
  // Batch-detail/similar/linked cache keys include the exact station ID.
  operations.push(() => CacheManager.clearByPattern(station.id));
  const pools = new Set(['precomputed_stations:global', ...[12, 24, 50].map(limit => `precomputed_popular:v1:global:limit:${limit}`)]);
  for (const country of countries) {
    pools.add(`precomputed_stations:${country.toLowerCase().replace(/[^a-z0-9]/g, '_')}`);
    operations.push(() => CacheManager.clearByPattern(`precomputed_stations:catalog:v1:${encodeURIComponent(country)}:`));
  }
  for (const key of pools) operations.push(async () => {
    const data = await CacheManager.getSWR<any>(key);
    const rows = Array.isArray(data) ? data : data?.stations;
    if (Array.isArray(rows) && rows.some(row => String(row?._id || row?.id) === station.id)) await CacheManager.delSWR(key);
  });
  for (const country of ['all', ...countries]) {
    operations.push(() => CacheManager.clearByPattern(`popular_stations:${country}:`));
    operations.push(() => CacheManager.clearByPattern(`community_favorites:${country}:`));
  }
  const results = await Promise.allSettled(operations.map(operation => Promise.resolve().then(operation)));
  if (results.some(result => result.status === 'rejected')) throw new Error('Some logo cache refresh requests failed');
}
