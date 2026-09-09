import { useEffect, useMemo, useRef } from 'react';
import { useBatchStations } from './useBatchStations';
import { isExplicitlyFailedStation } from '@/utils/station-availability';

/** Validate accumulated pages without deleting the snapshots needed for recovery. */
export function useAvailableStationSnapshots<T extends { _id: string }>(snapshots: readonly T[]): T[] {
  const ids = useMemo(() => snapshots.map(station => String(station._id)), [snapshots]);
  const { stationsMap, hasAuthoritativeData } = useBatchStations(ids, { compact: true });
  const known = useRef(new Map<string, any | null>());

  useEffect(() => {
    if (!hasAuthoritativeData) return;
    const next = new Map<string, any | null>();
    for (const id of ids) next.set(id, stationsMap[id] ?? null);
    known.current = next;
  }, [ids, stationsMap, hasAuthoritativeData]);

  return useMemo(() => snapshots.flatMap(station => {
    // A new Load More key must not resurrect an already omitted earlier ID
    // while its expanded batch is pending. Never infer failure from a 5xx.
    const current = hasAuthoritativeData ? stationsMap[String(station._id)] ?? null
      : known.current.get(String(station._id));
    if (current === null) return [];
    if (current === undefined) return isExplicitlyFailedStation(station) ? [] : [station];
    if (isExplicitlyFailedStation(current)) return [];
    return [{ ...station, ...current }];
  }), [snapshots, stationsMap, hasAuthoritativeData]);
}
