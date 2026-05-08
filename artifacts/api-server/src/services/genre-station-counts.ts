import { Station, Genre } from '../shared/mongo-schemas';
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

export function recomputeGenreStationCounts(trigger: string): Promise<void> {
  if (pendingPromise) return pendingPromise;
  status.inFlight = true;
  status.lastTrigger = trigger;
  const startedAt = Date.now();
  pendingPromise = (async () => {
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
    } catch (err: any) {
      logger.error(
        `Failed to recompute Genre.stationCount (${trigger}):`,
        err?.message ?? err,
      );
    } finally {
      status.inFlight = false;
      pendingPromise = null;
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
