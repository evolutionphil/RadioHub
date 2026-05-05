import { useQuery } from "@tanstack/react-query";
import { useBatchStations } from "./useBatchStations";
import { useMemo } from "react";

interface UseStationListOptions {
  enableBatching?: boolean;
  batchSize?: number;
}

export function useStationList(stationIds: string[], options: UseStationListOptions = {}) {
  const { enableBatching = true, batchSize = 50 } = options;

  // Use batch loading for performance when we have many stations
  const shouldUseBatch = enableBatching && stationIds.length > 1;

  // Batch loading approach
  const batchResult = useBatchStations(shouldUseBatch ? stationIds : []);

  // Individual loading approach (fallback)
  const individualQueries = useQuery({
    queryKey: ['individual-stations', stationIds],
    queryFn: async () => {
      if (shouldUseBatch || stationIds.length === 0) return [];
      
      // For single stations or when batch is disabled
      const promises = stationIds.map(async (id) => {
        const response = await fetch(`/api/stations/${id}`);
        if (!response.ok) throw new Error(`Failed to fetch station ${id}`);
        return response.json();
      });
      
      return Promise.all(promises);
    },
    enabled: !shouldUseBatch && stationIds.length > 0,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  });

  // Return unified interface
  const stations = useMemo(() => {
    if (shouldUseBatch) {
      return batchResult.stations;
    }
    return individualQueries.data || [];
  }, [shouldUseBatch, batchResult.stations, individualQueries.data]);

  const isLoading = shouldUseBatch ? batchResult.isLoading : individualQueries.isLoading;
  const error = shouldUseBatch ? batchResult.error : individualQueries.error;

  return {
    stations,
    isLoading,
    error,
    // Expose batch optimization info for debugging
    isBatched: shouldUseBatch,
    batchInfo: shouldUseBatch ? {
      requestedIds: stationIds.length,
      returnedStations: stations.length,
      cacheHits: stationIds.length - (batchResult.isLoading ? stationIds.length : 0)
    } : null
  };
}