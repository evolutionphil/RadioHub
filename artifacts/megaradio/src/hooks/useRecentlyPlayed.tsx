import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useBatchStations } from './useBatchStations';
import { readRecentlyPlayed, mergeRecentlyPlayed, hydrateRecentlyPlayed } from '@/utils/recently-played';

export function useRecentlyPlayed() {
  const { isAuthenticated } = useAuth();
  const queryClient = useQueryClient();
  const [localRecentlyPlayed, setLocalRecentlyPlayed] = useState<ReturnType<typeof readRecentlyPlayed>>([]);

  const loadLocalStorage = useCallback(() => {
    try {
      const stored = localStorage.getItem('recentlyPlayed');
      setLocalRecentlyPlayed(readRecentlyPlayed(stored));
    } catch {
      setLocalRecentlyPlayed([]);
    }
  }, []);

  useEffect(() => {
    loadLocalStorage();

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'recentlyPlayed') {
        loadLocalStorage();
      }
    };

    const handleRecentlyPlayedUpdate = () => {
      loadLocalStorage();
      queryClient.invalidateQueries({ queryKey: ['/api/recently-played'] });
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('recentlyPlayedUpdated', handleRecentlyPlayedUpdate);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('recentlyPlayedUpdated', handleRecentlyPlayedUpdate);
    };
  }, [loadLocalStorage, queryClient]);

  const { data: apiRecentlyPlayed = [], isLoading: apiLoading } = useQuery({
    queryKey: ['/api/recently-played'],
    queryFn: async () => {
      const response = await fetch('/api/recently-played', {
        credentials: 'include',
      });
      if (!response.ok) return [];
      return response.json();
    },
    enabled: isAuthenticated,
    staleTime: 30 * 1000,
  });

  const history = useMemo(() => mergeRecentlyPlayed(localRecentlyPlayed, isAuthenticated ? apiRecentlyPlayed : []),
    [isAuthenticated, localRecentlyPlayed, apiRecentlyPlayed]);
  const stationIds = useMemo(() => history.map(station => String(station._id)), [history]);
  const { stationsMap } = useBatchStations(stationIds);
  const recentlyPlayed = useMemo(() => hydrateRecentlyPlayed(history, stationsMap), [history, stationsMap]);

  const hasRecentlyPlayed = recentlyPlayed && recentlyPlayed.length > 0;

  return {
    recentlyPlayed,
    hasRecentlyPlayed,
    isLoading: false,
  };
}
