import {
  Station,
  Genre,
  GenreStationCountsRun,
  type IGenreStationCountsRun,
} from '@workspace/db-shared/mongo-schemas';
import { logger } from '../utils/logger';

// Recomputes `Genre.stationCount` from the live Station collection.
//
// Why this exists (task #185): the admin Genre Whitelist page reads
// `Genre.stationCount` to flag "thin" / "no matching stations" slugs. After
// bulk station imports, deletions, country backfills, or tag re-checks the
// counts can lag for hours until something else updates them, leaving admins
// with a misleading view of what's actually indexable.
//
// We aggregate Station tags + genre exactly the way `precomputed-genres.ts`
// does (lowercased, comma-split tags + the `genre` field) so a Genre's
// stationCount lines up with what the public /genres listing computes.
//
// Concurrent calls are coalesced — a finishing bulk import, a finishing
// coverage backfill, and an admin clicking "Refresh counts" can all fire
// this at once; we only want one aggregation in flight.

interface RecomputeStatus {
  lastRecomputedAt: Date | null;
  lastDurationMs: number | null;
  lastUpdatedSlugs: number;
  lastTotalGenres: number;
  inFlight: boolean;
  lastTrigger: string | null;
}

const status: RecomputeStatus = {
  lastRecomputedAt: null,
  lastDurationMs: null,
  lastUpdatedSlugs: 0,
  lastTotalGenres: 0,
  inFlight: false,
  lastTrigger: null,
};

let pendingPromise: Promise<void> | null = null;

export function getGenreStationCountsStatus(): RecomputeStatus {
  return { ...status };
}

// Task #330: cap the GenreStationCountsRun audit collection. This service
// fires often (nightly cron + every bulk-op hook + admin clicks), so the
// row count grows much faster than the weekly genre-slug cleanup audit.
// We keep the newest N rows; older ones are dropped after every run.
// Tunable via env in case ops wants a longer trail.
export const GENRE_STATION_COUNTS_RETENTION_MAX_ROWS_DEFAULT = 200;
export const GENRE_STATION_COUNTS_RETENTION_MAX_ROWS_MIN = 10;
export const GENRE_STATION_COUNTS_RETENTION_MAX_ROWS_MAX = 100_000;

function envGenreStationCountsRetentionMaxRows(): number {
  const raw = Number.parseInt(
    process.env.GENRE_STATION_COUNTS_RETENTION_MAX_ROWS ?? '',
    10,
  );
  if (
    Number.isFinite(raw) &&
    raw >= GENRE_STATION_COUNTS_RETENTION_MAX_ROWS_MIN
  ) {
    return Math.min(raw, GENRE_STATION_COUNTS_RETENTION_MAX_ROWS_MAX);
  }
  return GENRE_STATION_COUNTS_RETENTION_MAX_ROWS_DEFAULT;
}

export function getGenreStationCountsRetentionMaxRows(): number {
  return envGenreStationCountsRetentionMaxRows();
}

async function pruneOldGenreStationCountsRuns(): Promise<void> {
  try {
    const maxRows = envGenreStationCountsRetentionMaxRows();
    const pivot = await GenreStationCountsRun.findOne()
      .sort({ startedAt: -1 })
      .skip(maxRows - 1)
      .select({ startedAt: 1 })
      .lean<{ startedAt: Date } | null>();
    if (pivot?.startedAt) {
      await GenreStationCountsRun.deleteMany({
        startedAt: { $lt: pivot.startedAt },
      });
    }
  } catch (err) {
    logger.warn('⚠️  pruneOldGenreStationCountsRuns failed (non-fatal):', err);
  }
}

export function recomputeGenreStationCounts(trigger: string): Promise<void> {
  if (pendingPromise) return pendingPromise;
  status.inFlight = true;
  status.lastTrigger = trigger;
  const startedAt = Date.now();
  const startedAtDate = new Date(startedAt);
  pendingPromise = (async () => {
    // Persist an audit row so admins can see the cron has been firing
    // reliably (task #330). Created inside the try/catch so a transient
    // Mongo blip on insert can't poison the recompute itself.
    let run: IGenreStationCountsRun | null = null;
    try {
      run = await GenreStationCountsRun.create({
        trigger,
        status: 'running',
        startedAt: startedAtDate,
        totalGenres: 0,
        updatedSlugs: 0,
      });
    } catch (err) {
      logger.error(
        '⚠️  Could not persist GenreStationCountsRun audit row, continuing without it:',
        err,
      );
    }
    try {
      const tagCounts = await Station.aggregate([
        {
          $addFields: {
            allTags: {
              $setUnion: [
                { $cond: [
                  { $and: [{ $ne: ['$genre', null] }, { $ne: ['$genre', ''] }] },
                  [{ $toLower: '$genre' }],
                  [],
                ]},
                { $cond: [
                  { $and: [{ $ne: ['$tags', null] }, { $ne: ['$tags', ''] }] },
                  { $map: {
                    input: { $split: ['$tags', ','] },
                    as: 'tag',
                    in: { $toLower: { $trim: { input: '$$tag' } } },
                  }},
                  [],
                ]},
              ],
            },
          },
        },
        { $unwind: '$allTags' },
        { $match: { allTags: { $ne: '' } } },
        { $group: { _id: '$allTags', count: { $sum: 1 } } },
      ]).option({ maxTimeMS: 60_000, allowDiskUse: true });

      const counts = new Map<string, number>();
      for (const entry of tagCounts as Array<{ _id: string; count: number }>) {
        counts.set(entry._id, entry.count);
      }

      const genres = await Genre.find({})
        .select('_id slug stationCount')
        .lean<Array<{ _id: any; slug?: string; stationCount?: number }>>();

      const ops: any[] = [];
      const now = new Date();
      for (const g of genres) {
        if (!g.slug) continue;
        const newCount = counts.get(g.slug.toLowerCase()) ?? 0;
        if ((g.stationCount ?? 0) !== newCount) {
          ops.push({
            updateOne: {
              filter: { _id: g._id },
              update: { $set: { stationCount: newCount, updatedAt: now } },
            },
          });
        }
      }

      if (ops.length > 0) {
        await Genre.bulkWrite(ops, { ordered: false });
      }

      status.lastUpdatedSlugs = ops.length;
      status.lastTotalGenres = genres.length;
      status.lastRecomputedAt = new Date();
      status.lastDurationMs = Date.now() - startedAt;
      logger.log(
        `✅ Genre.stationCount recomputed (${trigger}) in ${status.lastDurationMs}ms — ` +
          `${ops.length}/${genres.length} updated`,
      );
      if (run) {
        const finishedAt = new Date();
        run.status = 'completed';
        run.finishedAt = finishedAt;
        run.durationMs = finishedAt.getTime() - startedAt;
        run.totalGenres = genres.length;
        run.updatedSlugs = ops.length;
        try {
          await run.save();
        } catch (saveErr) {
          logger.error(
            '⚠️  Could not save GenreStationCountsRun completion row:',
            saveErr,
          );
        }
      }
    } catch (err: any) {
      logger.error(
        `Failed to recompute Genre.stationCount (${trigger}):`,
        err?.message ?? err,
      );
      if (run) {
        const finishedAt = new Date();
        run.status = 'failed';
        run.finishedAt = finishedAt;
        run.durationMs = finishedAt.getTime() - startedAt;
        run.errorMessage = err instanceof Error ? err.message : String(err);
        try {
          await run.save();
        } catch (saveErr) {
          logger.error(
            '⚠️  Could not save GenreStationCountsRun failure row:',
            saveErr,
          );
        }
      }
    } finally {
      status.inFlight = false;
      pendingPromise = null;
      // Best-effort prune so the audit collection doesn't grow without
      // bound. Errors are swallowed inside the helper.
      await pruneOldGenreStationCountsRuns();
    }
  })();
  return pendingPromise;
}

// Fire-and-forget variant — bulk operations call this from their finish
// hooks; admins shouldn't block on it. Errors are swallowed inside
// `recomputeGenreStationCounts`.
export function triggerGenreStationCountsRecompute(trigger: string): void {
  void recomputeGenreStationCounts(trigger);
}
