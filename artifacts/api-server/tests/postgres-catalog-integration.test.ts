import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import pg from "pg";
import { PostgresCatalogStore, compileCatalogFilter, pgSaveSyncRun } from "../src/data/postgres-catalog-store";
import { PostgresAdminAuxiliaryStore } from '../src/data/postgres-admin-auxiliary-store';

describe("Catalog SQL predicates", () => {
  it("binds values and paths and rejects unsupported or unsafe queries", () => {
    const result = compileCatalogFilter({ name: "' OR true; --", "logoAssets.status": "completed" });
    assert.ok(!result.sql.includes("OR true"));
    assert.deepEqual(result.values, ["' OR true; --", ["status"], "completed"]);
    assert.throws(() => compileCatalogFilter({ $where: "true" }), /Unsupported/);
    assert.throws(() => compileCatalogFilter({ "__proto__.x": "y" }), /Unsupported/);
    assert.throws(() => compileCatalogFilter({ name: { $options: "i" } }), /require/);
  });
});

const connectionString = process.env.PG_TEST_DATABASE_URL;
describe("PostgreSQL native catalog writes", { skip: !connectionString }, () => {
  const schema = `catalog_test_${process.pid}_${randomBytes(6).toString("hex")}`;
  const ssl = process.env.PG_TEST_SSL === "require" ? { rejectUnauthorized: true } : false;
  const admin = new pg.Pool({ connectionString, ssl, max: 1 });
  let pool: pg.Pool;
  let catalog: PostgresCatalogStore;
  let created = false;
  before(async () => {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    created = true;
    const url = new URL(connectionString!);
    url.searchParams.set("options", `-c search_path=${schema},public`);
    pool = new pg.Pool({ connectionString: url.toString(), ssl, max: 10 });
    const migrations = path.resolve(import.meta.dirname, "../../../lib/db/migrations");
    for (const file of (await readdir(migrations)).filter((file) => /^\d+.*\.sql$/.test(file)).sort()) {
      await pool.query(await readFile(path.join(migrations, file), "utf8"));
    }
    catalog = new PostgresCatalogStore(pool);
  });
  after(async () => {
    if (pool) await pool.end();
    try {
      if (created) {
        assert.match(schema, /^catalog_test_\d+_[a-f0-9]{12}$/);
        await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      }
    } finally { await admin.end(); }
  });
  const station = (id: string) => ({ _id: id, stationuuid: `uuid-${id}`, name: `Station ${id}`, url: `https://example.invalid/${id}`, countryCode: "TR" });

  it("persists canonical columns, metadata and ordered normalized genres atomically", async () => {
    const [doc] = await catalog.insertMany([{ ...station("one"), tags: ["Türkçe Pop", "Jazz", "Jazz"], logoAssets: { status: "pending" }, customValue: 42 }]);
    assert.equal(doc.customValue, 42);
    assert.equal(doc.tags, "Türkçe Pop,Jazz,Jazz");
    const genres = await pool.query("SELECT genre_slug FROM station_genres WHERE station_id='one' ORDER BY position");
    assert.deepEqual(genres.rows.map((row) => row.genre_slug), ["turkce-pop", "jazz"]);
    assert.equal((await catalog.find({ "logoAssets.status": "pending", customValue: { $gte: 40 }, name: /^station/i })).length, 1);
    assert.equal(await catalog.count({ $or: [{ favicon: null }, { favicon: "" }] }), 1);
  });

  it("serializes overlapping inserts and skips duplicate UUID or content keys", async () => {
    const a = station("two"), b = station("three");
    const results = await Promise.all([catalog.insertMany([a,b]), catalog.insertMany([b,a])]);
    assert.equal(results.flat().length, 2);
    assert.equal((await catalog.insertMany([{ ...station("four"), name: a.name, url: a.url }])).length, 0);
    assert.equal((await catalog.insertMany([{ ...station("five"), stationuuid: a.stationuuid }])).length, 0);
  });

  it("rolls back an entire invalid insert batch including genre rows", async () => {
    await assert.rejects(catalog.insertMany([station("rollback"), { ...station("invalid"), url: "" }]));
    assert.equal(await catalog.count({ _id: "rollback" }), 0);
    assert.equal(Number((await pool.query("SELECT count(*) FROM station_genres WHERE station_id='rollback'")).rows[0].count), 0);
  });

  it("preserves manual fields and local ratings during provider refresh", async () => {
    await catalog.update({ _id: "one" }, { $set: { name: "Manual", manualEditFields: { name: true }, votes: 6, clickCount: 7, averageRating: 4, totalRatings: 6 } });
    await catalog.updateProviderBatch([{ uuid: "uuid-one", patch: { name: "Provider", votes: 100, clickCount: 200, averageRating: 0, totalRatings: 0, country: "Türkiye" } }]);
    const doc = await catalog.findById("one");
    assert.equal(doc?.name, "Manual");
    assert.equal(doc?.votes, 6);
    assert.equal(doc?.clickCount, 7);
    assert.equal(doc?.averageRating, 4);
    assert.equal(doc?.totalRatings, 6);
    assert.equal(doc?.providerVotes, 100);
    assert.equal(doc?.providerClickCount, 200);
    assert.equal(doc?.country, "Türkiye");
  });

  it('rechecks missing-logo policy under the provider write lock', async () => {
    for (const [key, presence] of Object.entries({ url: { favicon:'https://example.invalid/current.png' },
      assets: { logoAssets:{status:'processing'} }, uploaded: { hasLogo:true }, local: { faviconLocal:'/images/local.png' } })) {
      const id=`provider-logo-${key}`;
      await catalog.insertMany([{ ...station(id), noIndex:true, ...presence }]);
      await catalog.updateProviderBatch([{ uuid:`uuid-${id}`,patch:{ favicon:'https://example.invalid/stale-provider.png',country:'Updated' } }]);
      const doc=await catalog.findById(id);
      assert.equal(doc?.favicon, 'favicon' in presence ? presence.favicon : null);
      assert.equal(doc?.country, 'Updated');
    }
    await catalog.insertMany([{...station('provider-logo-empty'),noIndex:true}]);
    await catalog.updateProviderBatch([{uuid:'uuid-provider-logo-empty',patch:{favicon:'https://example.invalid/fill.png'}}]);
    assert.equal((await catalog.findById('provider-logo-empty'))?.favicon,'https://example.invalid/fill.png');
  });

  it('fences replaced/cancelled provider runs and never revives terminal progress', async () => {
    await pool.query("INSERT INTO catalog_sync_runs(id,sync_type,status) VALUES ('fenced-run','incremental','running')");
    await catalog.insertMany([{...station('fenced-station'),noIndex:true}],{syncRunId:'fenced-run'});
    const entered=Promise.withResolvers<void>(), resume=Promise.withResolvers<void>();
    const pausedPool={ connect: async () => {
      const client=await pool.connect();
      return { query: async (sql:string, values?:unknown[]) => {
        const result=await client.query(sql,values);
        if (sql.includes('FROM catalog_sync_runs') && sql.includes('FOR SHARE')) { entered.resolve(); await resume.promise; }
        return result;
      }, release: () => client.release() };
    } } as unknown as pg.Pool;
    const inFlight=new PostgresCatalogStore(pausedPool).updateProviderBatch([{uuid:'uuid-fenced-station',patch:{country:'Before takeover'}}],'fenced-run');
    const takeover=await pool.connect();
    let takeoverWrite: Promise<pg.QueryResult> | undefined;
    try {
      await entered.promise;
      const pid=(await takeover.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      takeoverWrite=takeover.query("UPDATE catalog_sync_runs SET status='failed',completed_at=now() WHERE id='fenced-run'");
      let blocked=false;
      for(let attempt=0;attempt<100;attempt++) {
        blocked=(await pool.query("SELECT wait_event_type='Lock' AS blocked FROM pg_stat_activity WHERE pid=$1",[pid])).rows[0]?.blocked;
        if(blocked) break;
        await new Promise(resolve=>setTimeout(resolve,10));
      }
      assert.equal(blocked,true,'takeover must wait for the already fenced transaction to commit');
    } finally {
      resume.resolve();
      await inFlight;
      if(takeoverWrite) await takeoverWrite;
      takeover.release();
    }
    const fenced=(error:any)=>error.code==='SYNC_FENCED';
    await assert.rejects(catalog.updateProviderBatch([{uuid:'uuid-fenced-station',patch:{country:'Stale'}}],'fenced-run'),fenced);
    await assert.rejects(catalog.insertMany([station('rejected-fenced')],{syncRunId:'fenced-run'}),fenced);
    await assert.rejects(pgSaveSyncRun({_id:'fenced-run',status:'running',stationsAdded:100},pool),fenced);
    await assert.rejects(pgSaveSyncRun({_id:'fenced-run',status:'completed'},pool),fenced);
    assert.equal((await catalog.findById('fenced-station'))?.country,'Before takeover');
    assert.equal(await catalog.findById('rejected-fenced'),null);
    const run=(await pool.query("SELECT * FROM catalog_sync_runs WHERE id='fenced-run'")).rows[0];
    assert.equal(run.status,'failed');
    assert.deepEqual(run.counters,{});
    await pool.query("INSERT INTO catalog_sync_runs(id,sync_type,status,cancel_requested) VALUES ('cancel-run','incremental','running',true)");
    await assert.rejects(catalog.insertMany([station('rejected-cancel')],{syncRunId:'cancel-run'}),fenced);
    await assert.rejects(pgSaveSyncRun({_id:'cancel-run',status:'running'},pool),fenced);
    const cancelled={_id:'cancel-run',status:'completed',completedAt:new Date()};
    await pgSaveSyncRun(cancelled,pool);
    assert.equal(cancelled.status,'stopped');
  });

  it('uses the live PostgreSQL blacklist even when a provider batch was prepared earlier',async()=>{
    await pool.query("INSERT INTO catalog_sync_runs(id,sync_type,status) VALUES ('blacklist-run','incremental','running')");
    await pool.query("INSERT INTO station_blacklist(id,name,url,station_uuid,reason) VALUES ('fresh-ban','Banned','https://example.invalid/fresh-ban','uuid-fresh-ban','admin removal')");
    assert.deepEqual(await catalog.insertMany([station('fresh-ban')],{syncRunId:'blacklist-run'}),[]);
    assert.deepEqual(await catalog.insertMany([{...station('other-provider-id'),url:'https://example.invalid/fresh-ban'}],{syncRunId:'blacklist-run'}),[]);
    assert.equal(await catalog.findById('fresh-ban'),null);
    await pool.query("DELETE FROM station_blacklist WHERE id='fresh-ban'");
  });

  it("retains concurrent increments and independent metadata writes", async () => {
    await Promise.all(Array.from({ length: 25 }, (_, i) => catalog.update({ _id: "two" }, { $inc: { clickCount: 1 }, $set: { [`custom.slot${i}`]: i } })));
    const doc = await catalog.findById("two");
    assert.equal(doc?.clickCount, 25);
    assert.equal(Object.keys(doc?.custom).length, 25);
  });

  it("claims a logo only once across concurrent workers and protects replacement jobs", async () => {
    const claims = await Promise.all(["a","b"].map((token) => catalog.update({ _id: "three", "logoAssets.status": { $ne: "processing" } }, { $set: { "logoAssets.status": "processing", "logoAssets.token": token } })));
    assert.equal(claims.reduce((sum, result) => sum + result.matchedCount, 0), 1);
    await catalog.update({ _id: "three" }, { $set: { "logoAssets.token": "new" } });
    assert.equal((await catalog.update({ _id: "three", "logoAssets.token": { $in: ["a","b"] } }, { $set: { hasLogo: false } })).matchedCount, 0);
  });

  it("rejects invalid mutations even when there are no matches and rolls back invalid fields", async () => {
    await assert.rejects(catalog.update({ _id: "absent" }, { $push: { x: 1 } }), /Unsupported/);
    await assert.rejects(catalog.update({ _id: "one" }, { $set: { _id: "changed" } }), /Immutable/);
    await assert.rejects(catalog.update({ _id: "one" }, { $set: { "constructor.prototype.x": true } }), /Unsupported/);
    assert.ok(await catalog.findById("one"));
  });

  it("pages missing descriptions in SQL and treats empty translated strings as incomplete", async () => {
    await catalog.update({ _id:'one' },{ $set:{ descriptions:{ en:{full:'x'.repeat(25)},tr:{full:''} } } });
    await catalog.update({ _id:'two' },{ $set:{ descriptions:{ en:{full:'x'.repeat(25)},tr:{full:'y'.repeat(25)} } } });
    const partial: string[] = [];
    for await (const row of catalog.descriptionFillCandidates('partial',['en','tr'])) partial.push(row._id);
    assert.deepEqual(partial,['one']);
    const empty: string[] = [];
    for await (const row of catalog.descriptionFillCandidates('empty',['en','tr'])) empty.push(row._id);
    assert.deepEqual(empty,['three']);
    await catalog.update({ _id:'one' },{ $set:{ noIndex:true } });
    const excluded = [];
    for await (const row of catalog.descriptionFillCandidates('partial',['en','tr'])) excluded.push(row);
    assert.deepEqual(excluded,[]);
  });
  it('supports literal alias membership, whole-array equality and null-safe NOR',async()=>{
    await catalog.patchById('one',{ $set:{ slugAliases:['old-slug','literal.*'] } });
    assert.equal(await catalog.count({ _id:'one',slugAliases:'old-slug' }),1);
    assert.equal(await catalog.count({ _id:'one',slugAliases:'old' }),0);
    assert.equal(await catalog.count({ _id:'one',slugAliases:{ $ne:'old-slug' } }),0);
    assert.equal(await catalog.count({ _id:'one',slugAliases:['old-slug','literal.*'] }),1);
    assert.equal(await catalog.count({ _id:'two',$nor:[{ missingField:'value' }] }),1);
  });
  it('distinguishes matched rows from actual changes, retaining manual edits and timestamps on no-ops',async()=>{
    const before=await catalog.findById('one');
    const result=await catalog.update({_id:'one'},{$set:{name:'Do not overwrite'}},{respectManualFields:true,returnDocument:true});
    assert.equal(result.matchedCount,1);assert.equal(result.modifiedCount,0);assert.equal(result.document?.name,before?.name);
    assert.deepEqual((await catalog.findById('one'))?.updatedAt,before?.updatedAt);
    assert.equal((await catalog.update({_id:'one'},{$set:{name:before?.name}})).modifiedCount,0);
  });
  it('claims actual logo processing once and rejects a stale image completion',async()=>{
    await catalog.patchById('three',{ $set:{ favicon:'https://example.invalid/current.png',logoAssets:{} } });
    const claims = await Promise.all(['a','b'].map(token=>catalog.claimLogo('three',token,'folder-'+token)));
    assert.equal(claims.filter(Boolean).length,1);
    const claimed = await catalog.findById('three');
    await catalog.patchById('three',{ $set:{ favicon:'https://example.invalid/new.png' } });
    assert.equal((await catalog.update({ _id:'three',favicon:'https://example.invalid/current.png','logoAssets.operationId':claimed?.logoAssets.operationId },{ $set:{ favicon:'obsolete' } })).matchedCount,0);
  });
  it('atomically blacklists before deletion and rolls back both on audit failure',async()=>{
    await catalog.insertMany([station('delete-success'),station('delete-fail')]);
    await pool.query(`CREATE FUNCTION reject_blacklist_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.name='Station delete-fail' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$`);
    await pool.query('CREATE TRIGGER reject_blacklist_test BEFORE INSERT ON station_blacklist FOR EACH ROW EXECUTE FUNCTION reject_blacklist_test()');
    await assert.rejects(catalog.remove({ _id:{ $in:['delete-success','delete-fail'] } },{ reason:'admin test' }),/audit unavailable/);
    assert.equal(await catalog.count({ _id:{ $in:['delete-success','delete-fail'] } }),2);
    assert.equal(Number((await pool.query('SELECT count(*) FROM station_blacklist')).rows[0].count),0);
    await pool.query('DROP TRIGGER reject_blacklist_test ON station_blacklist');
    const removed = await catalog.remove({ _id:'delete-success' },{ reason:'admin test' });
    assert.equal(removed.deletedCount,1);
    assert.equal((await pool.query('SELECT reason FROM station_blacklist WHERE station_uuid=$1',['uuid-delete-success'])).rows[0].reason,'admin test');
  });
  it('merges concurrently without losing favourites, ratings or listening history',async()=>{
    await catalog.insertMany([{ ...station('merge-a'),name:'Same station',country:'TR',votes:5,clickCount:2 },{ ...station('merge-b'),name:' same STATION ',country:'TR',votes:3,clickCount:4 }]);
    await pool.query("INSERT INTO users(id,username,email,full_name) VALUES ('merge-user','merge-user','merge@example.invalid','Merge User')");
    await pool.query("INSERT INTO user_favorites(user_id,station_id) VALUES('merge-user','merge-b')");
    await pool.query("INSERT INTO station_ratings(id,station_id,user_id,rating) VALUES('merge-rating','merge-b','merge-user',4)");
    await pool.query("INSERT INTO listening_history(id,session_id,station_id,station_name,interaction_type,listened_at) VALUES('merge-history','s','merge-b','same','play',now())");
    const results = await Promise.all([catalog.mergeDuplicates(['merge-a','merge-b']),catalog.mergeDuplicates(['merge-b','merge-a'])]);
    assert.equal(results.reduce((sum,row)=>sum+row.deletedCount,0),1);
    const primary = await catalog.findById('merge-a');
    assert.equal(primary?.votes,8); assert.equal(primary?.clickCount,6);assert.equal(primary?.averageRating,4);assert.equal(primary?.totalRatings,1);
    assert.equal((await pool.query("SELECT station_id FROM user_favorites WHERE user_id='merge-user'")).rows[0].station_id,'merge-a');
    assert.equal((await pool.query("SELECT station_id FROM listening_history WHERE id='merge-history'")).rows[0].station_id,'merge-a');
    assert.equal((await pool.query("SELECT station_id FROM station_ratings WHERE id='merge-rating'")).rows[0].station_id,'merge-a');
  });
  it('restores blacklists atomically and keeps a failed restore recoverable',async()=>{
    const bl = (await pool.query("SELECT id FROM station_blacklist WHERE station_uuid='uuid-delete-success'")).rows[0];
    await assert.rejects(catalog.restoreBlacklisted(bl.id,{ bitrate:'invalid-integer' }));
    assert.equal(Number((await pool.query('SELECT count(*) FROM station_blacklist WHERE id=$1',[bl.id])).rows[0].count),1);
    const restored = await catalog.restoreBlacklisted(bl.id,{ countrycode:'TR',language:'turkish',hls:1,languagecodes:['tr'] });
    assert.equal(restored?.countryCode,'TR');assert.equal(restored?.language,'turkish');assert.equal(restored?.hls,true);assert.equal(restored?.languageCodes,'tr');
    assert.equal(Number((await pool.query('SELECT count(*) FROM station_blacklist WHERE id=$1',[bl.id])).rows[0].count),0);
  });
  it('preserves station IDs and dependent records on atomic snapshot replacement',async()=>{
    await assert.rejects(catalog.importSnapshot([{ ...station('merge-a'),name:'Changed' },{ ...station('bad-snapshot'),bitrate:'not-integer' }],true));
    assert.equal((await catalog.findById('merge-a'))?.name,'Same station');
    assert.ok(await catalog.findById('two'));
    const result = await catalog.importSnapshot([{ ...station('replacement-id'),stationuuid:'uuid-merge-a',name:'Imported',language:'turkish' }],true);
    assert.equal(result.imported,1);assert.ok(result.removed>0);
    assert.equal(await catalog.count(),1);assert.equal((await catalog.findById('merge-a'))?.name,'Imported');
    assert.equal((await pool.query("SELECT station_id FROM user_favorites WHERE user_id='merge-user'")).rows[0].station_id,'merge-a');
  });
  it('publishes frequency redirects and canonical aliases atomically and repairs partial legacy redirects',async()=>{
    await catalog.insertMany([{...station('frequency-a'),slug:'radio-959',slugAliases:['older']},{...station('frequency-b'),slug:'radio-95-9'}]);
    await pool.query(`CREATE FUNCTION reject_redirect_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id='frequency-b' AND NEW.no_index=true THEN RAISE EXCEPTION 'redirect failed'; END IF; RETURN NEW; END $$`);
    await pool.query('CREATE TRIGGER reject_redirect_test BEFORE UPDATE ON stations FOR EACH ROW EXECUTE FUNCTION reject_redirect_test()');
    await assert.rejects(catalog.redirectDuplicates('frequency-a','radio-959',[{id:'frequency-b',slug:'radio-95-9'}]),/redirect failed/);
    assert.deepEqual((await catalog.findById('frequency-a'))?.slugAliases,['older']);
    assert.equal((await catalog.findById('frequency-b'))?.noIndex,false);
    await pool.query('DROP TRIGGER reject_redirect_test ON stations');
    assert.equal(await catalog.redirectDuplicates('frequency-a','radio-959',[{id:'frequency-b',slug:'radio-95-9'}]),1);
    assert.equal(await catalog.redirectDuplicates('frequency-a','radio-959',[{id:'frequency-b',slug:'radio-95-9'}]),0);
    assert.deepEqual((await catalog.findById('frequency-a'))?.slugAliases,['older','radio-95-9']);
    await catalog.patchById('frequency-a',{$set:{slugAliases:[]}});
    assert.equal(await catalog.redirectDuplicates('frequency-a','radio-959',[{id:'frequency-b',slug:'radio-95-9'}]),0);
    assert.deepEqual((await catalog.findById('frequency-a'))?.slugAliases,['radio-95-9']);
  });
  it('isolates admin preferences and serializes shared-preset caps and ownership',async()=>{
    const aux = new PostgresAdminAuxiliaryStore(pool);
    await aux.preferenceSet('alice','view',{ language:'tr' });
    assert.equal(await aux.preferenceGet('bob','view'),null);
    assert.deepEqual((await aux.preferenceGet('alice','view'))?.value,{ language:'tr' });
    assert.equal((await aux.preferenceDelete('bob','view')).deletedCount,0);
    const results = await Promise.allSettled(['One','Two'].map(name=>aux.presetCreate({ name,countries:['TR'],ownerUsername:'alice' },1)));
    assert.equal(results.filter(row=>row.status==='fulfilled').length,1);
    const preset = (await aux.presets())[0];
    assert.equal(await aux.presetUpdate(preset._id,'bob',false,{ name:'Stolen' }),null);
    assert.equal(await aux.presetDelete(preset._id,'bob',false),0);
    assert.equal((await aux.presetUpdate(preset._id,'alice',false,{ name:'Changed' }))?.name,'Changed');
    assert.equal(await aux.presetDelete(preset._id,'superadmin',true),1);
  });
  it('replaces SEMrush imports transactionally and excludes expired issues everywhere',async()=>{
    const aux = new PostgresAdminAuxiliaryStore(pool);
    const issue = { url:'https://example.invalid',issueType:'Title',priority:'High',expiresAt:new Date(Date.now()+86400000) };
    assert.equal(await aux.replaceIssues([issue]),1);
    await assert.rejects(aux.replaceIssues([issue,{ ...issue,url:'' }]));
    assert.equal((await aux.issues('','',10,0)).total,1);
    await aux.replaceIssues([issue,{ ...issue,expiresAt:new Date(Date.now()-1000) }]);
    assert.equal((await aux.issues('High','Title',10,0)).items.length,1);
    assert.equal((await aux.issueSummary()).total,1);
    assert.equal((await aux.clearIssues()).deletedCount,2);
  });
});
