import cron from 'node-cron';
import { pgGenreCleanup,type GenreSlugCleanupRun } from '../data/postgres-genre-cleanup-store';
import { pgCoverage } from '../data/postgres-coverage-store';
import { logger } from '../utils/logger';
import { runGenreSlugCleanup,type GenreSlugCleanupStats } from '../scripts/cleanup-malformed-genre-slugs';
import { notifyGenreSlugCleanupResult } from './genre-slug-cleanup-notifier';

export const GENRE_SLUG_CLEANUP_RETENTION_DAYS_DEFAULT=90;
export const GENRE_SLUG_CLEANUP_RETENTION_MAX_ROWS_DEFAULT=200;
export const GENRE_SLUG_CLEANUP_RETENTION_DAYS_MIN=1;
export const GENRE_SLUG_CLEANUP_RETENTION_DAYS_MAX=3650;
export const GENRE_SLUG_CLEANUP_RETENTION_MAX_ROWS_MIN=10;
export const GENRE_SLUG_CLEANUP_RETENTION_MAX_ROWS_MAX=100_000;
function bound(value:string|undefined,fallback:number,min:number,max:number):number{
  const parsed=Number.parseInt(value??'',10);return Number.isFinite(parsed)&&parsed>=min?Math.min(parsed,max):fallback;
}
export function getGenreSlugCleanupRetention():{days:number;maxRows:number}{
  return {days:bound(process.env.GENRE_SLUG_CLEANUP_RETENTION_DAYS,90,1,3650),maxRows:bound(process.env.GENRE_SLUG_CLEANUP_RETENTION_MAX_ROWS,200,10,100_000)};
}
export async function pruneOldGenreSlugCleanupRuns():Promise<{removed:number}>{
  const {days,maxRows}=getGenreSlugCleanupRetention();return pgGenreCleanup().prune(days,maxRows);
}
type Leader=NonNullable<Awaited<ReturnType<ReturnType<typeof pgCoverage>['acquireJob']>>>;
function applyStats(run:GenreSlugCleanupRun,stats:GenreSlugCleanupStats):void{
  for(const key of ['scanned','alreadyValid','normalized','markedUndiscoverable','emptySlugMarked','collisionMarked'] as const)run[key]=stats[key];
  run.errorCount=stats.errors;
}
class ScheduledGenreSlugCleanup {
  private isInitialized=false;private isRunning=false;private lastRunAt:Date|null=null;private lastRunId:string|null=null;
  initialize():void{
    if(this.isInitialized)return;this.isInitialized=true;
    if(process.env.ENABLE_GENRE_SLUG_CLEANUP_CRON==='false')return;
    cron.schedule('0 5 * * 0',()=>{this.runOnce('cron:weekly').catch(error=>logger.error('Weekly genre cleanup failed:',error));},{timezone:'Europe/Berlin'});
  }
  getStatus(){return {isRunning:this.isRunning,lastRunAt:this.lastRunAt,lastRunId:this.lastRunId};}
  /** Returns only after PostgreSQL leader ownership and the initial audit are durable. */
  async start(trigger='manual'):Promise<{run:GenreSlugCleanupRun;completion:Promise<GenreSlugCleanupRun>}|null>{
    if(this.isRunning)return null;this.isRunning=true;let leader:Leader|null=null;let transferred=false;
    try{
      leader=await pgCoverage().acquireJob('genre-slug-cleanup');if(!leader)return null;
      leader.assertOwned();await pgGenreCleanup().recoverInterruptedRuns();
      const run=await pgGenreCleanup().createRun(trigger);this.lastRunId=run._id;
      transferred=true;const completion=this.execute(run,leader);completion.catch(()=>{});
      return {run,completion};
    }finally{if(!transferred){try{await leader?.release();}finally{this.isRunning=false;}}}
  }
  async runOnce(trigger='manual'):Promise<GenreSlugCleanupRun|null>{const started=await this.start(trigger);return started?started.completion:null;}
  private async execute(run:GenreSlugCleanupRun,leader:Leader):Promise<GenreSlugCleanupRun>{
    try{
      try{
        const stats=await runGenreSlugCleanup({manageConnection:false,dryRun:false,assertOwned:()=>leader.assertOwned(),log:m=>logger.log(m)});
        leader.assertOwned();applyStats(run,stats);run.status='completed';run.rewarmed=stats.normalized>0||stats.markedUndiscoverable>0;
      }catch(error){
        const stats=(error as any)?.cleanupStats;if(stats)applyStats(run,stats);
        run.status='failed';run.errorCount=Math.max(1,run.errorCount);run.errorMessage=error instanceof Error?error.message:String(error);
        logger.error('Genre cleanup failed:',error);
      }
      run.finishedAt=new Date();run.durationMs=run.finishedAt.getTime()-run.startedAt.getTime();
      await pgGenreCleanup().saveRun(run);this.lastRunAt=run.finishedAt;
      await notifyGenreSlugCleanupResult(run);return run;
    }finally{
      try{await pruneOldGenreSlugCleanupRuns();}catch(error){logger.error('Genre cleanup audit retention failed:',error);}
      try{await leader.release();}finally{this.isRunning=false;}
    }
  }
}
export const scheduledGenreSlugCleanup=new ScheduledGenreSlugCleanup();
