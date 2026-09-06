import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { getPostgresPool } from '../postgres-runtime';
import { seoShape, seoTransaction } from './postgres-seo-indexing-store';

const id=()=>randomBytes(12).toString('hex');
const nonIndexed=['discovered-not-indexed','crawled-not-indexed'];
const rollup=`count(*)::int total,count(*) FILTER(WHERE state='indexed')::int indexed,
  count(*) FILTER(WHERE state='crawled-not-indexed')::int "crawledNotIndexed",count(*) FILTER(WHERE state='discovered-not-indexed')::int "discoveredNotIndexed",
  count(*) FILTER(WHERE state='excluded')::int excluded,count(*) FILTER(WHERE state='error')::int error,
  count(*) FILTER(WHERE state='pending')::int pending,count(*) FILTER(WHERE state='unknown')::int unknown`;

export async function pgGscSyncDiscovery(specs:Array<{url:string;language:string;group:string}>,staleMs:number):Promise<{inserted:number;refreshed:number;pruned:number}>{
  if(!specs.length)throw new Error('Refusing to prune GSC discovery from an empty sitemap set');
  return seoTransaction(async client=>{
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('gsc-discovery',0))");
    let inserted=0,refreshed=0;const now=new Date();
    for(let offset=0;offset<specs.length;offset+=1000){
      const rows=specs.slice(offset,offset+1000).map(row=>({...row,id:id()}));
      const result=await client.query(`INSERT INTO gsc_url_inspections(id,url,language,url_group,discovered_at,updated_at)
        SELECT x.id,x.url,x.language,x."group",$2,$2 FROM jsonb_to_recordset($1) AS x(id text,url text,language text,"group" text)
        ON CONFLICT(url) DO UPDATE SET language=EXCLUDED.language,url_group=EXCLUDED.url_group,discovered_at=EXCLUDED.discovered_at,updated_at=EXCLUDED.updated_at
        RETURNING (xmax=0) inserted`,[JSON.stringify(rows),now]);
      for(const row of result.rows)row.inserted?inserted++:refreshed++;
    }
    const pruned=(await client.query('DELETE FROM gsc_url_inspections WHERE discovered_at<$1',[new Date(now.getTime()-staleMs)])).rowCount||0;
    return {inserted,refreshed,pruned};
  });
}
export async function pgGscBackfill():Promise<number>{return(await getPostgresPool().query("UPDATE gsc_url_inspections SET not_indexed_since=COALESCE(last_inspected_at,updated_at,now()) WHERE state=ANY($1) AND not_indexed_since IS NULL",[nonIndexed])).rowCount||0;}
export async function pgGscCounts(cutoff:Date):Promise<{total:number;stuck:number}>{return(await getPostgresPool().query('SELECT count(*)::int total,count(*) FILTER(WHERE state=ANY($1) AND not_indexed_since<=$2)::int stuck FROM gsc_url_inspections',[nonIndexed,cutoff])).rows[0];}
export async function pgGscStats():Promise<any>{
  const [state,group,language]=await Promise.all([
    getPostgresPool().query('SELECT state _id,count(*)::int count FROM gsc_url_inspections GROUP BY state ORDER BY count(*) DESC,state'),
    getPostgresPool().query(`SELECT url_group _id,${rollup} FROM gsc_url_inspections GROUP BY url_group ORDER BY url_group`),
    getPostgresPool().query(`SELECT language _id,${rollup} FROM gsc_url_inspections GROUP BY language ORDER BY language`),
  ]);return {byState:state.rows,byGroup:group.rows,byLanguage:language.rows};
}
export async function pgGscGroupCounts():Promise<any[]>{return(await getPostgresPool().query(`SELECT json_build_object('language',language,'group',url_group) _id,${rollup},count(*)::int count
  FROM gsc_url_inspections GROUP BY language,url_group ORDER BY language,url_group`)).rows;}
export async function pgGscDigestGroupCounts(args:{windowStart:Date;windowEnd:Date;recoveryStart:Date;stuckCutoff:Date;newlyStuckLowerBound:Date}):Promise<any[]> {
  return (await getPostgresPool().query(`SELECT url_group AS "group",
    count(*) FILTER(WHERE state=ANY($1) AND not_indexed_since<=$2)::int AS "currentlyStuck",
    count(*) FILTER(WHERE last_resubmit_at>=$3 AND last_resubmit_at<$4)::int AS "resubmittedInWindow",
    count(*) FILTER(WHERE state='indexed' AND last_resubmit_at>=$5 AND last_resubmit_at<$4 AND last_inspected_at>last_resubmit_at)::int AS "recoveredAfterResubmit",
    count(*) FILTER(WHERE state=ANY($1) AND not_indexed_since>=$6 AND not_indexed_since<=$2)::int AS "newlyStuckInWindow"
    FROM gsc_url_inspections GROUP BY url_group ORDER BY url_group`,
    [nonIndexed,args.stuckCutoff,args.windowStart,args.windowEnd,args.recoveryStart,args.newlyStuckLowerBound])).rows;
}
export async function pgGscList(filter:{language?:string;group?:string;state?:string;search?:string}={},limit=50,offset=0):Promise<{rows:any[];total:number}>{
  const values=[filter.language&&filter.language!=='all'?filter.language:null,filter.group&&filter.group!=='all'?filter.group:null,filter.state&&filter.state!=='all'?filter.state:null,filter.search||null];
  const clause="($1::text IS NULL OR language=$1) AND ($2::text IS NULL OR url_group=$2) AND ($3::text IS NULL OR state=$3) AND ($4::text IS NULL OR starts_with(url,$4))";
  const [rows,total]=await Promise.all([
    getPostgresPool().query(`SELECT * FROM gsc_url_inspections WHERE ${clause} ORDER BY state,language,url LIMIT $5 OFFSET $6`,[...values,Math.max(1,Math.min(limit,50000)),Math.max(0,offset)]),
    getPostgresPool().query(`SELECT count(*)::int count FROM gsc_url_inspections WHERE ${clause}`,values),
  ]);return {rows:rows.rows.map(seoShape),total:total.rows[0].count};
}
export async function pgGscClaimInspection(siteUrl:string,limit:number,dailyLimit=2000):Promise<any[]>{
  return seoTransaction(async client=>{
    const day=new Date().toISOString().slice(0,10);
    await client.query('INSERT INTO gsc_inspection_quota(day,site_url) VALUES($1,$2) ON CONFLICT DO NOTHING',[day,siteUrl]);
    const used=(await client.query('SELECT requests FROM gsc_inspection_quota WHERE day=$1 AND site_url=$2 FOR UPDATE',[day,siteUrl])).rows[0].requests;
    const budget=Math.max(0,Math.min(Math.floor(limit)||1,200,Math.max(0,Math.floor(dailyLimit)-used)));
    if(!budget)return [];
    const lease=randomUUID();
    const rows=(await client.query(`UPDATE gsc_url_inspections SET inspection_lease_token=$1,inspection_lease_until=now()+interval '15 minutes'
      WHERE id IN (SELECT id FROM gsc_url_inspections WHERE inspection_lease_until IS NULL OR inspection_lease_until<=now()
        ORDER BY last_inspected_at NULLS FIRST,discovered_at DESC,id FOR UPDATE SKIP LOCKED LIMIT $2) RETURNING *`,[lease,budget])).rows;
    await client.query('UPDATE gsc_inspection_quota SET requests=requests+$3 WHERE day=$1 AND site_url=$2',[day,siteUrl,rows.length]);
    return rows.map(seoShape).sort((a,b)=>(a.lastInspectedAt?.getTime()||0)-(b.lastInspectedAt?.getTime()||0));
  });
}
const inspectionFields:Record<string,string>={state:'state',coverageState:'coverage_state',verdict:'verdict',robotsTxtState:'robots_txt_state',indexingState:'indexing_state',pageFetchState:'page_fetch_state',lastCrawlTime:'last_crawl_time',googleCanonical:'google_canonical',userCanonical:'user_canonical',inspectionResultLink:'inspection_result_link',lastInspectedAt:'last_inspected_at',lastError:'last_error',errorCount:'error_count',updatedAt:'updated_at',notIndexedSince:'not_indexed_since'};
export async function pgGscBeginInspection(rowId:string,lease:string):Promise<boolean>{
  return !!(await getPostgresPool().query("UPDATE gsc_url_inspections SET inspection_lease_until=now()+interval '15 minutes' WHERE id=$1 AND inspection_lease_token=$2 AND inspection_lease_until>now() RETURNING id",[rowId,lease])).rowCount;
}
export async function pgGscSaveInspection(rowId:string,lease:string,patch:Record<string,unknown>,incrementErrors=false):Promise<boolean>{
  const values:any[]=[rowId,lease];const assignments=['inspection_lease_token=NULL','inspection_lease_until=NULL'];
  for(const [field,value] of Object.entries(patch)){
    const column=inspectionFields[field];if(!column)throw new Error(`Unsupported GSC inspection field ${field}`);
    values.push(value??null);assignments.push(`${column}=$${values.length}`);
  }
  if(incrementErrors)assignments.push('error_count=error_count+1');
  return !!(await getPostgresPool().query(`UPDATE gsc_url_inspections SET ${assignments.join(',')} WHERE id=$1 AND inspection_lease_token=$2 AND inspection_lease_until>now() RETURNING id`,values)).rowCount;
}
export async function pgGscClaimResubmit(stuck:Date,cooldown:Date,limit:number):Promise<any[]>{
  return(await getPostgresPool().query(`UPDATE gsc_url_inspections SET resubmit_lease_token=$1,resubmit_lease_until=now()+interval '15 minutes'
    WHERE id IN (SELECT id FROM gsc_url_inspections WHERE state=ANY($2) AND not_indexed_since<=$3 AND (last_resubmit_at IS NULL OR last_resubmit_at<=$4)
      AND (resubmit_lease_until IS NULL OR resubmit_lease_until<=now()) ORDER BY not_indexed_since,id FOR UPDATE SKIP LOCKED LIMIT $5) RETURNING *`,
    [randomUUID(),nonIndexed,stuck,cooldown,Math.max(1,Math.min(limit,10000))])).rows.map(seoShape);
}
export async function pgGscSaveResubmit(rows:any[],timestamp:Date,status:'success'|'failed',error?:string):Promise<void>{
  if(!rows.length)return;
  await getPostgresPool().query(`UPDATE gsc_url_inspections SET last_resubmit_at=$3,last_resubmit_status=$4,last_resubmit_error=$5,
    updated_at=$3,resubmit_count=resubmit_count+1,last_inspected_at=NULL,resubmit_lease_token=NULL,resubmit_lease_until=NULL
    WHERE id=ANY($1) AND resubmit_lease_token=$2 AND resubmit_lease_until>now()`,[rows.map(row=>row._id),rows[0].resubmitLeaseToken,timestamp,status,error||null]);
}
export async function pgGscSnapshots(since:Date,language?:string,group?:string):Promise<any[]>{return(await getPostgresPool().query(`SELECT * FROM gsc_indexing_snapshots WHERE date>=$1
  AND ($2::text IS NULL OR language=$2) AND ($3::text IS NULL OR url_group=$3) ORDER BY date,language,url_group`,[since,language&&language!=='any'?language:null,group&&group!=='any'?group:null])).rows.map(seoShape);}
export async function pgGscSaveSnapshots(rows:any[]):Promise<void>{
  if(!rows.length)return;
  await seoTransaction(async client=>{
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('gsc-snapshot',0))");
    await client.query(`DELETE FROM gsc_indexing_snapshots s WHERE s.date=ANY($2::timestamptz[]) AND NOT EXISTS(
      SELECT 1 FROM jsonb_to_recordset($1) AS x(date timestamptz,language text,"group" text)
      WHERE x.date=s.date AND x.language=s.language AND x."group"=s.url_group)`,[JSON.stringify(rows),[...new Set(rows.map(row=>new Date(row.date).toISOString()))]]);
    for(const row of rows)await client.query(`INSERT INTO gsc_indexing_snapshots(id,date,language,url_group,total,indexed,crawled_not_indexed,discovered_not_indexed,excluded,error,pending,unknown)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(date,language,url_group) DO UPDATE SET total=EXCLUDED.total,indexed=EXCLUDED.indexed,
      crawled_not_indexed=EXCLUDED.crawled_not_indexed,discovered_not_indexed=EXCLUDED.discovered_not_indexed,excluded=EXCLUDED.excluded,error=EXCLUDED.error,pending=EXCLUDED.pending,unknown=EXCLUDED.unknown`,
      [id(),row.date,row.language,row.group,row.total,row.indexed,row.crawledNotIndexed,row.discoveredNotIndexed,row.excluded,row.error,row.pending,row.unknown]);
  });
}
export async function pgGscPruneSnapshots(cutoff:Date):Promise<number>{return(await getPostgresPool().query('DELETE FROM gsc_indexing_snapshots WHERE date<$1',[cutoff])).rowCount||0;}
export async function pgGscOAuthToken():Promise<any>{return seoShape((await getPostgresPool().query('SELECT * FROM gsc_oauth_tokens ORDER BY created_at DESC,id DESC LIMIT 1')).rows[0]);}
export async function pgGscReplaceOAuthToken(input:any|null):Promise<void>{
  await seoTransaction(async client=>{
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('gsc-oauth',0))");
    await client.query('DELETE FROM gsc_oauth_tokens');
    if(input)await client.query(`INSERT INTO gsc_oauth_tokens(id,refresh_token,access_token,expiry_date,scope,connected_email) VALUES($1,$2,$3,$4,$5,$6)`,
      [id(),input.refreshToken,input.accessToken||null,input.expiryDate||null,input.scope||'https://www.googleapis.com/auth/webmasters.readonly',input.connectedEmail||null]);
  });
}
export async function pgGscCreateOAuthState(sessionId:string):Promise<string>{
  const state=randomBytes(32).toString('hex');
  await getPostgresPool().query("INSERT INTO gsc_oauth_states(state_hash,session_id,expires_at) VALUES($1,$2,now()+interval '10 minutes')",[createHash('sha256').update(state).digest('hex'),sessionId]);
  return state;
}
export async function pgGscConsumeOAuthState(state:string,sessionId:string):Promise<boolean>{
  if(!/^[a-f0-9]{64}$/.test(state)||!sessionId)return false;
  return !!(await getPostgresPool().query('DELETE FROM gsc_oauth_states WHERE state_hash=$1 AND session_id=$2 AND expires_at>now() RETURNING state_hash',[createHash('sha256').update(state).digest('hex'),sessionId])).rowCount;
}
