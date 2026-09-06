/**
 * Bounded SQL transport fixture for the actual PostgreSQL genre-admin store.
 * Business rules (merge guards, rewriting, deduplication, audit values and
 * transactions) execute in production code, not a reimplemented mock store.
 * PostgreSQL syntax/locking is covered by postgres-translation-admin.integration.test.ts.
 * Unknown statements fail, so a store change cannot quietly bypass coverage.
 */
export function genreAdminPgFixture(state:{genres:()=>any[];stations:()=>any[];audits:()=>any[];upsert?:(payload:any)=>void}){
  let rollback:{genres:any[];stations:any[];audits:any[]}|null=null;
  let failAudit=false;
  const statements:Array<{sql:string;values:any[]}>=[];
  const row=(value:any)=>({id:value._id,name:value.name,slug:value.slug,is_discoverable:value.isDiscoverable??true,station_count:value.stationCount??0,
    source:{...value},created_at:value.createdAt,updated_at:value.updatedAt});
  const auditRow=(value:any)=>Object.fromEntries(Object.entries(value).map(([key,value])=>[key==='_id'?'id':key.replace(/[A-Z]/g,c=>'_'+c.toLowerCase()),value]));
  const attachment=(station:any,name:string)=>station.genre?.trim().toLowerCase()===name.toLowerCase()||typeof station.tags==='string'&&station.tags.split(',').some((tag:string)=>tag.trim().toLowerCase()===name.toLowerCase());
  const result=(rows:any[]=[],rowCount=rows.length)=>({rows,rowCount});
  const query=async(rawSql:string,values:any[]=[]):Promise<any>=>{
    const sql=rawSql.replace(/\s+/g,' ').trim();statements.push({sql,values});
    if(sql==='BEGIN'){rollback=structuredClone({genres:state.genres(),stations:state.stations(),audits:state.audits()});return result();}
    if(sql==='COMMIT'){rollback=null;return result();}
    if(sql==='ROLLBACK'){if(rollback){for(const key of ['genres','stations','audits'] as const)state[key]().splice(0,Infinity,...rollback[key]);rollback=null;}return result();}
    if(sql.startsWith('SELECT pg_advisory_xact_lock('))return result();
    if(sql.startsWith('SELECT normalized.tag,count(*)::int count FROM stations s CROSS JOIN LATERAL (')){
      const counts=new Map<string,number>();
      for(const station of state.stations()){
        const raw=typeof station.tags==='string'?station.tags.split(','):[];
        if(typeof station.genre==='string')raw.push(station.genre);
        for(const tag of new Set(raw.map((tag:string)=>tag.trim().toLowerCase()).filter((tag:string)=>tag.length>0&&tag.length<50)))counts.set(tag,(counts.get(tag)||0)+1);
      }
      return result([...counts].sort(([a],[b])=>a.localeCompare(b)).map(([tag,count])=>({tag,count})));
    }
    if(sql.startsWith('SELECT * FROM genres WHERE id=$1'))return result(state.genres().filter(g=>g._id===values[0]).map(row));
    if(sql.startsWith('SELECT * FROM genres WHERE (')||sql.startsWith('SELECT count(*)::int total FROM genres WHERE (')){
      const [search,demotedOnly,limit,offset]=values;
      const rows=state.genres().filter(g=>(!search||new RegExp(search,'i').test(g.name))&&(!demotedOnly||['empty-slug','collision'].includes(g.cleanupDemotion?.reason)));
      if(sql.startsWith('SELECT count'))return result([{total:rows.length}]);
      rows.sort((a,b)=>{
        let av:any,bv:any,direction=1;
        if(sql.includes('ORDER BY name ASC')){av=a.name;bv=b.name;}
        else if(sql.includes('ORDER BY created_at DESC')){av=a.createdAt;bv=b.createdAt;direction=-1;}
        else if(sql.includes("ORDER BY source#>>'{cleanupDemotion,demotedAt}' DESC")){av=a.cleanupDemotion?.demotedAt;bv=b.cleanupDemotion?.demotedAt;direction=-1;}
        else{av=a.stationCount??0;bv=b.stationCount??0;direction=-1;}
        if(av==null&&bv!=null)return 1;if(bv==null&&av!=null)return -1;
        return av<bv?-direction:av>bv?direction:String(a._id).localeCompare(String(b._id));
      });return result(rows.slice(offset,offset+limit).map(row));
    }
    if(sql.startsWith('INSERT INTO genres(')){
      const [id,name,slug,isDiscoverable,stationCount,source]=values;
      const payload=JSON.parse(source);state.upsert?.(payload);
      const existing=state.genres().find(g=>g.slug===slug);
      if(existing){
        if(!sql.includes('DO UPDATE SET station_count=EXCLUDED.station_count,updated_at=now()'))throw new Error('Genre population must preserve curated fields on conflict');
        Object.assign(existing,{stationCount,updatedAt:new Date()});
      }
      else state.genres().push({_id:id,...payload,name,slug,isDiscoverable,stationCount});return result([],1);
    }
    if(sql.startsWith('SELECT id,slug,tags_raw,source FROM stations WHERE '))return result(state.stations().filter(s=>attachment(s,values[0])).sort((a,b)=>a._id.localeCompare(b._id)).map(s=>({id:s._id,slug:s.slug,tags_raw:s.tags,source:{...s}})));
    if(sql.startsWith('SELECT count(*)::int count FROM stations WHERE '))return result([{count:state.stations().filter(s=>attachment(s,values[0])).length}]);
    if(sql.startsWith('UPDATE stations SET tags_raw=$2,source=source||$3::jsonb WHERE id=$1')){
      const station=state.stations().find(s=>s._id===values[0]);if(station)Object.assign(station,{tags:values[1]},JSON.parse(values[2]));return result([],station?1:0);
    }
    if(sql.startsWith('DELETE FROM station_genres WHERE station_id=$1')||sql.startsWith('INSERT INTO station_genres(station_id,genre_slug,position)'))return result([],1);
    if(sql.startsWith('UPDATE genres SET station_count=$2')){const genre=state.genres().find(g=>g._id===values[0]);if(genre)genre.stationCount=values[1];return result([],genre?1:0);}
    if(sql.startsWith('INSERT INTO genre_merge_audit_logs(')){
      if(failAudit)throw new Error('injected PostgreSQL audit failure');
      const keys=['_id','demotedGenreId','demotedGenreName','demotedGenreSlug','winnerGenreId','winnerGenreName','winnerGenreSlug','targetSource','stationsMatched','stationsRetagged','actorUserId','actorEmail'];
      state.audits().push({...Object.fromEntries(keys.map((key,i)=>[key,values[i]])),createdAt:new Date()});return result([],1);
    }
    if(sql==='DELETE FROM genres WHERE id=$1'){const index=state.genres().findIndex(g=>g._id===values[0]);if(index>=0)state.genres().splice(index,1);return result([],index>=0?1:0);}
    if(sql.startsWith('DELETE FROM genre_merge_audit_logs WHERE created_at<now()')){
      const sorted=[...state.audits()].sort((a,b)=>b.createdAt.getTime()-a.createdAt.getTime()||String(b._id).localeCompare(String(a._id)));
      const keep=sorted.slice(0,1000).filter(r=>r.createdAt.getTime()>=Date.now()-180*86400000);const removed=state.audits().length-keep.length;
      state.audits().splice(0,Infinity,...keep);return result([],removed);
    }
    if(sql.startsWith('SELECT * FROM genre_merge_audit_logs WHERE ')||sql.startsWith('SELECT count(*)::int total FROM genre_merge_audit_logs WHERE ')){
      const [source,email,genre,from,to,limit,offset]=values;
      const rows=state.audits().filter(r=>r.createdAt.getTime()>=Date.now()-180*86400000&&(!source||r.targetSource===source)&&(!email||String(r.actorEmail??'').toLowerCase().includes(email.toLowerCase()))
        &&(!genre||[r.demotedGenreName,r.demotedGenreSlug,r.winnerGenreName,r.winnerGenreSlug].join(' ').toLowerCase().includes(genre.toLowerCase()))&&(!from||r.createdAt>=from)&&(!to||r.createdAt<=to));
      if(sql.startsWith('SELECT count'))return result([{total:rows.length}]);
      return result(rows.sort((a,b)=>b.createdAt-a.createdAt||String(b._id).localeCompare(String(a._id))).slice(offset,offset+limit).map(auditRow));
    }
    throw new Error(`Unrecognized native genre fixture SQL: ${sql}`);
  };
  const matches=(station:any,filter:any):boolean=>Object.entries(filter).every(([key,condition]:[string,any])=>{
    if(key==='$or')return condition.some((entry:any)=>matches(station,entry));
    if(condition?.$regex)return condition.$regex.test(station[key]??'');
    if(condition?.$exists!==undefined&&(station[key]!==undefined)!==condition.$exists)return false;
    if(condition?.$nin)return !condition.$nin.includes(station[key]);
    return true;
  });
  const catalog={
    count:async(filter:any={})=>state.stations().filter(s=>matches(s,filter)).length,
    find:async(filter:any={},options:any={})=>{
      const rows=state.stations().filter(s=>matches(s,filter));
      if(options.sort)for(const [key,direction] of Object.entries(options.sort))rows.sort((a,b)=>String(a[key]??'').localeCompare(String(b[key]??''))*(direction as number));
      return rows.slice(options.offset??0,options.limit===undefined?undefined:(options.offset??0)+options.limit).map(r=>({...r}));
    },
  };
  return {pool:{query,connect:async()=>({query,release:()=>{}})},catalog,statements,setAuditFailure:(value:boolean)=>{failAudit=value;}};
}
