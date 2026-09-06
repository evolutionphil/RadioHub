import { randomBytes } from 'node:crypto';
import { getPostgresPool } from '../postgres-runtime';
import { seoShape,seoTransaction } from './postgres-seo-indexing-store';
import { normalizeGenreSlug,SAFE_GENRE_SLUG_RE } from '../seo/genre-slug';

const newId=()=>randomBytes(12).toString('hex');
const fail=(statusCode:number,message:string):never=>{throw Object.assign(new Error(message),{statusCode});};
const shape=(row:any):any=>row?{...row.source,...seoShape(row)}:null;
export async function pgStoredGenreById(id:string):Promise<any|null>{return shape((await getPostgresPool().query('SELECT * FROM genres WHERE id=$1',[id])).rows[0]);}
export async function pgListAdminGenres(search='',demotedOnly=false,sort='stationCount',limit=50,offset=0):Promise<{rows:any[];total:number}> {
  const where="($1='' OR name~*$1) AND (NOT $2 OR source#>>'{cleanupDemotion,reason}' IN ('empty-slug','collision'))";
  const order=sort==='name'?'name ASC':sort==='recent'?'created_at DESC':sort==='demotedAt'?"source#>>'{cleanupDemotion,demotedAt}' DESC NULLS LAST":'station_count DESC';
  const [rows,count]=await Promise.all([
    getPostgresPool().query(`SELECT * FROM genres WHERE ${where} ORDER BY ${order},id LIMIT $3 OFFSET $4`,[search,demotedOnly,Math.max(1,Math.min(500,limit)),Math.max(0,offset)]),
    getPostgresPool().query(`SELECT count(*)::int total FROM genres WHERE ${where}`,[search,demotedOnly]),
  ]);return {rows:rows.rows.map(shape),total:count.rows[0].total};
}
export async function pgUpsertPopulatedGenre(input:Record<string,any>):Promise<void> {
  if(!input.name||!SAFE_GENRE_SLUG_RE.test(input.slug))throw new Error('Invalid genre name or slug');
  await getPostgresPool().query(`INSERT INTO genres(id,name,slug,is_discoverable,station_count,source) VALUES($1,$2,$3,$4,$5,$6)
    ON CONFLICT(slug) DO UPDATE SET station_count=EXCLUDED.station_count,updated_at=now(),
      source=genres.source||jsonb_build_object('stationCount',EXCLUDED.station_count,'updatedAt',now())`,
    [newId(),input.name,input.slug,input.isDiscoverable??true,input.stationCount||0,JSON.stringify(input)]);
}
export function genreAttachmentFilter(name:string):Record<string,any> {
  const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  return {$or:[{tags:{$regex:new RegExp(`(^|,)\\s*${escaped}\\s*(,|$)`,'i')}},{genre:{$regex:new RegExp(`^\\s*${escaped}\\s*$`,'i')}}]};
}
/** Re-tagging, normalized relations, survivor counts, audit and deletion are one atomic commit. */
export async function pgMergeDemotedGenre(id:string,targetGenreId:string|undefined,actor:{userId?:string|null;email?:string|null}={}):Promise<any> {
  return seoTransaction(async client=>{
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('genre-admin-merge',0))");
    const demoted=shape((await client.query('SELECT * FROM genres WHERE id=$1 FOR UPDATE',[id])).rows[0]);
    if(!demoted)fail(404,'Demoted genre not found');
    const demotion=demoted.cleanupDemotion;
    if(!demotion)fail(400,'Genre is not a slug-cleanup demoted row');
    const winnerId=targetGenreId||demotion.collisionWinnerId;
    if(!winnerId)fail(400,'No target genre supplied and this demoted row has no recorded winner — pick a target genre to merge into.');
    if(String(winnerId)===id)fail(400,'Cannot merge a demoted genre into itself');
    const winner=shape((await client.query('SELECT * FROM genres WHERE id=$1 FOR UPDATE',[String(winnerId)])).rows[0]);
    if(!winner)fail(409,targetGenreId?'Picked target genre no longer exists; cannot merge':'Recorded collision winner no longer exists; cannot merge');
    const demotedName=String(demoted.name||'').trim(),winnerName=String(winner.name||'').trim();
    if(!demotedName||!winnerName)fail(409,'Demoted or winner genre is missing a usable name; cannot merge');
    const predicate="lower(regexp_replace(source->>'genre','^[[:space:]]+|[[:space:]]+$','','g'))=lower($1) OR EXISTS(SELECT 1 FROM unnest(string_to_array(tags_raw,',')) part WHERE lower(regexp_replace(part,'^[[:space:]]+|[[:space:]]+$','','g'))=lower($1))";
    const stations=(await client.query(`SELECT id,slug,tags_raw,source FROM stations WHERE ${predicate} ORDER BY id FOR UPDATE`,[demotedName])).rows;
    let stationsRetagged=0;const changedSlugs:string[]=[];
    for(const station of stations){
      const patch:Record<string,any>={},source=station.source||{};const demotedLower=demotedName.toLowerCase();
      if(typeof source.genre==='string'&&source.genre.trim().toLowerCase()===demotedLower&&source.genre!==winnerName)patch.genre=winnerName;
      const parts=typeof station.tags_raw==='string'?station.tags_raw.split(',').map((tag:string)=>tag.trim()).filter(Boolean):[];
      const seen=new Set<string>(),tags:string[]=[];let changed=false;
      for(const tag of parts){const value=tag.toLowerCase()===demotedLower?winnerName:tag;if(value!==tag)changed=true;
        if(seen.has(value.toLowerCase()))changed=true;else{seen.add(value.toLowerCase());tags.push(value);}}
      if(changed)patch.tags=tags.join(',');
      if(!Object.keys(patch).length)continue;
      await client.query('UPDATE stations SET tags_raw=$2,source=source||$3::jsonb WHERE id=$1',[station.id,patch.tags??station.tags_raw,JSON.stringify(patch)]);
      if(patch.tags!==undefined){
        const normalized=[...new Set(tags.map(tag=>tag.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,160)).filter(Boolean))];
        await client.query('DELETE FROM station_genres WHERE station_id=$1',[station.id]);
        for(const [position,slug] of normalized.entries())await client.query('INSERT INTO station_genres(station_id,genre_slug,position) VALUES($1,$2,$3)',[station.id,slug,position]);
      }
      stationsRetagged++;if(station.slug)changedSlugs.push(station.slug);
    }
    const count=(await client.query(`SELECT count(*)::int count FROM stations WHERE ${predicate}`,[winnerName])).rows[0].count;
    await client.query("UPDATE genres SET station_count=$2,source=source||jsonb_build_object('stationCount',$2::integer) WHERE id=$1",[winner._id,count]);
    await client.query(`INSERT INTO genre_merge_audit_logs(id,demoted_genre_id,demoted_genre_name,demoted_genre_slug,winner_genre_id,winner_genre_name,winner_genre_slug,
      target_source,stations_matched,stations_retagged,actor_user_id,actor_email) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [newId(),demoted._id,demotedName,demoted.slug||'',winner._id,winnerName,winner.slug||'',targetGenreId?'manual':'auto-recorded',stations.length,stationsRetagged,actor.userId||null,actor.email||null]);
    await client.query('DELETE FROM genres WHERE id=$1',[demoted._id]);
    return {success:true,demotedGenreId:String(demoted._id),demotedGenreName:demotedName,winnerGenreId:String(winner._id),winnerGenreName:winnerName,
      stationsMatched:stations.length,stationsRetagged,changedSlugs};
  });
}
export async function pgPruneGenreMergeAudit():Promise<void> {
  await getPostgresPool().query("DELETE FROM genre_merge_audit_logs WHERE created_at<now()-interval '180 days' OR id IN (SELECT id FROM genre_merge_audit_logs ORDER BY created_at DESC,id DESC OFFSET 1000)");
}
export async function pgGenreMergeAuditList(filter:{targetSource?:string;actorEmail?:string;genre?:string;from?:Date;to?:Date},limit=50,offset=0):Promise<{entries:any[];total:number}> {
  const where=`created_at>=now()-interval '180 days' AND ($1::text IS NULL OR target_source=$1) AND ($2='' OR position(lower($2) in lower(COALESCE(actor_email,'')))>0)
    AND ($3='' OR position(lower($3) in lower(demoted_genre_name||' '||demoted_genre_slug||' '||winner_genre_name||' '||winner_genre_slug))>0)
    AND ($4::timestamptz IS NULL OR created_at>=$4) AND ($5::timestamptz IS NULL OR created_at<=$5)`;
  const values=[filter.targetSource&&filter.targetSource!=='all'?filter.targetSource:null,filter.actorEmail||'',filter.genre||'',filter.from||null,filter.to||null];
  const [rows,count]=await Promise.all([
    getPostgresPool().query(`SELECT * FROM genre_merge_audit_logs WHERE ${where} ORDER BY created_at DESC,id DESC LIMIT $6 OFFSET $7`,[...values,Math.max(1,Math.min(200,limit)),Math.max(0,offset)]),
    getPostgresPool().query(`SELECT count(*)::int total FROM genre_merge_audit_logs WHERE ${where}`,values),
  ]);return {entries:rows.rows.map(seoShape),total:count.rows[0].total};
}
