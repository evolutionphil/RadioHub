/**
 * Task #158: in-memory slug existence sets for the slug-shape-404
 * middleware. Loaded once at startup (background) and refreshed on a
 * timer. Used to convert "shape-valid but DB-unknown" SEO URLs into a
 * fast HTTP 404 for non-bot visitors without doing per-request Mongo
 * lookups on the hot path.
 *
 * The sets are intentionally stored as plain `Set<string>` so lookup
 * cost is O(1). Both canonical slugs and slug aliases are included so a
 * legitimate alias URL still passes the existence gate (the SSR layer
 * will then 301 it to the canonical form).
 */

import { Station, Genre } from '@workspace/db-shared/mongo-schemas';
import { logger } from '../utils/logger';

let stationSlugs: Set<string> = new Set();
let genreSlugs: Set<string> = new Set();
let ready = false;

export function isSlugExistenceReady(): boolean {
  return ready;
}

export function hasStationSlug(slug: string): boolean {
  return stationSlugs.has(slug);
}

export function hasGenreSlug(slug: string): boolean {
  return genreSlugs.has(slug);
}

/**
 * Load (or reload) the slug sets from MongoDB. Failures are logged but
 * do not throw — a stale set is preferable to a 404 storm if Mongo is
 * briefly unavailable, and an empty initial set keeps `ready=false` so
 * the middleware just falls through.
 */
export async function loadSlugExistence(): Promise<void> {
  try {
    const [stationDocs, genreDocs] = await Promise.all([
      Station.find(
        { slug: { $exists: true, $ne: null } },
        { slug: 1, slugAliases: 1, _id: 0 },
      ).lean(),
      Genre.find(
        { slug: { $exists: true, $ne: null } },
        { slug: 1, _id: 0 },
      ).lean(),
    ]);

    const nextStations = new Set<string>();
    for (const doc of stationDocs as Array<{ slug?: string; slugAliases?: string[] }>) {
      if (doc.slug) nextStations.add(doc.slug.toLowerCase());
      if (Array.isArray(doc.slugAliases)) {
        for (const a of doc.slugAliases) {
          if (a) nextStations.add(a.toLowerCase());
        }
      }
    }

    const nextGenres = new Set<string>();
    for (const doc of genreDocs as Array<{ slug?: string }>) {
      if (doc.slug) nextGenres.add(doc.slug.toLowerCase());
    }

    stationSlugs = nextStations;
    genreSlugs = nextGenres;
    ready = true;
    logger.log(
      `🗂️ SLUG-EXISTENCE: loaded ${nextStations.size} station slugs, ${nextGenres.size} genre slugs`,
    );
  } catch (err: any) {
    logger.log(`⚠️ SLUG-EXISTENCE: load failed (${err?.message || err}) — keeping previous sets`);
  }
}

/**
 * Start a periodic refresh in the background. Returns the timer handle
 * so callers can clear it during shutdown if they want.
 */
export function startSlugExistenceRefresh(intervalMs = 6 * 60 * 60 * 1000) {
  const timer = setInterval(() => {
    loadSlugExistence().catch(() => {});
  }, intervalMs);
  // Don't keep the event loop alive solely for this refresh.
  if (typeof timer.unref === 'function') timer.unref();
  return timer;
}
