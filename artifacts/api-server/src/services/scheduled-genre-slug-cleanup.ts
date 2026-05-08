import cron from 'node-cron';
import { GenreSlugCleanupRun, type IGenreSlugCleanupRun } from '@workspace/db-shared/mongo-schemas';
import { logger } from '../utils/logger';
import {
  runGenreSlugCleanup,
  type GenreSlugCleanupStats,
} from '../scripts/cleanup-malformed-genre-slugs';
import { notifyGenreSlugCleanupResult } from './genre-slug-cleanup-notifier';

// Retention policy for the GenreSlugCleanupRun collection (Task #265).
// Mirrors the BackfillRun retention pattern in `scheduled-backfill.ts`:
// without it the audit collection grows unbounded — one row per weekly
// cron, plus every admin-triggered manual run — which would slow the
// new history endpoint over time. After every sweep finishes we drop:
//   - rows older than the resolved days threshold (default 90 days), AND
//   - anything beyond the newest N rows (default 200) regardless of age.
// Bounds and defaults intentionally match the BackfillRun policy so
// admins reason about a single retention story across both audits.
export const GENRE_SLUG_CLEANUP_RETENTION_DAYS_DEFAULT = 90;
export const GENRE_SLUG_CLEANUP_RETENTION_MAX_ROWS_DEFAULT = 200;
export const GENRE_SLUG_CLEANUP_RETENTION_DAYS_MIN = 1;
export const GENRE_SLUG_CLEANUP_RETENTION_DAYS_MAX = 3650;
export const GENRE_SLUG_CLEANUP_RETENTION_MAX_ROWS_MIN = 10;
export const GENRE_SLUG_CLEANUP_RETENTION_MAX_ROWS_MAX = 100_000;

function envGenreSlugCleanupRetentionDays(): number {
  const raw = Number.parseInt(
    process.env.GENRE_SLUG_CLEANUP_RETENTION_DAYS ?? '',
    10,
  );
  if (Number.isFinite(raw) && raw >= GENRE_SLUG_CLEANUP_RETENTION_DAYS_MIN) {
    return Math.min(raw, GENRE_SLUG_CLEANUP_RETENTION_DAYS_MAX);
  }
  return GENRE_SLUG_CLEANUP_RETENTION_DAYS_DEFAULT;
}

function envGenreSlugCleanupRetentionMaxRows(): number {
  const raw = Number.parseInt(
    process.env.GENRE_SLUG_CLEANUP_RETENTION_MAX_ROWS ?? '',
    10,
  );
  if (
    Number.isFinite(raw) &&
    raw >= GENRE_SLUG_CLEANUP_RETENTION_MAX_ROWS_MIN
  ) {
    return Math.min(raw, GENRE_SLUG_CLEANUP_RETENTION_MAX_ROWS_MAX);
  }
  return GENRE_SLUG_CLEANUP_RETENTION_MAX_ROWS_DEFAULT;
}

/**
 * Resolve the effective retention thresholds. Resolved on each call so
 * env-var changes take effect on the next prune without a redeploy
 * (matches the spirit of `resolveBackfillRetentionSettings`, minus the
 * admin-tunable DB layer which is out of scope for Task #265).
 */
export function getGenreSlugCleanupRetention(): {
  days: number;
  maxRows: number;
} {
  return {
    days: envGenreSlugCleanupRetentionDays(),
    maxRows: envGenreSlugCleanupRetentionMaxRows(),
  };
}

/**
 * Drop GenreSlugCleanupRun rows that fall outside the retention window.
 * Best-effort: any error is logged and swallowed so a transient Mongo
 * blip never poisons the sweep that just finished.
 *
 * Two passes (mirrors `pruneOldBackfillRuns`):
 *   1. Delete rows older than the resolved days threshold.
 *   2. Find the `startedAt` of the Nth-newest row and delete anything
 *      strictly older — caps total row count even if the time bound
 *      alone would let more through (e.g. a burst of manual runs in a
 *      short window).
 */
export async function pruneOldGenreSlugCleanupRuns(): Promise<{
  removed: number;
}> {
  let removed = 0;
  try {
    const { days, maxRows } = getGenreSlugCleanupRetention();
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const byAge = await GenreSlugCleanupRun.deleteMany({
      startedAt: { $lt: cutoff },
    });
    removed += byAge.deletedCount ?? 0;

    const pivotDoc = await GenreSlugCleanupRun.find()
      .sort({ startedAt: -1 })
      .skip(maxRows - 1)
      .limit(1)
      .select({ startedAt: 1 })
      .lean<{ startedAt: Date } | null>();
    if (pivotDoc?.startedAt) {
      const byCount = await GenreSlugCleanupRun.deleteMany({
        startedAt: { $lt: pivotDoc.startedAt },
      });
      removed += byCount.deletedCount ?? 0;
    }
    if (removed > 0) {
      logger.log(
        `🧹 Pruned ${removed} old GenreSlugCleanupRun row(s) (retention: ${days}d / ${maxRows} rows)`,
      );
    }
  } catch (err) {
    logger.warn('⚠️  pruneOldGenreSlugCleanupRuns failed (non-fatal):', err);
  }
  return { removed };
}

/**
 * Weekly cron that re-runs the genre-slug cleanup pass added one-shot in
 * Task #110 (`scripts/cleanup-malformed-genre-slugs.ts`). The schema
 * validator on `Genre.slug` (see `SAFE_GENRE_SLUG_RE` in
 * `shared/mongo-schemas.ts`) blocks new bad writes through the Mongoose
 * layer, but bulk paths or older code paths that hit the raw collection
 * can still introduce malformed slugs. Running the cleanup automatically
 * keeps the data hygienic without anyone remembering to invoke the CLI.
 *
 * Schedule: Sundays 05:00 Europe/Berlin — after the nightly logo
 *   processor (02:00), the nightly junk cleanup (03:30), and the weekly
 *   logo+tag backfill (Sun 04:00) so the genre rows reflect what the
 *   other jobs just produced.
 *
 * Distributed-safety: in split deployments, set
 *   `ENABLE_GENRE_SLUG_CLEANUP_CRON=false` on every replica EXCEPT one.
 *   Default is `true` (single-replica deployments work out of the box).
 *
 * Single-instance lock: a second tick that arrives while the previous
 *   run is still in flight is silently skipped — `runGenreSlugCleanup`
 *   walks the whole Genre collection and a second concurrent cursor
 *   would double the read pressure.
 *
 * Audit trail: every run persists a `GenreSlugCleanupRun` row with the
 *   scanned/normalized/demoted counts and whether the downstream re-warm
 *   fired, so admins can see what happened without grepping logs.
 *
 * Downstream re-warm: only fires when the scan actually changed
 *   something (normalized > 0 or markedUndiscoverable > 0). A no-op
 *   weekly tick is cheap.
 */
class ScheduledGenreSlugCleanup {
  private static instance: ScheduledGenreSlugCleanup;
  private isInitialized = false;
  private isRunning = false;
  private lastRunAt: Date | null = null;
  private lastRunId: string | null = null;

  static getInstance(): ScheduledGenreSlugCleanup {
    if (!ScheduledGenreSlugCleanup.instance) {
      ScheduledGenreSlugCleanup.instance = new ScheduledGenreSlugCleanup();
    }
    return ScheduledGenreSlugCleanup.instance;
  }

  initialize(): void {
    if (this.isInitialized) {
      logger.log('🧹 Scheduled genre-slug cleanup already initialized');
      return;
    }

    if (process.env.ENABLE_GENRE_SLUG_CLEANUP_CRON === 'false') {
      this.isInitialized = true;
      logger.log(
        '🧹 Scheduled genre-slug cleanup DISABLED (ENABLE_GENRE_SLUG_CLEANUP_CRON=false)',
      );
      return;
    }

    this.isInitialized = true;

    // Sundays 05:00 Europe/Berlin — sits after the weekly backfill at 04:00
    // so any genre slugs created by that pass get scrubbed in the same
    // weekend window.
    cron.schedule(
      '0 5 * * 0',
      () => {
        this.runOnce('cron:weekly').catch((err) => {
          logger.error('❌ Weekly genre-slug cleanup crashed:', err);
        });
      },
      { timezone: 'Europe/Berlin' },
    );

    logger.log(
      '🧹 Scheduled genre-slug cleanup initialized (Sun 05:00 Europe/Berlin)',
    );
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      lastRunAt: this.lastRunAt,
      lastRunId: this.lastRunId,
    };
  }

  /**
   * Runs one full sweep. Returns silently with `null` if a run is already
   * in progress (single-instance lock). Persists a `GenreSlugCleanupRun`
   * audit row regardless of success/failure so admins always see the
   * attempt.
   */
  async runOnce(trigger: string = 'manual'): Promise<IGenreSlugCleanupRun | null> {
    if (this.isRunning) {
      logger.log(
        `⏭️  Genre-slug cleanup: skip (${trigger}) — previous run still in progress`,
      );
      return null;
    }
    this.isRunning = true;
    const startedAt = new Date();
    // `run` is created inside the try block so that a failed audit-row
    // insert (transient DB / write error) still hits the `finally` that
    // clears `isRunning` — otherwise the singleton lock would wedge and
    // every future weekly tick would silently skip with "previous run
    // still in progress", permanently disabling the cron.
    let run: IGenreSlugCleanupRun | null = null;

    logger.log(`🧹 Genre-slug cleanup START (${trigger})`);

    try {
      try {
        run = await GenreSlugCleanupRun.create({
          trigger,
          status: 'running',
          startedAt,
          scanned: 0,
          alreadyValid: 0,
          normalized: 0,
          markedUndiscoverable: 0,
          emptySlugMarked: 0,
          collisionMarked: 0,
          errorCount: 0,
          rewarmed: false,
        });
        this.lastRunId = String(run._id);
      } catch (err) {
        // Audit-row insert failures must not wedge the lock. Log and
        // proceed with the cleanup itself — losing a single audit row
        // is far less bad than disabling the weekly cron entirely.
        logger.error(
          '⚠️  Could not persist GenreSlugCleanupRun audit row, running cleanup without it:',
          err,
        );
      }

      // The app server has already opened a mongoose connection; reuse it
      // (mirrors the pattern in scheduled-junk-cleanup.ts).
      const stats: GenreSlugCleanupStats = await runGenreSlugCleanup({
        manageConnection: false,
        log: (m) => logger.log(m),
      });

      const finishedAt = new Date();
      const rewarmed = stats.normalized > 0 || stats.markedUndiscoverable > 0;
      if (run) {
        run.status = 'completed';
        run.finishedAt = finishedAt;
        run.durationMs = finishedAt.getTime() - startedAt.getTime();
        run.scanned = stats.scanned;
        run.alreadyValid = stats.alreadyValid;
        run.normalized = stats.normalized;
        run.markedUndiscoverable = stats.markedUndiscoverable;
        run.emptySlugMarked = stats.emptySlugMarked;
        run.collisionMarked = stats.collisionMarked;
        run.errorCount = stats.errors;
        run.rewarmed = rewarmed;
        try {
          await run.save();
        } catch (err) {
          logger.error('⚠️  Could not save GenreSlugCleanupRun completion row:', err);
        }
      }
      this.lastRunAt = finishedAt;

      const seconds = Math.round(finishedAt.getTime() - startedAt.getTime()) / 1000;
      logger.log(
        `🧹 Genre-slug cleanup DONE in ${Math.round(seconds)}s — ` +
          `scanned=${stats.scanned} normalized=${stats.normalized} ` +
          `demoted=${stats.markedUndiscoverable} rewarmed=${rewarmed}`,
      );
      // Notifier swallows its own errors and bounds webhook latency
      // internally so a flaky alert channel can never poison the
      // cron. Quiet runs (changed rows below threshold) stay silent.
      await notifyGenreSlugCleanupResult(run);
      return run;
    } catch (err: unknown) {
      const finishedAt = new Date();
      this.lastRunAt = finishedAt;
      logger.error('❌ Scheduled genre-slug cleanup failed:', err);
      if (run) {
        run.status = 'failed';
        run.finishedAt = finishedAt;
        run.durationMs = finishedAt.getTime() - startedAt.getTime();
        run.errorMessage = err instanceof Error ? err.message : String(err);
        try {
          await run.save();
        } catch (saveErr) {
          logger.error('⚠️  Could not save GenreSlugCleanupRun failure row:', saveErr);
        }
      }
      // Failed runs always alert (regardless of threshold) so on-call
      // sees the cron broke.
      await notifyGenreSlugCleanupResult(run);
      return run;
    } finally {
      this.isRunning = false;
      // Apply retention after every sweep so the GenreSlugCleanupRun
      // collection never grows unbounded. Best-effort — see
      // `pruneOldGenreSlugCleanupRuns`.
      await pruneOldGenreSlugCleanupRuns();
    }
  }
}

export const scheduledGenreSlugCleanup = ScheduledGenreSlugCleanup.getInstance();
