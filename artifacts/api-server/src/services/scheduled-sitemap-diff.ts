import cron from 'node-cron';
import { logger } from '../utils/logger';
import { runSitemapDiffSubmission, type SitemapDiffSummary } from './sitemap-diff-indexnow';

/**
 * Task #190 — nightly job that diffs the previous day's
 * `/sitemap-main-{lang}.xml` URL set against today's and pings IndexNow with
 * just the new URLs (per language, batched under the 10k cap).
 *
 * Schedule: every night at 04:45 Europe/Berlin. Sits between the coverage
 *   snapshot at 04:30 and the scheduled-genre-slug-cleanup at 05:00 (Sundays
 *   only) so the heavy nightly jobs don't pile up.
 *
 * Distributed-safety: in split deployments, set
 *   `ENABLE_SITEMAP_DIFF_INDEXNOW_CRON=false` on every replica EXCEPT one.
 *   Default is `true` (single-replica deploys work out of the box).
 */
class ScheduledSitemapDiff {
  private static instance: ScheduledSitemapDiff;
  private isInitialized = false;
  private isRunning = false;
  private lastRunAt: Date | null = null;
  private lastSummary: (SitemapDiffSummary & { error?: string }) | null = null;

  static getInstance(): ScheduledSitemapDiff {
    if (!ScheduledSitemapDiff.instance) {
      ScheduledSitemapDiff.instance = new ScheduledSitemapDiff();
    }
    return ScheduledSitemapDiff.instance;
  }

  initialize(): void {
    if (this.isInitialized) {
      logger.log('🗺️ Scheduled sitemap-diff IndexNow already initialized');
      return;
    }
    if (process.env.ENABLE_SITEMAP_DIFF_INDEXNOW_CRON === 'false') {
      this.isInitialized = true;
      logger.log('🗺️ Scheduled sitemap-diff IndexNow DISABLED (ENABLE_SITEMAP_DIFF_INDEXNOW_CRON=false)');
      return;
    }
    this.isInitialized = true;

    cron.schedule(
      '45 4 * * *',
      () => {
        this.runOnce('cron:nightly').catch((err) => {
          logger.error('❌ Nightly sitemap-diff IndexNow crashed:', err);
        });
      },
      { timezone: 'Europe/Berlin' },
    );
    logger.log('🗺️ Scheduled sitemap-diff IndexNow initialized (daily 04:45 Europe/Berlin)');
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      lastRunAt: this.lastRunAt,
      lastSummary: this.lastSummary,
    };
  }

  async runOnce(trigger: string = 'manual', opts: { runDate?: string } = {}): Promise<SitemapDiffSummary | null> {
    if (this.isRunning) {
      logger.log(`⏭️  sitemap-diff: skip (${trigger}) — previous run still in progress`);
      return null;
    }
    this.isRunning = true;
    let summary: SitemapDiffSummary | null = null;
    let errorMsg: string | undefined;
    try {
      logger.log(`🗺️ sitemap-diff START (${trigger}${opts.runDate ? ` runDate=${opts.runDate}` : ''})`);
      summary = await runSitemapDiffSubmission({ ensureManifestFresh: true, runDate: opts.runDate });
    } catch (err: any) {
      errorMsg = err?.message || String(err);
      logger.error('❌ sitemap-diff error:', errorMsg);
    } finally {
      this.lastRunAt = new Date();
      if (summary) this.lastSummary = { ...summary, error: errorMsg };
      this.isRunning = false;
    }
    return summary;
  }
}

export const scheduledSitemapDiff = ScheduledSitemapDiff.getInstance();
