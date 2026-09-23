import { expect, it } from 'vitest';
import { isMaskedVisitorNetwork, isVisitorDetails, visitorClientLabel, visitorCountry, visitorDetailsParams } from '../src/lib/admin-visitor-details';
import { visitorDetails, visitorFilters } from './fixtures/visitor-details';

it('accepts the exact details contract including historical unknown client dimensions', () => {
  expect(isVisitorDetails(visitorDetails(), visitorFilters)).toBe(true);
  const payload = visitorDetails();
  Object.assign(payload.visitors[0], { maskedIp: '2001:db8::/48', countryCode: null, channel: 'unknown', platform: 'unknown', deviceType: 'unknown', os: null, browser: null, contextSource: 'unknown', contextCollectedAt: null });
  expect(isVisitorDetails(payload, visitorFilters)).toBe(true);
});

it.each(['198.51.100.15', '198.51.100.15/24', '2001:db8::1234', '2001:db8::/64', '999.51.100.0/24', 'a'.repeat(64)])('rejects unmasked, overprecise, or invalid identifiers: %s', value => {
  expect(isMaskedVisitorNetwork(value)).toBe(false);
  const payload = visitorDetails(); payload.visitors[0].maskedIp = value;
  expect(isVisitorDetails(payload, visitorFilters)).toBe(false);
});

it('rejects invalid nested payloads without throwing and never substitutes another page/window', () => {
  expect(isVisitorDetails({ ...visitorDetails(), visitors: [null] }, visitorFilters)).toBe(false);
  expect(isVisitorDetails({ ...visitorDetails(), breakdowns: { ...visitorDetails().breakdowns, countries: [null] } }, visitorFilters)).toBe(false);
  expect(isVisitorDetails({ ...visitorDetails(), dimensionsStartedAt: null }, visitorFilters)).toBe(false);
  expect(isVisitorDetails(visitorDetails({ window: 'week' }), visitorFilters)).toBe(false);
  expect(isVisitorDetails(visitorDetails(), { ...visitorFilters, page: 2 })).toBe(false);
  expect(isVisitorDetails(visitorDetails({ matchedVisitors: -1 }), visitorFilters)).toBe(false);
});

it('constructs only the declared filters and fixed pagination size', () => {
  expect(visitorDetailsParams(visitorFilters).toString()).toBe('window=active&page=1&limit=25');
  expect(Object.fromEntries(visitorDetailsParams({ ...visitorFilters, window: 'week', page: 2, country: 'unknown', platform: 'tizen', deviceType: 'tv' }))).toEqual({ window: 'week', page: '2', limit: '25', country: 'unknown', platform: 'tizen', deviceType: 'tv' });
});

it('distinguishes browsers, apps, TV platforms and missing metadata without inventing hardware', () => {
  const row = visitorDetails().visitors[0];
  expect(visitorClientLabel(row)).toBe('Desktop browser');
  expect(visitorClientLabel({ ...row, deviceType: 'mobile' })).toBe('Mobile web browser');
  expect(visitorClientLabel({ ...row, platform: 'desktop', channel: 'app' })).toBe('Desktop app');
  expect(visitorClientLabel({ ...row, platform: 'ios', channel: 'app' })).toBe('iOS app');
  expect(visitorClientLabel({ ...row, platform: 'tizen', channel: 'tv' })).toBe('Samsung Tizen');
  expect(visitorClientLabel({ ...row, platform: 'webos', channel: 'tv' })).toBe('LG webOS');
  expect(visitorClientLabel({ ...row, platform: 'unknown', channel: 'unknown' })).toBe('Unknown platform');
  expect(visitorCountry(null)).toBe('Unknown country');
  expect(visitorCountry('DE')).toBe('Germany (DE)');
});
