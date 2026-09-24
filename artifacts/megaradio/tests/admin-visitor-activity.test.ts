import { expect, it } from 'vitest';
import { isAutomatedVisitors, isVisitorActivity, isVisitorActivityId, visitorActivityParams } from '../src/lib/admin-visitor-activity';
import { isVisitorDetails } from '../src/lib/admin-visitor-details';
import { automatedVisitors, qualifiedActivityId, secondActivityId, visitorActivity } from './fixtures/visitor-activity';
import { visitorDetails, visitorFilters } from './fixtures/visitor-details';

const selected = { activityId: qualifiedActivityId, trafficKind: 'qualified' as const, maskedIp: '198.51.100.0/24' };
it('accepts bound activity, known automated samples and missing historical activity IDs', () => {
  expect(isVisitorActivity(visitorActivity(), selected)).toBe(true);
  expect(isAutomatedVisitors(automatedVisitors())).toBe(true);
  for (const activityId of [undefined, null, qualifiedActivityId]) {
    const payload = visitorDetails(); payload.visitors[0].activityId = activityId;
    expect(isVisitorDetails(payload, visitorFilters)).toBe(true);
  }
});
it('rejects another subject/category, malformed privacy metadata and unexpected payloads', () => {
  expect(isVisitorActivity(visitorActivity({ activityId: secondActivityId }), selected)).toBe(false);
  expect(isVisitorActivity(visitorActivity({ trafficKind: 'automated' }), selected)).toBe(false);
  for (const value of [null, [], { ...visitorActivity(), events: [null] }, { ...visitorActivity(), retentionDays: 30 }]) expect(isVisitorActivity(value, selected)).toBe(false);
  for (const value of [null, {}, { ...automatedVisitors(), visitors: [null] }]) expect(isAutomatedVisitors(value)).toBe(false);
  const payload = automatedVisitors(); payload.visitors[0].maskedIp = '203.0.113.15';
  expect(isAutomatedVisitors(payload)).toBe(false);
});
it.each(['https://evil.invalid/', '//evil.invalid/', '/de?token=secret', '/de#secret', '/de\nsecret', '/en/profile/raw-user-id', '/en/messages/raw-user-id', '/api/stations/raw-station-id/click', '/en/oauth/callback', 'x'.repeat(300)])('rejects unsanitized activity paths: %s', path => {
  const payload = visitorActivity(); payload.events[0].path = path;
  expect(isVisitorActivity(payload, selected)).toBe(false);
});
it('accepts only redacted public routes and exact safe API action templates', () => {
  const payload = visitorActivity();
  for (const path of ['/en/profile/:redacted', '/de/profile/messages/:redacted', '/de/regions/:region/:country/:city']) {
    Object.assign(payload.events[0], { path, action: 'page-view' });
    expect(isVisitorActivity(payload, selected)).toBe(true);
  }
  Object.assign(payload.events[0], { path: '/api/stations/:station/click', action: 'play-request', method: 'POST' });
  expect(isVisitorActivity(payload, selected)).toBe(true);
  Object.assign(payload.events[0], { path: '/api/recently-played', status: 204 });
  expect(isVisitorActivity(payload, selected)).toBe(true);
  payload.events[0].path = '/api/stations/real-id/click'; expect(isVisitorActivity(payload, selected)).toBe(false);
  Object.assign(payload.events[0], { path: '/api/stations/:station/click', source: 'client-pageview' }); expect(isVisitorActivity(payload, selected)).toBe(false);
});
it('uses opaque validated IDs and encodes cursors without allowing new query parameters', () => {
  expect(isVisitorActivityId(qualifiedActivityId)).toBe(true);
  for (const value of ['123', '../admin', '198.51.100.1', '<script>', null]) expect(isVisitorActivityId(value)).toBe(false);
  expect(Object.fromEntries(visitorActivityParams('opaque&limit=1000', 50))).toEqual({ limit: '50', before: 'opaque&limit=1000' });
});
it('rejects contradictory automated and qualified event classifications', () => {
  const payload = visitorActivity(); payload.events[0].automationStatus = 'automated';
  expect(isVisitorActivity(payload, selected)).toBe(false);
  payload.trafficKind = 'automated';
  expect(isVisitorActivity(payload, { ...selected, trafficKind: 'automated' })).toBe(true);
  payload.events[0].automationStatus = 'browser-like';
  expect(isVisitorActivity(payload, { ...selected, trafficKind: 'automated' })).toBe(false);
});
