import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import { useState, useEffect, useCallback, useMemo } from 'react';
import type { StationWithCountry as Station } from '@shared/schema';

export function useRecentlyPlayed() {
  const { isAuthenticated } = useAuth();
  const queryClient = useQueryClient();
  const [localRecentlyPlayed, setLocalRecentlyPlayed] = useState<Station[]>([]);

  const loadLocalStorage = useCallback(() => {
    try {
      const stored = localStorage.getItem('recentlyPlayed');
      setLocalRecentlyPlayed(stored ? JSON.parse(stored) : []);
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

  const recentlyPlayed = useMemo(() => {
    if (!isAuthenticated) {
      return localRecentlyPlayed;
    }

    if (apiRecentlyPlayed.length === 0 && localRecentlyPlayed.length === 0) {
      return [];
    }

    const merged = new Map<string, any>();

    for (const station of apiRecentlyPlayed) {
      const id = station._id?.toString();
      if (id) merged.set(id, station);
    }

    for (const station of localRecentlyPlayed) {
      const id = station._id?.toString();
      if (id && !merged.has(id)) {
        merged.set(id, station);
      }
    }

    const sorted = Array.from(merged.values()).sort((a, b) => {
      const timeA = a.playedAt ? new Date(a.playedAt).getTime() : 0;
      const timeB = b.playedAt ? new Date(b.playedAt).getTime() : 0;
      return timeB - timeA;
    });

    return sorted.slice(0, 12);
  }, [isAuthenticated, localRecentlyPlayed, apiRecentlyPlayed]);

  const hasRecentlyPlayed = recentlyPlayed && recentlyPlayed.length > 0;

  return {
    recentlyPlayed,
    hasRecentlyPlayed,
    isLoading: false,
  };
}
