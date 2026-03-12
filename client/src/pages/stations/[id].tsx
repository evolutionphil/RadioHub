import { useRoute, Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useState, useEffect, lazy, Suspense, memo, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useTranslation } from "@/hooks/useTranslation";
import { useGlobalPlayer } from "@/hooks/useGlobalPlayer";
import FavoriteButton from "@/components/ui/favorite-button";
import { useSeoRouting } from "@/hooks/useSeoRouting";
import { SeoHead } from "@/components/SeoHead";
import { getStationUrl } from "@/utils/slugs";
import StationControlButtonGroup from "@/components/ui/station-control-button-group";
import youtubeIcon from "@assets/youtube-logo.png";
import spotifyIcon from "@assets/spotify-logo.png";
import deezerIcon from "@assets/deezer.png";
import shareIcon from "@assets/sharebutton.png";
import bgGradient from "@assets/bg-gradient.png";
import nosignalIcon from "@assets/nosignal.png";
import StationLogo from "@/components/ui/station-logo";
import AnimatedEqualizer from "@/components/ui/animated-equalizer";
import { StarRating } from "@/components/star-rating";
import { ListeningTimer } from "@/components/ui/listening-timer";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

// Lazy load below-the-fold components for performance
const AdCarousel = lazy(() => import("@/components/ad-carousel").then(m => ({ default: m.AdCarousel })));

// Inline ThumbsUp SVG to avoid loading entire lucide-react library for single icon
const ThumbsUpIcon = memo(({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/>
  </svg>
));


// Helper to filter out similar station names (prevents "Rock FM" and "Rock FM 2" duplicates)
// Same logic used on homepage for consistency
function filterSimilarNames(stations: any[], excludeBaseNames: Set<string> = new Set()): { filtered: any[], usedBaseNames: Set<string> } {
  const result: any[] = [];
  const usedBaseNames = new Set(excludeBaseNames);
  
  for (const station of stations) {
    // Normalize name: lowercase, remove special chars, take first 2 words as base
    const name = (station.name || '').toLowerCase();
    const words = name.replace(/[^a-z0-9\s]/gi, '').split(/\s+/).filter(Boolean);
    const baseName = words.slice(0, 2).join(' ');
    
    if (baseName && !usedBaseNames.has(baseName)) {
      result.push(station);
      usedBaseNames.add(baseName);
    }
  }
  
  return { filtered: result, usedBaseNames };
}

// Format vote count to K/M format (9.3K, 1.2M, etc.)
const formatVoteCount = (count: number): string => {
  if (count >= 1000000) {
    return (count / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  }
  if (count >= 1000) {
    return (count / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  }
  return count.toString();
};

interface Station {
  _id: string;
  name: string;
  url: string;
  urlResolved?: string;
  slug?: string;
  favicon?: string;
  localImagePath?: string;
  logoAssets?: {
    folder: string;
    webp48?: string;
    webp96?: string;
    webp256?: string;
    status: 'completed' | 'pending' | 'processing' | 'failed';
  };
  country?: string;
  countryCode?: string;
  language?: string;
  codec?: string;
  bitrate?: number;
  votes?: number;
  clickCount?: number;
  tags?: string;
  homepage?: string;
  state?: string;
  iso31662?: string;
  lastCheckOk?: boolean;
  lastCheckTime?: string;
  lastCheckOkTime?: string;
  lastLocalCheckTime?: string;
  clickTimestamp?: string;
  clickTrend?: number;
  sslError?: boolean;
  geoLat?: number;
  geoLong?: number;
  hasExtendedInfo?: boolean;
  // Rating fields
  averageRating?: number;
  totalRatings?: number;
  ratingBreakdown?: {
    stars1: number;
    stars2: number;
    stars3: number;
    stars4: number;
    stars5: number;
  };
}

export default function StationDetails() {
  // Use useSeoRouting to get cleanPath which handles ALL translated URLs automatically
  const { cleanPath, getLocalizedUrl, navigateWithLanguage, currentLanguage } = useSeoRouting();
  const [, setLocation] = useLocation();
  
  // Extract station identifier from cleanPath (already reverse-translated to English)
  // This works for ALL 57 languages automatically: /bg/stantsiya/dance-wave-2 → /station/dance-wave-2
  const pathSegments = cleanPath.split('/').filter(Boolean);
  
  // Determine if this is a station detail page and extract the identifier
  let stationId: string | undefined;
  let stationSlug: string | undefined;
  
  // Match patterns: /station/:slug, /stations/:id
  if (pathSegments.length >= 2) {
    if (pathSegments[0] === 'station') {
      // /station/:slug pattern
      stationSlug = pathSegments[1];
    } else if (pathSegments[0] === 'stations') {
      // /stations/:id pattern (API handles both slug and ID)
      stationId = pathSegments[1];
    }
  }
  
  const [stationRating, setStationRating] = useState(0);
  const [userRating, setUserRating] = useState<any>(null);
  const [ratingStats, setRatingStats] = useState<any>(null);
  
  // Similar stations state (fixed 12 stations, independent loading)
  const [allSimilarStations, setAllSimilarStations] = useState<Station[]>([]);
  const [loadingSimilar, setLoadingSimilar] = useState(true); // Start true for skeleton
  
  // Country stations state (independent from Similar, random from top 50)
  const [allCountryStations, setAllCountryStations] = useState<Station[]>([]);
  const [loadingCountry, setLoadingCountry] = useState(true); // Start true for skeleton
  const [countryStationsTotal, setCountryStationsTotal] = useState(0);
  const [showMoreCountryCount, setShowMoreCountryCount] = useState(0); // 0 = 12, 1 = 24, 2+ = all-radios

  
  // Fetch advertisements for display - Extended cache for performance
  const { data: advertisements } = useQuery({
    queryKey: ["/api/advertisements"],
    queryFn: async () => {
      const response = await fetch('/api/advertisements');
      if (!response.ok) throw new Error('Failed to fetch advertisements');
      return response.json();
    },
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    gcTime: 10 * 60 * 1000, // Keep in cache for 10 minutes
  });
  
  const { user, isAuthenticated } = useAuth();
  const { t, language } = useTranslation();
  const { toast } = useToast();
  const { currentStation, isPlaying, playStation, pauseStation, stopStation, stationMeta, hasError } = useGlobalPlayer();

  // Apply radio theme
  useEffect(() => {
    document.body.classList.add('radio-theme');
    return () => {
      document.body.classList.remove('radio-theme');
    };
  }, []);

  // Fetch station details - use unified endpoint that handles both slug and ID
  const identifier = stationSlug || stationId;
  
  // Immediate redirect for ObjectId URLs - don't wait for station data
  useEffect(() => {
    const currentIdentifier = stationSlug || stationId;
    
    // Check if the current identifier is an ObjectId (24 hex characters)
    if (currentIdentifier && currentIdentifier.match(/^[0-9a-fA-F]{24}$/)) {
      // Make a quick API call to get just the slug, then redirect immediately
      const redirectToSlugUrl = async () => {
        try {
          const response = await fetch(`/api/station/${currentIdentifier}`);
          if (response.ok) {
            const stationData = await response.json();
            if (stationData.slug) {
              const slugUrl = getStationUrl(stationData);
              setLocation(slugUrl);
            }
          }
        } catch (error) {
          // Continue with ObjectId URL if redirect fails
        }
      };
      
      redirectToSlugUrl();
    }
  }, [stationSlug, stationId, setLocation]);

  const { data: station, isLoading: stationLoading, error, refetch: refetchStation } = useQuery({
    queryKey: [`/api/station/${identifier}`],
    enabled: !!identifier,
  });
  

  // Fetch linked stations (Media Group Radios) - use station._id if available
  const { data: linkedStations } = useQuery({
    queryKey: ['/api/stations', station?._id, 'linked'],
    queryFn: async () => {
      const response = await fetch(`/api/stations/${station?._id}/linked`);
      if (!response.ok) return [];
      return response.json();
    },
    enabled: !!station?._id,
    staleTime: 10 * 60 * 1000, // 10 minutes cache
  });

  // Fetch user location for country-specific similar stations - Long cache (location rarely changes)
  // OPTIMIZED: Use cached location data from localStorage
  const { data: locationData } = useQuery({
    queryKey: ['/api/location'],
    initialData: () => {
      try {
        const cached = localStorage.getItem('cachedLocationData');
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed.timestamp && Date.now() - parsed.timestamp < 24 * 60 * 60 * 1000) {
            return parsed.data;
          }
        }
      } catch {}
      return undefined;
    },
    staleTime: 30 * 60 * 1000, // 30 minutes cache
    gcTime: 60 * 60 * 1000, // Keep in cache for 1 hour
  });

  // Get detected country for similar stations filtering
  const detectedCountry = (locationData as any)?.location?.country;
  const targetCountry = station?.country || detectedCountry;

  // Note: Auto-play removed to comply with browser autoplay policies
  // Users must manually click the play button to start playback
  // This prevents the "play() failed because the user didn't interact with the document first" error

  // ========== INDEPENDENT SECTION 1: SIMILAR RADIOS ==========
  // Load similar stations from 7-day cache (hasLogo→votes sorted)
  // Fallback: If country has < 6 stations, search globally by tags
  useEffect(() => {
    if (!station?._id) {
      setLoadingSimilar(false);
      return;
    }
    
    const loadSimilarStations = async () => {
      setLoadingSimilar(true);
      try {
        const currentTags = (station.tags || '').split(',').map((t: string) => t.trim().toLowerCase()).filter(Boolean);
        
        // Helper function to filter by tags
        const filterByTags = (stations: any[], excludeId: string) => {
          return stations.filter((s: any) => {
            if (s._id === excludeId) return false;
            const stationTags = (s.tags || '').split(',').map((t: string) => t.trim().toLowerCase());
            const commonTags = currentTags.filter((t: string) => stationTags.includes(t));
            return commonTags.length > 0;
          });
        };
        
        // Step 1: Try station's country first
        let similarStations: any[] = [];
        if (targetCountry) {
          const params = new URLSearchParams();
          params.append('countryName', targetCountry === 'all' ? 'global' : targetCountry);
          params.append('page', '1');
          params.append('limit', '30');
          
          const response = await fetch(`/api/stations/precomputed?${params}`);
          if (response.ok) {
            const result = await response.json();
            const stations = result.data || [];
            similarStations = filterByTags(stations, station._id);
            
            // If not enough tag matches, use any stations from same country
            if (similarStations.length < 6) {
              similarStations = stations.filter((s: any) => s._id !== station._id);
            }
          }
        }
        
        // Step 2: Fallback to GLOBAL search if country has < 12 similar stations
        if (similarStations.length < 12 && currentTags.length > 0) {
          const globalParams = new URLSearchParams();
          globalParams.append('countryName', 'global');
          globalParams.append('page', '1');
          globalParams.append('limit', '200'); // Fetch more for better tag matching
          
          const globalResponse = await fetch(`/api/stations/precomputed?${globalParams}`);
          if (globalResponse.ok) {
            const globalResult = await globalResponse.json();
            const globalStations = globalResult.data || [];
            const globalSimilar = filterByTags(globalStations, station._id);
            
            // Merge: country stations first, then global by tag
            const existingIds = new Set(similarStations.map(s => s._id));
            const additionalGlobal = globalSimilar.filter(s => !existingIds.has(s._id));
            similarStations = [...similarStations, ...additionalGlobal].slice(0, 12);
          }
        }
        
        setAllSimilarStations(similarStations.slice(0, 12));
      } catch (error) {
        setAllSimilarStations([]);
      } finally {
        setLoadingSimilar(false);
      }
    };
    
    loadSimilarStations();
  }, [station?._id, targetCountry, station?.tags]);
  
  // ========== INDEPENDENT SECTION 2: MORE FROM COUNTRY ==========
  // Load country stations from 7-day cache (hasLogo→votes sorted)
  useEffect(() => {
    if (!station?.country || !station?._id) {
      setLoadingCountry(false);
      return;
    }
    
    const loadCountryStations = async () => {
      setLoadingCountry(true);
      try {
        // Use precomputed endpoint for 7-day cache (already sorted by hasLogo→votes)
        const params = new URLSearchParams();
        params.append('countryName', station.country);
        params.append('page', '1');
        params.append('limit', '60'); // Fetch top 60 for "See More" expand (12→24)
        
        const response = await fetch(`/api/stations/precomputed?${params}`);
        if (!response.ok) throw new Error('Failed to fetch country stations');
        const result = await response.json();
        
        const stations = (result.data || []).filter((s: any) => s._id !== station._id);
        setAllCountryStations(stations);
        setCountryStationsTotal(result.pagination?.total || stations.length);
      } catch (error) {
        setAllCountryStations([]);
        setCountryStationsTotal(0);
      } finally {
        setLoadingCountry(false);
      }
    };
    
    loadCountryStations();
  }, [station?._id, station?.country]);

  // Track if page has loaded for future use
  const [pageLoaded, setPageLoaded] = useState(false);
  const [autoPlayTriggered, setAutoPlayTriggered] = useState(false);
  const [isAboutExpanded, setIsAboutExpanded] = useState(false);

  // DYNAMIC DEDUPLICATION: Filter similar names + exclude IDs across sections
  // Step 1: Filter Similar Radios for duplicate names
  const { filteredSimilarStations, similarBaseNames } = useMemo(() => {
    // Add current station's base name to exclusion set
    const currentStationBaseName = new Set<string>();
    if (station?.name) {
      const name = station.name.toLowerCase();
      const words = name.replace(/[^a-z0-9\s]/gi, '').split(/\s+/).filter(Boolean);
      const baseName = words.slice(0, 2).join(' ');
      if (baseName) currentStationBaseName.add(baseName);
    }
    
    const { filtered, usedBaseNames } = filterSimilarNames(allSimilarStations, currentStationBaseName);
    return { filteredSimilarStations: filtered.slice(0, 12), similarBaseNames: usedBaseNames };
  }, [allSimilarStations, station?.name]);
  
  // Step 2: Filter Country Stations - exclude current station and similar names, ALWAYS show 12 or 24
  // Country stations are loaded independently with random selection from top 50
  const filteredCountryStations = useMemo(() => {
    // Exclude current station (already excluded on backend, but double-check)
    const filtered = allCountryStations.filter(s => s._id !== station?._id);
    
    // Filter by similar names for variety
    const { filtered: nameFiltered } = filterSimilarNames(filtered, similarBaseNames);
    
    // Determine how many to show based on "See More" clicks: 0 clicks = 12, 1 click = 24
    const displayCount = showMoreCountryCount === 0 ? 12 : 24;
    const result = nameFiltered.slice(0, Math.min(displayCount, nameFiltered.length));
    
    // If we have less than displayCount after filtering, pad with remaining unfiltered stations
    if (result.length < displayCount) {
      const alreadyUsedIds = new Set(result.map(s => s._id));
      const remaining = filtered.filter(s => !alreadyUsedIds.has(s._id));
      result.push(...remaining.slice(0, displayCount - result.length));
    }
    
    return result;
  }, [allCountryStations, similarBaseNames, station?._id, showMoreCountryCount]);

  // Mark page as loaded when station data is available - NO AUTO-PLAY
  useEffect(() => {
    if (station && station._id && !pageLoaded) {
      setPageLoaded(true);
      // Remove auto-play behavior to match original GitHub design
      // Original doesn't auto-play when visiting station page
    }
  }, [station?._id, pageLoaded]);

  // Helper function for country flags - matching original
  const getCountryImage = (countrycode: string) => {
    return `/flags/${countrycode?.toLowerCase() || 'unknown'}.webp`;
  };

  // Audio playback with global player
  const handlePlay = async () => {
    if (!station) return;

    try {
      // Always play the station - if it's the same station and playing, pause it, otherwise play it
      if (currentStation?._id === station._id && isPlaying) {
        pauseStation();
      } else {
        // This will automatically stop current station and play new one
        await playStation(station);
      }
    } catch (error) {
      toast({
        title: t('error_playback_error', 'Playback Error'),
        description: t('error_unable_to_stream', 'Unable to stream this station. Please try another one.'),
        variant: "destructive",
      });
    }
  };

  // Function to handle play from station cards (always play new station and navigate)
  const handleStationCardPlay = async (selectedStation: any) => {
    try {
      // Always play the selected station (will auto-stop current if different)
      await playStation(selectedStation);
      
      // Navigate to the station's detail page with translated URL
      const stationUrl = `/station/${selectedStation.slug || selectedStation._id}`;
      const translatedUrl = getLocalizedUrl(stationUrl);
      setLocation(translatedUrl);
    } catch (error) {
      // Station card play failed
      toast({
        title: t('error_playback_error', 'Playback Error'),
        description: t('error_unable_to_stream', 'Unable to stream this station. Please try another one.'),
        variant: "destructive",
      });
    }
  };



  const isCurrentStationPlaying = currentStation?._id === station?._id && isPlaying;


  const handleShare = () => {
    if (navigator.share && station) {
      navigator.share({
        title: station.name,
        text: `Listen to ${station.name}`,
        url: window.location.href,
      });
    } else {
      navigator.clipboard.writeText(window.location.href);
      toast({
        title: t('success_link_copied', 'Link Copied'),
        description: t('success_station_link_copied', 'Station link copied to clipboard'),
      });
    }
  };

  // Get user's existing rating - with structured cache key
  const { data: existingUserRating } = useQuery({
    queryKey: ['/api/stations', station?._id, 'user-rating'],
    queryFn: async () => {
      const response = await fetch(`/api/stations/${station?._id}/user-rating`);
      if (!response.ok) return null;
      return response.json();
    },
    enabled: !!station?._id,
    retry: false,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Get station ratings - with structured cache key
  const { data: ratingsData, refetch: refetchRatings } = useQuery({
    queryKey: ['/api/stations', station?._id, 'ratings'],
    queryFn: async () => {
      const response = await fetch(`/api/stations/${station?._id}/ratings`);
      if (!response.ok) return null;
      return response.json();
    },
    enabled: !!station?._id,
    retry: false,
    staleTime: 2 * 60 * 1000, // 2 minutes
  });

  // Submit rating function
  const submitRating = async (rating: number, comment?: string) => {
    if (!station?._id) return;
    
    try {
      const payload = {
        rating,
        comment,
        userId: user?._id,
        sessionId: generateSessionId()
      };

      const response = await fetch(`/api/stations/${station._id}/rate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error('Failed to submit rating');
      }

      const result = await response.json();
      
      setStationRating(rating);
      setUserRating(result.rating);
      setRatingStats(result.stats);
      
      // Refetch ratings to update the display
      refetchRatings();
      
      toast({ 
        title: t('success_rating_saved', 'Rating saved'), 
        description: t('success_thank_you_feedback', 'Thank you for your feedback!') 
      });
    } catch (error) {
      console.error('Rating submission error:', error);
      toast({ 
        title: t('error_rating_failed', 'Rating failed'), 
        description: t('error_try_again', 'Please try again later.'),
        variant: "destructive"
      });
    }
  };

  // Helper function to generate session ID
  const generateSessionId = () => {
    if (typeof window !== 'undefined') {
      let sessionId = localStorage.getItem('radio_session_id');
      if (!sessionId) {
        sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        localStorage.setItem('radio_session_id', sessionId);
      }
      return sessionId;
    }
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  };

  if (stationLoading) {
    return (
      <div className="min-h-screen bg-[#101010] flex items-center justify-center">
        <div className="text-white text-xl">{t('station_details_loading', 'Loading station...')}</div>
      </div>
    );
  }

  if (!station) {
    const errorMessage = error?.message || '';
    const is404 = errorMessage.startsWith('404');
    if (error && !is404) {
      return (
        <div className="min-h-screen bg-[#101010] flex items-center justify-center flex-col gap-4">
          <div className="text-white text-xl">{t('error_connection', 'Connection error. Please try again.')}</div>
          <button 
            onClick={() => refetchStation()} 
            className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
          >
            {t('retry', 'Retry')}
          </button>
        </div>
      );
    }
    return (
      <div className="min-h-screen bg-[#101010] text-white flex justify-center items-center pt-10">
        <div className="text-2xl">{t('station_details_not_found', 'Station not found.')}</div>
      </div>
    );
  }

  return (
    <div>
      {/* SEO Head for Station Page */}
      <SeoHead 
        stationData={station ? {
          name: station.name,
          slug: station.slug || station._id,
          favicon: station.favicon,
          descriptions: station.descriptions,
          country: station.country,
          countryCode: station.countryCode,
          language: station.language,
          tags: station.tags,
          bitrate: station.bitrate,
          votes: station.votes
        } : null}
        pageType="station"
      />
      
      {station && (
        <>
          {/* Breadcrumb Navigation - visible to users and Google (matches BreadcrumbList JSON-LD schema) */}
          <nav aria-label="breadcrumb" className="bg-[#101010] px-4 pt-3 pb-0">
            <ol className="flex items-center gap-1 text-xs text-gray-500 flex-wrap">
              <li>
                <Link to={getLocalizedUrl('/')} className="hover:text-gray-300 transition-colors">
                  {t('nav_home', 'Home')}
                </Link>
              </li>
              <li aria-hidden="true" className="text-gray-600">›</li>
              <li>
                <Link to={getLocalizedUrl('/stations')} className="hover:text-gray-300 transition-colors">
                  {t('nav_stations', 'Stations')}
                </Link>
              </li>
              <li aria-hidden="true" className="text-gray-600">›</li>
              <li className="text-gray-400 truncate max-w-[160px] sm:max-w-xs" aria-current="page">
                {station.name}
              </li>
            </ol>
          </nav>

          {/* Radio Playing Section - Mobile First Responsive */}
          <div className="relative bg-[#101010] md:bg-[#1D1D1D] py-4 overflow-hidden">
            {/* Connection Failed Overlay - Figma: 1512x308, #00000080, blur(13px) */}
            {hasError && currentStation?._id === station._id && (
              <div 
                className="absolute inset-0 z-50 flex flex-col items-center justify-center"
                style={{
                  backgroundColor: 'rgba(0, 0, 0, 0.5)',
                  backdropFilter: 'blur(13px)',
                  WebkitBackdropFilter: 'blur(13px)'
                }}
              >
                {/* Close Button (X) - Figma: 24x24 white circle, positioned relative to icon */}
                <button
                  onClick={() => stopStation()}
                  className="absolute flex items-center justify-center hover:opacity-80 transition-opacity"
                  style={{
                    width: '24px',
                    height: '24px',
                    top: '46px',
                    left: 'calc(50% + 120px)',
                    backgroundColor: '#FFFFFF',
                    borderRadius: '50%'
                  }}
                  aria-label="Close"
                >
                  <svg 
                    xmlns="http://www.w3.org/2000/svg" 
                    viewBox="0 0 24 24" 
                    fill="none" 
                    stroke="#1D1D1D" 
                    strokeWidth="2.5" 
                    strokeLinecap="round" 
                    strokeLinejoin="round"
                    style={{ width: '14px', height: '14px' }}
                  >
                    <line x1="18" y1="6" x2="6" y2="18"/>
                    <line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
                
                {/* Error Icon - Figma: 82x82 circle with nosignal.png inside */}
                <div 
                  className="flex items-center justify-center mb-4"
                  style={{
                    width: '82px',
                    height: '82px',
                    borderRadius: '87.23px',
                    backgroundColor: '#FF415829'
                  }}
                >
                  <img 
                    src={nosignalIcon} 
                    alt="No Signal"
                    style={{
                      width: '40.92px',
                      height: '54.09px'
                    }}
                  />
                </div>
                
                {/* Error Message */}
                <h3 
                  className="text-white text-xl md:text-2xl font-medium mb-1"
                  style={{ fontFamily: "'Ubuntu', system-ui, sans-serif" }}
                >
                  Opps!
                </h3>
                <p 
                  className="text-white/80 text-sm md:text-base text-center px-4 mb-6"
                  style={{ fontFamily: "'Ubuntu', system-ui, sans-serif" }}
                >
                  Connection failed.<br />
                  Please try again or play other radios below.
                </p>
                
                {/* Report Button - Figma: 122x42, #FF4199, border-radius 3.55px */}
                <button
                  onClick={() => {
                    // Report functionality - can be expanded
                    toast({
                      title: t('report_submitted', 'Report submitted'),
                      description: t('report_thank_you', 'Thank you for reporting this issue.'),
                    });
                  }}
                  className="text-white text-sm font-medium hover:opacity-90 transition-opacity"
                  style={{
                    width: '122px',
                    height: '42px',
                    backgroundColor: '#FF4199',
                    borderRadius: '3.55px',
                    fontFamily: "'Ubuntu', system-ui, sans-serif"
                  }}
                >
                  Report this
                </button>
              </div>
            )}
            
            {/* Background Gradient - Figma: 521x521, positioned behind station logo - Hidden on mobile/tablet */}
            <img 
              src={bgGradient}
              alt=""
              className="hidden md:block absolute pointer-events-none w-[521px] h-[521px]"
              style={{
                top: '-41px',
                left: '-64px',
                opacity: 1
              }}
            />
            <div className="container m-auto relative z-10">
              <div className="items-center justify-between gap-4 py-2 md:py-10 sm:flex bg-[#151515] md:bg-transparent rounded">
                {/* Mobile: Full width, Desktop: flex to use available width */}
                <div className="flex p-4 md:p-0 w-full max-w-full md:flex-1 md:h-[224px]">
                  {/* Station Image - Figma: Mobile 79x79, Desktop 224x224, border-radius 11.14px, border 2.24px */}
                  <div 
                    className="w-[79px] h-[79px] md:w-[224px] md:h-[224px] flex-shrink-0 overflow-hidden border-[#424242]"
                    style={{
                      borderRadius: '11.14px',
                      borderWidth: '2.24px',
                      borderStyle: 'solid'
                    }}
                  >
                    <StationLogo 
                      station={station} 
                      size="hero"
                      priority={true}
                      className="w-full h-full"
                    />
                  </div>

                  {/* Station Info and Controls - Figma Layout */}
                  <div className="flex-1 flex flex-col justify-between pl-3 md:pl-6 md:py-2 pt-2 md:pt-3 min-w-0 overflow-hidden">
                    {/* Top Section: Equalizer + Station Name + Vote Count */}
                    <div className="min-w-0 overflow-hidden">
                      {/* Equalizer Row */}
                      <div className="flex items-center mb-1">
                        {/* Equalizer Animation - Pink #FF4199 */}
                        <AnimatedEqualizer isPlaying={isCurrentStationPlaying} color="#FF4199" />
                      </div>

                      {/* Station Name + Vote Count Row - bottom aligned */}
                      <div className="flex items-end gap-2 md:gap-3">
                        {/* Station Name - Figma: Mobile 16px/700 | Desktop 32px/500 - NO truncate */}
                        <h1 
                          className="text-white text-left text-base md:text-[32px] font-bold md:font-medium"
                          style={{ 
                            fontFamily: "'Ubuntu', system-ui, sans-serif",
                            lineHeight: '100%'
                          }}
                        >
                          {station.name}
                        </h1>
                        
                        {/* Vote Count with ThumbsUp - Right of station name, bottom aligned */}
                        {station.votes !== undefined && (
                          <div className="flex items-center gap-1 text-xs text-white/70 flex-shrink-0" style={{ fontFamily: "'Ubuntu', system-ui, sans-serif" }}>
                            <ThumbsUpIcon className="w-3 h-3" />
                            <span>{formatVoteCount(station.votes || 0)}</span>
                          </div>
                        )}
                      </div>

                      {/* Now Playing Meta or Country - Figma: Mobile 14px/500 | Desktop 16px/500 */}
                      {/* Mobile: 35 char limit for song title */}
                      <div 
                        className="text-gray-300 truncate mt-1 text-left text-sm md:text-base max-w-full overflow-hidden"
                        style={{ 
                          fontFamily: "'Ubuntu', system-ui, sans-serif",
                          fontWeight: 500,
                          lineHeight: '100%'
                        }}
                      >
                        {stationMeta && stationMeta.title ? (
                          stationMeta.artist && stationMeta.artist !== stationMeta.title ? (
                            <>
                              {/* Mobile: 35 char limit */}
                              <span className="md:hidden">
                                {(`${stationMeta.artist} - ${stationMeta.title}`).length > 35 
                                  ? (`${stationMeta.artist} - ${stationMeta.title}`).substring(0, 35) + '...'
                                  : `${stationMeta.artist} - ${stationMeta.title}`}
                              </span>
                              {/* Desktop: full text */}
                              <span className="hidden md:inline">{stationMeta.artist} - {stationMeta.title}</span>
                            </>
                          ) : (
                            <>
                              {/* Mobile: 35 char limit */}
                              <span className="md:hidden">
                                {stationMeta.title.length > 35 
                                  ? stationMeta.title.substring(0, 35) + '...'
                                  : stationMeta.title}
                              </span>
                              {/* Desktop: full text */}
                              <span className="hidden md:inline">{stationMeta.title}</span>
                            </>
                          )
                        ) : (
                          <span>{station.country}</span>
                        )}
                      </div>
                    </div>

                    {/* Meta Actions - Desktop (YouTube, Spotify, Deezer, Chromecast, Share) */}
                    <div className="py-2 hidden md:flex items-center gap-3">
                      {stationMeta && stationMeta.title && (
                        <>
                          {/* YouTube Button - 26x26 */}
                          <button 
                            onClick={() => {
                              const query = encodeURIComponent(`${stationMeta.artist || ''} ${stationMeta.title || ''}`.trim());
                              window.open(`https://www.youtube.com/results?search_query=${query}`, '_blank');
                            }}
                            className="hover:opacity-80 transition-opacity flex-shrink-0"
                            title={t('button_search_youtube', 'Search on YouTube')}
                          >
                            <img src={youtubeIcon} alt="YouTube" style={{ width: 26, height: 26 }} />
                          </button>
                          
                          {/* Spotify Button - 26x26 */}
                          <button 
                            onClick={() => {
                              const query = encodeURIComponent(`${stationMeta.artist || ''} ${stationMeta.title || ''}`.trim());
                              window.open(`https://open.spotify.com/search/${query}`, '_blank');
                            }}
                            className="hover:opacity-80 transition-opacity flex-shrink-0"
                            title={t('button_search_spotify', 'Search on Spotify')}
                          >
                            <img src={spotifyIcon} alt="Spotify" style={{ width: 26, height: 26 }} />
                          </button>
                          
                          {/* Deezer Button - 26x26 */}
                          <button 
                            onClick={() => {
                              const query = encodeURIComponent(`${stationMeta.artist || ''} ${stationMeta.title || ''}`.trim());
                              window.open(`https://www.deezer.com/search/${query}`, '_blank');
                            }}
                            className="hover:opacity-80 transition-opacity flex-shrink-0"
                            title={t('button_search_deezer', 'Search on Deezer')}
                          >
                            <img src={deezerIcon} alt="Deezer" style={{ width: 26, height: 26 }} />
                          </button>
                        </>
                      )}
                      
                      {/* Share Button - 26x26 */}
                      <button 
                        onClick={handleShare}
                        className="hover:opacity-80 transition-opacity flex-shrink-0" 
                        title={t('button_share_station', 'Share Station')}
                      >
                        <img src={shareIcon} alt="Share" style={{ width: 26, height: 26 }} />
                      </button>
                    </div>

                    {/* Station Control Buttons - extra margin on mobile */}
                    <div className="mt-4 md:mt-0">
                      <StationControlButtonGroup currentPageStation={station} />
                    </div>
                  </div>
                </div>

                {/* Mobile Separator - Figma: #313131, 1px border */}
                <div className="pt-4 md:hidden">
                  <div className="w-full border-t" style={{ borderColor: '#313131' }}></div>
                </div>

                {/* Mobile Meta Actions - Left: YouTube, Spotify, Deezer | Right: Chromecast, Share */}
                <div className="flex justify-between items-center px-4 pt-4 pb-2 md:hidden">
                  {/* Left side - Music search buttons */}
                  <div className="flex items-center gap-4">
                    {stationMeta && stationMeta.title && (
                      <>
                        {/* Mobile YouTube Button - 26x26 */}
                        <button 
                          onClick={() => {
                            const query = encodeURIComponent(`${stationMeta.artist || ''} ${stationMeta.title || ''}`.trim());
                            window.open(`https://www.youtube.com/results?search_query=${query}`, '_blank');
                          }}
                          className="hover:opacity-80 transition-opacity flex-shrink-0"
                          title={t('button_search_youtube', 'Search on YouTube')}
                        >
                          <img src={youtubeIcon} alt="YouTube" style={{ width: 26, height: 26 }} />
                        </button>
                        
                        {/* Mobile Spotify Button - 26x26 */}
                        <button 
                          onClick={() => {
                            const query = encodeURIComponent(`${stationMeta.artist || ''} ${stationMeta.title || ''}`.trim());
                            window.open(`https://open.spotify.com/search/${query}`, '_blank');
                          }}
                          className="hover:opacity-80 transition-opacity flex-shrink-0"
                          title={t('button_search_spotify', 'Search on Spotify')}
                        >
                          <img src={spotifyIcon} alt="Spotify" style={{ width: 26, height: 26 }} />
                        </button>
                        
                        {/* Mobile Deezer Button - 26x26 */}
                        <button 
                          onClick={() => {
                            const query = encodeURIComponent(`${stationMeta.artist || ''} ${stationMeta.title || ''}`.trim());
                            window.open(`https://www.deezer.com/search/${query}`, '_blank');
                          }}
                          className="hover:opacity-80 transition-opacity flex-shrink-0"
                          title={t('button_search_deezer', 'Search on Deezer')}
                        >
                          <img src={deezerIcon} alt="Deezer" style={{ width: 26, height: 26 }} />
                        </button>
                      </>
                    )}
                  </div>
                  
                  {/* Right side - Share */}
                  <div className="flex items-center gap-4">
                    {/* Mobile Share Button - 26x26 */}
                    <button 
                      onClick={handleShare}
                      className="hover:opacity-80 transition-opacity flex-shrink-0"
                      aria-label="Share station"
                      title="Share"
                    >
                      <img src={shareIcon} alt="Share" style={{ width: 26, height: 26 }} />
                    </button>
                  </div>
                </div>

                {/* Desktop Ad Space - Lazy loaded */}
                <div className="mt-4 text-center sm:mt-0 hidden md:block">
                  <div className="mt-6">
                    {advertisements && advertisements.length > 0 ? (
                      <Suspense fallback={<div className="bg-gray-800 rounded flex items-center justify-center text-gray-400 aspect-square h-56 flex-none animate-pulse" />}>
                        <AdCarousel 
                          ads={advertisements} 
                          position="desktop_sidebar"
                          autoSwitchInterval={8000}
                          placeholderText={t('general_ad_space', 'Ad Space')}
                        />
                      </Suspense>
                    ) : (
                      <div className="bg-gray-800 rounded flex items-center justify-center text-gray-400 aspect-square h-56 flex-none">
                        {t('general_ad_space', 'Ad Space')}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Player About Section - Exact match to original GitHub repository */}
          <div className="bg-[#101010] md:bg-[#151515]">
            <div className="container m-auto">
              <div className="block items-center justify-between py-4 md:flex md:py-8">
                <div>
                  <div className="mb-2 text-base font-bold text-white">
                    {t('station_about_station', 'About the station')}
                  </div>
                  <div className="mb-2 w-full text-white">
                    {/* About text with responsive char limit: 145 for mobile/tablet, 470 for desktop */}
                    {(() => {
                      let fullText = '';
                      
                      if (station.descriptions) {
                        const desc = station.descriptions[language] || station.descriptions['en'];
                        if (desc) {
                          if (typeof desc === 'object' && desc.full) {
                            fullText = desc.full;
                          } else if (typeof desc === 'string') {
                            fullText = desc;
                          }
                          fullText = fullText.replace(/^\[FULL DESCRIPTION - 200-300 words\]\s*/i, '').trim();
                        }
                      }
                      
                      if (!fullText) {
                        fullText = language === 'tr' 
                          ? `Şu anda ${station.name} dinliyorsunuz! – Mega Radio üzerinde binlerce radyo istasyonunu HD kalitede ücretsiz online dinleyin.`
                          : t('default_station_about', `You are now listening to ${station.name}! – Listen to thousands of radio stations in HD quality online for free on Mega Radio.`, {
                              STATION_NAME: station.name
                            });
                      }
                      
                      const mobileCharLimit = 145;
                      const desktopCharLimit = 470;
                      const needsMobileTruncation = fullText.length > mobileCharLimit;
                      const needsDesktopTruncation = fullText.length > desktopCharLimit;
                      
                      if (isAboutExpanded) {
                        return <p>{fullText}</p>;
                      }
                      
                      const mobileTruncatedText = fullText.slice(0, mobileCharLimit).trim() + '...';
                      const desktopTruncatedText = fullText.slice(0, desktopCharLimit).trim() + '...';
                      
                      return (
                        <>
                          {/* Mobile/Tablet: 145 char limit */}
                          <p className="md:hidden">
                            {needsMobileTruncation ? (
                              <>
                                {mobileTruncatedText}{' '}
                                <button 
                                  onClick={() => setIsAboutExpanded(true)}
                                  className="text-[#FF4199] hover:underline font-medium"
                                >
                                  {t('general_more', 'more')}
                                </button>
                              </>
                            ) : fullText}
                          </p>
                          {/* Desktop: 470 char limit */}
                          <p className="hidden md:block">
                            {needsDesktopTruncation ? (
                              <>
                                {desktopTruncatedText}{' '}
                                <button 
                                  onClick={() => setIsAboutExpanded(true)}
                                  className="text-[#FF4199] hover:underline font-medium"
                                >
                                  {t('general_more', 'more')}
                                </button>
                              </>
                            ) : fullText}
                          </p>
                        </>
                      );
                    })()}
                  </div>
                  
                  <div className="flex flex-wrap items-center gap-2 md:gap-3 py-3">
                    {/* Country Flag - Figma: 20x20, perfectly circular, no border - only show if countryCode exists */}
                    {station.countryCode && station.countryCode.trim() !== '' && (
                      <TooltipProvider delayDuration={200}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div 
                              style={{ 
                                width: '20px', 
                                height: '20px', 
                                borderRadius: '50%',
                                overflow: 'hidden',
                                flexShrink: 0,
                                cursor: 'pointer'
                              }}
                            >
                              <img 
                                src={`https://flagcdn.com/w80/${station.countryCode.toLowerCase()}.png`}
                                alt={station.country || 'Country'}
                                style={{ 
                                  width: '100%', 
                                  height: '100%', 
                                  objectFit: 'cover',
                                  display: 'block'
                                }}
                                onError={(e) => {
                                  (e.target as HTMLImageElement).src = '/images/no-image.webp';
                                }}
                              />
                            </div>
                          </TooltipTrigger>
                          <TooltipContent 
                            side="top" 
                            className="bg-[#1A1A1A] text-white border border-[#333333] px-3 py-1.5 text-sm font-medium"
                            style={{ 
                              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)',
                              fontFamily: 'Ubuntu, sans-serif'
                            }}
                          >
                            {station.country || 'Unknown'}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                    
                    {station.codec && station.codec !== '' && (
                      <button 
                        className="rounded bg-[#4D4D4D] px-3 py-1 text-white font-sans whitespace-nowrap"
                        style={{ fontWeight: 500, fontSize: '14px', lineHeight: '100%' }}
                      >
                        {station.codec}
                      </button>
                    )}
                    
                    {station.bitrate && station.bitrate !== 0 && (
                      <button 
                        className="rounded bg-[#4D4D4D] px-3 py-1 text-white font-sans whitespace-nowrap"
                        style={{ fontWeight: 500, fontSize: '14px', lineHeight: '100%' }}
                      >
                        {station.bitrate} kbps
                      </button>
                    )}
                    
                    {station.tags && station.tags.split(',').slice(0, 3).map((tag, index) => (
                      <button 
                        key={index} 
                        className="rounded bg-[#4D4D4D] px-3 py-1 capitalize text-white font-sans whitespace-nowrap"
                        style={{ fontWeight: 500, fontSize: '14px', lineHeight: '100%' }}
                      >
                        {tag.trim()}
                      </button>
                    ))}
                  </div>
                </div>
                
                {/* Download App section removed from here - it exists at bottom with proper gradient design */}
              </div>
            </div>
          </div>

          {/* Media Group Radios Section - Enhanced to match original exactly */}
          {linkedStations && linkedStations.length > 0 && (
            <div className="bg-[#181818] py-6">
              <div className="container m-auto">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                  <h2 className="text-xl md:text-2xl font-bold text-white whitespace-nowrap">{t('station_media_group_radios', 'Media Group Radios')}</h2>
                  <div className="flex-1 w-full overflow-hidden">
                    <div className="flex gap-4 overflow-x-auto pb-2">
                      {linkedStations.slice(0, 8).map((linkedStation: Station) => (
                        <Link key={`${currentLanguage}-${linkedStation._id}`} to={getLocalizedUrl(`/station/${linkedStation.slug || linkedStation._id}`)}>
                          <div className="flex items-center gap-4 border p-4 rounded-lg border-[#292929] hover:bg-[#252525] hover:border-[#7B7B7B] cursor-pointer overflow-hidden min-w-[250px] transition-colors">
                            <div className="w-14 h-14 flex-shrink-0">
                              <img
                                loading="lazy"
                                decoding="async"
                                height={56}
                                width={56}
                                src={(() => { const v = linkedStation.logoAssets?.webp256 || linkedStation.logoAssets?.webp96; return v ? (v.startsWith('http') ? v : `/station-logos/${linkedStation.logoAssets?.folder}/${v}`) : linkedStation.favicon || "/images/no-image.webp"; })()}
                                alt={`Listen ${linkedStation.name}`}
                                className="w-14 h-14 rounded object-cover"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).src = "/images/no-image.webp";
                                }}
                              />
                            </div>
                            <div className="flex-1">
                              <h4 className="text-lg font-semibold text-white truncate mb-1">
                                {linkedStation.name}
                              </h4>
                              <p className="text-sm font-medium text-gray-300 truncate">
                                {linkedStation.country}
                                {linkedStation.state && linkedStation.state !== "" && (
                                  <span className="font-normal text-gray-400">, {linkedStation.state}</span>
                                )}
                              </p>
                            </div>
                          </div>
                        </Link>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="container m-auto space-y-4 pb-10 text-white">
            {/* Similar Radios Section - Independent Loading */}
            {(loadingSimilar || (filteredSimilarStations && filteredSimilarStations.length > 0)) && (
              <div>
                <div className="py-6">
                  <h3 className="text-xl font-bold">
                    {t('station_similar_radios', 'Similar Radios')}
                  </h3>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4 md:gap-6">
                  {loadingSimilar ? (
                    // Skeleton loading - 12 placeholder cards
                    Array.from({ length: 12 }).map((_, idx) => (
                      <div key={`skeleton-similar-${idx}`} className="flex items-center rounded-lg bg-[#2F2F2F] p-4 overflow-hidden min-h-[110px]">
                        <Skeleton className="h-[73px] w-[73px] flex-shrink-0 bg-gray-700" style={{ borderRadius: '7.3px' }} />
                        <div className="ml-4 flex-1 space-y-2">
                          <Skeleton className="h-5 w-3/4 bg-gray-700" />
                          <Skeleton className="h-4 w-1/2 bg-gray-700" />
                          <Skeleton className="h-3 w-1/4 bg-gray-700" />
                        </div>
                        <div className="ml-auto flex items-center gap-2">
                          <Skeleton className="h-10 w-10 rounded-full bg-gray-700" />
                          <Skeleton className="h-10 w-10 rounded-full bg-gray-700" />
                        </div>
                      </div>
                    ))
                  ) : filteredSimilarStations.map((similarStation: Station) => (
                    <div key={similarStation._id} className="group flex cursor-pointer items-center rounded-lg bg-[#2F2F2F] p-4 overflow-hidden min-h-[110px] transition-colors duration-300 hover:bg-[#383838]">
                      <div className="h-[73px] w-[73px] flex-shrink-0 overflow-hidden rounded-[7.3px]">
                        <StationLogo
                          station={similarStation}
                          size="card"
                          className="!w-[73px] !h-[73px]"
                          alt={`Listen ${similarStation.name} at megaradio`}
                        />
                      </div>
                      <button 
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleStationCardPlay(similarStation);
                        }}
                        className="ml-4 truncate flex-1 text-left rounded p-2"
                      >
                        <div>
                          <h4 className="text-[16px] font-medium text-white truncate" style={{ fontFamily: "'Ubuntu', system-ui, sans-serif", fontWeight: 500 }}>
                            {similarStation.name}
                          </h4>
                          <p className="text-[15px] text-white" style={{ fontFamily: "'Ubuntu', system-ui, sans-serif", fontWeight: 300 }}>
                            <span className="truncate">{similarStation.country && similarStation.country.length > 21 ? similarStation.country.substring(0, 21) + '...' : similarStation.country}</span>
                            {similarStation.state && similarStation.state !== "" && (
                              <span className="font-normal text-gray-400">, {similarStation.state}</span>
                            )}
                          </p>
                          {/* Vote Count */}
                          {similarStation.votes !== undefined && (
                            <div className="flex items-center gap-1 text-xs text-white/70 mt-1" style={{ fontFamily: "'Ubuntu', system-ui, sans-serif" }}>
                              <ThumbsUpIcon className="w-3 h-3" />
                              <span>{formatVoteCount(similarStation.votes || 0)}</span>
                            </div>
                          )}
                        </div>
                      </button>
                      <div className="ml-auto flex items-center gap-2">
                        {/* Favorite Button - Mobile Only - Figma: 40x40, border 1.6px, transparent bg, icon 22.4px */}
                        <div className="md:hidden">
                          <FavoriteButton 
                            stationId={similarStation._id} 
                            className="!w-10 !h-10 !rounded-[32.22px] !border-[1.6px] !border-black !bg-transparent"
                            iconSizeOverride="22.4px"
                            borderWidth="1.6px"
                          />
                        </div>
                        {/* Play Button - with hover effect */}
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleStationCardPlay(similarStation);
                          }}
                          className={`flex items-center justify-center w-10 h-10 rounded-full transition-colors duration-300 ${
                            currentStation?._id === similarStation._id && isPlaying 
                              ? 'bg-[#FF4199] hover:bg-[#E63A87]' 
                              : 'bg-[#656565] hover:bg-[#FF4199] group-hover:bg-[#FF4199]'
                          }`}
                        >
                          <span className="sr-only">Play Radio</span>
                          {currentStation?._id === similarStation._id && isPlaying ? (
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="h-[26px] w-[26px] text-white">
                              <path fillRule="evenodd" d="M6.75 5.25a.75.75 0 0 1 .75-.75H9a.75.75 0 0 1 .75.75v13.5a.75.75 0 0 1-.75.75H7.5a.75.75 0 0 1-.75-.75V5.25Zm7.5 0A.75.75 0 0 1 15 4.5h1.5a.75.75 0 0 1 .75.75v13.5a.75.75 0 0 1-.75.75H15a.75.75 0 0 1-.75-.75V5.25Z" clipRule="evenodd"></path>
                            </svg>
                          ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="h-[26px] w-[26px] text-white ml-0.5">
                              <path fillRule="evenodd" d="M4.5 5.653c0-1.427 1.529-2.33 2.779-1.643l11.54 6.347c1.295.712 1.295 2.573 0 3.286L7.28 19.99c-1.25.687-2.779-.217-2.779-1.643V5.653Z" clipRule="evenodd"></path>
                            </svg>
                          )}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Middle Section Ad - Between Similar Radios and More from Country */}
            {advertisements && advertisements.some(ad => ad.position === 'middle_section') && (
              <div className="py-6">
                <Suspense fallback={null}>
                  <AdCarousel 
                    ads={advertisements} 
                    position="middle_section"
                    autoSwitchInterval={8000}
                  />
                </Suspense>
              </div>
            )}

            {/* Ad Section - Mobile Bottom Ad */}
            {advertisements && advertisements.some(ad => ad.position === 'mobile_bottom') && (
              <Suspense fallback={null}>
                <AdCarousel 
                  ads={advertisements} 
                  position="mobile_bottom"
                  autoSwitchInterval={8000}
                />
              </Suspense>
            )}

            {/* More from Country Section - Independent Loading with Skeleton */}
            {(loadingCountry || (filteredCountryStations && filteredCountryStations.length > 0)) && station?.country && (
              <div>
                <div className="py-6">
                  <h3 className="text-xl font-bold">
                    {t('station_more_from_country', 'More from {country}', { country: station.country })}
                  </h3>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4 md:gap-6">
                  {loadingCountry ? (
                    // Skeleton loading - 12 placeholder cards
                    Array.from({ length: 12 }).map((_, idx) => (
                      <div key={`skeleton-country-${idx}`} className="flex items-center rounded-lg bg-[#2F2F2F] p-4 overflow-hidden min-h-[110px]">
                        <Skeleton className="h-[73px] w-[73px] flex-shrink-0 bg-gray-700" style={{ borderRadius: '7.3px' }} />
                        <div className="ml-4 flex-1 space-y-2">
                          <Skeleton className="h-5 w-3/4 bg-gray-700" />
                          <Skeleton className="h-4 w-1/2 bg-gray-700" />
                          <Skeleton className="h-3 w-1/4 bg-gray-700" />
                        </div>
                        <div className="ml-auto flex items-center gap-2">
                          <Skeleton className="h-10 w-10 rounded-full bg-gray-700" />
                          <Skeleton className="h-10 w-10 rounded-full bg-gray-700" />
                        </div>
                      </div>
                    ))
                  ) : filteredCountryStations.map((countryStation: Station) => (
                    <div key={countryStation._id} className="group flex cursor-pointer items-center rounded-lg bg-[#2F2F2F] p-4 overflow-hidden min-h-[110px] transition-colors duration-300 hover:bg-[#383838]">
                      <div className="h-[73px] w-[73px] flex-shrink-0 overflow-hidden rounded-[7.3px]">
                        <StationLogo
                          station={countryStation}
                          size="card"
                          className="!w-[73px] !h-[73px]"
                          alt={`Listen ${countryStation.name} at megaradio`}
                        />
                      </div>
                      <button 
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleStationCardPlay(countryStation);
                        }}
                        className="ml-4 truncate flex-1 text-left rounded p-2"
                      >
                        <div>
                          <h4 className="text-[16px] font-medium text-white truncate" style={{ fontFamily: "'Ubuntu', system-ui, sans-serif", fontWeight: 500 }}>
                            {countryStation.name}
                          </h4>
                          <p className="text-[15px] text-white" style={{ fontFamily: "'Ubuntu', system-ui, sans-serif", fontWeight: 300 }}>
                            <span className="truncate">{countryStation.country && countryStation.country.length > 21 ? countryStation.country.substring(0, 21) + '...' : countryStation.country}</span>
                            {countryStation.state && countryStation.state !== "" && (
                              <span className="font-normal text-gray-400">, {countryStation.state}</span>
                            )}
                          </p>
                          {/* Vote Count */}
                          {countryStation.votes !== undefined && (
                            <div className="flex items-center gap-1 text-xs text-white/70 mt-1" style={{ fontFamily: "'Ubuntu', system-ui, sans-serif" }}>
                              <ThumbsUpIcon className="w-3 h-3" />
                              <span>{formatVoteCount(countryStation.votes || 0)}</span>
                            </div>
                          )}
                        </div>
                      </button>
                      <div className="ml-auto flex items-center gap-2">
                        {/* Favorite Button - Mobile Only - Figma: 40x40, border 1.6px, transparent bg, icon 22.4px */}
                        <div className="md:hidden">
                          <FavoriteButton 
                            stationId={countryStation._id} 
                            className="!w-10 !h-10 !rounded-[32.22px] !border-[1.6px] !border-black !bg-transparent"
                            iconSizeOverride="22.4px"
                            borderWidth="1.6px"
                          />
                        </div>
                        {/* Play Button - with hover effect */}
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleStationCardPlay(countryStation);
                          }}
                          className={`flex items-center justify-center w-10 h-10 rounded-full transition-colors duration-300 ${
                            currentStation?._id === countryStation._id && isPlaying 
                              ? 'bg-[#FF4199] hover:bg-[#E63A87]' 
                              : 'bg-[#656565] hover:bg-[#FF4199] group-hover:bg-[#FF4199]'
                          }`}
                        >
                          <span className="sr-only">Play Radio</span>
                          {currentStation?._id === countryStation._id && isPlaying ? (
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="h-[26px] w-[26px] text-white">
                              <path fillRule="evenodd" d="M6.75 5.25a.75.75 0 0 1 .75-.75H9a.75.75 0 0 1 .75.75v13.5a.75.75 0 0 1-.75.75H7.5a.75.75 0 0 1-.75-.75V5.25Zm7.5 0A.75.75 0 0 1 15 4.5h1.5a.75.75 0 0 1 .75.75v13.5a.75.75 0 0 1-.75.75H15a.75.75 0 0 1-.75-.75V5.25Z" clipRule="evenodd"></path>
                            </svg>
                          ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="h-[26px] w-[26px] text-white ml-0.5">
                              <path fillRule="evenodd" d="M4.5 5.653c0-1.427 1.529-2.33 2.779-1.643l11.54 6.347c1.295.712 1.295 2.573 0 3.286L7.28 19.99c-1.25.687-2.779-.217-2.779-1.643V5.653Z" clipRule="evenodd"></path>
                            </svg>
                          )}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* See More Button - Responsive: min 110px, auto width for long translations */}
                <div className="py-6 flex justify-center">
                  <button
                    onClick={() => {
                      if (showMoreCountryCount === 0) {
                        // First click: expand to 24
                        setShowMoreCountryCount(1);
                      } else {
                        // Second click: go to /radios page with country filter
                        // CRITICAL: Separate path and query string - getLocalizedUrl only translates the path portion
                        const localizedPath = getLocalizedUrl('/radios');
                        setLocation(`${localizedPath}?country=${encodeURIComponent(station.country)}`);
                      }
                    }}
                    className="px-6 py-3 rounded-[25px] bg-white/20 hover:bg-white/30 transition-colors whitespace-nowrap"
                    style={{
                      minWidth: '110px',
                      height: '45px',
                      fontFamily: "'Ubuntu', system-ui, sans-serif",
                      fontWeight: 700,
                      fontSize: '15px',
                      lineHeight: '100%',
                      textAlign: 'center',
                      color: 'white',
                    }}
                    data-testid="button-see-more-country"
                  >
                    {t('see_more', 'See More')}
                  </button>
                </div>
              </div>
            )}


          </div>
        </>
      )}
      
      {!station && (
        <div className="text-2xl text-white flex justify-center items-center pt-10">
          {t('station_not_found', 'Station not found.')}
        </div>
      )}
    </div>
  );
}