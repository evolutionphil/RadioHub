import { randomBytes, randomInt } from "node:crypto";
import type pg from "pg";
import { getPostgresPool } from "../postgres-runtime";

export type CastCommand = 'play'|'pause'|'resume'|'stop'|'change_station'|'volume_up'|'volume_down'|'set_volume';
export const castCommands = new Set(['play','pause','resume','stop','change_station','volume_up','volume_down','set_volume']);
function shape(row: any): any {
  if (!row) return null;
  return {_id:row.id,sessionId:row.session_id,pairingCode:row.pairing_code,userId:row.user_id,mobileDeviceId:row.mobile_device_id,
    tvDeviceId:row.tv_device_id,status:row.expires_at<=new Date() ? 'expired':row.status,currentStation:row.current_station,
    isPlaying:row.is_playing,createdAt:row.created_at,pairedAt:row.paired_at,expiresAt:row.expires_at,lastActivityAt:row.last_activity_at};
}
async function tx<T>(operation:(client:pg.PoolClient)=>Promise<T>):Promise<T> {
  const client=await getPostgresPool().connect();
  try {await client.query('BEGIN');const result=await operation(client);await client.query('COMMIT');return result;}
  catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error;} finally{client.release();}
}
async function station(client:pg.PoolClient,stationId:string):Promise<any> {
  const row=(await client.query(`SELECT id,name,slug,COALESCE(NULLIF(url_resolved,''),url) stream_url,favicon FROM stations WHERE id=$1`,[stationId])).rows[0];
  return row?{stationId:row.id,name:row.name,slug:row.slug,streamUrl:row.stream_url,favicon:row.favicon}:null;
}
export async function createCastSession(userId:string,mobileDeviceId?:string,tvDeviceId?:string,stationId?:string):Promise<any> {
  return tx(async(client)=>{
    await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE",[userId]);
    if(tvDeviceId){
      const device=await client.query("UPDATE user_devices SET last_seen_at=now() WHERE user_id=$1 AND device_id=$2 AND is_active=true RETURNING id",[userId,tvDeviceId]);
      if(!device.rowCount)return null;
    }
    await client.query("UPDATE cast_sessions SET status='expired' WHERE user_id=$1 AND status IN ('waiting_for_pair','paired')",[userId]);
    await client.query("UPDATE cast_sessions SET status='expired' WHERE status='waiting_for_pair' AND expires_at<=now()");
    const currentStation=stationId?await station(client,stationId):null;
    if(stationId&&!currentStation)throw new Error('Station not found');
    for(let attempt=0;attempt<30;attempt++){
      const result=await client.query(`INSERT INTO cast_sessions(id,session_id,pairing_code,user_id,mobile_device_id,tv_device_id,status,current_station,is_playing,paired_at,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,CASE WHEN $6::text IS NULL THEN NULL ELSE now() END,now()+interval '24 hours')
        ON CONFLICT DO NOTHING RETURNING *`,[randomBytes(12).toString('hex'),`cast_${randomBytes(16).toString('hex')}`,
        tvDeviceId?null:String(randomInt(100000,1000000)),userId,mobileDeviceId||null,tvDeviceId||null,tvDeviceId?'active':'waiting_for_pair',
        currentStation?JSON.stringify(currentStation):null,!!currentStation]);
      if(result.rowCount)return shape(result.rows[0]);
    }
    throw new Error('Unable to allocate pairing code');
  });
}
export async function pairCastSession(pairingCode:string,tvDeviceId:string):Promise<any> {
  return shape((await getPostgresPool().query(`UPDATE cast_sessions SET tv_device_id=$2,status='paired',paired_at=now(),last_activity_at=now()
    WHERE pairing_code=$1 AND status='waiting_for_pair' AND expires_at>now() RETURNING *`,[pairingCode,tvDeviceId])).rows[0]);
}
export async function getCastSession(sessionId:string,userId?:string):Promise<any> {
  return shape((await getPostgresPool().query("SELECT * FROM cast_sessions WHERE session_id=$1 AND ($2::text IS NULL OR user_id=$2) AND expires_at>now() AND status<>'expired'",[sessionId,userId||null])).rows[0]);
}
export async function listCastSessions(userId:string):Promise<any[]> {
  return(await getPostgresPool().query("SELECT * FROM cast_sessions WHERE user_id=$1 AND expires_at>now() AND status<>'expired' ORDER BY created_at DESC",[userId])).rows.map(shape);
}
export async function expireCastSessions(userId:string,sessionId?:string):Promise<number> {
  return(await getPostgresPool().query("UPDATE cast_sessions SET status='expired',is_playing=false WHERE user_id=$1 AND ($2::text IS NULL OR session_id=$2) RETURNING id",[userId,sessionId||null])).rowCount||0;
}
export async function applyCastCommand(sessionId:string,userId:string,command:CastCommand,data:any,fromRole:'mobile'|'tv'='mobile'):Promise<any> {
  if(!castCommands.has(command))return null;
  return tx(async(client)=>{
    const row=(await client.query("SELECT * FROM cast_sessions WHERE session_id=$1 AND user_id=$2 AND status IN ('paired','active') AND expires_at>now() FOR UPDATE",[sessionId,userId])).rows[0];
    if(!row)return null;
    let currentStation=row.current_station, playing=row.is_playing,status=row.status;
    if(command==='play'||command==='change_station'){
      if(data?.stationId){currentStation=await station(client,data.stationId);if(!currentStation)return null;}
      playing=true;status='active';
    }else if(command==='resume')playing=true;
    else if(command==='pause')playing=false;
    else if(command==='stop'){playing=false;currentStation=null;}
    const updated=shape((await client.query("UPDATE cast_sessions SET current_station=$2,is_playing=$3,status=$4,last_activity_at=now() WHERE id=$1 RETURNING *",[row.id,currentStation?JSON.stringify(currentStation):null,playing,status])).rows[0]);
    const deliveries:any[]=[{role:fromRole==='mobile'?'tv':'mobile',message:{type:`cast:${command}`,sessionId,data:command==='play'||command==='change_station'?{station:updated.currentStation}:data}}];
    if(fromRole==='mobile')deliveries.push({role:'mobile',message:{type:'cast:command_ack',sessionId,command}});
    await insertCastEvent(client,sessionId,{deliveries});
    return updated;
  });
}
export async function publishCastEvent(sessionId:string,payload:any):Promise<void>{
  await tx(async(client)=>insertCastEvent(client,sessionId,payload));
}
async function insertCastEvent(client:pg.PoolClient,sessionId:string,payload:any):Promise<void>{
    const result=await client.query("INSERT INTO cast_events(session_id,payload) VALUES($1,$2) RETURNING id",[sessionId,JSON.stringify(payload)]);
    await client.query("SELECT pg_notify('radiohub_cast_events',json_build_object('schema',current_schema(),'id',$1::text)::text)",[String(result.rows[0].id)]);
}
