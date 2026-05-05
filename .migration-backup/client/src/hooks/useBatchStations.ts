import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

interface Station {
  _id: string;
  name: string;
  favicon?: string;
  country?: string;
  state?: string;
  votes?: number;
  // Add other station properties as needed
}

export function useBatchStations(stationIds: string[]) {
  // Only make request if we have station IDs
  const shouldFetch = stationIds.length > 0;
  
  const { data: stationsMap, isLoading, error } = useQuery({
    queryKey: ['batch-stations', stationIds.sort().join(',')],
    queryFn: async () => {
      if (!stationIds.length) return {};
      
      const response = await fetch('/api/stations/batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ stationIds }),
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch stations');
      }
      
      return response.json();
    },
    enabled: shouldFetch,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes (formerly cacheTime)
  });

  // Convert map back to array in the order of requested IDs
  const stations = useMemo(() => {
    if (!stationsMap) return [];
    return stationIds
      .map(id => stationsMap[id])
      .filter(Boolean); // Remove undefined values
  }, [stationsMap, stationIds]);

  return {
    stations,
    stationsMap: stationsMap || {},
    isLoading,
    error
  };
}