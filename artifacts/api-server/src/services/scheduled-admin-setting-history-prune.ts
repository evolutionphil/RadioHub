import cron from 'node-cron';
import {
  AdminSettingHistory,
  ADMIN_SETTING_HISTORY_RETENTION_PER_KEY,
} from '@workspace/db-shared/mongo-schemas';
import { logger } from '../utils/logger';

/**
 * Nightly job that enforces the per-key retention cap on the
 * `AdminSettingHistory` collection (Task #329). The collection is
 * append-only and would otherwise grow without bound — a runaway script
 * hammering `PUT /api/admin/settings/*` could fill the database in a day.
 *
 * Policy: keep the most recent
 * `ADMIN_SETTING_HISTORY_RETENTION_PER_KEY` entries per `key` and delete
 * everything older. This caps usage even under abuse while still letting
 * a quiet setting keep a long audit trail. The cap is well above the
 * admin UI's max page size (100), so the "Recent changes" panel is
 * never affected.
 *
 * Schedule: every night at 04:15 Europe/Berlin (between the coverage
 * snapshot at 04:30 and the junk cleanup at 03:30, so the heavy nightly
 * jobs don't pile up at the same minute).
 *
 * Distributed-safety: in split deployments set
 * `ENABLE_ADMIN_HISTORY_PRUNE_CRON=false` on every replica EXCEPT one.
 * Default is `true` (single-replica deployments work out of the box).
 *
 * Single-instance lock: a second tick that arrives while a previous run
 * is still in flight is silently skipped.
 */
class ScheduledAdminSettingHistoryPrune {
  private static instance: ScheduledAdminSettingHistoryPrune;
  private isInitialized = false;
  private isRunning = false;
  private lastRunAt: Date | null = null;
  private lastRunStats: {
    startedAt: Date;
    finishedAt: Date;
    durationMs: number;
    keysProcessed: number;
    rowsTrimmed: number;
    error?: string;
  } | null = null;

  static getInstance(): ScheduledAdminSettingHistoryPrune {
    if (!ScheduledAdminSettingHistoryPrune.instance) {
      ScheduledAdminSettingHistoryPrune.instance =
        new ScheduledAdminSettingHistoryPrune();
    }
    return ScheduledAdminSettingHistoryPrune.instance;
  }

  initialize(): void {
    if (this.isInitialized) {
      logger.log('🗂️  Scheduled admin-setting-history prune already initialized');
      return;
    }

    if (process.env.ENABLE_ADMIN_HISTORY_PRUNE_CRON === 'false') {
      this.isInitialized = true;
      logger.log(
        '🗂️  Scheduled admin-setting-history prune DISABLED (ENABLE_ADMIN_HISTORY_PRUNE_CRON=false)',
      );
      return;
    }

    this.isInitialized = true;

    cron.schedule(
      '15 4 * * *',
      () => {
        this.runOnce('cron:nightly').catch((err) => {
          logger.error('❌ Nightly admin-setting-history prune crashed:', err);
        });
      },
      { timezone: 'Europe/Berlin' },
    );

    logger.log(
      `🗂️  Scheduled admin-setting-history prune initialized (daily 04:15 Europe/Berlin, keep last ${ADMIN_SETTING_HISTORY_RETENTION_PER_KEY}/key)`,
    );
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      lastRunAt: this.lastRunAt,
      lastRunStats: this.lastRunStats,
    };
  }

  /**
   * Runs one full prune pass. Returns the number of rows deleted, or
   * `null` if a previous run is still in progress (single-instance lock).
   */
  async runOnce(
    trigger: string = 'manual',
  ): Promise<{ keysProcessed: number; rowsTrimmed: number } | null> {
    if (this.isRunning) {
      logger.log(
        `⏭️  Admin-setting-history prune: skip (${trigger}) — previous run still in progress`,
      );
      return null;
    }
    this.isRunning = true;
    const startedAt = new Date();
    let keysProcessed = 0;
    let rowsTrimmed = 0;
    let errorMsg: string | undefined;

    try {
      const keys = (await AdminSettingHistory.distinct('key')) as string[];
      for (const key of keys) {
        keysProcessed += 1;
        // Find the cut-off `changedAt` of the Nth most recent row. Rows
        // strictly older than that timestamp can be deleted in one go.
        const cutoffDoc = await AdminSettingHistory.find({ key })
          .sort({ changedAt: -1, _id: -1 })
          .skip(ADMIN_SETTING_HISTORY_RETENTION_PER_KEY - 1)
          .limit(1)
          .select({ changedAt: 1, _id: 1 })
          .lean();
        if (!cutoffDoc.length) continue; // fewer than N rows for this key
        const cutoff = cutoffDoc[0].changedAt;
        const cutoffId = cutoffDoc[0]._id;
        // Delete anything older than the cutoff timestamp, plus anything
        // sharing the cutoff timestamp but with an older _id (so we don't
        // accidentally keep N+1 when several rows share the same ms).
        const result = await AdminSettingHistory.deleteMany({
          key,
          $or: [
            { changedAt: { $lt: cutoff } },
            { changedAt: cutoff, _id: { $lt: cutoffId } },
          ],
        });
        const trimmed = result.deletedCount ?? 0;
        rowsTrimmed += trimmed;
        if (trimmed > 0) {
          logger.log(
            `🗂️  Admin-setting-history prune: trimmed ${trimmed} row(s) for key="${key}" (kept ${ADMIN_SETTING_HISTORY_RETENTION_PER_KEY})`,
          );
        }
      }
    } catch (err: any) {
      errorMsg = err?.message || String(err);
      logger.error('❌ Admin-setting-history prune error:', errorMsg);
    } finally {
      const finishedAt = new Date();
      this.lastRunAt = finishedAt;
      this.lastRunStats = {
        startedAt,
        finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        keysProcessed,
        rowsTrimmed,
        error: errorMsg,
      };
      this.isRunning = false;
      logger.log(
        `🗂️  Admin-setting-history prune DONE (${trigger}): keysProcessed=${keysProcessed} rowsTrimmed=${rowsTrimmed} in ${
          finishedAt.getTime() - startedAt.getTime()
        }ms${errorMsg ? ` error=${errorMsg}` : ''}`,
      );
    }

    return { keysProcessed, rowsTrimmed };
  }
}

export const scheduledAdminSettingHistoryPrune =
  ScheduledAdminSettingHistoryPrune.getInstance();
