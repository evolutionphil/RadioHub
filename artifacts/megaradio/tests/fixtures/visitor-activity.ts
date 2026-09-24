import type { AutomatedVisitors, VisitorActivity, VisitorActivityEvent } from '../../src/lib/admin-visitor-activity';
export const qualifiedActivityId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const secondActivityId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
export const automatedActivityId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export function activityEvent(overrides: Partial<VisitorActivityEvent> = {}): VisitorActivityEvent {
  return { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', occurredAt: '2026-09-24T12:00:00.000Z', path: '/de/station/kronehit-radio', action: 'station-view', method: 'GET', status: 200, source: 'http', referralCategory: 'google', automationStatus: 'browser-like', ...overrides };
}
export function visitorActivity(overrides: Partial<VisitorActivity> = {}): VisitorActivity {
  return { activityId: qualifiedActivityId, trafficKind: 'qualified', collectionStartedAt: '2026-09-24T00:00:00.000Z', computedAt: '2026-09-24T12:01:00.000Z', retentionDays: 7, sampling: 'bounded-best-effort', events: [activityEvent()], nextCursor: 'older-cursor', ...overrides };
}
export function automatedVisitors(overrides: Partial<AutomatedVisitors> = {}): AutomatedVisitors {
  return { computedAt: '2026-09-24T12:01:00.000Z', collectionStartedAt: '2026-09-24T00:00:00.000Z', retentionDays: 7, sampling: 'bounded-best-effort',
    visitors: [{ activityId: automatedActivityId, maskedIp: '203.0.113.0/24', firstSeenAt: '2026-09-24T10:00:00.000Z', lastSeenAt: '2026-09-24T12:00:00.000Z', countryCode: 'DE', channel: 'unknown', platform: 'unknown', deviceType: 'unknown', os: null, browser: null, contextSource: 'unknown', automationStatus: 'automated' }], nextCursor: null, ...overrides };
}
