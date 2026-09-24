export type VisitorWindow = 'active' | 'today' | 'week';
export const VISITOR_WINDOWS: Record<VisitorWindow, string> = { active: 'Active · 30 minutes', today: 'Today · Berlin', week: 'Last 7 days' };
export const VISITOR_PLATFORMS: Record<string, string> = {
  web: 'Web browser', ios: 'iOS app', android: 'Android app', tizen: 'Samsung Tizen', webos: 'LG webOS',
  tvos: 'Apple tvOS', androidtv: 'Android TV', desktop: 'Desktop app', unknown: 'Unknown platform',
};
export const VISITOR_DEVICES: Record<string, string> = { desktop: 'Desktop', mobile: 'Mobile', tablet: 'Tablet', tv: 'TV', unknown: 'Unknown device' };
export const VISITOR_CHANNELS: Record<string, string> = { web: 'Web browser', app: 'App client', tv: 'TV client', unknown: 'Unknown channel' };
export type VisitorFilters = { window: VisitorWindow; page: number; country: string; platform: string; deviceType: string };
export type VisitorBreakdown = { value: string; count: number };
export interface VisitorRow {
  activityId?: string | null;
  maskedIp: string; firstSeenAt: string; lastSeenAt: string; countryCode: string | null;
  channel: string; platform: string; deviceType: string; os: string | null; browser: string | null;
  contextSource: 'client-header' | 'user-agent' | 'unknown'; contextCollectedAt: string | null;
}
export interface VisitorDetails {
  window: VisitorWindow; computedAt: string; collectionStartedAt: string; dimensionsStartedAt: string;
  timezone: 'Europe/Berlin'; identity: 'unique-ip'; attribution: 'latest-request'; activeWindowMinutes: 30; retentionDays: 30;
  totalVisitors: number; matchedVisitors: number;
  breakdowns: { countries: VisitorBreakdown[]; channels: VisitorBreakdown[]; platforms: VisitorBreakdown[]; devices: VisitorBreakdown[] };
  pagination: { page: number; limit: number; total: number; totalPages: number };
  visitors: VisitorRow[];
}
const date = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const textOrNull = (value: unknown): boolean => value === null || typeof value === 'string';
/** The API exposes network masks, never raw IPs or tracking hashes. */
export function isMaskedVisitorNetwork(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.0\/24$/.test(value)) return value.split('/')[0].split('.').every(part => Number(part) <= 255);
  return /^(?:[a-f\d]{1,4}(?::[a-f\d]{1,4}){0,2})?::\/48$/i.test(value);
}
/** Reject incomplete responses instead of displaying fabricated zeroes or another window's rows. */
export function isVisitorDetails(value: unknown, filters: VisitorFilters): value is VisitorDetails {
  if (!value || typeof value !== 'object') return false;
  const v = value as VisitorDetails;
  return v.window === filters.window && v.timezone === 'Europe/Berlin' && v.identity === 'unique-ip' && v.attribution === 'latest-request'
    && v.activeWindowMinutes === 30 && v.retentionDays === 30
    && date(v.computedAt) && date(v.collectionStartedAt) && date(v.dimensionsStartedAt)
    && count(v.totalVisitors) && count(v.matchedVisitors) && v.matchedVisitors <= v.totalVisitors
    && !!v.pagination && v.pagination.page === filters.page && v.pagination.limit === 25
    && count(v.pagination.total) && count(v.pagination.totalPages) && v.pagination.total === v.matchedVisitors
    && !!v.breakdowns && ['countries', 'channels', 'platforms', 'devices'].every(key => {
      const rows = v.breakdowns[key as keyof VisitorDetails['breakdowns']];
      return Array.isArray(rows) && rows.every(row => !!row && typeof row === 'object' && typeof row.value === 'string' && count(row.count));
    })
    && Array.isArray(v.visitors) && v.visitors.length <= v.pagination.limit && v.visitors.every(row =>
      !!row && typeof row === 'object' && isMaskedVisitorNetwork(row.maskedIp) && date(row.firstSeenAt) && date(row.lastSeenAt)
      && (row.activityId == null || (typeof row.activityId === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(row.activityId)))
      && textOrNull(row.countryCode) && textOrNull(row.os) && textOrNull(row.browser)
      && Object.hasOwn(VISITOR_CHANNELS, row.channel) && Object.hasOwn(VISITOR_PLATFORMS, row.platform) && Object.hasOwn(VISITOR_DEVICES, row.deviceType)
      && ['client-header', 'user-agent', 'unknown'].includes(row.contextSource)
      && (row.contextCollectedAt === null || date(row.contextCollectedAt)));
}
export function visitorDetailsParams(filters: VisitorFilters): URLSearchParams {
  const params = new URLSearchParams({ window: filters.window, page: String(filters.page), limit: '25' });
  for (const name of ['country', 'platform', 'deviceType'] as const) if (filters[name] !== 'all') params.set(name, filters[name]);
  return params;
}
export function visitorCountry(value: string | null): string {
  if (!value || value === 'unknown') return 'Unknown country';
  try { return `${new Intl.DisplayNames(['en'], { type: 'region' }).of(value)} (${value})`; }
  catch { return value; }
}
export function visitorClientLabel(row: Pick<VisitorRow, 'channel' | 'platform' | 'deviceType'>): string {
  if (row.platform === 'web') return row.deviceType === 'desktop' ? 'Desktop browser' : row.deviceType === 'mobile' ? 'Mobile web browser' : row.deviceType === 'tablet' ? 'Tablet web browser' : 'Web browser';
  return VISITOR_PLATFORMS[row.platform] ?? 'Unknown platform';
}
export const visitorDetailTimestamp = (value: string) => new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Berlin', dateStyle: 'medium', timeStyle: 'short',
}).format(new Date(value));
