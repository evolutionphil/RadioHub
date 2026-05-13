import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

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
 *   - All work is gated behind `requestIdleCallback` AND the `load`
 *     event so it cannot regress LCP / TBT / PageSpeed scores. The
 *     fetches kick off only after the browser has finished painting,
 *     bundling, and the main thread has been idle for ≥1s.
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
        queryFn: async () => {
          const r = await fetch('/api/stations/precomputed?countryName=global&page=1&limit=200');
          if (!r.ok) throw new Error('prefetch mood-pool failed');
          const j = await r.json();
          return j.data || [];
        },
        staleTime: SEVEN_DAYS_MS,
      });

      // 2. Trending (50 stations, /api/stations/trending key).
      queryClient.prefetchQuery({
        queryKey: ['/api/stations/trending', selectedCountry],
        queryFn: async () => {
          const r = await fetch(`/api/stations/precomputed?countryName=${countryParam}&page=1&limit=50`);
          if (!r.ok) throw new Error('prefetch trending failed');
          const j = await r.json();
          return j.data || [];
        },
        staleTime: SEVEN_DAYS_MS,
      });

      // 3. Discovery (100 stations, /api/stations/discovery key).
      queryClient.prefetchQuery({
        queryKey: ['/api/stations/discovery', selectedCountry],
        queryFn: async () => {
          const r = await fetch(`/api/stations/precomputed?countryName=${countryParam}&page=1&limit=100`);
          if (!r.ok) throw new Error('prefetch discovery failed');
          const j = await r.json();
          return j.data || [];
        },
        staleTime: SEVEN_DAYS_MS,
      });

      // 4. Default recommendations (12 stations shown when no mood is
      //    picked — first thing the user sees).
      queryClient.prefetchQuery({
        queryKey: ['/api/stations/default-recommendations', selectedCountry],
        queryFn: async () => {
          const r = await fetch(`/api/stations/precomputed?countryName=${countryParam}&page=1&limit=12`);
          if (!r.ok) throw new Error('prefetch default failed');
          const j = await r.json();
          return j.data || [];
        },
        staleTime: SEVEN_DAYS_MS,
      });
    };

    // Two-stage gate: wait for full window load, THEN for the main
    // thread to be idle. Keeps PageSpeed metrics (LCP/FID/CLS/TBT)
    // untouched.
    const scheduleWhenIdle = () => {
      const ric: any = (window as any).requestIdleCallback;
      if (typeof ric === 'function') {
        ric(prefetchAll, { timeout: 4000 });
      } else {
        // Safari: no requestIdleCallback. Defer to a low-priority
        // setTimeout AFTER the load event already fired.
        setTimeout(prefetchAll, 1500);
      }
    };

    if (document.readyState === 'complete') {
      scheduleWhenIdle();
    } else {
      window.addEventListener('load', scheduleWhenIdle, { once: true });
    }
  }, [queryClient]);

  return null;
}
