import { queryOptions } from '@tanstack/react-query';
import { getQueryFn } from './queryClient';

export interface AuthQueryResponse {
  authenticated?: boolean;
  user?: { _id: string; [key: string]: unknown } | null;
  _pendingTokenExchange?: boolean;
}

// Read before main.tsx removes the OAuth callback token from the URL. The
// exchange seeds its pending marker before any React observer can subscribe.
const hadAuthTokenOnLoad = typeof window !== 'undefined'
  && new URLSearchParams(window.location.search).has('auth_token');

export function isTransientAuthError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  // Existing getQueryFn preserves HTTP status as "503: ...". Do not retry
  // access denial, rate limits, aborts or malformed successful JSON responses.
  return /^5\d{2}:/.test(error.message)
    || error.name === 'TypeError' || error.name === 'NetworkError';
}

/** All startup auth observers share the same fetch, retry and OAuth policy.
 * React Query owns one retry timer and one online subscription per query/client,
 * not per card. Other endpoint policies remain unchanged. */
export const authQueryOptions = queryOptions({
  queryKey: ['/api/auth/me'],
  queryFn: getQueryFn<AuthQueryResponse | null>({ on401: 'throw' }),
  staleTime: 5 * 60 * 1000,
  gcTime: 10 * 60 * 1000,
  retry: (failureCount, error) => failureCount < 1 && isTransientAuthError(error),
  retryDelay: 1000,
  retryOnMount: false,
  refetchOnMount: false,
  refetchOnWindowFocus: false,
  refetchOnReconnect: query => query.state.status === 'error' && isTransientAuthError(query.state.error),
  enabled: query => query.state.data?._pendingTokenExchange !== true
    && (!hadAuthTokenOnLoad || query.state.data !== undefined),
});
