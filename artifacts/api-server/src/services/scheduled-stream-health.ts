import cron from 'node-cron';
import { performance } from 'node:perf_hooks';
import { getPostgresPool } from '../postgres-runtime';
import { PostgresStreamHealthStore, type HealthObservation } from '../data/postgres-stream-health-store';
import { probeStreamAvailability } from '../utils/station-stream-probe';
import { logger } from '../utils/logger';

export class ScheduledStreamHealth {
  private running = false;
  private initialized = false;
  private lastUtilization = performance.eventLoopUtilization();

  initialize(): void {
    if (this.initialized || process.env.STREAM_HEALTH_ENABLED === 'false') return;
    this.initialized = true;
    cron.schedule('*/2 * * * *', () => void this.runOnce());
    const startup = setTimeout(() => void this.runOnce(), 60_000);
    startup.unref();
    logger.log('[stream-health] scheduled: max12/2min, concurrency2; no request-time stream probes');
  }

  async runOnce(): Promise<void> {
    if (this.running) return;
    const pool = getPostgresPool();
    const utilization = performance.eventLoopUtilization(this.lastUtilization);
    this.lastUtilization = performance.eventLoopUtilization();
    // Yield work to real users under pool contention or high event-loop load.
    if (pool.waitingCount > 0 || utilization.utilization > 0.7) return;
    this.running = true;
    try {
      const store = new PostgresStreamHealthStore(pool);
      const candidates = await store.claim();
      if (!candidates.length) return;
      const results: Array<{ candidate: typeof candidates[number]; observation: HealthObservation }> = [];
      for (let offset=0; offset<candidates.length; offset+=2) {
        if (pool.waitingCount > 0) break;
        const pair = await Promise.all(candidates.slice(offset,offset+2).map(async candidate => ({
          candidate, observation: await probeStreamAvailability(candidate.url),
        })));
        results.push(...pair);
      }
      const healthy = results.filter(result => result.observation.outcome === 'healthy').length;
      // Uncertain network results are never negative availability evidence.
      // Back off when most of the batch could not be conclusively checked.
      const uncertain = results.filter(result => result.observation.outcome === 'inconclusive').length;
      const pause = results.length >= 6 && uncertain / results.length >= 0.8;
      let changed = 0;
      for (const { candidate, observation } of results) {
        const evidence = pause && observation.outcome === 'failed'
          ? { ...observation, outcome: 'inconclusive' as const, reason: 'batch-outage-circuit' } : observation;
        if (await store.complete(candidate,evidence)) changed++;
      }
      await store.finishBatch({ checked:results.length,healthy,changed,paused:pause },pause);
      if (changed || pause) logger.log(`[stream-health] checked=${results.length} healthy=${healthy} changed=${changed} paused=${pause}`);
    } catch {
      // No URLs, credentials, provider bodies or unbounded error logs.
      logger.warn('[stream-health] bounded cycle deferred; durable queue retained');
    } finally { this.running = false; }
  }
}
export const scheduledStreamHealth = new ScheduledStreamHealth();
