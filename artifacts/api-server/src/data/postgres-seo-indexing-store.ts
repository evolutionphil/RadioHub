import { randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { getPostgresPool, getPostgresCoordinationPool } from '../postgres-runtime';

const id=()=>randomBytes(12).toString('hex');
export const INDEXNOW_SUBMISSION_URLS_RETENTION_DAYS=30;
export interface ISitemapManifestChunk { chunk:number;stationIds:string[];urlCount:number;maxUpdatedAt?:Date }
export interface IGscUrlInspection { group:'static'|'country'|'station'|'genre';state:'indexed'|'crawled-not-indexed'|'discovered-not-indexed'|'excluded'|'error'|'unknown'|'pending' }
export function seoShape(row:any):any{
  if(!row)return null;const out:any={};
  for(const [key,value] of Object.entries(row))out[key==='url_group'?'group':key.replace(/_([a-z])/g,(_m,c)=>c.toUpperCase())]=value;
  if(row.id)out._id=row.id;
  if(out.chunks)out.chunks=out.chunks.map((chunk:any)=>({...chunk,stationIds:(chunk.stationIds||[]).map(String),maxUpdatedAt:chunk.maxUpdatedAt?new Date(chunk.maxUpdatedAt):undefined}));
  if(out.expiryDate!==undefined&&out.expiryDate!==null)out.expiryDate=Number(out.expiryDate);
  return out;
}
export async function seoTransaction<T>(work:(client:PoolClient)=>Promise<T>):Promise<T>{
  const client=await getPostgresPool().connect();
  try{await client.query('BEGIN');const result=await work(client);await client.query('COMMIT');return result;}
  catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error;}finally{client.release();}
}
export interface SeoJobLock { client:PoolClient;assertOwned:()=>void }
export async function withSeoJobLock<T>(key:string,work:(lock:SeoJobLock)=>Promise<T>):Promise<T>{
  const client=await getPostgresCoordinationPool().connect();let locked=false;let lost:Error|undefined;
  const lose=(error?:Error)=>{lost ||= error || new Error('SEO job lock connection ended');};
  const assertOwned=()=>{if(lost)throw new Error('SEO job lock no longer owned',{cause:lost});};
  client.on('error',lose);client.on('end',lose);
  try{
    locked=(await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) locked',[`seo-job:${key}`])).rows[0].locked;
    if(!locked)throw Object.assign(new Error('SEO job already running on another worker'),{statusCode:409});
    assertOwned();const result=await work({client,assertOwned});assertOwned();return result;
  }finally{
    if(locked&&!lost)await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[`seo-job:${key}`]).catch(lose);
    client.release(Boolean(lost));client.removeListener('error',lose);client.removeListener('end',lose);
  }
}
export async function pgCreateIndexNowLog(input:any):Promise<any>{
  return seoShape((await getPostgresPool().query(`INSERT INTO indexnow_logs(id,timestamp,host,url_count,status,status_code,trigger,error_message,sample_urls,retry_attempt,response_time,run_date)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,[id(),input.timestamp||new Date(),input.host,input.urlCount,input.status,input.statusCode||null,input.trigger,input.errorMessage||null,input.sampleUrls||[],input.retryAttempt||0,input.responseTime??null,input.runDate||null])).rows[0]);
}
export async function pgSaveIndexNowUrls(input:any):Promise<void>{
  await getPostgresPool().query(`INSERT INTO indexnow_submission_urls(id,log_id,timestamp,host,trigger,urls,url_count,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
    ON CONFLICT(log_id) DO UPDATE SET urls=EXCLUDED.urls,url_count=EXCLUDED.url_count,expires_at=EXCLUDED.expires_at`,[id(),String(input.logId),input.timestamp,input.host,input.trigger,input.urls,input.urlCount,input.expiresAt]);
}
export async function pgIndexNowUrls(logId:string):Promise<any>{return seoShape((await getPostgresPool().query('SELECT * FROM indexnow_submission_urls WHERE log_id=$1 AND expires_at>now()',[logId])).rows[0]);}
export async function pgIndexNowLog(logId:string):Promise<any>{return seoShape((await getPostgresPool().query('SELECT * FROM indexnow_logs WHERE id=$1',[logId])).rows[0]);}
export async function pgIndexNowLogs(filter:{host?:string;status?:string;since?:Date;trigger?:string}={},limit=100):Promise<any[]>{
  return(await getPostgresPool().query(`SELECT * FROM indexnow_logs WHERE ($1::text IS NULL OR host=$1) AND ($2::text IS NULL OR status=$2)
    AND ($3::text IS NULL OR trigger=$3) AND ($4::timestamptz IS NULL OR timestamp>=$4 OR run_date>=to_char($4 AT TIME ZONE 'UTC','YYYY-MM-DD')) ORDER BY timestamp DESC,id DESC LIMIT $5`,
    [filter.host&&filter.host!=='all'?filter.host:null,filter.status&&filter.status!=='all'?filter.status:null,filter.trigger||null,filter.since||null,Math.max(1,Math.min(limit,100000))])).rows.map(seoShape);
}
export async function pgIndexNowStats(today:Date,since:Date):Promise<any>{
  const counts="count(*)::int count,count(*) FILTER(WHERE status='success')::int successful,count(*) FILTER(WHERE status='failed')::int failed";
  const [totals,hosts,triggers,trend]=await Promise.all([
    getPostgresPool().query(`SELECT ${counts},count(*) FILTER(WHERE timestamp>=$1)::int today,COALESCE(round(avg(response_time)),0)::int avg FROM indexnow_logs`,[today]),
    getPostgresPool().query(`SELECT host _id,${counts} FROM indexnow_logs GROUP BY host ORDER BY count(*) DESC,host`),
    getPostgresPool().query(`SELECT trigger _id,${counts} FROM indexnow_logs GROUP BY trigger ORDER BY count(*) DESC,trigger`),
    getPostgresPool().query(`SELECT to_char(timestamp AT TIME ZONE 'UTC','YYYY-MM-DD') _id,${counts} FROM indexnow_logs WHERE timestamp>=$1 GROUP BY 1 ORDER BY 1`,[since]),
  ]);return {totals:totals.rows[0],hosts:hosts.rows,triggers:triggers.rows,trend:trend.rows};
}
export async function pgActiveManifest(type:string,language:string):Promise<any>{return seoShape((await getPostgresPool().query("SELECT * FROM sitemap_manifests WHERE type=$1 AND language=$2 AND status='active' ORDER BY generated_at DESC,id DESC LIMIT 1",[type,language])).rows[0]);}
export async function pgActiveManifests(type?:string):Promise<any[]>{return(await getPostgresPool().query("SELECT * FROM sitemap_manifests WHERE status='active' AND ($1::text IS NULL OR type=$1) ORDER BY type,language",[type||null])).rows.map(seoShape);}
export async function pgWriteBuildingManifest(input:any):Promise<any>{
  return seoTransaction(async client=>{
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`manifest:${input.type}:${input.language}`]);
    const active=(await client.query("SELECT * FROM sitemap_manifests WHERE type=$1 AND language=$2 AND status='active' FOR UPDATE",[input.type,input.language])).rows[0];
    if(active?.version===input.version){
      return seoShape((await client.query(`UPDATE sitemap_manifests SET chunks=$2,total_urls=$3,chunk_count=$4,qualified_languages=$5,qualified_languages_hash=$6,
        generated_at=now(),expires_at=now()+interval '7 days' WHERE id=$1 RETURNING *`,[active.id,JSON.stringify(input.chunks),input.totalUrls,input.chunks.length,input.qualifiedLanguages,input.qualifiedLanguagesHash])).rows[0]);
    }
    await client.query("UPDATE sitemap_manifests SET status='failed',error_message='Stale build reclaimed',expires_at=now()+interval '1 day' WHERE type=$1 AND language=$2 AND status='building' AND generated_at<now()-interval '30 minutes'",[input.type,input.language]);
    const building=(await client.query("SELECT * FROM sitemap_manifests WHERE type=$1 AND language=$2 AND status='building'",[input.type,input.language])).rows[0];
    if(building)return {...seoShape(active||building),status:'active',_raceLost:true};
    return seoShape((await client.query(`INSERT INTO sitemap_manifests(id,type,language,version,status,qualified_languages_hash,qualified_languages,chunks,total_urls,chunk_count,expires_at)
      VALUES($1,$2,$3,$4,'building',$5,$6,$7,$8,$9,now()+interval '6 hours') RETURNING *`,[id(),input.type,input.language,input.version,input.qualifiedLanguagesHash,input.qualifiedLanguages,JSON.stringify(input.chunks),input.totalUrls,input.chunks.length])).rows[0]);
  });
}
export async function pgActivateManifest(buildingId:string,type:string,language:string):Promise<void>{
  await seoTransaction(async client=>{
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`manifest:${type}:${language}`]);
    const owned=await client.query("SELECT id FROM sitemap_manifests WHERE id=$1 AND type=$2 AND language=$3 AND status='building' AND generated_at>=now()-interval '30 minutes' FOR UPDATE",[String(buildingId),type,language]);
    if(!owned.rowCount)throw new Error('Manifest build lease no longer owned');
    await client.query("UPDATE sitemap_manifests SET status='superseded',expires_at=now()+interval '1 day' WHERE type=$1 AND language=$2 AND status='active'",[type,language]);
    await client.query("UPDATE sitemap_manifests SET status='active',expires_at=now()+interval '7 days' WHERE id=$1",[String(buildingId)]);
  });
}
export async function pgFreshManifestCount(hash:string,languages:string[],since:Date):Promise<number>{return(await getPostgresPool().query("SELECT count(*)::int count FROM sitemap_manifests WHERE status='active' AND qualified_languages_hash=$1 AND language=ANY($2) AND generated_at>=$3",[hash,languages,since])).rows[0].count;}
export async function pgRetireManifests(languages:string[]):Promise<number>{
  if(!languages.length)throw new Error('Refusing to retire every manifest from an empty qualified-language set');
  return(await getPostgresPool().query("UPDATE sitemap_manifests SET status='retired',expires_at=now()+interval '1 day' WHERE status='active' AND NOT(language=ANY($1))",[languages])).rowCount||0;
}
export async function pgSeoGenres(ids?:readonly unknown[]):Promise<any[]>{return(await getPostgresPool().query("SELECT id AS _id,slug,station_count AS \"stationCount\",updated_at AS \"updatedAt\" FROM genres WHERE slug IS NOT NULL AND slug<>'' AND ($1::text[] IS NULL OR id=ANY($1)) ORDER BY station_count DESC,id",[ids?ids.map(String):null])).rows;}
export async function pgStationSlugRows():Promise<any[]> {
  return (await getPostgresPool().query(`SELECT slug,slug_aliases AS "slugAliases",no_index AS "noIndex",name,url,
    last_check_ok AS "lastCheckOk",last_check_time AS "lastCheckTime",source->>'lastCheckOkTime' AS "lastCheckOkTime"
    FROM stations WHERE slug IS NOT NULL ORDER BY id`)).rows;
}
export async function pgSlugCountryNames():Promise<Array<{name:string}>> {
  return (await getPostgresPool().query('SELECT name FROM countries ORDER BY name')).rows;
}
export async function pgSlugCountryStates():Promise<Array<{_id:{country:string;state:string}}>> {
  return (await getPostgresPool().query(`SELECT json_build_object('country',country,'state',state) _id FROM stations
    WHERE country IS NOT NULL AND country<>'' AND state IS NOT NULL AND state<>'' GROUP BY country,state ORDER BY country,state`)).rows;
}
export async function pgTopIndexableTags(limit:number):Promise<Array<{_id:string;count:number}>> {
  return (await getPostgresPool().query(`SELECT btrim(tag) _id,count(*)::int count FROM stations
    CROSS JOIN LATERAL unnest(string_to_array(lower(tags_raw),',')) AS tag
    WHERE no_index=false AND last_check_ok IS DISTINCT FROM false AND source->>'isJunk' IS DISTINCT FROM 'true' AND btrim(tag)<>''
    GROUP BY btrim(tag) ORDER BY count(*) DESC,btrim(tag) LIMIT $1`,[Math.max(1,Math.min(1000,limit))])).rows;
}
export async function pgTopSitemapCountries(limit:number):Promise<any[]>{return(await getPostgresPool().query(`SELECT country AS _id,count(*)::int count,max(updated_at) AS "maxUpdatedAt" FROM stations
  WHERE country IS NOT NULL AND country<>'' AND no_index=false AND last_check_ok IS DISTINCT FROM false AND source->>'isJunk' IS DISTINCT FROM 'true'
  GROUP BY country ORDER BY count(*) DESC,country LIMIT $1`,[limit])).rows;}
export async function pgTouchSitemapStations(now:Date):Promise<{matchedCount:number;modifiedCount:number}> {
  return seoTransaction(async client=>{
    const lock=await client.query("SELECT pg_try_advisory_xact_lock(hashtext('radiohub-provider-sync')) acquired");
    if(!lock.rows[0].acquired)throw Object.assign(new Error('Nightly station sync is currently running — please retry in a few minutes.'),{statusCode:409,code:'sync_in_progress'});
    const result=await client.query("UPDATE stations SET updated_at=$1,source=source || jsonb_build_object('updatedAt',$2::text) WHERE slug IS NOT NULL AND slug<>''",[now,now.toISOString()]);
    return {matchedCount:result.rowCount||0,modifiedCount:result.rowCount||0};
  });
}
export async function pgSitemapStationDiagnostics():Promise<Record<string,unknown>> {
  const [totals,sample]=await Promise.all([
    getPostgresPool().query(`SELECT current_database() AS "dbName",current_schema() AS "schemaName",count(*)::int AS "totalDocs",
      count(*) FILTER(WHERE slug IS NOT NULL)::int AS "withSlugField",count(*) FILTER(WHERE slug IS NOT NULL AND slug<>'')::int AS "withSlugNonEmpty" FROM stations`),
    getPostgresPool().query(`SELECT id AS _id,slug,name,country_code AS "countryCode",updated_at AS "updatedAt" FROM stations
      WHERE slug IS NOT NULL AND slug<>'' ORDER BY updated_at DESC,id LIMIT 1`),
  ]);
  return {...totals.rows[0],collectionName:'stations',mostRecentSample:sample.rows[0]||null};
}
export async function pgGetUrlSnapshot(type:string,language:string,chunk=0):Promise<any>{return seoShape((await getPostgresPool().query('SELECT * FROM sitemap_url_snapshots WHERE type=$1 AND language=$2 AND chunk=$3',[type,language,chunk])).rows[0]);}
export async function pgSaveUrlSnapshot(type:string,language:string,chunk:number,urls:string[],lock?:SeoJobLock):Promise<void>{
  lock?.assertOwned();
  // A locked worker must write on the very session holding the advisory lock.
  // A pooled replacement connection could overwrite its successor after loss.
  await (lock?.client || getPostgresPool()).query(`INSERT INTO sitemap_url_snapshots(id,type,language,chunk,urls,url_count) VALUES($1,$2,$3,$4,$5,$6)
    ON CONFLICT(type,language,chunk) DO UPDATE SET urls=EXCLUDED.urls,url_count=EXCLUDED.url_count,generated_at=now(),updated_at=now()`,[id(),type,language,chunk,urls,urls.length]);
  lock?.assertOwned();
}
export async function pgSeoCleanup():Promise<void>{await getPostgresPool().query("DELETE FROM indexnow_submission_urls WHERE expires_at<=now(); DELETE FROM sitemap_manifests WHERE status<>'active' AND expires_at<=now(); DELETE FROM gsc_inspection_quota WHERE day<(now() AT TIME ZONE 'UTC')::date-30; DELETE FROM gsc_oauth_states WHERE expires_at<=now()");}
