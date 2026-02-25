import { useState, useRef, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { createPortal } from "react-dom";
import { useSeoRouting } from "@/hooks/useSeoRouting";
import { useTranslation } from "@/hooks/useTranslation";
import { useDebounce } from "@/hooks/useDebounce";
import { getLocalizedPath, getStationUrl } from "@/utils/slugs";
import { getImageUrl } from "@/lib/utils";

export default function PublicHeader() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isCountryDropdownOpen, setIsCountryDropdownOpen] = useState(false);
  const [selectedCountry, setSelectedCountry] = useState("all");
  const [countrySearchQuery, setCountrySearchQuery] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [location] = useLocation();
  const countryButtonRef = useRef<HTMLButtonElement>(null);
  const { navigateTranslated, getLocalizedUrl, englishPath, cleanPath, currentLanguage, reverseTranslateUrl: reverseTranslate } = useSeoRouting();
  const { t } = useTranslation();

  // Handle click outside to close country dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      
      // Don't close if clicking on the country button itself
      if (countryButtonRef.current?.contains(target)) {
        return;
      }
      
      setIsCountryDropdownOpen(false);
      setCountrySearchQuery("");
    };

    if (isCountryDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isCountryDropdownOpen]);

  // CRITICAL: Compare against englishPath to support localized routes
  // e.g., /at/anwendungen is normalized to /applications before comparison
  // Triple fallback: englishPath → reverseTranslate(cleanPath) → cleanPath
  // cleanPath has country code already removed by getLanguageFromPath
  // Ensures defined comparator even when normalization fails or hook initializing
  const isActive = (path: string) => (englishPath ?? reverseTranslate(cleanPath) ?? cleanPath) === path;

  // Fetch countries for dropdown
  const { data: countries = [] } = useQuery<any[]>({
    queryKey: ['/api/countries'],
  });

  // Filter countries based on search query
  const filteredCountries = countries.filter(country => 
    country.name?.toLowerCase().includes(countrySearchQuery.toLowerCase())
  );

  // Debounce search query to reduce API calls
  const debouncedSearchQuery = useDebounce(searchQuery.trim(), 300);

  // Search functionality
  const { data: searchResults, isLoading: searchLoading } = useQuery({
    queryKey: ['/api/stations', 'search', debouncedSearchQuery],
    queryFn: async () => {
      if (!debouncedSearchQuery) return null;
      const params = new URLSearchParams({
        search: debouncedSearchQuery,
        limit: '10'
      });
      const response = await fetch(`/api/stations?${params}`);
      if (!response.ok) throw new Error('Search failed');
      return response.json();
    },
    enabled: !!debouncedSearchQuery,
  });

  const filteredStations = searchResults?.stations || [];

  return (
    <div className="bg-[#0E0E0E] relative z-[10000]">
      {/* Top header bar - EXACT from original */}
      <div className="bg-[#131313] py-2">
        <div className="container mx-auto flex items-center justify-between text-white text-sm">
          <span>{t('header_welcome_message')}</span>
          <div className="hidden md:flex items-center space-x-4">
            <Link href={getLocalizedUrl("/applications")} className="hover:text-[#FF4199] transition-colors">
              {t('header_get_mobile_app')}
            </Link>
            <span className="text-gray-400">|</span>
            <Link href={getLocalizedUrl("/feedback")} className="hover:text-[#FF4199] transition-colors">
              {t('nav_feedback')}
            </Link>
          </div>
        </div>
      </div>

      {/* Main navigation - EXACT from original */}
      <div className="border-b border-[#1D1D1D]">
        <div className="container mx-auto">
          <div className="flex items-center justify-between py-4">
            {/* Logo - EXACT from original */}
            <Link href="/" className="flex items-center">
              <div className="text-white text-2xl font-bold">
                Mega<span className="text-[#FF4199]">Radio</span>
              </div>
            </Link>

            {/* Desktop Navigation */}
            <nav className="hidden md:flex items-center space-x-8">
              <Link 
                href="/" 
                className={`text-white hover:text-[#FF4199] transition-colors ${isActive('/') ? 'text-[#FF4199]' : ''}`}
              >
                {t('nav_home')}
              </Link>
              <Link 
                href="/genres" 
                className={`text-white hover:text-[#FF4199] transition-colors ${isActive('/genres') ? 'text-[#FF4199]' : ''}`}
              >
                {t('nav_genres')}
              </Link>
              <Link 
                href={getLocalizedUrl("/about")} 
                className={`text-white hover:text-[#FF4199] transition-colors ${isActive('/about') ? 'text-[#FF4199]' : ''}`}
              >
                {t('nav_about')}
              </Link>
              <Link 
                href={getLocalizedPath("/contact")} 
                className={`text-white hover:text-[#FF4199] transition-colors ${isActive('/contact') ? 'text-[#FF4199]' : ''}`}
              >
                {t('nav_contact')}
              </Link>
              <Link 
                href={getLocalizedUrl("/applications")} 
                className={`text-white hover:text-[#FF4199] transition-colors ${isActive('/applications') ? 'text-[#FF4199]' : ''}`}
              >
                {t('nav_apps')}
              </Link>
              {/* Country selector - Fixed positioning with portal */}
              <div className="relative nav-item">
                <button 
                  ref={countryButtonRef}
                  onClick={() => setIsCountryDropdownOpen(!isCountryDropdownOpen)}
                  className="flex items-center gap-2"
                >
                  🌍 <span className="hidden lg:inline">{t('country')}</span>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                
                {/* Country dropdown - rendered via portal for proper positioning */}
                {isCountryDropdownOpen && countryButtonRef.current && typeof document !== 'undefined' && createPortal(
                  <div className="fixed w-80 bg-[#0E0E0E]/95 border border-[#2F2F2F] rounded-lg shadow-2xl backdrop-blur z-[999999997]"
                       style={{ 
                         position: 'fixed',
                         top: (countryButtonRef.current.getBoundingClientRect().bottom + 8) + 'px',
                         left: Math.max(20, countryButtonRef.current.getBoundingClientRect().right - 320) + 'px',
                         zIndex: 999999997
                       }}>
                    <div className="overflow-hidden rounded-lg bg-[#0E0E0E]/95 p-4 shadow-lg ring-1 ring-black ring-opacity-5 backdrop-blur transform transition-all duration-200">
                      <div className="relative mb-4">
                        <svg className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 18 18">
                          <path d="M8.625 15.75C12.56 15.75 15.75 12.56 15.75 8.625C15.75 4.68997 12.56 1.5 8.625 1.5C4.68997 1.5 1.5 4.68997 1.5 8.625C1.5 12.56 4.68997 15.75 8.625 15.75Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          <path d="M16.5 16.5L15 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        <input
                          type="text"
                          value={countrySearchQuery}
                          onChange={(e) => setCountrySearchQuery(e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          className="w-full rounded-lg bg-[#2A2A2A] border border-[#444] pl-10 pr-4 py-3 text-white placeholder-gray-400 focus:outline-none focus:border-[#FF4199] transition-colors"
                          placeholder={t('search_countries_placeholder')}
                        />
                      </div>
                      <div className="max-h-80 overflow-y-auto scrollbar-none scroll-smooth">
                        <div 
                          className="relative flex cursor-pointer select-none items-center p-2 hover:bg-gray-900/50 transition-all duration-200 hover:scale-[1.02] rounded-lg"
                          onClick={() => {
                            setSelectedCountry("all"); 
                            setIsCountryDropdownOpen(false);
                            setCountrySearchQuery("");
                          }}
                        >
                          <span className="pr-4">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 fill-[#FF4199]" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM4.332 8.027a6.012 6.012 0 011.912-2.706C6.512 5.73 6.974 6 7.5 6A1.5 1.5 0 019 7.5V8a2 2 0 004 0 2 2 0 011.523-1.943A5.977 5.977 0 0116 10c0 .34-.028.675-.083 1H15a2 2 0 00-2 2v2.197A5.973 5.973 0 0110 16v-2a2 2 0 00-2-2 2 2 0 01-2-2 2 2 0 00-1.668-1.973z" clipRule="evenodd" />
                            </svg>
                          </span>
                          <span className="block truncate text-white">Global</span>
                        </div>
                        {filteredCountries.slice(0, 10).map((country: any, index: number) => (
                          <div 
                            key={country._id || index}
                            className="relative flex cursor-pointer select-none items-center p-2 hover:bg-gray-900/50 transition-all duration-200 hover:scale-[1.02] rounded-lg"
                            onClick={() => {
                              setSelectedCountry(country.name); 
                              setIsCountryDropdownOpen(false);
                              setCountrySearchQuery("");
                            }}
                          >
                            <span className="pr-4">
                              <div className="h-6 w-6 rounded-full bg-[#2F2F2F] flex items-center justify-center text-xs">
                                {country.name?.charAt(0)?.toUpperCase()}
                              </div>
                            </span>
                            <span className="block truncate text-white">{country.name}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>,
                  document.body
                )}
              </div>

              {/* Search button - EXACT from original */}
              <button
                onClick={() => setIsSearchOpen(true)}
                aria-label="Search radios"
                className="rounded-[10px] bg-[#1D1D1D] p-2.5 text-[15px] font-bold"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.35-4.35" />
                </svg>
              </button>

              <Link 
                href="/request-station" 
                className="bg-[#FF4199] text-white px-4 py-2 rounded-lg hover:bg-[#FF097B] transition-colors"
              >
                {t('add_station')}
              </Link>
            </nav>

            {/* Mobile Menu Button */}
            <button
              onClick={() => {
                setIsMobileMenuOpen(!isMobileMenuOpen);
                if (isCountryDropdownOpen) setIsCountryDropdownOpen(false);
              }}
              className="md:hidden text-white p-2"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={isMobileMenuOpen ? "M6 18L18 6M6 6l12 12" : "M4 6h16M4 12h16M4 18h16"} />
              </svg>
            </button>
          </div>

          {/* Mobile Navigation Menu */}
          {isMobileMenuOpen && (
            <div className="md:hidden bg-[#131313] border-t border-[#1D1D1D] relative z-[10001]">
              <div className="px-4 py-2 space-y-2">
                <Link 
                  href="/" 
                  className={`block py-2 text-white hover:text-[#FF4199] transition-colors ${isActive('/') ? 'text-[#FF4199]' : ''}`}
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  {t('nav_home')}
                </Link>
                <Link 
                  href="/genres" 
                  className={`block py-2 text-white hover:text-[#FF4199] transition-colors ${isActive('/genres') ? 'text-[#FF4199]' : ''}`}
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  {t('nav_genres')}
                </Link>
                <Link 
                  href={getLocalizedUrl("/about")} 
                  className={`block py-2 text-white hover:text-[#FF4199] transition-colors ${isActive('/about') ? 'text-[#FF4199]' : ''}`}
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  {t('nav_about')}
                </Link>
                <Link 
                  href={getLocalizedPath("/contact")} 
                  className={`block py-2 text-white hover:text-[#FF4199] transition-colors ${isActive('/contact') ? 'text-[#FF4199]' : ''}`}
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  {t('nav_contact')}
                </Link>
                <Link 
                  href={getLocalizedUrl("/applications")} 
                  className={`block py-2 text-white hover:text-[#FF4199] transition-colors ${isActive('/applications') ? 'text-[#FF4199]' : ''}`}
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  {t('nav_apps')}
                </Link>
                <Link 
                  href={getLocalizedUrl("/feedback")} 
                  className={`block py-2 text-white hover:text-[#FF4199] transition-colors ${isActive('/feedback') ? 'text-[#FF4199]' : ''}`}
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  Feedback
                </Link>
                
                {/* Mobile Country Selector */}
                <div className="border-t border-[#1D1D1D] pt-2 mt-2">
                  <button 
                    onClick={() => setIsCountryDropdownOpen(!isCountryDropdownOpen)}
                    className="flex items-center justify-between w-full py-2 text-white hover:text-[#FF4199] transition-colors"
                  >
                    <span className="flex items-center gap-2">
                      <span>Country</span>
                    </span>
                    <div className="flex items-center gap-2">
                      {selectedCountry === "all" ? (
                        <span className="text-lg">🌍</span>
                      ) : (
                        countries.find(c => c.name === selectedCountry)?.code && (
                          <img
                            src={`https://flagcdn.com/w20/${countries.find(c => c.name === selectedCountry)?.code?.toLowerCase()}.png`}
                            alt={selectedCountry}
                            className="w-5 h-4 object-cover rounded-sm border border-gray-600"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none';
                            }}
                          />
                        )
                      )}
                      <svg className={`w-4 h-4 transition-transform ${isCountryDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </button>
                  
                  {isCountryDropdownOpen && (
                    <div className="mt-2 bg-[#0E0E0E] border border-[#1D1D1D] rounded-lg p-2 relative z-[10002]">
                      <input
                        type="text"
                        value={countrySearchQuery}
                        onChange={(e) => setCountrySearchQuery(e.target.value)}
                        className="w-full rounded border border-[#5C5C5C] bg-transparent px-3 py-2 text-white placeholder-gray-400 focus:border-[#FF4199] focus:outline-none text-sm mb-2"
                        placeholder="Search country"
                      />
                      <div className="max-h-32 overflow-y-auto">
                        <div 
                          className={`p-2 rounded text-sm cursor-pointer hover:bg-gray-800/50 flex items-center gap-2 ${selectedCountry === "all" ? "bg-[#FF4199]/20" : ""}`}
                          onClick={() => {
                            setSelectedCountry("all"); 
                            setIsCountryDropdownOpen(false);
                            setCountrySearchQuery("");
                          }}
                        >
                          <span className="text-lg">🌍</span>
                          <span>Global</span>
                        </div>
                        {filteredCountries.slice(0, 15).map((country: any, index: number) => (
                          <div 
                            key={country._id || index}
                            className={`p-2 rounded text-sm cursor-pointer hover:bg-gray-800/50 flex items-center gap-2 ${selectedCountry === country.name ? "bg-[#FF4199]/20" : ""}`}
                            onClick={() => {
                              setSelectedCountry(country.name); 
                              setIsCountryDropdownOpen(false);
                              setCountrySearchQuery("");
                            }}
                          >
                            {country.code && (
                              <img
                                src={`https://flagcdn.com/w20/${country.code?.toLowerCase()}.png`}
                                alt={country.name}
                                className="w-5 h-4 object-cover rounded-sm border border-gray-600 flex-shrink-0"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).style.display = 'none';
                                }}
                              />
                            )}
                            <span className="truncate">{country.name}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <Link 
                  href="/request-station" 
                  className="block py-2 bg-[#FF4199] text-white px-4 rounded-lg hover:bg-[#FF097B] transition-colors text-center mt-4"
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  Add Station
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Search Popup Modal - EXACT from original */}
      {isSearchOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 bg-black/80 backdrop-blur">
          <div className="w-full max-w-2xl mx-4">
            <div className="bg-[#1D1D1D] border border-[#2F2F2F] rounded-2xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold text-white">Search Stations</h3>
                <button
                  onClick={() => {
                    setIsSearchOpen(false);
                    setSearchQuery("");
                  }}
                  className="text-gray-400 hover:text-white"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              
              <div className="relative mb-4">
                <input
                  type="text"
                  placeholder="Search for radio stations, genres, or countries..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-[#0E0E0E] border border-[#2F2F2F] rounded-full px-6 py-4 text-white placeholder-gray-400 focus:border-[#FF4199] focus:outline-none text-lg"
                  autoFocus
                />
                <div className="absolute right-4 top-1/2 transform -translate-y-1/2">
                  <div className="bg-[#FF4199] rounded-full p-2">
                    <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  </div>
                </div>
              </div>

              {/* Search Results */}
              <div className="max-h-96 overflow-y-auto custom-scrollbar">
                {searchLoading ? (
                  <div className="flex items-center justify-center p-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#FF4199]"></div>
                    <span className="ml-3 text-gray-400">Searching stations...</span>
                  </div>
                ) : searchQuery && filteredStations.length > 0 ? (
                  <div className="space-y-1">
                    {/* Results header */}
                    <div className="flex items-center justify-between px-3 py-2 border-b border-[#2F2F2F] mb-3">
                      <span className="text-sm text-gray-400">
                        Found {filteredStations.length} station{filteredStations.length !== 1 ? 's' : ''}
                      </span>
                      <span className="text-xs text-gray-500">
                        Press Enter to select
                      </span>
                    </div>
                    
                    {filteredStations.map((station: any, index: number) => (
                      <div
                        key={station._id || index}
                        className="group flex items-center p-4 hover:bg-[#2F2F2F] cursor-pointer rounded-lg transition-all duration-200 border border-transparent hover:border-[#FF4199]/20"
                        onClick={() => {
                          // Use localized URL that preserves country code
                          const stationUrl = getStationUrl(station, { currentPath: location });
                          window.location.href = stationUrl;
                          setIsSearchOpen(false);
                          setSearchQuery("");
                        }}
                      >
                        {/* Station favicon with loading state */}
                        <div className="relative">
                          <img
                            src={getImageUrl(station.favicon)}
                            alt={station.name}
                            className="w-14 h-14 rounded-lg object-cover border border-[#2F2F2F] group-hover:border-[#FF4199]/30 transition-colors"
                            onError={(e) => (e.currentTarget.src = '/images/no-image.webp')}
                          />
                          {/* Online indicator */}
                          {station.lastCheckOk && (
                            <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-green-500 rounded-full border-2 border-[#1D1D1D]"></div>
                          )}
                        </div>
                        
                        <div className="ml-4 flex-1 min-w-0">
                          {/* Station name with highlight */}
                          <div className="text-white font-semibold text-base truncate group-hover:text-[#FF4199] transition-colors">
                            {station.name}
                          </div>
                          
                          {/* Country and additional info */}
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-sm text-gray-400">{station.country}</span>
                            {station.language && (
                              <>
                                <span className="text-gray-600">•</span>
                                <span className="text-xs text-gray-500 capitalize">{station.language}</span>
                              </>
                            )}
                          </div>
                          
                          {/* Tags and codec info */}
                          <div className="flex items-center gap-2 mt-2">
                            {station.codec && (
                              <span className="px-2 py-1 bg-[#0E0E0E] text-xs text-gray-400 rounded-md border border-[#2F2F2F]">
                                {station.codec}
                                {station.bitrate && ` ${station.bitrate}k`}
                              </span>
                            )}
                            {station.votes > 0 && (
                              <span className="px-2 py-1 bg-[#FF4199]/10 text-xs text-[#FF4199] rounded-md border border-[#FF4199]/20">
                                ♥ {station.votes}
                              </span>
                            )}
                            {station.tags && station.tags.split(',').slice(0, 2).map((tag: string, tagIndex: number) => (
                              <span key={tagIndex} className="px-2 py-1 bg-[#2F2F2F]/50 text-xs text-gray-500 rounded-md">
                                {tag.trim()}
                              </span>
                            ))}
                          </div>
                        </div>
                        
                        {/* Play button with hover animation */}
                        <div className="flex items-center gap-3">
                          <div className="text-[#FF4199] opacity-60 group-hover:opacity-100 transition-opacity">
                            <svg className="w-6 h-6 transform group-hover:scale-110 transition-transform" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M8 5v14l11-7z"/>
                            </svg>
                          </div>
                          <div className="text-gray-600">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : searchQuery && !searchLoading ? (
                  <div className="text-center py-12">
                    <div className="text-gray-600 mb-2">
                      <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                    </div>
                    <div className="text-gray-400 text-lg font-medium mb-1">No stations found</div>
                    <div className="text-gray-500 text-sm">
                      Try searching for different keywords like "{searchQuery.includes(' ') ? searchQuery.split(' ')[0] : 'jazz'}", "news", or "music"
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <div className="text-gray-600 mb-4">
                      <svg className="w-20 h-20 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                    </div>
                    <div className="text-gray-400 text-lg font-medium mb-2">Search Radio Stations</div>
                    <div className="text-gray-500 text-sm">
                      Start typing to discover thousands of radio stations worldwide
                    </div>
                    <div className="mt-4 flex flex-wrap justify-center gap-2">
                      {["Jazz", "News", "Rock", "Pop", "Classical"].map((suggestion, idx) => (
                        <button
                          key={idx}
                          onClick={() => setSearchQuery(suggestion.toLowerCase())}
                          className="px-3 py-1 bg-[#2F2F2F] hover:bg-[#FF4199]/20 text-xs text-gray-400 hover:text-[#FF4199] rounded-full transition-colors border border-[#2F2F2F] hover:border-[#FF4199]/30"
                        >
                          {suggestion}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}