import cron from 'node-cron';
import { logger } from '../utils/logger';
import {
  recomputeGenreStationCounts,
  getGenreStationCountsStatus,
} from './genre-station-counts';

/**
 * Nightly cron that re-aggregates `Genre.stationCount` from the live
 * Station collection. Task #185 already wires recomputes onto on-demand
 * admin clicks and post-bulk-op finish hooks, but per-station edits,
 * incremental syncs, and blacklist toggles can drift the cached counts
 * over time without ever firing a bulk-op hook. This scheduled run
 * keeps the admin Genre Whitelist page accurate without anyone
 * remembering to click "Refresh station counts now".
 *
 * Schedule: 02:30 Europe/Berlin every day — sits before the weekly
 *   Sunday backfill (04:00) and the genre-slug cleanup (Sun 05:00) so
 *   those jobs see fresh counts, and after the nightly logo processor
 *   (02:00) so any newly-discoverable stations are reflected.
 *
 * Distributed-safety: in split deployments, set
 *   `ENABLE_GENRE_STATION_COUNTS_CRON=false` on every replica EXCEPT
 *   one. Default is `true` (single-replica deployments work out of the
 *   box). Even if two replicas race, `recomputeGenreStationCounts`
 *   already coalesces concurrent in-process calls, and the bulkWrite is
 *   idempotent — worst case is one redundant aggregation.
 *
 * Status surface: this service does not maintain its own status — the
 *   admin coverage page reads `getGenreStationCountsStatus()`, whose
 *   `lastTrigger` field will read `cron:nightly` after a scheduled run
 *   so admins can tell the badge reflects the cron, not a manual click.
 */
class ScheduledGenreStationCounts {
  private static instance: ScheduledGenreStationCounts;
  private isInitialized = false;

  static getInstance(): ScheduledGenreStationCounts {
    if (!ScheduledGenreStationCounts.instance) {
      ScheduledGenreStationCounts.instance = new ScheduledGenreStationCounts();
    }
    return ScheduledGenreStationCounts.instance;
  }

  initialize(): void {
    if (this.isInitialized) {
      logger.log('🔢 Scheduled genre station-counts already initialized');
      return;
    }

    if (process.env.ENABLE_GENRE_STATION_COUNTS_CRON === 'false') {
      this.isInitialized = true;
      logger.log(
        '🔢 Scheduled genre station-counts DISABLED (ENABLE_GENRE_STATION_COUNTS_CRON=false)',
      );
      return;
    }

    this.isInitialized = true;

    cron.schedule(
      '30 2 * * *',
      () => {
        this.runOnce('cron:nightly').catch((err) => {
          logger.error('❌ Nightly genre station-counts recompute crashed:', err);
        });
      },
      { timezone: 'Europe/Berlin' },
    );

    logger.log(
      '🔢 Scheduled genre station-counts initialized (daily 02:30 Europe/Berlin)',
    );
  }

  /**
   * Runs one recompute. Errors inside `recomputeGenreStationCounts` are
   * already swallowed/logged there; this wrapper exists so the cron and
   * any future admin "run nightly job now" trigger share one entry
   * point and audit-friendly trigger label.
   */
  async runOnce(trigger: string = 'cron:nightly'): Promise<void> {
    logger.log(`🔢 Genre station-counts recompute START (${trigger})`);
    await recomputeGenreStationCounts(trigger);
    const status = getGenreStationCountsStatus();
    logger.log(
      `🔢 Genre station-counts recompute DONE (${trigger}) — ` +
        `${status.lastUpdatedSlugs}/${status.lastTotalGenres} updated in ` +
        `${status.lastDurationMs}ms`,
    );
  }
}

export const scheduledGenreStationCounts = ScheduledGenreStationCounts.getInstance();
