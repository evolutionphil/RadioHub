import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getPrecomputedStationsSlice } from '@/lib/precomputed-pool';

/**
 * RecommendationsPrefetcher
 *
 * Background-prefetches every network request the /recommendations
 * ("For You") page makes so that, by the time the user clicks the
 * sidebar entry, the page renders instantly from TanStack Query's
 * cache instead of triggering 3-4 fresh HTTP round-trips.
 *
 * Why a separate component:
 *   - Mounted once at the top of <App> (next to TranslationPreloader)
 *     so it does NOT re-run on every route change.
 *   - Speculative work waits for load and interaction (or an 8s grace
 *     period), then idle. Window load alone can precede async page content
 *     and is not proof that LCP has finished. Actual route queries never wait.
 *   - QueryKeys, URLs, limits and 7-day staleTimes mirror exactly
 *     what `pages/recommendations.tsx` registers, so the cache hit
 *     is byte-identical and TanStack Query reuses the data instead
 *     of refetching.
 *
 * If the user is on a Save-Data / 2G-effective connection, prefetch
 * is skipped — bandwidth-conscious users shouldn't pay for content
 * they may never visit.
 */
export function RecommendationsPrefetcher() {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

    // Bail out for data-saver / very slow connections.
    const conn: any = (navigator as any).connection;
    if (conn) {
      if (conn.saveData === true) return;
      if (typeof conn.effectiveType === 'string' &&
        (conn.effectiveType === 'slow-2g' || conn.effectiveType === '2g')) {
        return;
      }
    }

    // Defaults for non-logged-in / cold prefetch. The /recommendations
    // page itself uses `selectedCountry` from the URL/picker; "all"
    // (→ countryName=global) is by far the most common starting state
    // and matches what the page hits on first paint.
    const selectedCountry = 'all';
    const countryParam = 'global';

    const prefetchAll = () => {
      // 1. Mood pool (200-station global cache, drives every mood card).
      queryClient.prefetchQuery({
        queryKey: ['/api/stations/precomputed', 'global', 200, 'mood-pool'],
        // PageSpeed 2026-07-03: all four prefetches below share ONE
        // limit=200 network request via getPrecomputedStationsSlice —
        // the server slices the same cached pool, so the rows are
        // identical to the previous per-limit fetches.
        queryFn: async () => getPrecomputedStationsSlice('global', 200),
        staleTime: SEVEN_DAYS_MS,
      });

      // 2. Trending (50 stations, /api/stations/trending key).
      queryClient.prefetchQuery({
        queryKey: ['/api/stations/trending', selectedCountry],
        queryFn: async () => getPrecomputedStationsSlice(countryParam, 50),
        staleTime: SEVEN_DAYS_MS,
      });

      // 3. Discovery (100 stations, /api/stations/discovery key).
      queryClient.prefetchQuery({
        queryKey: ['/api/stations/discovery', selectedCountry],
        queryFn: async () => getPrecomputedStationsSlice(countryParam, 100),
        staleTime: SEVEN_DAYS_MS,
      });

      // 4. Default recommendations (12 stations shown when no mood is
      //    picked — first thing the user sees).
      queryClient.prefetchQuery({
        queryKey: ['/api/stations/default-recommendations', selectedCountry],
        queryFn: async () => getPrecomputedStationsSlice(countryParam, 12),
        staleTime: SEVEN_DAYS_MS,
      });
    };

    let loaded = document.readyState === 'complete';
    let interacted = false;
    let scheduled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let idleId: number | undefined;
    const scheduleWhenIdle = () => {
      if (scheduled) return;
      scheduled = true;
      clearTimeout(timer);
      const ric: any = (window as any).requestIdleCallback;
      if (typeof ric === 'function') {
        idleId = ric(prefetchAll, { timeout: 4000 });
      } else {
        // Safari: no requestIdleCallback. Defer to a low-priority
        // setTimeout AFTER the load event already fired.
        timer = setTimeout(prefetchAll, 1500);
      }
    };
    const handleInteraction = () => { interacted = true; if (loaded) scheduleWhenIdle(); };
    const handleLoad = () => {
      loaded = true;
      if (interacted) scheduleWhenIdle();
      else timer = setTimeout(scheduleWhenIdle, 8000);
    };
    window.addEventListener('pointerdown', handleInteraction, { once: true, passive: true });
    window.addEventListener('keydown', handleInteraction, { once: true });
    if (loaded) handleLoad();
    else window.addEventListener('load', handleLoad, { once: true });
    return () => {
      clearTimeout(timer);
      if (idleId !== undefined) window.cancelIdleCallback(idleId);
      window.removeEventListener('load', handleLoad);
      window.removeEventListener('pointerdown', handleInteraction);
      window.removeEventListener('keydown', handleInteraction);
    };
  }, [queryClient]);

  return null;
}
