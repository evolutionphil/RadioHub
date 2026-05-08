/**
 * One-shot maintenance: remove junk `Genre` documents left over from the
 * pre-task-#104 era, where the genre collection was populated from raw
 * station tags (FM frequencies, city names, brand names, random tokens).
 *
 * A document is considered "junk" when its slug (or, if missing, a slug
 * derived from its name in the same way `precomputed-genres.ts` does) is
 * NOT on `GENRE_WHITELIST` and NOT a key on `GENRE_ALIASES`.
 *
 * The script is idempotent — running it again after all junk is gone is a
 * no-op. Pass `DRY_RUN=1` to log what would be deleted without writing.
 *
 * Usage:
 *   pnpm --filter @workspace/api-server exec tsx src/scripts/cleanup-junk-genres.ts
 *   DRY_RUN=1 pnpm --filter @workspace/api-server run cleanup:junk-genres
 *
 * Environment: requires `MONGODB_URI` (or `DATABASE_URL` / `MONGO_URI`).
 */

import mongoose from 'mongoose';
import { Genre } from '../shared/mongo-schemas';
import {
  GENRE_ALIASES,
  isWhitelistedGenreSlug,
} from '../seo/genre-whitelist';
import { logger } from '../utils/logger';

const DRY_RUN =
  process.env.DRY_RUN === '1' ||
  process.env.DRY_RUN === 'true' ||
  process.env.DRY_RUN === 'yes';

function deriveSlug(doc: { slug?: string | null; name?: string | null }): string | null {
  const raw = (doc.slug && doc.slug.trim()) || (doc.name && doc.name.trim()) || '';
  if (!raw) return null;
  return raw.toLowerCase().replace(/\s+/g, '-');
}

function isKeepable(slug: string | null): boolean {
  if (!slug) return false;
  if (isWhitelistedGenreSlug(slug)) return true;
  if (GENRE_ALIASES.has(slug)) return true;
  return false;
}

export interface CleanupReport {
  total: number;
  kept: number;
  deleted: number;
  unslugged: number; // junk docs that had no slug/name at all
  dryRun: boolean;
}

export async function cleanupJunkGenres(opts: { dryRun?: boolean } = {}): Promise<CleanupReport> {
  const dryRun = opts.dryRun ?? DRY_RUN;

  const report: CleanupReport = {
    total: 0,
    kept: 0,
    deleted: 0,
    unslugged: 0,
    dryRun,
  };

  const idsToDelete: any[] = [];

  // Stream all Genre docs — the collection is small (thousands of rows max)
  // but a cursor avoids loading everything at once.
  const cursor = Genre.find({}, { _id: 1, slug: 1, name: 1 }).lean().cursor();

  for await (const doc of cursor) {
    report.total++;
    const slug = deriveSlug(doc as any);
    if (isKeepable(slug)) {
      report.kept++;
      continue;
    }
    if (!slug) report.unslugged++;
    idsToDelete.push((doc as any)._id);
  }

  if (idsToDelete.length === 0) {
    logger.log(
      `[cleanup-junk-genres] nothing to delete: scanned=${report.total} kept=${report.kept}`,
    );
    return report;
  }

  if (dryRun) {
    report.deleted = idsToDelete.length;
    logger.log(
      `[cleanup-junk-genres] DRY RUN — would delete ${idsToDelete.length} of ${report.total} ` +
        `genres (kept=${report.kept}, unslugged=${report.unslugged}). No writes performed.`,
    );
    return report;
  }

  // Delete in chunks to keep individual ops bounded.
  const CHUNK = 500;
  for (let i = 0; i < idsToDelete.length; i += CHUNK) {
    const slice = idsToDelete.slice(i, i + CHUNK);
    const result = await Genre.deleteMany({ _id: { $in: slice } });
    report.deleted += result.deletedCount ?? 0;
  }

  logger.log(
    `[cleanup-junk-genres] done: scanned=${report.total} kept=${report.kept} ` +
      `deleted=${report.deleted} unslugged=${report.unslugged}`,
  );
  return report;
}

// CLI entrypoint — only run when invoked directly, not when imported.
const isDirectRun = (() => {
  try {
    const entry = process.argv[1] ? new URL(`file://${process.argv[1]}`).href : '';
    return entry === import.meta.url;
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  (async () => {
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
      `🔌 Connecting to MongoDB for junk-genre cleanup${DRY_RUN ? ' (DRY RUN)' : ''}...`,
    );
    await mongoose.connect(uri);

    try {
      const report = await cleanupJunkGenres();
      logger.log(`[cleanup-junk-genres] report: ${JSON.stringify(report)}`);
    } finally {
      await mongoose.disconnect();
    }
  })().catch((err) => {
    logger.error('[cleanup-junk-genres] crashed:', err?.message || err);
    process.exit(1);
  });
}
