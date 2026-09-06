import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { WebSocket } from 'ws';
import { applyCastCommand, castCommands, createCastSession, expireCastSessions, getCastSession, listCastSessions, pairCastSession, publishCastEvent } from '../data/postgres-cast-store';
import { getPostgresPool, getPostgresCoordinationPool } from '../postgres-runtime';
import { logger } from '../utils/logger';

interface CastClient { socket: WebSocket; sessionId: string; role: 'mobile'|'tv'; userId: string; deviceId?: string }
export type CastCommand = 'play'|'pause'|'resume'|'stop'|'change_station'|'volume_up'|'volume_down'|'set_volume';
export interface CastCommandPayload { sessionId: string; command: CastCommand; data?: { stationId?: string; volume?: number } }

/** WebSockets are process-local; commands and peer presence are coordinated by PostgreSQL. */
export class CastService {
  private readonly nodeId = randomUUID();
  private clients = new Map<string,CastClient>();
  private listener: pg.PoolClient|null = null;
  private starting: Promise<void>|null = null;
  private heartbeat: ReturnType<typeof setInterval>|null = null;
  private deliveryQueue: Promise<void> = Promise.resolve();

  async start(): Promise<void> {
    if(this.listener)return;
    if(this.starting)return this.starting;
    this.starting=(async()=>{
      const client=await getPostgresCoordinationPool().connect();
      try {
        const schema=(await client.query('SELECT current_schema() name')).rows[0].name;
        client.on('notification', notification=>{
          if(notification.channel!=='radiohub_cast_events')return;
          let notice:{schema:string;id:string};
          try{notice=JSON.parse(notification.payload||'');}catch{return;}
          if(notice.schema!==schema||!/^\d+$/.test(String(notice.id)))return;
          // Preserve notification commit order, including non-commutative volume commands.
          this.deliveryQueue=this.deliveryQueue.then(async()=>{
            const row=(await getPostgresPool().query('SELECT session_id,payload FROM cast_events WHERE id=$1',[notice.id])).rows[0];
            if(row)this.deliver(row.session_id,row.payload);
          }).catch(error=>this.failConnections(error));
        });
        client.on('error',error=>{
          if(this.listener===client){this.listener=null;client.release(true);this.failConnections(error);}
        });
        await client.query('LISTEN radiohub_cast_events');
        this.listener=client;
        if(!this.heartbeat){
          this.heartbeat=setInterval(()=>{
            void getPostgresPool().query("UPDATE cast_connections SET expires_at=now()+interval '45 seconds' WHERE node_id=$1",[this.nodeId])
              .catch(error=>this.failConnections(error));
          },15000);
          this.heartbeat.unref();
        }
      }catch(error){client.release(true);throw error;}
    })();
    try{await this.starting;}finally{this.starting=null;}
  }

  private failConnections(error:unknown):void {
    logger.error('Cast coordination connection failed:',error);
    // A dropped LISTEN channel cannot safely acknowledge delivery. Reconnecting
    // clients receive the current durable session state instead of silent loss.
    for(const [id,client] of this.clients){try{client.socket.close(1012,'Reconnect cast session');}catch{}this.removeClient(id);}
  }

  async close():Promise<void>{
    if(this.heartbeat){clearInterval(this.heartbeat);this.heartbeat=null;}
    for(const client of this.clients.values())try{client.socket.close(1001,'Server shutting down');}catch{}
    this.clients.clear();
    await this.deliveryQueue;
    await getPostgresPool().query('DELETE FROM cast_connections WHERE node_id=$1',[this.nodeId]);
    const client=this.listener;this.listener=null;
    if(client){try{await client.query('UNLISTEN radiohub_cast_events');client.release();}catch{client.release(true);}}
  }

  private deliver(sessionId:string,payload:any):void{
    for(const delivery of payload.deliveries||[]){
      for(const [id,client] of this.clients){
        if(delivery.deviceId){if(client.role!=='tv'||client.deviceId!==delivery.deviceId||client.userId!==delivery.userId)continue;}
        else if(client.sessionId!==sessionId||(delivery.role&&client.role!==delivery.role))continue;
        this.sendToClient(id,delivery.message);
      }
    }
  }

  async createSession(userId:string,mobileDeviceId?:string):Promise<{sessionId:string;pairingCode:string}>{
    const {sessionId,pairingCode}=await createCastSession(userId,mobileDeviceId);
    return {sessionId,pairingCode};
  }
  async pairSession(pairingCode:string,tvDeviceId:string,_tvUserId?:string):Promise<{sessionId:string;userId:string}|null>{
    const session=await pairCastSession(pairingCode,tvDeviceId);
    if(!session)return null;
    await publishCastEvent(session.sessionId,{deliveries:[{role:'mobile',message:{type:'cast:paired',sessionId:session.sessionId,tvDeviceId}}]});
    return {sessionId:session.sessionId,userId:session.userId};
  }
  async sendCommand(sessionId:string,command:CastCommand,data?:any,fromRole?:'mobile'|'tv',userId?:string):Promise<boolean>{
    if(!userId||!castCommands.has(command)||(fromRole!=='mobile'&&fromRole!=='tv'))return false;
    return !!await applyCastCommand(sessionId,userId,command,data,fromRole);
  }
  async getSessionStatus(sessionId:string,userId?:string):Promise<any>{
    const session=await getCastSession(sessionId,userId);if(!session)return null;
    const presence=(await getPostgresPool().query('SELECT role FROM cast_connections WHERE session_id=$1 AND expires_at>now()',[sessionId])).rows;
    return {sessionId:session.sessionId,status:session.status,isPlaying:session.isPlaying,currentStation:session.currentStation,
      mobileConnected:presence.some(row=>row.role==='mobile'),tvConnected:presence.some(row=>row.role==='tv'),
      createdAt:session.createdAt,pairedAt:session.pairedAt,expiresAt:session.expiresAt};
  }
  async endSession(sessionId:string,userId?:string):Promise<boolean>{
    const session=await getCastSession(sessionId,userId);if(!session)return false;
    await expireCastSessions(session.userId,sessionId);
    await publishCastEvent(sessionId,{deliveries:[{message:{type:'cast:session_ended',sessionId}}]});return true;
  }
  async createDirectSession(userId:string,tvDeviceId:string,stationId?:string):Promise<{sessionId:string}|null>{
    const session=await createCastSession(userId,'direct',tvDeviceId,stationId);if(!session)return null;
    await publishCastEvent(session.sessionId,{deliveries:[{deviceId:tvDeviceId,userId,message:{type:'cast:direct_session',sessionId:session.sessionId,currentStation:session.currentStation,isPlaying:!!stationId}}]});
    return {sessionId:session.sessionId};
  }
  async getUserActiveSessions(userId:string):Promise<any[]>{
    return(await listCastSessions(userId)).map(s=>({sessionId:s.sessionId,pairingCode:s.status==='waiting_for_pair'?s.pairingCode:undefined,
      status:s.status,isPlaying:s.isPlaying,currentStation:s.currentStation,tvDeviceId:s.tvDeviceId,createdAt:s.createdAt,expiresAt:s.expiresAt}));
  }
  async registerClient(clientId:string,socket:WebSocket,sessionId:string,role:'mobile'|'tv',userId:string,deviceId?:string):Promise<void>{
    await this.start();
    await getPostgresPool().query(`INSERT INTO cast_connections(connection_id,node_id,session_id,user_id,device_id,role,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,now()+interval '45 seconds')`,[clientId,this.nodeId,sessionId,userId,deviceId||null,role]);
    this.clients.set(clientId,{socket,sessionId,role,userId,deviceId});
    await publishCastEvent(sessionId,{deliveries:[{role:role==='mobile'?'tv':'mobile',message:{type:'cast:peer_connected',sessionId,peerRole:role}}]});
  }
  removeClient(clientId:string):void{
    const client=this.clients.get(clientId);if(!client)return;this.clients.delete(clientId);
    void getPostgresPool().query('DELETE FROM cast_connections WHERE connection_id=$1 AND node_id=$2',[clientId,this.nodeId]).catch(error=>logger.warn('Cast presence cleanup:',error));
    void publishCastEvent(client.sessionId,{deliveries:[{role:client.role==='mobile'?'tv':'mobile',message:{type:'cast:peer_disconnected',sessionId:client.sessionId,peerRole:client.role}}]}).catch(error=>logger.warn('Cast disconnect event:',error));
  }
  private sendToClient(clientId:string,message:any):void{
    const client=this.clients.get(clientId);if(!client||client.socket.readyState!==WebSocket.OPEN)return;
    if(client.socket.bufferedAmount>2*1024*1024){try{client.socket.close(1013,'slow consumer');}catch{}this.removeClient(clientId);return;}
    try{client.socket.send(JSON.stringify(message));}catch{}
  }
  async handleNowPlaying(sessionId:string,nowPlaying:any,userId?:string):Promise<void>{
    if(!userId||!await getCastSession(sessionId,userId))return;
    await publishCastEvent(sessionId,{deliveries:[{role:'mobile',message:{type:'cast:now_playing',sessionId,data:nowPlaying}}]});
  }
}
export const castService=new CastService();
