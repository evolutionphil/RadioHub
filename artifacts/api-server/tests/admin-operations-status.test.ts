import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { before, beforeEach, after, afterEach, test } from 'node:test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { createNativePostgresFixture } from './helpers/native-postgres-fixture';
import { registerAdminOperationsStatusRoutes } from '../src/routes/admin-operations-status-routes';

let fixture: Awaited<ReturnType<typeof createNativePostgresFixture>>, server: Server, base: string;
before(async () => { fixture = await createNativePostgresFixture('admin_operations'); });
beforeEach(async () => {
  await fixture.clear('stations');
  const app = express();
  registerAdminOperationsStatusRoutes(app, (req,res,next) => req.headers['x-test-admin'] === 'yes' ? next() : void res.sendStatus(403));
  server = await new Promise(resolve => { const instance=app.listen(0,'127.0.0.1',() => resolve(instance)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
after(async () => { await fixture.close(); });
const insertStation = (data: Record<string, unknown>) => fixture.insert('stations', { stationuuid: randomUUID(), ...data });
const get = (path: string) => fetch(base+path, { headers:{'x-test-admin':'yes'} });

test('operational reads require admin and never expose station source/descriptions', async () => {
  for (const path of ['/api/admin/operations-status','/api/admin/radio-browser/stations']) assert.equal((await fetch(base+path)).status,403);
  await insertStation({_id:'a'.repeat(24),name:'Verified',url:'https://radio.example/stream',country:'Austria',lastCheckOk:false,
    availabilityOutcome:'healthy',availabilityCheckedAt:new Date(),isListVisible:true,clickTrend:1,descriptions:{en:{full:'Private large document'}},privateFlag:'not exposed'});
  const response=await get('/api/admin/operations-status'); assert.equal(response.status,200); assert.equal(response.headers.get('cache-control'),'private, no-store');
  const data=await response.json(); assert.equal(data.totals.total,1);assert.equal(data.totals.working,1);assert.equal(data.totals.unavailable,0);
  assert.equal(data.recentChecks[0].lastCheckOk,false);assert.equal(data.recentChecks[0].availabilityStatus,'working');
  assert.equal(data.totals.sslErrors,null);assert.equal(data.recentChecks[0].sslError,null);
  assert.equal(JSON.stringify(data).includes('Private large document'),false); assert.equal('source' in data.stations[0],false);
});
test('provider-false and expired failures stay unverified; only current visibility exclusions populate problems', async () => {
  const shared={url:'https://radio.example/stream',country:'Austria',lastCheckOk:false,availabilityOutcome:'failed'};
  await insertStation({...shared,_id:'a'.repeat(24),name:'Source false'});
  await insertStation({...shared,_id:'b'.repeat(24),name:'Expired',isListVisible:false,visibilityExpiresAt:new Date(Date.now()-1000)});
  await insertStation({...shared,_id:'c'.repeat(24),name:'Excluded',isListVisible:false,visibilityExpiresAt:new Date(Date.now()+3600000)});
  const data=await (await get('/api/admin/operations-status')).json();
  assert.equal(data.totals.total,3);assert.equal(data.totals.unavailable,1);assert.equal(data.totals.unverified,2);
  assert.deepEqual(data.problemStations.map((s:any)=>s.name),['Excluded']);
});
test('catalogue browser honors literal wildcard filters, quality, HTTPS, limit and source-false visibility', async () => {
  await insertStation({_id:'a'.repeat(24),name:'100% Radio',url:'https://radio.example/one',country:'Austria',language:'German',codec:'AAC',bitrate:192,lastCheckOk:false,tags:'rock'});
  await insertStation({_id:'b'.repeat(24),name:'100X Radio',url:'http://radio.example/two',country:'Austria',language:'German',codec:'AAC',bitrate:64});
  const response=await get('/api/admin/radio-browser/stations?name=100%25&country=Austria&language=German&tag=rock&codec=AAC&kind=quality&is_https=true&limit=1');
  assert.equal(response.status,200);const data=await response.json();assert.equal(data.total,1);assert.equal(data.stations[0].name,'100% Radio');
  assert.equal(data.stations[0].isListVisible,true);assert.equal(data.stations[0].availabilityStatus,'unverified');
  assert.equal((await get('/api/admin/radio-browser/stations?bitrate=bad')).status,400);
  assert.equal((await get('/api/admin/radio-browser/stations?name=a&name=b')).status,400);
});
test('operational summary and samples are cached together for sixty seconds', async () => {
  await insertStation({_id:'a'.repeat(24),name:'Before',url:'https://radio.example/one'});
  const first=await (await get('/api/admin/operations-status')).json();
  await insertStation({_id:'b'.repeat(24),name:'After',url:'https://radio.example/two'});
  const second=await (await get('/api/admin/operations-status')).json();assert.deepEqual(second,first);
});
test('operational endpoints never detoast legacy multilingual source documents', async () => {
  const source=await readFile(new URL('../src/routes/admin-operations-status-routes.ts',import.meta.url),'utf8');
  assert.doesNotMatch(source,/source\s*->|s\.source|s\.descriptions/);
  assert.match(source,/SET LOCAL statement_timeout='2000ms'/);
  assert.match(source,/phase=\$\{phase\} code=\$\{code\}/);
});
