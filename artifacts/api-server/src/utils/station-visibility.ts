/** Shared public policy: uncertainty is not proof that a station is offline. */
export const LOCAL_HEALTH_FRESH_MS = 24 * 60 * 60_000;
export function stationVisibilitySql(alias = 's'): string {
  if (!/^[a-z][a-z0-9_]*$/i.test(alias)) throw new Error('Invalid station SQL alias');
  return `(${alias}.is_list_visible IS TRUE OR COALESCE(${alias}.visibility_expires_at<=now(),false))`;
}
export function stationAvailabilitySql(alias = 's'): string {
  return `CASE WHEN NOT ${stationVisibilitySql(alias)} THEN 'unavailable' WHEN ${alias}.availability_outcome='healthy' AND ${alias}.availability_checked_at>=now()-interval '24 hours' AND ${alias}.availability_checked_at<=now()+interval '5 minutes' THEN 'working' ELSE 'unverified' END`;
}
export const stationListVisibleSql = stationVisibilitySql;
export const stationAvailabilityStatusSql = stationAvailabilitySql;
export function stationVisibilityFields(row: Record<string, any>, now = Date.now()) {
  const expiry = new Date(row.visibility_expires_at ?? row.visibilityExpiresAt ?? NaN).getTime();
  const isListVisible = (row.is_list_visible ?? row.isListVisible) !== false || (Number.isFinite(expiry) && expiry <= now);
  const checked = new Date(row.availability_checked_at ?? row.availabilityCheckedAt ?? NaN).getTime();
  const outcome = row.availability_outcome ?? row.availabilityOutcome;
  const availabilityStatus = !isListVisible ? 'unavailable' : outcome === 'healthy' && Number.isFinite(checked) &&
    checked <= now + 300_000 && checked >= now - LOCAL_HEALTH_FRESH_MS ? 'working' : 'unverified';
  return { isListVisible, availabilityStatus };
}
