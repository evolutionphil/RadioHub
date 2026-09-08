import { useState, useEffect, useRef, type ReactNode } from 'react';
import { getLanguageFromPath } from '@workspace/seo-shared/seo-config';
import { getAdvertisementLabel } from '@/lib/adsense-runtime';

interface Advertisement {
  _id: string;
  title: string;
  imageUrl: string;
  altText: string;
  seoDescription?: string;
  url: string;
  position: 'desktop_sidebar' | 'mobile_bottom' | 'middle_section';
  isActive: boolean;
}

interface AdCarouselProps {
  ads: Advertisement[];
  position: 'desktop_sidebar' | 'mobile_bottom' | 'middle_section';
  autoSwitchInterval?: number;
  placeholderText?: string;
  advertisementLabel?: string;
  fallback?: ReactNode;
}

function hasSafeTarget(url: string): boolean {
  if (typeof url !== 'string' || !url.trim()) return false;
  try {
    // Preserve ordinary relative links while rejecting executable/non-web
    // schemes. The same browser URL resolution is used when the link opens.
    const target = new URL(url, typeof window === 'undefined' ? 'https://themegaradio.com' : window.location.href);
    return target.protocol === 'https:' || target.protocol === 'http:';
  } catch {
    return false;
  }
}

export function AdCarousel({ 
  ads, 
  position, 
  autoSwitchInterval = 30000,
  placeholderText = 'Ad Space',
  advertisementLabel,
  fallback,
}: AdCarouselProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  const [documentVisible, setDocumentVisible] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden');
  const [reducedMotion, setReducedMotion] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);

  // Filter ads by position and get active ones
  const filteredAds = ads?.filter(ad => ad.position === position && ad.isActive && hasSafeTarget(ad.url) && !failedImages.has(`${ad._id}:${ad.imageUrl}`)) || [];
  // An admin edit/deactivation can shrink a live list while its old index is
  // still selected. Clamp during render, not in an effect after a crash.
  const safeIndex = filteredAds.length ? currentIndex % filteredAds.length : 0;
  const hasMultipleAds = filteredAds.length > 1;

  useEffect(() => {
    setInView(false);
    // Without a visibility observer, keep manual navigation available instead
    // of guessing that a hidden placement is visible.
    if (!hasMultipleAds || !containerRef.current || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => {
      setInView(entries.some(entry => entry.target === containerRef.current && entry.isIntersecting));
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [hasMultipleAds, position]);

  useEffect(() => {
    if (!hasMultipleAds) return;
    const updateVisibility = () => setDocumentVisible(document.visibilityState !== 'hidden');
    updateVisibility();
    document.addEventListener('visibilitychange', updateVisibility);
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const updateMotion = () => setReducedMotion(!!media?.matches);
    updateMotion();
    if (media?.addEventListener) media.addEventListener('change', updateMotion);
    else media?.addListener?.(updateMotion);
    return () => {
      document.removeEventListener('visibilitychange', updateVisibility);
      if (media?.removeEventListener) media.removeEventListener('change', updateMotion);
      else media?.removeListener?.(updateMotion);
    };
  }, [hasMultipleAds]);

  // Only direct sponsors rotate; a Google fallback is never refreshed or
  // remounted by this timer. Resuming starts a fresh, unhurried interval.
  useEffect(() => {
    if (!hasMultipleAds || !inView || !documentVisible || reducedMotion || hovered || focused
      || !Number.isFinite(autoSwitchInterval) || autoSwitchInterval <= 0) return;

    const interval = setInterval(() => {
      setCurrentIndex(prev => (prev + 1) % filteredAds.length);
    }, autoSwitchInterval);

    return () => clearInterval(interval);
  }, [filteredAds.length, hasMultipleAds, autoSwitchInterval, inView, documentVisible, reducedMotion, hovered, focused]);

  // Position-specific styles
  const getContainerStyles = () => {
    switch (position) {
      case 'middle_section':
        return 'w-full max-w-[1206px] h-[175px] mx-auto rounded-[10px]';
      case 'desktop_sidebar':
        return 'w-[218px] h-[218px] rounded-[10px]';
      case 'mobile_bottom':
        return 'w-full h-auto';
      default:
        return 'w-full h-auto';
    }
  };

  const getImageStyles = () => {
    switch (position) {
      case 'middle_section':
        return 'w-full h-[175px] object-cover rounded-[10px]';
      case 'desktop_sidebar':
        return 'w-[218px] h-[218px] object-cover rounded-[10px]';
      case 'mobile_bottom':
        return 'w-full h-auto object-contain rounded';
      default:
        return 'w-full h-auto object-contain rounded';
    }
  };

  const getPlaceholderStyles = () => {
    switch (position) {
      case 'middle_section':
        return 'w-full max-w-[1206px] h-[175px] mx-auto rounded-[10px] bg-gray-800 flex items-center justify-center text-gray-400 text-sm';
      case 'desktop_sidebar':
        return 'w-[218px] h-[218px] rounded-[10px] bg-gray-800 flex items-center justify-center text-gray-400 text-sm';
      case 'mobile_bottom':
        return 'w-full min-h-[96px] aspect-[4/1] rounded bg-gray-800 flex items-center justify-center text-gray-400 text-sm';
      default:
        return 'w-full min-h-[96px] aspect-[4/1] rounded bg-gray-800 flex items-center justify-center text-gray-400 text-sm';
    }
  };

  if (!filteredAds || filteredAds.length === 0) {
    if (fallback !== undefined) return <>{fallback}</>;
    return (
      <div className={getPlaceholderStyles()}>
        {placeholderText}
      </div>
    );
  }

  const currentAd = filteredAds[safeIndex];
  const isImageFailed = failedImages.has(`${currentAd._id}:${currentAd.imageUrl}`);
  const label = advertisementLabel || getAdvertisementLabel(getLanguageFromPath(typeof window === 'undefined' ? '/en' : window.location.pathname).language);

  return (
    <div ref={containerRef} className={`relative ${getContainerStyles()}`} role="group" aria-label={label}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}>
      {/* Ad Card - Direct link to ad URL */}
      <a 
        href={currentAd.url}
        target="_blank"
        rel="sponsored noopener noreferrer"
        className="block w-full h-full overflow-hidden hover:opacity-80 transition-opacity motion-reduce:transition-none"
        data-testid="link-ad"
      >
        {!isImageFailed ? (
          <img 
            src={currentAd.imageUrl}
            alt={currentAd.altText}
            className={getImageStyles()}
            data-testid={`img-${position}-ad`}
            onError={() => {
              setFailedImages(prev => new Set(prev).add(`${currentAd._id}:${currentAd.imageUrl}`));
            }}
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div className={`${getPlaceholderStyles()} text-xs`}>
            <div className="text-center">
              <p className="text-xs">{currentAd.title}</p>
            </div>
          </div>
        )}
      </a>

      <div className="absolute top-1 left-1 bg-black/70 text-white text-xs px-1.5 py-0.5 rounded pointer-events-none">
        {label}
      </div>

      {/* Navigation dots for multiple ads */}
      {hasMultipleAds && (
        <div className="absolute bottom-1 left-0 right-0 flex justify-center gap-1 pointer-events-none">
          {filteredAds.map((_, idx) => (
            <button
              key={filteredAds[idx]._id}
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setCurrentIndex(idx);
              }}
              className={`pointer-events-auto w-1.5 h-1.5 rounded-full transition-all motion-reduce:transition-none ${
                idx === safeIndex
                  ? 'bg-white w-4' 
                  : 'bg-white/50 hover:bg-white/75'
              }`}
              aria-label={`${label} ${idx + 1}`}
              aria-pressed={idx === safeIndex}
              data-testid={`button-ad-nav-${idx}`}
            />
          ))}
        </div>
      )}

      {/* Ad counter */}
      {hasMultipleAds && (
        <div className="absolute top-1 right-1 bg-black/60 text-white text-xs px-1.5 py-0.5 rounded text-xs pointer-events-none">
          {safeIndex + 1}/{filteredAds.length}
        </div>
      )}
    </div>
  );
}
