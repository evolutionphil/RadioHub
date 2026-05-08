import cron from 'node-cron';
import { Station, CoverageSnapshot } from '../shared/mongo-schemas';
import { logger } from '../utils/logger';
import { checkAndNotifyCoverageDrops } from './coverage-drop-notifier';

/**
 * Nightly job that snapshots per-country logo + tag coverage into the
 * `coveragesnapshots` collection so the admin coverage page can show a
 * 30-day trend (sparkline + delta) instead of just today's point-in-time
 * numbers.
 *
 * Schedule: every night at 04:30 Europe/Berlin — after the nightly logo
 * processor (02:00) and junk cleanup (03:30) and the weekly backfill
 * (Sunday 04:00) so the snapshot reflects a quiet steady state of the day.
 *
 * Distributed-safety: in split deployments, set
 * `ENABLE_COVERAGE_SNAPSHOT_CRON=false` on every replica EXCEPT one.
 *
 * Idempotent: each snapshot is keyed by (countryCode, snapshotDate) and
 * upserted, so a second run on the same UTC day overwrites today's row
 * rather than creating a duplicate.
 */

function todayUtcMidnight(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

interface CountryCoverageRow {
  countryCode: string;
  total: number;
  withLogo: number;
  withTags: number;
}

async function aggregateCurrentCoverage(): Promise<CountryCoverageRow[]> {
  const rows = await Station.aggregate<{
    _id: string;
    total: number;
    withLogo: number;
    withTags: number;
  }>([
    {
      $match: {
        countryCode: { $exists: true, $nin: [null, '', 'null'] },
      },
    },
    {
      $group: {
        _id: { $toUpper: '$countryCode' },
        total: { $sum: 1 },
        withLogo: {
          $sum: {
            $cond: [{ $eq: ['$logoAssets.status', 'completed'] }, 1, 0],
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

class ScheduledCoverageSnapshot {
  private static instance: ScheduledCoverageSnapshot;
  private isInitialized = false;
  private isRunning = false;
  private lastRunAt: Date | null = null;
  private lastSnapshotDate: Date | null = null;
  private lastCountriesWritten = 0;

  static getInstance(): ScheduledCoverageSnapshot {
    if (!ScheduledCoverageSnapshot.instance) {
      ScheduledCoverageSnapshot.instance = new ScheduledCoverageSnapshot();
    }
    return ScheduledCoverageSnapshot.instance;
  }

  initialize(): void {
    if (this.isInitialized) {
      logger.log('📈 Scheduled coverage snapshot already initialized');
      return;
    }

    if (process.env.ENABLE_COVERAGE_SNAPSHOT_CRON === 'false') {
      this.isInitialized = true;
      logger.log(
        '📈 Scheduled coverage snapshot DISABLED (ENABLE_COVERAGE_SNAPSHOT_CRON=false)',
      );
      return;
    }

    this.isInitialized = true;

    // Every night at 04:30 Europe/Berlin
    cron.schedule(
      '30 4 * * *',
      () => {
        this.runOnce('cron:nightly').catch((err) => {
          logger.error('❌ Nightly coverage snapshot crashed:', err);
        });
      },
      { timezone: 'Europe/Berlin' },
    );

    logger.log(
      '📈 Scheduled coverage snapshot initialized (daily 04:30 Europe/Berlin)',
    );
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      lastRunAt: this.lastRunAt,
      lastSnapshotDate: this.lastSnapshotDate,
      lastCountriesWritten: this.lastCountriesWritten,
    };
  }

  /**
   * Snapshots per-country coverage for today's UTC date. Idempotent: the
   * unique (countryCode, snapshotDate) index means re-runs upsert today's
   * row rather than duplicating it.
   */
  async runOnce(
    trigger: string = 'manual',
  ): Promise<{ countries: number; snapshotDate: Date } | null> {
    if (this.isRunning) {
      logger.log(
        `⏭️  Coverage snapshot: skip (${trigger}) — previous run still in progress`,
      );
      return null;
    }
    this.isRunning = true;
    const startedAt = new Date();
    const snapshotDate = todayUtcMidnight();

    try {
      logger.log(`📈 Coverage snapshot START (${trigger}) for ${snapshotDate.toISOString().slice(0, 10)}`);
      const rows = await aggregateCurrentCoverage();
      if (rows.length === 0) {
        logger.warn('📈 Coverage snapshot: no countries returned, skipping write');
        return { countries: 0, snapshotDate };
      }

      const ops = rows.map((row) => {
        const total = row.total;
        const logoCoveragePct =
          total > 0 ? Math.round((row.withLogo / total) * 1000) / 10 : 0;
        const tagCoveragePct =
          total > 0 ? Math.round((row.withTags / total) * 1000) / 10 : 0;
        return {
          updateOne: {
            filter: {
              countryCode: row.countryCode,
              snapshotDate,
            },
            update: {
              $set: {
                total,
                withLogo: row.withLogo,
                withTags: row.withTags,
                logoCoveragePct,
                tagCoveragePct,
                // Re-running the cron on the same UTC day must promote
                // a previously-backfilled row to 'cron' (the live numbers
                // have replaced the reconstruction), so set this on
                // every write, not just on insert.
                source: 'cron' as const,
              },
              $setOnInsert: { createdAt: new Date() },
            },
            upsert: true,
          },
        };
      });

      await CoverageSnapshot.bulkWrite(ops, { ordered: false });
      this.lastRunAt = new Date();
      this.lastSnapshotDate = snapshotDate;
      this.lastCountriesWritten = rows.length;
      const seconds = Math.round((Date.now() - startedAt.getTime()) / 1000);
      logger.log(
        `📈 Coverage snapshot DONE: wrote ${rows.length} countries in ${seconds}s`,
      );
      // Task #145: after each snapshot, compare to 7 days ago and alert
      // the team about any country whose logo/tag coverage dropped
      // beyond the configured threshold. Best-effort: notifier swallows
      // its own errors so a regression here can never block the cron.
      try {
        const result = await checkAndNotifyCoverageDrops(snapshotDate);
        if (result.checked) {
          logger.log(
            `📈 Coverage drop check: ${result.drops.length} drop(s) detected`,
          );
        }
      } catch (err) {
        logger.warn('⚠️  Coverage drop check failed:', err);
      }
      return { countries: rows.length, snapshotDate };
    } catch (err: any) {
      logger.error('❌ Coverage snapshot failed:', err?.message || err);
      throw err;
    } finally {
      this.isRunning = false;
    }
  }
}

export const scheduledCoverageSnapshot = ScheduledCoverageSnapshot.getInstance();
