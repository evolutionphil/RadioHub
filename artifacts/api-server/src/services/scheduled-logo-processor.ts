import cron from 'node-cron';
import { Station } from '@workspace/db-shared/mongo-schemas';
import { logoProcessor } from './logo-processor';
import { logger } from '../utils/logger';

/**
 * Nightly job that scans the database for any station whose logo has not
 * been mirrored to S3 yet and processes it through `logoProcessor.processFromUrl`.
 *
 * Idempotent: skips stations whose logoAssets.status is 'completed', or
 * 'failed' with a permanent failureType (http_error / invalid_format).
 *
 * Schedule: every night at 02:00 Europe/Berlin.
 * Safety: single-instance lock, max-runtime guard, conservative concurrency
 * to coexist with normal API traffic.
 */
class ScheduledLogoProcessor {
  private static instance: ScheduledLogoProcessor;
  private isInitialized = false;
  private isRunning = false;
  private lastRunAt: Date | null = null;
  private lastRunStats: {
    startedAt: Date;
    finishedAt: Date;
    rounds: number;
    processed: number;
    successful: number;
    failed: number;
    durationMs: number;
    timedOut: boolean;
  } | null = null;

  // Tunables — kept conservative so the job can run alongside live traffic.
  private readonly BATCH_FETCH = 100;
  private readonly CONCURRENT = 4;
  private readonly DELAY_BETWEEN_BATCHES_MS = 400;
  private readonly DELAY_BETWEEN_ROUNDS_MS = 800;
  private readonly MAX_RUNTIME_MS = 4 * 60 * 60 * 1000; // 4h hard ceiling
  private readonly STALE_PROCESSING_MS = 60 * 60 * 1000; // 1h: revive crashed in-flight items

  static getInstance(): ScheduledLogoProcessor {
    if (!ScheduledLogoProcessor.instance) {
      ScheduledLogoProcessor.instance = new ScheduledLogoProcessor();
    }
    return ScheduledLogoProcessor.instance;
  }

  initialize(): void {
    if (this.isInitialized) {
      logger.log('🌙 Scheduled logo processor already initialized');
      return;
    }

    // Distributed-safety guard: in split deployments with multiple replicas
    // (api + web + monolith index.ts), the cron must fire from EXACTLY ONE
    // process. Operators set `ENABLE_LOGO_CRON=false` on the replicas that
    // should NOT run it. Default is `true` (backward compatible — single
    // replica deployments work out of the box).
    if (process.env.ENABLE_LOGO_CRON === 'false') {
      this.isInitialized = true;
      logger.log('🌙 Scheduled logo processor DISABLED (ENABLE_LOGO_CRON=false)');
      return;
    }

    this.isInitialized = true;

    // Every night at 02:00 Europe/Berlin
    cron.schedule(
      '0 2 * * *',
      () => {
        this.runOnce('cron:nightly').catch((err) => {
          logger.error('❌ Nightly logo processor crashed:', err);
        });
      },
      { timezone: 'Europe/Berlin' }
    );

    logger.log('🌙 Scheduled logo processor initialized (daily 02:00 Europe/Berlin)');
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      lastRunAt: this.lastRunAt,
      lastRunStats: this.lastRunStats,
    };
  }

  /**
   * Runs one full sweep until the pending queue is empty (or max-runtime hit).
   * Returns silently if a run is already in progress (single-instance lock).
   */
  async runOnce(trigger: string = 'manual'): Promise<void> {
    if (this.isRunning) {
      logger.log(`⏭️  Logo processor: skip (${trigger}) — previous run still in progress`);
      return;
    }
    this.isRunning = true;
    const startedAt = new Date();
    const deadline = startedAt.getTime() + this.MAX_RUNTIME_MS;

    // Skip stations whose logo was already attempted with a permanent failure.
    // 'http_error' (404/403/DNS) and 'invalid_format' (HTML/SVG/etc.) are not
    // worth retrying — the source URL itself is broken.
    //
    // Stale-processing recovery: if a station has been stuck in 'processing'
    // for more than STALE_PROCESSING_MS (a previous run crashed mid-item),
    // pick it up again. Otherwise we'd leak rows forever.
    const stalePivot = new Date(Date.now() - this.STALE_PROCESSING_MS);
    const filter: any = {
      favicon: { $exists: true, $nin: ['', null, 'null'] },
      slug: { $exists: true, $ne: null },
      $or: [
        { 'logoAssets.status': { $exists: false } },
        { 'logoAssets.status': 'pending' },
        {
          'logoAssets.status': 'failed',
          'logoAssets.failureType': { $nin: ['http_error', 'invalid_format'] },
        },
        {
          'logoAssets.status': 'failed',
          'logoAssets.failureType': { $exists: false },
        },
        {
          'logoAssets.status': 'processing',
          $or: [
            { 'logoAssets.lastAttempt': { $lt: stalePivot } },
            { 'logoAssets.lastAttempt': { $exists: false }, 'logoAssets.processedAt': { $lt: stalePivot } },
            { 'logoAssets.lastAttempt': { $exists: false }, 'logoAssets.processedAt': { $exists: false } },
          ],
        },
      ],
    };

    let rounds = 0;
    let processed = 0;
    let successful = 0;
    let failed = 0;
    let timedOut = false;

    try {
      const initialPending = await Station.countDocuments(filter);
      const completed = await Station.countDocuments({ 'logoAssets.status': 'completed' });
      logger.log(
        `🌙 Logo processor START (${trigger}): ${initialPending} pending, ${completed} already in S3`
      );

      if (initialPending === 0) {
        logger.log('🎉 Logo processor: nothing to do');
        return;
      }

      while (true) {
        if (Date.now() > deadline) {
          timedOut = true;
          logger.log(
            `⏰ Logo processor: max runtime (${this.MAX_RUNTIME_MS / 60000}min) reached, stopping`
          );
          break;
        }

        const stations = await Station.find(filter)
          .select('_id name slug favicon')
          .limit(this.BATCH_FETCH)
          .lean();

        if (stations.length === 0) {
          logger.log('🎉 Logo processor: queue drained');
          break;
        }

        rounds++;

        for (let i = 0; i < stations.length; i += this.CONCURRENT) {
          if (Date.now() > deadline) {
            timedOut = true;
            break;
          }
          const batch = stations.slice(i, i + this.CONCURRENT);
          const results = await Promise.allSettled(
            batch.map(async (s: any) => {
              if (!s.favicon || !s.slug) {
                return { success: false, error: 'Missing favicon or slug' };
              }
              return logoProcessor.processFromUrl(s._id.toString(), s.slug, s.favicon);
            })
          );

          for (const r of results) {
            processed++;
            if (r.status === 'fulfilled' && (r.value as any).success) successful++;
            else failed++;
          }

          await sleep(this.DELAY_BETWEEN_BATCHES_MS);
        }

        if (rounds % 5 === 0) {
          const remaining = await Station.countDocuments(filter);
          const heapMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
          logger.log(
            `🌙 Logo processor round ${rounds}: ✅${successful} ❌${failed} | ${remaining} remaining | heap ${heapMB}MB`
          );
          if (typeof global.gc === 'function') global.gc();
        }

        await sleep(this.DELAY_BETWEEN_ROUNDS_MS);
      }
    } catch (err: any) {
      logger.error('❌ Logo processor error:', err?.message || err);
    } finally {
      const finishedAt = new Date();
      this.lastRunAt = finishedAt;
      this.lastRunStats = {
        startedAt,
        finishedAt,
        rounds,
        processed,
        successful,
        failed,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        timedOut,
      };
      this.isRunning = false;
      logger.log(
        `🌙 Logo processor DONE: rounds=${rounds} ✅${successful} ❌${failed} ` +
          `in ${Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000)}s` +
          (timedOut ? ' (TIMED OUT)' : '')
      );
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export const scheduledLogoProcessor = ScheduledLogoProcessor.getInstance();
