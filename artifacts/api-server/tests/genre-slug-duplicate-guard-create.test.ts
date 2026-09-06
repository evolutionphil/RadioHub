import { test,before,after,beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Server } from 'node:http';
import { createNativePostgresFixture } from './helpers/native-postgres-fixture';
import { registerGenresCountriesRoutes } from '../src/routes/genres-countries-routes';

let fixture:Awaited<ReturnType<typeof createNativePostgresFixture>>,server:Server,base:string;
before(async()=>{
  fixture=await createNativePostgresFixture('genre_create_unique');
  const app=express();app.use(express.json());registerGenresCountriesRoutes(app,{requireAdmin:(_req:any,_res:any,next:any)=>next()});
  server=await new Promise<Server>(resolve=>{const running=app.listen(0,'127.0.0.1',()=>resolve(running));});
  base='http://127.0.0.1:'+(server.address() as any).port;
});
after(async()=>{if(server)await new Promise<void>(resolve=>server.close(()=>resolve()));if(fixture)await fixture.close();});
beforeEach(async()=>{await fixture.clear('genres');await fixture.pool.query('DROP TRIGGER IF EXISTS race_duplicate ON genres');});
const create=(name:string,slug:string)=>fetch(base+'/api/genres',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name,slug})});

test('POST /api/genres returns 409 for an existing exact slug without attempting an insert',async()=>{
  await fixture.insert('genres',{_id:'g-rock',name:'Rock',slug:'rock'});
  // If the route disregards the pre-check and attempts INSERT, it would get
  // 500 from this different fault rather than the expected descriptive 409.
  await fixture.pool.query("CREATE FUNCTION no_insert_after_collision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'unexpected insert' USING ERRCODE='P0001'; END $$");
  await fixture.pool.query('CREATE TRIGGER race_duplicate BEFORE INSERT ON genres FOR EACH ROW EXECUTE FUNCTION no_insert_after_collision()');
  const response=await create('Rock Music','rock');assert.equal(response.status,409);
  const body=await response.json() as any;assert.equal(typeof body.error,'string');assert.match(body.error,/rock/);assert.match(body.error,/already exists/i);
  assert.equal((await fixture.pool.query('SELECT count(*)::int AS n FROM genres')).rows[0].n,1);
});

test('POST /api/genres translates a database uniqueness race (23505) into 409',async()=>{
  await fixture.pool.query("CREATE FUNCTION reject_create_race() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'duplicate slug' USING ERRCODE='23505',CONSTRAINT='genres_slug_key'; END $$");
  await fixture.pool.query('CREATE TRIGGER race_duplicate BEFORE INSERT ON genres FOR EACH ROW EXECUTE FUNCTION reject_create_race()');
  const response=await create('Jazz','jazz');assert.equal(response.status,409);
  const body=await response.json() as any;assert.match(body.error,/jazz/);assert.match(body.error,/already exists/i);
  assert.equal((await fixture.pool.query('SELECT count(*)::int AS n FROM genres')).rows[0].n,0);
});
