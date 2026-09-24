import { isMaskedVisitorNetwork, VISITOR_CHANNELS, VISITOR_DEVICES, VISITOR_PLATFORMS, type VisitorRow } from './admin-visitor-details';
import { sanitizeVisitorPagePath } from '@workspace/seo-shared/visitor-activity';

export type TrafficKind = 'qualified' | 'automated';
export type ActivitySelection = { activityId: string; maskedIp: string; trafficKind: TrafficKind };
export interface VisitorActivityEvent {
  id: string; occurredAt: string; path: string; action: string; method: string; status: number;
  source: 'http' | 'client-pageview'; referralCategory: string;
  automationStatus: 'unknown' | 'browser-like' | 'automated';
}
export interface VisitorActivity {
  activityId: string; trafficKind: TrafficKind; collectionStartedAt: string; computedAt: string;
  retentionDays: 7; sampling: 'bounded-best-effort'; events: VisitorActivityEvent[]; nextCursor: string | null;
}
export interface AutomatedVisitor extends Omit<VisitorRow, 'contextCollectedAt' | 'activityId'> {
  activityId: string; automationStatus: 'automated';
}
export interface AutomatedVisitors {
  computedAt: string; collectionStartedAt: string; retentionDays: 7; sampling: 'bounded-best-effort';
  visitors: AutomatedVisitor[]; nextCursor: string | null;
}
const record = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const date = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const bounded = (value: unknown, limit = 256): value is string => typeof value === 'string' && value.length > 0 && value.length <= limit;
const nullableText = (value: unknown) => value === null || bounded(value);
const cursor = (value: unknown) => value === null || bounded(value, 2048);
export const isVisitorActivityId = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const metadata = (value: Record<string, any>) => date(value.computedAt) && date(value.collectionStartedAt) && value.retentionDays === 7 && value.sampling === 'bounded-best-effort' && cursor(value.nextCursor);
const safeActionPaths: Record<string, readonly string[]> = {
  'play-request': ['/api/stations/:station/click', '/api/recently-played'],
  'rating-submit': ['/api/stations/:station/rate'],
  'favorite-add': ['/api/user/favorites', '/api/user-engagement/stations/:station/favorite'],
  'favorite-remove': ['/api/user/favorites/:station', '/api/user-engagement/stations/:station/favorite'],
};
function safeEventPath(event: Record<string, any>): boolean {
  if (!bounded(event.path, 256)) return false;
  if (event.action === 'page-view' || event.action === 'station-view') return sanitizeVisitorPagePath(event.path) === event.path;
  return event.source === 'http' && !!safeActionPaths[event.action]?.includes(event.path);
}

/** Never render an unbound response as the currently selected visitor. */
export function isVisitorActivity(value: unknown, selected: ActivitySelection): value is VisitorActivity {
  return record(value) && value.activityId === selected.activityId && value.trafficKind === selected.trafficKind && metadata(value)
    && Array.isArray(value.events) && value.events.length <= 50 && value.events.every(event => record(event)
      && isVisitorActivityId(event.id) && date(event.occurredAt) && safeEventPath(event)
      && ['page-view', 'station-view', 'play-request', 'favorite-add', 'favorite-remove', 'rating-submit'].includes(event.action)
      && ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(event.method) && Number.isInteger(event.status) && event.status >= 200 && event.status <= 299
      && ['http', 'client-pageview'].includes(event.source) && ['google', 'search', 'social', 'internal', 'direct-or-unknown', 'other-referral'].includes(event.referralCategory)
      && (selected.trafficKind === 'automated' ? event.automationStatus === 'automated' : ['unknown', 'browser-like'].includes(event.automationStatus)));
}
export function isAutomatedVisitors(value: unknown): value is AutomatedVisitors {
  return record(value) && metadata(value) && Array.isArray(value.visitors) && value.visitors.length <= 25
    && value.visitors.every(row => record(row) && isVisitorActivityId(row.activityId) && isMaskedVisitorNetwork(row.maskedIp)
      && date(row.firstSeenAt) && date(row.lastSeenAt) && nullableText(row.countryCode) && nullableText(row.os) && nullableText(row.browser)
      && Object.hasOwn(VISITOR_CHANNELS, row.channel) && Object.hasOwn(VISITOR_PLATFORMS, row.platform) && Object.hasOwn(VISITOR_DEVICES, row.deviceType)
      && ['client-header', 'user-agent', 'unknown'].includes(row.contextSource) && row.automationStatus === 'automated');
}
export function visitorActivityParams(before: string | null, limit: 25 | 50): URLSearchParams {
  return new URLSearchParams({ limit: String(limit), ...(before ? { before } : {}) });
}
export const visitorActivityLabel = (value: string) => value.replace(/[-_]+/g, ' ').replace(/^\w/, letter => letter.toUpperCase());
