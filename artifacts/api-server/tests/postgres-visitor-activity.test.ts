import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {test} from 'node:test';
import {pgTrackVisitorActivity,pgVisitorActivity,pgAutomatedVisitors,pgPruneVisitorActivity,decodeActivityCursor,type VisitorActivityWrite} from '../src/data/postgres-visitor-activity';
const event:VisitorActivityWrite={ip:'198.51.100.19',context:{countryCode:'DE',channel:'web',platform:'web',deviceType:'desktop',os:'Windows',browser:'Chrome',contextSource:'user-agent'},
  trafficKind:'qualified',path:'/en/station/radio',action:'station-view',method:'GET',status:200,source:'http',referralCategory:'direct-or-unknown',automationStatus:'browser-like'};
test('activity errors rollback/release and do not leak transactions',async()=>{
  for(const rollbackFails of [false,true]){
    const queries:string[]=[],released:boolean[]=[];
    const pool:any={connect:async()=>({query:async(q:any)=>{queries.push(q.text);assert.equal(q.query_timeout,3000);
      if(q.text.startsWith('WITH') || (rollbackFails&&q.text==='ROLLBACK'))throw new Error('failed');return {rows:[]};},release:(discard:boolean)=>released.push(discard)})};
    await assert.rejects(pgTrackVisitorActivity(event,pool));assert.equal(queries[0],"BEGIN; SET LOCAL statement_timeout='3s'");
    assert.equal(queries.at(-1),'ROLLBACK');assert.deepEqual(released,[rollbackFails]);
  }
});
test('activity persistence/privacy/quota/retention use real PostgreSQL semantics',{skip:!process.env.RADIOHUB_PGLITE_ENTRY,timeout:90000},async()=>{
  const {PGlite}=await import(pathToFileURL(process.env.RADIOHUB_PGLITE_ENTRY!).href);const db=await PGlite.create();
  const pool:any={connect:async()=>({query:async(q:any)=>{
    if(q.text.startsWith('BEGIN')){await db.exec(q.text);return {rows:[]};}
    const result=await db.query(q.text,q.values);return {...result,rowCount:result.affectedRows??result.rows.length};},release:()=>{}})};
  try{
    await db.exec('CREATE TABLE runtime_app_state(key text PRIMARY KEY,value jsonb NOT NULL); CREATE TABLE qualified_visitor_presence(ip_address inet PRIMARY KEY);');
    await db.exec(await readFile(new URL('../../../lib/db/migrations/0040_visitor_activity.sql',import.meta.url),'utf8'));
    assert.deepEqual((await pgAutomatedVisitors(25,null,pool)).visitors,[]);
    await pgTrackVisitorActivity(event,pool);
    await pgTrackVisitorActivity({...event,trafficKind:'automated',automationStatus:'automated'},pool);
    assert.equal((await db.query('SELECT count(*)::int n FROM qualified_visitor_presence')).rows[0].n,0);
    const subjects=(await db.query('SELECT id,traffic_kind FROM visitor_activity_subjects')).rows;
    assert.equal(subjects.length,2);const qualified=subjects.find((s:any)=>s.traffic_kind==='qualified').id;
    const bots=await pgAutomatedVisitors(25,null,pool);assert.equal(bots.visitors.length,1);assert.equal(bots.visitors[0].maskedIp,'198.51.100.0/24');
    assert.ok(!JSON.stringify(bots).includes('198.51.100.19'));
    await pgTrackVisitorActivity({...event,path:'/en/about',action:'page-view'},pool);
    // Cursor preserves microseconds so same-millisecond observations are not lost.
    await db.exec(`UPDATE visitor_activity_events SET occurred_at=now()-interval '1 second' WHERE subject_id='${qualified}'`);
    const first=await pgVisitorActivity(qualified,1,null,pool);assert.equal(first!.events.length,1);assert.ok(first!.nextCursor);
    const cursor=decodeActivityCursor(first!.nextCursor);assert.ok(cursor);
    const second=await pgVisitorActivity(qualified,1,cursor,pool);assert.equal(second!.events.length,1);
    assert.notEqual(first!.events[0].id,second!.events[0].id);assert.equal(second!.nextCursor,null);
    assert.ok(!JSON.stringify(first).includes('198.51.100'));assert.equal(first!.trafficKind,'qualified');
    const unknown=await pgVisitorActivity('00000000-0000-4000-8000-000000000000',50,null,pool);assert.equal(unknown,null);
    for(let i=0;i<65;i++)await pgTrackVisitorActivity(event,pool);
    assert.equal((await db.query('SELECT count(*)::int n FROM visitor_activity_events WHERE subject_id=$1',[qualified])).rows[0].n,60);
    for(let i=0;i<8;i++)await pgTrackVisitorActivity({...event,trafficKind:'automated',automationStatus:'automated'},pool);
    assert.equal((await db.query("SELECT hour_events FROM visitor_activity_subjects WHERE traffic_kind='automated'")).rows[0].hour_events,6);
    for(const bad of [{path:'/en?secret=1'},{path:'/en#secret'},{status:301},{automationStatus:'human'}])await assert.rejects(pgTrackVisitorActivity({...event,...bad,ip:'198.51.100.20'} as any,pool));
    await db.exec("UPDATE visitor_activity_events SET occurred_at=now()-interval '8 days'; UPDATE visitor_activity_subjects SET last_seen_at=now()-interval '31 days'");
    assert.equal((await pgVisitorActivity(qualified,50,null,pool))!.events.length,0);assert.equal((await pgAutomatedVisitors(25,null,pool)).visitors.length,0);
    await pgPruneVisitorActivity(pool);
    assert.equal((await db.query('SELECT count(*)::int n FROM visitor_activity_events')).rows[0].n,0);
    assert.equal((await db.query('SELECT count(*)::int n FROM visitor_activity_subjects')).rows[0].n,0);
  }finally{await db.close();}
});
