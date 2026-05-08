/**
 * One-shot migration / scheduled cleanup helper: scan the `Genre` collection
 * and either normalize malformed slugs to the safe URL/SEO charset
 * (lowercase letters, digits, dash) or mark unrecoverable docs as
 * `isDiscoverable: false` so they disappear from admin lists, the search
 * dropdown, and the public API.
 *
 * Background (Task #102 → #110 → #132):
 *   Some legacy Genre.slug values were derived directly from raw station
 *   tag strings and contain XML-unsafe / URL-unsafe characters (notably
 *   `"`, e.g. `bassline"`). Task #102 patched the sitemap and SSR layer
 *   to skip/404 those URLs. Task #110 added this one-off migration to
 *   remove the bad rows from the underlying data store too. Task #132
 *   wraps the same logic in a weekly cron via
 *   `services/scheduled-genre-slug-cleanup.ts` so new bad rows that slip
 *   in through bulk paths or older code paths get scrubbed automatically.
 *
 * Strategy per offending doc:
 *   1. Normalize: lowercase, replace [^a-z0-9]+ with `-`, collapse,
 *      strip leading/trailing dashes.
 *   2. If the normalized slug is empty → mark isDiscoverable=false.
 *   3. If the normalized slug already exists on a *different* doc with
 *      the same value → mark this doc isDiscoverable=false (keep the
 *      winner; do not silently merge stations across docs).
 *   4. Otherwise → rewrite slug to the normalized value.
 *
 * After the scan completes the helper:
 *   - Drops the precomputed-genres caches via `PrecomputedGenresService.refreshAll()`.
 *   - Force-rebuilds the sitemap manifests via `buildAllSitemapManifests({force:true})`.
 *   These only fire when something actually changed (normalized > 0 or
 *   markedUndiscoverable > 0), so a no-op weekly tick is cheap.
 *
 * Usage (CLI):
 *   pnpm --filter @workspace/api-server exec tsx src/scripts/cleanup-malformed-genre-slugs.ts
 *   DRY_RUN=1 pnpm --filter @workspace/api-server exec tsx src/scripts/cleanup-malformed-genre-slugs.ts
 *
 * Usage (in-process, e.g. cron):
 *   import { runGenreSlugCleanup } from '.../scripts/cleanup-malformed-genre-slugs';
 *   const stats = await runGenreSlugCleanup({ manageConnection: false });
 *
 * Environment: requires `MONGODB_URI` (or `DATABASE_URL` / `MONGO_URI`)
 * only when `manageConnection: true` (the default for CLI invocations).
 */

import mongoose from 'mongoose';
import type { Collection, ObjectId } from 'mongodb';
import { Genre, SAFE_GENRE_SLUG_RE, normalizeGenreSlug } from '@workspace/db-shared/mongo-schemas';
import { logger } from '../utils/logger';

// Task #161: the normalize helper now lives next to SAFE_GENRE_SLUG_RE in
// `shared/mongo-schemas.ts` so every Genre.slug writer (this script, the
// admin slug-regeneration job, the populate-from-tags admin route) shares
// one definition. Keep a thin local alias so the rest of the file reads
// the same as before.
const normalizeSlug = normalizeGenreSlug;

export interface GenreSlugCleanupStats {
  scanned: number;
  alreadyValid: number;
  normalized: number;
  markedUndiscoverable: number;
  emptySlugMarked: number;
  collisionMarked: number;
  errors: number;
}

export interface RunGenreSlugCleanupOptions {
  /**
   * When true (default for CLI invocations), the helper opens and closes
   * its own mongoose connection. When false (cron path), the caller has
   * already opened a connection and we reuse it.
   */
  manageConnection?: boolean;
  /**
   * When true, walk the collection but skip writes. Defaults to the
   * `DRY_RUN` env var so the existing CLI invocation pattern keeps
   * working unchanged.
   */
  dryRun?: boolean;
  /**
   * When true (default), refresh the precomputed-genres cache and
   * force-rebuild sitemap manifests after the scan, but only if the
   * scan actually changed something. Cron callers leave this on; the
   * downstream re-warm is a no-op when nothing changed.
   */
  rewarmDownstream?: boolean;
  /**
   * Optional logger override. Defaults to the shared `logger`.
   */
  log?: (message: string) => void;
}

async function scanAndFix(
  dryRun: boolean,
  log: (m: string) => void,
): Promise<GenreSlugCleanupStats> {
  const stats: GenreSlugCleanupStats = {
    scanned: 0,
    alreadyValid: 0,
    normalized: 0,
    markedUndiscoverable: 0,
    emptySlugMarked: 0,
    collisionMarked: 0,
    errors: 0,
  };

  // Use the raw collection to bypass the new schema validator (which would
  // reject .save() on malformed legacy docs before we can fix them).
  // NOTE: Genre._id is mixed (ObjectId for new docs, plain strings like
  // 'genre-pop' for legacy seed data — see mongo-schemas.ts). The native
  // driver's filter type is parameterized on ObjectId though, so we type
  // the projected _id as the union and feed it back to the driver as-is.
  interface GenreSlugDoc {
    _id: ObjectId | string;
    name?: string | null;
    slug?: string | null;
    isDiscoverable?: boolean;
  }
  // Re-type the underlying native collection so the driver's `Filter<T>`
  // accepts the legacy mixed `_id` shape (ObjectId | string) — the default
  // mongoose typing pins it to ObjectId only.
  const coll = Genre.collection as unknown as Collection<GenreSlugDoc>;
  const cursor = coll.find(
    {},
    { projection: { _id: 1, name: 1, slug: 1, isDiscoverable: 1 } },
  );

  const nowDate = new Date();

  for await (const doc of cursor) {
    stats.scanned++;
    const currentSlug = doc.slug ?? undefined;

    if (typeof currentSlug === 'string' && SAFE_GENRE_SLUG_RE.test(currentSlug)) {
      stats.alreadyValid++;
      continue;
    }

    const normalized = normalizeSlug(currentSlug);

    if (!normalized) {
      stats.emptySlugMarked++;
      stats.markedUndiscoverable++;
      log(
        `🧹 [${doc._id}] slug=${JSON.stringify(currentSlug)} → unrecoverable, marking isDiscoverable=false`,
      );
      if (!dryRun) {
        // Persist the demotion forensics so the admin UI can surface
        // *why* this row went dark (Task #133).
        await coll.updateOne(
          { _id: doc._id },
          {
            $set: {
              isDiscoverable: false,
              updatedAt: nowDate,
              cleanupDemotion: {
                reason: 'empty-slug',
                originalSlug: typeof currentSlug === 'string' ? currentSlug : '',
                normalizedSlug: '',
                demotedAt: nowDate,
              },
            },
          },
        );
      }
      continue;
    }

    // Check for collision with a *different* doc that already owns the
    // normalized slug. We don't merge — we just demote this duplicate.
    const collision = await coll.findOne(
      { slug: normalized, _id: { $ne: doc._id } },
      { projection: { _id: 1, name: 1, slug: 1 } },
    );

    if (collision) {
      stats.collisionMarked++;
      stats.markedUndiscoverable++;
      log(
        `🧹 [${doc._id}] slug=${JSON.stringify(currentSlug)} → "${normalized}" collides with [${collision._id}], marking isDiscoverable=false`,
      );
      if (!dryRun) {
        await coll.updateOne(
          { _id: doc._id },
          {
            $set: {
              isDiscoverable: false,
              updatedAt: nowDate,
              cleanupDemotion: {
                reason: 'collision',
                originalSlug: typeof currentSlug === 'string' ? currentSlug : '',
                normalizedSlug: normalized,
                collisionWinnerId: collision._id,
                collisionWinnerSlug: collision.slug ?? undefined,
                collisionWinnerName: collision.name ?? undefined,
                demotedAt: nowDate,
              },
            },
          },
        );
      }
      continue;
    }

    stats.normalized++;
    log(`🧹 [${doc._id}] slug=${JSON.stringify(currentSlug)} → "${normalized}"`);
    if (!dryRun) {
      try {
        await coll.updateOne(
          { _id: doc._id },
          { $set: { slug: normalized, updatedAt: new Date() } },
        );
      } catch (err) {
        stats.errors++;
        logger.error(`Failed to update genre ${doc._id}:`, err);
      }
    }
  }

  return stats;
}

async function rewarmDownstream(log: (m: string) => void): Promise<void> {
  try {
    const { PrecomputedGenresService } = await import('../services/precomputed-genres');
    log('♻️  Refreshing precomputed-genres caches...');
    await PrecomputedGenresService.refreshAll();
  } catch (err) {
    logger.error('Failed to refresh precomputed-genres caches:', err);
  }

  try {
    const { buildAllSitemapManifests } = await import('../seo/sitemap-manifest-builder');
    log('♻️  Force-rebuilding sitemap manifests...');
    await buildAllSitemapManifests({ force: true });
  } catch (err) {
    logger.error('Failed to rebuild sitemap manifests:', err);
  }
}

/**
 * Reusable entry point for both the CLI script and the weekly cron.
 *
 * Returns the scan summary so the cron can persist a `GenreSlugCleanupRun`
 * row without having to duplicate the field-by-field accounting.
 */
export async function runGenreSlugCleanup(
  options: RunGenreSlugCleanupOptions = {},
): Promise<GenreSlugCleanupStats> {
  const dryRun =
    options.dryRun ??
    (process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true');
  const manageConnection = options.manageConnection ?? true;
  const shouldRewarm = options.rewarmDownstream ?? true;
  const log = options.log ?? ((m: string) => logger.log(m));

  if (manageConnection) {
    const uri =
      process.env.MONGODB_URI ||
      process.env.DATABASE_URL ||
      process.env.MONGO_URI;
    if (!uri) {
      throw new Error(
        'MONGODB_URI / DATABASE_URL / MONGO_URI not set in env — cannot connect to Mongo.',
      );
    }
    log(`🔌 Connecting to MongoDB for genre slug cleanup (DRY_RUN=${dryRun})...`);
    await mongoose.connect(uri);
  }

  try {
    const stats = await scanAndFix(dryRun, log);
    log(
      `📊 Genre slug cleanup summary: scanned=${stats.scanned} ` +
        `alreadyValid=${stats.alreadyValid} normalized=${stats.normalized} ` +
        `markedUndiscoverable=${stats.markedUndiscoverable} ` +
        `(emptySlug=${stats.emptySlugMarked} collisions=${stats.collisionMarked}) ` +
        `errors=${stats.errors}`,
    );

    if (dryRun) {
      log('🟡 DRY_RUN — skipping cache refresh and manifest rebuild');
    } else if (!shouldRewarm) {
      log('⏭️  rewarmDownstream=false — skipping cache refresh and manifest rebuild');
    } else if (stats.normalized > 0 || stats.markedUndiscoverable > 0) {
      await rewarmDownstream(log);
    } else {
      log('✅ Nothing to fix — skipping downstream re-warm.');
    }

    return stats;
  } finally {
    if (manageConnection) {
      await mongoose.disconnect();
      log('🔌 Disconnected from MongoDB.');
    }
  }
}

// Allow the file to keep working as a `tsx`-invoked CLI script. We detect
// direct execution via the standard `import.meta.url`/argv[1] pattern so
// importing this module from the cron service does NOT trigger main().
const isDirectRun = (() => {
  try {
    const invoked = process.argv[1] ? new URL(`file://${process.argv[1]}`).href : '';
    return invoked === import.meta.url;
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  runGenreSlugCleanup().catch((err) => {
    console.error('❌ Genre slug cleanup failed:', err);
    process.exit(1);
  });
}
