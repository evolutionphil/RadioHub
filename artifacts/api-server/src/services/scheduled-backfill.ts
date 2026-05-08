import cron from 'node-cron';
import { Station, BackfillRun, type IBackfillRun } from '../shared/mongo-schemas';
import { SyncService } from './sync';
import { logger } from '../utils/logger';
import { notifyBackfillResult } from './backfill-notifier';

/**
 * Weekly cross-country backfill that mirrors the per-country
 * `backfill-tr-logos.ts` / `backfill-tr-tags.ts` scripts (Task #50) but
 * picks the top-N worst countries automatically and persists a summary
 * row per run, so admins don't have to re-run the scripts by hand every
 * time Search Console flags a market.
 *
 * - Logo enqueue: same `$or` filter as `scheduled-logo-processor.runOnce`
 *   and `backfill-tr-logos.ts` (`http_error` / `invalid_format` are
 *   excluded — those are dead source URLs and re-enqueueing them just
 *   churns).
 * - Tag hydration: delegates to
 *   `SyncService.hydrateMissingTagsInBackground({ countryCode })` so the
 *   call pattern, retry posture, and 30-day `tagsCheckedAt` cooldown
 *   stay byte-identical to the manual script.
 *
 * The manual scripts continue to work as one-shot escape hatches and now
 * delegate to the same helpers exposed here.
 */
export const STALE_PROCESSING_MS = 60 * 60 * 1000; // 1h: matches cron
export const TAGS_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000; // 30d: matches sync

export function buildLogoBackfillFilter(
  countryCode?: string,
): Record<string, unknown> {
  const stalePivot = new Date(Date.now() - STALE_PROCESSING_MS);
  const filter: Record<string, unknown> = {
    favicon: { $exists: true, $nin: ['', null, 'null'] },
    slug: { $exists: true, $ne: null },
    $or: [
      { logoAssets: { $exists: false } },
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
  if (countryCode) {
    filter.countryCode = countryCode.toUpperCase();
  }
  return filter;
}

export function buildTagsBackfillFilter(
  countryCode?: string,
): Record<string, unknown> {
  const cooldownCutoff = new Date(Date.now() - TAGS_COOLDOWN_MS);
  const filter: Record<string, unknown> = {
    stationuuid: { $exists: true, $nin: [null, ''] },
    $or: [
      { tags: { $exists: false } },
      { tags: null },
      { tags: '' },
    ],
    $and: [
      {
        $or: [
          { tagsCheckedAt: { $exists: false } },
          { tagsCheckedAt: null },
          { tagsCheckedAt: { $lt: cooldownCutoff } },
        ],
      },
    ],
  };
  if (countryCode) {
    filter.countryCode = countryCode.toUpperCase();
  }
  return filter;
}

/**
 * Enqueue every station in `countryCode` (or globally, if undefined) that
 * matches the logo-backfill filter back into the
 * scheduled-logo-processor pipeline by `$unset`-ing `logoAssets`.
 *
 * Idempotent: completed/permanent-failed rows are excluded by the filter
 * so re-running is a no-op.
 */
export async function enqueueLogosForCountry(
  countryCode: string,
): Promise<{ candidates: number; enqueued: number }> {
  const filter = buildLogoBackfillFilter(countryCode);
  const candidates = await Station.countDocuments(filter);
  if (candidates === 0) return { candidates: 0, enqueued: 0 };
  const result = await Station.updateMany(filter, { $unset: { logoAssets: '' } });
  return { candidates, enqueued: result.modifiedCount ?? 0 };
}

interface CountryCount {
  countryCode: string;
  count: number;
}

async function topCountriesByFilter(
  filter: Record<string, unknown>,
  topN: number,
): Promise<CountryCount[]> {
  const rows = await Station.aggregate<{ _id: string | null; count: number }>([
    { $match: filter },
    { $group: { _id: '$countryCode', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: topN * 2 + 5 }, // over-fetch so we can drop blanks
  ]);
  return rows
    .filter((r) => r._id && typeof r._id === 'string' && r._id.trim().length === 2)
    .slice(0, topN)
    .map((r) => ({ countryCode: r._id as string, count: r.count }));
}

class ScheduledBackfillService {
  private static instance: ScheduledBackfillService;
  private isInitialized = false;
  private isRunning = false;
  private lastRunAt: Date | null = null;
  private lastRunId: string | null = null;

  // Tunables — kept conservative so the weekly job can run alongside live
  // traffic and the nightly logo cron without trampling either.
  private readonly TOP_N = 5;
  private readonly TAGS_LIMIT_PER_COUNTRY = 2000;

  static getInstance(): ScheduledBackfillService {
    if (!ScheduledBackfillService.instance) {
      ScheduledBackfillService.instance = new ScheduledBackfillService();
    }
    return ScheduledBackfillService.instance;
  }

  initialize(): void {
    if (this.isInitialized) {
      logger.log('🗓️  Scheduled backfill already initialized');
      return;
    }

    // Same single-process gate as the logo cron (see
    // scheduled-logo-processor.ts) — set ENABLE_BACKFILL_CRON=false on
    // replicas that shouldn't run it.
    if (process.env.ENABLE_BACKFILL_CRON === 'false') {
      this.isInitialized = true;
      logger.log('🗓️  Scheduled backfill DISABLED (ENABLE_BACKFILL_CRON=false)');
      return;
    }

    this.isInitialized = true;

    // Sundays 04:00 Europe/Berlin — after the nightly logo processor
    // (02:00) and junk cleanup (03:30) have settled, so the candidate
    // counts reflect what actually drained that week.
    cron.schedule(
      '0 4 * * 0',
      () => {
        this.runOnce('cron:weekly').catch((err) => {
          logger.error('❌ Weekly backfill cron crashed:', err);
        });
      },
      { timezone: 'Europe/Berlin' },
    );

    logger.log('🗓️  Scheduled backfill initialized (Sun 04:00 Europe/Berlin, top-5 countries)');
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      lastRunAt: this.lastRunAt,
      lastRunId: this.lastRunId,
    };
  }

  /**
   * Runs one full sweep: pick the top-N worst countries by logo-missing
   * and tags-missing counts, enqueue logos for each and hydrate tags for
   * each, then persist a summary row. Single-instance lock — concurrent
   * calls return silently.
   *
   * Awaits the entire sweep before returning. Used by the weekly cron.
   * For interactive triggers (admin button) prefer `start()` which
   * persists the BackfillRun row immediately and runs the work in the
   * background so the HTTP response doesn't block on a multi-minute job.
   */
  async runOnce(
    trigger: string = 'manual',
    options: { countryCode?: string } = {},
  ): Promise<IBackfillRun | null> {
    const run = await this.start(trigger, options);
    if (!run) return null;
    // Wait for the in-flight sweep to drain so callers (like the cron)
    // can log a single completion line. `start()` already kicked off the
    // background work, so we just poll the lock.
    while (this.isRunning) {
      await new Promise((r) => setTimeout(r, 250));
    }
    // Re-read so we get the final status / counts the worker persisted.
    return BackfillRun.findById(run._id);
  }

  /**
   * Persist a `running` BackfillRun row, kick off the sweep in the
   * background, and return the row immediately. Honours the same
   * single-instance lock as `runOnce` — returns null if a sweep is
   * already in progress.
   */
  async start(
    trigger: string = 'manual',
    options: { countryCode?: string } = {},
  ): Promise<IBackfillRun | null> {
    if (this.isRunning) {
      logger.log(`⏭️  Scheduled backfill: skip (${trigger}) — previous run still in progress`);
      return null;
    }
    this.isRunning = true;
    const startedAt = new Date();

    const overrideCountry = options.countryCode
      ? options.countryCode.trim().toUpperCase()
      : undefined;
    // Single-country override still records `topN` for schema parity, but
    // the sweep itself only touches one market — see `executeSweep`.
    const effectiveTopN = overrideCountry ? 1 : this.TOP_N;

    const run = await BackfillRun.create({
      trigger,
      status: 'running',
      topN: effectiveTopN,
      overrideCountry,
      startedAt,
      logos: [],
      tags: [],
    });
    this.lastRunId = String(run._id);

    logger.log(
      overrideCountry
        ? `🗓️  Scheduled backfill START (${trigger}, country=${overrideCountry})`
        : `🗓️  Scheduled backfill START (${trigger}, top-${this.TOP_N})`,
    );

    // Fire-and-forget the actual sweep so callers get the row back
    // immediately. The lock is released inside the worker's finally.
    this.executeSweep(run, startedAt, overrideCountry).catch((err) => {
      logger.error('❌ Scheduled backfill worker crashed:', err);
    });
    return run;
  }

  /**
   * Convenience wrapper for triggering a single-country sweep.
   * Reuses `enqueueLogosForCountry` + `SyncService.hydrateMissingTagsInBackground`
   * via the same `start()` path the cron uses, so behaviour stays consistent.
   */
  async runForCountry(
    countryCode: string,
    trigger: string = 'manual',
  ): Promise<IBackfillRun | null> {
    return this.start(trigger, { countryCode });
  }

  private async executeSweep(
    run: IBackfillRun,
    startedAt: Date,
    overrideCountry?: string,
  ): Promise<void> {
    try {
      // When admins target a specific country we skip the top-N
      // aggregation entirely and just run logos + tags for that one
      // market. Otherwise pick the worst offenders as usual.
      const [topLogos, topTags] = overrideCountry
        ? [
            [{ countryCode: overrideCountry, count: 0 }],
            [{ countryCode: overrideCountry, count: 0 }],
          ]
        : await Promise.all([
            topCountriesByFilter(buildLogoBackfillFilter(), this.TOP_N),
            topCountriesByFilter(buildTagsBackfillFilter(), this.TOP_N),
          ]);

      logger.log(
        `🗓️  Top logo offenders: ${topLogos.map((c) => `${c.countryCode}(${c.count})`).join(', ') || 'none'}`,
      );
      logger.log(
        `🗓️  Top tag offenders:  ${topTags.map((c) => `${c.countryCode}(${c.count})`).join(', ') || 'none'}`,
      );

      const sync = new SyncService();

      for (const c of topLogos) {
        try {
          const r = await enqueueLogosForCountry(c.countryCode);
          run.logos.push({ countryCode: c.countryCode, candidates: r.candidates, enqueued: r.enqueued });
          logger.log(`📥 ${c.countryCode}: enqueued ${r.enqueued}/${r.candidates} logos`);
        } catch (err) {
          logger.error(`❌ Logo enqueue failed for ${c.countryCode}:`, err);
          run.logos.push({ countryCode: c.countryCode, candidates: c.count, enqueued: 0 });
        }
      }

      for (const c of topTags) {
        try {
          const r = await sync.hydrateMissingTagsInBackground({
            countryCode: c.countryCode,
            limit: this.TAGS_LIMIT_PER_COUNTRY,
          });
          run.tags.push({
            countryCode: c.countryCode,
            processed: r.processed,
            hydrated: r.hydrated,
            emptyUpstream: r.emptyUpstream,
            failed: r.failed,
          });
          logger.log(
            `🏷️  ${c.countryCode}: tags processed=${r.processed} hydrated=${r.hydrated} empty=${r.emptyUpstream} failed=${r.failed}`,
          );
        } catch (err) {
          logger.error(`❌ Tag hydration failed for ${c.countryCode}:`, err);
          run.tags.push({
            countryCode: c.countryCode,
            processed: 0,
            hydrated: 0,
            emptyUpstream: 0,
            failed: 0,
          });
        }
      }

      const finishedAt = new Date();
      run.status = 'completed';
      run.finishedAt = finishedAt;
      run.durationMs = finishedAt.getTime() - startedAt.getTime();
      await run.save();
      this.lastRunAt = finishedAt;
      logger.log(
        `🗓️  Scheduled backfill DONE in ${Math.round(run.durationMs / 1000)}s — ${run.logos.length} logo countries, ${run.tags.length} tag countries`,
      );
    } catch (err: unknown) {
      const finishedAt = new Date();
      run.status = 'failed';
      run.finishedAt = finishedAt;
      run.durationMs = finishedAt.getTime() - startedAt.getTime();
      run.errorMessage = err instanceof Error ? err.message : String(err);
      await run.save();
      this.lastRunAt = finishedAt;
      logger.error('❌ Scheduled backfill failed:', err);
      // Notifier swallows its own errors (and bounds webhook latency
      // internally) so a flaky alert channel can never poison the
      // background worker.
      await notifyBackfillResult(run);
    } finally {
      this.isRunning = false;
    }
  }
}

export const scheduledBackfill = ScheduledBackfillService.getInstance();
