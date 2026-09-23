import type { VisitorDetails, VisitorFilters } from '../../src/lib/admin-visitor-details';

export const visitorFilters: VisitorFilters = { window: 'active', page: 1, country: 'all', platform: 'all', deviceType: 'all' };
export function visitorDetails(overrides: Partial<VisitorDetails> = {}): VisitorDetails {
  return {
    window: 'active', computedAt: '2026-09-23T12:00:00.000Z', collectionStartedAt: '2026-09-21T00:00:00.000Z', dimensionsStartedAt: '2026-09-23T10:00:00.000Z',
    timezone: 'Europe/Berlin', identity: 'unique-ip', attribution: 'latest-request', activeWindowMinutes: 30, retentionDays: 30,
    totalVisitors: 26, matchedVisitors: 26, pagination: { page: 1, limit: 25, total: 26, totalPages: 2 },
    breakdowns: { countries: [{ value: 'DE', count: 20 }, { value: 'unknown', count: 6 }], channels: [{ value: 'web', count: 20 }, { value: 'unknown', count: 6 }], platforms: [{ value: 'web', count: 20 }, { value: 'unknown', count: 6 }], devices: [{ value: 'desktop', count: 20 }, { value: 'unknown', count: 6 }] },
    visitors: [{ maskedIp: '198.51.100.0/24', firstSeenAt: '2026-09-23T10:15:00.000Z', lastSeenAt: '2026-09-23T11:58:00.000Z', countryCode: 'DE', channel: 'web', platform: 'web', deviceType: 'desktop', os: 'Windows', browser: 'Firefox', contextSource: 'user-agent', contextCollectedAt: '2026-09-23T11:58:00.000Z' }],
    ...overrides,
  };
}
