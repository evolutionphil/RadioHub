/**
 * First-deploy auto-seeder for `coveragesnapshots` (Task #176).
 *
 * The nightly cron in `scheduled-coverage-snapshot.ts` only writes today's
 * row, and the historical seeder in `scripts/backfill-coverage-snapshots.ts`
 * has to be invoked manually after deploy. If a team member forgets, the
 * admin coverage page shows an empty 30-day sparkline for the first month.
 *
 * This module wires the seeder into the boot path so the first-deploy
 * experience is self-healing:
 *
 *   - On every API boot we count how many distinct historical UTC days
 *     already have at least one snapshot row (excluding today, which the
 *     cron handles).
 *   - If the count is below `MIN_HISTORICAL_DAYS`, we kick the seeder off
 *     in the background — fire-and-forget so it never blocks the boot
 *     handshake or the rest of the background-task chain.
 *   - If the count is at or above the threshold, we skip with a clear log
 *     line so admins can tell the difference between "ran" and "wasn't
 *     needed".
 *
 * Idempotence: the underlying seeder uses `$setOnInsert` keyed on
 * (countryCode, snapshotDate) so re-running it never overwrites real
 * cron-written rows. Even so, the day-count gate prevents the seeder
 * from being re-run on every restart once the collection has been seeded.
 *
 * Safety knobs:
 *   - `SKIP_COVERAGE_BACKFILL_ON_BOOT=true` short-circuits this entirely.
 *     Useful for split deployments where only one replica should run it,
 *     or for manual operational control after a partial seed.
 *   - `COVERAGE_BACKFILL_BOOT_MIN_DAYS` overrides the threshold (default 7).
 *   - `COVERAGE_BACKFILL_BOOT_DAYS` overrides how many days back to seed
 *     (default 30, matching the admin sparkline window).
 */

import { CoverageSnapshot } from '../shared/mongo-schemas';
import { logger } from '../utils/logger';
import { runCoverageBackfill } from '../scripts/backfill-coverage-snapshots';

const DEFAULT_MIN_HISTORICAL_DAYS = 7;
const DEFAULT_BACKFILL_DAYS = 30;

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) return fallback;
  return n;
}

function todayUtcMidnight(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

let hasRunOnce = false;

/**
 * Decide whether to run the historical coverage backfill, and if so kick
 * it off in the background. Safe to call multiple times — the in-process
 * `hasRunOnce` guard combined with the row-count check prevents re-runs
 * on the same node, and `$setOnInsert` prevents cross-replica clobbering.
 *
 * Never throws — boot must continue regardless of seeder outcome.
 */
export async function maybeRunCoverageBackfillOnBoot(): Promise<void> {
  if (hasRunOnce) {
    return;
  }
  hasRunOnce = true;

  if (process.env.SKIP_COVERAGE_BACKFILL_ON_BOOT === 'true') {
    logger.log(
      '📈 Coverage boot backfill: SKIPPED (SKIP_COVERAGE_BACKFILL_ON_BOOT=true)',
    );
    return;
  }

  const minDays = parsePositiveInt(
    process.env.COVERAGE_BACKFILL_BOOT_MIN_DAYS,
    DEFAULT_MIN_HISTORICAL_DAYS,
  );
  const seedDays = parsePositiveInt(
    process.env.COVERAGE_BACKFILL_BOOT_DAYS,
    DEFAULT_BACKFILL_DAYS,
  );

  let historicalDayCount: number;
  try {
    const distinctDays = await CoverageSnapshot.distinct('snapshotDate', {
      snapshotDate: { $lt: todayUtcMidnight() },
    });
    historicalDayCount = Array.isArray(distinctDays) ? distinctDays.length : 0;
  } catch (err: any) {
    logger.warn(
      `⚠️  Coverage boot backfill: SKIPPED — could not count historical days: ${err?.message || err}`,
    );
    return;
  }

  if (historicalDayCount >= minDays) {
    logger.log(
      `📈 Coverage boot backfill: SKIPPED (${historicalDayCount} historical day(s) already present, threshold=${minDays})`,
    );
    return;
  }

  logger.log(
    `📈 Coverage boot backfill: STARTING (only ${historicalDayCount} historical day(s) found, threshold=${minDays}) — seeding ${seedDays} days in background`,
  );

  // Fire-and-forget. The seeder iterates day-by-day and aggregates the
  // entire stations collection per day, so for a seed run with millions
  // of stations this can take a minute or two — we don't want it to
  // block boot. Errors are swallowed (logged) so a regression here
  // can't crash the API.
  runCoverageBackfill({ days: seedDays, dryRun: false })
    .then((res) => {
      if (res.skippedReason === 'no-stations') {
        logger.log(
          '📈 Coverage boot backfill: DONE — stations collection empty, nothing seeded',
        );
        return;
      }
      logger.log(
        `📈 Coverage boot backfill: DONE — daysSeeded=${res.daysSeeded} inserted=${res.inserted} preserved=${res.preserved}`,
      );
    })
    .catch((err: any) => {
      logger.error(
        `❌ Coverage boot backfill: FAILED — ${err?.message || err}`,
      );
    });
}
