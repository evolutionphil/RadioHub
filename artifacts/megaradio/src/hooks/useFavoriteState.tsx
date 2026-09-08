import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { authQueryOptions, type AuthQueryResponse } from '@/lib/auth-query';

interface FavoriteState {
  user: AuthQueryResponse['user'];
  favoriteStationIds: ReadonlySet<string>;
}

const FavoriteStateContext = createContext<FavoriteState | null>(null);
const NO_FAVORITES: ReadonlySet<string> = new Set();

// Cards share the same cache keys and freshness policy, but must not each
// allocate three QueryObservers and their browser timers just to draw a heart.
export function FavoriteStateProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { data: userResponse } = useQuery(authQueryOptions);
  const user = userResponse?.authenticated ? userResponse.user : null;
  const userId = user?._id ?? null;
  // Existing cache is valid for the initial signed-in session. Thereafter only
  // an actual account-ID transition clears it, not a refreshed profile object.
  const [favoriteOwnerId, setFavoriteOwnerId] = useState(userId);
  useEffect(() => {
    if (favoriteOwnerId === userId) return;
    let current = true;
    void queryClient.cancelQueries({ queryKey: ['/api/user/favorites'] }).then(() => {
      if (!current) return;
      queryClient.removeQueries({ queryKey: ['/api/user/favorites'] });
      setFavoriteOwnerId(userId);
    });
    return () => { current = false; };
  }, [favoriteOwnerId, userId, queryClient]);
  const { data: favoritesData } = useQuery<Array<{ _id: string }>>({
    queryKey: ['/api/user/favorites'],
    queryFn: async ({ signal }) => {
      const response = await fetch('/api/user/favorites', { credentials: 'include', signal });
      if (!response.ok) return [];
      return response.json();
    },
    enabled: !!userId && favoriteOwnerId === userId,
    staleTime: 10 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });
  // Hide a former account's cached membership in the transition render itself,
  // before the effect cancels its request and replaces the shared cache entry.
  const favoriteStationIds = useMemo(() => userId && favoriteOwnerId === userId
    ? new Set(favoritesData?.map(station => station._id) ?? [])
    : NO_FAVORITES, [favoritesData, favoriteOwnerId, userId]);
  const value = useMemo(() => ({ user, favoriteStationIds }), [user, favoriteStationIds]);
  return <FavoriteStateContext.Provider value={value}>{children}</FavoriteStateContext.Provider>;
}

export function useFavoriteState(): FavoriteState {
  const state = useContext(FavoriteStateContext);
  if (!state) throw new Error('useFavoriteState must be used within FavoriteStateProvider');
  return state;
}
