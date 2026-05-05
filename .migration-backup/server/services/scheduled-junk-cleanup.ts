import cron from 'node-cron';
import path from 'path';
import { logger } from '../utils/logger';
import { runJunkCleanup, type JunkCleanupResult } from '../../scripts/clean-content-quality-urls';

/**
 * Nightly job that re-runs the junk-station / slug cleanup pass over the
 * whole stations collection (the same logic as
 * `scripts/clean-content-quality-urls.ts`, just driven by a cron tick instead
 * of a one-off shell invocation).
 *
 * Schedule: every night at 03:30 Europe/Berlin (offset by 1.5h from the
 *   logo processor at 02:00 so the two heavy nightly jobs don't fight for
 *   DB connections / event-loop time).
 *
 * Distributed-safety: in split deployments, set `ENABLE_JUNK_CLEANUP_CRON=false`
 *   on every replica EXCEPT one. Default is `true` (single-replica deployments
 *   work out of the box).
 *
 * Single-instance lock: a second tick that arrives while the previous run is
 *   still in flight is silently skipped — DB writes from `runJunkCleanup` are
 *   per-station updateOne, but a second concurrent cursor would double the
 *   read pressure and write contention.
 */
class ScheduledJunkCleanup {
  private static instance: ScheduledJunkCleanup;
  private isInitialized = false;
  private isRunning = false;
  private lastRunAt: Date | null = null;
  private lastRunStats: (JunkCleanupResult & {
    startedAt: Date;
    finishedAt: Date;
    durationMs: number;
    error?: string;
  }) | null = null;

  static getInstance(): ScheduledJunkCleanup {
    if (!ScheduledJunkCleanup.instance) {
      ScheduledJunkCleanup.instance = new ScheduledJunkCleanup();
    }
    return ScheduledJunkCleanup.instance;
  }

  initialize(): void {
    if (this.isInitialized) {
      logger.log('🧹 Scheduled junk cleanup already initialized');
      return;
    }

    if (process.env.ENABLE_JUNK_CLEANUP_CRON === 'false') {
      this.isInitialized = true;
      logger.log('🧹 Scheduled junk cleanup DISABLED (ENABLE_JUNK_CLEANUP_CRON=false)');
      return;
    }

    this.isInitialized = true;

    // Every night at 03:30 Europe/Berlin (after the 02:00 logo processor)
    cron.schedule(
      '30 3 * * *',
      () => {
        this.runOnce('cron:nightly').catch((err) => {
          logger.error('❌ Nightly junk cleanup crashed:', err);
        });
      },
      { timezone: 'Europe/Berlin' }
    );

    logger.log('🧹 Scheduled junk cleanup initialized (daily 03:30 Europe/Berlin)');

    // Optional deploy-time pass: when RUN_JUNK_CLEANUP_ON_BOOT=true, run a
    // single sweep ~5 minutes after server start. Off by default so a fresh
    // deploy doesn't immediately trigger a heavy DB sweep on top of cache
    // warming. Operators flip this on for a deploy when they need the fix
    // applied immediately rather than waiting for the next nightly tick.
    if (process.env.RUN_JUNK_CLEANUP_ON_BOOT === 'true') {
      const delayMs = 5 * 60 * 1000;
      logger.log(
        `🧹 Scheduled junk cleanup: deploy-time run queued (RUN_JUNK_CLEANUP_ON_BOOT=true) in ${delayMs / 1000}s`,
      );
      setTimeout(() => {
        this.runOnce('boot:deploy').catch((err) => {
          logger.error('❌ Boot junk cleanup crashed:', err);
        });
      }, delayMs).unref();
    }
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      lastRunAt: this.lastRunAt,
      lastRunStats: this.lastRunStats,
    };
  }

  /**
   * Runs one full sweep. Returns silently if a run is already in progress
   * (single-instance lock).
   *
   * The cleanup script connects/disconnects mongoose itself when invoked from
   * a shell. Here the app server has already opened a connection, so we pass
   * `manageConnection: false` to reuse it.
   */
  async runOnce(trigger: string = 'manual'): Promise<JunkCleanupResult | null> {
    if (this.isRunning) {
      logger.log(`⏭️  Junk cleanup: skip (${trigger}) — previous run still in progress`);
      return null;
    }
    this.isRunning = true;
    const startedAt = new Date();
    let result: JunkCleanupResult | null = null;
    let errorMsg: string | undefined;

    try {
      logger.log(`🧹 Junk cleanup START (${trigger})`);
      // Persist the audit CSV in /tmp inside the container so a tiny disk
      // doesn't fill up over time. Operators can tail this file via
      // `docker exec` / Railway's shell when investigating a particular run.
      const reportPath = path.join('/tmp', `junk-cleanup-${startedAt.toISOString().slice(0, 10)}.csv`);
      result = await runJunkCleanup({
        manageConnection: false,
        reportPath,
        log: (m) => logger.log(m),
      });
    } catch (err: any) {
      errorMsg = err?.message || String(err);
      logger.error('❌ Junk cleanup error:', errorMsg);
    } finally {
      const finishedAt = new Date();
      this.lastRunAt = finishedAt;
      this.lastRunStats = result
        ? {
            ...result,
            startedAt,
            finishedAt,
            durationMs: finishedAt.getTime() - startedAt.getTime(),
            error: errorMsg,
          }
        : {
            processed: 0,
            slugRewrites: 0,
            junkMarked: 0,
            bothChanges: 0,
            auditRows: 0,
            reportPath: '',
            dryRun: false,
            startedAt,
            finishedAt,
            durationMs: finishedAt.getTime() - startedAt.getTime(),
            error: errorMsg,
          };
      this.isRunning = false;
      const seconds = Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000);
      if (result) {
        logger.log(
          `🧹 Junk cleanup DONE: processed=${result.processed} ` +
            `slugRewrites=${result.slugRewrites} junkMarked=${result.junkMarked} ` +
            `in ${seconds}s`
        );
      } else {
        logger.log(`🧹 Junk cleanup ABORTED after ${seconds}s (${errorMsg ?? 'unknown'})`);
      }
    }

    return result;
  }
}

export const scheduledJunkCleanup = ScheduledJunkCleanup.getInstance();
