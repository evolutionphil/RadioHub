import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import FavoriteButton from "@/components/ui/favorite-button";
import OptimizedImage from "@/components/ui/optimized-image";
import VirtualizedStationList from "@/components/ui/virtualized-station-list";
import { useGlobalPlayer } from "@/hooks/useGlobalPlayer";
import { Heart, Play, Square, Loader2, ThumbsUp } from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";
import { useSeoRouting } from "@/hooks/useSeoRouting";

export default function Favorites() {
  const [sortQuery, setSortQuery] = useState('newest');
  const [showSortDropdown, setShowSortDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { currentStation, playStation, stopStation, isLoading: playerLoading } = useGlobalPlayer();
  const { t } = useTranslation();
  const { getLocalizedUrl } = useSeoRouting();

  const getSortingModeTitle = (value: string) => {
    switch(value) {
      case 'newest': return t('sort_newest_first');
      case 'oldest': return t('sort_oldest_first');
      case 'name': return t('sort_a_to_z');
      case 'country': return t('sort_z_to_a');
      default: return t('sort_newest_first');
    }
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowSortDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Fetch favorite stations using React Query (queryClient will handle URL construction)
  const { data: favoritesResponse, isLoading, error } = useQuery({
    queryKey: ['/api/user/favorites', { sort: sortQuery }],
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 10 * 60 * 1000, // 10 minutes cache
  });

  // Check for authentication errors
  const isAuthError = error && (error as any).message?.includes('401');

  // API returns stations directly as an array, not wrapped in {stations: []}
  const favoriteStations = Array.isArray(favoritesResponse) ? favoritesResponse : [];

  const handlePlayStation = (station: any) => {
    if (currentStation?._id === station._id) {
      stopStation();
    } else {
      playStation(station);
    }
  };

  const isCurrentlyPlaying = (stationId: string) => {
    return currentStation?._id === stationId && !playerLoading;
  };

  const isStationLoading = (stationId: string) => {
    return currentStation?._id === stationId && playerLoading;
  };

  return (
    <div>
      {/* Header with count and sorting - Figma: 54px gap to cards */}
      <div className="flex items-center justify-between pb-[30px]">
        <h5 className="text-[22px] font-bold">
          {t('your_favorites')}
          <span className="ml-2 rounded bg-[#202020] px-4 py-2 text-neutral-500">
            {favoriteStations.length}
          </span>
        </h5>
        
        {/* Sorting dropdown - responsive, no text wrap */}
        <div className="relative z-10 shrink-0" ref={dropdownRef}>
          {/* Desktop: Text + Arrow */}
          <button 
            className="hidden md:flex items-center justify-end gap-2 font-bold text-white whitespace-nowrap"
            onClick={() => setShowSortDropdown(!showSortDropdown)}
          >
            <span>{getSortingModeTitle(sortQuery)}</span>
            <svg width="1em" height="1em" viewBox="0 0 512 512" className="shrink-0">
              <path
                d="M98.9 184.7l1.8 2.1 136 156.5c4.6 5.3 11.5 8.6 19.2 8.6 7.7 0 14.6-3.4 19.2-8.6L411 187.1l2.3-2.6c1.7-2.5 2.7-5.5 2.7-8.7 0-8.7-7.4-15.8-16.6-15.8H112.6c-9.2 0-16.6 7.1-16.6 15.8 0 3.3 1.1 6.4 2.9 8.9z"
                fill="currentColor"
              />
            </svg>
          </button>
          {/* Mobile/Tablet: Filter Icon */}
          <button 
            className="flex md:hidden items-center justify-center w-6 h-6"
            onClick={() => setShowSortDropdown(!showSortDropdown)}
            aria-label="Sort options"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="2" y="5" width="20" height="2.5" rx="1.25" fill="white"/>
              <rect x="5" y="11" width="14" height="2.5" rx="1.25" fill="white"/>
              <rect x="8" y="17" width="8" height="2.5" rx="1.25" fill="white"/>
            </svg>
          </button>
          {showSortDropdown && (
            <div className="absolute right-0 top-8 min-w-max space-y-2 rounded-md bg-black p-4">
              <div 
                className={`cursor-pointer font-bold whitespace-nowrap ${sortQuery === 'newest' ? 'text-white' : 'text-neutral-500'}`}
                onClick={() => { setSortQuery('newest'); setShowSortDropdown(false); }}
              >
                {t('sort_newest_first', 'Newest first')}
              </div>
              <div 
                className={`cursor-pointer font-bold whitespace-nowrap ${sortQuery === 'oldest' ? 'text-white' : 'text-neutral-500'}`}
                onClick={() => { setSortQuery('oldest'); setShowSortDropdown(false); }}
              >
                {t('sort_oldest_first', 'Oldest first')}
              </div>
              <div 
                className={`cursor-pointer font-bold whitespace-nowrap ${sortQuery === 'name' ? 'text-white' : 'text-neutral-500'}`}
                onClick={() => { setSortQuery('name'); setShowSortDropdown(false); }}
              >
                {t('sort_a_to_z', 'A to Z')}
              </div>
              <div 
                className={`cursor-pointer font-bold whitespace-nowrap ${sortQuery === 'country' ? 'text-white' : 'text-neutral-500'}`}
                onClick={() => { setSortQuery('country'); setShowSortDropdown(false); }}
              >
                {t('sort_z_to_a', 'Z to A')}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Authentication Error State */}
      {isAuthError && (
        <div className="flex h-64 items-center justify-center rounded-md bg-[#2F2F2F]">
          <div className="text-center">
            <svg className="m-auto mb-3 w-12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 1L3 5V11C3 16.55 6.84 21.74 12 23C17.16 21.74 21 16.55 21 11V5L12 1Z" stroke="#A9A9A9" strokeWidth="2" fill="none"/>
              <path d="M9 12L11 14L15 10" stroke="#A9A9A9" strokeWidth="2" fill="none"/>
            </svg>
            <p className="font-medium text-[#FF4199] mb-2">Authentication Required</p>
            <p className="font-medium">
              <Link href="/login" className="text-[#FF4199] hover:underline">
                Please log in
              </Link>{' '}
              to view your favorite stations!
            </p>
          </div>
        </div>
      )}

      {/* Empty state - EXACT from original */}
      {favoriteStations.length === 0 && !isLoading && !isAuthError && (
        <div className="flex h-64 items-center justify-center rounded-md bg-[#2F2F2F]">
          <div className="text-center">
            <svg className="m-auto mb-3 w-12" viewBox="0 0 69 62" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M49.9103 0C43.696 0 38.134 3.02133 34.6663 7.65632C31.1986 3.02133 25.6366 0 19.4223 0C8.882 0 0.333008 8.58332 0.333008 19.1923C0.333008 23.278 0.98534 27.0546 2.11834 30.5566C7.543 47.7233 24.2633 57.9889 32.5376 60.8043C33.705 61.2163 35.6276 61.2163 36.795 60.8043C45.0693 57.9889 61.7896 47.7233 67.2143 30.5566C68.3473 27.0546 68.9996 23.278 68.9996 19.1923C68.9996 8.58332 60.4506 0 49.9103 0Z"
                fill="#A9A9A9"
              />
            </svg>
            <p className="font-medium">You haven't added stations yet</p>
            <p className="font-medium">
              <Link href="/profile/discover" className="text-[#FF4199]">
                Click here
              </Link>{' '}
              to discover and add to your list!
            </p>
          </div>
        </div>
      )}

      {/* Stations Grid - Figma: 3 columns, 388px cards, 20px gap, 130px height */}
      {!isAuthError && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 w-full">
          {isLoading ? (
            // Loading skeleton - Figma: 130px height
            Array(6).fill(0).map((_, i) => (
              <div key={i} className="animate-pulse bg-[#2F2F2F] rounded-[10px] h-[130px]"></div>
            ))
          ) : (
          favoriteStations.map((station: any) => (
            <div
              key={station._id}
              className="flex cursor-pointer items-center rounded-[10px] bg-[#2F2F2F] p-5 h-[130px] overflow-hidden hover:bg-[#3F3F3F] transition-colors"
            >
              {/* Station Image - clickable for navigation */}
              <Link href={getLocalizedUrl(`/station/${station.slug || station._id}`)} className="flex-shrink-0">
                <div className="h-[90px] w-[90px]">
                  <OptimizedImage
                    key={`img-${station._id}`}
                    src={station.favicon || "/no-image.webp"}
                    alt={`Listen ${station.name} at megaradio`}
                    width={90}
                    height={90}
                    className="h-[90px] w-[90px] rounded-[9px] object-cover"
                    fallbackSrc="/no-image.webp"
                    loading="lazy"
                  />
                </div>
              </Link>

              {/* Station Info - Figma: name 20px medium, country 15px light */}
              <Link href={getLocalizedUrl(`/station/${station.slug || station._id}`)} className="flex-1 min-w-0 ml-4 overflow-hidden">
                <div className="cursor-pointer">
                  <h4 className="text-[16px] md:text-[20px] font-medium text-white truncate hover:text-[#FF4199] transition-colors">
                    {station.name}
                  </h4>
                  <p className="text-[13px] md:text-[15px] font-light text-white truncate mt-1">
                    {station.country}
                  </p>
                  {/* Vote count with thumbs up icon */}
                  {station.votes !== undefined && station.votes > 0 && (
                    <div className="flex items-center gap-1 text-gray-400 mt-1.5" title={`${station.votes.toLocaleString()} votes`}>
                      <ThumbsUp className="w-3.5 h-3.5" />
                      <span className="text-xs">{station.votes >= 1000 ? `${(station.votes / 1000).toFixed(1)}K` : station.votes}</span>
                    </div>
                  )}
                </div>
              </Link>

              {/* Controls - Figma: play btn 40x40px, #656565 bg, 20px radius */}
              <div className="ml-4 flex-shrink-0">
                {/* Play/Stop Button - Figma style */}
                {isStationLoading(station._id) ? (
                  <div className="flex h-10 w-10 items-center justify-center rounded-[20px] bg-[#656565]">
                    <svg className="h-6 w-6 animate-spin text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                  </div>
                ) : isCurrentlyPlaying(station._id) ? (
                  <button 
                    onClick={() => handlePlayStation(station)}
                    className="flex h-10 w-10 items-center justify-center rounded-[20px] bg-[#656565] hover:bg-[#757575] transition-colors"
                  >
                    <span className="sr-only">Stop Radio</span>
                    <svg className="h-6 w-6 text-white" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M6 6h12v12H6z"/>
                    </svg>
                  </button>
                ) : (
                  <button 
                    onClick={() => handlePlayStation(station)}
                    className="flex h-10 w-10 items-center justify-center rounded-[20px] bg-[#656565] hover:bg-[#757575] transition-colors"
                  >
                    <span className="sr-only">Play Radio</span>
                    <svg className="h-6 w-6 text-white" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z"/>
                    </svg>
                  </button>
                )}
              </div>
            </div>
          ))
          )}
        </div>
      )}
    </div>
  );
}