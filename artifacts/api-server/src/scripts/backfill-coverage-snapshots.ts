/**
 * One-shot historical coverage backfill (Task #144).
 *
 * The nightly snapshot job (`services/scheduled-coverage-snapshot.ts`) only
 * starts collecting per-country coverage from the day it is first deployed,
 * which leaves the admin coverage page with an empty 30-day sparkline for
 * the first month. This script seeds `coveragesnapshots` from whatever
 * historical signal already exists on the `stations` collection so admins
 * see a meaningful trend immediately.
 *
 * Historical signals used (best-effort reconstruction):
 *   - `total`     ← stations with `createdAt <= endOfDay(d)`
 *   - `withLogo`  ← stations with `logoAssets.status='completed'` AND
 *                   `logoAssets.processedAt <= endOfDay(d)`
 *   - `withTags`  ← stations with non-empty `tags` AND
 *                   `createdAt <= endOfDay(d)` (we don't track when tags
 *                   first arrived per station; `tags` almost always lands
 *                   with the station from the Radio-Browser sync, so
 *                   creation date is the closest proxy. Stations that
 *                   currently have empty tags are excluded from the count
 *                   on every day, including past days, which mirrors the
 *                   live aggregation in `scheduled-coverage-snapshot.ts`.)
 *
 * Idempotent: each day's row is upserted with `$setOnInsert` only, so the
 * script never overwrites a real snapshot already written by the cron job
 * and re-running the script does not double-write a day's row. There is
 * intentionally no overwrite/force flag — re-seeding would risk clobbering
 * legitimate cron snapshots, since the schema has no source discriminator
 * to tell synthetic rows apart from cron-written ones. If you need to
 * re-seed, drop the rows manually first.
 *
 * Usage:
 *   pnpm --filter @workspace/api-server exec tsx \
 *     src/scripts/backfill-coverage-snapshots.ts
 *
 * Environment:
 *   - MONGODB_URI / DATABASE_URL / MONGO_URI (required)
 *   - BACKFILL_DAYS=30        How many days back to seed (default 30,
 *                             must be a positive finite integer)
 *   - DRY_RUN=1               Log what would be written, don't write
 */

import mongoose from 'mongoose';
import { Station, CoverageSnapshot } from '../shared/mongo-schemas';
import { logger } from '../utils/logger';

function parseDays(raw: string | undefined): number {
  if (raw === undefined || raw === '') return 30;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
    throw new Error(
      `BACKFILL_DAYS must be a positive integer, got ${JSON.stringify(raw)}`,
    );
  }
  return n;
}

const DAYS = parseDays(process.env.BACKFILL_DAYS);
const DRY_RUN =
  process.env.DRY_RUN === '1' ||
  process.env.DRY_RUN === 'true' ||
  process.env.DRY_RUN === 'yes';

function utcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

interface DailyRow {
  countryCode: string;
  total: number;
  withLogo: number;
  withTags: number;
}

async function aggregateForDay(endOfDay: Date): Promise<DailyRow[]> {
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
    `📈 Coverage backfill START — days=${DAYS} dryRun=${DRY_RUN}`,
  );
  await mongoose.connect(uri);

  // Quick sanity check: do we actually have any historical signal? If not,
  // log loudly and exit cleanly instead of silently writing a flat line.
  const earliestStation = await Station.findOne({}, { createdAt: 1 })
    .sort({ createdAt: 1 })
    .lean();
  if (!earliestStation || !earliestStation.createdAt) {
    logger.warn(
      '📈 Coverage backfill: stations collection is empty — nothing to seed.',
    );
    await mongoose.disconnect();
    return;
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

  for (let i = DAYS; i >= 1; i--) {
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

    if (DRY_RUN) {
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

  if (DRY_RUN) {
    logger.log(
      `📈 Coverage backfill DONE (dry-run) — days=${totalDaysSeeded} wouldAttempt=${totalRowsWouldWrite} (no writes)`,
    );
  } else {
    logger.log(
      `📈 Coverage backfill DONE — days=${totalDaysSeeded} inserted=${totalRowsInserted} preserved=${totalRowsPreserved}`,
    );
  }

  await mongoose.disconnect();
  logger.log('🔌 Disconnected from MongoDB.');
}

main().catch((err) => {
  console.error('❌ Coverage backfill failed:', err);
  process.exit(1);
});
