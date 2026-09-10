import { performance } from 'node:perf_hooks';
import { getPostgresPool } from '../postgres-runtime';
import { PostgresDuplicateJobsStore } from '../data/postgres-duplicate-jobs-store';
import CacheManager from '../cache';
import { performanceCache } from '../performance-cache';
import { logger } from '../utils/logger';
import { triggerGenreStationCountsRecompute } from './genre-station-counts';

export const duplicateMergeEnabled = () => process.env.DUPLICATE_MERGE_ENABLED !== 'false'
  && process.env.BACKGROUND_JOBS_ENABLED !== 'false' && process.env.NODE_ENV !== 'development';

export class ScheduledDuplicateMerge {
  private initialized = false;
  private running = false;
  private utilization = performance.eventLoopUtilization();
  initialize(): void {
    if (this.initialized || !duplicateMergeEnabled()) return;
    this.initialized = true;
    const timer = setInterval(() => void this.runOnce(), 15_000);
    timer.unref();
  }
  async runOnce(): Promise<void> {
    if (this.running || !duplicateMergeEnabled()) return;
    const utilization = performance.eventLoopUtilization(this.utilization);
    this.utilization = performance.eventLoopUtilization();
    const pool = getPostgresPool();
    if (pool.waitingCount || utilization.utilization > 0.7) return;
    this.running = true;
    try {
      const result = await new PostgresDuplicateJobsStore(pool).runCycle();
      if (result.deleted) {
        // One bounded invalidation per committed cycle, never per station/language.
        await Promise.all(['popular_stations','stations','community_favorites','station:detail:','similar:'].map(pattern => CacheManager.clearByPattern(pattern)));
        performanceCache.clearSeoAndQuickCaches();
        performanceCache.clearSimilarStationPools();
      }
      if (result.refreshCounts) triggerGenreStationCountsRecompute('durable-duplicate-merge');
    } catch {
      logger.warn('[duplicate-merge] bounded cycle deferred; durable queue retained');
    } finally { this.running = false; }
  }
}
export const scheduledDuplicateMerge = new ScheduledDuplicateMerge();
