/**
 * Task #355 — Weekly digest of stuck + auto-resubmitted URLs.
 *
 * Background:
 *   The Task #266 auto-resubmit cron silently re-pings IndexNow + rebuilds
 *   the sitemap for URLs Google has been refusing to index. Without a
 *   digest, the only way to notice trends is to open the GSC dashboard
 *   manually. This scheduler compiles the week's stuck/resubmit numbers
 *   from `GscUrlInspection` and emails the admin distribution list a
 *   summary, with deep-links into the dashboard pre-filtered by the
 *   relevant state/group so admins can drill in with one click.
 *
 * Cron schedule: Mondays at 06:30 Europe/Berlin.
 *   - After the daily resubmit cron (04:30) and the daily snapshot cron
 *     (23:55 the day before), so the figures are fully settled.
 *   - The mapping-audit digest already fires at 06:00, so we deliberately
 *     stagger to keep email-arrival batched but distinct.
 *
 * Skip conditions (matches the other digests' "no noise" contract):
 *   - `ENABLE_STUCK_RESUBMIT_DIGEST_CRON=false` env var disables the cron.
 *   - `ADMIN_AUDIT_EMAIL_RECIPIENTS` empty or `SENDGRID_API_KEY` missing
 *     skips silently (handled inside the email helper).
 *   - Nothing material to report (0 currently stuck, 0 resubmitted in
 *     window, 0 recoveries) → skip silently with reason `nothing-to-report`.
 *
 * Manual trigger: `POST /api/admin/gsc-inspection/digest` calls
 *   `runOnce('manual:admin-api')` so admins can verify the email channel
 *   without waiting for Monday.
 */

import cron from 'node-cron';
import {
  GscUrlInspection,
  type IGscUrlInspection,
} from '@workspace/db-shared/mongo-schemas';
import { logger } from '../utils/logger';
import {
  emailStuckResubmitDigest,
  type StuckResubmitDigestStats,
  type StuckResubmitGroupRow,
} from './admin-audit-email';

const NON_INDEXED_STATES: IGscUrlInspection['state'][] = [
  'discovered-not-indexed',
  'crawled-not-indexed',
];

const STUCK_DAYS = parseInt(
  process.env.GSC_RESUBMIT_STUCK_DAYS || '14',
  10,
);

const WEEKLY_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
// Recoveries can lag the resubmit by more than the lookback (Google may
// take a few inspection cycles to flip the verdict). Look back further so
// the "moved to indexed" count actually reflects the resubmit cron's
// payoff instead of just whatever happened in the last 7 days.
const RECOVERY_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;

class ScheduledStuckResubmitDigest {
  private static instance: ScheduledStuckResubmitDigest;
  private isInitialized = false;
  private isRunning = false;
  private lastRunAt: Date | null = null;
  private lastResult: {
    skipped: boolean;
    reason?: string;
    stats?: StuckResubmitDigestStats;
    error?: string;
  } | null = null;

  static getInstance(): ScheduledStuckResubmitDigest {
    if (!ScheduledStuckResubmitDigest.instance) {
      ScheduledStuckResubmitDigest.instance =
        new ScheduledStuckResubmitDigest();
    }
    return ScheduledStuckResubmitDigest.instance;
  }

  initialize(): void {
    if (this.isInitialized) return;
    if (process.env.ENABLE_STUCK_RESUBMIT_DIGEST_CRON === 'false') {
      this.isInitialized = true;
      logger.log(
        '📬 Scheduled stuck/resubmit digest DISABLED (ENABLE_STUCK_RESUBMIT_DIGEST_CRON=false)',
      );
      return;
    }
    this.isInitialized = true;

    // Monday 06:30 Europe/Berlin.
    cron.schedule(
      '30 6 * * 1',
      () => {
        this.runOnce('cron:weekly').catch((err) => {
          logger.error('❌ Scheduled stuck/resubmit digest crashed:', err);
        });
      },
      { timezone: 'Europe/Berlin' },
    );
    logger.log(
      '📬 Scheduled stuck/resubmit digest initialized (Mon 06:30 Europe/Berlin)',
    );
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      lastRunAt: this.lastRunAt,
      lastResult: this.lastResult,
    };
  }

  /**
   * Compile the digest stats from the live `GscUrlInspection` collection
   * and email the admin distribution list. Skips silently when there's
   * nothing material to report.
   */
  async runOnce(trigger: string = 'manual'): Promise<{
    skipped: boolean;
    reason?: string;
    stats?: StuckResubmitDigestStats;
  } | null> {
    if (this.isRunning) {
      logger.log(
        `⏭️  stuck/resubmit digest: skip (${trigger}) — previous run in progress`,
      );
      return null;
    }
    this.isRunning = true;
    const windowEnd = new Date();
    const windowStart = new Date(windowEnd.getTime() - WEEKLY_LOOKBACK_MS);
    const recoveryStart = new Date(
      windowEnd.getTime() - RECOVERY_LOOKBACK_MS,
    );
    const stuckCutoff = new Date(
      windowEnd.getTime() - STUCK_DAYS * 24 * 60 * 60 * 1000,
    );

    try {
      logger.log(
        `📬 stuck/resubmit digest START (${trigger}) — window=` +
          `${windowStart.toISOString()}..${windowEnd.toISOString()}`,
      );
      const stats = await collectStats({
        windowStart,
        windowEnd,
        recoveryStart,
        stuckCutoff,
        stuckDays: STUCK_DAYS,
      });

      const material =
        stats.currentlyStuck > 0 ||
        stats.resubmittedInWindow > 0 ||
        stats.recoveredAfterResubmit > 0;
      if (!material) {
        const result = {
          skipped: true,
          reason: 'nothing-to-report',
          stats,
        };
        this.lastResult = result;
        logger.log(
          `📬 stuck/resubmit digest SKIP (${trigger}) — nothing to report`,
        );
        return result;
      }

      const sendResult = await emailStuckResubmitDigest({
        windowStart,
        windowEnd,
        stats,
      });
      const result = { ...sendResult, stats };
      this.lastResult = result;
      logger.log(
        `📬 stuck/resubmit digest DONE — stuck=${stats.currentlyStuck} ` +
          `resubmitted=${stats.resubmittedInWindow} ` +
          `recovered=${stats.recoveredAfterResubmit} ` +
          `skipped=${result.skipped}` +
          `${result.reason ? ` reason=${result.reason}` : ''}`,
      );
      return result;
    } catch (err: any) {
      const errorMsg = err?.message || String(err);
      logger.error('❌ stuck/resubmit digest error:', errorMsg);
      const result = { skipped: true, reason: 'error' as const };
      this.lastResult = { ...result, error: errorMsg };
      return result;
    } finally {
      this.lastRunAt = new Date();
      this.isRunning = false;
    }
  }
}

interface CollectArgs {
  windowStart: Date;
  windowEnd: Date;
  recoveryStart: Date;
  stuckCutoff: Date;
  stuckDays: number;
}

/**
 * Roll up the four headline numbers + the per-group breakdown.
 *
 * Definitions:
 *   - currentlyStuck: rows in a non-indexed bucket whose `notIndexedSince`
 *     is older than the configured stuck threshold.
 *   - resubmittedInWindow: rows whose `lastResubmitAt` falls inside the
 *     7-day digest window — i.e. URLs the cron actually re-pinged.
 *   - recoveredAfterResubmit: rows that have been resubmitted at any
 *     point in the recovery lookback (30d) AND are currently `indexed`
 *     AND were re-inspected after that resubmit — i.e. concrete proof
 *     the resubmit landed.
 *   - newlyStuck: rows that crossed the stuck threshold inside the
 *     digest window (`notIndexedSince` between windowStart-stuckDays and
 *     stuckCutoff). Useful for spotting fresh regressions.
 *   - byGroup: the same numbers split per group (station/genre/country/
 *     static) so the email surfaces which surface area is worst hit.
 */
export async function collectStats(
  args: CollectArgs,
): Promise<StuckResubmitDigestStats> {
  const { windowStart, windowEnd, recoveryStart, stuckCutoff, stuckDays } =
    args;
  const newlyStuckLowerBound = new Date(
    windowStart.getTime() - stuckDays * 24 * 60 * 60 * 1000,
  );

  const [
    currentlyStuckByGroup,
    resubmittedByGroup,
    recoveredByGroup,
    newlyStuckByGroup,
  ] = await Promise.all([
    GscUrlInspection.aggregate<{ _id: string; count: number }>([
      {
        $match: {
          state: { $in: NON_INDEXED_STATES },
          notIndexedSince: { $lte: stuckCutoff },
        },
      },
      { $group: { _id: '$group', count: { $sum: 1 } } },
    ]),
    GscUrlInspection.aggregate<{ _id: string; count: number }>([
      {
        $match: {
          lastResubmitAt: { $gte: windowStart, $lt: windowEnd },
        },
      },
      { $group: { _id: '$group', count: { $sum: 1 } } },
    ]),
    GscUrlInspection.aggregate<{ _id: string; count: number }>([
      {
        $match: {
          state: 'indexed',
          lastResubmitAt: { $gte: recoveryStart, $lt: windowEnd },
          $expr: { $gt: ['$lastInspectedAt', '$lastResubmitAt'] },
        },
      },
      { $group: { _id: '$group', count: { $sum: 1 } } },
    ]),
    GscUrlInspection.aggregate<{ _id: string; count: number }>([
      {
        $match: {
          state: { $in: NON_INDEXED_STATES },
          notIndexedSince: { $gte: newlyStuckLowerBound, $lte: stuckCutoff },
        },
      },
      { $group: { _id: '$group', count: { $sum: 1 } } },
    ]),
  ]);

  const groupKeys = new Set<string>();
  const collect = (rows: { _id: string; count: number }[]) => {
    const map = new Map<string, number>();
    for (const r of rows) {
      const key = r._id ?? 'unknown';
      groupKeys.add(key);
      map.set(key, r.count);
    }
    return map;
  };
  const stuckMap = collect(currentlyStuckByGroup);
  const resubmitMap = collect(resubmittedByGroup);
  const recoveredMap = collect(recoveredByGroup);
  const newlyMap = collect(newlyStuckByGroup);

  const byGroup: StuckResubmitGroupRow[] = [...groupKeys]
    .map((group) => ({
      group,
      currentlyStuck: stuckMap.get(group) ?? 0,
      resubmittedInWindow: resubmitMap.get(group) ?? 0,
      recoveredAfterResubmit: recoveredMap.get(group) ?? 0,
      newlyStuckInWindow: newlyMap.get(group) ?? 0,
    }))
    .sort((a, b) => b.currentlyStuck - a.currentlyStuck);

  const sum = (m: Map<string, number>) =>
    [...m.values()].reduce((acc, v) => acc + v, 0);

  return {
    currentlyStuck: sum(stuckMap),
    resubmittedInWindow: sum(resubmitMap),
    recoveredAfterResubmit: sum(recoveredMap),
    newlyStuckInWindow: sum(newlyMap),
    stuckDays,
    byGroup,
  };
}

export const scheduledStuckResubmitDigest =
  ScheduledStuckResubmitDigest.getInstance();
