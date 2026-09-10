import assert from 'node:assert/strict';
import { after, before, beforeEach, mock, test } from 'node:test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
let enabled = true, previewCalls = 0, applyCalls: unknown[] = [], error: any;
let currentJob: any = { jobId: 'a'.repeat(24), status: 'running', dryRun: true };
mock.module('../src/postgres-runtime', { namedExports: { getPostgresPool: () => ({}) } });
mock.module('../src/services/scheduled-duplicate-merge', { namedExports: { duplicateMergeEnabled: () => enabled } });
mock.module('../src/data/postgres-duplicate-jobs-store', { namedExports: { PostgresDuplicateJobsStore: class {
  async createPreview() { previewCalls++; if (error) throw error; return 'a'.repeat(24); }
  async createApply(id: unknown) { applyCalls.push(id); if (error) throw error; return 'b'.repeat(24); }
  async getJob() { if (error) throw error; return currentJob; }
  async getStatus() { return { nextRunAt: '2030-01-02T00:00:00Z', currentJob, latestPreview: currentJob, latestApply: null }; }
} } });
const { registerAdminDuplicateJobRoutes } = await import('../src/routes/admin-duplicate-job-routes');
let server: Server, base: string;
before(async () => {
  const app = express();
  registerAdminDuplicateJobRoutes(app, (req,res,next) => req.headers['x-test-admin'] === 'yes' ? next() : void res.status(403).json({ error: 'Forbidden' }));
  server = await new Promise<Server>(resolve => { const value = app.listen(0,'127.0.0.1',() => resolve(value)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
beforeEach(() => { enabled = true; previewCalls = 0; applyCalls = []; error = undefined; currentJob = { jobId:'a'.repeat(24),status:'running',dryRun:true }; });
const post = (body: object) => fetch(base+'/api/admin/auto-merge-all', { method:'POST',headers:{'content-type':'application/json','x-test-admin':'yes'},body:JSON.stringify(body) });
test('all job routes require admin authentication', async () => {
  for (const pathname of ['/api/admin/auto-merge-status','/api/admin/merge-jobs/id']) assert.equal((await fetch(base+pathname)).status,403);
  assert.equal((await fetch(base+'/api/admin/auto-merge-all',{method:'POST'})).status,403);
  assert.equal(previewCalls,0); assert.equal(applyCalls.length,0);
});
test('default submission is durable preview; application forwards only an explicit preview ID', async () => {
  const preview = await post({}); assert.equal(preview.status,200); assert.equal(preview.headers.get('cache-control'),'no-store');
  assert.deepEqual(await preview.json(),{success:true,async:true,jobId:'a'.repeat(24)});
  assert.equal(previewCalls,1); assert.equal(applyCalls.length,0);
  await post({dryRun:false,previewJobId:'a'.repeat(24)});
  assert.deepEqual(applyCalls,['a'.repeat(24)]);
});
test('disabled worker rejects enqueue and reports the automatic schedule disabled', async () => {
  enabled=false; assert.equal((await post({})).status,409); assert.equal(previewCalls,0);
  const result=await fetch(base+'/api/admin/auto-merge-status',{headers:{'x-test-admin':'yes'}});
  const status=await result.json(); assert.equal(status.enabled,false); assert.equal(status.automaticDailyEnabled,false);
  assert.equal(status.intervalSeconds,15); assert.equal(status.dailyGroupLimit,100); assert.equal(status.nextRunAt,'2030-01-02T00:00:00Z');
});
test('invalid boolean and unsafe preview states are rejected; internal errors remain generic', async () => {
  assert.equal((await post({dryRun:'false'})).status,400); assert.equal(applyCalls.length,0);
  error=Object.assign(new Error('Preview is not complete'),{status:409}); assert.equal((await post({dryRun:false})).status,409);
  error=new Error('private connection details'); const result=await post({}); assert.equal(result.status,503);
  assert.doesNotMatch(await result.text(),/private connection/);
});
test('durable polling is uncached and missing jobs stop with404', async () => {
  const first=await fetch(base+'/api/admin/merge-jobs/id',{headers:{'x-test-admin':'yes'}});
  assert.equal(first.status,200); assert.equal(first.headers.get('cache-control'),'no-store'); assert.deepEqual(await first.json(),currentJob);
  currentJob=null; assert.equal((await fetch(base+'/api/admin/merge-jobs/id',{headers:{'x-test-admin':'yes'}})).status,404);
});
