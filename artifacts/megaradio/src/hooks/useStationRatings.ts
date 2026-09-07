import { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest, oauthBearerHeader, resolveApiUrl } from '@/lib/queryClient';

export interface StationRating {
  rating: number;
  comment?: string;
  stationId?: string;
  station_id?: string;
}

export interface StationRatingStats {
  averageRating: number;
  totalRatings: number;
  votes?: number;
}

interface UserRatingResponse { rating: StationRating | null }
interface RatingsResponse { stats: StationRatingStats }

let memorySessionId: string | undefined;
function getRatingSessionId(): string {
  try {
    const saved = localStorage.getItem('radio_session_id');
    if (saved) return saved;
  } catch { /* Safari may deny persistent storage; keep one identity in memory. */ }
  memorySessionId ??= `session_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  try { localStorage.setItem('radio_session_id', memorySessionId); } catch { /* Use the memory identity. */ }
  return memorySessionId;
}

export function stationRatingKeys(stationId: string | undefined, userId: string | undefined, sessionId: string) {
  return {
    user: ['/api/stations', stationId, 'user-rating', userId || 'anon', sessionId] as const,
    stats: ['/api/stations', stationId, 'ratings'] as const,
  };
}

function assertStats(stats: StationRatingStats | undefined): asserts stats is StationRatingStats {
  if (!stats || !Number.isInteger(stats.totalRatings) || stats.totalRatings < 0 ||
    !Number.isFinite(stats.averageRating) || stats.averageRating < 0 || stats.averageRating > 5 ||
    (stats.totalRatings === 0 && stats.averageRating !== 0)) {
    throw new Error('Invalid station rating statistics');
  }
}

function assertRatingScope(rating: StationRating | null, stationId: string): void {
  const owner = rating?.stationId ?? rating?.station_id;
  if (owner && owner !== stationId) throw new Error('Rating belongs to another station');
}

/** Ratings are cached by station and viewer, never in page-wide override state.
 * A save started on A can finish after navigation to B: only A's keys are updated.
 */
export function useStationRatings(stationId?: string, userId?: string) {
  const client = useQueryClient();
  const [sessionId] = useState(getRatingSessionId);
  const keys = stationRatingKeys(stationId, userId, sessionId);
  const userRating = useQuery<UserRatingResponse>({
    queryKey: keys.user,
    enabled: !!stationId,
    retry: false,
    staleTime: 5 * 60 * 1000,
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ sessionId });
      // The server resolves a logged-in identity from cookies/bearer, not a supplied user ID.
      const response = await apiRequest('GET', resolveApiUrl(`/api/stations/${encodeURIComponent(stationId!)}/user-rating?${params}`), { signal, headers: oauthBearerHeader() });
      const data: UserRatingResponse = await response.json();
      assertRatingScope(data.rating, stationId!);
      return data;
    },
  });
  const stats = useQuery<RatingsResponse>({
    queryKey: keys.stats,
    enabled: !!stationId,
    retry: false,
    staleTime: 2 * 60 * 1000,
    queryFn: async ({ signal }) => {
      const response = await apiRequest('GET', resolveApiUrl(`/api/stations/${encodeURIComponent(stationId!)}/ratings`), { signal, headers: oauthBearerHeader() });
      const data: RatingsResponse = await response.json();
      assertStats(data.stats);
      return data;
    },
  });

  const submitRating = useCallback(async (rating: number, comment?: string) => {
    if (!stationId || !Number.isInteger(rating) || rating < 1 || rating > 5) throw new Error('Invalid rating');
    const savedKeys = stationRatingKeys(stationId, userId, sessionId);
    const response = await apiRequest('POST', resolveApiUrl(`/api/stations/${encodeURIComponent(stationId)}/rate`), {
      headers: oauthBearerHeader(), body: { rating, comment, sessionId },
    });
    const result: { success?: boolean; rating: StationRating; stats: StationRatingStats } = await response.json();
    if (result.success === false || !result.rating) throw new Error('Rating was not saved');
    assertRatingScope(result.rating, stationId);
    assertStats(result.stats);
    // Prevent an older in-flight GET from replacing the accepted write result.
    await Promise.all([
      client.cancelQueries({ queryKey: savedKeys.user, exact: true }),
      client.cancelQueries({ queryKey: savedKeys.stats, exact: true }),
    ]);
    client.setQueryData(savedKeys.user, { rating: result.rating });
    client.setQueryData<RatingsResponse>(savedKeys.stats, previous => ({ ...previous, stats: result.stats }));
    // Update only cached detail records for this station, not the currently open page.
    client.setQueriesData({ predicate: query =>
      typeof query.queryKey[0] === 'string' && query.queryKey[0].startsWith('/api/station/') &&
      (query.state.data as { _id?: string } | undefined)?._id === stationId,
    }, (previous: any) => previous ? {
      ...previous, averageRating: result.stats.averageRating, totalRatings: result.stats.totalRatings,
      ...(typeof result.stats.votes === 'number' ? { votes: result.stats.votes } : {}),
    } : previous);
    void client.invalidateQueries({ queryKey: savedKeys.stats, exact: true, refetchType: 'active' });
    return result;
  }, [client, stationId, userId, sessionId]);

  return {
    userRating: userRating.data?.rating,
    stats: stats.data?.stats,
    statsStatus: stats.isError ? 'error' as const : stats.isPending ? 'loading' as const : 'ready' as const,
    ratingScopeKey: `${userId || 'anon'}:${sessionId}`,
    submitRating,
  };
}
