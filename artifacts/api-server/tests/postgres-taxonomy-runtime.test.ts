import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { after,before,beforeEach,describe,it,mock } from 'node:test';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import pg from 'pg';
import { PostgresTaxonomyRuntimeStore } from '../src/data/postgres-taxonomy-runtime-store';
import { PostgresCatalogStore } from '../src/data/postgres-catalog-store';

describe('PostgreSQL taxonomy runtime', {skip:!process.env.PG_TEST_DATABASE_URL},()=>{
  const schema=`taxonomy_runtime_${process.pid}_${randomBytes(6).toString('hex')}`;
  const options={connectionString:process.env.PG_TEST_DATABASE_URL,ssl:process.env.PG_TEST_SSL==='require'?{rejectUnauthorized:true}:false};
  const admin=new pg.Pool({...options,max:1});
  const pool=new pg.Pool({...options,max:8,options:`-c search_path=${schema},public`});
  const store=new PostgresTaxonomyRuntimeStore(pool); const catalog=new PostgresCatalogStore(pool);
  const cache=new Map<string,any>();let schemaCreated=false;let server:Server;let base='';
  let genres:typeof import('../src/services/precomputed-genres');
  let cities:typeof import('../src/services/precomputed-cities');
  let whitelist:typeof import('../src/seo/genre-whitelist-store');
  let pushes:typeof import('../src/seo/genre-whitelist-push-status');
  let counts:typeof import('../src/services/genre-station-counts');
  const station=(id:string,extra:Record<string,unknown>={})=>({_id:id,stationuuid:`uuid-${id}`,name:id,url:`https://stream.invalid/${id}`,country:'Germany',countryCode:'DE',...extra});
  before(async()=>{
    assert.match(schema,/^taxonomy_runtime_\d+_[a-f0-9]{12}$/);
    await admin.query(`CREATE SCHEMA "${schema}"`);schemaCreated=true;
    const directory=path.resolve(import.meta.dirname,'../../../lib/db/migrations');
    for(const file of (await readdir(directory)).filter(f=>/^\d+.*\.sql$/.test(f)).sort())await pool.query(await readFile(path.join(directory,file),'utf8'));
    mock.module('../src/postgres-runtime',{namedExports:{getPostgresPool: () => pool, getPostgresCoordinationPool: () => pool}});
    mock.module('../src/data/postgres-taxonomy-runtime-store',{namedExports:{PostgresTaxonomyRuntimeStore,pgTaxonomyRuntime:()=>store}});
    mock.module('../src/data/postgres-catalog-store',{namedExports:{PostgresCatalogStore,pgCatalog:()=>catalog}});
    const manager={
      get:async(key:string)=>cache.get(key)??null,getSWR:async(key:string)=>cache.get(key)??null,
      setSWR:async(key:string,value:any)=>{cache.set(key,value);},
      getOrSetSWR:async(key:string,compute:()=>Promise<any>)=>{
        if(cache.has(key))return cache.get(key);const fresh=await compute();cache.set(key,fresh);return fresh;
      },
    };
    mock.module('../src/cache',{defaultExport:manager,namedExports:{CacheManager:manager}});
    mock.module('../src/seo/sitemap-manifest-builder',{namedExports:{getTopCountryDbNames:async()=>['Germany'],buildAllSitemapManifests:async()=>{}}});
    mock.module('../src/utils/event-loop-yield',{namedExports:{sleep:async()=>{}}});
    mock.module('../src/performance-cache',{namedExports:{performanceCache:{getUrlTranslations:async()=>new Map()}}});
    mock.module('../src/seo/qualified-languages',{namedExports:{getCachedQualifiedLanguages:()=>['en']}});
    mock.module('../src/services/indexnow',{namedExports:{IndexNowService:{submitSitemaps:async()=>({success:true}),submitToIndexNow:async()=>({success:true}),submitGenreUrls:async()=>({success:true})}}});
    mock.module('../src/services/genre-whitelist-push-notifier',{namedExports:{
      getConfiguredWhitelistPushWebhookUrl:()=>null,loadLastWhitelistPushTestResult:async()=>null,notifyWhitelistPushResult:async()=>{},
      recordWhitelistPushTestResult:async()=>{},sendTestWhitelistPushFailureInAppNotification:async()=>0,sendTestWhitelistPushFailureWebhook:async()=>({ok:true}),
    }});
    genres=await import('../src/services/precomputed-genres');cities=await import('../src/services/precomputed-cities');
    whitelist=await import('../src/seo/genre-whitelist-store');pushes=await import('../src/seo/genre-whitelist-push-status');counts=await import('../src/services/genre-station-counts');
    const {registerAdminGenreWhitelistRoutes}=await import('../src/routes/admin-genre-whitelist-routes');
    const app=express();app.use(express.json());
    registerAdminGenreWhitelistRoutes(app,{requireAdmin:(req:any,res:any,next:()=>void)=>{
      if(req.headers['x-test-admin']!=='true')return res.status(401).end();req.session={adminAuth:{username:'test-admin'}};next();
    }});
    server=await new Promise<Server>(resolve=>{const result=app.listen(0,'127.0.0.1',()=>resolve(result));});
    base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  beforeEach(async()=>{
    cache.clear();pushes._resetPushStatusForTests();
    await pool.query('TRUNCATE stations,genres,genre_counts,genre_whitelist_overrides,genre_station_counts_runs,genre_whitelist_push_logs CASCADE');
    await whitelist.refreshGenreWhitelistFromDb();
  });
  after(async()=>{
    if(server)await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    mock.restoreAll();await pool.end();
    try{if(schemaCreated){assert.match(schema,/^taxonomy_runtime_\d+_[a-f0-9]{12}$/);await admin.query(`DROP SCHEMA "${schema}" CASCADE`);}}
    finally{await admin.end();}
  });
  const request=(url:string,method='GET',body?:unknown)=>fetch(base+url,{method,headers:{'content-type':'application/json','x-test-admin':'true'},body:body===undefined?undefined:JSON.stringify(body)});

  it('counts lowercased exact tags once per station and retains country breakdowns',async()=>{
    await catalog.insertMany([station('a',{tags:'Jazz, jazz, Lo Fi',genre:'jazz'}),station('b',{tags:'jazz,rock',country:'France',countryCode:'fr'})]);
    assert.deepEqual([...await store.liveCounts()].sort(),[['jazz',2],['lo fi',1],['rock',1]]);
    assert.deepEqual([...await store.liveCounts('Germany')].sort(),[['jazz',1],['lo fi',1]]);
    assert.deepEqual(await store.countryBreakdown(['jazz']),[{_id:{tag:'jazz',cc:'DE'},count:1},{_id:{tag:'jazz',cc:'FR'},count:1}]);
  });
  it('publishes replacement count maps atomically, rolls back faults, and clears successful empties',async()=>{
    await store.replaceCounts('global',new Map([['old',5]]));
    await pool.query("ALTER TABLE genre_counts ADD CONSTRAINT injected_failure CHECK(slug<>'fail')");
    try{await assert.rejects(store.replaceCounts('global',new Map([['fail',2]])));assert.deepEqual([...await store.storedCounts('global')],[['old',5]]);}
    finally{await pool.query('ALTER TABLE genre_counts DROP CONSTRAINT injected_failure');}
    await store.replaceCounts('global',new Map());assert.equal((await store.storedCounts('global')).size,0);
  });
  it('override transactions preserve creator metadata and remove opposing deltas and dangling aliases',async()=>{
    await store.mutateOverride({kind:'slug-add',slug:'custom-jazz',createdBy:'alice',notes:'old',seeded:false});
    await store.mutateOverride({kind:'slug-add',slug:'custom-jazz',createdBy:'bob',notes:'new',seeded:false});
    await store.mutateOverride({kind:'alias-add',slug:'custom-alias',canonical:'custom-jazz',createdBy:'bob',seeded:false});
    assert.equal((await store.overrides()).find(r=>r.kind==='slug-add').createdBy,'alice');
    await whitelist.refreshGenreWhitelistFromDb();assert.equal(whitelist.getMergedAliases().get('custom-alias'),'custom-jazz');
    await store.mutateOverride({kind:'slug-remove',slug:'custom-jazz',createdBy:'bob',seeded:false});
    assert.deepEqual(await store.overrides(),[]);await whitelist.refreshGenreWhitelistFromDb();assert.equal(whitelist.getMergedAliases().has('custom-alias'),false);
  });
  it('failed override mutation rolls back its deletions',async()=>{
    await store.mutateOverride({kind:'slug-remove',slug:'rock',createdBy:'alice',seeded:true});
    await pool.query("ALTER TABLE genre_whitelist_overrides ADD CONSTRAINT injected_failure CHECK(kind<>'slug-add')");
    try{await assert.rejects(store.mutateOverride({kind:'slug-add',slug:'rock',createdBy:'bob',seeded:false}));assert.equal((await store.overrides())[0].kind,'slug-remove');}
    finally{await pool.query('ALTER TABLE genre_whitelist_overrides DROP CONSTRAINT injected_failure');}
  });
  it('genre row creation counts matching humanized names and rejects duplicate races',async()=>{
    await catalog.insertMany([station('a',{tags:'lo fi,rock'}),station('b',{genre:' Lo Fi '})]);
    const results=await Promise.all(Array.from({length:8},()=>store.createWhitelistedGenre('lo-fi','Lo Fi')));
    assert.equal(results.filter(r=>r.created).length,1);assert.equal(results.find(r=>r.created)?.stationCount,2);
  });
  it('recompute updates counts and completion audit together and durably records rollback failures',async()=>{
    await catalog.insertMany([station('a',{tags:'jazz'})]);
    await pool.query("INSERT INTO genres(id,name,slug,station_count) VALUES('g','Jazz','jazz',9)");
    await pool.query("ALTER TABLE genre_station_counts_runs ADD CONSTRAINT injected_failure CHECK(status<>'completed')");
    try{await assert.rejects(store.recomputeGenreCounts('cron:nightly-test',10));assert.equal((await store.genres(['jazz']))[0].stationCount,9);assert.equal((await store.runs(1,true))[0].status,'failed');}
    finally{await pool.query('ALTER TABLE genre_station_counts_runs DROP CONSTRAINT injected_failure');}
    const result=await store.recomputeGenreCounts('admin',10);assert.equal(result.updatedSlugs,1);assert.equal((await store.genres(['jazz']))[0].stationCount,1);
  });
  it('retains only newest finished count runs and coalesces service recomputes',async()=>{
    await pool.query("INSERT INTO genre_station_counts_runs(id,trigger,status,started_at) SELECT 'old-'||i,'old','completed','2000-01-01'::timestamptz FROM generate_series(1,20)i");
    await store.recomputeGenreCounts('admin',10);assert.equal(await store.runCount(),10);
    const a=counts.recomputeGenreStationCounts('same');const b=counts.recomputeGenreStationCounts('same');assert.equal(a,b);await a;
    assert.equal(counts.getGenreStationCountsStatus().inFlight,false);
  });
  it('persists isolated push snapshots and does not publish successful completion when audit fails',async()=>{
    const a=pushes.startPushStatus({trigger:'a',triggeredBy:'alice',affectedSlugs:['rock']});
    const b=pushes.startPushStatus({trigger:'b',triggeredBy:'bob',affectedSlugs:['jazz']});
    pushes.updatePushStep(a,'sitemapRebuild',{status:'failed',error:'a only'});
    const completed=await pushes.completePushStatus(a);assert.equal(completed?.trigger,'a');assert.equal(pushes.getLastPushStatus()?.trigger,'b');
    await pushes.completePushStatus(b);assert.equal((await pushes.getRecentPushHistory()).length,2);
    const c=pushes.startPushStatus({trigger:'c',triggeredBy:null,affectedSlugs:[]});
    await pool.query("ALTER TABLE genre_whitelist_push_logs ADD CONSTRAINT injected_failure CHECK(trigger<>'c')");
    try{await assert.rejects(pushes.completePushStatus(c));assert.equal(pushes.getLastPushStatus()?.completedAt,null);}
    finally{await pool.query('ALTER TABLE genre_whitelist_push_logs DROP CONSTRAINT injected_failure');}
  });
  it('computes multiword dynamic genres, city buckets and successful cache refreshes natively',async()=>{
    await catalog.insertMany([station('a',{name:'Berlin Jazz',tags:'lo fi',lastCheckOk:true}),station('b',{name:'Hamburg',tags:'lo fi',lastCheckOk:true})]);
    const country=await genres.PrecomputedGenresService.computeGenresForCountry('Germany');
    assert.equal(country.genres.find(g=>g.slug==='lo-fi')?.stationCount,2);
    const city=await cities.PrecomputedCitiesService.computeCitiesForCountry('Germany');assert.equal(city.totalCountryStations,2);assert.equal(city.cities.length,2);
    const result=await genres.PrecomputedGenresService.refreshGenreCounts();assert.equal(result.failures,0);assert.equal(result.countries,1);
  });
  it('cold PG failures reject without poisoning caches or replacing the last good whitelist',async()=>{
    await store.mutateOverride({kind:'slug-add',slug:'retained',createdBy:'a',seeded:false});await whitelist.refreshGenreWhitelistFromDb();
    cache.set('precomputed_genres:v5:germany',{marker:'prior'});
    const failure=mock.method(pool,'query',async()=>{throw new Error('Injected PostgreSQL outage');});
    try{
      await assert.rejects(genres.PrecomputedGenresService.computeGenresForCountry('Germany'));
      await assert.rejects(cities.PrecomputedCitiesService.getCitiesForCountry('Germany'));
      await assert.rejects(whitelist.refreshGenreWhitelistFromDb());assert.equal(whitelist.getMergedWhitelist().has('retained'),true);
      const result=await genres.PrecomputedGenresService.refreshGenreCounts();assert.equal(result.failures,2);assert.deepEqual(cache.get('precomputed_genres:v5:germany'),{marker:'prior'});
      await assert.rejects(pushes.getRecentPushHistory());
    }finally{failure.mock.restore();}
  });
  it('admin whitelist endpoints preserve authentication, mutations, row conflicts and history',async()=>{
    assert.equal((await fetch(base+'/api/admin/genre-whitelist')).status,401);
    const added=await request('/api/admin/genre-whitelist/slugs','POST',{slug:'custom-jazz',notes:'test'});assert.equal(added.status,200,await added.text());
    const created=await request('/api/admin/genre-whitelist/slugs/custom-jazz/genre-row','POST');assert.equal(created.status,200);
    assert.equal((await request('/api/admin/genre-whitelist/slugs/custom-jazz/genre-row','POST')).status,409);
    assert.equal((await request('/api/admin/genre-whitelist/aliases','POST',{source:'custom-alias',canonical:'custom-jazz'})).status,200);
    const view=await request('/api/admin/genre-whitelist');assert.equal(view.status,200);const payload=await view.json() as any;assert.ok(payload.slugs.includes('custom-jazz'));
    assert.equal((await request('/api/admin/genre-whitelist/slugs/custom-jazz','DELETE')).status,200);
    assert.equal((await request('/api/admin/genre-whitelist/slugs','POST',{slug:'BAD SLUG'})).status,422);
  });
});
