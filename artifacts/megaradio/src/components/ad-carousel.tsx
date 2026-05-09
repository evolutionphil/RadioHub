import { useState, useEffect } from 'react';

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
}

export function AdCarousel({ 
  ads, 
  position, 
  autoSwitchInterval = 8000,
  placeholderText = 'Ad Space'
}: AdCarouselProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());

  // Filter ads by position and get active ones
  const filteredAds = ads?.filter(ad => ad.position === position && ad.isActive) || [];

  // Auto-switch ads
  useEffect(() => {
    if (filteredAds.length <= 1) return;

    const interval = setInterval(() => {
      setCurrentIndex(prev => (prev + 1) % filteredAds.length);
    }, autoSwitchInterval);

    return () => clearInterval(interval);
  }, [filteredAds.length, autoSwitchInterval]);

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
    return (
      <div className={getPlaceholderStyles()}>
        {placeholderText}
      </div>
    );
  }

  const currentAd = filteredAds[currentIndex];
  const hasMultipleAds = filteredAds.length > 1;
  const isImageFailed = failedImages.has(currentAd._id);

  return (
    <div className={`relative ${getContainerStyles()}`}>
      {/* Ad Card - Direct link to ad URL */}
      <a 
        href={currentAd.url}
        target="_blank"
        rel="noopener noreferrer"
        className="block w-full h-full overflow-hidden hover:opacity-80 transition-opacity"
        data-testid="link-ad"
      >
        {!isImageFailed ? (
          <img 
            src={currentAd.imageUrl}
            alt={currentAd.altText}
            className={getImageStyles()}
            data-testid={`img-${position}-ad`}
            onError={() => {
              setFailedImages(prev => new Set(prev).add(currentAd._id));
            }}
            loading="lazy"
            decoding="async"
            crossOrigin="anonymous"
          />
        ) : (
          <div className={`${getPlaceholderStyles()} text-xs`}>
            <div className="text-center">
              <p className="text-xs">{currentAd.title}</p>
            </div>
          </div>
        )}
      </a>

      {/* Navigation dots for multiple ads */}
      {hasMultipleAds && (
        <div className="absolute bottom-1 left-0 right-0 flex justify-center gap-1 pointer-events-none">
          {filteredAds.map((_, idx) => (
            <button
              key={idx}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setCurrentIndex(idx);
              }}
              className={`pointer-events-auto w-1.5 h-1.5 rounded-full transition-all ${
                idx === currentIndex 
                  ? 'bg-white w-4' 
                  : 'bg-white/50 hover:bg-white/75'
              }`}
              aria-label={`Ad ${idx + 1}`}
              data-testid={`button-ad-nav-${idx}`}
            />
          ))}
        </div>
      )}

      {/* Ad counter */}
      {hasMultipleAds && (
        <div className="absolute top-1 right-1 bg-black/60 text-white text-xs px-1.5 py-0.5 rounded text-xs pointer-events-none">
          {currentIndex + 1}/{filteredAds.length}
        </div>
      )}
    </div>
  );
}
