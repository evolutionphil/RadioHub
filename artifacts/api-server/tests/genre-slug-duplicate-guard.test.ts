import { test,before,after,beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Server } from 'node:http';
import { createNativePostgresFixture } from './helpers/native-postgres-fixture';
import { registerGenresCountriesRoutes } from '../src/routes/genres-countries-routes';

let fixture:Awaited<ReturnType<typeof createNativePostgresFixture>>,server:Server,base:string;
before(async()=>{
  fixture=await createNativePostgresFixture('genre_update_unique');
  const app=express();app.use(express.json());registerGenresCountriesRoutes(app,{requireAdmin:(_req:any,_res:any,next:any)=>next()});
  server=await new Promise<Server>(resolve=>{const running=app.listen(0,'127.0.0.1',()=>resolve(running));});
  base='http://127.0.0.1:'+(server.address() as any).port;
});
after(async()=>{if(server)await new Promise<void>(resolve=>server.close(()=>resolve()));if(fixture)await fixture.close();});
beforeEach(async()=>{await fixture.clear('genres');await fixture.pool.query('DROP TRIGGER IF EXISTS race_duplicate ON genres');});
const update=(id:string,slug:string)=>fetch(base+'/api/genres/'+id,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({slug})});

test('PUT /api/genres/:id rejects a slug owned by another genre before updating',async()=>{
  await fixture.insert('genres',{_id:'g-pop',name:'Pop',slug:'pop'});
  await fixture.insert('genres',{_id:'g-rock',name:'Rock',slug:'rock'});
  const response=await update('g-pop','rock');assert.equal(response.status,409);
  const body=await response.json() as any;assert.match(body.error,/rock/);assert.match(body.error,/already used/i);
  assert.equal((await fixture.pool.query("SELECT slug FROM genres WHERE id='g-pop'")).rows[0].slug,'pop');
  assert.equal((await fixture.pool.query('SELECT count(*)::int AS n FROM genres')).rows[0].n,2);
});

test('PUT /api/genres/:id translates a database uniqueness race (23505) into 409',async()=>{
  await fixture.insert('genres',{_id:'g-blues',name:'Blues',slug:'blues'});
  // The pre-check passes; the actual SQL update then receives the same SQLSTATE
  // as a competing insert committing after that pre-check.
  await fixture.pool.query("CREATE OR REPLACE FUNCTION reject_slug_race() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'duplicate slug' USING ERRCODE='23505',CONSTRAINT='genres_slug_key'; END $$");
  await fixture.pool.query('CREATE TRIGGER race_duplicate BEFORE UPDATE ON genres FOR EACH ROW EXECUTE FUNCTION reject_slug_race()');
  const response=await update('g-blues','jazz');assert.equal(response.status,409);
  const body=await response.json() as any;assert.match(body.error,/jazz/);assert.match(body.error,/already used/i);
  assert.equal((await fixture.pool.query("SELECT slug FROM genres WHERE id='g-blues'")).rows[0].slug,'blues');
});

test('PostgreSQL materializes the unique slug index with distinct NULLs',async()=>{
  const row=(await fixture.pool.query(`SELECT i.indisunique,i.indnullsnotdistinct,pg_get_indexdef(i.indexrelid) definition
    FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
    WHERE i.indrelid='genres'::regclass AND c.relname='genres_slug_key'`)).rows[0];
  assert.ok(row,'the database must have its slug uniqueness safety net');
  assert.equal(row.indisunique,true);assert.equal(row.indnullsnotdistinct,false);
  assert.match(row.definition,/\(slug\)/);
});

test('PostgreSQL rejects direct duplicate slug writes but permits multiple hidden slug-less rows',async()=>{
  await fixture.insert('genres',{name:'Rock',slug:'rock'});
  await assert.rejects(fixture.insert('genres',{name:'Rock Music',slug:'rock'}),(error:any)=>error.code==='23505' && error.constraint==='genres_slug_key');
  await fixture.insert('genres',{name:'Hidden A',slug:null,isDiscoverable:false});
  await fixture.insert('genres',{name:'Hidden B',slug:null,isDiscoverable:false});
  assert.equal((await fixture.pool.query('SELECT count(*)::int AS n FROM genres WHERE slug IS NULL')).rows[0].n,2);
  await assert.rejects(fixture.insert('genres',{name:'Visible without slug',slug:null,isDiscoverable:true}),(error:any)=>error.code==='23514');
});
