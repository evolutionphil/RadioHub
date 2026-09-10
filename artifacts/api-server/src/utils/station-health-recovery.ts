import { evaluateJunkStation, isNumericOnlySlug } from '../seo/junk-station-rules';
import { probeStreamAvailability } from './station-stream-probe';

/** The exact inputs an administrator reviewed, independent of mutable counters. */
export function getStreamRecoverySnapshot(station: any): Record<string, any> {
  const fields = ['slug', 'name', 'url', 'urlResolved', 'noIndex', 'lastCheckOk',
    'lastCheckTime', 'lastCheckOkTime', 'manualEditFields', 'redirectToSlug', 'automaticNoIndex',
    'isListVisible', 'visibilityExpiresAt', 'availabilityOutcome', 'availabilityCheckedAt'];
  return Object.fromEntries(fields.map(key => [key,
    station[key] instanceof Date ? station[key].toISOString() : station[key] ?? null]));
}

/** An explicit administrator review may recover a historical health flag,
 * but cannot reverse manual exclusions, redirects or other quality rules.
 * Passing health=true here isolates non-health reasons; it does not assert
 * a working stream. A separate pinned-network probe must succeed before CAS.
 */
export function assertRecoverableStation(station: any): void {
  if (!station || station.noIndex !== true || station.manualEditFields?.noIndex ||
      station.redirectToSlug || isNumericOnlySlug(station.slug) ||
      evaluateJunkStation({ ...station, lastCheckOk: true }).isJunk) {
    throw new Error('Station is not eligible for reviewed health recovery');
  }
  const previous = station.automaticNoIndex;
  if (previous?.active && previous.reason !== 'stream-dead-30d') {
    throw new Error('A non-health exclusion must be reviewed separately');
  }
  if (station.lastCheckOk !== false && previous?.reason !== 'stream-dead-30d') {
    throw new Error('Station has no failed health evidence to recover');
  }
}

export interface StreamRecoveryEvidence { checkedAt: string; contentType: string; bytesRead: number }

/** Reviewed recovery uses the same safe, bounded evidence as the background
 * worker: raw/resolved URLs and playlist alternatives share 8 s / 4 requests /
 * 64 KiB. It does not promise uninterrupted playback or worldwide availability.
 * Eligibility, administrator confirmation and snapshot CAS are separate guards.
 */
export async function probeStationStream(rawUrl: string | readonly string[]): Promise<StreamRecoveryEvidence> {
  const observation = await probeStreamAvailability(rawUrl);
  if (observation.outcome !== 'healthy' || !observation.verifiedContentType) {
    throw new Error('A working audio response was not verified');
  }
  return { checkedAt: observation.checkedAt, contentType: observation.verifiedContentType, bytesRead: observation.bytesRead };
}
