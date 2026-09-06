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

import { pgCoverage } from '../data/postgres-coverage-store';
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

export async function aggregateForDay(endOfDay: Date): Promise<DailyRow[]> { return pgCoverage().coverage(endOfDay); }

export interface RunCoverageBackfillProgress {
  // ISO `YYYY-MM-DD` of the day just processed (or about to be skipped).
  day: string;
  // 1-based index of the day we just finished within the requested window
  // (counts skipped days too so the displayed bar advances continuously).
  daysProcessed: number;
  // Total day slots in the requested window (always equals `opts.days`).
  daysTotal: number;
  // Cumulative counters across all days processed so far.
  daysSeeded: number;
  inserted: number;
  preserved: number;
  wouldWrite: number;
}

export interface RunCoverageBackfillOptions {
  days: number;
  dryRun?: boolean;
  // Streamed per-day progress callback. Invoked once per day in the
  // requested window — including days that were skipped (pre-data or
  // no-stations) so the UI's progress bar advances continuously rather
  // than appearing to stall on early-history runs.
  onProgress?: (p: RunCoverageBackfillProgress) => void;
  // Polled between days; if it returns true the loop exits early and the
  // partial result is returned. Lets the admin abort a long 365-day run
  // without waiting for it to finish.
  isCancelled?: () => boolean;
}

export interface RunCoverageBackfillResult {
  daysSeeded: number;
  inserted: number;
  preserved: number;
  wouldWrite: number; // dry-run only
  skippedReason?: 'no-stations';
  cancelled?: boolean;
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
  if(!Number.isSafeInteger(days)||days<1||days>3650) throw new RangeError('Coverage history days must be between 1 and 3650');
  const dryRun = !!opts.dryRun;

  logger.log(
    `📈 Coverage backfill START — days=${days} dryRun=${dryRun}`,
  );

  // Quick sanity check: do we actually have any historical signal? If not,
  // log loudly and exit cleanly instead of silently writing a flat line.
  const earliestStation = await pgCoverage().earliestStation();
  if (!earliestStation || !earliestStation.createdAt) {
    logger.warn(
      '📈 Coverage backfill: stations collection is empty — nothing to seed.',
    );
    // Surface a final progress tick so a polling UI can render the
    // "no stations" outcome without waiting for a separate poll cycle.
    opts.onProgress?.({
      day: '',
      daysProcessed: days,
      daysTotal: days,
      daysSeeded: 0,
      inserted: 0,
      preserved: 0,
      wouldWrite: 0,
    });
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

  let cancelled = false;
  for (let i = days; i >= 1; i--) {
    if (opts.isCancelled?.()) {
      cancelled = true;
      logger.log('🛑 Coverage backfill cancellation requested — exiting loop');
      break;
    }
    const snapshotDate = new Date(todayStart.getTime() - i * dayMs);
    const endOfDay = new Date(snapshotDate.getTime() + dayMs);
    const isoDay = snapshotDate.toISOString().slice(0, 10);
    // 1-based count of days completed within the requested window so far.
    const daysProcessedSoFar = days - i + 1;
    const emitProgress = () => {
      opts.onProgress?.({
        day: isoDay,
        daysProcessed: daysProcessedSoFar,
        daysTotal: days,
        daysSeeded: totalDaysSeeded,
        inserted: totalRowsInserted,
        preserved: totalRowsPreserved,
        wouldWrite: totalRowsWouldWrite,
      });
    };

    // Skip days that pre-date any data — flat-zero rows are misleading.
    if (endOfDay <= new Date(earliestStation.createdAt)) {
      logger.log(`⏭️  ${isoDay}: pre-dates earliest station, skipping`);
      emitProgress();
      continue;
    }

    const rows = await aggregateForDay(endOfDay);
    if (rows.length === 0) {
      logger.log(`⏭️  ${isoDay}: no countries with stations yet, skipping`);
      emitProgress();
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
      emitProgress();
      continue;
    }

    const result=await pgCoverage().writeSnapshots(snapshotDate,rows,'backfill');
    const inserted=result.inserted;
    const skipped = rows.length - inserted;
    totalDaysSeeded++;
    totalRowsInserted += inserted;
    totalRowsPreserved += skipped;
    logger.log(
      `📈 ${isoDay}: ${inserted} inserted, ${skipped} preserved (already present)`,
    );
    emitProgress();
  }

  if (cancelled) {
    logger.log(
      `📈 Coverage backfill CANCELLED — days=${totalDaysSeeded} inserted=${totalRowsInserted} preserved=${totalRowsPreserved}`,
    );
  } else if (dryRun) {
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
    cancelled: cancelled || undefined,
  };
}
