import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile,readdir } from 'node:fs/promises';
import path from 'node:path';
import { after,before,describe,it } from 'node:test';
import pg from 'pg';
const connectionString=process.env.PG_TEST_DATABASE_URL;
describe('PostgreSQL SEO indexing state',{skip:!connectionString},async()=>{
  if(!connectionString)return;
  const schema=`seo_state_test_${process.pid}_${randomBytes(6).toString('hex')}`;
  const admin=new pg.Pool({connectionString,ssl:false,max:1});const url=new URL(connectionString);
  url.searchParams.set('options',`-c search_path=${schema},public`);process.env.DATABASE_URL=url.toString();process.env.POSTGRES_SSL='disable';
  const {getPostgresPool,closePostgres}=await import('../src/postgres-runtime');const pool=getPostgresPool();
  const seo=await import('../src/data/postgres-seo-indexing-store');const gsc=await import('../src/data/postgres-gsc-store');let created=false;
  before(async()=>{
    await admin.query(`CREATE SCHEMA "${schema}"`);created=true;
    const dir=path.resolve(import.meta.dirname,'../../../lib/db/migrations');
    for(const file of(await readdir(dir)).filter(file=>/^\d+.*\.sql$/.test(file)).sort())await pool.query(await readFile(path.join(dir,file),'utf8'));
  });
  after(async()=>{await closePostgres();try{if(created){assert.match(schema,/^seo_state_test_\d+_[a-f0-9]{12}$/);await admin.query(`DROP SCHEMA "${schema}" CASCADE`);}}finally{await admin.end();}});
  const manifest=(language:string,version:string)=>({type:'stations',language,version,qualifiedLanguagesHash:'hash',qualifiedLanguages:[language],chunks:[{chunk:1,stationIds:['station-a'],urlCount:1,maxUpdatedAt:new Date('2026-01-01')}],totalUrls:1});
  it('allocates one concurrent build and atomically retains the last successful manifest',async()=>{
    const language=`test-${randomUUID()}`;
    const builds=await Promise.all(Array.from({length:12},()=>seo.pgWriteBuildingManifest(manifest(language,'v1'))));
    assert.equal(builds.filter(row=>row.status==='building').length,1);
    const build=builds.find(row=>row.status==='building');await seo.pgActivateManifest(build.id,'stations',language);
    const same=await seo.pgWriteBuildingManifest(manifest(language,'v1'));assert.equal(same.id,build.id);assert.equal(same.status,'active');
    assert.ok(same.chunks[0].maxUpdatedAt instanceof Date);
    const next=await seo.pgWriteBuildingManifest(manifest(language,'v2'));await pool.query("UPDATE sitemap_manifests SET generated_at=now()-interval '1 hour' WHERE id=$1",[next.id]);
    const replacement=await seo.pgWriteBuildingManifest(manifest(language,'v3'));
    await assert.rejects(seo.pgActivateManifest(next.id,'stations',language),/lease/);
    assert.equal((await seo.pgActiveManifest('stations',language)).version,'v1');
    await seo.pgActivateManifest(replacement.id,'stations',language);assert.equal((await seo.pgActiveManifest('stations',language)).version,'v3');
    await pool.query("UPDATE sitemap_manifests SET expires_at=now()-interval '2 days' WHERE language=$1",[language]);
    await seo.pgSeoCleanup();assert.equal((await seo.pgActiveManifest('stations',language)).version,'v3');
    await assert.rejects(seo.pgRetireManifests([]),/empty qualified-language/);
    assert.equal((await seo.pgActiveManifest('stations',language)).version,'v3');
  });
  it('keeps per-chunk URL snapshots separate and preserves full submission TTL independently of logs',async()=>{
    await seo.pgSaveUrlSnapshot('stations','de',1,['https://example.invalid/a']);await seo.pgSaveUrlSnapshot('stations','de',2,['https://example.invalid/b']);
    assert.deepEqual((await seo.pgGetUrlSnapshot('stations','de',1)).urls,['https://example.invalid/a']);
    assert.deepEqual((await seo.pgGetUrlSnapshot('stations','de',2)).urls,['https://example.invalid/b']);
    const log=await seo.pgCreateIndexNowLog({host:'example.invalid',urlCount:2,status:'success',trigger:'sitemap-diff',sampleUrls:['https://example.invalid/a']});
    await seo.pgSaveIndexNowUrls({logId:log.id,timestamp:new Date(),host:'example.invalid',trigger:'sitemap-diff',urls:['https://example.invalid/a','https://example.invalid/b'],urlCount:2,expiresAt:new Date(Date.now()+10000)});
    assert.equal((await seo.pgIndexNowUrls(log.id)).urls.length,2);
    await pool.query("UPDATE indexnow_submission_urls SET expires_at=now()-interval '1 second' WHERE log_id=$1",[log.id]);
    assert.equal(await seo.pgIndexNowUrls(log.id),null);await seo.pgSeoCleanup();assert.ok(await seo.pgIndexNowLog(log.id));
    assert.equal((await seo.pgIndexNowStats(new Date('2000-01-01'),new Date('2000-01-01'))).totals.successful,1);
  });
  it('does not permit two workers to publish the same snapshot diff concurrently',async()=>{
    let entered!:()=>void,release!:()=>void;const ready=new Promise<void>(r=>entered=r),hold=new Promise<void>(r=>release=r);
    const first=seo.withSeoJobLock('integration-lock',async()=>{entered();await hold;return true;});await ready;
    try{await assert.rejects(seo.withSeoJobLock('integration-lock',async()=>false),/already running/);}finally{release();}
    assert.equal(await first,true);assert.equal(await seo.withSeoJobLock('integration-lock',async()=>true),true);
  });
  it('preserves cached inspection state on rediscovery and fails closed on empty source',async()=>{
    const specs=[{url:`https://example.invalid/${randomUUID()}`,language:'en',group:'station'}];
    assert.equal((await gsc.pgGscSyncDiscovery(specs,14*86400000)).inserted,1);
    await pool.query("UPDATE gsc_url_inspections SET state='indexed',last_error='prior',error_count=3 WHERE url=$1",[specs[0].url]);
    assert.equal((await gsc.pgGscSyncDiscovery(specs,14*86400000)).refreshed,1);
    const listed=await gsc.pgGscList({search:specs[0].url});assert.equal(listed.rows[0].state,'indexed');assert.equal(listed.rows[0].errorCount,3);
    await assert.rejects(gsc.pgGscSyncDiscovery([],0),/empty sitemap/);assert.equal((await gsc.pgGscList({search:specs[0].url})).total,1);
  });
  it('reserves the shared daily inspection quota and fences expired workers',async()=>{
    const prefix=`https://quota.invalid/${randomUUID()}`;
    await gsc.pgGscSyncDiscovery(Array.from({length:600},(_,n)=>({url:`${prefix}/${n}`,language:'de',group:'station'})),14*86400000);
    const claims=(await Promise.all(Array.from({length:10},()=>gsc.pgGscClaimInspection('integration-property',200,250)))).flat();
    assert.equal(claims.length,250);assert.equal(new Set(claims.map(row=>row.id)).size,250);
    assert.equal((await gsc.pgGscClaimInspection('integration-property',200,250)).length,0);
    const row=claims[0];assert.equal(await gsc.pgGscBeginInspection(row.id,row.inspectionLeaseToken),true);
    assert.equal(await gsc.pgGscSaveInspection(row.id,'wrong-lease',{state:'indexed'}),false);
    await pool.query("UPDATE gsc_url_inspections SET inspection_lease_until=now()-interval '1 second' WHERE id=$1",[row.id]);
    assert.equal(await gsc.pgGscSaveInspection(row.id,row.inspectionLeaseToken,{state:'indexed'}),false);
    assert.equal(await gsc.pgGscBeginInspection(row.id,row.inspectionLeaseToken),false);
  });
  it('claims resubmissions once and records cooldown even when an external submission fails',async()=>{
    await pool.query("UPDATE gsc_url_inspections SET state='discovered-not-indexed',not_indexed_since=now()-interval '30 days' WHERE id IN (SELECT id FROM gsc_url_inspections LIMIT 5)");
    const cutoff=new Date(Date.now()-14*86400000),cooldown=new Date(Date.now()-7*86400000);
    const claims=await Promise.all(Array.from({length:5},()=>gsc.pgGscClaimResubmit(cutoff,cooldown,10)));
    assert.equal(claims.flat().length,5);assert.equal(new Set(claims.flat().map(row=>row.id)).size,5);
    for(const rows of claims)await gsc.pgGscSaveResubmit(rows,new Date(),'failed','offline test');
    assert.equal((await gsc.pgGscClaimResubmit(cutoff,cooldown,10)).length,0);
    assert.equal((await pool.query("SELECT count(*)::int count FROM gsc_url_inspections WHERE resubmit_count=1 AND last_resubmit_status='failed'")).rows[0].count,5);
  });
  it('rolls up native GSC state with atomic daily snapshots and removes obsolete daily groups',async()=>{
    const {gscInspectionService}=await import('../src/services/gsc-inspection');
    const stats=await gscInspectionService.recordDailySnapshot('offline integration');assert.ok(stats?.rows);
    const rows=await gsc.pgGscSnapshots(new Date('2000-01-01'),'all','all');
    assert.equal(rows.length,1);assert.equal(rows[0].total,(await gsc.pgGscCounts(new Date())).total);
    const date=rows[0].date;
    await gsc.pgGscSaveSnapshots([{...rows[0],date,total:0,indexed:0,crawledNotIndexed:0,discoveredNotIndexed:0,excluded:0,error:0,pending:0,unknown:0}]);
    assert.equal((await gsc.pgGscSnapshots(new Date('2000-01-01'))).length,1);
  });
  it('consumes OAuth state once, binds it to the admin session, and replaces credentials atomically',async()=>{
    const state=await gsc.pgGscCreateOAuthState('session-1');assert.equal(await gsc.pgGscConsumeOAuthState(state,'wrong-session'),false);
    const results=await Promise.all(Array.from({length:10},()=>gsc.pgGscConsumeOAuthState(state,'session-1')));assert.equal(results.filter(Boolean).length,1);
    await gsc.pgGscReplaceOAuthToken({refreshToken:'offline-token-a',connectedEmail:'test@example.invalid'});
    await assert.rejects(gsc.pgGscReplaceOAuthToken({refreshToken:null}),/null value/);assert.equal((await gsc.pgGscOAuthToken()).refreshToken,'offline-token-a');
    await gsc.pgGscReplaceOAuthToken(null);assert.equal(await gsc.pgGscOAuthToken(),null);
  });
  it('rejects OAuth callbacks before token exchange unless the exact admin session owns live state',async()=>{
    const {handleOAuthCallback}=await import('../src/routes/gsc-inspection');
    const state=await gsc.pgGscCreateOAuthState('callback-admin');let redirected='';
    const response={redirect:(target:string)=>{redirected=target;}} as any;
    await handleOAuthCallback({query:{state,code:'must-not-exchange'},sessionID:'other-session'} as any,response);
    assert.equal(redirected,'/admin/gsc-inspection?oauth_error=invalid_state');
    await handleOAuthCallback({query:{state,error:'access_denied'},sessionID:'callback-admin'} as any,response);
    assert.equal(redirected,'/admin/gsc-inspection?oauth_error=access_denied');
    await handleOAuthCallback({query:{state,code:'must-not-exchange'},sessionID:'callback-admin'} as any,response);
    assert.equal(redirected,'/admin/gsc-inspection?oauth_error=invalid_state');
  });
});
