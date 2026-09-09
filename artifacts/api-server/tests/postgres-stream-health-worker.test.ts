import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { before,after,beforeEach,describe,it } from 'node:test';
import pg from 'pg';
import { PostgresStreamHealthStore, type HealthCandidate } from '../src/data/postgres-stream-health-store';
const connectionString=process.env.PG_TEST_DATABASE_URL;
if (connectionString && !/^postgres(?:ql)?:\/\/[^@]*@(?:127\.0\.0\.1|localhost):\d+\/[^?]*test[^?]*$/.test(connectionString))
  throw new Error('Stream worker tests require an explicit loopback test database');
describe('durable bounded stream health without station deletion', {skip:!connectionString}, () => {
  const schema='health_worker_'+randomBytes(8).toString('hex');
  const admin=new pg.Pool({connectionString,ssl:false,max:1});
  let pool:pg.Pool,store:PostgresStreamHealthStore;
  const start=new Date('2026-01-03T12:00:00Z');
  const later=(mins:number)=>new Date(+start+mins*60_000);
  const result=(time:Date,outcome:'healthy'|'failed'|'inconclusive')=>({outcome,checkedAt:time.toISOString(),bytesRead:1024,reason:'fixture'});
  before(async()=>{
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool=new pg.Pool({connectionString,ssl:false,max:3,options:`-c search_path=${schema}`});
    await pool.query(`CREATE TABLE stations(id text PRIMARY KEY,url text,url_resolved text,last_check_ok boolean,
      last_check_time timestamptz,manual_edit_fields jsonb DEFAULT '{}',no_index boolean DEFAULT true,
      source jsonb DEFAULT '{"preserved":"article","lastCheckOkTime":"2025-01-01"}',updated_at timestamptz DEFAULT '2025-01-01');
      CREATE TABLE user_favorites(user_id text,station_id text REFERENCES stations(id));`);
    await pool.query(await readFile(new URL('../../../lib/db/migrations/0028_station_stream_health.sql',import.meta.url),'utf8'));
    store=new PostgresStreamHealthStore(pool);
  });
  beforeEach(async()=>{
    await pool.query('TRUNCATE user_favorites,station_stream_health,stations');
    await pool.query(`UPDATE station_stream_health_control SET next_run_at=$1,summary='{}'`,[start]);
    await pool.query(`INSERT INTO stations(id,url,last_check_ok,last_check_time) VALUES('one','https://example.invalid/stream',true,'2025-01-01');
      INSERT INTO user_favorites VALUES('user','one')`);
  });
  after(async()=>{await pool?.end();try{assert.match(schema,/^health_worker_[a-f0-9]{16}$/);await admin.query(`DROP SCHEMA "${schema}" CASCADE`);}finally{await admin.end();}});
  const row=async()=> (await pool.query("SELECT * FROM stations WHERE id='one'")).rows[0];
  const due=async(now:Date)=>{await pool.query('UPDATE station_stream_health SET next_check_at=$1',[now]);return (await store.claim(now))[0];};
  it('hides only after separated repeated failure; heals; retains articles/favorites/noIndex/lastmod',async()=>{
    const original=await row(); let candidate=(await store.claim(start))[0];
    assert.equal(await store.complete(candidate,result(start,'failed'),start),false);
    assert.equal((await row()).last_check_ok,true);
    candidate=await due(later(15));
    assert.equal(await store.complete(candidate,result(later(15),'failed'),later(15)),true);
    const hidden=await row();assert.equal(hidden.last_check_ok,false);assert.equal(hidden.no_index,true);
    assert.equal(hidden.source.preserved,'article');assert.deepEqual(hidden.updated_at,original.updated_at);
    assert.equal((await pool.query('SELECT count(*)::int n FROM user_favorites')).rows[0].n,1);
    candidate=await due(later(30));
    assert.equal(await store.complete(candidate,result(later(30),'healthy'),later(30)),true);
    assert.equal((await row()).last_check_ok,true);assert.equal((await row()).no_index,true);
  });
  it('shares batch quota between replicas and restarts, excludes active leases, caps12',async()=>{
    await pool.query(`INSERT INTO stations(id,url,last_check_ok) SELECT 'station-'||n,'https://example.invalid/'||n,true FROM generate_series(1,30) n`);
    const [a,b]=await Promise.all([store.claim(start),new PostgresStreamHealthStore(pool).claim(start)]);
    assert.equal(a.length+b.length,12);assert.equal((await store.claim(later(1))).length,0);
    const next=await store.claim(later(2));assert.equal(next.length,12);
    assert.equal(next.some(n=>[...a,...b].some(p=>p.id===n.id)),false);
  });
  it('unknown results preserve availability and reset consecutive negatives',async()=>{
    let candidate=(await store.claim(start))[0];await store.complete(candidate,result(start,'failed'),start);
    candidate=await due(later(15));await store.complete(candidate,result(later(15),'inconclusive'),later(15));
    candidate=await due(later(30));await store.complete(candidate,result(later(30),'failed'),later(30));
    assert.equal((await row()).last_check_ok,true);
  });
  for(const change of ['url','health','manual','token']) it(`fences concurrent ${change} edits`,async()=>{
    const candidate=(await store.claim(start))[0];
    await pool.query("UPDATE stations SET last_check_ok=false WHERE id='one'");
    if(change==='url') await pool.query("UPDATE stations SET url='https://example.invalid/new'");
    if(change==='health') await pool.query('UPDATE stations SET last_check_time=$1',[later(1)]);
    if(change==='manual') await pool.query("UPDATE stations SET manual_edit_fields='{\"lastCheckOk\":true}'");
    if(change==='token') await pool.query("UPDATE station_stream_health SET lease_token='replaced'");
    assert.equal(await store.complete(candidate,result(later(1),'healthy'),later(1)),false);
    assert.equal((await row()).last_check_ok,false);
  });
  it('expired leases recover after restart and circuit pause is durable',async()=>{
    const candidate=(await store.claim(start))[0];
    assert.equal(await store.complete(candidate,result(later(11),'healthy'),later(11)),false);
    assert.equal((await store.claim(later(11)))[0].id,candidate.id);
    await store.finishBatch({paused:true},true,later(11));
    assert.equal((await store.claim(later(24))).length,0);
  });
  it('rejects invalid/future/oversized evidence before any mutation',async()=>{
    const candidate=(await store.claim(start))[0];
    await assert.rejects(store.complete(candidate,{...result(start,'healthy'),bytesRead:65_537},start));
    await assert.rejects(store.complete(candidate,result(later(10),'healthy'),start));
  });
});
