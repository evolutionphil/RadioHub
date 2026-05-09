import cron from 'node-cron';
import { logger } from '../utils/logger';
import { SyncService } from './sync';
import { buildAllSitemapManifests } from '../seo/sitemap-manifest-builder';
import { invalidateQualifiedLanguages } from '../seo/qualified-languages';
import CacheManager from '../cache';
import { performanceCache } from '../performance-cache';
import { IndexNowService } from './indexnow';

/**
 * Nightly Station Sync (added 2026-05-09)
 * ----------------------------------------
 * Every night at 03:00 Europe/Berlin we run an incremental sync against
 * Radio-Browser. This serves two purposes:
 *
 *   1. Catalog freshness — pulls in any new/changed stations the upstream
 *      catalog has registered in the last 24h (votes, clickCount, url,
 *      bitrate, lastCheckOk, etc.).
 *   2. SEO freshness (the user's actual ask 2026-05-09) — `SyncService`'s
 *      `getWhitelistedUpdateFields` already sets `update.updatedAt = new
 *      Date()` on every touched station, so each sync run naturally bumps
 *      the per-station timestamp. Combined with `timestamps: true` on the
 *      schema, the sitemap manifests' `chunks[].maxUpdatedAt` will move
 *      forward at least once per day → `<lastmod>` in
 *      `/sitemap-stations-{lang}-{n}.xml` stays current → Google keeps
 *      re-crawling instead of marking URLs as stale.
 *
 * After the sync we force a manifest rebuild so the new updatedAt values
 * propagate immediately, purge sitemap cache entries (so the next request
 * regenerates XML from fresh Mongo data), and fire IndexNow pings to push
 * Bing/Yandex toward a recrawl.
 *
 * Single-process gate via `ENABLE_NIGHTLY_SYNC_CRON=false` so secondary
 * replicas don't double-run the heavy fetch.
 *
 * Manual trigger lives at `POST /api/admin/sitemap/touch-stations`
 * (one-shot, no Radio-Browser fetch — just bumps every updatedAt to NOW).
 * The nightly cron is the slower, "real data" version.
 */
class ScheduledStationSync {
  private isInitialized = false;
  private isRunning = false;
  private lastRunAt: Date | null = null;
  private lastResult: {
    success: boolean;
    durationMs: number;
    message: string;
  } | null = null;

  initialize(): void {
    if (this.isInitialized) {
      logger.log('🌙 Nightly station sync already initialized');
      return;
    }
    if (process.env.ENABLE_NIGHTLY_SYNC_CRON === 'false') {
      this.isInitialized = true;
      logger.log('🌙 Nightly station sync DISABLED (ENABLE_NIGHTLY_SYNC_CRON=false)');
      return;
    }
    this.isInitialized = true;

    // 03:00 Europe/Berlin every day. Picked so it lands BEFORE the weekly
    // logo+tag backfill (Sun 04:00) and AFTER the nightly junk cleanup
    // (03:30 in scheduled-junk-cleanup.ts) on most days, while staying in
    // a low-traffic window for European users (~02:00 UTC summer).
    cron.schedule(
      '0 3 * * *',
      () => {
        this.runOnce('cron:nightly').catch((err) => {
          logger.error('❌ Nightly station sync cron crashed:', err);
        });
      },
      { timezone: 'Europe/Berlin' },
    );
    logger.log('🌙 Nightly station sync initialized (daily 03:00 Europe/Berlin)');
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      lastRunAt: this.lastRunAt,
      lastResult: this.lastResult,
    };
  }

  async runOnce(trigger: string = 'manual'): Promise<{ success: boolean; message: string }> {
    if (this.isRunning) {
      logger.log(`⏭️  Nightly station sync: skip (${trigger}) — previous run still in progress`);
      return { success: false, message: 'already_running' };
    }
    this.isRunning = true;
    const t0 = Date.now();
    try {
      logger.log(`🌙 Nightly station sync START (${trigger})`);
      const sync = new SyncService();
      const syncResult = await sync.startSync();
      logger.log(`🌙 Nightly station sync: SyncService finished — ${syncResult.message}`);

      // Refresh the SEO surface so the new updatedAt values flow into the
      // served sitemap immediately rather than waiting for the next 6h
      // build tick.
      try {
        performanceCache.clearTranslations();
        performanceCache.clearUrlTranslations();
        performanceCache.clearCountryLanguageMappings();
        await invalidateQualifiedLanguages({ resetLkg: false });
        const buildRes = await buildAllSitemapManifests({ force: true });
        await CacheManager.clearByPattern('sitemap:');
        await CacheManager.clearByPattern('precomputed_');
        logger.log(
          `🌙 Nightly station sync: rebuilt sitemap (built=${buildRes.built}, langs=${buildRes.qualifiedLanguages.length}, retiredZombies=${buildRes.retiredZombies ?? 0})`,
        );
      } catch (err: any) {
        logger.error('🌙 Nightly station sync: sitemap rebuild failed:', err?.message ?? err);
      }

      // Push freshness signal to IndexNow (Bing / Yandex / Seznam).
      try {
        await IndexNowService.submitSitemaps(undefined, 'nightly-station-sync');
      } catch (err: any) {
        logger.error('🌙 Nightly station sync: IndexNow ping failed:', err?.message ?? err);
      }

      const durationMs = Date.now() - t0;
      this.lastRunAt = new Date();
      this.lastResult = {
        success: syncResult.success,
        durationMs,
        message: syncResult.message,
      };
      logger.log(`🌙 Nightly station sync DONE in ${(durationMs / 1000).toFixed(1)}s`);
      return syncResult;
    } catch (err: any) {
      const durationMs = Date.now() - t0;
      this.lastRunAt = new Date();
      this.lastResult = {
        success: false,
        durationMs,
        message: err?.message ?? 'unknown_error',
      };
      logger.error('🌙 Nightly station sync FAILED:', err);
      return { success: false, message: err?.message ?? 'sync_failed' };
    } finally {
      this.isRunning = false;
    }
  }
}

export const scheduledStationSync = new ScheduledStationSync();
