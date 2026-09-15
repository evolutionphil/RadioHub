import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { fetchRecommendationPool, recommendationPoolKey } from '@/lib/recommendation-pool';

/**
 * RecommendationsPrefetcher
 *
 * Warms the one bounded country pool shared by For You's discovery and
 * trending sections. Specific moods/tastes are fetched only when needed.
 *
 * Why a separate component:
 *   - Mounted once at the top of <App> (next to TranslationPreloader)
 *     so it does NOT re-run on every route change.
 *   - Speculative work waits for load and interaction (or an 8s grace
 *     period), then idle. Window load alone can precede async page content
 *     and is not proof that LCP has finished. Actual route queries never wait.
 *   - The query key and five-minute browser freshness match the page.
 *
 * If the user is on a Save-Data / 2G-effective connection, prefetch
 * is skipped — bandwidth-conscious users shouldn't pay for content
 * they may never visit.
 */
export function RecommendationsPrefetcher() {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const STATION_FRESHNESS_MS = 5 * 60 * 1000;

    // Bail out for data-saver / very slow connections.
    const conn: any = (navigator as any).connection;
    if (conn) {
      if (conn.saveData === true) return;
      if (typeof conn.effectiveType === 'string' &&
        (conn.effectiveType === 'slow-2g' || conn.effectiveType === '2g')) {
        return;
      }
    }

    const prefetchAll = () => {
      let country = 'all';
      try { country = localStorage.getItem('selectedCountry') || 'all'; } catch { /* storage may be disabled */ }
      queryClient.prefetchQuery({
        queryKey: recommendationPoolKey(country),
        queryFn: ({ signal }) => fetchRecommendationPool(country, [], signal),
        staleTime: STATION_FRESHNESS_MS,
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
