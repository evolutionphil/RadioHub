import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { stationQueryFreshness } from '@/lib/station-query-policy';
import { availableStations } from '@/utils/station-availability';

const EMPTY_STATIONS_MAP: Record<string, any> = {};

interface Station {
  _id: string;
  name: string;
  favicon?: string;
  country?: string;
  state?: string;
  votes?: number;
  // Add other station properties as needed
}

export function useBatchStations(stationIds: string[], { compact = false }: { compact?: boolean } = {}) {
  // Only make request if we have station IDs
  const uniqueIds = [...new Set(stationIds)];
  const shouldFetch = uniqueIds.length > 0;
  const idsKey = [...uniqueIds].sort().join(',');
  
  const { data: stationsMap, isLoading, error } = useQuery({
    queryKey: compact ? ['batch-stations', idsKey, 'cards'] : ['batch-stations', idsKey],
    queryFn: async ({ signal }) => {
      const result: Record<string, any> = {};
      // The public API accepts at most fifty IDs. Sequential chunks keep one
      // shared query and bounded server concurrency; partial failure is not an
      // authoritative success that could falsely hide the unrequested remainder.
      for (let offset = 0; offset < uniqueIds.length; offset += 50) {
        const batchIds = uniqueIds.slice(offset, offset + 50);
        const response = await fetch('/api/stations/batch', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ stationIds: batchIds, ...(compact ? { slim: true } : {}) }),
          signal,
        });
      
        if (!response.ok) throw new Error('Failed to fetch stations');
      
        const data = await response.json();
        if (!data || typeof data !== 'object' || Array.isArray(data) || Object.entries(data).some(([id, value]) =>
          !batchIds.includes(id) || !value || typeof value !== 'object' || String((value as any)._id) !== id)) {
          throw new Error('Invalid station batch response');
        }
        Object.assign(result, data);
      }
      return result;
    },
    enabled: shouldFetch,
    ...stationQueryFreshness,
    gcTime: 10 * 60 * 1000, // 10 minutes (formerly cacheTime)
  });

  // Convert map back to array in the order of requested IDs
  const stations = useMemo(() => {
    if (!stationsMap) return [];
    return availableStations(stationIds
      .map(id => stationsMap[id])
      .filter(Boolean)); // Missing/failed rows are not rendered, but IDs stay stored.
  }, [stationsMap, stationIds]);

  return {
    stations,
    stationsMap: stationsMap || EMPTY_STATIONS_MAP,
    hasAuthoritativeData: stationsMap !== undefined,
    isLoading,
    error
  };
}
