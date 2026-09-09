import assert from 'node:assert/strict';
import { beforeEach,mock,test } from 'node:test';
let candidates:any[]=[],observations:any[]=[],completions:any[]=[],summary:any;
let active=0,maximum=0,claimed=0,waitingCount=0;
mock.module('../src/postgres-runtime',{namedExports:{getPostgresPool:()=>({get waitingCount(){return waitingCount;}})}});
mock.module('../src/utils/logger',{namedExports:{logger:{log(){},warn(){}}}});
mock.module('node:perf_hooks',{namedExports:{performance:{eventLoopUtilization:()=>({utilization:0,idle:1,active:0})}}});
mock.module('../src/data/postgres-stream-health-store',{namedExports:{PostgresStreamHealthStore:class{
  async claim(){claimed++;return candidates;}
  async complete(c:any,o:any){completions.push({c,o});return false;}
  async finishBatch(value:any,pause:boolean){summary={...value,pause};}
}}});
mock.module('../src/utils/station-stream-probe',{namedExports:{probeStreamAvailability:async(url:string)=>{
  active++;maximum=Math.max(maximum,active);
  await new Promise(resolve=>setTimeout(resolve,2));active--;
  return observations[Number(url)] || {outcome:'healthy',checkedAt:new Date().toISOString(),bytesRead:1024,reason:'fixture'};
}}});
const {ScheduledStreamHealth}=await import('../src/services/scheduled-stream-health');
beforeEach(()=>{candidates=Array.from({length:12},(_,id)=>({id:String(id),url:String(id)}));observations=[];completions=[];summary=null;active=0;maximum=0;claimed=0;waitingCount=0;});
test('bounds active sockets to2 and does not overlap in-process cycles',async()=>{
  const service=new ScheduledStreamHealth();
  await Promise.all([service.runOnce(),service.runOnce()]);
  assert.equal(claimed,1);assert.equal(maximum,2);assert.equal(completions.length,12);assert.equal(summary.checked,12);
});
test('backs off widespread ambiguity without converting it to false health evidence',async()=>{
  observations=Array.from({length:12},()=>({outcome:'inconclusive',checkedAt:new Date().toISOString(),bytesRead:0,reason:'network-error'}));
  await new ScheduledStreamHealth().runOnce();
  assert.equal(summary.paused,true);assert.equal(summary.pause,true);
  assert.ok(completions.every(row=>row.o.outcome==='inconclusive'));
});
test('leaves capacity to foreground requests when database clients are waiting',async()=>{
  waitingCount=1;await new ScheduledStreamHealth().runOnce();
  assert.equal(claimed,0);assert.equal(maximum,0);
});
test('an idle/not-due queue sends no probes or empty status writes',async()=>{
  candidates=[];await new ScheduledStreamHealth().runOnce();
  assert.equal(maximum,0);assert.equal(summary,null);
});
