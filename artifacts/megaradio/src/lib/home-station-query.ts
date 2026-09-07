import { queryOptions } from '@tanstack/react-query';

export interface HomeStationPage {
  stations: any[];
  pagination: { total: number; pages: number; [key: string]: unknown };
}

/** Popular and All Stations use the same ordering and first page. Sharing the
 * query avoids a second limit=12 request and the former 500ms popular delay. */
export function homeStationPageOptions(country: string, page = 1) {
  return queryOptions({
    queryKey: ['/api/stations/precomputed', country, page],
    queryFn: async ({ signal }): Promise<HomeStationPage> => {
      const params = new URLSearchParams({ countryName: country === 'all' ? 'global' : country,
        page: String(page), limit: '18', slim: '1' });
      const response = await fetch(`/api/stations/precomputed?${params}`, { signal });
      if (!response.ok) throw new Error('Failed to fetch stations');
      const result = await response.json();
      return { stations: result.data || [], pagination: result.pagination };
    },
    staleTime: 7 * 24 * 60 * 60 * 1000,
    gcTime: 7 * 24 * 60 * 60 * 1000,
  });
}

export const selectPopularHomeStations = (page: HomeStationPage) => page.stations.slice(0, 12);
