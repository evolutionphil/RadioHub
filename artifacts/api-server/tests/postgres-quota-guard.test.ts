import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isQuotaError,safeWrite,isQuotaExceeded } from '../src/utils/quota-guard';
test('PostgreSQL capacity errors never turn a required write into successful null',async()=>{
  assert.equal(isQuotaError({code:'53100'}),true);assert.equal(isQuotaError({code:'23505',message:'quota setting already exists'}),false);
  assert.equal(isQuotaError({code:8000,codeName:'AtlasError'}),false);
  assert.equal(await safeWrite('normal',async()=>7),7);
  await assert.rejects(safeWrite('required',async()=>{throw Object.assign(new Error('disk full'),{code:'53100'});}),(e:any)=>e.code==='53100');
  let called=false;assert.equal(await safeWrite('optional',async()=>{called=true;return 1;},true),null);assert.equal(called,false);
  await assert.rejects(safeWrite('required paused',async()=>1),(e:any)=>e.code==='53100');assert.equal(isQuotaExceeded(),true);
  const now=Date.now;try{Date.now=()=>now()+11*60*1000;assert.equal(await safeWrite('recovered',async()=>2),2);}finally{Date.now=now;}
});
