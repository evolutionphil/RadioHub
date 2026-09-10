import assert from 'node:assert/strict';
import { after, beforeEach, mock, test } from 'node:test';
let waiting = 0, utilization = 0, calls = 0, warning = 0, clearQuick = 0, countRefresh = 0, clearSimilar = 0;
let patterns: string[] = [];
let cycleResult = { processed: 1, deleted: 0, completed: false, refreshCounts: false };
let throwCycle = false;
const previous = { NODE_ENV: process.env.NODE_ENV, BACKGROUND_JOBS_ENABLED: process.env.BACKGROUND_JOBS_ENABLED, DUPLICATE_MERGE_ENABLED: process.env.DUPLICATE_MERGE_ENABLED };
mock.module('../src/postgres-runtime', { namedExports: { getPostgresPool: () => ({ get waitingCount() { return waiting; } }) } });
mock.module('node:perf_hooks', { namedExports: { performance: { eventLoopUtilization: () => ({ utilization }) } } });
mock.module('../src/utils/logger', { namedExports: { logger: { warn() { warning++; } } } });
mock.module('../src/data/postgres-duplicate-jobs-store', { namedExports: { PostgresDuplicateJobsStore: class {
  async runCycle() { calls++; await new Promise(resolve => setTimeout(resolve, 3)); if (throwCycle) throw new Error('fixture'); return cycleResult; }
} } });
mock.module('../src/cache', { defaultExport: { async clearByPattern(pattern: string) { patterns.push(pattern); } } });
mock.module('../src/performance-cache', { namedExports: { performanceCache: { clearSeoAndQuickCaches() { clearQuick++; }, clearSimilarStationPools() { clearSimilar++; } } } });
mock.module('../src/services/genre-station-counts', { namedExports: { triggerGenreStationCountsRecompute() { countRefresh++; } } });
const { ScheduledDuplicateMerge, duplicateMergeEnabled } = await import('../src/services/scheduled-duplicate-merge');
beforeEach(() => {
  process.env.NODE_ENV = 'production'; delete process.env.BACKGROUND_JOBS_ENABLED; delete process.env.DUPLICATE_MERGE_ENABLED;
  waiting = utilization = calls = warning = clearQuick = countRefresh = clearSimilar = 0; patterns = []; throwCycle = false;
  cycleResult = { processed: 1, deleted: 0, completed: false, refreshCounts: false };
});
after(() => { for (const [name, value] of Object.entries(previous)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } });
test('defaults enabled in production but each explicit safety gate stops work', async () => {
  assert.equal(duplicateMergeEnabled(), true);
  for (const [name,value] of [['BACKGROUND_JOBS_ENABLED','false'],['DUPLICATE_MERGE_ENABLED','false'],['NODE_ENV','development']]) {
    const original = process.env[name]; process.env[name] = value;
    assert.equal(duplicateMergeEnabled(), false); await new ScheduledDuplicateMerge().runOnce();
    if (original === undefined) delete process.env[name]; else process.env[name] = original;
  }
  assert.equal(calls, 0);
});
test('only one in-process cycle and no invalidation for previews', async () => {
  const worker = new ScheduledDuplicateMerge();
  await Promise.all([worker.runOnce(), worker.runOnce()]);
  assert.equal(calls, 1); assert.equal(patterns.length, 0); assert.equal(clearQuick, 0);
});
test('foreground database contention or high event-loop utilization prevents a cycle', async () => {
  waiting = 1; await new ScheduledDuplicateMerge().runOnce();
  waiting = 0; utilization = 0.8; await new ScheduledDuplicateMerge().runOnce();
  assert.equal(calls, 0);
});
test('committed groups invalidate bounded cache patterns once; counts refresh at completion', async () => {
  cycleResult = { processed: 10, deleted: 10, completed: true, refreshCounts: true };
  await new ScheduledDuplicateMerge().runOnce();
  assert.deepEqual(patterns, ['popular_stations','stations','community_favorites','station:detail:','similar:']);
  assert.equal(clearQuick, 1); assert.equal(countRefresh, 1); assert.equal(clearSimilar, 1);
});
test('failed cycles do not invalidate and release the local overlap guard for retry', async () => {
  const worker = new ScheduledDuplicateMerge(); throwCycle = true; await worker.runOnce();
  throwCycle = false; await worker.runOnce();
  assert.equal(calls, 2); assert.equal(warning, 1); assert.equal(patterns.length, 0);
});
