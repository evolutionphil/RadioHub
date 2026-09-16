import { getCachedPublicGenres, publicGenreWhitelistVersion } from './public-genre-navigation';
import { getPublicStationDeadline, limitPublicStationDeadline, publicStationDeadlineContext } from '../utils/public-station-deadline';

export type HomeGenreLink = Readonly<{ slug: string; name: string }>;
type Snapshot = { revision: string; links: readonly HomeGenreLink[]; freshUntil: number; expiresAt: number };
let snapshot: Snapshot | undefined;
let refreshing = false;
let retryAfter = 0;
const FRESH_MS = 60_000;
const NAVIGATION_GRACE_MS = 60_000;

/** Optional navigation only: never retain station IDs, visibility or counts.
 * An organic home request starts a coalesced refresh, but HTML never waits for
 * Redis/PG. Last-known links get at most one extra minute; after that the
 * renderer's existing localized fallback is used. Strict public API data and
 * station-list deadlines are untouched. There is no eager boot warmup. */
export function getHomeGenreNavigation(): readonly HomeGenreLink[] | undefined {
  const revision = publicGenreWhitelistVersion();
  const now = Date.now();
  const current = snapshot?.revision === revision ? snapshot : undefined;
  if ((!current || current.freshUntil <= now) && !refreshing && retryAfter <= now) {
    refreshing = true;
    // A background result must not mutate the requesting page's health/cache
    // deadline after it has rendered. Preserve the source deadline separately.
    void publicStationDeadlineContext.run({ expiresAt: Infinity }, async () => {
      try {
        const genres = await getCachedPublicGenres();
        if (publicGenreWhitelistVersion() !== revision) return;
        const freshUntil = Math.min(getPublicStationDeadline(), now + FRESH_MS);
        snapshot = {
          revision, freshUntil, expiresAt: freshUntil + NAVIGATION_GRACE_MS,
          links: Object.freeze([...genres]
            .sort((a, b) => b.stationCount - a.stationCount || a.slug.localeCompare(b.slug))
            .slice(0, 24).map(genre => Object.freeze({ slug: genre.slug, name: genre.name }))),
        };
        retryAfter = 0;
      } catch {
        // Keep a still-bounded snapshot and avoid retrying an outage per visit.
        retryAfter = Date.now() + 5_000;
      } finally { refreshing = false; }
    });
  }
  if (!current || current.expiresAt <= now) return undefined;
  // A cached HTML page must not start a new TTL beyond the link snapshot.
  limitPublicStationDeadline(current.expiresAt);
  return current.links;
}
