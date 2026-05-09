import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import StationCard from '@/components/ui/station-card';
import { useGlobalPlayer } from '@/hooks/useGlobalPlayer';
import { useTranslation } from '@/hooks/useTranslation';
import { Swiper, SwiperSlide } from 'swiper/react';
import { FreeMode } from 'swiper/modules';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import arrowLeftIcon from '@assets/arrow-left.png';
import arrowRightIcon from '@assets/arrow-right.png';
import 'swiper/css';
import 'swiper/css/free-mode';

interface RadiosPageProps {
  selectedCountry?: string;
  onCountryChange?: (country: string) => void;
}

export default function RadiosPage({ selectedCountry = 'all', onCountryChange }: RadiosPageProps) {
  const [location, setLocation] = useLocation();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const sliderRef = useRef<any>(null);
  
  // Parse URL parameters like GitHub example (?state=Wien&page=1)
  const urlParams = new URLSearchParams(window.location.search);
  const [page, setPage] = useState<number>(parseInt(urlParams.get('page') || '1'));
  const [sort, setSort] = useState<string>(urlParams.get('sort') || 'votes');
  const [selectedCity, setSelectedCity] = useState<string | null>(urlParams.get('state'));
  const { playStation, currentStation, isPlaying, stopStation } = useGlobalPlayer();
  const { t } = useTranslation();

  // Helper function to get sort title
  const getSortTitle = (sortValue: string) => {
    const sortOptions: { [key: string]: string } = {
      'votes': t('trending', 'Trending'),
      'newest': t('newest_first', 'Newest first'),
      'az': t('sort_az', 'A-Z'),
      'za': t('sort_za', 'Z-A')
    };
    return sortOptions[sortValue] || t('trending', 'Trending');
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Handler functions for station play/stop
  const handlePlay = async (station: any, playlistName: string) => {
    await playStation(station);
  };

  const handleStop = () => {
    stopStation();
  };

  // Fetch broadcast cities for the slider - ULTRA-FAST: Uses precomputed 7-day cache
  const { data: cities = [], isLoading: citiesLoading } = useQuery({
    queryKey: ['/api/cities/precomputed', selectedCountry],
    queryFn: async () => {
      if (selectedCountry === 'all') {
        // Fetch global popular cities for global view
        const response = await fetch('/api/cities/global');
        if (!response.ok) throw new Error('Failed to fetch global cities');
        const result = await response.json();
        return result.data?.cities || [];
      }
      
      // Use precomputed cities endpoint - instant response from 7-day cache
      const response = await fetch(`/api/cities/precomputed?country=${encodeURIComponent(selectedCountry)}`);
      if (!response.ok) throw new Error('Failed to fetch cities');
      const result = await response.json();
      return result.data?.cities || [];
    },
    staleTime: 1000 * 60 * 60 * 24, // 24 hours - precomputed cache is 7 days
    gcTime: 1000 * 60 * 60 * 24 * 7, // 7 days garbage collection
  });

  // Fetch stations - ULTRA-FAST: Use precomputed cache for Trending (votes) sort
  // Cache is sorted by hasLogo (logolu önce) + votes (yüksekten düşüğe)
  const { data: stationsData, isLoading: stationsLoading } = useQuery({
    queryKey: ['/api/stations', selectedCountry, page, sort, selectedCity],
    queryFn: async () => {
      // Use precomputed endpoint when: 
      // 1. No city filter (city filter requires live query)
      // 2. Default sort (votes/Trending) - precomputed is sorted by hasLogo+votes
      // 3. Supports both "all" (global) and specific countries
      const usePrecomputed = !selectedCity && sort === 'votes';
      
      if (usePrecomputed) {
        const params = new URLSearchParams();
        // Send 'global' for all countries, otherwise country name
        params.append('countryName', selectedCountry === 'all' ? 'global' : selectedCountry);
        params.append('page', page.toString());
        params.append('limit', '33');
        const url = `/api/stations/precomputed?${params}`;
        const response = await fetch(url);
        if (response.ok) {
          const result = await response.json();
          if (result.success && result.data.length > 0) {
            return {
              stations: result.data,
              pagination: result.pagination
            };
          }
        }
        // Fall through to regular endpoint if precomputed fails or returns empty
      }
      
      // Fallback: Regular endpoint for city filters or special sorts (A-Z, Z-A)
      const params = new URLSearchParams();
      if (selectedCountry !== 'all') {
        params.append('country', selectedCountry);
      }
      if (selectedCity) {
        params.append('state', selectedCity);
      }
      params.append('page', page.toString());
      params.append('limit', '33');
      params.append('sort', sort);
      const url = `/api/stations?${params}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch stations');
      const data = await response.json();
      return data;
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
    gcTime: 1000 * 60 * 30, // 30 minutes
  });

  // Update URL when parameters change (like GitHub example)
  // IMPORTANT: Preserve language prefix in URL (e.g. /bg/radio instead of /radios)
  useEffect(() => {
    const params = new URLSearchParams();
    if (selectedCity) params.set('state', selectedCity);
    if (page > 1) params.set('page', page.toString());
    if (sort !== 'votes') params.set('sort', sort);
    
    // Preserve current pathname (which includes language prefix and translated path)
    const currentPath = window.location.pathname;
    const newUrl = `${currentPath}${params.toString() ? '?' + params.toString() : ''}`;
    window.history.replaceState({}, '', newUrl);
  }, [selectedCity, page, sort]);
  
  // Reset page when state changes (exactly like GitHub example)
  useEffect(() => {
    setPage(1);
  }, [selectedCity]);



  const itemsPerPage = 33; // Match GitHub example exactly
  const totalPages = stationsData?.pagination ? Math.ceil(stationsData.pagination.total / itemsPerPage) : 0;
  

  const currentPageNumber = page;

  const goToPage = (pageNum: number) => {
    if (pageNum !== page && pageNum >= 1 && pageNum <= totalPages) {
      setPage(pageNum);
      // URL will be updated via useEffect
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const renderPaginationButton = (pageNum: number, isActive: boolean = false) => (
    <button
      key={pageNum}
      onClick={() => goToPage(pageNum)}
      className={`h-9 min-w-12 px-3 rounded text-sm font-medium transition-colors ${
        isActive 
          ? 'bg-[#FF4199] text-white' 
          : 'bg-[#292929] text-white hover:bg-[#3a3a3a]'
      }`}
    >
      {pageNum}
    </button>
  );

  const renderPagination = () => {
    if (totalPages <= 1) return null;

    const buttons = [];
    const maxVisible = 7;
    
    if (totalPages <= maxVisible) {
      // Show all pages
      for (let i = 1; i <= totalPages; i++) {
        buttons.push(renderPaginationButton(i, i === currentPageNumber));
      }
    } else {
      // Complex pagination with ellipsis
      buttons.push(renderPaginationButton(1, 1 === currentPageNumber));
      
      if (currentPageNumber > 4) {
        buttons.push(
          <span key="ellipsis1" className="h-9 min-w-12 flex items-center justify-center text-[#838383]">
            ...
          </span>
        );
      }
      
      const start = Math.max(2, currentPageNumber - 1);
      const end = Math.min(totalPages - 1, currentPageNumber + 1);
      
      for (let i = start; i <= end; i++) {
        buttons.push(renderPaginationButton(i, i === currentPageNumber));
      }
      
      if (currentPageNumber < totalPages - 3) {
        buttons.push(
          <span key="ellipsis2" className="h-9 min-w-12 flex items-center justify-center text-[#838383]">
            ...
          </span>
        );
      }
      
      if (totalPages > 1) {
        buttons.push(renderPaginationButton(totalPages, totalPages === currentPageNumber));
      }
    }

    return (
      <div className="py-8 flex items-center justify-center">
        <div className="flex items-center gap-2">
          {buttons}
        </div>
      </div>
    );
  };

  return (
    <div>
      {/* Container 1 - Figma: height:118, #151515 - FULL WIDTH background */}
      <div className="w-full h-[118px] bg-[#151515]">
        <div className="mx-auto max-w-[1512px] h-full px-4">
          <div className="mx-auto max-w-[1206px] h-full flex items-center justify-between">
          <div className="flex-1">
            {/* Ubuntu Bold 36px, line-height 100% */}
            <h1 className="text-white text-[36px] font-bold leading-[1.0]" style={{ fontFamily: "'Ubuntu', system-ui, sans-serif", fontWeight: 700 }}>
              {t('all_radios')}
            </h1>
            {/* Ubuntu Medium 14px, line-height 100% */}
            <p className="text-[14px] text-[#838383] mt-[11px] leading-[1]" style={{ fontFamily: "'Ubuntu', system-ui, sans-serif", fontWeight: 500 }}>
              {selectedCountry !== 'all' ? selectedCountry : 'Global'}
              {selectedCity && <span>, {selectedCity}</span>} {' '}
              <span className="text-white font-bold" style={{ fontWeight: 700 }}>{stationsData?.pagination?.total || 0}</span>
            </p>
          </div>
          
          {/* Sorting Modes */}
          <div className="relative w-32 z-10" ref={dropdownRef}>
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="flex w-full items-center justify-end gap-2 font-bold text-white"
            >
              <span>{getSortTitle(sort)}</span>
              <svg width="1em" height="1em" viewBox="0 0 512 512">
                <path
                  d="M98.9 184.7l1.8 2.1 136 156.5c4.6 5.3 11.5 8.6 19.2 8.6 7.7 0 14.6-3.4 19.2-8.6L411 187.1l2.3-2.6c1.7-2.5 2.7-5.5 2.7-8.7 0-8.7-7.4-15.8-16.6-15.8H112.6c-9.2 0-16.6 7.1-16.6 15.8 0 3.3 1.1 6.4 2.9 8.9z"
                  fill="currentColor"
                />
              </svg>
            </button>
            {dropdownOpen && (
              <div className="absolute right-0 top-8 w-[138px] space-y-4 rounded-lg bg-black p-[18px] shadow-lg border border-gray-800">
                {[
                  { value: 'votes', title: t('trending', 'Trending') },
                  { value: 'newest', title: t('newest_first', 'Newest first') },
                  { value: 'az', title: t('sort_az', 'A-Z') },
                  { value: 'za', title: t('sort_za', 'Z-A') }
                ].map((mode) => (
                  <div
                    key={mode.value}
                    onClick={() => {
                      setSort(mode.value);
                      setDropdownOpen(false);
                    }}
                    className={`cursor-pointer font-bold ${
                      sort === mode.value ? 'text-white' : 'text-neutral-500'
                    } hover:text-white transition-colors`}
                  >
                    {mode.title}
                  </div>
                ))}
              </div>
            )}
          </div>
          </div>
        </div>
      </div>

      {/* Sendestadte - Desktop: height:58 inline, Mobile: 65px 2-row layout */}
      {/* Desktop version */}
      <div className="hidden md:block w-full h-[58px] bg-[#1C1C1C]">
        <div className="mx-auto max-w-[1512px] h-full px-4">
          <div className="mx-auto max-w-[1206px] h-full flex items-center gap-4">
            <p className="text-[#838383] text-[14px] leading-[1] whitespace-nowrap" style={{ fontFamily: "'Ubuntu', sans-serif", fontWeight: 500 }}>{t('broadcast_cities')}</p>
            
            {/* Loading skeleton for cities */}
            {citiesLoading && (
              <div className="flex-1 flex items-center gap-2 overflow-hidden">
                {Array.from({ length: 8 }).map((_, index) => (
                  <div key={index} className="animate-pulse flex-shrink-0">
                    <div className="h-[38px] w-[100px] bg-[#2F2F2F] rounded-lg"></div>
                  </div>
                ))}
              </div>
            )}
            
            {/* Cities content */}
            {!citiesLoading && cities.length > 0 && (
              <div className="flex-1 overflow-hidden">
                <Swiper
                  ref={sliderRef}
                  modules={[FreeMode]}
                  freeMode={true}
                  spaceBetween={10}
                  breakpoints={{
                    320: { slidesPerView: 2 },
                    480: { slidesPerView: 3 },
                    640: { slidesPerView: 4 },
                    768: { slidesPerView: 5 },
                    1024: { slidesPerView: 6 },
                  }}
                  className="w-full"
                >
                  <SwiperSlide className="!w-auto !flex-shrink-0">
                    <button
                      onClick={() => setSelectedCity(null)}
                      className={`h-[36px] px-[10px] flex items-center gap-[6px] cursor-pointer select-none rounded-[10px] whitespace-nowrap ${
                        !selectedCity ? 'bg-[#FF4199]' : 'bg-[#1C1C1C] border border-[#2F2F2F] hover:bg-[#2a2a2a]'
                      }`}
                      style={{ fontFamily: "'Ubuntu', sans-serif", fontWeight: 500, fontSize: '14px', lineHeight: '100%' }}
                    >
                      <span className="text-white">{t('all')}</span>
                    </button>
                  </SwiperSlide>
                  {cities.map((city: any) => (
                    <SwiperSlide key={city.name} className="!w-auto !flex-shrink-0">
                      <button
                        onClick={() => setSelectedCity(city.name)}
                        className={`h-[36px] px-[10px] flex items-center gap-[6px] cursor-pointer select-none rounded-[10px] whitespace-nowrap ${
                          selectedCity === city.name ? 'bg-[#FF4199]' : 'bg-[#1C1C1C] border border-[#2F2F2F] hover:bg-[#2a2a2a]'
                        }`}
                        style={{ fontFamily: "'Ubuntu', sans-serif", fontWeight: 500, fontSize: '14px', lineHeight: '100%' }}
                      >
                        <span className="text-white">{city.name}</span>
                        {city.stationCount > 1 && (
                          <span className="text-[14px] text-[#838383]">{city.stationCount}</span>
                        )}
                        {city.country && selectedCountry === 'all' && (
                          <span className="text-[14px] text-[#838383]">({city.country})</span>
                        )}
                      </button>
                    </SwiperSlide>
                  ))}
                </Swiper>
              </div>
            )}
            
            {/* Empty state - no cities */}
            {!citiesLoading && cities.length === 0 && (
              <div className="flex-1 text-[#777777] text-sm">
                {t('no_cities_available', 'No cities available')}
              </div>
            )}
            
            {/* Navigation arrows */}
            {!citiesLoading && cities.length > 0 && (
              <div className="md:flex gap-4 hidden">
                <button onClick={() => sliderRef.current?.swiper?.slidePrev()}>
                  <ChevronLeft className="text-white size-6" />
                </button>
                <button onClick={() => sliderRef.current?.swiper?.slideNext()}>
                  <ChevronRight className="text-white size-6" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mobile version - 2 row layout: title on top, cities below */}
      <div className="md:hidden w-full px-5 py-3 bg-[#0E0E0E]">
        <div 
          className="w-full rounded-[10px] p-3"
          style={{ backgroundColor: '#1C1C1C' }}
        >
          {/* Row 1: Title */}
          <p 
            className="text-[#838383] text-[14px] leading-[100%] mb-3"
            style={{ fontFamily: "'Ubuntu', sans-serif", fontWeight: 500 }}
          >
            {t('broadcast_cities')}
          </p>
          
          {/* Row 2: Cities slider */}
          {citiesLoading && (
            <div className="flex items-center gap-2 overflow-x-auto">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="animate-pulse flex-shrink-0">
                  <div className="h-[32px] w-[70px] bg-[#2F2F2F] rounded-lg"></div>
                </div>
              ))}
            </div>
          )}
          
          {!citiesLoading && cities.length > 0 && (
            <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide">
              <button
                onClick={() => setSelectedCity(null)}
                className={`h-[32px] px-3 flex items-center gap-1 flex-shrink-0 rounded-[8px] whitespace-nowrap ${
                  !selectedCity ? 'bg-[#FF4199]' : 'bg-[#2F2F2F]'
                }`}
                style={{ fontFamily: "'Ubuntu', sans-serif", fontWeight: 500, fontSize: '14px' }}
              >
                <span className="text-white">{t('all')}</span>
              </button>
              {cities.slice(0, 10).map((city: any) => (
                <button
                  key={city.name}
                  onClick={() => setSelectedCity(city.name)}
                  className={`h-[32px] px-3 flex items-center gap-1 flex-shrink-0 rounded-[8px] whitespace-nowrap ${
                    selectedCity === city.name ? 'bg-[#FF4199]' : 'bg-[#2F2F2F]'
                  }`}
                  style={{ fontFamily: "'Ubuntu', sans-serif", fontWeight: 500, fontSize: '14px' }}
                >
                  <span className="text-white">{city.name}</span>
                </button>
              ))}
            </div>
          )}
          
          {!citiesLoading && cities.length === 0 && (
            <p className="text-[#777777] text-sm">{t('no_cities_available', 'No cities available')}</p>
          )}
        </div>
      </div>

      {/* Main Content - Match header max-width and alignment */}
      {/* Mobile: 20px padding (Figma spec), Desktop: 16px */}
      <div className="mx-auto max-w-[1512px] px-5 md:px-4 pt-6 pb-10 text-white">
        {/* Inner Content Wrapper - Figma spec: 1206px width centered (153px margins on 1512px container) */}
        <div className="mx-auto max-w-[1206px]">
          {/* Loading skeleton for 33 items per page */}
          {stationsLoading && page === 1 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4 md:gap-5">
              {Array.from({ length: 33 }).map((_, index) => (
                <div key={index} className="animate-pulse">
                  <div className="bg-[#2F2F2F] rounded-lg p-4 h-32">
                    <div className="flex space-x-3">
                      <div className="bg-gray-700 rounded w-20 h-20"></div>
                      <div className="flex-1">
                        <div className="bg-gray-700 rounded h-4 mb-2"></div>
                        <div className="bg-gray-700 rounded h-3 w-3/4 mb-2"></div>
                        <div className="bg-gray-700 rounded h-3 w-1/2"></div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Stations Grid - Match GitHub layout exactly */}
          {!stationsLoading && stationsData && (
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4 md:gap-5">
              {stationsData.stations.map((station: any) => (
                <StationCard
                  key={station._id}
                  station={station}
                  onPlay={handlePlay}
                  onStop={handleStop}
                  playlistName="allStations"
                  showVotes={true}
                />
              ))}
            </div>
          )}

          {/* Pagination - Responsive: Desktop full, Mobile compact */}
          <div className="py-8 grid items-center justify-center">
          {!stationsLoading && stationsData && totalPages > 1 && (
            <div className="flex items-center gap-1 md:gap-2">
              {/* Previous button - Desktop: 51x38, Mobile: 40x32 */}
              <button
                onClick={() => goToPage(currentPageNumber - 1)}
                disabled={currentPageNumber <= 1}
                className={`flex items-center justify-center transition-colors ${
                  currentPageNumber <= 1 ? 'opacity-40 cursor-not-allowed' : 'hover:opacity-80'
                }`}
                style={{ borderRadius: '8px', backgroundColor: '#2F2F2F' }}
              >
                <div className="w-10 h-8 md:w-[51px] md:h-[38px] flex items-center justify-center">
                  <img 
                    src={arrowLeftIcon} 
                    alt="Previous" 
                    className="w-5 h-5 md:w-[26px] md:h-[26px]"
                  />
                </div>
              </button>
              
              {/* Page numbers - Responsive: Desktop 51x38, Mobile 36x32 */}
              {(() => {
                const buttons = [];
                const isMobile = window.innerWidth < 768;
                const maxVisible = isMobile ? 3 : 5; // Mobile: 1-2-3, Desktop: 1-2-3-4-5
                
                // Responsive button classes
                const buttonClass = "w-9 h-8 md:w-[51px] md:h-[38px] flex items-center justify-center text-[13px] md:text-[16px] font-bold text-white hover:opacity-80";
                
                const getButtonStyle = (isActive: boolean) => ({
                  borderRadius: '8px',
                  backgroundColor: isActive ? '#FF4199' : '#2F2F2F',
                  fontFamily: "'Ubuntu', sans-serif",
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'opacity 0.2s'
                });
                
                if (totalPages <= maxVisible + 2) {
                  // Show all pages if few enough
                  for (let i = 1; i <= totalPages; i++) {
                    buttons.push(
                      <button
                        key={i}
                        onClick={() => goToPage(i)}
                        className={buttonClass}
                        style={getButtonStyle(i === currentPageNumber)}
                      >
                        {i}
                      </button>
                    );
                  }
                } else {
                  // Desktop: 1-2-3-4-5 ... last, Mobile: 1-2-3 ... last
                  if (isMobile) {
                    // Mobile compact: 1-2-3 ... last (standard mobile pagination)
                    if (currentPageNumber <= 3) {
                      // Near start: show 1-2-3 ... last
                      for (let i = 1; i <= 3; i++) {
                        buttons.push(
                          <button key={i} onClick={() => goToPage(i)} className={buttonClass} style={getButtonStyle(i === currentPageNumber)}>
                            {i}
                          </button>
                        );
                      }
                      buttons.push(<span key="el" className={buttonClass} style={getButtonStyle(false)}>...</span>);
                      buttons.push(
                        <button key={totalPages} onClick={() => goToPage(totalPages)} className={buttonClass} style={getButtonStyle(totalPages === currentPageNumber)}>
                          {totalPages}
                        </button>
                      );
                    } else if (currentPageNumber >= totalPages - 2) {
                      // Near end: 1 ... last3
                      buttons.push(
                        <button key={1} onClick={() => goToPage(1)} className={buttonClass} style={getButtonStyle(1 === currentPageNumber)}>
                          1
                        </button>
                      );
                      buttons.push(<span key="el" className={buttonClass} style={getButtonStyle(false)}>...</span>);
                      for (let i = totalPages - 2; i <= totalPages; i++) {
                        buttons.push(
                          <button key={i} onClick={() => goToPage(i)} className={buttonClass} style={getButtonStyle(i === currentPageNumber)}>
                            {i}
                          </button>
                        );
                      }
                    } else {
                      // Middle: 1 ... current ... last
                      buttons.push(
                        <button key={1} onClick={() => goToPage(1)} className={buttonClass} style={getButtonStyle(false)}>
                          1
                        </button>
                      );
                      buttons.push(<span key="el1" className={buttonClass} style={getButtonStyle(false)}>...</span>);
                      buttons.push(
                        <button key={currentPageNumber} onClick={() => goToPage(currentPageNumber)} className={buttonClass} style={getButtonStyle(true)}>
                          {currentPageNumber}
                        </button>
                      );
                      buttons.push(<span key="el2" className={buttonClass} style={getButtonStyle(false)}>...</span>);
                      buttons.push(
                        <button key={totalPages} onClick={() => goToPage(totalPages)} className={buttonClass} style={getButtonStyle(false)}>
                          {totalPages}
                        </button>
                      );
                    }
                  } else {
                    // Desktop: full pagination
                    if (currentPageNumber <= 4) {
                      for (let i = 1; i <= 5; i++) {
                        buttons.push(
                          <button key={i} onClick={() => goToPage(i)} className={buttonClass} style={getButtonStyle(i === currentPageNumber)}>
                            {i}
                          </button>
                        );
                      }
                      buttons.push(<span key="ellipsis" className={buttonClass} style={getButtonStyle(false)}>...</span>);
                      buttons.push(
                        <button key={totalPages} onClick={() => goToPage(totalPages)} className={buttonClass} style={getButtonStyle(totalPages === currentPageNumber)}>
                          {totalPages}
                        </button>
                      );
                    } else if (currentPageNumber >= totalPages - 3) {
                      buttons.push(
                        <button key={1} onClick={() => goToPage(1)} className={buttonClass} style={getButtonStyle(1 === currentPageNumber)}>
                          1
                        </button>
                      );
                      buttons.push(<span key="ellipsis" className={buttonClass} style={getButtonStyle(false)}>...</span>);
                      for (let i = totalPages - 4; i <= totalPages; i++) {
                        buttons.push(
                          <button key={i} onClick={() => goToPage(i)} className={buttonClass} style={getButtonStyle(i === currentPageNumber)}>
                            {i}
                          </button>
                        );
                      }
                    } else {
                      buttons.push(
                        <button key={1} onClick={() => goToPage(1)} className={buttonClass} style={getButtonStyle(1 === currentPageNumber)}>
                          1
                        </button>
                      );
                      buttons.push(<span key="ellipsis1" className={buttonClass} style={getButtonStyle(false)}>...</span>);
                      for (let i = currentPageNumber - 1; i <= currentPageNumber + 1; i++) {
                        buttons.push(
                          <button key={i} onClick={() => goToPage(i)} className={buttonClass} style={getButtonStyle(i === currentPageNumber)}>
                            {i}
                          </button>
                        );
                      }
                      buttons.push(<span key="ellipsis2" className={buttonClass} style={getButtonStyle(false)}>...</span>);
                      buttons.push(
                        <button key={totalPages} onClick={() => goToPage(totalPages)} className={buttonClass} style={getButtonStyle(totalPages === currentPageNumber)}>
                          {totalPages}
                        </button>
                      );
                    }
                  }
                }
                
                return buttons;
              })()}
              
              {/* Next button - Desktop: 51x38, Mobile: 40x32 */}
              <button
                onClick={() => goToPage(currentPageNumber + 1)}
                disabled={currentPageNumber >= totalPages}
                className={`flex items-center justify-center transition-colors ${
                  currentPageNumber >= totalPages ? 'opacity-40 cursor-not-allowed' : 'hover:opacity-80'
                }`}
                style={{ borderRadius: '8px', backgroundColor: '#2F2F2F' }}
              >
                <div className="w-10 h-8 md:w-[51px] md:h-[38px] flex items-center justify-center">
                  <img 
                    src={arrowRightIcon} 
                    alt="Next" 
                    className="w-5 h-5 md:w-[26px] md:h-[26px]"
                  />
                </div>
              </button>
            </div>
          )}
        </div>
        </div>
      </div>
    </div>
  );
}