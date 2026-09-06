import { pgCoverage } from '../data/postgres-coverage-store';
import { logger } from '../utils/logger';
import { runCoverageBackfill } from './coverage-snapshot-backfill';

const DEFAULT_MIN_HISTORICAL_DAYS=7;
const DEFAULT_BACKFILL_DAYS=30;
let hasRunOnce=false;
function positiveInt(raw:string|undefined,fallback:number):number {
  const value=Number(raw);return Number.isSafeInteger(value)&&value>0?Math.min(value,3650):fallback;
}
function todayUtcMidnight():Date {const day=new Date();day.setUTCHours(0,0,0,0);return day;}

type Leader=NonNullable<Awaited<ReturnType<ReturnType<typeof pgCoverage>['acquireJob']>>>;
async function launch(seedDays:number,historicalDayCount:number,manual:boolean,thresholdDays?:number,existingLeader?:Leader):Promise<{kind:'started';seedDays:number;startedAt:string}|{kind:'busy'}>{
  const store=pgCoverage();const leader=existingLeader??await store.acquireJob('coverage-history-backfill');
  if(!leader)return {kind:'busy'};
  const startedAt=new Date();const fields={startedAt,seedDays,historicalDayCount,...thresholdDays===undefined?{}:{thresholdDays}};
  try {
    await store.recordStatus('running',`${manual?'Admin-triggered: ':''}Seeding ${seedDays} day(s) of historical coverage in the background.`,fields);
  }catch(error){await leader.release();throw error;}
  void (async()=>{
    try {
      leader.assertOwned();
      const result=await runCoverageBackfill({days:seedDays,dryRun:false,isCancelled:()=>{leader.assertOwned();return false;}});
      leader.assertOwned();const finishedAt=new Date();
      const outcome=result.skippedReason==='no-stations'?'done-no-stations':'done';
      await store.recordStatus(outcome,outcome==='done-no-stations'?'Stations table was empty — nothing to reconstruct.':
        `${manual?'Admin-triggered: ':''}Seeded ${result.daysSeeded} day(s); inserted ${result.inserted} row(s), preserved ${result.preserved} pre-existing row(s).`,
        {...fields,finishedAt,durationMs:finishedAt.getTime()-startedAt.getTime(),daysSeeded:result.daysSeeded,inserted:result.inserted,preserved:result.preserved});
    }catch(error){
      logger.error('Coverage historical backfill failed',error);
      // A disconnected former leader must not replace a newer worker's singleton state.
      leader.assertOwned();const finishedAt=new Date();const message=error instanceof Error?error.message:String(error);
      await store.recordStatus('failed',`Backfill failed: ${message}`,{...fields,finishedAt,durationMs:finishedAt.getTime()-startedAt.getTime(),error:message});
    }finally{await leader.release();}
  })().catch(error=>logger.error('Coverage backfill worker/audit failed',error));
  return {kind:'started',seedDays,startedAt:startedAt.toISOString()};
}

/** First-deploy seed remains asynchronous; all decisions and terminal outcomes are durable. */
export async function maybeRunCoverageBackfillOnBoot():Promise<void>{
  if(hasRunOnce)return;hasRunOnce=true;const store=pgCoverage();
  const leader=await store.acquireJob('coverage-history-backfill');
  if(!leader){logger.log('Coverage boot backfill already running on another worker');return;}
  let transferred=false;
  try {
  if(process.env.SKIP_COVERAGE_BACKFILL_ON_BOOT==='true'){
    await store.recordStatus('skipped-env','Skipped on this boot: SKIP_COVERAGE_BACKFILL_ON_BOOT=true');return;
  }
  const thresholdDays=positiveInt(process.env.COVERAGE_BACKFILL_BOOT_MIN_DAYS,DEFAULT_MIN_HISTORICAL_DAYS);
  const seedDays=positiveInt(process.env.COVERAGE_BACKFILL_BOOT_DAYS,DEFAULT_BACKFILL_DAYS);
  let historicalDayCount:number;
  try{historicalDayCount=await store.historicalDayCount(todayUtcMidnight());}
  catch(error){
    const message=error instanceof Error?error.message:String(error);
    await store.recordStatus('skipped-count-error',`Could not count existing historical snapshots: ${message}`,{thresholdDays,seedDays,error:message});
    logger.error('Coverage boot backfill could not evaluate existing history',error);return;
  }
  if(historicalDayCount>=thresholdDays){
    await store.recordStatus('skipped-already-seeded',`${historicalDayCount} historical day(s) already present (threshold ${thresholdDays}); seeder not needed`,{thresholdDays,historicalDayCount,seedDays});return;
  }
  const result=await launch(seedDays,historicalDayCount,false,thresholdDays,leader);
  transferred=result.kind==='started';
  if(result.kind==='busy')logger.log('Coverage boot backfill already running on another worker');
  } finally { if(!transferred)await leader.release(); }
}

export type RunCoverageBackfillNowResult=
  |{kind:'started';seedDays:number;startedAt:string}|{kind:'busy'}
  |{kind:'dry-run';seedDays:number;daysSeeded:number;wouldWrite:number;skippedReason?:'no-stations'};
export async function runCoverageBackfillNow(opts:{days?:number;dryRun?:boolean}):Promise<RunCoverageBackfillNowResult>{
  const seedDays=positiveInt(opts.days==null?undefined:String(opts.days),DEFAULT_BACKFILL_DAYS);
  if(opts.dryRun){
    const result=await runCoverageBackfill({days:seedDays,dryRun:true});
    return {kind:'dry-run',seedDays,daysSeeded:result.daysSeeded,wouldWrite:result.wouldWrite,skippedReason:result.skippedReason};
  }
  const historicalDayCount=await pgCoverage().historicalDayCount(todayUtcMidnight());
  return launch(seedDays,historicalDayCount,true);
}
