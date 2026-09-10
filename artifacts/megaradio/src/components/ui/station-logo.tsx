import { useState, useMemo, useEffect, type SyntheticEvent, type ImgHTMLAttributes } from 'react';
import { cn, normalizeFaviconUrl } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';
import { hasRecentStationLogoFailure, rememberStationLogoFailure, clearStationLogoFailure } from '@/lib/station-logo-failure-cache';

interface LogoAssets {
  folder?: string;
  original?: string;
  webp48?: string;
  webp96?: string;
  webp256?: string;
  status?: 'pending' | 'processing' | 'completed' | 'failed';
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
  // Match a caller's CSS slot without changing dimensions or inventing assets.
  sizes?: string;
  width?: number;
  height?: number;
}

const SIZES = {
  xs: { px: 24, className: 'w-6 h-6' },
  sm: { px: 32, className: 'w-8 h-8' },
  md: { px: 48, className: 'w-12 h-12' },
  lg: { px: 64, className: 'w-16 h-16' },
  xl: { px: 96, className: 'w-24 h-24' },
  card: { px: 90, className: 'w-[90px] h-[90px]' },
  player: { px: 105, className: 'w-[105px] h-[105px]' },
  hero: { px: 200, className: 'w-[200px] h-[200px]' },
} as const;

const FALLBACK_IMAGE = '/images/no-image.webp';

// NoImage Fallback Component - #3E3E3E background with inline music-note icon
function NoImageFallback({ className, label }: { className?: string; label: string }) {
  return (
    <div
      className={cn("flex items-center justify-center", className)}
      style={{
        backgroundColor: '#3E3E3E',
        borderRadius: '9.95px',
      }}
      aria-label={label}
      role="img"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-[44%] h-[43%]"
        aria-hidden="true"
      >
        <path
          d="M9 18V5l12-2v13"
          stroke="#FFFFFF"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="6" cy="18" r="3" fill="#FFFFFF" />
        <circle cx="18" cy="16" r="3" fill="#FFFFFF" />
      </svg>
    </div>
  );
}

// Resolve a logoAssets value to an absolute URL.
// S3 data: value is already a full https:// URL → return as-is.
// Local data: value is a filename → prefix with API base so the request goes
// to the API container (which stores the files), not the web container.
const _API_ORIGIN = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
function resolveLogoUrl(folder: string | undefined, value: string | undefined): string | undefined {
  const path = typeof value === 'string' ? value.trim() : '';
  if (!path) return undefined;
  if (/^https?:\/\//i.test(path)) return path;
  if (path.startsWith('//')) return `https:${path}`;
  if (path.startsWith('/station-logos/')) return `${_API_ORIGIN}${path}`;
  if (path.startsWith('station-logos/')) return `${_API_ORIGIN}/${path}`;
  if (path.startsWith('/')) return path;
  // Absolute assets do not need folder metadata. A bare filename does.
  if (!folder?.trim() || /^[a-z][a-z\d+.-]*:/i.test(path)) return undefined;
  return `${_API_ORIGIN}/station-logos/${folder.trim().replace(/^\/+|\/+$/g, '')}/${path}`;
}

function resolveLegacyLogoUrl(value: string | undefined): string | undefined {
  const path = typeof value === 'string' ? value.trim() : '';
  if (!path) return undefined;
  if (/^https?:\/\//i.test(path)) return path;
  if (path.startsWith('//')) return `https:${path}`;
  if (path.startsWith('/')) return path;
  if (/^[a-z][a-z\d+.-]*:/i.test(path)) return undefined;
  return path.startsWith('station-images/') ? `/${path}` : `/station-images/${path}`;
}

// LOGO OUTAGE FIX (2026-07-03): the per-country precomputed pools projected
// logoAssets WITHOUT `status` for months, so the strict
// `status === 'completed'` gate silently skipped the S3 assets and dropped
// every country view onto the (mostly dead) favicon-proxy path → placeholder
// icons site-wide. The projection is fixed server-side, but its SWR caches
// serve stale data for up to 7 days — treat a MISSING status as completed
// when concrete asset filenames exist (pending/failed jobs don't have them);
// an explicit non-completed status still blocks as before.
function logoAssetsUsable(assets: Station['logoAssets']): boolean {
  return !!assets && (assets.status === 'completed' || assets.status === undefined);
}

function getLogoSources(station: Station, preferredSize: 48 | 96 | 256 = 96): string[] {
  const sources: string[] = [];
  const assets = station.logoAssets;
  if (assets && logoAssetsUsable(assets)) {
    for (const key of [`webp${preferredSize}`, 'webp96', 'webp256', 'webp48', 'original'] as const) {
      const url = resolveLogoUrl(assets.folder, assets[key]);
      if (url) sources.push(url);
    }
  }

  const legacyUrl = resolveLegacyLogoUrl(station.localImagePath);
  if (legacyUrl) sources.push(legacyUrl);

  const favicon = normalizeFaviconUrl(station.favicon?.trim());
  // Processing mirrors the S3 256px URL into favicon. Retrying that same
  // failed object through the image proxy adds a request, not a fallback.
  if (favicon !== FALLBACK_IMAGE && !sources.some(url => normalizeFaviconUrl(url) === favicon)) {
    sources.push(favicon);
  }

  return [...new Set([...sources, FALLBACK_IMAGE])];
}

// getSrcSet moved inline to StationLogo component to handle error levels

function getSizes(size: keyof typeof SIZES): string {
  const px = SIZES[size].px;
  return `${px}px`;
}

type StationLogoImageProps = ImgHTMLAttributes<HTMLImageElement> & { stationName: string };

function LocalizedStationLogoImage({ stationName, ...props }: StationLogoImageProps) {
  const { t } = useTranslation();
  // Imported dictionaries use both {stationName} and {STATION_NAME}.
  return <img {...props} alt={t('station_logo_alt', `${stationName} logo`, { stationName, STATION_NAME: stationName })} />;
}

// Cards already provide a localized alt. Keep their image path free of the
// translation hook's query subscriptions; only the default needs translation.
function StationLogoImage({ stationName, alt, ...props }: StationLogoImageProps) {
  return alt ? <img {...props} alt={alt} /> : <LocalizedStationLogoImage {...props} stationName={stationName} />;
}

export function StationLogo({ 
  station, 
  size = 'md', 
  className,
  alt,
  sizes,
  priority = false
}: StationLogoProps) {
  const sizeConfig = SIZES[size];

  const preferredAssetSize = sizeConfig.px > 96 ? 256 : 96;
  const sources = useMemo(() => getLogoSources(station, preferredAssetSize), [station, preferredAssetSize]);

  // Track current source index - reset when station changes
  const [sourceIndex, setSourceIndex] = useState(0);
  const [responsiveSourceFailed, setResponsiveSourceFailed] = useState(false);
  const stationKey = station._id || station.slug || station.name;
  
  // Refreshing the same station may replace failed/stale URLs. Reset on the
  // actual source list, not every new object or only on station identity.
  const sourceKey = JSON.stringify(sources);
  useEffect(() => {
    setSourceIndex(0);
    setResponsiveSourceFailed(false);
  }, [stationKey, sourceKey]);
  
  let activeSourceIndex = Math.min(sourceIndex, sources.length - 1);
  while (activeSourceIndex < sources.length - 1 && hasRecentStationLogoFailure(sources[activeSourceIndex])) activeSourceIndex++;
  const logoUrl = sources[activeSourceIndex];

  // Build a responsive srcSet from the available logoAssets resolutions so
  // browsers can pick the optimal logo for high-DPI screens. Falls back to
  // undefined when only the legacy/external favicon path is available.
  const srcSet = useMemo(() => {
    if (
      activeSourceIndex !== 0 ||
      responsiveSourceFailed ||
      !logoAssetsUsable(station.logoAssets) ||
      !station.logoAssets
    ) {
      return undefined;
    }
    const parts: string[] = [];
    const folder = station.logoAssets.folder;
    for (const size of [48, 96, 256] as const) {
      const value = station.logoAssets[`webp${size}`];
      if (value) {
        const url = resolveLogoUrl(folder, value);
        if (url && !hasRecentStationLogoFailure(url)) parts.push(`${url} ${size}w`);
      }
    }
    return parts.length > 1 ? parts.join(', ') : undefined;
  }, [station.logoAssets, activeSourceIndex, responsiveSourceFailed]);

  const stationName = station.name || 'Radio Station';

  const handleError = (event: SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget;
    rememberStationLogoFailure(image.currentSrc || image.src);
    if (srcSet && image.currentSrc && image.currentSrc !== image.src) {
      // Safari/high-DPI browsers may have failed a srcSet candidate rather
      // than src. Retry the preferred src without srcSet before advancing.
      setResponsiveSourceFailed(true);
      return;
    }
    setResponsiveSourceFailed(true);
    // Move to next source in the list
    setSourceIndex(Math.min(activeSourceIndex + 1, sources.length - 1));
  };

  // If className contains positioning (absolute/inset), use w-full h-full to fill container
  const useFillMode = className?.includes('absolute') || className?.includes('inset');
  
  // Check if we're at the fallback image (last resort)
  const isShowingFallback = logoUrl === FALLBACK_IMAGE;

  // If showing fallback, render the custom NoImage component
  if (isShowingFallback) {
    return (
      <NoImageFallback 
        label={alt?.trim() || stationName}
        className={cn(
          useFillMode ? 'w-full h-full' : sizeConfig.className,
          className
        )}
      />
    );
  }

  return (
    <StationLogoImage
      stationName={stationName}
      src={logoUrl}
      srcSet={srcSet}
      sizes={srcSet ? (sizes || getSizes(size)) : undefined}
      alt={alt}
      width={sizeConfig.px}
      height={sizeConfig.px}
      loading={priority ? 'eager' : 'lazy'}
      fetchPriority={priority ? 'high' : undefined}
      decoding="async"
      onError={handleError}
      onLoad={(event) => clearStationLogoFailure(event.currentTarget.currentSrc || event.currentTarget.src)}
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
  return getLogoSources(station, size).find(url => !hasRecentStationLogoFailure(url)) || FALLBACK_IMAGE;
}

export function hasOptimizedLogo(station: Station): boolean {
  const assets = station.logoAssets;
  return !!assets && logoAssetsUsable(assets) && [assets.webp48, assets.webp96, assets.webp256]
    .some(value => !!resolveLogoUrl(assets.folder, value));
}

export default StationLogo;
