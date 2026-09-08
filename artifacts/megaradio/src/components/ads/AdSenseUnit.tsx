import { useEffect, useRef, useState } from 'react';
import { usePremiumStatus } from '@/hooks/usePremiumStatus';
import { ADSENSE_CLIENT, ensureAdSenseScript, isAdSensePage } from '@/lib/adsense-runtime';

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
  const { isPremium, isLoading, error } = usePremiumStatus();
  const allowed = !isPremium && !isLoading && !error && isAdSensePage(window.location.pathname);
  const containerRef = useRef<HTMLDivElement>(null);
  const pushedRef = useRef<HTMLElement | null>(null);
  const [sdkReady, setSdkReady] = useState(false);
  const [visible, setVisible] = useState(false);
  const [exposed, setExposed] = useState(false);

  useEffect(() => {
    if (!allowed) return;
    let active = true;
    const load = () => { void ensureAdSenseScript().then(ready => { if (active) setSdkReady(ready); }); };
    const reconnect = () => {
      void ensureAdSenseScript(true).then(ready => { if (active) setSdkReady(ready); });
    };
    window.addEventListener('online', reconnect);
    // Yield noncritical advertising to startup for every visitor, with a
    // bounded delay. Auto ads also load before the footer enters the viewport.
    const idle = window.requestIdleCallback?.(load, { timeout: 2000 });
    const timer = idle === undefined ? setTimeout(load, 500) : undefined;
    return () => {
      active = false;
      window.removeEventListener('online', reconnect);
      if (idle !== undefined) window.cancelIdleCallback?.(idle);
      clearTimeout(timer);
    };
  }, [allowed]);

  useEffect(() => {
    const container = containerRef.current;
    if (!allowed || !container) { setVisible(false); setExposed(false); return; }
    let inView = !('IntersectionObserver' in window);
    const check = () => {
      const visible = inView && container.getBoundingClientRect().width > 0;
      setVisible(visible);
      if (visible) setExposed(true);
    };
    const observer = typeof IntersectionObserver === 'undefined' ? undefined : new IntersectionObserver(entries => {
      inView = !!entries[0]?.isIntersecting;
      check();
    }, { rootMargin: '300px' });
    const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(check);
    observer?.observe(container);
    resize?.observe(container);
    window.addEventListener('resize', check);
    check();
    return () => { observer?.disconnect(); resize?.disconnect(); window.removeEventListener('resize', check); };
  }, [allowed]);

  useEffect(() => {
    if (!allowed || !visible || !sdkReady) return;
    const ins = containerRef.current?.querySelector<HTMLElement>('ins.adsbygoogle');
    if (!ins || pushedRef.current === ins || ins.hasAttribute('data-adsbygoogle-status') || ins.getBoundingClientRect().width <= 0) return;
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
      pushedRef.current = ins;
    } catch { /* Blocked/no-fill ads must not crash the radio page. */ }
  }, [allowed, visible, sdkReady]);

  if (isPremium || !isAdSensePage(window.location.pathname)) return null;
  return (
    <div ref={containerRef} className={`adsense-container ${className}`} style={{ minHeight: '90px' }}>
      {/* Keep an initialized element on scroll; never manufacture ad refreshes. */}
      {allowed && exposed && <ins className="adsbygoogle" style={{ display: 'block', minHeight: '90px' }}
        data-ad-client={ADSENSE_CLIENT} data-ad-slot={adSlot} data-ad-format={adFormat}
        data-full-width-responsive={fullWidthResponsive.toString()} />}
    </div>
  );
}
