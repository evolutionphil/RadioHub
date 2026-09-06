import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { Server } from 'node:http';
import express from 'express';
import pg from 'pg';

const connectionString = process.env.PG_TEST_DATABASE_URL;
describe('Native PostgreSQL translation admin, genre merge and favorites', {skip: !connectionString}, async () => {
  if (!connectionString) return;
  const schema = `translation_test_${process.pid}_${randomBytes(6).toString('hex')}`;
  const admin = new pg.Pool({connectionString, ssl:false, max:1});
  const url = new URL(connectionString); url.searchParams.set('options', `-c search_path=${schema},public`);
  process.env.DATABASE_URL=url.toString(); process.env.POSTGRES_SSL='disable';
  const {getPostgresPool,closePostgres}=await import('../src/postgres-runtime'); const pool=getPostgresPool();
  const {pgCatalog}=await import('../src/data/postgres-catalog-store');
  const genres=await import('../src/data/postgres-genre-admin-store');
  const store=await import('../src/data/postgres-translation-admin-store');
  const users=await import('../src/data/postgres-user-store');
  let created=false,server:Server|undefined,base='';
  const adminHeaders={'x-offline-admin':'allowed','Content-Type':'application/json'};
  before(async()=>{
    await admin.query(`CREATE SCHEMA "${schema}"`);created=true;
    const dir=path.resolve(import.meta.dirname,'../../../lib/db/migrations');
    for(const file of(await readdir(dir)).filter(file=>/^\d+.*\.sql$/.test(file)).sort()) await pool.query(await readFile(path.join(dir,file),'utf8'));
    const {registerTranslationAdminRoutes}=await import('../src/routes/translation-admin-routes');
    const app=express();app.use(express.json());
    app.use((req:any,_res,next)=>{if(req.headers['x-offline-user'])req.session={userId:req.headers['x-offline-user']};next();});
    const requireAdmin=(req:any,res:any,next:any)=>req.headers['x-offline-admin']==='allowed'?next():res.status(401).json({error:'unauthorized'});
    registerTranslationAdminRoutes(app,{requireAdmin,requireAuth:requireAdmin});
    server=await new Promise<Server>(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener));});
    base=`http://127.0.0.1:${(server.address() as any).port}`;
  });
  after(async()=>{
    if(server)await new Promise<void>((resolve,reject)=>server!.close(error=>error?reject(error):resolve()));
    await closePostgres();
    try{if(created){assert.match(schema,/^translation_test_\d+_[a-f0-9]{12}$/);await admin.query(`DROP SCHEMA "${schema}" CASCADE`);}}
    finally{await admin.end();}
  });
  const station=async(name:string,extra:Record<string,any>={})=>(await pgCatalog().insertMany([{
    _id:randomBytes(12).toString('hex'),stationuuid:randomUUID(),name,slug:`test-${randomBytes(5).toString('hex')}`,
    url:`https://stream.example.invalid/${randomUUID()}`,country:'Germany',language:'German',codec:'MP3',tags:'Pop',votes:3,...extra,
  }]))[0];
  const fixture=async()=>{
    const winner=`winner-${randomUUID()}`,demoted=`demoted-${randomUUID()}`;
    await pool.query(`INSERT INTO genres(id,name,slug,is_discoverable,source) VALUES
      ($1,'Rhythm & Blues',$3,true,'{}'),($2,'R+B',null,false,$4)`,[winner,demoted,`rhythm-${randomUUID()}`,JSON.stringify({cleanupDemotion:{reason:'collision',collisionWinnerId:winner}})]);
    const attached=await station('Attached',{genre:' r+b ',tags:' r+b ,Rhythm & Blues,Rock, rock '});
    const unrelated=await station('Unrelated',{genre:'R+B Rock',tags:'R+B Rock,Pop'});
    return {winner,demoted,attached,unrelated};
  };
  it('matches escaped whole tags in preview and serializes concurrent merge retries with one durable audit',async()=>{
    const f=await fixture();
    const preview=await fetch(`${base}/api/admin/genres/${f.demoted}/merge-preview?targetGenreId=${f.winner}`,{headers:adminHeaders});
    assert.equal(preview.status,200);const body=await preview.json() as any;assert.equal(body.stationsMatched,1);assert.equal(body.sampleStations[0]._id,f.attached._id);
    const attempts=await Promise.allSettled(Array.from({length:8},()=>genres.pgMergeDemotedGenre(f.demoted,undefined,{email:'admin@example.invalid'})));
    assert.equal(attempts.filter(result=>result.status==='fulfilled').length,1);
    for(const result of attempts)if(result.status==='rejected')assert.equal(result.reason.statusCode,404);
    const changed=await pgCatalog().findById(f.attached._id);assert.equal(changed!.genre,'Rhythm & Blues');assert.equal(changed!.tags,'Rhythm & Blues,Rock');
    assert.equal((await pgCatalog().findById(f.unrelated._id))!.tags,'R+B Rock,Pop');
    assert.deepEqual((await pool.query('SELECT genre_slug FROM station_genres WHERE station_id=$1 ORDER BY position',[f.attached._id])).rows.map(row=>row.genre_slug),['rhythm-blues','rock']);
    assert.equal(await genres.pgStoredGenreById(f.demoted),null);
    const audit=await genres.pgGenreMergeAuditList({genre:'R+B',actorEmail:'ADMIN@'});assert.equal(audit.total,1);assert.equal(audit.entries[0].stationsRetagged,1);
    assert.equal(audit.entries[0].winnerGenreId,f.winner);assert.equal(audit.entries[0].targetSource,'auto-recorded');
  });
  it('rolls back station retags, relations and deletion if durable audit cannot commit',async()=>{
    const f=await fixture();const before=await pgCatalog().findById(f.attached._id);
    await pool.query(`CREATE FUNCTION reject_genre_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'offline audit failure'; END $$;
      CREATE TRIGGER reject_genre_audit BEFORE INSERT ON genre_merge_audit_logs FOR EACH ROW EXECUTE FUNCTION reject_genre_audit()`);
    try{await assert.rejects(genres.pgMergeDemotedGenre(f.demoted,f.winner),/offline audit failure/);}
    finally{await pool.query('DROP TRIGGER reject_genre_audit ON genre_merge_audit_logs; DROP FUNCTION reject_genre_audit()');}
    assert.ok(await genres.pgStoredGenreById(f.demoted));assert.deepEqual(await pgCatalog().findById(f.attached._id),before);
    const result=await genres.pgMergeDemotedGenre(f.demoted,f.winner);assert.equal(result.success,true);
  });
  it('serves filtered, paginated audit and rejects invalid/self merge targets',async()=>{
    const response=await fetch(`${base}/api/admin/genres/merge-audit-log?limit=1&targetSource=manual&genre=R%2BB`,{headers:adminHeaders});
    assert.equal(response.status,200);const body=await response.json() as any;assert.equal(body.entries.length,1);assert.equal(body.entries[0].targetSource,'manual');assert.ok(body.entries[0].id);
    const f=await fixture();await assert.rejects(genres.pgMergeDemotedGenre(f.demoted,f.demoted),error=>(error as any).statusCode===400);
    await assert.rejects(genres.pgMergeDemotedGenre(f.demoted,'missing'),error=>(error as any).statusCode===409);assert.ok(await genres.pgStoredGenreById(f.demoted));
  });
  it('keeps the explicitly selected station, applies approved fields and moves favorite relations',async()=>{
    const primary=await station('Primary',{votes:1}),duplicate=await station('Different Name',{votes:99});
    const user=await store.pgAdminAddFavorites('manual-merge@example.invalid',[duplicate._id]);
    const response=await fetch(`${base}/api/admin/stations/merge`,{method:'POST',headers:adminHeaders,body:JSON.stringify({primaryStationId:primary._id,duplicateStationIds:[duplicate._id,'missing'],mergeData:{name:'Admin Title'}})});
    assert.equal(response.status,200);const body=await response.json() as any;assert.equal(body.mergedStation._id,primary._id);assert.equal(body.mergedStation.name,'Admin Title');
    assert.equal(await pgCatalog().findById(duplicate._id),null);assert.deepEqual(await store.pgFavoriteIds(user._id),[primary._id]);
  });
  it('atomically upserts favorite fixtures without lost additions and rejects nonexistent station IDs',async()=>{
    const a=await station('Favorite A'),b=await station('Favorite B');
    const results=await Promise.all(Array.from({length:12},(_,i)=>store.pgAdminAddFavorites('parallel@example.invalid',[i%2?a._id:b._id])));
    assert.equal(new Set(results.map(user=>user._id)).size,1);assert.deepEqual(new Set(await store.pgFavoriteIds(results[0]._id)),new Set([a._id,b._id]));
    await assert.rejects(store.pgAdminAddFavorites('invalid@example.invalid',[a._id,'missing']),error=>(error as any).statusCode===400);
    assert.equal(await users.pgFindUserByEmail('invalid@example.invalid'),null);
  });
  it('protects admin fixture operations and checks favorites privacy before serving cached public results',async()=>{
    for(const endpoint of ['make-user-public','add-favorites','update-user-name'])assert.equal((await fetch(`${base}/api/test/${endpoint}`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);
    assert.equal((await fetch(`${base}/api/test/user-status/parallel@example.invalid`)).status,401);
    const user=await users.pgFindUserByEmail('parallel@example.invalid');
    const endpoint=`${base}/api/users/${user._id}/favorites?page=1&limit=1&fields=name,country,unknown`;
    const response=await fetch(endpoint);assert.equal(response.status,200);const body=await response.json() as any;
    assert.equal(body.pagination.total,2);assert.equal(body.stations.length,1);assert.deepEqual(Object.keys(body.stations[0]).sort(),['_id','country','favoritedAt','name']);
    await users.pgUpdateUser(user._id,{isPublicProfile:false});assert.equal((await fetch(endpoint)).status,404);
    assert.equal((await fetch(endpoint,{headers:{'x-offline-user':user._id}})).status,200);
  });
  it('reads real facets, related genres and analytics rather than fabricating sample rows',async()=>{
    for(let i=0;i<5;i++)await station(`Facet ${i}`,{tags:'Jazz,Soul,radio',genre:'Jazz',country:'Turkey',votes:10+i,language:'Turkish',codec:'AAC'});
    const stats=await store.pgGenreLandingCountries('Jazz');assert.equal(stats[0].name,'Turkey');assert.equal(stats[0].count,5);assert.equal(stats[0].avgVotes,12);
    assert.deepEqual((await store.pgGenreLandingRelated('Jazz')).map(row=>row.name),['Soul']);
    const languages=await (await fetch(`${base}/api/languages`)).json() as any[];assert.equal(languages.find(row=>row.name==='Turkish').stationCount,5);
    assert.equal((await fetch(`${base}/api/analytics`)).status,401);
    assert.deepEqual(await(await fetch(`${base}/api/analytics`,{headers:adminHeaders})).json(),[]);
    await pool.query("INSERT INTO analytics_events(id,event,station_id,source) VALUES('real-event','play',$1,$2)",['historical-id',JSON.stringify({metadata:{duration:12},ip:'127.0.0.1'})]);
    const events=await(await fetch(`${base}/api/analytics?event=play&limit=1`,{headers:adminHeaders})).json() as any[];assert.equal(events[0]._id,'real-event');assert.equal(events[0].metadata.duration,12);
    assert.equal((await fetch(`${base}/api/analytics?startDate=invalid`,{headers:adminHeaders})).status,400);
  });
  it('requests durable cancellation without pretending that the running sync has stopped',async()=>{
    await pool.query("INSERT INTO catalog_sync_runs(id,sync_type,status) VALUES('active-sync','full','running')");
    const response=await fetch(`${base}/api/sync/stop`,{method:'POST',headers:adminHeaders});assert.equal(response.status,202);
    const row=(await pool.query("SELECT status,cancel_requested FROM catalog_sync_runs WHERE id='active-sync'")).rows[0];assert.equal(row.status,'running');assert.equal(row.cancel_requested,true);
  });
  it('rejects flush while another worker owns import leadership and rolls back the complete flush on failure',async()=>{
    const leader=await pool.connect();await leader.query("SELECT pg_advisory_lock(hashtext('radiohub-provider-sync'))");
    try{await assert.rejects(store.pgFlushStationData(),error=>(error as any).statusCode===409);}
    finally{await leader.query("SELECT pg_advisory_unlock(hashtext('radiohub-provider-sync'))");leader.release();}
    await pool.query("INSERT INTO station_blacklist(id,url,name) VALUES('protected','https://example.invalid','Protected')");
    const before=await pgCatalog().count();
    await pool.query(`CREATE FUNCTION reject_flush() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'offline flush failure'; END $$;
      CREATE TRIGGER reject_flush BEFORE DELETE ON station_blacklist FOR EACH ROW EXECUTE FUNCTION reject_flush()`);
    try{await assert.rejects(store.pgFlushStationData(),/offline flush failure/);}
    finally{await pool.query('DROP TRIGGER reject_flush ON station_blacklist; DROP FUNCTION reject_flush()');}
    assert.equal(await pgCatalog().count(),before);assert.equal((await pool.query('SELECT count(*)::int count FROM catalog_sync_runs')).rows[0].count,1);
    const result=await store.pgFlushStationData();assert.equal(result.deletedStations,before);assert.ok(result.deletedBlacklisted>=1);assert.equal(result.deletedSyncLogs,1);
    assert.equal(await pgCatalog().count(),0);assert.equal((await pool.query('SELECT count(*)::int count FROM user_favorites')).rows[0].count,0);
  });
});
