import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile,readdir } from 'node:fs/promises';
import path from 'node:path';
import { after,before,beforeEach,describe,it,mock } from 'node:test';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import pg from 'pg';
import { PostgresCoverageStore } from '../src/data/postgres-coverage-store';
import { PostgresCatalogStore,compileCatalogFilter } from '../src/data/postgres-catalog-store';
import { PostgresAdminSettingsStore } from '../src/data/postgres-admin-settings-store';

describe('PostgreSQL coverage operations',{skip:!process.env.PG_TEST_DATABASE_URL},()=>{
  const schema=`coverage_ops_${process.pid}_${randomBytes(6).toString('hex')}`;
  const options={connectionString:process.env.PG_TEST_DATABASE_URL,ssl:process.env.PG_TEST_SSL==='require'?{rejectUnauthorized:true}:false};
  const admin=new pg.Pool({...options,max:1});const pool=new pg.Pool({...options,max:8,options:`-c search_path=${schema},public`});
  const store=new PostgresCoverageStore(pool);const catalog=new PostgresCatalogStore(pool);const settings=new PostgresAdminSettingsStore(pool);
  let schemaCreated=false;let server:Server;let base='';
  let snapshot:typeof import('../src/services/coverage-snapshot-backfill');
  let boot:typeof import('../src/services/coverage-backfill-on-boot');
  let scheduled:typeof import('../src/services/scheduled-backfill');
  let drops:typeof import('../src/services/coverage-drop-notifier');
  const priorRetry=process.env.BACKFILL_RETRY_BASE_MS;const priorAttempts=process.env.BACKFILL_MAX_ATTEMPTS;
  const station=(id:string,extra:Record<string,unknown>={})=>({_id:id,stationuuid:`uuid-${id}`,name:id,url:`https://stream.invalid/${id}`,country:'Germany',countryCode:'DE',createdAt:new Date('2020-01-01'),...extra});
  const runInput=(trigger='manual')=>({trigger,status:'running' as const,topN:5,startedAt:new Date(),logos:[],tags:[]});
  before(async()=>{
    assert.match(schema,/^coverage_ops_\d+_[a-f0-9]{12}$/);await admin.query(`CREATE SCHEMA "${schema}"`);schemaCreated=true;
    const directory=path.resolve(import.meta.dirname,'../../../lib/db/migrations');
    for(const file of (await readdir(directory)).filter(f=>/^\d+.*\.sql$/.test(f)).sort())await pool.query(await readFile(path.join(directory,file),'utf8'));
    mock.module('../src/postgres-runtime',{namedExports:{getPostgresPool: () => pool, getPostgresCoordinationPool: () => pool}});
    mock.module('../src/data/postgres-coverage-store',{namedExports:{PostgresCoverageStore,pgCoverage:()=>store}});
    mock.module('../src/data/postgres-catalog-store',{namedExports:{PostgresCatalogStore,compileCatalogFilter,pgCatalog:()=>catalog}});
    mock.module('../src/data/postgres-admin-settings-store',{namedExports:{PostgresAdminSettingsStore,pgAdminSettings:()=>settings,getAdminSetting:(key:string)=>settings.get(key)}});
    mock.module('../src/data/postgres-user-store',{namedExports:{pgAdminUserIds:async()=>[],userStore:'postgres'}});
    mock.module('../src/data/postgres-notification-store',{namedExports:{pgCreateNotification:async()=>{throw new Error('Unexpected notification write');}}});
    mock.module('../src/services/sync',{namedExports:{SyncService:class {async hydrateMissingTagsInBackground(){return {processed:0,hydrated:0,emptyUpstream:0,failed:0};}}}});
    mock.module('../src/services/scheduled-genre-slug-cleanup',{namedExports:{getGenreSlugCleanupRetention:()=>({days:90,maxRows:200}),scheduledGenreSlugCleanup:{}}});
    mock.module('../src/services/genre-slug-cleanup-notifier',{namedExports:{getGenreSlugCleanupAlertThreshold:()=>1}});
    mock.module('../src/services/radio-browser',{namedExports:{radioBrowserService:{getStationByUuid:async()=>[]}}});
    process.env.BACKFILL_RETRY_BASE_MS='1';process.env.BACKFILL_MAX_ATTEMPTS='2';
    snapshot=await import('../src/services/coverage-snapshot-backfill');boot=await import('../src/services/coverage-backfill-on-boot');
    scheduled=await import('../src/services/scheduled-backfill');drops=await import('../src/services/coverage-drop-notifier');
    const {registerAdminMaintenanceRoutes}=await import('../src/routes/admin-maintenance-routes');
    const app=express();app.use(express.json());registerAdminMaintenanceRoutes(app,{requireAdmin:(req:any,res:any,next:()=>void)=>req.headers['x-test-admin']==='true'?next():res.status(401).end()});
    server=await new Promise<Server>(resolve=>{const result=app.listen(0,'127.0.0.1',()=>resolve(result));});base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  beforeEach(async()=>{
    await pool.query('TRUNCATE stations,coverage_snapshots,coverage_backfill_status,coverage_backfill_runs,backfill_runs,admin_settings,admin_setting_history CASCADE');
    scheduled.invalidateBackfillRetentionCache();drops.invalidateCoverageDropSettingsCache();
  });
  after(async()=>{
    if(priorRetry===undefined)delete process.env.BACKFILL_RETRY_BASE_MS;else process.env.BACKFILL_RETRY_BASE_MS=priorRetry;
    if(priorAttempts===undefined)delete process.env.BACKFILL_MAX_ATTEMPTS;else process.env.BACKFILL_MAX_ATTEMPTS=priorAttempts;
    if(server)await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));mock.restoreAll();await pool.end();
    try{if(schemaCreated){assert.match(schema,/^coverage_ops_\d+_[a-f0-9]{12}$/);await admin.query(`DROP SCHEMA "${schema}" CASCADE`);}}finally{await admin.end();}
  });
  const request=(url:string,method='GET',body?:unknown)=>fetch(base+url,{method,headers:{'content-type':'application/json','x-test-admin':'true'},body:body===undefined?undefined:JSON.stringify(body)});
  it('historical coverage respects exclusive date boundaries, logo processing time and whitespace tags',async()=>{
    await catalog.insertMany([
      station('old',{tags:'jazz',logoAssets:{status:'completed',processedAt:'2020-01-02T00:00:00.000Z'}}),
      station('boundary',{createdAt:new Date('2020-01-03'),tags:' \t\n ',logoAssets:{status:'pending'}}),
      station('blank',{countryCode:'null',tags:'jazz'}),
    ]);
    assert.deepEqual(await snapshot.aggregateForDay(new Date('2020-01-02')),[{countryCode:'DE',total:1,withLogo:0,withTags:1}]);
    assert.deepEqual(await snapshot.aggregateForDay(new Date('2020-01-03')),[{countryCode:'DE',total:1,withLogo:1,withTags:1}]);
    assert.deepEqual(await store.coverage(),[{countryCode:'DE',total:2,withLogo:1,withTags:1}]);
  });
  it('backfilled snapshots never overwrite existing cron values; live cron promotes historical rows',async()=>{
    const date=new Date('2020-01-01');const original=[{countryCode:'DE',total:10,withLogo:5,withTags:8}];
    await store.writeSnapshots(date,original,'cron');const result=await store.writeSnapshots(date,[{...original[0],total:100}],'backfill');
    assert.deepEqual(result,{inserted:0,preserved:1});assert.equal((await store.snapshots({date}))[0].total,10);
    const nextDate=new Date('2020-01-02');await store.writeSnapshots(nextDate,original,'backfill');await store.writeSnapshots(nextDate,[{...original[0],withLogo:7}],'cron');
    const row=(await store.snapshots({date:nextDate}))[0];assert.equal(row.source,'cron');assert.equal(row.logoCoveragePct,70);
  });
  it('snapshot batches roll back completely on an invalid country row',async()=>{
    await pool.query("ALTER TABLE coverage_snapshots ADD CONSTRAINT injected_failure CHECK(country_code<>'XX')");
    try{await assert.rejects(store.writeSnapshots(new Date(),[{countryCode:'DE',total:1,withLogo:0,withTags:0},{countryCode:'XX',total:1,withLogo:0,withTags:0}],'cron'));assert.deepEqual(await store.snapshots(),[]);}
    finally{await pool.query('ALTER TABLE coverage_snapshots DROP CONSTRAINT injected_failure');}
  });
  it('historical backfill supports dry run, progress, cancellation and immutable replays',async()=>{
    await catalog.insertMany([station('one',{tags:'jazz'})]);const ticks:any[]=[];
    const dry=await snapshot.runCoverageBackfill({days:2,dryRun:true,onProgress:tick=>ticks.push(tick)});assert.equal(dry.wouldWrite,2);assert.equal(ticks.length,2);assert.deepEqual(await store.snapshots(),[]);
    const first=await snapshot.runCoverageBackfill({days:2});assert.equal(first.inserted,2);
    assert.equal((await snapshot.runCoverageBackfill({days:2})).preserved,2);
    assert.equal((await snapshot.runCoverageBackfill({days:2,isCancelled:()=>true})).cancelled,true);
    await assert.rejects(snapshot.runCoverageBackfill({days:-1}),RangeError);
  });
  it('boot status clears stale optional fields and commits history atomically with bounded retention',async()=>{
    await store.recordStatus('failed','old',{error:'old failure',inserted:1});await store.recordStatus('skipped-env','new');
    assert.equal((await store.status()).error,null);assert.equal((await store.status()).inserted,null);
    await pool.query("ALTER TABLE coverage_backfill_runs ADD CONSTRAINT injected_failure CHECK(message<>'fail')");
    try{await assert.rejects(store.recordStatus('done','fail'));assert.equal((await store.status()).message,'new');}
    finally{await pool.query('ALTER TABLE coverage_backfill_runs DROP CONSTRAINT injected_failure');}
    for(let i=0;i<25;i++)await store.recordStatus('done',String(i));assert.equal((await store.statusHistory(100)).length,20);
    await store.recordStatus('running','active');assert.equal((await store.statusHistory(100)).length,20);
  });
  it('native leader locks exclude other workers and failed acquisition does not leak connections',async()=>{
    const a=await store.acquireJob('test');assert.ok(a);assert.equal(await store.acquireJob('test'),null);a.assertOwned();await a.release();
    const b=await store.acquireJob('test');assert.ok(b);await b.release();assert.throws(()=>b.assertOwned(),/released/);
  });
  it('rich backfill history preserves retries, station samples, country/trigger filters and empty totals',async()=>{
    const run=await store.createRun({...runInput('admin:manual:tags:DE'),overrideCountry:'DE'});
    run.tags=[{countryCode:'DE',processed:3,hydrated:1,emptyUpstream:1,failed:1,durationMs:99,sampleStations:[{_id:'station',name:'Sample',slug:'sample'}]}];
    run.attempts=[{attempt:1,error:'transient',failedAt:new Date()}];run.status='completed';await store.saveRun(run);
    const result=await store.runs({trigger:'admin:manual:tags',country:'DE'});assert.equal(result.total,1);assert.deepEqual(result.runs[0].tags,run.tags);assert.equal(result.runs[0].attempts?.[0].error,'transient');
    assert.equal((await store.runs({trigger:'admin:manual:tag'})).total,0);assert.equal((await store.runs({country:'FR'})).oldestStartedAt,null);
  });
  it('retention preview matches actual prune and protects active runs with deterministic ties',async()=>{
    for(let i=0;i<14;i++){const run=await store.createRun(runInput('old'));run.status='completed';await store.saveRun(run);}
    await store.createRun(runInput('active'));
    const preview=await store.retentionPreview(90,10);assert.deepEqual(preview,{total:15,removed:4,kept:11,percent:4/15});
    assert.equal((await store.pruneRuns(90,10)).removed,preview.removed);assert.equal((await store.runs()).total,preview.kept);
  });
  it('logo enqueue uses native nested filter and preserves permanently failed/curated states',async()=>{
    await catalog.insertMany([
      station('pending',{slug:'pending',favicon:'https://logo.invalid/a',logoAssets:{status:'pending'}}),
      station('done',{slug:'done',favicon:'https://logo.invalid/b',logoAssets:{status:'completed'}}),
      station('dead',{slug:'dead',favicon:'https://logo.invalid/c',logoAssets:{status:'failed',failureType:'http_error'}}),
    ]);
    const result=await scheduled.enqueueLogosForCountry('DE');assert.equal(result.candidates,1);assert.equal(result.enqueued,1);assert.equal(result.sampleStations[0]._id,'pending');
    assert.equal((await catalog.findById('pending'))?.logoAssets,null);assert.equal((await catalog.findById('dead'))?.logoAssets.status,'failed');
  });
  it('manual history dry runs leave boot status unchanged; completed background runs are durable',async()=>{
    await catalog.insertMany([station('one')]);await store.recordStatus('skipped-env','prior');
    assert.equal((await boot.runCoverageBackfillNow({days:1,dryRun:true})).kind,'dry-run');assert.equal((await store.status()).message,'prior');
    const started=await boot.runCoverageBackfillNow({days:1});assert.equal(started.kind,'started');
    for(let i=0;i<100;i++){if((await store.status())?.outcome!=='running')break;await new Promise(resolve=>setTimeout(resolve,10));}
    assert.equal((await store.status()).outcome,'done');assert.equal((await store.statusHistory())[0].inserted,1);
  });
  it('coverage drop detection reads real history and does not treat PG failure as no drops',async()=>{
    const today=new Date();today.setUTCHours(0,0,0,0);const week=new Date(today.getTime()-7*86400000);
    await store.writeSnapshots(today,[{countryCode:'DE',total:100,withLogo:50,withTags:50}],'cron');
    await store.writeSnapshots(week,[{countryCode:'DE',total:100,withLogo:90,withTags:90}],'cron');
    assert.equal((await drops.detectCoverageDrops({snapshotDate:today,thresholdPp:5,minStations:1})).length,2);
    const failure=mock.method(pool,'query',async()=>{throw new Error('Injected PG outage');});
    try{await assert.rejects(drops.detectCoverageDrops({snapshotDate:today}));}finally{failure.mock.restore();}
  });
  it('admin backfill history exposes native rows, filters, retention and explicit failures',async()=>{
    const run=await store.createRun({...runInput('admin:manual:DE'),overrideCountry:'DE'});run.status='completed';await store.saveRun(run);
    assert.equal((await fetch(base+'/api/admin/maintenance/scheduled-backfill/runs')).status,401);
    const response=await request('/api/admin/maintenance/scheduled-backfill/runs?country=DE&trigger=admin:manual');assert.equal(response.status,200);const payload=await response.json() as any;assert.equal(payload.total,1);assert.equal(payload.runs[0]._id,run._id);
    assert.equal((await request('/api/admin/maintenance/scheduled-backfill/runs/'+run._id)).status,200);
    assert.equal((await request('/api/admin/maintenance/scheduled-backfill/runs?country=BAD')).status,400);
    const leader=await store.acquireJob('station-backfill');assert.ok(leader);
    try{assert.equal((await request('/api/admin/maintenance/tags-backfill','POST',{country:'DE'})).status,409);}finally{await leader.release();}
  });
  it('failed initial audit releases both process and PostgreSQL worker locks for retry',async()=>{
    const failure=mock.method(store,'createRun',async()=>{throw new Error('Injected audit insertion failure');});
    try{await assert.rejects(scheduled.scheduledBackfill.start('test'),/audit insertion/);assert.equal(scheduled.scheduledBackfill.getStatus().isRunning,false);}
    finally{failure.mock.restore();}
    const leader=await store.acquireJob('station-backfill');assert.ok(leader);await leader.release();
    const completed=await scheduled.scheduledBackfill.runOnce('test');assert.equal(completed?.status,'completed');
  });
  it('phase failures exhaust bounded retries and persist failed rather than zero-count success',async()=>{
    const failure=mock.method(store,'enqueueLogos',async()=>{throw new Error('Injected logo enqueue outage');});
    try{
      const failed=await scheduled.scheduledBackfill.runOnce('test-failure',{countryCode:'DE'});
      assert.equal(failed?.status,'failed');assert.equal(failed?.attempts?.length,2);assert.match(failed?.errorMessage??'',/country backfill phases failed/);
    }finally{failure.mock.restore();}
    const leader=await store.acquireJob('station-backfill');assert.ok(leader);await leader.release();
  });
  it('a newly elected worker closes an interrupted audit before starting its own run',async()=>{
    const interrupted=await store.createRun(runInput('previous-worker'));
    const complete=await scheduled.scheduledBackfill.runOnce('new-worker');assert.equal(complete?.status,'completed');
    const previous=await store.run(interrupted._id);assert.equal(previous?.status,'failed');assert.match(previous?.errorMessage??'',/Worker restarted/);
  });
});
