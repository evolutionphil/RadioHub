import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { pgGenreCleanup,type GenreSlugCleanupStats } from '../data/postgres-genre-cleanup-store';
import { closePostgres } from '../postgres-runtime';
import { logger } from '../utils/logger';
export type { GenreSlugCleanupStats } from '../data/postgres-genre-cleanup-store';
export interface RunGenreSlugCleanupOptions {
  manageConnection?:boolean;dryRun?:boolean;rewarmDownstream?:boolean;log?:(message:string)=>void;assertOwned?:()=>void;
}
/** Native, atomic genre repair. Failed writes roll back the complete repair batch. */
export async function runGenreSlugCleanup(options:RunGenreSlugCleanupOptions={}):Promise<GenreSlugCleanupStats>{
  const dryRun=options.dryRun??['1','true'].includes(process.env.DRY_RUN??'');const log=options.log??(m=>logger.log(m));
  try{
    const stats=await pgGenreCleanup().cleanupMalformed(dryRun,log,options.assertOwned);
    log(`Genre cleanup: ${JSON.stringify(stats)}`);
    if(!dryRun&&options.rewarmDownstream!==false&&(stats.normalized>0||stats.markedUndiscoverable>0)){
      const failures:unknown[]=[];
      try{options.assertOwned?.();const {PrecomputedGenresService}=await import('../services/precomputed-genres');await PrecomputedGenresService.refreshAll();}catch(error){failures.push(error);}
      try{options.assertOwned?.();const {buildAllSitemapManifests}=await import('../seo/sitemap-manifest-builder');await buildAllSitemapManifests({force:true});}catch(error){failures.push(error);}
      if(failures.length){const error=new AggregateError(failures,'Genre repair committed but downstream cache/sitemap refresh failed');Object.assign(error,{cleanupStats:stats});throw error;}
    }
    return stats;
  }finally{if(options.manageConnection!==false)await closePostgres();}
}
if(import.meta.url.includes('cleanup-malformed-genre-slugs')&&process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  runGenreSlugCleanup().catch(error=>{console.error('Genre cleanup failed:',error);process.exitCode=1;});
}
