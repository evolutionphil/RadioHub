import { randomBytes } from 'node:crypto';
import type { Pool,PoolClient } from 'pg';
import { getPostgresPool, getPostgresCoordinationPool } from '../postgres-runtime';
import { compileCatalogFilter } from './postgres-catalog-store';

export interface BackfillSampleStation { _id:string;slug?:string;name?:string }
export interface BackfillRun {
  _id:string;trigger:string;status:'running'|'completed'|'failed';topN:number;overrideCountry?:string;
  startedAt:Date;finishedAt?:Date;durationMs?:number;errorMessage?:string;
  logos:Array<{countryCode:string;candidates:number;enqueued:number;durationMs?:number;sampleStations?:BackfillSampleStation[]}>;
  tags:Array<{countryCode:string;processed:number;hydrated:number;emptyUpstream:number;failed:number;durationMs?:number;sampleStations?:BackfillSampleStation[]}>;
  attempts?:Array<{attempt:number;error:string;failedAt:Date}>;
}
export type CoverageBackfillBootOutcome='skipped-env'|'skipped-already-seeded'|'skipped-count-error'|'running'|'done'|'done-no-stations'|'failed';
export interface CoverageRow {countryCode:string;total:number;withLogo:number;withTags:number}
const id=()=>randomBytes(12).toString('hex');
const fieldMap:Record<string,string>={countryCode:'country_code',snapshotDate:'snapshot_date',withLogo:'with_logo',withTags:'with_tags',logoCoveragePct:'logo_coverage_pct',tagCoveragePct:'tag_coverage_pct',createdAt:'created_at',updatedAt:'updated_at',observedAt:'observed_at',startedAt:'started_at',finishedAt:'finished_at',durationMs:'duration_ms',thresholdDays:'threshold_days',historicalDayCount:'historical_day_count',seedDays:'seed_days',daysSeeded:'days_seeded',topN:'top_n',overrideCountry:'override_country',errorMessage:'error_message'};
function shape(row:any):any {
  if(!row)return null;const result={...row,_id:row.id};delete result.id;
  for(const [api,column] of Object.entries(fieldMap)) if(Object.hasOwn(result,column)){result[api]=result[column];delete result[column];}
  return result;
}

export class PostgresCoverageStore {
  constructor(private readonly pool:Pool,private readonly coordinationPool:Pool=pool){}
  private async transaction<T>(work:(client:PoolClient)=>Promise<T>):Promise<T>{
    const client=await this.pool.connect();
    try{await client.query('BEGIN');const result=await work(client);await client.query('COMMIT');return result;}
    catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
  async coverage(endOfDay?:Date):Promise<CoverageRow[]>{
    const {rows}=await this.pool.query(`SELECT upper(country_code) "countryCode",count(*)::int total,
      count(*) FILTER(WHERE logo_assets->>'status'='completed' AND ($1::timestamptz IS NULL OR
        CASE WHEN logo_assets->>'processedAt' ~ '^\\d{4}-\\d{2}-\\d{2}T' THEN (logo_assets->>'processedAt')::timestamptz<$1 ELSE false END))::int "withLogo",
      count(*) FILTER(WHERE COALESCE(tags_raw,'') !~ '^[[:space:]]*$')::int "withTags"
      FROM stations WHERE country_code IS NOT NULL AND country_code NOT IN ('','null')
        AND ($1::timestamptz IS NULL OR created_at<$1) GROUP BY upper(country_code) ORDER BY upper(country_code)`,[endOfDay??null]);
    return rows;
  }
  async earliestStation():Promise<{createdAt:Date}|null>{
    const {rows}=await this.pool.query('SELECT created_at "createdAt" FROM stations ORDER BY created_at ASC LIMIT 1');return rows[0]??null;
  }
  async historicalDayCount(before:Date):Promise<number>{
    const {rows}=await this.pool.query('SELECT count(DISTINCT snapshot_date)::int count FROM coverage_snapshots WHERE snapshot_date<$1',[before]);return rows[0].count;
  }
  async snapshots(input:{since?:Date;date?:Date;countries?:string[]}={}):Promise<any[]>{
    const {rows}=await this.pool.query(`SELECT * FROM coverage_snapshots WHERE ($1::timestamptz IS NULL OR snapshot_date>=$1)
      AND ($2::timestamptz IS NULL OR snapshot_date=$2) AND ($3::text[] IS NULL OR country_code=ANY($3))
      ORDER BY country_code,snapshot_date`,[input.since??null,input.date??null,input.countries?.length?input.countries:null]);return rows.map(shape);
  }
  async writeSnapshots(date:Date,rows:CoverageRow[],source:'cron'|'backfill'):Promise<{inserted:number;preserved:number}>{
    const values=rows.map(r=>({id:id(),...r,logoCoveragePct:r.total>0?Math.round(r.withLogo/r.total*1000)/10:0,tagCoveragePct:r.total>0?Math.round(r.withTags/r.total*1000)/10:0}));
    const result=await this.pool.query(`INSERT INTO coverage_snapshots(id,country_code,snapshot_date,total,with_logo,with_tags,logo_coverage_pct,tag_coverage_pct,source)
      SELECT v.id,v."countryCode",$1,v.total,v."withLogo",v."withTags",v."logoCoveragePct",v."tagCoveragePct",$2
      FROM jsonb_to_recordset($3::jsonb) v(id text,"countryCode" text,total integer,"withLogo" integer,"withTags" integer,"logoCoveragePct" float8,"tagCoveragePct" float8)
      ON CONFLICT(country_code,snapshot_date) ${source==='backfill'?'DO NOTHING':`DO UPDATE SET total=EXCLUDED.total,with_logo=EXCLUDED.with_logo,with_tags=EXCLUDED.with_tags,
        logo_coverage_pct=EXCLUDED.logo_coverage_pct,tag_coverage_pct=EXCLUDED.tag_coverage_pct,source='cron'`} RETURNING id`,[date,source,JSON.stringify(values)]);
    return {inserted:result.rowCount??0,preserved:rows.length-(result.rowCount??0)};
  }
  async recordStatus(outcome:CoverageBackfillBootOutcome,message:string,fields:Record<string,unknown>={},historyMax=20):Promise<void>{
    const names=['startedAt','finishedAt','durationMs','thresholdDays','historicalDayCount','seedDays','daysSeeded','inserted','preserved','error'];
    const columns=names.map(n=>fieldMap[n]??n);const values=[id(),outcome,message,new Date(),...names.map(n=>fields[n]??null)];
    await this.transaction(async client=>{
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('coverage-boot-status',0))");
      await client.query(`INSERT INTO coverage_backfill_status(id,outcome,message,observed_at,${columns.join(',')}) VALUES(${values.map((_,i)=>`$${i+1}`).join(',')})
        ON CONFLICT(key) DO UPDATE SET outcome=EXCLUDED.outcome,message=EXCLUDED.message,observed_at=EXCLUDED.observed_at,
        ${columns.map(c=>`${c}=EXCLUDED.${c}`).join(',')},updated_at=now()`,values);
      if(outcome!=='running'){
        await client.query(`INSERT INTO coverage_backfill_runs(id,outcome,message,observed_at,${columns.join(',')}) VALUES(${values.map((_,i)=>`$${i+1}`).join(',')})`,values);
        await client.query('DELETE FROM coverage_backfill_runs WHERE id IN (SELECT id FROM coverage_backfill_runs ORDER BY observed_at DESC,id DESC OFFSET $1)',[historyMax]);
      }
    });
  }
  async status():Promise<any|null>{return shape((await this.pool.query("SELECT * FROM coverage_backfill_status WHERE key='latest'")).rows[0]);}
  async statusHistory(limit=20):Promise<any[]>{return (await this.pool.query('SELECT * FROM coverage_backfill_runs ORDER BY observed_at DESC,id DESC LIMIT $1',[limit])).rows.map(shape);}
  async createRun(value:Omit<BackfillRun,'_id'>):Promise<BackfillRun>{
    const {rows}=await this.pool.query(`INSERT INTO backfill_runs(id,trigger,status,top_n,override_country,started_at,logos,tags,attempts)
      VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb) RETURNING *`,
      [id(),value.trigger,value.status,value.topN,value.overrideCountry??null,value.startedAt,JSON.stringify(value.logos),JSON.stringify(value.tags),JSON.stringify(value.attempts??[])]);return shape(rows[0]);
  }
  async saveRun(value:BackfillRun):Promise<void>{
    const result=await this.pool.query(`UPDATE backfill_runs SET status=$2,finished_at=$3,duration_ms=$4,logos=$5::jsonb,tags=$6::jsonb,error_message=$7,attempts=$8::jsonb WHERE id=$1`,
      [value._id,value.status,value.finishedAt??null,value.durationMs??null,JSON.stringify(value.logos),JSON.stringify(value.tags),value.errorMessage??null,JSON.stringify(value.attempts??[])]);
    if(result.rowCount!==1)throw new Error('Backfill audit row no longer exists');
  }
  /** Call only while holding the shared station-backfill job lock. */
  async recoverInterruptedRuns():Promise<void>{
    await this.pool.query("UPDATE backfill_runs SET status='failed',finished_at=now(),duration_ms=extract(epoch FROM now()-started_at)*1000,error_message='Worker restarted or lost its PostgreSQL leader connection' WHERE status='running'");
  }
  async run(runId:string):Promise<BackfillRun|null>{return shape((await this.pool.query('SELECT * FROM backfill_runs WHERE id=$1',[runId])).rows[0]);}
  async runs(input:{limit?:number;trigger?:string;country?:string;status?:string;excludeId?:string}={}):Promise<{runs:BackfillRun[];total:number;oldestStartedAt:Date|null}>{
    const cap=Number.isFinite(input.limit)?Math.max(1,Math.min(Math.floor(input.limit!),1000)):20;
    const {rows}=await this.pool.query(`WITH filtered AS MATERIALIZED(SELECT * FROM backfill_runs
      WHERE ($1::text IS NULL OR trigger=$1 OR left(trigger,length($1)+1)=$1||':')
        AND ($2::text IS NULL OR override_country=$2 OR right(trigger,3)=':'||$2 OR logos @> jsonb_build_array(jsonb_build_object('countryCode',$2::text)) OR tags @> jsonb_build_array(jsonb_build_object('countryCode',$2::text)))
        AND ($3::text IS NULL OR status=$3) AND ($4::text IS NULL OR id<>$4))
      SELECT (SELECT count(*)::int FROM filtered) total,(SELECT min(started_at) FROM filtered) oldest,
        COALESCE((SELECT jsonb_agg(to_jsonb(page) ORDER BY started_at DESC,id DESC) FROM (SELECT * FROM filtered ORDER BY started_at DESC,id DESC LIMIT $5) page),'[]'::jsonb) runs`,
      [input.trigger||null,input.country||null,input.status||null,input.excludeId||null,cap]);
    const runs=rows[0].runs.map((r:any)=>shape({...r,started_at:new Date(r.started_at),finished_at:r.finished_at?new Date(r.finished_at):null}));
    return {runs,total:rows[0].total,oldestStartedAt:rows[0].oldest};
  }
  async pruneRuns(days:number,maxRows:number):Promise<{removed:number}>{
    const {rowCount}=await this.pool.query(`DELETE FROM backfill_runs WHERE status<>'running' AND (started_at<now()-$1*interval '1 day' OR id IN (
      SELECT id FROM backfill_runs WHERE status<>'running' ORDER BY started_at DESC,id DESC OFFSET $2))`,[days,maxRows]);return {removed:rowCount??0};
  }
  async retentionPreview(days:number,maxRows:number):Promise<{total:number;kept:number;removed:number;percent:number}>{
    const {rows}=await this.pool.query(`SELECT count(*)::int total,count(*) FILTER(WHERE status<>'running' AND (started_at<now()-$1*interval '1 day' OR id IN (
      SELECT id FROM backfill_runs WHERE status<>'running' ORDER BY started_at DESC,id DESC OFFSET $2)))::int removed FROM backfill_runs`,[days,maxRows]);
    const {total,removed}=rows[0];return {total,removed,kept:total-removed,percent:total>0?removed/total:0};
  }
  async alerts(limit=1,before?:string):Promise<any[]>{
    const {rows}=await this.pool.query(`SELECT created_at,message,data FROM user_notifications WHERE type='system' AND data->>'kind'='coverage_drop'
      AND ($1::text IS NULL OR data->>'snapshotDate'<$1) ORDER BY data->>'snapshotDate' DESC,created_at DESC,id DESC LIMIT $2`,[before||null,limit]);return rows.map(shape);
  }
  async enqueueLogos(filter:Record<string,unknown>,sampleLimit:number|null):Promise<{candidates:number;enqueued:number;sampleStations:BackfillSampleStation[]}>{
    const compiled=compileCatalogFilter(filter);const values=[...compiled.values,sampleLimit];
    const {rows}=await this.pool.query(`WITH selected AS MATERIALIZED(SELECT s.id,s.slug,s.name FROM stations s WHERE ${compiled.sql} FOR UPDATE),
      changed AS (UPDATE stations s SET logo_assets=NULL,source=source-'logoAssets',updated_at=now() FROM selected c WHERE s.id=c.id RETURNING s.id)
      SELECT (SELECT count(*)::int FROM selected) candidates,(SELECT count(*)::int FROM changed) enqueued,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('_id',id,'slug',slug,'name',name)) FROM (SELECT * FROM selected ORDER BY id LIMIT $${values.length}) sample),'[]'::jsonb) samples`,values);
    return {candidates:rows[0].candidates,enqueued:rows[0].enqueued,sampleStations:rows[0].samples};
  }
  /** A dedicated session lock excludes overlapping replicas; callers check health between phases. */
  async acquireJob(name:string):Promise<{assertOwned:()=>void;release:()=>Promise<void>}|null>{
    const client=await this.coordinationPool.connect();let failure:Error|null=null;
    const onError=(error:Error)=>{failure=error;};client.on('error',onError);
    try{
      const {rows}=await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) acquired',['radiohub:'+name]);
      if(!rows[0].acquired){client.off('error',onError);client.release();return null;}
      let released=false;
      return {assertOwned:()=>{if(failure)throw failure;if(released)throw new Error('Coverage worker lock released');},release:async()=>{
        if(released)return;released=true;
        try{if(!failure)await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',['radiohub:'+name]);}
        catch(error){failure=error instanceof Error?error:new Error(String(error));throw error;}
        finally{client.off('error',onError);client.release(Boolean(failure));}
      }};
    }catch(error){client.off('error',onError);client.release(true);throw error;}
  }
}
export const pgCoverage=()=>new PostgresCoverageStore(getPostgresPool(),getPostgresCoordinationPool());
