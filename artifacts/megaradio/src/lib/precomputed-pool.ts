/**
 * Shared page-1 pool for /api/stations/precomputed (PageSpeed 2026-07-03).
 *
 * The home page used to fire FIVE separate requests to the same endpoint
 * that differed only in `limit` (200 / 100 / 50 / 12 / 12) — each a ~5s
 * request on slow 4G, all returning slices of the SAME server-side
 * precomputed pool. The server slices deterministically
 * (`data.stations.slice(offset, offset+limit)` over one cached array), so
 * the first `limit` rows of a limit=200 response are byte-identical to a
 * direct limit=N (N ≤ 200) response.
 *
 * This module fetches page 1 ONCE per country at limit=200 (in-flight
 * coalesced + session-cached) and hands each caller its slice. TanStack
 * query keys, response shapes and component behavior are untouched — only
 * the number of network requests changes (5 → 1).
 *
 * NOT for paginated consumers: `pagination` metadata from the pooled
 * response reflects limit=200, so callers that read `pagination` (the
 * 18-per-page main grid with Load More) must keep their direct fetch.
 */

const POOL_LIMIT = 200;
// Matches the 7-day staleTime the consuming queries already use.
const POOL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface PoolResponse {
  data?: unknown[];
  [key: string]: unknown;
}

const poolCache = new Map<string, { value: PoolResponse; expiresAt: number }>();
const poolInflight = new Map<string, Promise<PoolResponse>>();

async function fetchPool(countryName: string): Promise<PoolResponse> {
  const now = Date.now();
  const hit = poolCache.get(countryName);
  if (hit && hit.expiresAt > now) return hit.value;

  let p = poolInflight.get(countryName);
  if (!p) {
    p = fetch(
      `/api/stations/precomputed?countryName=${encodeURIComponent(countryName)}&page=1&limit=${POOL_LIMIT}`,
    )
      .then((r) => {
        if (!r.ok) throw new Error(`precomputed pool fetch failed (${r.status})`);
        return r.json() as Promise<PoolResponse>;
      })
      .finally(() => {
        poolInflight.delete(countryName);
      });
    poolInflight.set(countryName, p);
  }
  const value = await p;
  poolCache.set(countryName, { value, expiresAt: Date.now() + POOL_TTL_MS });
  return value;
}

/**
 * First `limit` stations of the page-1 precomputed list for `countryName`
 * ('global' for the worldwide list). Identical rows to a direct
 * `?limit=<limit>` request, without the extra network round-trip.
 */
export async function getPrecomputedStationsSlice(
  countryName: string,
  limit: number,
): Promise<unknown[]> {
  const pool = await fetchPool(countryName);
  return (pool.data || []).slice(0, limit);
}
