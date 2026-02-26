import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams, useLocation, useRoute } from 'wouter';
import { SeoHead } from '@/components/SeoHead';
import StationCard from '@/components/ui/station-card';
import { CODE_TO_COUNTRY } from '@shared/seo-config';
import { useTranslation } from '@/hooks/useTranslation';

// Import arrow icons for pagination
import arrowLeftIcon from "@assets/arrow-left.png";
import arrowRightIcon from "@assets/arrow-right.png";

interface GenreLandingProps {
  selectedCountry?: string;
  onCountryChange?: (country: string, isManual?: boolean) => void;
}

export default function GenreLanding({ selectedCountry, onCountryChange }: GenreLandingProps) {
  const { t } = useTranslation();
  const { slug: paramsSlug } = useParams<{ slug: string }>();
  const [, setLocation] = useLocation();
  const [currentPage, setCurrentPage] = React.useState(1);
  const stationsPerPage = 15;
  
  // isMobile check for responsive pagination
  const { data: isMobile } = useQuery({
    queryKey: ['is-mobile-genre'],
    queryFn: () => window.innerWidth < 768,
    staleTime: Infinity,
  });
  
  // Extract country from URL route parameters
  const [, paramsLang] = useRoute("/:lang/genres/:slug");  // For /dz/genres/classical
  const [, paramsDefault] = useRoute("/genres/:slug");      // For /genres/classical
  
  // Get slug from multiple sources (priority: useParams > route params)
  const slug = paramsSlug || paramsLang?.slug || paramsDefault?.slug;
  
  // Get the current country from URL and dropdown selection
  // Priority: selectedCountry prop (from dropdown) > URL param > 'all'
  const urlCountryCode = paramsLang?.lang;
  const urlCountryName = urlCountryCode ? (CODE_TO_COUNTRY[urlCountryCode] || 'all') : null;
  
  // Use selectedCountry prop if it's different from URL-based country (dropdown selection)
  // or fall back to URL-based country detection
  const currentCountry = (selectedCountry && selectedCountry !== 'all' && selectedCountry !== urlCountryName) 
    ? selectedCountry 
    : (urlCountryName || selectedCountry || 'all');
  
  
  // Handle country selection with proper URL navigation (prevent page scroll and audio interruption)
  const handleCountryClick = (countryName: string) => {
    const countryCode = getCountryCodeFromName(countryName);
    if (countryCode) {
      // CRITICAL: Prevent audio interruption during navigation
      // Set a navigation flag to prevent audio stops
      if (window.history.state) {
        window.history.state.navigatingCountry = true;
      }
      
      // Navigate to localized genre URL: /de/genres/pop for Germany
      const localizedUrl = `/${countryCode}/genres/${slug}`;
      
      // Navigate without causing page scroll
      setLocation(localizedUrl);
      
      // Clear navigation flag after a short delay
      setTimeout(() => {
        if (window.history.state && window.history.state.navigatingCountry) {
          delete window.history.state.navigatingCountry;
        }
      }, 1000);
      
      // Call onCountryChange to update parent state
      onCountryChange?.(countryName, true);
    } else {
      // Fallback to calling the original onCountryChange if no country code mapping
      onCountryChange?.(countryName, true);
    }
  };
  
  const { data: genre, isLoading: genreLoading, error: genreError } = useQuery<{name: string, slug: string}>({
    queryKey: [`/api/genres/slug/${slug}`],
    enabled: !!slug
  });


  const { data: stationsResponse, isLoading: stationsLoading } = useQuery<{stations: any[], pagination: {total: number}}>({
    queryKey: [`/api/genres/${slug}/stations`, { page: currentPage, limit: stationsPerPage }, currentCountry, urlCountryCode],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: currentPage.toString(),
        limit: stationsPerPage.toString()
      });
      
      // Add country filter if available
      if (currentCountry && currentCountry !== 'all') {
        params.append('country', currentCountry);
      }
      
      const response = await fetch(`/api/genres/${slug}/stations?${params}`);
      if (!response.ok) throw new Error('Failed to fetch stations');
      return await response.json();
    },
    enabled: !!slug
  });

  const stations = stationsResponse?.stations || [];
  const totalStations = stationsResponse?.pagination?.total || 0;
  const totalPages = Math.ceil(totalStations / stationsPerPage);
  
  // Handle page changes
  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (genreLoading || !genre) {
    return (
      <div className="min-h-screen bg-[#0D0D0D] text-white flex items-center justify-center">
        <div className="text-xl">{t('genre_loading', 'Loading genre...') || 'Loading genre...'}</div>
      </div>
    );
  }

  const genreName = genre?.name || slug || '';

  return (
    <>
      <SeoHead pageType="genres" />
      
      <div className="min-h-screen bg-[#0D0D0D]">
        {/* Header with Breadcrumb - Figma: 1512x100, #151515 */}
        <div className="w-full bg-[#151515]" style={{ height: '100px' }}>
          <div className="mx-auto w-full max-w-[1512px] h-full px-5 md:px-[20px] flex items-center">
            <div className="mx-auto max-w-[1206px] w-full flex items-center text-white text-3xl font-bold">
              <span className="text-[#777777] cursor-pointer hover:text-white transition-colors" onClick={() => setLocation('/genres')}>
                {t('genres', 'Genres')}
              </span>
              <span className="mx-3 text-[#777777]">&gt;</span>
              <span className="capitalize">{genreName} Stations</span>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="mx-auto w-full max-w-[1512px] px-5 md:px-[20px] pb-16">
          <div className="mx-auto max-w-[1206px] w-full pt-6">
            {/* Stations Grid */}
            <div className="mb-12">

            {stationsLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {Array.from({ length: 9 }).map((_, i) => (
                  <div key={i} className="bg-[#1A1A1A] animate-pulse rounded-lg h-48" />
                ))}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                  {stations.map((station: any) => (
                    <StationCard
                      key={station._id}
                      station={station}
                      showVotes={true}
                    />
                  ))}
                </div>
                
                {/* Pagination - Responsive: Desktop full, Mobile compact */}
                <div className="py-8 grid items-center justify-center">
                {totalPages > 1 && (
                  <div className="flex items-center gap-1 md:gap-2">
                    {/* Previous button - Desktop: 51x38, Mobile: 40x32 */}
                    <button
                      onClick={() => handlePageChange(currentPage - 1)}
                      disabled={currentPage <= 1}
                      className={`flex items-center justify-center transition-colors ${
                        currentPage <= 1 ? 'opacity-40 cursor-not-allowed' : 'hover:opacity-80'
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
                      const maxVisible = isMobile ? 3 : 5;
                      
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
                        for (let i = 1; i <= totalPages; i++) {
                          buttons.push(
                            <button
                              key={i}
                              onClick={() => handlePageChange(i)}
                              className={buttonClass}
                              style={getButtonStyle(i === currentPage)}
                            >
                              {i}
                            </button>
                          );
                        }
                      } else {
                        if (isMobile) {
                          if (currentPage <= 3) {
                            for (let i = 1; i <= 3; i++) {
                              buttons.push(
                                <button key={i} onClick={() => handlePageChange(i)} className={buttonClass} style={getButtonStyle(i === currentPage)}>
                                  {i}
                                </button>
                              );
                            }
                            buttons.push(<span key="el" className={buttonClass} style={getButtonStyle(false)}>...</span>);
                            buttons.push(
                              <button key={totalPages} onClick={() => handlePageChange(totalPages)} className={buttonClass} style={getButtonStyle(totalPages === currentPage)}>
                                {totalPages}
                              </button>
                            );
                          } else if (currentPage >= totalPages - 2) {
                            buttons.push(
                              <button key={1} onClick={() => handlePageChange(1)} className={buttonClass} style={getButtonStyle(1 === currentPage)}>
                                1
                              </button>
                            );
                            buttons.push(<span key="el" className={buttonClass} style={getButtonStyle(false)}>...</span>);
                            for (let i = totalPages - 2; i <= totalPages; i++) {
                              buttons.push(
                                <button key={i} onClick={() => handlePageChange(i)} className={buttonClass} style={getButtonStyle(i === currentPage)}>
                                  {i}
                                </button>
                              );
                            }
                          } else {
                            buttons.push(
                              <button key={1} onClick={() => handlePageChange(1)} className={buttonClass} style={getButtonStyle(false)}>
                                1
                              </button>
                            );
                            buttons.push(<span key="el1" className={buttonClass} style={getButtonStyle(false)}>...</span>);
                            buttons.push(
                              <button key={currentPage} onClick={() => handlePageChange(currentPage)} className={buttonClass} style={getButtonStyle(true)}>
                                {currentPage}
                              </button>
                            );
                            buttons.push(<span key="el2" className={buttonClass} style={getButtonStyle(false)}>...</span>);
                            buttons.push(
                              <button key={totalPages} onClick={() => handlePageChange(totalPages)} className={buttonClass} style={getButtonStyle(false)}>
                                {totalPages}
                              </button>
                            );
                          }
                        } else {
                          if (currentPage <= 4) {
                            for (let i = 1; i <= 5; i++) {
                              buttons.push(
                                <button key={i} onClick={() => handlePageChange(i)} className={buttonClass} style={getButtonStyle(i === currentPage)}>
                                  {i}
                                </button>
                              );
                            }
                            buttons.push(<span key="ellipsis" className={buttonClass} style={getButtonStyle(false)}>...</span>);
                            buttons.push(
                              <button key={totalPages} onClick={() => handlePageChange(totalPages)} className={buttonClass} style={getButtonStyle(totalPages === currentPage)}>
                                {totalPages}
                              </button>
                            );
                          } else if (currentPage >= totalPages - 3) {
                            buttons.push(
                              <button key={1} onClick={() => handlePageChange(1)} className={buttonClass} style={getButtonStyle(1 === currentPage)}>
                                1
                              </button>
                            );
                            buttons.push(<span key="ellipsis" className={buttonClass} style={getButtonStyle(false)}>...</span>);
                            for (let i = totalPages - 4; i <= totalPages; i++) {
                              buttons.push(
                                <button key={i} onClick={() => handlePageChange(i)} className={buttonClass} style={getButtonStyle(i === currentPage)}>
                                  {i}
                                </button>
                              );
                            }
                          } else {
                            buttons.push(
                              <button key={1} onClick={() => handlePageChange(1)} className={buttonClass} style={getButtonStyle(1 === currentPage)}>
                                1
                              </button>
                            );
                            buttons.push(<span key="ellipsis1" className={buttonClass} style={getButtonStyle(false)}>...</span>);
                            for (let i = currentPage - 1; i <= currentPage + 1; i++) {
                              buttons.push(
                                <button key={i} onClick={() => handlePageChange(i)} className={buttonClass} style={getButtonStyle(i === currentPage)}>
                                  {i}
                                </button>
                              );
                            }
                            buttons.push(<span key="ellipsis2" className={buttonClass} style={getButtonStyle(false)}>...</span>);
                            buttons.push(
                              <button key={totalPages} onClick={() => handlePageChange(totalPages)} className={buttonClass} style={getButtonStyle(totalPages === currentPage)}>
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
                      onClick={() => handlePageChange(currentPage + 1)}
                      disabled={currentPage >= totalPages}
                      className={`flex items-center justify-center transition-colors ${
                        currentPage >= totalPages ? 'opacity-40 cursor-not-allowed' : 'hover:opacity-80'
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
              </>
            )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}