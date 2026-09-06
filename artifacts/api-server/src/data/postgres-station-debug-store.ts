import { randomBytes } from 'node:crypto';
import { getPostgresPool } from '../postgres-runtime';
import { seoShape, seoTransaction } from './postgres-seo-indexing-store';

export type StationDebugFilter = { stationId?: string; errorType?: string; isResolved?: boolean; before?: Date };

function shape(row:any):any {
  const out=seoShape(row);
  if(out){out.clientIP=row.client_ip;delete out.clientIp;}
  return out;
}

/** A transaction-scoped group lock protects both initial creation and concurrent reporter/count merges. */
export async function pgReportStationDebugLog(input:Record<string,any>, detailsPatch:Record<string,any> = {}):Promise<{row:any;created:boolean}> {
  return seoTransaction(async client=>{
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`station-debug:${JSON.stringify([input.stationId,input.errorType])}`]);
    const existing=(await client.query(`SELECT * FROM station_debug_logs WHERE station_id=$1 AND error_type=$2
      AND timestamp>=now()-interval '24 hours' ORDER BY timestamp DESC,id DESC LIMIT 1 FOR UPDATE`,[input.stationId,input.errorType])).rows[0];
    if(existing){
      const reporters=existing.reporting_users as any[];
      if(!reporters.some(user=>user.userAgent===input.userAgent&&user.clientIP===input.clientIP)) {
        reporters.push({userAgent:input.userAgent,clientIP:input.clientIP,timestamp:new Date()});
      }
      const total=existing.total_occurrences+1;
      const details={...existing.error_details,...detailsPatch,occurrenceCount:total};
      const row=(await client.query(`UPDATE station_debug_logs SET reporting_users=$2,unique_user_count=$3,total_occurrences=$4,error_details=$5 WHERE id=$1 RETURNING *`,
        [existing.id,JSON.stringify(reporters),reporters.length,total,JSON.stringify(details)])).rows[0];
      return {row:shape(row),created:false};
    }
    const row=(await client.query(`INSERT INTO station_debug_logs(id,station_id,station_name,station_url,error_type,error_message,error_details,station_meta,
      user_agent,client_ip,timestamp,is_resolved,reporting_users,unique_user_count,total_occurrences,server_logs)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now(),false,$11,1,1,$12) RETURNING *`,
      [randomBytes(12).toString('hex'),input.stationId,input.stationName,input.stationUrl,input.errorType,input.errorMessage,
        JSON.stringify({...input.errorDetails,occurrenceCount:1}),JSON.stringify(input.stationMeta||{}),input.userAgent,input.clientIP,
        JSON.stringify([{userAgent:input.userAgent,clientIP:input.clientIP,timestamp:new Date()}]),input.serverLogs||[]])).rows[0];
    return {row:shape(row),created:true};
  });
}

function queryFilter(filter:StationDebugFilter):{sql:string;values:any[]} {
  return {sql:'($1::text IS NULL OR station_id=$1) AND ($2::text IS NULL OR error_type=$2) AND ($3::boolean IS NULL OR is_resolved=$3) AND ($4::timestamptz IS NULL OR timestamp<$4)',
    values:[filter.stationId||null,filter.errorType||null,filter.isResolved??null,filter.before||null]};
}
export async function pgCountStationDebugLogs(filter:StationDebugFilter = {}):Promise<number> {
  const {sql,values}=queryFilter(filter);
  return (await getPostgresPool().query(`SELECT count(*)::int count FROM station_debug_logs WHERE ${sql}`,values)).rows[0].count;
}
export async function pgListStationDebugLogs(filter:StationDebugFilter = {},limit=50,offset=0):Promise<{errors:any[];total:number}> {
  const {sql,values}=queryFilter(filter);
  const [rows,total]=await Promise.all([
    getPostgresPool().query(`SELECT * FROM station_debug_logs WHERE ${sql} ORDER BY timestamp DESC,id DESC LIMIT $5 OFFSET $6`,
      [...values,Math.max(1,Math.min(500,Math.trunc(limit)||50)),Math.max(0,Math.trunc(offset)||0)]),pgCountStationDebugLogs(filter),
  ]);
  return {errors:rows.rows.map(shape),total};
}
export async function pgPurgeStationDebugLogs(cutoff:Date):Promise<{deletedCount:number}> {
  if(!(cutoff instanceof Date)||!Number.isFinite(cutoff.getTime()))throw new Error('A valid station-debug retention cutoff is required');
  return {deletedCount:(await getPostgresPool().query('DELETE FROM station_debug_logs WHERE timestamp<$1',[cutoff])).rowCount||0};
}
