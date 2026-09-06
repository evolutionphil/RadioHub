import { pgTaxonomyRuntime } from '../data/postgres-taxonomy-runtime-store';
import { logger } from '../utils/logger';

interface RecomputeStatus {
  lastRecomputedAt: Date | null; lastDurationMs: number | null; lastUpdatedSlugs: number;
  lastTotalGenres: number; inFlight: boolean; lastTrigger: string | null;
}
const status: RecomputeStatus = {
  lastRecomputedAt:null,lastDurationMs:null,lastUpdatedSlugs:0,lastTotalGenres:0,inFlight:false,lastTrigger:null,
};
let pendingPromise: Promise<void> | null = null;
export function getGenreStationCountsStatus(): RecomputeStatus { return {...status}; }
export const GENRE_STATION_COUNTS_RETENTION_MAX_ROWS_DEFAULT = 200;
export const GENRE_STATION_COUNTS_RETENTION_MAX_ROWS_MIN = 10;
export const GENRE_STATION_COUNTS_RETENTION_MAX_ROWS_MAX = 100_000;
export function getGenreStationCountsRetentionMaxRows(): number {
  const raw = Number.parseInt(process.env.GENRE_STATION_COUNTS_RETENTION_MAX_ROWS ?? '',10);
  return Number.isFinite(raw) && raw>=GENRE_STATION_COUNTS_RETENTION_MAX_ROWS_MIN
    ? Math.min(raw,GENRE_STATION_COUNTS_RETENTION_MAX_ROWS_MAX) : GENRE_STATION_COUNTS_RETENTION_MAX_ROWS_DEFAULT;
}

export function recomputeGenreStationCounts(trigger: string): Promise<void> {
  if(pendingPromise) return pendingPromise;
  status.inFlight=true; status.lastTrigger=trigger;
  pendingPromise=(async()=>{
    try {
      const result = await pgTaxonomyRuntime().recomputeGenreCounts(trigger,getGenreStationCountsRetentionMaxRows());
      status.lastUpdatedSlugs=result.updatedSlugs; status.lastTotalGenres=result.totalGenres;
      status.lastRecomputedAt=result.finishedAt; status.lastDurationMs=result.durationMs;
      logger.log(`Genre counts recomputed (${trigger}): ${result.updatedSlugs}/${result.totalGenres} updated`);
    } catch(error) { logger.error(`Genre count recompute failed (${trigger})`,error); throw error; }
    finally { status.inFlight=false; pendingPromise=null; }
  })();
  return pendingPromise;
}

/** Background callers do not await, but errors remain visible and the audit marks failure. */
export function triggerGenreStationCountsRecompute(trigger: string): void {
  void recomputeGenreStationCounts(trigger).catch(error=>logger.error('Background genre count recompute failed',error));
}
