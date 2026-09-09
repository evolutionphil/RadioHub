/** Unknown legacy snapshots are not proof of failure. Public APIs own health. */
export function isExplicitlyFailedStation(station: unknown): boolean {
  return !!station && typeof station === 'object' && (station as { lastCheckOk?: unknown }).lastCheckOk === false;
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
