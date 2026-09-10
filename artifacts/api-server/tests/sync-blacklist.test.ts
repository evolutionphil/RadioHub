import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSyncBlacklist } from '../src/utils/sync-blacklist';
test('merge archive blocks only removed UUID and preserves the survivor shared URL', () => {
  const sets=buildSyncBlacklist([{stationUuid:'removed',url:'https://example.invalid/live',blocksUrl:false}]);
  assert.equal(sets.blacklistedUuids.has('removed'),true);
  assert.equal(sets.blacklistedUuids.has('survivor'),false);
  assert.equal(sets.blacklistedUrls.size,0);
});
test('ordinary and explicit bans keep URL scope even alongside a merge archive', () => {
  const sets=buildSyncBlacklist([{stationUuid:'removed',url:'https://example.invalid/live',blocksUrl:false},
    {url:'https://example.invalid/live',blocksUrl:true},{stationUuid:'legacy',url:'https://example.invalid/other'}]);
  assert.equal(sets.blacklistedUrls.size,2);assert.equal(sets.blacklistedUuids.size,2);
});
