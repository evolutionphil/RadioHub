import { useEffect, useRef, useState } from 'react';
import { useLocation, useSearch } from 'wouter';
import { usePremiumStatus } from '@/hooks/usePremiumStatus';
import { ADSENSE_CLIENT, ensureAdSenseScript, getAdvertisementLabel, isAdSensePage } from '@/lib/adsense-runtime';

interface AdSenseUnitProps {
  adSlot?: string;
  adFormat?: 'auto' | 'fluid' | 'rectangle' | 'vertical' | 'horizontal';
  fullWidthResponsive?: boolean;
  className?: string;
}

declare global { interface Window { adsbygoogle: unknown[] } }

export default function AdSenseUnit(props: AdSenseUnitProps) {
  // Google owns a filled <ins>. A new slot/format needs a fresh element.
  return <AdSensePlacement key={JSON.stringify([props.adSlot, props.adFormat, props.fullWidthResponsive])} {...props} />;
}

function AdSensePlacement({ adSlot = '3609188113', adFormat = 'auto', fullWidthResponsive = true, className = '' }: AdSenseUnitProps) {
  // Subscribe independently of the deferred public router. Its old editorial
  // page can remain mounted while the actual URL is already a private page.
  const [location] = useLocation();
  const search = useSearch();
  const { isPremium, isLoading, error } = usePremiumStatus();
  const routeAllowed = isAdSensePage(location + (search ? `?${search}` : '')) && isAdSensePage(window.location.pathname + window.location.search);
  const allowed = !isPremium && !isLoading && !error && routeAllowed;
  const containerRef = useRef<HTMLDivElement>(null);
  const pushedRef = useRef<HTMLElement | null>(null);
  const [sdkReady, setSdkReady] = useState(false);
  const [visible, setVisible] = useState(false);
  const [exposed, setExposed] = useState(false);

  useEffect(() => {
    if (!allowed || !visible) return;
    let active = true;
    const stillEligible = () => active && isAdSensePage(window.location.pathname + window.location.search)
      && document.visibilityState !== 'hidden' && (containerRef.current?.getBoundingClientRect().width || 0) > 0;
    const load = () => {
      if (stillEligible()) void ensureAdSenseScript().then(ready => { if (stillEligible()) setSdkReady(ready); });
    };
    const reconnect = () => {
      if (stillEligible()) void ensureAdSenseScript(true).then(ready => { if (stillEligible()) setSdkReady(ready); });
    };
    window.addEventListener('online', reconnect);
    // Yield only after an eligible placement actually enters the viewport.
    // A hidden responsive counterpart or a distant footer must not start SDKs.
    const idle = window.requestIdleCallback?.(load, { timeout: 2000 });
    const timer = idle === undefined ? setTimeout(load, 500) : undefined;
    return () => {
      active = false;
      window.removeEventListener('online', reconnect);
      if (idle !== undefined) window.cancelIdleCallback?.(idle);
      clearTimeout(timer);
    };
  }, [allowed, visible]);

  useEffect(() => {
    const container = containerRef.current;
    if (!allowed || !container) { setVisible(false); setExposed(false); return; }
    const hasIntersectionObserver = typeof IntersectionObserver === 'function';
    let inView = false;
    const check = () => {
      const rect = container.getBoundingClientRect();
      // Legacy webviews still need a real viewport test, not merely a nonzero
      // width: a distant footer has width too. Modern browsers retain IO.
      const intersectsViewport = hasIntersectionObserver ? inView : rect.bottom > 0 && rect.right > 0
        && rect.top < window.innerHeight && rect.left < window.innerWidth && rect.height > 0;
      const visible = intersectsViewport && document.visibilityState !== 'hidden' && rect.width > 0;
      setVisible(visible);
      if (visible) setExposed(true);
    };
    const observer = !hasIntersectionObserver ? undefined : new IntersectionObserver(entries => {
      inView = !!entries[0]?.isIntersecting;
      check();
    }, { rootMargin: '0px' });
    const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(check);
    observer?.observe(container);
    resize?.observe(container);
    window.addEventListener('resize', check);
    if (!hasIntersectionObserver) window.addEventListener('scroll', check, { passive: true });
    document.addEventListener('visibilitychange', check);
    check();
    return () => {
      observer?.disconnect(); resize?.disconnect(); window.removeEventListener('resize', check);
      if (!hasIntersectionObserver) window.removeEventListener('scroll', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, [allowed]);

  useEffect(() => {
    if (!allowed || !visible || !sdkReady || !isAdSensePage(window.location.pathname + window.location.search) || document.visibilityState === 'hidden') return;
    const ins = containerRef.current?.querySelector<HTMLElement>('ins.adsbygoogle');
    if (!ins || pushedRef.current === ins || ins.hasAttribute('data-adsbygoogle-status') || ins.getBoundingClientRect().width <= 0) return;
    try {
      // Treat even a throwing SDK call as this element's single attempt: the
      // SDK may have partially handled it before throwing. Scroll is no retry.
      pushedRef.current = ins;
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch { /* Blocked/no-fill ads must not crash the radio page. */ }
  }, [allowed, visible, sdkReady]);

  if (isPremium || !routeAllowed) return null;
  return (
    <div ref={containerRef} className={`adsense-container ${className}`} style={{ minHeight: '90px' }} data-ad-placement={adSlot}>
      {allowed && <div className="mb-2 text-center text-xs leading-4 text-neutral-400">{getAdvertisementLabel(location.split('/')[1] || 'en')}</div>}
      {/* Keep an initialized element on scroll; never manufacture ad refreshes. */}
      {allowed && exposed && <ins className="adsbygoogle" style={{ display: 'block', minHeight: '90px' }}
        data-ad-client={ADSENSE_CLIENT} data-ad-slot={adSlot} data-ad-format={adFormat}
        data-full-width-responsive={fullWidthResponsive.toString()} />}
    </div>
  );
}
