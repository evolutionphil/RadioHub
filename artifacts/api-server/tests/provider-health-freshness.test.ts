import assert from 'node:assert/strict';
import { test } from 'node:test';
import { providerHealthIsNewer, radioBrowserHealthDate } from '../src/utils/provider-health-freshness';
test('provider checks cannot replace newer local evidence, or accept missing/invalid/future time', () => {
  const now = Date.now(), current = { lastCheckTime:new Date(now-1000) };
  for (const value of [undefined,'invalid',new Date(now-2000),new Date(now-1000),new Date(now+600_000)])
    assert.equal(providerHealthIsNewer(current,{lastCheckTime:value},now),false);
  assert.equal(providerHealthIsNewer(current,{lastCheckTime:new Date(now)},now),true);
  assert.equal(providerHealthIsNewer({}, {lastCheckTime:new Date(now)},now),true);
});
test('RadioBrowser health dates prefer ISO UTC and normalize legacy UTC, invalid is absent', () => {
  assert.equal(radioBrowserHealthDate({lastchecktime:'2026-01-01 10:00:00'},'lastchecktime')?.toISOString(),'2026-01-01T10:00:00.000Z');
  assert.equal(radioBrowserHealthDate({lastchecktime:'bad',lastchecktime_iso8601:'2026-01-02T10:00:00Z'},'lastchecktime')?.toISOString(),'2026-01-02T10:00:00.000Z');
  assert.equal(radioBrowserHealthDate({lastchecktime:'bad'},'lastchecktime'),undefined);
});
