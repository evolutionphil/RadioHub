import { useQuery } from '@tanstack/react-query';

interface Genre {
  _id: string;
  name: string;
  slug: string;
  stationCount: number;
}

interface GenresResponse {
  data: Genre[];
}

export function useGenresWithCounts() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['/api/genres/precomputed'],
    queryFn: async () => {
      // Use 7-day precomputed cache for genre counts
      const response = await fetch('/api/genres/precomputed');
      if (!response.ok) throw new Error('Failed to fetch genres');
      const data = await response.json() as GenresResponse;
      return data.data;
    },
    staleTime: 7 * 24 * 60 * 60 * 1000, // 7 days - matches server cache TTL
  });

  // Create a map of genre name/slug to station count for quick lookup
  const genreCountMap = new Map<string, number>();
  
  if (data) {
    data.forEach(genre => {
      // Map by both name and slug for flexible lookup
      genreCountMap.set(genre.name.toLowerCase(), genre.stationCount);
      genreCountMap.set(genre.slug.toLowerCase(), genre.stationCount);
    });
  }

  const getGenreStationCount = (genreName: string): number => {
    return genreCountMap.get(genreName.toLowerCase()) || 0;
  };

  return {
    genres: data || [],
    isLoading,
    error,
    getGenreStationCount,
  };
}