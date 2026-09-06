import { randomBytes } from 'node:crypto';
import type { Pool,PoolClient } from 'pg';
import { getPostgresPool } from '../postgres-runtime';
import { normalizeGenreSlug,SAFE_GENRE_SLUG_RE } from '../seo/genre-slug';
import { GENRE_WHITELIST_SEED,GENRE_ALIASES_SEED } from '../seo/genre-whitelist-seed';

export interface GenreSlugCleanupStats {scanned:number;alreadyValid:number;normalized:number;markedUndiscoverable:number;emptySlugMarked:number;collisionMarked:number;errors:number}
export interface DuplicateGenreSlugCleanupStats {scanned:number;duplicateGroups:number;winnersKept:number;losersDemoted:number;errors:number}
export interface GenreSlugCleanupRun {
  _id:string;trigger:string;status:'running'|'completed'|'failed';startedAt:Date;finishedAt?:Date;durationMs?:number;
  scanned:number;alreadyValid:number;normalized:number;markedUndiscoverable:number;emptySlugMarked:number;collisionMarked:number;
  errorCount:number;rewarmed:boolean;errorMessage?:string;
}
export const emptyGenreCleanupStats=():GenreSlugCleanupStats=>({scanned:0,alreadyValid:0,normalized:0,markedUndiscoverable:0,emptySlugMarked:0,collisionMarked:0,errors:0});
const fields:Record<string,string>={startedAt:'started_at',finishedAt:'finished_at',durationMs:'duration_ms',alreadyValid:'already_valid',markedUndiscoverable:'marked_undiscoverable',emptySlugMarked:'empty_slug_marked',collisionMarked:'collision_marked',errorCount:'error_count',errorMessage:'error_message'};
function shape(row:any):GenreSlugCleanupRun|null {
  if(!row)return null;const result={...row,_id:row.id};delete result.id;
  for(const [key,column] of Object.entries(fields)){if(Object.hasOwn(result,column)){result[key]=result[column]??undefined;delete result[column];}}
  return result;
}
export class PostgresGenreCleanupStore {
  constructor(private readonly pool:Pool){}
  private async transaction<T>(work:(client:PoolClient)=>Promise<T>):Promise<T>{
    const client=await this.pool.connect();try{await client.query('BEGIN');const result=await work(client);await client.query('COMMIT');return result;}
    catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
  async createRun(trigger:string):Promise<GenreSlugCleanupRun>{
    const {rows}=await this.pool.query("INSERT INTO genre_slug_cleanup_runs(id,trigger,status,started_at) VALUES($1,$2,'running',now()) RETURNING *",[randomBytes(12).toString('hex'),trigger]);return shape(rows[0])!;
  }
  async saveRun(run:GenreSlugCleanupRun):Promise<void>{
    const names=['status','finishedAt','durationMs','scanned','alreadyValid','normalized','markedUndiscoverable','emptySlugMarked','collisionMarked','errorCount','rewarmed','errorMessage'] as const;
    const result=await this.pool.query(`UPDATE genre_slug_cleanup_runs SET ${names.map((n,i)=>`${fields[n]??n}=$${i+2}`).join(',')} WHERE id=$1`,[run._id,...names.map(n=>run[n]??null)]);
    if(result.rowCount!==1)throw new Error('Genre cleanup audit row no longer exists');
  }
  async recoverInterruptedRuns():Promise<void>{
    await this.pool.query("UPDATE genre_slug_cleanup_runs SET status='failed',finished_at=now(),duration_ms=extract(epoch FROM now()-started_at)*1000,error_count=greatest(error_count,1),error_message='Worker restarted or lost its PostgreSQL leader connection' WHERE status='running'");
  }
  async run(id:string):Promise<GenreSlugCleanupRun|null>{return shape((await this.pool.query('SELECT * FROM genre_slug_cleanup_runs WHERE id=$1',[id])).rows[0]);}
  async runs(input:{limit?:number;trigger?:string}={}):Promise<{runs:GenreSlugCleanupRun[];total:number;oldestStartedAt:Date|null}>{
    const {rows}=await this.pool.query(`WITH filtered AS(SELECT * FROM genre_slug_cleanup_runs WHERE $1::text IS NULL OR trigger=$1 OR starts_with(trigger,$1||':')),
      page AS(SELECT * FROM filtered ORDER BY started_at DESC,id DESC LIMIT $2)
      SELECT (SELECT count(*)::int FROM filtered) total,(SELECT min(started_at) FROM filtered) oldest,
      COALESCE((SELECT jsonb_agg(to_jsonb(page) ORDER BY started_at DESC,id DESC) FROM page),'[]'::jsonb) runs`,[input.trigger??null,input.limit??20]);
    return {total:rows[0].total,oldestStartedAt:rows[0].oldest,runs:rows[0].runs.map((r:any)=>shape({...r,started_at:new Date(r.started_at),finished_at:r.finished_at?new Date(r.finished_at):null})!)};
  }
  async prune(days:number,maxRows:number):Promise<{removed:number}>{
    const result=await this.pool.query(`DELETE FROM genre_slug_cleanup_runs WHERE status<>'running' AND (started_at<now()-make_interval(days=>$1)
      OR id IN(SELECT id FROM genre_slug_cleanup_runs WHERE status<>'running' ORDER BY started_at DESC,id DESC OFFSET $2))`,[days,maxRows]);return {removed:result.rowCount??0};
  }
  async demotions(input:{since?:Date;until?:Date;limit?:number}={}):Promise<any[]>{
    const {rows}=await this.pool.query(`WITH demoted AS(SELECT id,name,slug,source->'cleanupDemotion' d FROM genres WHERE source->'cleanupDemotion'->>'demotedAt' ~ '^\\d{4}-\\d{2}-\\d{2}T')
      SELECT id "_id",name,slug "currentSlug",d->>'reason' reason,d->>'originalSlug' "originalSlug",d->>'normalizedSlug' "normalizedSlug",
      d->>'collisionWinnerId' "collisionWinnerId",d->>'collisionWinnerSlug' "collisionWinnerSlug",d->>'collisionWinnerName' "collisionWinnerName",(d->>'demotedAt')::timestamptz "demotedAt"
      FROM demoted WHERE ($1::timestamptz IS NULL OR (d->>'demotedAt')::timestamptz >=$1) AND ($2::timestamptz IS NULL OR (d->>'demotedAt')::timestamptz <=$2)
      ORDER BY (d->>'demotedAt')::timestamptz ASC,id LIMIT $3`,[input.since??null,input.until??null,input.limit??500]);return rows;
  }
  /** One transaction/table lock serializes cleanup with every genre writer, including offline repair. */
  async cleanupMalformed(dryRun=false,log:(m:string)=>void=()=>{},assertOwned:()=>void=()=>{}):Promise<GenreSlugCleanupStats>{
    return this.transaction(async client=>{
      await client.query('LOCK TABLE genres IN SHARE ROW EXCLUSIVE MODE');assertOwned();
      const {rows}=await client.query('SELECT id,name,slug,is_discoverable,source FROM genres ORDER BY id FOR UPDATE');
      const owners=new Map(rows.filter(r=>typeof r.slug==='string').map(r=>[r.slug,r]));const stats=emptyGenreCleanupStats();const now=new Date();
      for(const row of rows){
        assertOwned();stats.scanned++;
        if(typeof row.slug==='string'&&SAFE_GENRE_SLUG_RE.test(row.slug)){stats.alreadyValid++;continue;}
        const normalized=normalizeGenreSlug(row.slug);const winner=normalized?owners.get(normalized):null;
        if(!normalized||winner&&winner.id!==row.id){
          stats.markedUndiscoverable++;if(normalized)stats.collisionMarked++;else stats.emptySlugMarked++;
          const demotion={reason:normalized?'collision':'empty-slug',originalSlug:row.slug??'',normalizedSlug:normalized,
            ...(winner?{collisionWinnerId:winner.id,collisionWinnerSlug:winner.slug,collisionWinnerName:winner.name}:{}),demotedAt:now};
          log(`Genre ${row.id}: ${demotion.reason}; keeping forensic metadata and hiding from discovery`);
          if(!dryRun)await client.query(`UPDATE genres SET is_discoverable=false,updated_at=$2,source=source||jsonb_build_object('isDiscoverable',false,'updatedAt',$2::timestamptz,'cleanupDemotion',$3::jsonb) WHERE id=$1`,[row.id,now,JSON.stringify(demotion)]);
        }else{
          log(`Genre ${row.id}: ${JSON.stringify(row.slug)} -> ${normalized}`);stats.normalized++;
          if(!dryRun){
            await client.query(`UPDATE genres SET slug=$2,updated_at=$3,source=source||jsonb_build_object('slug',$2::text,'updatedAt',$3::timestamptz) WHERE id=$1`,[row.id,normalized,now]);
            if(row.slug)await client.query(`INSERT INTO station_genres(station_id,genre_slug,position,created_at) SELECT station_id,$2,position,created_at FROM station_genres WHERE genre_slug=$1 ON CONFLICT DO NOTHING`,[row.slug,normalized]);
            if(row.slug)await client.query('DELETE FROM station_genres WHERE genre_slug=$1',[row.slug]);
          }
          owners.delete(row.slug);row.slug=normalized;owners.set(normalized,row);
        }
      }
      assertOwned();return stats;
    });
  }
  async cleanupDuplicates(dryRun=false,log:(m:string)=>void=()=>{},assertOwned:()=>void=()=>{}):Promise<DuplicateGenreSlugCleanupStats>{
    return this.transaction(async client=>{
      await client.query('LOCK TABLE genres IN SHARE ROW EXCLUSIVE MODE');assertOwned();
      const {rows}=await client.query(`SELECT * FROM genres WHERE slug IS NOT NULL AND slug<>'' AND slug IN(SELECT slug FROM genres GROUP BY slug HAVING count(*)>1)
        ORDER BY slug,station_count DESC,is_discoverable DESC,created_at ASC NULLS LAST,id ASC FOR UPDATE`);
      const groups=new Map<string,any[]>();for(const row of rows){const group=groups.get(row.slug)??[];group.push(row);groups.set(row.slug,group);}
      const stats:DuplicateGenreSlugCleanupStats={scanned:rows.length,duplicateGroups:groups.size,winnersKept:groups.size,losersDemoted:0,errors:0};const now=new Date();
      for(const [slug,group] of groups){const [winner,...losers]=group;for(const loser of losers){
        assertOwned();log(`Genre ${loser.id}: duplicate ${slug}; canonical winner ${winner.id}`);if(dryRun)continue;
        const demotion={reason:'collision',originalSlug:slug,normalizedSlug:slug,collisionWinnerId:winner.id,collisionWinnerSlug:slug,collisionWinnerName:winner.name,demotedAt:now};
        await client.query(`UPDATE genres SET slug=NULL,is_discoverable=false,updated_at=$2,source=(source-'slug')||jsonb_build_object('isDiscoverable',false,'updatedAt',$2::timestamptz,'cleanupDemotion',$3::jsonb) WHERE id=$1`,[loser.id,now,JSON.stringify(demotion)]);stats.losersDemoted++;
      }}assertOwned();return stats;
    });
  }
  /** Classify and delete against one locked whitelist/genre snapshot; never race an admin allow-list edit. */
  async cleanupJunk(dryRun=false):Promise<{total:number;kept:number;deleted:number;unslugged:number;dryRun:boolean}>{
    return this.transaction(async client=>{
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('genre-whitelist',0))");
      await client.query('LOCK TABLE genres IN SHARE ROW EXCLUSIVE MODE');
      const overrides=(await client.query('SELECT kind,slug,canonical FROM genre_whitelist_overrides ORDER BY kind,slug')).rows;
      const allowed=new Set(GENRE_WHITELIST_SEED),aliases=new Map(GENRE_ALIASES_SEED);
      for(const row of overrides){
        if(row.kind==='slug-add')allowed.add(row.slug);
        if(row.kind==='slug-remove')allowed.delete(row.slug);
        if(row.kind==='alias-add'&&row.canonical)aliases.set(row.slug,row.canonical);
        if(row.kind==='alias-remove')aliases.delete(row.slug);
      }
      for(const [slug,canonical] of aliases)if(!allowed.has(canonical))aliases.delete(slug);
      const rows=(await client.query('SELECT id,name,slug FROM genres ORDER BY id FOR UPDATE')).rows;
      const report={total:rows.length,kept:0,deleted:0,unslugged:0,dryRun};const ids:string[]=[];
      for(const row of rows){
        const slug=(row.slug?.trim()||row.name?.trim()||'').toLowerCase().replace(/\s+/g,'-');
        if(allowed.has(slug)||aliases.has(slug)){report.kept++;continue;}
        if(!slug)report.unslugged++;ids.push(row.id);
      }
      if(dryRun)report.deleted=ids.length;
      else if(ids.length)report.deleted=(await client.query('DELETE FROM genres WHERE id=ANY($1::text[])',[ids])).rowCount??0;
      return report;
    });
  }
}
export const pgGenreCleanup=()=>new PostgresGenreCleanupStore(getPostgresPool());
