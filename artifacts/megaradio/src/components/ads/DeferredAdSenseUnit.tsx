import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useLocation, useSearch } from 'wouter';
import { usePremiumStatus } from '@/hooks/usePremiumStatus';
import { getAdvertisementLabel, isAdSensePage } from '@/lib/adsense-runtime';
import type { AdSenseUnitProps } from './AdSenseUnit';

const AdSenseUnit = lazy(() => import('./AdSenseUnit'));

/** Keep offscreen and responsive-hidden placements out of the startup imports. */
export default function DeferredAdSenseUnit(props: AdSenseUnitProps) {
  const [location] = useLocation();
  const search = useSearch();
  const { isPremium, isLoading, error } = usePremiumStatus();
  const containerRef = useRef<HTMLDivElement>(null);
  const [requested, setRequested] = useState(false);
  const routeAllowed = isAdSensePage(location + (search ? `?${search}` : ''))
    && isAdSensePage(window.location.pathname + window.location.search);
  const allowed = !isPremium && !isLoading && !error && routeAllowed;

  useEffect(() => {
    const container = containerRef.current;
    if (requested || !allowed || !container) return;
    const hasObserver = typeof IntersectionObserver === 'function';
    let inView = false;
    const check = () => {
      const rect = container.getBoundingClientRect();
      const intersects = hasObserver ? inView : rect.bottom > 0 && rect.right > 0
        && rect.top < window.innerHeight && rect.left < window.innerWidth;
      if (intersects && rect.width > 0 && rect.height > 0 && document.visibilityState !== 'hidden'
        && isAdSensePage(window.location.pathname + window.location.search)) setRequested(true);
    };
    const observer = !hasObserver ? undefined : new IntersectionObserver(entries => {
      inView = !!entries[0]?.isIntersecting;
      check();
    });
    const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(check);
    observer?.observe(container);
    resize?.observe(container);
    window.addEventListener('resize', check);
    if (!hasObserver) window.addEventListener('scroll', check, { passive: true });
    document.addEventListener('visibilitychange', check);
    check();
    return () => {
      observer?.disconnect();
      resize?.disconnect();
      window.removeEventListener('resize', check);
      if (!hasObserver) window.removeEventListener('scroll', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, [allowed, requested]);

  if (isPremium || !routeAllowed) return null;
  // Match the unexposed unit's geometry and label without starting Google's SDK.
  const placeholder = <div ref={containerRef} className={`adsense-container ${props.className || ''}`}
    style={{ minHeight: '90px' }} data-ad-placement={props.adSlot || '3609188113'}>
    {allowed && <div className="mb-2 text-center text-xs leading-4 text-neutral-400">
      {getAdvertisementLabel(location.split('/')[1] || 'en')}
    </div>}
  </div>;
  // A filled unit survives scrolling out of view; its own policy guards SDK work.
  return requested ? <Suspense fallback={placeholder}><AdSenseUnit {...props} /></Suspense> : placeholder;
}
