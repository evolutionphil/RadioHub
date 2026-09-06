import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile,readdir } from 'node:fs/promises';
import path from 'node:path';
import { after,before,beforeEach,describe,it,mock } from 'node:test';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import pg from 'pg';
import { PostgresGenreCleanupStore,emptyGenreCleanupStats } from '../src/data/postgres-genre-cleanup-store';
import { PostgresCoverageStore } from '../src/data/postgres-coverage-store';
import { PostgresCatalogStore,compileCatalogFilter } from '../src/data/postgres-catalog-store';
import { PostgresAdminSettingsStore } from '../src/data/postgres-admin-settings-store';

describe('PostgreSQL genre cleanup and maintenance',{skip:!process.env.PG_TEST_DATABASE_URL},()=>{
  const schema=`genre_cleanup_${process.pid}_${randomBytes(6).toString('hex')}`;
  const options={connectionString:process.env.PG_TEST_DATABASE_URL,ssl:process.env.PG_TEST_SSL==='require'?{rejectUnauthorized:true}:false};
  const admin=new pg.Pool({...options,max:1});const pool=new pg.Pool({...options,max:8,options:`-c search_path=${schema},public`});
  const store=new PostgresGenreCleanupStore(pool),coverage=new PostgresCoverageStore(pool),catalog=new PostgresCatalogStore(pool),settings=new PostgresAdminSettingsStore(pool);
  let server:Server;let base='';let schemaCreated=false;let failRefresh=false;let refreshCalls=0;
  let service:typeof import('../src/services/scheduled-genre-slug-cleanup');
  let script:typeof import('../src/scripts/cleanup-malformed-genre-slugs');
  let junkFailure=false;let junkCalls=0;
  const station=(id:string,extra:Record<string,unknown>={})=>({_id:id,stationuuid:`uuid-${id}`,name:id,url:`https://stream.invalid/${id}`,country:'Germany',countryCode:'DE',...extra});
  const genre=(id:string,slug:string|null,discoverable=true,count=0,source:any={})=>pool.query('INSERT INTO genres(id,name,slug,is_discoverable,station_count,source) VALUES($1,$1,$2,$3,$4,$5::jsonb)',[id,slug,discoverable,count,JSON.stringify(source)]);
  const getGenre=async(id:string)=>(await pool.query('SELECT * FROM genres WHERE id=$1',[id])).rows[0];
  before(async()=>{
    assert.match(schema,/^genre_cleanup_\d+_[a-f0-9]{12}$/);await admin.query(`CREATE SCHEMA "${schema}"`);schemaCreated=true;
    const directory=path.resolve(import.meta.dirname,'../../../lib/db/migrations');
    for(const file of (await readdir(directory)).filter(f=>/^\d+.*\.sql$/.test(f)).sort())await pool.query(await readFile(path.join(directory,file),'utf8'));
    mock.module('../src/postgres-runtime',{namedExports:{getPostgresPool: () => pool, getPostgresCoordinationPool: () => pool,closePostgres:async()=>{}}});
    mock.module('../src/data/postgres-genre-cleanup-store',{namedExports:{PostgresGenreCleanupStore,emptyGenreCleanupStats,pgGenreCleanup:()=>store}});
    mock.module('../src/data/postgres-coverage-store',{namedExports:{PostgresCoverageStore,pgCoverage:()=>coverage}});
    mock.module('../src/data/postgres-catalog-store',{namedExports:{PostgresCatalogStore,compileCatalogFilter,pgCatalog:()=>catalog}});
    mock.module('../src/data/postgres-admin-settings-store',{namedExports:{PostgresAdminSettingsStore,pgAdminSettings:()=>settings,getAdminSetting:(key:string)=>settings.get(key)}});
    mock.module('../src/services/precomputed-genres',{namedExports:{PrecomputedGenresService:{refreshAll:async()=>{refreshCalls++;if(failRefresh)throw new Error('injected refresh failure');}}}});
    mock.module('../src/seo/sitemap-manifest-builder',{namedExports:{buildAllSitemapManifests:async()=>{},getTopCountryDbNames:async()=>[]}});
    mock.module('../src/services/genre-slug-cleanup-notifier',{namedExports:{notifyGenreSlugCleanupResult:async()=>{},getGenreSlugCleanupAlertThreshold:()=>5}});
    mock.module('../src/services/radio-browser',{namedExports:{radioBrowserService:{getStationByUuid:async()=>[]}}});
    mock.module('../src/services/sync',{namedExports:{SyncService:class {async hydrateMissingTagsInBackground(){return {processed:0,hydrated:0,emptyUpstream:0,failed:0};}}}});
    mock.module('../src/utils/clean-content-quality-urls',{namedExports:{runJunkCleanup:async(options:any)=>{options.assertOwned();junkCalls++;if(junkFailure)throw new Error('injected junk failure');return {processed:2,slugRewrites:1,junkMarked:0,bothChanges:0,auditRows:1,reportPath:options.reportPath,dryRun:false};}}});
    service=await import('../src/services/scheduled-genre-slug-cleanup');script=await import('../src/scripts/cleanup-malformed-genre-slugs');
    const {registerAdminMaintenanceRoutes}=await import('../src/routes/admin-maintenance-routes');
    const app=express();app.use(express.json());registerAdminMaintenanceRoutes(app,{requireAdmin:(req:any,res:any,next:()=>void)=>req.headers['x-test-admin']==='true'?next():res.status(401).end()});
    server=await new Promise<Server>(resolve=>{const result=app.listen(0,'127.0.0.1',()=>resolve(result));});base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  beforeEach(async()=>{failRefresh=false;refreshCalls=0;await pool.query('TRUNCATE genres,stations,genre_whitelist_overrides,genre_slug_cleanup_runs,backfill_runs,admin_settings,admin_setting_history CASCADE');});
  after(async()=>{
    if(server)await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));mock.restoreAll();await pool.end();
    try{if(schemaCreated){assert.match(schema,/^genre_cleanup_\d+_[a-f0-9]{12}$/);await admin.query(`DROP SCHEMA "${schema}" CASCADE`);}}finally{await admin.end();}
  });
  const request=(url:string,method='GET')=>fetch(base+url,{method,headers:{'content-type':'application/json','x-test-admin':'true'}});
  async function waitJob(endpoint:string){for(let i=0;i<200;i++){const result=await(await request(endpoint)).json() as any;if(!result.job?.isRunning)return result.job;await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('Maintenance job did not finish');}
  it('slugless rows are hidden by constraint while non-null slug uniqueness stays enforced',async()=>{
    await genre('hidden',null,false);await assert.rejects(genre('public',null,true),(e:any)=>e.code==='23514');
    await genre('winner','jazz');await assert.rejects(genre('duplicate','jazz'),(e:any)=>e.code==='23505');
  });
  it('dry run predicts normalization collisions without modifying genre rows',async()=>{
    await genre('a','Lo Fi');await genre('b','Lo@Fi');await genre('c','!!!');
    const stats=await store.cleanupMalformed(true);assert.equal(stats.normalized,1);assert.equal(stats.collisionMarked,1);assert.equal(stats.emptySlugMarked,1);
    assert.equal((await getGenre('a')).slug,'Lo Fi');assert.equal((await getGenre('c')).is_discoverable,true);
  });
  it('normalizes safely, migrates exact station links, preserves source and records demotion forensics',async()=>{
    await catalog.insertMany([station('station')]);await genre('a','Lo Fi',true,1,{extra:{keep:true}});await genre('b','Lo@Fi');await genre('c','!!!');await genre('d','jazz');
    await pool.query("INSERT INTO station_genres(station_id,genre_slug) VALUES('station','Lo Fi')");
    const since=new Date();const stats=await store.cleanupMalformed();assert.deepEqual(stats,{scanned:4,alreadyValid:1,normalized:1,markedUndiscoverable:2,emptySlugMarked:1,collisionMarked:1,errors:0});
    assert.equal((await getGenre('a')).source.extra.keep,true);assert.deepEqual((await pool.query('SELECT genre_slug FROM station_genres')).rows,[{genre_slug:'lo-fi'}]);
    const demotions=await store.demotions({since});assert.equal(demotions.length,2);assert.equal(demotions[0].collisionWinnerId,'a');assert.equal(demotions[0].originalSlug,'Lo@Fi');
    assert.equal((await getGenre('b')).is_discoverable,false);assert.equal((await getGenre('b')).slug,'Lo@Fi');
  });
  it('any failed mutation rolls the whole cleanup and station-link changes back',async()=>{
    await genre('a','Good Slug');await genre('b','Bad Slug');await pool.query("ALTER TABLE genres ADD CONSTRAINT injected_failure CHECK(slug<>'bad-slug')");
    try{await assert.rejects(store.cleanupMalformed());assert.equal((await getGenre('a')).slug,'Good Slug');assert.equal((await getGenre('b')).slug,'Bad Slug');}
    finally{await pool.query('ALTER TABLE genres DROP CONSTRAINT injected_failure');}
  });
  it('lost leader ownership aborts and rolls back the repair',async()=>{
    await genre('a','Good Slug');let checks=0;
    await assert.rejects(store.cleanupMalformed(false,()=>{},()=>{if(++checks===3)throw new Error('lost lease');}),/lost lease/);
    assert.equal((await getGenre('a')).slug,'Good Slug');
  });
  it('legacy duplicate repair uses count/discoverability/date/id winner order and hides nullable losers',async()=>{
    await pool.query('ALTER TABLE genres DROP CONSTRAINT genres_slug_key');
    try{
      await genre('a','same',false,10,{extra:'preserved'});await genre('b','same',true,10);await genre('c','same',true,1);
      const result=await store.cleanupDuplicates();assert.deepEqual(result,{scanned:3,duplicateGroups:1,winnersKept:1,losersDemoted:2,errors:0});
      assert.equal((await getGenre('b')).slug,'same');assert.equal((await getGenre('a')).slug,null);assert.equal((await getGenre('a')).source.extra,'preserved');
      assert.equal((await getGenre('a')).source.cleanupDemotion.collisionWinnerId,'b');
    }finally{await pool.query('ALTER TABLE genres ADD CONSTRAINT genres_slug_key UNIQUE(slug)');}
    assert.deepEqual(await store.cleanupDuplicates(),{scanned:0,duplicateGroups:0,winnersKept:0,losersDemoted:0,errors:0});
  });
  it('native cleanup audit preserves metrics, namespace filtering, exact empty totals and retention',async()=>{
    for(let i=0;i<13;i++){const run=await store.createRun(i===0?'admin:manual-other':'admin:manual:genres');run.status='completed';run.normalized=i;run.rewarmed=true;await store.saveRun(run);}
    const active=await store.createRun('active');assert.equal((await store.runs({trigger:'admin:manual'})).total,12);
    assert.equal((await store.runs({trigger:'missing'})).oldestStartedAt,null);assert.equal((await store.runs({trigger:'missing'})).total,0);
    assert.equal((await store.prune(90,10)).removed,3);assert.equal((await store.run(active._id))?.status,'running');
    await assert.rejects(store.saveRun({...active,_id:'missing'}),/no longer exists/);
  });
  it('scheduled execution requires durable initial audit and releases locks after an insert failure',async()=>{
    await pool.query("ALTER TABLE genre_slug_cleanup_runs ADD CONSTRAINT injected_failure CHECK(trigger<>'failure')");
    try{await assert.rejects(service.scheduledGenreSlugCleanup.start('failure'));assert.equal(service.scheduledGenreSlugCleanup.getStatus().isRunning,false);}
    finally{await pool.query('ALTER TABLE genre_slug_cleanup_runs DROP CONSTRAINT injected_failure');}
    const run=await service.scheduledGenreSlugCleanup.runOnce('retry');assert.equal(run?.status,'completed');assert.equal((await store.runs()).total,1);
  });
  it('shared leader excludes another worker and recovers its interrupted durable audit only after ownership',async()=>{
    const old=await store.createRun('interrupted');const held=await coverage.acquireJob('genre-slug-cleanup');assert.ok(held);
    try{assert.equal(await service.scheduledGenreSlugCleanup.start(),null);assert.equal((await store.run(old._id))?.status,'running');}finally{await held.release();}
    await service.scheduledGenreSlugCleanup.runOnce('recovery');assert.equal((await store.run(old._id))?.status,'failed');
  });
  it('refresh failure remains a failed audited run and retains truthful committed repair counts',async()=>{
    await genre('a','Bad Slug');failRefresh=true;const run=await service.scheduledGenreSlugCleanup.runOnce('refresh-failure');
    assert.equal(run?.status,'failed');assert.equal(run?.normalized,1);assert.equal(run?.rewarmed,false);assert.match(run?.errorMessage??'',/downstream/);
    assert.equal((await getGenre('a')).slug,'bad-slug');assert.equal(refreshCalls,1);
  });
  it('script does not publish cache changes during dry runs or valid no-op sweeps',async()=>{
    await genre('a','Fine Slug');await script.runGenreSlugCleanup({manageConnection:false,dryRun:true});assert.equal(refreshCalls,0);
    await pool.query("UPDATE genres SET slug='fine-slug'");await script.runGenreSlugCleanup({manageConnection:false});assert.equal(refreshCalls,0);
  });
  it('admin cleanup API requires auth, returns durable history, demotions and real replica busy state',async()=>{
    assert.equal((await fetch(base+'/api/admin/maintenance/genre-slug-cleanup/runs')).status,401);
    const held=await coverage.acquireJob('genre-slug-cleanup');assert.ok(held);
    try{assert.equal((await request('/api/admin/maintenance/genre-slug-cleanup/run','POST')).status,409);}finally{await held.release();}
    await genre('a','!!!');const run=await service.scheduledGenreSlugCleanup.runOnce('admin:manual');assert.ok(run);
    const history=await(await request('/api/admin/maintenance/genre-slug-cleanup/runs?trigger=admin:manual')).json() as any;assert.equal(history.total,1);
    const details=await(await request(`/api/admin/maintenance/genre-slug-cleanup/runs/${run._id}/demotions`)).json() as any;assert.equal(details.demotions[0].reason,'empty-slug');
  });
  it('native SEO metrics calculate source timestamps and missing nested descriptions',async()=>{
    await catalog.insertMany([station('a',{lastCheckOk:false,lastCheckOkTime:new Date('2020-01-01')}),station('b',{lastCheckOk:false,lastCheckOkTime:new Date()}),station('c',{noIndex:true,lastCheckOk:false})]);
    const response=await request('/api/admin/seo-health-stats');assert.equal(response.status,200);const result=await response.json() as any;
    assert.equal(result.total,3);assert.equal(result.noIndex,1);assert.equal(result.brokenStream.indexableTotal,2);assert.equal(result.brokenStream.deadOver30Days,1);
  });
  it('description maintenance writes native nested fields and respects curated content',async()=>{
    await catalog.insertMany([station('a',{descriptions:{en:{full:'Great radio. Listen now on Mega Radio!',meta:'Play. Listen now on Mega Radio!'}}}),station('b',{descriptions:{en:{full:'Curated. Listen now on Mega Radio!'}},manualEditFields:{descriptions:true}})]);
    assert.equal((await request('/api/admin/maintenance/descriptions/strip-suffix','POST')).status,200);
    const job=await waitJob('/api/admin/maintenance/descriptions/strip-suffix/status');assert.equal(job.lastError,null);assert.equal(job.modified,1);
    assert.equal((await catalog.findById('a'))?.descriptions.en.full,'Great radio.');assert.match((await catalog.findById('b'))?.descriptions.en.full,/Mega Radio/);
    await catalog.insertMany([station('c',{votes:1001}),station('d',{manualEditFields:{descriptions:true}})]);
    assert.equal((await request('/api/admin/maintenance/descriptions/fill-templates','POST')).status,200);
    const fill=await waitJob('/api/admin/maintenance/descriptions/fill-templates/status');assert.equal(fill.lastError,null);assert.equal(fill.filled,1);assert.equal(fill.aiReady,1);
    assert.equal(typeof (await catalog.findById('c'))?.descriptions.en.full,'string');assert.equal((await catalog.findById('d'))?.descriptions.en,undefined);
  });
  it('description maintenance reports database errors instead of incrementing successful counts',async()=>{
    await catalog.insertMany([station('a',{descriptions:{en:{full:'Great radio. Listen now on Mega Radio!'}}})]);
    await pool.query("ALTER TABLE stations ADD CONSTRAINT injected_failure CHECK(descriptions->'en'->>'full'<>'Great radio.')");
    try{await request('/api/admin/maintenance/descriptions/strip-suffix','POST');const job=await waitJob('/api/admin/maintenance/descriptions/strip-suffix/status');assert.match(job.lastError,/injected_failure/);assert.equal(job.modified,0);}
    finally{await pool.query('ALTER TABLE stations DROP CONSTRAINT injected_failure');}
  });
  it('boot audit requires a successful write and remains retryable after failure',async()=>{
    const {maybeRunDuplicateGenreSlugCleanupOnBoot}=await import('../src/services/duplicate-genre-slug-cleanup-on-boot');
    await pool.query("ALTER TABLE genre_slug_cleanup_runs ADD CONSTRAINT injected_failure CHECK(trigger<>'boot:deploy')");
    try{await assert.rejects(maybeRunDuplicateGenreSlugCleanupOnBoot());}finally{await pool.query('ALTER TABLE genre_slug_cleanup_runs DROP CONSTRAINT injected_failure');}
    await maybeRunDuplicateGenreSlugCleanupOnBoot();const history=await store.runs({trigger:'boot'});assert.equal(history.total,1);assert.equal(history.runs[0].status,'completed');
    await maybeRunDuplicateGenreSlugCleanupOnBoot();assert.equal((await store.runs()).total,1);
  });
  it('junk cleanup uses a PostgreSQL worker lock and rejects failed sweeps without wedging retries',async()=>{
    const {scheduledJunkCleanup}=await import('../src/services/scheduled-junk-cleanup');
    const held=await coverage.acquireJob('junk-cleanup');assert.ok(held);
    try{assert.equal(await scheduledJunkCleanup.runOnce(),null);assert.equal(junkCalls,0);}finally{await held.release();}
    junkFailure=true;await assert.rejects(scheduledJunkCleanup.runOnce(),/injected junk failure/);assert.equal(scheduledJunkCleanup.getStatus().isRunning,false);
    assert.match(scheduledJunkCleanup.getStatus().lastRunStats?.error??'',/injected junk failure/);
    junkFailure=false;assert.equal((await scheduledJunkCleanup.runOnce())?.processed,2);assert.equal(junkCalls,2);
  });
  it('junk genre CLI keeps seeded and admin-added aliases, previews correctly, and atomically deletes only unlisted rows',async()=>{
    const {cleanupJunkGenres}=await import('../src/scripts/cleanup-junk-genres');
    await genre('seed','jazz');await genre('custom','custom-allowed');await genre('alias','custom-alias');await genre('junk','frequency-999');
    await pool.query("INSERT INTO genre_whitelist_overrides(id,kind,slug,canonical,created_by) VALUES('allow','slug-add','custom-allowed',NULL,'admin'),('alias','alias-add','custom-alias','custom-allowed','admin')");
    assert.deepEqual(await cleanupJunkGenres({dryRun:true}),{total:4,kept:3,deleted:1,unslugged:0,dryRun:true});assert.ok(await getGenre('junk'));
    assert.equal((await cleanupJunkGenres({dryRun:false})).deleted,1);assert.equal(await getGenre('junk'),undefined);assert.ok(await getGenre('alias'));
    assert.equal((await cleanupJunkGenres({dryRun:false})).deleted,0);
  });
});
