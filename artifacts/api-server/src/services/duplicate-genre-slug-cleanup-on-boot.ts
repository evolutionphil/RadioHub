import { pgGenreCleanup,type GenreSlugCleanupRun } from '../data/postgres-genre-cleanup-store';
import { pgCoverage } from '../data/postgres-coverage-store';
import { logger } from '../utils/logger';
import { runDuplicateGenreSlugCleanup } from '../scripts/cleanup-duplicate-genre-slugs';
import { pruneOldGenreSlugCleanupRuns } from './scheduled-genre-slug-cleanup';
let hasRunOnce=false;
/** PostgreSQL uniqueness is always enforced; this audit also verifies legacy/offline repairs. */
export async function maybeRunDuplicateGenreSlugCleanupOnBoot():Promise<void>{
  if(hasRunOnce||process.env.SKIP_DUPLICATE_GENRE_SLUG_CLEANUP_ON_BOOT==='true')return;
  const leader=await pgCoverage().acquireJob('genre-slug-cleanup');if(!leader)return;
  let run:GenreSlugCleanupRun|null=null;
  try{
    leader.assertOwned();await pgGenreCleanup().recoverInterruptedRuns();run=await pgGenreCleanup().createRun('boot:deploy');
    const stats=await runDuplicateGenreSlugCleanup({manageConnection:false,dryRun:false,assertOwned:()=>leader.assertOwned(),log:m=>logger.log(m)});
    leader.assertOwned();run.status='completed';run.scanned=stats.scanned;run.collisionMarked=stats.losersDemoted;run.errorCount=stats.errors;
    run.finishedAt=new Date();run.durationMs=run.finishedAt.getTime()-run.startedAt.getTime();
    await pgGenreCleanup().saveRun(run);hasRunOnce=true;
  }catch(error){
    if(run){run.status='failed';run.errorCount=Math.max(1,run.errorCount);run.errorMessage=error instanceof Error?error.message:String(error);
      run.finishedAt=new Date();run.durationMs=run.finishedAt.getTime()-run.startedAt.getTime();await pgGenreCleanup().saveRun(run);}
    throw error;
  }finally{
    try{await pruneOldGenreSlugCleanupRuns();}catch(error){logger.error('Boot genre cleanup retention failed:',error);}
    await leader.release();
  }
}
