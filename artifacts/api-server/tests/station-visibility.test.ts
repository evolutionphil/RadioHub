import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stationVisibilityFields, stationListVisibleSql, stationAvailabilityStatusSql } from '../src/utils/station-visibility';
const now=Date.parse('2026-09-10T12:00:00Z');
test('provider-only false is not hidden or presented as locally verified',()=>{
  assert.deepEqual(stationVisibilityFields({last_check_ok:false,is_list_visible:true},now),{isListVisible:true,availabilityStatus:'unverified'});
});
test('confirmed offline leases expire without requiring worker execution; explicit manual null expiry stays hidden',()=>{
  assert.deepEqual(stationVisibilityFields({is_list_visible:false,visibility_expires_at:new Date(now-1)},now),{isListVisible:true,availabilityStatus:'unverified'});
  assert.deepEqual(stationVisibilityFields({is_list_visible:false,visibility_expires_at:null},now),{isListVisible:false,availabilityStatus:'unavailable'});
});
test('only fresh bounded local positive evidence is described as working',()=>{
  assert.equal(stationVisibilityFields({is_list_visible:true,availability_outcome:'healthy',availability_checked_at:new Date(now-1000)},now).availabilityStatus,'working');
  for(const checked of [new Date(now-86400001),new Date(now+300001),'invalid'])
    assert.equal(stationVisibilityFields({is_list_visible:true,availability_outcome:'healthy',availability_checked_at:checked},now).availabilityStatus,'unverified');
});
test('SQL and response helpers use the same lease and future-proof boundaries',()=>{
  assert.match(stationListVisibleSql(),/COALESCE\(s.visibility_expires_at<=now\(\),false\)/);
  assert.match(stationAvailabilityStatusSql(),/availability_checked_at<=now\(\)\+interval '5 minutes'/);
  assert.throws(()=>stationListVisibleSql('s; DROP TABLE stations'),/Invalid/);
});
