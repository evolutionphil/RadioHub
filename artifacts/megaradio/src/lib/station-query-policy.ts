/** One shared query refetch per key on normal navigation/focus/reconnect, never polling per card. */
export const stationQueryFreshness = {
  staleTime: 5 * 60 * 1000,
  refetchOnMount: true,
  refetchOnWindowFocus: true,
  refetchOnReconnect: true,
} as const;
