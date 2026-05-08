/**
 * One-shot migration: scan the `Genre` collection and either normalize
 * malformed slugs to the safe URL/SEO charset (lowercase letters, digits,
 * dash) or mark unrecoverable docs as `isDiscoverable: false` so they
 * disappear from admin lists, the search dropdown, and the public API.
 *
 * Background (Task #102 → #110):
 *   Some legacy Genre.slug values were derived directly from raw station
 *   tag strings and contain XML-unsafe / URL-unsafe characters (notably
 *   `"`, e.g. `bassline"`). Task #102 patched the sitemap and SSR layer
 *   to skip/404 those URLs. This migration removes the bad rows from the
 *   underlying data store too.
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
 * After the scan completes the script:
 *   - Drops the precomputed-genres caches via `PrecomputedGenresService.refreshAll()`.
 *   - Force-rebuilds the sitemap manifests via `buildAllSitemapManifests({force:true})`.
 *
 * Usage:
 *   pnpm --filter @workspace/api-server exec tsx src/scripts/cleanup-malformed-genre-slugs.ts
 *   DRY_RUN=1 pnpm --filter @workspace/api-server exec tsx src/scripts/cleanup-malformed-genre-slugs.ts
 *
 * Environment: requires `MONGODB_URI` (or `DATABASE_URL` / `MONGO_URI`).
 */

import mongoose from 'mongoose';
import type { Collection, ObjectId } from 'mongodb';
import { Genre } from '../shared/mongo-schemas';
import { logger } from '../utils/logger';

const SAFE_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';

function normalizeSlug(input: string | null | undefined): string {
  if (!input) return '';
  return String(input)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

interface CleanupStats {
  scanned: number;
  alreadyValid: number;
  normalized: number;
  markedUndiscoverable: number;
  emptySlugMarked: number;
  collisionMarked: number;
  errors: number;
}

async function runCleanup(): Promise<CleanupStats> {
  const stats: CleanupStats = {
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
    slug?: string | null;
    isDiscoverable?: boolean;
  }
  // Re-type the underlying native collection so the driver's `Filter<T>`
  // accepts the legacy mixed `_id` shape (ObjectId | string) — the default
  // mongoose typing pins it to ObjectId only.
  const coll = Genre.collection as unknown as Collection<GenreSlugDoc>;
  const cursor = coll.find(
    {},
    { projection: { _id: 1, slug: 1, isDiscoverable: 1 } },
  );

  for await (const doc of cursor) {
    stats.scanned++;
    const currentSlug = doc.slug ?? undefined;

    if (typeof currentSlug === 'string' && SAFE_SLUG_RE.test(currentSlug)) {
      stats.alreadyValid++;
      continue;
    }

    const normalized = normalizeSlug(currentSlug);

    if (!normalized) {
      stats.emptySlugMarked++;
      stats.markedUndiscoverable++;
      logger.log(
        `🧹 [${doc._id}] slug=${JSON.stringify(currentSlug)} → unrecoverable, marking isDiscoverable=false`,
      );
      if (!DRY_RUN) {
        await coll.updateOne(
          { _id: doc._id },
          { $set: { isDiscoverable: false, updatedAt: new Date() } },
        );
      }
      continue;
    }

    // Check for collision with a *different* doc that already owns the
    // normalized slug. We don't merge — we just demote this duplicate.
    const collision = await coll.findOne(
      { slug: normalized, _id: { $ne: doc._id } },
      { projection: { _id: 1 } },
    );

    if (collision) {
      stats.collisionMarked++;
      stats.markedUndiscoverable++;
      logger.log(
        `🧹 [${doc._id}] slug=${JSON.stringify(currentSlug)} → "${normalized}" collides with [${collision._id}], marking isDiscoverable=false`,
      );
      if (!DRY_RUN) {
        await coll.updateOne(
          { _id: doc._id },
          { $set: { isDiscoverable: false, updatedAt: new Date() } },
        );
      }
      continue;
    }

    stats.normalized++;
    logger.log(
      `🧹 [${doc._id}] slug=${JSON.stringify(currentSlug)} → "${normalized}"`,
    );
    if (!DRY_RUN) {
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

async function rewarmDownstream(): Promise<void> {
  if (DRY_RUN) {
    logger.log('🟡 DRY_RUN — skipping cache refresh and manifest rebuild');
    return;
  }
  try {
    const { PrecomputedGenresService } = await import('../services/precomputed-genres');
    logger.log('♻️  Refreshing precomputed-genres caches...');
    await PrecomputedGenresService.refreshAll();
  } catch (err) {
    logger.error('Failed to refresh precomputed-genres caches:', err);
  }

  try {
    const { buildAllSitemapManifests } = await import('../seo/sitemap-manifest-builder');
    logger.log('♻️  Force-rebuilding sitemap manifests...');
    await buildAllSitemapManifests({ force: true });
  } catch (err) {
    logger.error('Failed to rebuild sitemap manifests:', err);
  }
}

async function main(): Promise<void> {
  const uri =
    process.env.MONGODB_URI ||
    process.env.DATABASE_URL ||
    process.env.MONGO_URI;
  if (!uri) {
    throw new Error(
      'MONGODB_URI / DATABASE_URL / MONGO_URI not set in env — cannot connect to Mongo.',
    );
  }

  logger.log(
    `🔌 Connecting to MongoDB for genre slug cleanup (DRY_RUN=${DRY_RUN})...`,
  );
  await mongoose.connect(uri);

  try {
    const stats = await runCleanup();
    logger.log(
      `📊 Genre slug cleanup summary: scanned=${stats.scanned} ` +
        `alreadyValid=${stats.alreadyValid} normalized=${stats.normalized} ` +
        `markedUndiscoverable=${stats.markedUndiscoverable} ` +
        `(emptySlug=${stats.emptySlugMarked} collisions=${stats.collisionMarked}) ` +
        `errors=${stats.errors}`,
    );

    if (stats.normalized > 0 || stats.markedUndiscoverable > 0) {
      await rewarmDownstream();
    } else {
      logger.log('✅ Nothing to fix — skipping downstream re-warm.');
    }
  } finally {
    await mongoose.disconnect();
    logger.log('🔌 Disconnected from MongoDB.');
  }
}

main().catch((err) => {
  console.error('❌ Genre slug cleanup failed:', err);
  process.exit(1);
});
