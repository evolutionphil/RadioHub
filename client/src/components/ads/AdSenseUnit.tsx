import { useEffect, useRef } from "react";

interface AdSenseUnitProps {
  adSlot?: string;
  adFormat?: "auto" | "fluid" | "rectangle" | "vertical" | "horizontal";
  fullWidthResponsive?: boolean;
  className?: string;
}

declare global {
  interface Window {
    adsbygoogle: unknown[];
  }
}

export default function AdSenseUnit({ 
  adSlot = "7923500623",
  adFormat = "auto",
  fullWidthResponsive = true,
  className = ""
}: AdSenseUnitProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pushedRef = useRef(false);

  useEffect(() => {
    pushedRef.current = false;
    if (typeof window === "undefined" || !containerRef.current) return;

    const container = containerRef.current;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout>;
    let retryCount = 0;

    const doPush = () => {
      if (cancelled || pushedRef.current) return;
      const ins = container.querySelector('ins.adsbygoogle');
      if (!ins) return;
      if (ins.hasAttribute('data-adsbygoogle-status')) {
        pushedRef.current = true;
        return;
      }
      try {
        (window.adsbygoogle = window.adsbygoogle || []).push({});
        pushedRef.current = true;
      } catch (_e) {
        // AdSense not ready yet
      }
    };

    const tryWithRetry = () => {
      if (cancelled || pushedRef.current) return;

      const ins = container.querySelector('ins.adsbygoogle');
      if (ins?.hasAttribute('data-adsbygoogle-status')) {
        pushedRef.current = true;
        return;
      }

      doPush();

      if (!pushedRef.current && retryCount < 20) {
        retryCount++;
        retryTimer = setTimeout(tryWithRetry, 500);
      }
    };

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setTimeout(tryWithRetry, 200);
          observer.disconnect();
        }
      },
      { rootMargin: "300px" }
    );

    observer.observe(container);

    return () => {
      cancelled = true;
      observer.disconnect();
      clearTimeout(retryTimer);
    };
  }, [adSlot]);

  return (
    <div ref={containerRef} className={`adsense-container ${className}`}>
      <ins
        className="adsbygoogle"
        style={{ display: "block", minHeight: "90px" }}
        data-ad-client="ca-pub-8771434485570434"
        data-ad-slot={adSlot}
        data-ad-format={adFormat}
        data-full-width-responsive={fullWidthResponsive.toString()}
      />
    </div>
  );
}
