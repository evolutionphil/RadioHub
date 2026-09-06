import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { pgGenreCleanup,type DuplicateGenreSlugCleanupStats } from '../data/postgres-genre-cleanup-store';
import { closePostgres } from '../postgres-runtime';
import { logger } from '../utils/logger';
export type { DuplicateGenreSlugCleanupStats } from '../data/postgres-genre-cleanup-store';
export interface RunDuplicateGenreSlugCleanupOptions {manageConnection?:boolean;dryRun?:boolean;log?:(message:string)=>void;assertOwned?:()=>void}
/** Normally a no-op because PostgreSQL enforces unique slugs; retained for legacy/offline repair. */
export async function runDuplicateGenreSlugCleanup(options:RunDuplicateGenreSlugCleanupOptions={}):Promise<DuplicateGenreSlugCleanupStats>{
  try{
    const stats=await pgGenreCleanup().cleanupDuplicates(options.dryRun??['1','true'].includes(process.env.DRY_RUN??''),options.log??(m=>logger.log(m)),options.assertOwned);
    options.log?.(`Duplicate genre cleanup: ${JSON.stringify(stats)}`);return stats;
  }finally{if(options.manageConnection!==false)await closePostgres();}
}
if(import.meta.url.includes('cleanup-duplicate-genre-slugs')&&process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  runDuplicateGenreSlugCleanup().catch(error=>{console.error('Duplicate genre cleanup failed:',error);process.exitCode=1;});
}
