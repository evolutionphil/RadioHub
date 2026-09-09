/** Provider health must never overwrite newer local/admin evidence on sync. */
export const PROVIDER_HEALTH_FIELDS = new Set(['lastCheckOk','lastCheckTime','lastCheckOkTime','lastLocalCheckTime']);
export function providerHealthIsNewer(current: Record<string, any>, patch: Record<string, any>, now = Date.now()): boolean {
  const incoming = new Date(patch.lastCheckTime ?? NaN).getTime();
  const previous = new Date(current.lastCheckTime ?? NaN).getTime();
  return Number.isFinite(incoming) && incoming <= now + 5 * 60_000 &&
    (!Number.isFinite(previous) || incoming > previous);
}

/** RadioBrowser's timezone-less legacy dates are UTC, never server-local. */
export function radioBrowserHealthDate(station: Record<string, any>, field: string): Date | undefined {
  const raw = station[`${field}_iso8601`] || station[field];
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  const value = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(raw) ? raw.replace(' ','T')+'Z' : raw;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.getTime() <= Date.now()+300_000 ? parsed : undefined;
}
