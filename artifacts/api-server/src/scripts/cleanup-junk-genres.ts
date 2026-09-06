import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { pgGenreCleanup } from '../data/postgres-genre-cleanup-store';
import { closePostgres } from '../postgres-runtime';
import { logger } from '../utils/logger';

export interface CleanupReport {total:number;kept:number;deleted:number;unslugged:number;dryRun:boolean}
/** Preserve the whitelist/alias keep rules, including native admin overrides and atomic deletion. */
export async function cleanupJunkGenres(options:{dryRun?:boolean}={}):Promise<CleanupReport>{
  const report=await pgGenreCleanup().cleanupJunk(options.dryRun??['1','true','yes'].includes(process.env.DRY_RUN??''));
  logger.log(`[cleanup-junk-genres] ${JSON.stringify(report)}`);return report;
}
if(import.meta.url.includes('cleanup-junk-genres')&&process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  cleanupJunkGenres().catch(error=>{logger.error('[cleanup-junk-genres] failed:',error);process.exitCode=1;}).finally(()=>closePostgres());
}
