/**
 * One-shot audit + cleanup helper for duplicate `Genre.slug` values.
 *
 * Background (Task #210 → #282):
 *   Task #210 upgraded the Mongo index on `Genre.slug` to a partial unique
 *   index. If the live database still contains two or more genre documents
 *   that share the same (valid) slug — e.g. legacy admin edits made before
 *   the safeguard existed — Mongo will fail to build the new index on next
 *   server boot ("E11000 duplicate key on index: slug_1") and the
 *   safeguard will not be active.
 *
 *   The companion script `cleanup-malformed-genre-slugs.ts` only resolves
 *   collisions discovered while *normalizing* a malformed slug. It does
 *   not look at pairs/groups of docs that already share the same valid
 *   slug, which is exactly what blocks the new unique index. This script
 *   fills that gap.
 *
 * Strategy per duplicate slug group (>=2 docs sharing the same slug):
 *   1. Pick a canonical winner. Tiebreaker order:
 *        a. highest `stationCount` (the genre actually wired up to
 *           the most stations should keep the slug),
 *        b. `isDiscoverable === true` over `false` (don't accidentally
 *           promote a hidden/junk row over a live one),
 *        c. oldest `createdAt` (favor the original record),
 *        d. lexicographically smallest `_id` for a final deterministic
 *           tiebreak so re-runs are stable.
 *   2. Every other doc in the group ("losers") gets:
 *        - `slug` unset (so it no longer collides — partial unique index
 *          ignores docs whose slug field is missing),
 *        - `isDiscoverable: false` (don't expose a now-slugless genre on
 *          the public site / sitemap),
 *        - `cleanupDemotion` written with `reason: 'collision'` and the
 *          winner's id/slug/name so the existing admin "Recently demoted
 *          by slug cleanup" view can render it (same shape used by
 *          `cleanup-malformed-genre-slugs.ts`).
 *   3. The winner is left untouched.
 *
 *   We deliberately do NOT auto-merge stations across genre docs — Genre
 *   is referenced by id from many places (Station.genres, precomputed
 *   caches, sitemap manifests). Cross-doc merges belong in a dedicated
 *   admin-driven flow; here we just unblock the unique index.
 *
 * Usage (CLI, run once against prod after deploying Task #210):
 *   pnpm --filter @workspace/api-server exec tsx \
 *     src/scripts/cleanup-duplicate-genre-slugs.ts
 *   DRY_RUN=1 pnpm --filter @workspace/api-server exec tsx \
 *     src/scripts/cleanup-duplicate-genre-slugs.ts
 *
 * Usage (in-process):
 *   import { runDuplicateGenreSlugCleanup } from
 *     '.../scripts/cleanup-duplicate-genre-slugs';
 *   const stats = await runDuplicateGenreSlugCleanup({
 *     manageConnection: false,
 *   });
 *
 * Environment: requires `MONGODB_URI` (or `DATABASE_URL` / `MONGO_URI`)
 * only when `manageConnection: true` (the default for CLI invocations).
 */

import mongoose from 'mongoose';
import type { Collection, ObjectId } from 'mongodb';
import { Genre } from '@workspace/db-shared/mongo-schemas';
import { logger } from '../utils/logger';

export interface DuplicateGenreSlugCleanupStats {
  scanned: number;
  duplicateGroups: number;
  winnersKept: number;
  losersDemoted: number;
  errors: number;
}

export interface RunDuplicateGenreSlugCleanupOptions {
  manageConnection?: boolean;
  dryRun?: boolean;
  log?: (message: string) => void;
}

interface GenreSlugDoc {
  _id: ObjectId | string;
  name?: string | null;
  slug?: string | null;
  isDiscoverable?: boolean;
  stationCount?: number;
  createdAt?: Date;
}

function pickWinner(docs: GenreSlugDoc[]): GenreSlugDoc {
  // Higher stationCount, then discoverable, then older, then smallest _id.
  const sorted = [...docs].sort((a, b) => {
    const sa = a.stationCount ?? 0;
    const sb = b.stationCount ?? 0;
    if (sa !== sb) return sb - sa;

    const da = a.isDiscoverable ? 1 : 0;
    const db = b.isDiscoverable ? 1 : 0;
    if (da !== db) return db - da;

    const ca = a.createdAt ? a.createdAt.getTime() : Number.POSITIVE_INFINITY;
    const cb = b.createdAt ? b.createdAt.getTime() : Number.POSITIVE_INFINITY;
    if (ca !== cb) return ca - cb;

    return String(a._id) < String(b._id) ? -1 : 1;
  });
  return sorted[0]!;
}

async function scanAndFix(
  dryRun: boolean,
  log: (m: string) => void,
): Promise<DuplicateGenreSlugCleanupStats> {
  const stats: DuplicateGenreSlugCleanupStats = {
    scanned: 0,
    duplicateGroups: 0,
    winnersKept: 0,
    losersDemoted: 0,
    errors: 0,
  };

  // Bypass the schema validator (legacy docs may not satisfy the new
  // SAFE_GENRE_SLUG_RE rule and `.save()` would refuse them).
  const coll = Genre.collection as unknown as Collection<GenreSlugDoc>;

  // Aggregate to find slugs owned by more than one doc. Only consider
  // docs whose slug is a non-empty string — null/missing slugs are
  // already excluded by the partial unique filter and don't collide.
  const groups = (await coll
    .aggregate([
      { $match: { slug: { $type: 'string', $ne: '' } } },
      {
        $group: {
          _id: '$slug',
          ids: { $push: '$_id' },
          count: { $sum: 1 },
        },
      },
      { $match: { count: { $gt: 1 } } },
      { $sort: { count: -1, _id: 1 } },
    ])
    .toArray()) as Array<{ _id: string; ids: Array<ObjectId | string>; count: number }>;

  log(`🔍 Found ${groups.length} duplicate slug group(s).`);

  const nowDate = new Date();

  for (const group of groups) {
    stats.duplicateGroups++;
    const slug = group._id;

    const docs = (await coll
      .find(
        { _id: { $in: group.ids } },
        {
          projection: {
            _id: 1,
            name: 1,
            slug: 1,
            isDiscoverable: 1,
            stationCount: 1,
            createdAt: 1,
          },
        },
      )
      .toArray()) as GenreSlugDoc[];
    stats.scanned += docs.length;

    if (docs.length < 2) {
      // Race: someone else already cleaned this group between aggregate
      // and find. Nothing to do.
      continue;
    }

    const winner = pickWinner(docs);
    const losers = docs.filter((d) => String(d._id) !== String(winner._id));
    stats.winnersKept++;

    log(
      `🏆 slug="${slug}" winner=[${winner._id}] name=${JSON.stringify(
        winner.name ?? null,
      )} stationCount=${winner.stationCount ?? 0} discoverable=${
        winner.isDiscoverable ? 1 : 0
      } losers=${losers.length}`,
    );

    for (const loser of losers) {
      log(
        `  ↳ demote loser=[${loser._id}] name=${JSON.stringify(
          loser.name ?? null,
        )} stationCount=${loser.stationCount ?? 0} discoverable=${
          loser.isDiscoverable ? 1 : 0
        } — clearing slug, marking isDiscoverable=false`,
      );
      if (dryRun) continue;

      try {
        await coll.updateOne(
          { _id: loser._id },
          {
            $set: {
              isDiscoverable: false,
              updatedAt: nowDate,
              cleanupDemotion: {
                reason: 'collision',
                originalSlug: slug,
                normalizedSlug: slug,
                collisionWinnerId: winner._id,
                collisionWinnerSlug: winner.slug ?? slug,
                collisionWinnerName: winner.name ?? undefined,
                demotedAt: nowDate,
              },
            },
            $unset: { slug: '' },
          },
        );
        stats.losersDemoted++;
      } catch (err) {
        stats.errors++;
        logger.error(`Failed to demote duplicate genre ${loser._id}:`, err);
      }
    }
  }

  return stats;
}

export async function runDuplicateGenreSlugCleanup(
  options: RunDuplicateGenreSlugCleanupOptions = {},
): Promise<DuplicateGenreSlugCleanupStats> {
  const dryRun =
    options.dryRun ??
    (process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true');
  const manageConnection = options.manageConnection ?? true;
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
    log(
      `🔌 Connecting to MongoDB for duplicate genre slug cleanup (DRY_RUN=${dryRun})...`,
    );
    await mongoose.connect(uri);
  }

  try {
    const stats = await scanAndFix(dryRun, log);
    log(
      `📊 Duplicate genre slug cleanup summary: scanned=${stats.scanned} ` +
        `duplicateGroups=${stats.duplicateGroups} winnersKept=${stats.winnersKept} ` +
        `losersDemoted=${stats.losersDemoted} errors=${stats.errors}`,
    );

    if (dryRun) {
      log('🟡 DRY_RUN — no writes performed.');
    } else if (stats.duplicateGroups === 0) {
      log('✅ No duplicate slugs found — partial unique index can build cleanly.');
    } else {
      log(
        '✅ Duplicates resolved. Restart the API server (or run ' +
          '`Genre.syncIndexes()`) so Mongo can build the partial unique ' +
          'index on `slug`.',
      );
    }

    return stats;
  } finally {
    if (manageConnection) {
      await mongoose.disconnect();
      log('🔌 Disconnected from MongoDB.');
    }
  }
}

const isDirectRun = (() => {
  // After esbuild bundles this file into the api-server entry,
  // `import.meta.url` collapses to the bundle path and matches
  // `process.argv[1]` for every bundled script — so the CLI auto-run
  // below would fire on every server boot, racing the main
  // mongoose.connect() and tearing the shared connection down with its
  // own connect/disconnect. Require the source filename to be present in
  // `import.meta.url` so this only triggers when run directly via tsx.
  if (!import.meta.url.includes('cleanup-duplicate-genre-slugs')) return false;
  try {
    const invoked = process.argv[1] ? new URL(`file://${process.argv[1]}`).href : '';
    return invoked === import.meta.url;
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  runDuplicateGenreSlugCleanup().catch((err) => {
    console.error('❌ Duplicate genre slug cleanup failed:', err);
    process.exit(1);
  });
}
