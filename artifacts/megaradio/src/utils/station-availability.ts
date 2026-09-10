/** Only independently confirmed list exclusion hides a station. Provider flags
 * and legacy snapshots alone are never proof that every playback route is dead. */
export function isExplicitlyFailedStation(station: unknown): boolean {
  return !!station && typeof station === 'object' && (station as { isListVisible?: unknown }).isListVisible === false;
}

export function availableStations<T>(stations: readonly T[]): T[] {
  return stations.filter(station => !isExplicitlyFailedStation(station));
}

export function adjacentAvailableStation<T extends { _id: string }>(stations: readonly T[], currentId: string | undefined, direction: 1 | -1): T | undefined {
  const available = availableStations(stations);
  if (!available.length) return undefined;
  const current = available.findIndex(station => station._id === currentId);
  return available[current < 0 ? (direction === 1 ? 0 : available.length - 1)
    : (current + direction + available.length) % available.length];
}
