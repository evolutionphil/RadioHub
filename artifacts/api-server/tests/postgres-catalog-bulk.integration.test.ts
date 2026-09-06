import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {after,before,describe,it} from 'node:test';
import pg from 'pg';
import {PostgresCatalogStore} from '../src/data/postgres-catalog-store';

const connectionString=process.env.PG_TEST_DATABASE_URL;
describe('Set-based PostgreSQL catalog maintenance',{skip:!connectionString},()=>{
  const schema=`bulk_catalog_${process.pid}_${randomBytes(6).toString('hex')}`;
  const admin=new pg.Pool({connectionString,ssl:false,max:1});
  let pool:pg.Pool,catalog:PostgresCatalogStore,instrumented:PostgresCatalogStore,created=false;
  const queries:string[]=[],resultRows:number[]=[];
  before(async()=>{
    await admin.query(`CREATE SCHEMA "${schema}"`);created=true;
    const url=new URL(connectionString!);url.searchParams.set('options',`-c search_path=${schema},public`);
    pool=new pg.Pool({connectionString:url.toString(),ssl:false,max:5});
    const dir=path.resolve(import.meta.dirname,'../../../lib/db/migrations');
    for(const file of(await readdir(dir)).filter(file=>/^\d+.*\.sql$/.test(file)).sort())await pool.query(await readFile(path.join(dir,file),'utf8'));
    catalog=new PostgresCatalogStore(pool);
    instrumented=new PostgresCatalogStore({connect:async()=>{
      const client=await pool.connect();
      return {query:async(text:string,values?:any[])=>{queries.push(text);const result=await client.query(text,values);resultRows.push(result.rowCount||0);return result;},release:()=>client.release()};
    }} as unknown as pg.Pool);
    await pool.query(`INSERT INTO stations(id,station_uuid,name,url,tags_raw,descriptions,source)
      SELECT 'row-'||lpad(n::text,4,'0'),'uuid-'||n,'Station '||n,'https://example.invalid/'||n,'Pop,Jazz',
        jsonb_build_object('en',jsonb_build_object('full',repeat('A real description. ',200))),
        jsonb_build_object('city','Original','tagsCheckedAt','2026-01-01T00:00:00.000Z','aiDescriptionSkipped',true)
      FROM generate_series(1,1000) n`);
    await pool.query(`INSERT INTO station_genres(station_id,genre_slug,position)
      SELECT id,tag,position FROM stations CROSS JOIN (VALUES('pop',0),('jazz',1)) AS tags(tag,position)`);
    await pool.query(`CREATE TABLE genre_write_observations(operation text);
      CREATE FUNCTION observe_genre_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        INSERT INTO genre_write_observations VALUES(TG_OP);RETURN NULL;END $$;
      CREATE TRIGGER observe_genre_write AFTER INSERT OR DELETE ON station_genres FOR EACH STATEMENT EXECUTE FUNCTION observe_genre_write()`);
  });
  after(async()=>{
    if(pool)await pool.end();
    try{if(created){assert.match(schema,/^bulk_catalog_\d+_[a-f0-9]{12}$/);await admin.query(`DROP SCHEMA "${schema}" CASCADE`);}}
    finally{await admin.end();}
  });
  const noGenreWrites=async()=>assert.equal((await pool.query('SELECT count(*)::int count FROM genre_write_observations')).rows[0].count,0);
  it('clears 1000 source metadata fields in three round-trips and returns no station payloads',async()=>{
    queries.length=0;resultRows.length=0;
    const result=await instrumented.update({tagsCheckedAt:{$exists:true}},{$unset:{tagsCheckedAt:''}},{many:true});
    assert.deepEqual(result,{matchedCount:1000,modifiedCount:1000});assert.equal(queries.length,3);assert.deepEqual(resultRows,[0,1,0]);
    assert.match(queries[1],/WITH matched AS MATERIALIZED/);assert.doesNotMatch(queries[1],/SELECT s\.\*/);
    const stored=(await pool.query("SELECT count(*)::int count FROM stations WHERE NOT(source?'tagsCheckedAt') AND tags_raw='Pop,Jazz' AND descriptions#>>'{en,full}'=repeat('A real description. ',200)")).rows[0];
    assert.equal(stored.count,1000);await noGenreWrites();
  });
  it('keeps matched versus modified counts, source mirrors, literal values and no-op timestamps correct',async()=>{
    const before=(await catalog.findById('row-0001'))!.updatedAt;
    assert.deepEqual(await instrumented.update({_id:'row-0001'},{$set:{noIndex:false}},{many:true}),{matchedCount:1,modifiedCount:0});
    assert.deepEqual((await catalog.findById('row-0001'))!.updatedAt,before);
    assert.deepEqual(await instrumented.update({_id:'row-0001'},{$unset:{tagsCheckedAt:''}},{many:true}),{matchedCount:1,modifiedCount:0});
    const city="Quote ' and $1 -- remain data";
    assert.deepEqual(await instrumented.update({_id:'row-0001'},{$set:{noIndex:true,city},$unset:{aiDescriptionSkipped:1}},{many:true}),{matchedCount:1,modifiedCount:1});
    const row=(await pool.query("SELECT no_index,source FROM stations WHERE id='row-0001'")).rows[0];
    assert.equal(row.no_index,true);assert.equal(row.source.noIndex,true);assert.equal(row.source.city,city);assert.equal('aiDescriptionSkipped' in row.source,false);
    assert.deepEqual(await instrumented.update({_id:'row-0001'},{$set:{noIndex:true,city},$unset:{aiDescriptionSkipped:1}},{many:true}),{matchedCount:1,modifiedCount:0});
    await noGenreWrites();
  });
  it('clears logo assets without rebuilding any unrelated station genres',async()=>{
    await pool.query("UPDATE stations SET logo_assets='{}'::jsonb,source=source||jsonb_build_object('logoAssets','{}'::jsonb) WHERE id='row-0002'");
    assert.deepEqual(await instrumented.update({_id:'row-0002'},{$unset:{logoAssets:''}},{many:true}),{matchedCount:1,modifiedCount:1});
    const row=(await pool.query("SELECT logo_assets,source FROM stations WHERE id='row-0002'")).rows[0];assert.equal(row.logo_assets,null);assert.equal('logoAssets' in row.source,false);
    assert.deepEqual(await instrumented.update({_id:'row-0002'},{$unset:{logoAssets:''}},{many:true}),{matchedCount:1,modifiedCount:0});await noGenreWrites();
  });
  it('rolls back every row and its source mirror when any station update fails',async()=>{
    await pool.query(`CREATE FUNCTION reject_bulk_station() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.id='row-0800' THEN RAISE EXCEPTION 'offline bulk failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_bulk_station BEFORE UPDATE ON stations FOR EACH ROW EXECUTE FUNCTION reject_bulk_station()`);
    try{await assert.rejects(instrumented.update({},{$set:{city:'Never committed'}},{many:true}),/offline bulk failure/);}
    finally{await pool.query('DROP TRIGGER reject_bulk_station ON stations;DROP FUNCTION reject_bulk_station()');}
    assert.equal((await pool.query("SELECT count(*)::int count FROM stations WHERE source->>'city'='Never committed'")).rows[0].count,0);await noGenreWrites();
  });
  it('rechecks a before-image predicate after waiting for a concurrent row editor',async()=>{
    const blocker=await pool.connect();let pending:Promise<any>|undefined;
    try{
      await blocker.query('BEGIN');await blocker.query("UPDATE stations SET source=source||jsonb_build_object('city','Concurrent') WHERE id='row-0003'");
      const started=queries.length;
      pending=instrumented.update({_id:'row-0003',city:'Original'},{$set:{noIndex:true}},{many:true});
      for(let n=0;n<100&&!queries.slice(started).some(query=>query.includes('WITH matched'));n++)await new Promise(resolve=>setTimeout(resolve,5));
      assert.ok(queries.slice(started).some(query=>query.includes('WITH matched')));
      await blocker.query('COMMIT');assert.deepEqual(await pending,{matchedCount:0,modifiedCount:0});
    }finally{await blocker.query('ROLLBACK');blocker.release();if(pending)await pending;}
    assert.equal((await catalog.findById('row-0003'))!.noIndex,false);await noGenreWrites();
  });
  it('preserves manual-field and cancelled-provider fences when many:true is requested',async()=>{
    await catalog.update({_id:'row-0004'},{$set:{'manualEditFields.noIndex':true}});
    assert.deepEqual(await instrumented.update({_id:'row-0004'},{$set:{noIndex:true}},{many:true,respectManualFields:true}),{matchedCount:1,modifiedCount:0});
    await pool.query("INSERT INTO catalog_sync_runs(id,sync_type,status,cancel_requested) VALUES('cancelled-provider','full','running',true)");
    await assert.rejects(instrumented.update({_id:'row-0004'},{$set:{noIndex:true}},{many:true,syncRunId:'cancelled-provider'}),error=>(error as any).code==='SYNC_FENCED');
    assert.equal((await catalog.findById('row-0004'))!.noIndex,false);await noGenreWrites();
  });
  it('skips genre rebuilds for ordinary increments and nested description edits, rebuilding only changed tags',async()=>{
    await instrumented.update({_id:'row-0005'},{$inc:{clickCount:1}});
    await instrumented.update({_id:'row-0005'},{$set:{'descriptions.tr':{full:'Preserved translated description',meta:'Translated'}}});
    await noGenreWrites();
    queries.length=0;
    await instrumented.update({_id:'row-0005'},{$set:{tags:'Rock,Classical,Rock'}});
    assert.equal(queries.filter(query=>query.startsWith('DELETE FROM station_genres')).length,1);
    assert.equal(queries.filter(query=>query.startsWith('INSERT INTO station_genres')).length,1);
    assert.deepEqual((await pool.query("SELECT genre_slug FROM station_genres WHERE station_id='row-0005' ORDER BY position")).rows.map(row=>row.genre_slug),['rock','classical']);
  });
});
