import { useState, useMemo, useEffect } from 'react';
import { cn, normalizeFaviconUrl } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';

interface LogoAssets {
  folder: string;
  webp48?: string;
  webp96?: string;
  webp256?: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
}

interface Station {
  _id?: string;
  name: string;
  slug?: string;
  favicon?: string;
  localImagePath?: string;
  logoAssets?: LogoAssets;
  country?: string;
  countryCode?: string;
}

interface StationLogoProps {
  station: Station;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'card' | 'player' | 'hero';
  className?: string;
  alt?: string;
  priority?: boolean;
  width?: number;
  height?: number;
}

const SIZES = {
  xs: { px: 24, webp: 48, className: 'w-6 h-6' },
  sm: { px: 32, webp: 48, className: 'w-8 h-8' },
  md: { px: 48, webp: 48, className: 'w-12 h-12' },
  lg: { px: 64, webp: 96, className: 'w-16 h-16' },
  xl: { px: 96, webp: 96, className: 'w-24 h-24' },
  card: { px: 90, webp: 96, className: 'w-[90px] h-[90px]' },
  player: { px: 105, webp: 256, className: 'w-[105px] h-[105px]' },
  hero: { px: 200, webp: 256, className: 'w-[200px] h-[200px]' },
} as const;

const FALLBACK_IMAGE = '/images/no-image.webp';

// NoImage Fallback Component - #3E3E3E background with musikno8.svg icon centered
function NoImageFallback({ className }: { className?: string }) {
  return (
    <div 
      className={cn("flex items-center justify-center", className)}
      style={{ 
        backgroundColor: '#3E3E3E',
        borderRadius: '9.95px'
      }}
    >
      <img 
        src="/icons/musikno8.svg" 
        alt="No image" 
        className="w-[44%] h-[43%] object-contain"
      />
    </div>
  );
}

function getLogoUrl(station: Station, preferredSize: 48 | 96 | 256 = 96): string {
  // 1. First priority: Optimized logo assets (local WebP files)
  if (station.logoAssets?.status === 'completed' && station.logoAssets.folder) {
    const filename = station.logoAssets[`webp${preferredSize}` as keyof typeof station.logoAssets] as string | undefined;
    if (filename) {
      return `/station-logos/${station.logoAssets.folder}/${filename}`;
    }
  }

  // 2. Second priority: Old local image path
  if (station.localImagePath) {
    return `/station-images/${station.localImagePath}`;
  }

  // 3. Third priority: External favicon URL (critical for backward compatibility)
  // Uses shared helper for SSR-safe URL normalization and proxy
  if (station.favicon) {
    const normalizedUrl = normalizeFaviconUrl(station.favicon);
    if (normalizedUrl !== '/images/no-image.webp') {
      return normalizedUrl;
    }
  }

  // 4. Final fallback: Default placeholder
  return FALLBACK_IMAGE;
}

// getSrcSet moved inline to StationLogo component to handle error levels

function getSizes(size: keyof typeof SIZES): string {
  const px = SIZES[size].px;
  return `${px}px`;
}

export function StationLogo({ 
  station, 
  size = 'md', 
  className,
  alt,
  priority = false
}: StationLogoProps) {
  const { t } = useTranslation();
  const sizeConfig = SIZES[size];
  const preferredWebp = sizeConfig.webp as 48 | 96 | 256;

  // Build ordered list of image sources to try
  const sources = useMemo(() => {
    const list: string[] = [];
    
    // 1. Optimized logoAssets (local WebP files)
    if (station.logoAssets?.status === 'completed' && station.logoAssets.folder) {
      const filename = station.logoAssets[`webp${preferredWebp}` as keyof typeof station.logoAssets] as string | undefined;
      if (filename) {
        list.push(`/station-logos/${station.logoAssets.folder}/${filename}`);
      }
    }
    
    // 2. Legacy local image path
    if (station.localImagePath) {
      list.push(`/station-images/${station.localImagePath}`);
    }
    
    // 3. External favicon URL
    if (station.favicon) {
      const normalizedUrl = normalizeFaviconUrl(station.favicon);
      if (normalizedUrl !== FALLBACK_IMAGE) {
        list.push(normalizedUrl);
      }
    }
    
    // 4. Final fallback always available
    list.push(FALLBACK_IMAGE);
    
    return list;
  }, [station, preferredWebp]);

  // Track current source index - reset when station changes
  const [sourceIndex, setSourceIndex] = useState(0);
  const stationKey = station._id || station.slug || station.name;
  
  useEffect(() => {
    setSourceIndex(0);
  }, [stationKey]);
  
  const logoUrl = sources[Math.min(sourceIndex, sources.length - 1)];

  const srcSet = useMemo(() => {
    // Only provide srcSet for logoAssets (first source and still trying it)
    if (sourceIndex > 0) return undefined;
    if (station.logoAssets?.status !== 'completed' || !station.logoAssets.folder) {
      return undefined;
    }

    const folder = station.logoAssets.folder;
    const parts: string[] = [];

    if (station.logoAssets.webp48) {
      parts.push(`/station-logos/${folder}/${station.logoAssets.webp48} 48w`);
    }
    if (station.logoAssets.webp96) {
      parts.push(`/station-logos/${folder}/${station.logoAssets.webp96} 96w`);
    }
    if (station.logoAssets.webp256) {
      parts.push(`/station-logos/${folder}/${station.logoAssets.webp256} 256w`);
    }

    return parts.length > 0 ? parts.join(', ') : undefined;
  }, [station, sourceIndex]);

  const stationName = station.name || 'Radio Station';
  const altText = alt || t('station_logo_alt', `${stationName} logo`, { stationName });

  const handleError = () => {
    // Move to next source in the list
    setSourceIndex(prev => Math.min(prev + 1, sources.length - 1));
  };

  // If className contains positioning (absolute/inset), use w-full h-full to fill container
  const useFillMode = className?.includes('absolute') || className?.includes('inset');
  
  // Check if we're at the fallback image (last resort)
  const isShowingFallback = logoUrl === FALLBACK_IMAGE;

  // If showing fallback, render the custom NoImage component
  if (isShowingFallback) {
    return (
      <NoImageFallback 
        className={cn(
          useFillMode ? 'w-full h-full' : sizeConfig.className,
          className
        )}
      />
    );
  }

  return (
    <img
      src={logoUrl}
      srcSet={srcSet}
      sizes={srcSet ? getSizes(size) : undefined}
      alt={altText}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      onError={handleError}
      className={cn(
        useFillMode ? 'w-full h-full' : sizeConfig.className,
        'object-cover object-center',
        className
      )}
      data-testid={`station-logo-${station._id || station.slug || 'unknown'}`}
    />
  );
}

export function getStationLogoUrl(station: Station, size: 48 | 96 | 256 = 96): string {
  return getLogoUrl(station, size);
}

export function hasOptimizedLogo(station: Station): boolean {
  return station.logoAssets?.status === 'completed' && !!station.logoAssets.folder;
}

export default StationLogo;
