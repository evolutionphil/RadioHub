/**
 * Reusable historical coverage backfill (Task #144 / Task #237).
 *
 * Originally lived in `scripts/backfill-coverage-snapshots.ts`. Extracted
 * into a service so the same logic can be invoked from the admin API
 * (the "Reconstruct sparkline history" button on the coverage page) as
 * well as the standalone CLI.
 *
 * Historical signals used (best-effort reconstruction):
 *   - `total`     ← stations with `createdAt <= endOfDay(d)`
 *   - `withLogo`  ← stations with `logoAssets.status='completed'` AND
 *                   `logoAssets.processedAt <= endOfDay(d)`
 *   - `withTags`  ← stations with non-empty `tags` AND
 *                   `createdAt <= endOfDay(d)` (we don't track when tags
 *                   first arrived per station; `tags` almost always lands
 *                   with the station from the Radio-Browser sync, so
 *                   creation date is the closest proxy.)
 *
 * Idempotent: each day's row is upserted with `$setOnInsert` only, so
 * re-running never overwrites a real cron-written snapshot. Reconstructed
 * rows are tagged with `source: 'backfill'`; the nightly cron job
 * promotes them to `source: 'cron'` as days roll over.
 */

import {
  Station,
  CoverageSnapshot,
} from '@workspace/db-shared/mongo-schemas';
import { logger } from '../utils/logger';

function utcMidnight(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

interface DailyRow {
  countryCode: string;
  total: number;
  withLogo: number;
  withTags: number;
}

export async function aggregateForDay(endOfDay: Date): Promise<DailyRow[]> {
  // endOfDay = exclusive upper bound (i.e. start of the next UTC day).
  // A station "existed on day D" iff createdAt < startOfDay(D+1) = endOfDay.
  const rows = await Station.aggregate<{
    _id: string;
    total: number;
    withLogo: number;
    withTags: number;
  }>([
    {
      $match: {
        countryCode: { $exists: true, $nin: [null, '', 'null'] },
        createdAt: { $lt: endOfDay },
      },
    },
    {
      $group: {
        _id: { $toUpper: '$countryCode' },
        total: { $sum: 1 },
        withLogo: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ['$logoAssets.status', 'completed'] },
                  { $ne: ['$logoAssets.processedAt', null] },
                  { $lt: ['$logoAssets.processedAt', endOfDay] },
                ],
              },
              1,
              0,
            ],
          },
        },
        withTags: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $ne: ['$tags', null] },
                  { $ne: [{ $ifNull: ['$tags', ''] }, ''] },
                  {
                    $not: [
                      {
                        $regexMatch: {
                          input: { $ifNull: ['$tags', ''] },
                          regex: /^\s*$/,
                        },
                      },
                    ],
                  },
                ],
              },
              1,
              0,
            ],
          },
        },
      },
    },
  ]);

  return rows
    .filter((r) => r._id && typeof r._id === 'string')
    .map((r) => ({
      countryCode: String(r._id).toUpperCase(),
      total: Number(r.total) || 0,
      withLogo: Number(r.withLogo) || 0,
      withTags: Number(r.withTags) || 0,
    }));
}

export interface RunCoverageBackfillOptions {
  days: number;
  dryRun?: boolean;
}

export interface RunCoverageBackfillResult {
  daysSeeded: number;
  inserted: number;
  preserved: number;
  wouldWrite: number; // dry-run only
  skippedReason?: 'no-stations';
}

/**
 * Walks the last `days` UTC days and upserts a per-country synthetic
 * snapshot for any (country, day) pair that doesn't already have a real
 * cron-written row. Assumes the caller has already connected to MongoDB
 * — does NOT call mongoose.connect/disconnect itself, so it can be
 * invoked from the API server runtime without disturbing the shared
 * connection.
 */
export async function runCoverageBackfill(
  opts: RunCoverageBackfillOptions,
): Promise<RunCoverageBackfillResult> {
  const days = opts.days;
  const dryRun = !!opts.dryRun;

  logger.log(
    `📈 Coverage backfill START — days=${days} dryRun=${dryRun}`,
  );

  // Quick sanity check: do we actually have any historical signal? If not,
  // log loudly and exit cleanly instead of silently writing a flat line.
  const earliestStation = await Station.findOne({}, { createdAt: 1 })
    .sort({ createdAt: 1 })
    .lean();
  if (!earliestStation || !earliestStation.createdAt) {
    logger.warn(
      '📈 Coverage backfill: stations collection is empty — nothing to seed.',
    );
    return {
      daysSeeded: 0,
      inserted: 0,
      preserved: 0,
      wouldWrite: 0,
      skippedReason: 'no-stations',
    };
  }
  logger.log(
    `📈 Earliest station createdAt = ${new Date(earliestStation.createdAt).toISOString()}`,
  );

  // Walk the day window from oldest → newest so logs read chronologically.
  const todayStart = utcMidnight(new Date());
  const dayMs = 24 * 60 * 60 * 1000;

  let totalDaysSeeded = 0;
  let totalRowsWouldWrite = 0; // dry-run only
  let totalRowsInserted = 0;
  let totalRowsPreserved = 0;

  for (let i = days; i >= 1; i--) {
    const snapshotDate = new Date(todayStart.getTime() - i * dayMs);
    const endOfDay = new Date(snapshotDate.getTime() + dayMs);
    const isoDay = snapshotDate.toISOString().slice(0, 10);

    // Skip days that pre-date any data — flat-zero rows are misleading.
    if (endOfDay <= new Date(earliestStation.createdAt)) {
      logger.log(`⏭️  ${isoDay}: pre-dates earliest station, skipping`);
      continue;
    }

    const rows = await aggregateForDay(endOfDay);
    if (rows.length === 0) {
      logger.log(`⏭️  ${isoDay}: no countries with stations yet, skipping`);
      continue;
    }

    if (dryRun) {
      const sample = rows
        .slice(0, 3)
        .map(
          (r) =>
            `${r.countryCode}=${r.withLogo}/${r.withTags}/${r.total}`,
        )
        .join(' ');
      logger.log(
        `🧪 ${isoDay}: would attempt ${rows.length} countries — sample: ${sample}`,
      );
      totalDaysSeeded++;
      totalRowsWouldWrite += rows.length;
      continue;
    }

    const ops = rows.map((row) => {
      const total = row.total;
      const logoCoveragePct =
        total > 0 ? Math.round((row.withLogo / total) * 1000) / 10 : 0;
      const tagCoveragePct =
        total > 0 ? Math.round((row.withTags / total) * 1000) / 10 : 0;
      return {
        updateOne: {
          filter: { countryCode: row.countryCode, snapshotDate },
          update: {
            // $setOnInsert preserves any real cron-written row that
            // already exists for this (country, day) pair.
            $setOnInsert: {
              countryCode: row.countryCode,
              snapshotDate,
              total,
              withLogo: row.withLogo,
              withTags: row.withTags,
              logoCoveragePct,
              tagCoveragePct,
              // Tag this row as a reconstructed/backfilled point so the
              // admin coverage chart can render it differently from real
              // cron-written snapshots. See `CoverageSnapshot.source`.
              source: 'backfill' as const,
              createdAt: new Date(),
            },
          },
          upsert: true,
        },
      };
    });

    const result = await CoverageSnapshot.bulkWrite(ops, { ordered: false });
    const inserted = result.upsertedCount || 0;
    const skipped = rows.length - inserted;
    totalDaysSeeded++;
    totalRowsInserted += inserted;
    totalRowsPreserved += skipped;
    logger.log(
      `📈 ${isoDay}: ${inserted} inserted, ${skipped} preserved (already present)`,
    );
  }

  if (dryRun) {
    logger.log(
      `📈 Coverage backfill DONE (dry-run) — days=${totalDaysSeeded} wouldAttempt=${totalRowsWouldWrite} (no writes)`,
    );
  } else {
    logger.log(
      `📈 Coverage backfill DONE — days=${totalDaysSeeded} inserted=${totalRowsInserted} preserved=${totalRowsPreserved}`,
    );
  }

  return {
    daysSeeded: totalDaysSeeded,
    inserted: totalRowsInserted,
    preserved: totalRowsPreserved,
    wouldWrite: totalRowsWouldWrite,
  };
}
