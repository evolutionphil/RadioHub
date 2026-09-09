import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile,readdir } from 'node:fs/promises';
import path from 'node:path';
import { after,before,describe,it,mock } from 'node:test';
import type { Server } from 'node:http';
import express from 'express';
import pg from 'pg';

const connectionString = process.env.PG_TEST_DATABASE_URL;
describe('Native PostgreSQL admin catalog HTTP contracts',{ skip:!connectionString },()=>{
  const schema = `admin_catalog_${process.pid}_${randomBytes(6).toString('hex')}`;
  const admin = new pg.Pool({ connectionString,ssl:process.env.PG_TEST_SSL==='require'?{rejectUnauthorized:true}:false,max:1 });
  const originalEnv = { DATABASE_URL:process.env.DATABASE_URL,POSTGRES_SSL:process.env.POSTGRES_SSL,REDIS_URL:process.env.REDIS_URL,POSTGRES_POOL_MAX:process.env.POSTGRES_POOL_MAX };
  let pool:pg.Pool,server:Server,base:string,created=false;
  let runtime: typeof import('../src/postgres-runtime');
  let catalog: import('../src/data/postgres-catalog-store').PostgresCatalogStore;
  before(async()=>{
    await admin.query(`CREATE SCHEMA "${schema}"`);created=true;
    const url = new URL(connectionString!);url.searchParams.set('options',`-c search_path=${schema},public`);
    process.env.DATABASE_URL=url.toString();process.env.POSTGRES_SSL=process.env.PG_TEST_SSL==='require'?'require':'disable';process.env.REDIS_URL='';
    process.env.POSTGRES_POOL_MAX='1';
    runtime = await import('../src/postgres-runtime');pool=runtime.getPostgresPool();
    const dir=path.resolve(import.meta.dirname,'../../../lib/db/migrations');
    for(const file of (await readdir(dir)).filter(file=>/^\d+.*\.sql$/.test(file)).sort()) await pool.query(await readFile(path.join(dir,file),'utf8'));
    mock.module('../src/services/admin-audit-email',{ namedExports:{ emailBlacklistChangesCsv:async()=>undefined } });
    const { registerAdminStationRoutes }=await import('../src/routes/admin-station-routes');
    const { registerAdminPreferencesRoutes }=await import('../src/routes/admin-preferences-routes');
    const { registerSemrushAdminRoutes }=await import('../src/routes/semrush-admin-routes');
    const { requireAuth }=await import('../src/middleware/auth');
    catalog=(await import('../src/data/postgres-catalog-store')).pgCatalog();
    const app=express();app.use(express.json());
    app.use((req:any,_res,next)=>{ req.session={ adminAuth:{ username:String(req.headers['x-admin'] || ''),role:'admin' },...(req.headers['x-user']?{user:{userId:String(req.headers['x-user'])}}:{}) };next(); });
    const requireAdmin=(req:any,res:any,next:any)=>req.headers['x-admin']?next():res.status(401).json({error:'Admin authentication required'});
    const deps={requireAdmin,requireAuth};
    registerAdminStationRoutes(app,deps);registerAdminPreferencesRoutes(app,deps);registerSemrushAdminRoutes(app,deps);
    app.get('/test/native-auth',requireAuth,(req:any,res)=>res.json({id:req.user._id,status:req.user.status}));
    server=await new Promise<Server>(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener));});
    base='http://127.0.0.1:'+(server.address() as any).port;
  });
  after(async()=>{
    if(server) await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    if(runtime) await runtime.closePostgres();
    try { if(created){assert.match(schema,/^admin_catalog_\d+_[a-f0-9]{12}$/);await admin.query(`DROP SCHEMA "${schema}" CASCADE`);} }
    finally{await admin.end();for(const [key,value] of Object.entries(originalEnv))if(value===undefined)delete process.env[key];else process.env[key]=value;}
  });
  async function request(route:string,method='GET',body?:unknown,actor:string|null='alice'){
    return fetch(base+route,{method,headers:{...(actor?{'x-admin':actor}:{}),...(body===undefined?{}:{'content-type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
  }
  const ids=['a'.repeat(24),'b'.repeat(24),'c'.repeat(24)];
  it('keeps data queries available with a one-client pool while session coordination is held',async()=>{
    const leader=await runtime.getPostgresCoordinationPool().connect();
    try {
      await leader.query("SELECT pg_advisory_lock(hashtext('test-small-pool'))");
      assert.equal((await pool.query('SELECT 1 AS value')).rows[0].value,1);
    }finally{await leader.query("SELECT pg_advisory_unlock(hashtext('test-small-pool'))");leader.release();}
  });
  it('combines admin search, country, descriptions and logo filters without broadening OR clauses',async()=>{
    await catalog.insertMany([
      {_id:ids[0],stationuuid:'admin-a',name:'Target One',country:'Germany',countryCode:'DE',url:'https://example.invalid/a',descriptions:{}},
      {_id:ids[1],stationuuid:'admin-b',name:'Target Two',country:'Germany',countryCode:'DE',url:'https://example.invalid/b',descriptions:{en:{full:'Description'}},logoAssets:{status:'completed',webp256:'https://example.invalid/b.webp'}},
      {_id:ids[2],stationuuid:'admin-c',name:'Unrelated',country:'Turkey',countryCode:'TR',url:'https://example.invalid/c',descriptions:{}},
    ]);
    assert.equal((await request('/api/admin/stations','GET',undefined,null)).status,401);
    const response=await request('/api/admin/stations?search=Target&country=DE&hasLogo=no&hasDescriptions=no&limit=invalid&page=-1');
    assert.equal(response.status,200);const body:any=await response.json();
    assert.equal(body.total,1);assert.equal(body.page,1);assert.equal(body.totalPages,1);assert.equal(body.stations[0]._id,ids[0]);
    const noMatch:any=await (await request('/api/admin/stations?search=Unrelated&country=DE')).json();assert.equal(noMatch.total,0);
  });
  it('returns atomic edited station data and protects manual values from subsequent provider sync',async()=>{
    const response=await request('/api/stations/'+ids[0],'PUT',{name:'Manual Edit',language:'de'});
    assert.equal(response.status,200);const body:any=await response.json();assert.equal(body.station.name,'Manual Edit');
    assert.equal(body.station.manualEditFields.name,true);assert.equal(body.station.manualEditFields.language,true);
    await catalog.updateProviderBatch([{uuid:'admin-a',patch:{name:'Provider',language:'en'}}]);
    assert.equal((await catalog.findById(ids[0]))?.name,'Manual Edit');
    assert.equal((await request('/api/admin/bulk-import-stations','POST',{stations:[]})).status,400);
    assert.equal(await catalog.count(),3);
  });
  it('public batch omits unhealthy stations while admin retains them and compact fields stay bounded', async()=>{
    await pool.query('UPDATE stations SET last_check_ok=false WHERE id=$1',[ids[0]]);
    const publicBatch:any = await (await request('/api/stations/batch','POST',{stationIds:ids},null)).json();
    assert.deepEqual(Object.keys(publicBatch).sort(),ids.slice(1).sort());
    const compact:any = await (await request('/api/stations/batch','POST',{stationIds:ids,slim:true},null)).json();
    assert.deepEqual(Object.keys(compact).sort(),ids.slice(1).sort());
    assert.equal(compact[ids[1]].lastCheckOk,true);
    assert.equal(Object.hasOwn(compact[ids[1]],'descriptions'),false);
    assert.equal(Object.hasOwn(publicBatch[ids[1]],'descriptions'),true);
    const retained:any = await (await request('/api/admin/stations?search=Manual%20Edit')).json();
    assert.equal(retained.stations[0]._id,ids[0]); assert.equal(retained.stations[0].lastCheckOk,false);
    assert.equal((await request('/api/stations/batch','POST',{stationIds:[{}]},null)).status,400);
    await pool.query('UPDATE stations SET last_check_ok=true WHERE id=$1',[ids[0]]);
  });
  it('persists preferences per admin and enforces preset ownership over HTTP',async()=>{
    assert.equal((await request('/api/admin/preferences/view','PUT',{value:{country:'DE'}})).status,200);
    const other:any=await (await request('/api/admin/preferences/view','GET',undefined,'bob')).json();assert.equal(other.value,null);
    const presetResponse=await request('/api/admin/shared-presets','POST',{name:'Team A',countries:['de','tr']});assert.equal(presetResponse.status,201);
    const preset:any=await presetResponse.json();assert.deepEqual(preset.countries,['DE','TR']);
    assert.equal((await request('/api/admin/shared-presets/'+preset.id,'PUT',{name:'Stolen'},'bob')).status,403);
    assert.equal((await request('/api/admin/shared-presets/'+preset.id,'DELETE',undefined,'bob')).status,403);
    assert.equal((await request('/api/admin/shared-presets/'+preset.id,'PUT',{name:'Updated'})).status,200);
    assert.equal((await request('/api/admin/shared-presets','POST',{name:'updated',countries:['DE']})).status,409);
  });
  it('keeps SEMrush import, list, summary and delete backed by PostgreSQL',async()=>{
    const csv='URL,Status Code,Issue,Description,Priority\nhttps://example.invalid,200,Title,Missing title,High';
    const imported=await request('/api/admin/semrush/import','POST',{csv});assert.equal(imported.status,200);
    const issues:any=await (await request('/api/admin/semrush/issues')).json();assert.equal(issues.total,1);assert.equal(issues.items[0].issueType,'Title');
    const summary:any=await (await request('/api/admin/semrush/summary')).json();assert.equal(summary.total,1);
    assert.equal((await request('/api/admin/semrush/issues','DELETE')).status,200);
  });
  it('revalidates active identities from PostgreSQL and supplies req.user for session-authenticated handlers',async()=>{
    await pool.query("INSERT INTO users(id,username,email,full_name) VALUES('auth-user','native-auth','auth@example.invalid','Native Auth')");
    const call=()=>fetch(base+'/test/native-auth',{headers:{'x-user':'auth-user'}});
    let response=await call();assert.equal(response.status,200);assert.deepEqual(await response.json(),{id:'auth-user',status:'active'});
    await pool.query("UPDATE users SET status='suspended' WHERE id='auth-user'");response=await call();assert.equal(response.status,403);
    await pool.query("DELETE FROM users WHERE id='auth-user'");response=await call();assert.equal(response.status,401);
  });
  it('coordinates description workers in PostgreSQL and never overwrites a concurrent manual translation',async()=>{
    await catalog.update({_id:{$in:ids.slice(1)}},{$set:{noIndex:true}},{many:true});
    await catalog.patchById(ids[0],{$set:{descriptions:{},manualEditFields:{}}});
    let generated=0;
    mock.module('../src/services/ai-station-description',{namedExports:{
      detectStationLanguage:()=> 'en',
      generateStationDescription:async()=>{generated++;return {success:true,fullDescription:'A complete generated description for this test radio.',metaDescription:'Test radio metadata.'};},
      translateDescription:async(_full:string,_meta:string,_source:string,languages:string[])=>{
        await catalog.patchById(ids[0],{$set:{'descriptions.tr':{full:'Manual Turkish text must survive this translation job.',meta:'Manual metadata'}}});
        return new Map(languages.map(lang=>[lang,{full:'A complete translated radio description for '+lang,meta:'Metadata '+lang}]));
      },
    }});
    const {scheduledDescriptionFill}=await import('../src/services/scheduled-description-fill');
    const lock=await runtime.getPostgresCoordinationPool().connect();
    try{
      await lock.query("SELECT pg_advisory_lock(hashtext('radiohub-description-fill'))");
      const busy=await scheduledDescriptionFill.runOnce('other-worker-test');assert.equal(busy.stopReason,'already_running');assert.equal(generated,0);
    }finally{await lock.query("SELECT pg_advisory_unlock(hashtext('radiohub-description-fill'))");lock.release();}
    const done=await scheduledDescriptionFill.runOnce('native-worker-test');
    assert.equal(done.stoppedEarly,false);assert.equal(done.generated,1);assert.equal(done.translated,12);
    const saved=await catalog.findById(ids[0]);assert.equal(saved?.descriptions.tr.full,'Manual Turkish text must survive this translation job.');
    assert.equal(Object.keys(saved?.descriptions).length,14);
  });
  it('treats admin search, language and genre input as literal case-insensitive text',async()=>{
    const values=['Mark[One','Mark(Two','Mark\\Three','Mark.*Four','Mark+Five','Mark%Six','Mark_Seven'];
    const literalIds=values.map((_value,index)=>(100+index).toString(16).padStart(24,'0'));
    const normalId='f'.repeat(24);
    await catalog.insertMany([
      ...values.map((value,index)=>({_id:literalIds[index],stationuuid:`literal-admin-${index}`,name:`Literal ${value}`,
        country:'Germany',countryCode:'DE',url:`https://example.invalid/literal-${index}`,language:value,tags:value})),
      {_id:normalId,stationuuid:'literal-admin-normal',name:'Ordinary Station',country:'Germany',countryCode:'DE',
        url:'https://example.invalid/ordinary',language:'Deutsch',tags:'Alternative Rock'},
    ]);
    for(const filter of ['search','language','genre']){
      for(const [index,value] of values.entries()){
        const response=await request('/api/admin/stations?'+new URLSearchParams({[filter]:value,country:'DE'}));
        assert.equal(response.status,200,`${filter}: ${value}`);
        const body:any=await response.json();
        assert.equal(body.total,1);assert.deepEqual(body.stations.map((s:any)=>s._id),[literalIds[index]]);
      }
    }
    for(const [filter,value] of [['search','ordinary'],['language','deutsch'],['genre','alternative rock']]){
      const response=await request('/api/admin/stations?'+new URLSearchParams({[filter]:value}));
      assert.equal(response.status,200);const body:any=await response.json();
      assert.deepEqual(body.stations.map((s:any)=>s._id),[normalId]);
    }
    assert.equal((await request('/api/admin/stations?search=%5B','GET',undefined,null)).status,401);
  });
  it('repairs only selected description fields and preserves source, siblings and station identity over HTTP',async()=>{
    const id='d'.repeat(24),slug='description-repair-fixture';
    const descriptions={de:{full:'Existing German article',meta:'',provenance:'unchanged'},en:{full:'Existing English article',meta:'English summary'}};
    await catalog.insertMany([{_id:id,stationuuid:'description-repair-fixture',slug,name:'Description fixture',url:'https://example.invalid/description',descriptions,manualEditFields:{name:true}}]);
    const before=(await pool.query('SELECT * FROM stations WHERE id=$1',[id])).rows[0];
    const change={locale:'de',field:'meta',value:'Reviewed German summary',expectedCurrentValue:'',expectedLocaleObject:descriptions.de};
    const endpoint='/api/admin/stations/'+id+'/descriptions';
    assert.equal((await request(endpoint,'PATCH',{slug,changes:[change]},null)).status,401);
    assert.equal((await request('/api/admin/stations/'+id)).status,200);
    const response=await request(endpoint,'PATCH',{slug,changes:[change]});assert.equal(response.status,200);
    const after=(await pool.query('SELECT * FROM stations WHERE id=$1',[id])).rows[0];
    assert.deepEqual(after.descriptions,{...descriptions,de:{...descriptions.de,meta:change.value}});
    assert.deepEqual(after.source,before.source);assert.equal(after.id,before.id);assert.equal(after.slug,before.slug);
    assert.deepEqual(after.manual_edit_fields,{name:true,descriptions:true});
    for(const key of Object.keys(before))if(!['descriptions','manual_edit_fields','updated_at'].includes(key))assert.deepEqual(after[key],before[key],key);
    assert.equal((await request(endpoint,'PATCH',{slug,changes:[change]})).status,409);
    assert.equal((await request('/api/stations/'+id,'PUT',{name:'Must not save',descriptions:{de:{meta:'silent overwrite'}}})).status,400);
    assert.equal((await catalog.findById(id))?.name,'Description fixture');
  });
  it('rejects whole-batch locale/slug drift and serializes concurrent repairs without overwriting the winner',async()=>{
    const id='d'.repeat(24),slug='description-repair-fixture',endpoint='/api/admin/stations/'+id+'/descriptions';
    const current=(await catalog.findById(id))!;
    const changes=[{locale:'en',field:'meta',value:'First proposed text',expectedCurrentValue:current.descriptions.en.meta,expectedLocaleObject:current.descriptions.en},
      {locale:'de',field:'meta',value:'Second proposed text',expectedCurrentValue:'',expectedLocaleObject:{...current.descriptions.de,meta:''}}];
    assert.equal((await request(endpoint,'PATCH',{slug,changes})).status,409);
    assert.deepEqual((await catalog.findById(id))?.descriptions,current.descriptions);
    assert.equal((await request(endpoint,'PATCH',{slug:'different-slug',changes:[changes[0]]})).status,409);
    const responses=await Promise.all([request(endpoint,'PATCH',{slug,changes:[changes[0]]}),request(endpoint,'PATCH',{slug,changes:[{...changes[0],value:'Other writer'}]})]);
    assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
    const saved=(await catalog.findById(id))!;
    assert.deepEqual(saved.descriptions.de,current.descriptions.de);
    const absent={locale:'tr',field:'full',value:'New Turkish article',expectedCurrentValue:null,expectedLocaleObject:null};
    assert.equal((await request(endpoint,'PATCH',{slug,changes:[absent]})).status,200);
    assert.equal((await request(endpoint,'PATCH',{slug,changes:[{...absent,value:'Must not overwrite'}]})).status,409);
    assert.equal((await request('/api/admin/stations/'+'e'.repeat(24)+'/descriptions','PATCH',{slug,changes:[absent]})).status,404);
  });
  it('reports an already committed description edit successfully even if cache invalidation fails',async()=>{
    const id='d'.repeat(24),current=(await catalog.findById(id))!;
    const {performanceCache}=await import('../src/performance-cache');
    const failing=mock.method(performanceCache,'invalidateStationCache',()=>{throw new Error('Injected cache failure');});
    try{
      const change={locale:'en',field:'meta',value:'Committed despite cache error',expectedCurrentValue:current.descriptions.en.meta,expectedLocaleObject:current.descriptions.en};
      const response=await request('/api/admin/stations/'+id+'/descriptions','PATCH',{slug:current.slug,changes:[change]});
      assert.equal(response.status,200);const body:any=await response.json();assert.equal(body.success,true);assert.equal(body.cacheInvalidated,false);
      assert.equal((await catalog.findById(id))?.descriptions.en.meta,change.value);
    }finally{failing.mock.restore();}
  });
});
