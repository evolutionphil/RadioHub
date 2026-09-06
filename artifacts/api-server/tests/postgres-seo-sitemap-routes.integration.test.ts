import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile,readdir } from 'node:fs/promises';
import path from 'node:path';
import { after,before,describe,it } from 'node:test';
import type { Server } from 'node:http';
import express from 'express';
import pg from 'pg';

const connectionString=process.env.PG_TEST_DATABASE_URL;
describe('PostgreSQL public sitemap and playback diagnostics',{skip:!connectionString},async()=>{
  if(!connectionString)return;
  const schema=`seo_routes_test_${process.pid}_${randomBytes(6).toString('hex')}`;
  const admin=new pg.Pool({connectionString,ssl:false,max:1});const url=new URL(connectionString);
  url.searchParams.set('options',`-c search_path=${schema},public`);process.env.DATABASE_URL=url.toString();process.env.POSTGRES_SSL='disable';
  const {getPostgresPool,closePostgres}=await import('../src/postgres-runtime');const pool=getPostgresPool();
  const seo=await import('../src/data/postgres-seo-indexing-store');
  const debug=await import('../src/data/postgres-station-debug-store');
  const {pgCatalog}=await import('../src/data/postgres-catalog-store');
  let created=false,server:Server|undefined,base='';
  before(async()=>{
    await admin.query(`CREATE SCHEMA "${schema}"`);created=true;
    const dir=path.resolve(import.meta.dirname,'../../../lib/db/migrations');
    for(const file of(await readdir(dir)).filter(file=>/^\d+.*\.sql$/.test(file)).sort())await pool.query(await readFile(path.join(dir,file),'utf8'));
    const {registerSeoSitemapRoutes}=await import('../src/routes/seo-sitemap-routes');
    const app=express();app.use(express.json());
    await registerSeoSitemapRoutes(app,{requireAdmin:(req:any,res:any,next:any)=>req.headers['x-offline-admin']==='allowed'?next():res.status(401).json({error:'unauthorized'})});
    server=await new Promise<Server>(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener));});
    base=`http://127.0.0.1:${(server.address() as any).port}`;
  });
  after(async()=>{
    if(server)await new Promise<void>((resolve,reject)=>server!.close(error=>error?reject(error):resolve()));
    await closePostgres();try{if(created){assert.match(schema,/^seo_routes_test_\d+_[a-f0-9]{12}$/);await admin.query(`DROP SCHEMA "${schema}" CASCADE`);}}finally{await admin.end();}
  });
  const report=(stationId:string,user=0)=>({stationId,stationName:'Berlin Music',stationUrl:'https://stream.example.invalid/live',errorType:'AUDIO_ERROR',errorMessage:'offline',
    userAgent:`browser-${user}`,clientIP:'127.0.0.1',errorDetails:{occurrenceCount:999},stationMeta:{country:'Germany'}});
  it('serializes first report creation, occurrence increments, and unique reporters across workers',async()=>{
    const stationId=randomUUID();
    const results=await Promise.all(Array.from({length:30},(_,n)=>debug.pgReportStationDebugLog(report(stationId,n%3),{occurrenceCount:999})));
    assert.equal(results.filter(row=>row.created).length,1);assert.equal(new Set(results.map(row=>row.row._id)).size,1);
    const {errors,total}=await debug.pgListStationDebugLogs({stationId});assert.equal(total,1);
    assert.equal(errors[0].totalOccurrences,30);assert.equal(errors[0].uniqueUserCount,3);assert.equal(errors[0].reportingUsers.length,3);
    assert.equal(errors[0].errorDetails.occurrenceCount,30);assert.equal(errors[0].clientIP,'127.0.0.1');
  });
  it('starts a new report after the rolling window and prunes only history older than the cutoff',async()=>{
    const stationId=randomUUID(),old=await debug.pgReportStationDebugLog(report(stationId));
    await pool.query("UPDATE station_debug_logs SET timestamp=now()-interval '4 days' WHERE id=$1",[old.row._id]);
    const fresh=await debug.pgReportStationDebugLog(report(stationId));assert.equal(fresh.created,true);assert.notEqual(fresh.row._id,old.row._id);
    assert.equal((await debug.pgPurgeStationDebugLogs(new Date(Date.now()-3*86400000))).deletedCount,1);
    assert.equal(await debug.pgCountStationDebugLogs({stationId,isResolved:false}),1);
  });
  it('serves the playback report and protected paginated admin contracts using native rows',async()=>{
    const stationId=randomUUID();
    const post=()=>fetch(`${base}/api/stations/report-error`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(report(stationId))});
    const first=await post();assert.equal(first.status,200);const firstBody=await first.json() as any;assert.equal(firstBody.success,true);
    const second=await post();const secondBody=await second.json() as any;assert.equal(secondBody.errorId,firstBody.errorId);assert.equal(secondBody.totalOccurrences,2);
    assert.equal((await fetch(`${base}/api/admin/error-logs`)).status,401);
    const response=await fetch(`${base}/api/admin/error-logs?stationId=${stationId}&resolved=false&limit=1`,{headers:{'x-offline-admin':'allowed'}});
    const body=await response.json() as any;assert.equal(response.status,200);assert.equal(body.pagination.total,1);assert.equal(body.errors[0]._id,firstBody.errorId);
  });
  it('keeps sitemap XML, conditional requests, mixed public IDs, and gone chunks working without MongoDB',async()=>{
    const {getQualifiedLanguagesState}=await import('../src/seo/qualified-languages');const state=await getQualifiedLanguagesState();assert.ok(state.languages.includes('en'));
    const stationId=randomBytes(12).toString('hex'),genreId='genre-native-pop';
    const [station]=await pgCatalog().insertMany([{_id:stationId,stationuuid:randomUUID(),name:'Berlin & Music',slug:'berlin-music',url:'https://stream.example.invalid/live',
      country:'Germany',countryCode:'DE',language:'German',languageCodes:'de',bitrate:128,lastCheckOk:true,noIndex:false,favicon:'https://themegaradio.com/logos/berlin.webp'}]);
    await pool.query("INSERT INTO genres(id,name,slug,is_discoverable,station_count) VALUES($1,'Pop','pop',true,25)",[genreId]);
    for(const [type,ids] of [['main',['/','tc:europe/germany']],['genres',[genreId]],['stations',[stationId]]] as const){
      const row=await seo.pgWriteBuildingManifest({type,language:'en',version:`offline-${type}`,qualifiedLanguagesHash:state.hash,qualifiedLanguages:state.languages,
        chunks:[{chunk:1,stationIds:ids,urlCount:ids.length,maxUpdatedAt:station.updatedAt}],totalUrls:ids.length});
      await seo.pgActivateManifest(row.id,type,'en');
    }
    const index=await fetch(`${base}/sitemap-index.xml`);assert.equal(index.status,200);const indexXml=await index.text();
    assert.match(indexXml,/sitemap-stations-en-1\.xml/);assert.match(indexXml,/sitemap-genres-en\.xml/);
    const stations=await fetch(`${base}/sitemap-stations-en-1.xml`);assert.equal(stations.status,200);assert.match(stations.headers.get('content-type')||'',/xml/);
    const xml=await stations.text();assert.match(xml,/berlin-music/);assert.match(xml,/Berlin &amp; Music/);assert.match(xml,/hreflang="en"/);
    const etag=stations.headers.get('etag');assert.ok(etag);
    assert.equal((await fetch(`${base}/sitemap-stations-en-1.xml`,{headers:{'If-None-Match':etag!}})).status,304);
    assert.equal((await fetch(`${base}/sitemap-stations-en-2.xml`)).status,410);
    const genres=await fetch(`${base}/sitemap-genres-en.xml`);assert.equal(genres.status,200);assert.match(await genres.text(),/pop/);
    const main=await fetch(`${base}/sitemap-main-en.xml`);assert.equal(main.status,200);assert.match(await main.text(),/germany/);
    const legacyIndex=await fetch(`${base}/sitemap-en.xml`);assert.equal(legacyIndex.status,200);assert.match(await legacyIndex.text(),/sitemap-stations-en-1/);
    const stats=await fetch(`${base}/api/admin/sitemap/manifest-stats`,{headers:{'x-offline-admin':'allowed'}});assert.equal(stats.status,200);
    const body=await stats.json() as any;assert.equal(body.totalActive,3);assert.equal(body.stationDiag.collectionName,'stations');assert.equal(body.stationDiag.totalDocs,1);
  });
  it('coordinates station lastmod maintenance with the provider sync lock and leaves content unchanged',async()=>{
    const leader=await pool.connect();await leader.query("SELECT pg_advisory_lock(hashtext('radiohub-provider-sync'))");
    try{await assert.rejects(seo.pgTouchSitemapStations(new Date()),error=>(error as any).statusCode===409);}
    finally{await leader.query("SELECT pg_advisory_unlock(hashtext('radiohub-provider-sync'))");leader.release();}
    const before=(await pool.query('SELECT id,name,url,votes FROM stations ORDER BY id')).rows;
    const now=new Date();const touched=await seo.pgTouchSitemapStations(now);assert.equal(touched.matchedCount,1);
    assert.deepEqual((await pool.query('SELECT id,name,url,votes FROM stations ORDER BY id')).rows,before);
    const stored=(await pool.query('SELECT updated_at,source FROM stations')).rows[0];
    assert.ok(stored.updated_at.getTime()>=now.getTime());assert.ok(stored.updated_at.getTime()-now.getTime()<1000);
    assert.equal(stored.source.updatedAt,now.toISOString());
  });
  it('retains stuck/resubmitted/recovered digest boundaries using one consistent SQL rollup',async()=>{
    const {collectStats}=await import('../src/services/scheduled-stuck-resubmit-digest');
    const windowEnd=new Date('2026-06-30T00:00:00Z'),windowStart=new Date('2026-06-23T00:00:00Z'),recoveryStart=new Date('2026-05-31T00:00:00Z'),stuckCutoff=new Date('2026-06-16T00:00:00Z');
    await pool.query(`INSERT INTO gsc_url_inspections(id,url,language,url_group,state,not_indexed_since,last_resubmit_at,last_inspected_at)
      VALUES('digest-a','https://digest.invalid/a','en','station','discovered-not-indexed','2026-06-12T00:00:00Z','2026-06-24T00:00:00Z',NULL),
      ('digest-b','https://digest.invalid/b','en','station','crawled-not-indexed','2026-05-01T00:00:00Z',NULL,NULL),
      ('digest-c','https://digest.invalid/c','en','genre','indexed',NULL,'2026-06-24T00:00:00Z','2026-06-25T00:00:00Z'),
      ('digest-d','https://digest.invalid/d','en','genre','indexed',NULL,'2026-06-24T00:00:00Z','2026-06-24T00:00:00Z'),
      ('digest-e','https://digest.invalid/e','en','country','pending',NULL,'2026-06-30T00:00:00Z',NULL)`);
    const stats=await collectStats({windowEnd,windowStart,recoveryStart,stuckCutoff,stuckDays:14});
    assert.equal(stats.currentlyStuck,2);assert.equal(stats.resubmittedInWindow,3);assert.equal(stats.recoveredAfterResubmit,1);assert.equal(stats.newlyStuckInWindow,1);
    assert.equal(stats.byGroup.length,2);assert.equal(stats.byGroup[0].group,'station');
  });
  it('renders native station data and published custom SEO metadata, not a database-error placeholder',async()=>{
    const {SeoRenderer}=await import('../src/seo-renderer');const renderer=new SeoRenderer();
    const {pgSaveSeoMetadata}=await import('../src/data/postgres-content-store');
    await pgSaveSeoMetadata(null,{pageType:'station_detail',routeKey:'berlin-music',language:'en',title:'Native Radio Title',description:'Native PostgreSQL station description',status:'published'});
    const page=await renderer.renderStaticPage('/en/station/berlin-music','https://themegaradio.com');
    assert.equal(page.pageData?.station?.name,'Berlin & Music');assert.equal(page.pageData?.stationDbError,undefined);
    assert.equal(page.pageData?.notFound,false);assert.equal(page.seoTags.title,'Native Radio Title');
    const unknown=await renderer.renderStaticPage('/en/station/unknown-native-station','https://themegaradio.com');
    assert.equal(unknown.pageData?.notFound,true);
  });
  it('preserves single-hop aliases while refusing to redirect an alias onto a junk station',async()=>{
    const {SeoRenderer}=await import('../src/seo-renderer');const renderer=new SeoRenderer();
    await pgCatalog().update({slug:'berlin-music'},{$set:{slugAliases:['legacy-berlin']}});
    const alias=await renderer.renderStaticPage('/en/station/legacy-berlin','https://themegaradio.com');
    assert.equal(alias.pageData?.redirectTo,'/en/station/berlin-music');
    await pgCatalog().insertMany([{stationuuid:randomUUID(),name:'Pink Noise',slug:'pink-noise',slugAliases:['legacy-noise'],url:'https://stream.example.invalid/noise',noIndex:true}]);
    const junk=await renderer.renderStaticPage('/en/station/legacy-noise','https://themegaradio.com');
    assert.equal(junk.pageData?.stationIsJunk,true);assert.equal(junk.pageData?.redirectTo,undefined);
  });
  it('loads native slug/alias/country/city existence and uses real tag rankings in llms.txt',async()=>{
    await pgCatalog().update({slug:'berlin-music'},{$set:{tags:'pop, rock',state:'Berlin'}});
    await pgCatalog().insertMany([{stationuuid:randomUUID(),name:'Tirana Music',slug:'tirana-music',url:'https://stream.example.invalid/tirana',country:'Albania',state:'Tirana',tags:'pop',lastCheckOk:true}]);
    const existence=await import('../src/seo/slug-existence');await existence.loadSlugExistence();
    assert.equal(existence.isSlugExistenceReady(),true);assert.equal(existence.hasStationSlug('berlin-music'),true);
    assert.equal(existence.getCanonicalStationSlug('legacy-berlin'),'berlin-music');assert.equal(existence.getCanonicalStationSlug('legacy-noise'),null);
    assert.equal(existence.hasGenreSlug('pop'),true);assert.equal(existence.hasCountrySlug('albania'),true);assert.equal(existence.hasCitySlug('albania','tirana'),true);
    const {buildLlmsTxtBody,clearLlmsTxtCache}=await import('../src/seo/llms-txt-builder');clearLlmsTxtCache();
    const body=await buildLlmsTxtBody('https://example.invalid');assert.match(body,/example\.invalid\/en\/genres\/pop/);assert.match(body,/example\.invalid\/en\/regions\/europe\/germany/);
  });
  it('cancels slow SSR catalog queries inside PostgreSQL and restores pooled statement-timeout configuration',async()=>{
    const {pgSeoCatalog}=await import('../src/data/postgres-seo-read-store');const blocker=await pool.connect();
    await blocker.query('BEGIN');await blocker.query('LOCK TABLE stations IN ACCESS EXCLUSIVE MODE');
    const started=Date.now();
    try{await assert.rejects(pgSeoCatalog().findOne({slug:'berlin-music'}),error=>(error as any).code==='57014');}
    finally{await blocker.query('ROLLBACK');blocker.release();}
    assert.ok(Date.now()-started<6500);assert.notEqual((await pool.query('SHOW statement_timeout')).rows[0].statement_timeout,'4s');
    assert.equal((await pgSeoCatalog().findOne({slug:'berlin-music'}))?.name,'Berlin & Music');
  });
});
