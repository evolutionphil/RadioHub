import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { useLocation, Link } from "wouter";
import { Swiper, SwiperSlide } from 'swiper/react';
import { FreeMode, Navigation } from 'swiper/modules';
import 'swiper/css';
import 'swiper/css/free-mode';
import 'swiper/css/navigation';
import StationsGrid from "@/components/ui/stations-grid";
import { useAuth } from "@/hooks/useAuth";
import { useTranslation } from "@/hooks/useTranslation";
import { useGlobalPlayer } from "@/hooks/useGlobalPlayer";
import { useSeoRouting } from "@/hooks/useSeoRouting";
import { Shuffle, ChevronLeft, ChevronRight } from "lucide-react";
import { COUNTRY_TO_LANGUAGE } from "@workspace/seo-shared/seo-config";

// Genre background gradients - same as homepage
const getRandomImage = (index: number) => {
  const images = [
    '/images/genre-bg-grad-1.webp',
    '/images/genre-bg-grad-2.webp', 
    '/images/genre-bg-grad-2.webp',
    '/images/genre-bg-grad-4.webp'
  ];
  const selectedIndex = Math.abs(index) % images.length;
  return `url(${images[selectedIndex]})`;
};

// Helper function to shuffle array and get random items
function getRandomStations(stationsArray: any[], count: number): any[] {
  if (!Array.isArray(stationsArray) || stationsArray.length === 0) return [];
  
  // Shuffle using Fisher-Yates algorithm
  const shuffled = [...stationsArray];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  
  return shuffled.slice(0, count);
}

// Helper to check if station has REAL logo (not fallback mega logo)
function hasRealLogo(station: any): boolean {
  // Check assets.logo.isFallback flag - if false, it's a real logo
  if (station.assets?.logo?.isFallback === false) {
    return true;
  }
  // If isFallback is true, it's a fallback logo
  if (station.assets?.logo?.isFallback === true) {
    return false;
  }
  // Legacy check: if no assets.logo but has favicon that's not our fallback
  if (station.favicon && !station.favicon.includes('mega') && !station.favicon.includes('fallback')) {
    return true;
  }
  return false;
}

// Helper to filter out similar station names (e.g., "Rock Antenne" and "ROCK ANTENNE Classic")
function filterSimilarNames(stations: any[]): any[] {
  const result: any[] = [];
  const usedBaseNames = new Set<string>();
  
  for (const station of stations) {
    // Normalize name: lowercase, remove special chars, take first 2-3 words
    const name = (station.name || '').toLowerCase();
    const words = name.replace(/[^a-z0-9\s]/gi, '').split(/\s+/).filter(Boolean);
    const baseName = words.slice(0, 2).join(' '); // First 2 words as base
    
    if (baseName && !usedBaseNames.has(baseName)) {
      result.push(station);
      usedBaseNames.add(baseName);
    }
  }
  
  return result;
}

// Time-based greeting helper
function getTimeBasedGreeting(): { greeting: string; period: 'morning' | 'afternoon' | 'evening' | 'night'; icon: string } {
  const hour = new Date().getHours();
  
  if (hour >= 5 && hour < 12) {
    return { greeting: 'Good Morning', period: 'morning', icon: '☀️' };
  } else if (hour >= 12 && hour < 17) {
    return { greeting: 'Good Afternoon', period: 'afternoon', icon: '🌤️' };
  } else if (hour >= 17 && hour < 21) {
    return { greeting: 'Good Evening', period: 'evening', icon: '🌅' };
  } else {
    return { greeting: 'Good Night', period: 'night', icon: '🌙' };
  }
}

export default function ProfileDiscover() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const { playStation } = useGlobalPlayer();
  const { getLocalizedUrl } = useSeoRouting();
  const [location] = useLocation();
  const [isShuffling, setIsShuffling] = useState(false);
  
  // Time-based greeting
  const timeInfo = useMemo(() => getTimeBasedGreeting(), []);
  
  // Get user's first name for personalized greeting
  const firstName = user?.fullName?.split(' ')[0] || user?.username || '';
  
  // Extract country code from URL (e.g., /de/profil/entdecken -> "de")
  const countryCode = useMemo(() => {
    const pathSegments = location.split('/').filter(Boolean);
    const firstSegment = pathSegments[0];
    if (firstSegment && firstSegment.length === 2 && COUNTRY_TO_LANGUAGE[firstSegment]) {
      return firstSegment.toUpperCase();
    }
    return null;
  }, [location]);

  // Fetch user's favorites ONCE - memoize the favorite IDs set to prevent constant re-renders
  const { data: favoritesData = [] } = useQuery({
    queryKey: ["/api/user/favorites"],
    enabled: !!user?._id,
    staleTime: 60 * 60 * 1000, // 1 hour - very stable
  });
  
  const favoriteIds = useMemo(() => {
    return new Set(Array.isArray(favoritesData) ? favoritesData.map((s: any) => s._id) : []);
  }, [favoritesData]);

  // Helper to filter out favorited stations
  const filterOutFavorites = useMemo(() => {
    return (stations: any[]) => {
      return (Array.isArray(stations) ? stations : []).filter(s => !favoriteIds.has(s._id));
    };
  }, [favoriteIds]);

  // PERF: this page used to fire FIVE parallel /api/stations/precomputed
  // requests (country×30, country×50, global×30 unused, global×100, global×100)
  // which made first-load very slow. Consolidated to TWO shared queries:
  //   - countryStationsData: one country fetch (limit 50) feeding both
  //     "popular stations" (top 30) and "surprise me" (full 50).
  //   - globalStationsRaw: one global fetch (limit 100) feeding similar +
  //     hybrid random + surprise me.
  // The previously-fetched-but-unused popular-global-fallback was deleted.
  const { data: countryStationsData = [], isLoading: popularLoading } = useQuery({
    queryKey: ["/api/stations/country", countryCode],
    queryFn: async () => {
      if (!countryCode) return [];
      const response = await fetch(`/api/stations/precomputed?countryName=${countryCode}&page=1&limit=50`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch country stations");
      const result = await response.json();
      return result.data || [];
    },
    enabled: !!countryCode,
    staleTime: 7 * 24 * 60 * 60 * 1000,
  });
  const popularStationsData = countryStationsData;
  const localStationsRaw = countryStationsData;
  const localStationsLoading = popularLoading;
  
  const popularStations = useMemo(() => {
    const rawCountry = Array.isArray(popularStationsData) ? popularStationsData : [];
    
    // Step 1: Get country stations with REAL logos (not fallback)
    let pool = filterOutFavorites(rawCountry.filter(hasRealLogo));
    
    // Step 2: Filter out similar names (e.g., "Rock Antenne" and "ROCK ANTENNE Classic")
    pool = filterSimilarNames(pool);
    
    // Step 3: If not enough, add country stations WITHOUT real logos (no global fallback)
    if (pool.length < 6) {
      const countryNoLogo = filterSimilarNames(filterOutFavorites(rawCountry.filter((s: any) => !hasRealLogo(s))));
      const existingIds = new Set(pool.map((s: any) => s._id));
      const additional = countryNoLogo.filter((s: any) => !existingIds.has(s._id));
      pool = [...pool, ...additional];
    }
    
    // NO global fallback - only show selected country's stations
    // Random 6 from pool (so it changes on refresh)
    return getRandomStations(pool, 6);
  }, [popularStationsData, filterOutFavorites]);

  // Fetch genres
  const { data: genresData = [] } = useQuery<any>({
    queryKey: ["/api/genres"],
    staleTime: 30 * 60 * 1000,
  });

  const genres = (Array.isArray(genresData) ? genresData : (genresData as any)?.genres || []).slice(0, 8);
  const genresLoading = !genres || genres.length === 0;

  // Fetch user's listening history. Uses an explicit queryFn so a 404 (which
  // legitimately means "no history yet") returns [] instead of throwing —
  // the previous default queryFn rethrew, putting TanStack Query in a retry
  // loop that flooded the console with hundreds of GET 404 lines on every
  // freshly-logged-in profile load (2026-05-13 Chrome console report).
  const { data: lastPlayedStations = [], isLoading: lastPlayedLoading } = useQuery<any[]>({
    queryKey: ["/api/user/last-played"],
    enabled: !!user?._id,
    staleTime: 30 * 60 * 1000,
    retry: false,
    queryFn: async () => {
      try {
        const res = await fetch("/api/user/last-played", { credentials: "include" });
        if (res.status === 404 || res.status === 401) return [];
        if (!res.ok) return [];
        const json = await res.json();
        return Array.isArray(json) ? json : (json?.stations || []);
      } catch {
        return [];
      }
    },
  });

  // SHARED global query — feeds "Similar stations you like", "Discover Random
  // Stations", and "Surprise Me". Single 100-station fetch instead of three.
  const { data: globalStationsRaw = [], isLoading: globalStationsLoading } = useQuery<any[]>({
    queryKey: ["/api/stations/global-100"],
    queryFn: async () => {
      const response = await fetch("/api/stations/precomputed?countryName=global&page=1&limit=100", {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch stations");
      const result = await response.json();
      return result.data || [];
    },
    staleTime: 7 * 24 * 60 * 60 * 1000,
  });
  const similarLoading = globalStationsLoading;

  const similarStations = useMemo(() => {
    const all = (Array.isArray(globalStationsRaw) ? globalStationsRaw : []).slice(0, 100);
    return filterOutFavorites(all).slice(0, 6);
  }, [globalStationsRaw, filterOutFavorites]);
  
  // Diverse random stations: 6 stations from 6 DIFFERENT countries (no duplicates, REAL logos only)
  const hybridRandomStations = useMemo(() => {
    const allGlobal = Array.isArray(globalStationsRaw) ? globalStationsRaw : [];
    
    // First filter: real logos only, then filter out favorites
    const withRealLogos = filterOutFavorites(allGlobal.filter(hasRealLogo));
    
    // Shuffle the stations
    const shuffled = getRandomStations(withRealLogos, withRealLogos.length);
    
    // Pick stations ensuring each is from a unique country
    const result: any[] = [];
    const usedCountries = new Set<string>();
    
    for (const station of shuffled) {
      const country = station.country || station.countrycode || 'Unknown';
      if (!usedCountries.has(country) && result.length < 6) {
        result.push(station);
        usedCountries.add(country);
      }
      if (result.length >= 6) break;
    }
    
    return result;
  }, [globalStationsRaw, filterOutFavorites]);
  
  const randomStationsLoading = localStationsLoading || globalStationsLoading;

  // Surprise Me - play a random station (prefer local, fallback to global)
  const handleSurpriseMe = async () => {
    const allStations = [...(localStationsRaw || []), ...(globalStationsRaw || [])];
    if (allStations.length === 0) return;
    
    setIsShuffling(true);
    
    // Small delay for animation effect
    await new Promise(resolve => setTimeout(resolve, 300));
    
    const filtered = filterOutFavorites(allStations);
    const randomIndex = Math.floor(Math.random() * filtered.length);
    const randomStation = filtered[randomIndex];
    
    if (randomStation) {
      playStation(randomStation, filtered);
    }
    
    setIsShuffling(false);
  };

  return (
    <div>
      {/* COMPACT GREETING + SURPRISE ME - Mega Style (TOP) */}
      <section className="mb-[16px]">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-lg shrink-0">{timeInfo.icon}</span>
            <h2 className="text-[18px] sm:text-[20px] font-semibold text-white truncate">
              {t(`greeting_${timeInfo.period}`, timeInfo.greeting)}
              {firstName && <span className="text-[#FF4199]">, {firstName}</span>}
            </h2>
          </div>
          
          <button
            onClick={handleSurpriseMe}
            disabled={isShuffling || (globalStationsRaw.length === 0 && localStationsRaw.length === 0)}
            className={`
              flex items-center gap-1.5
              px-3 py-1.5 sm:px-4 sm:py-2
              rounded-[8px] font-medium text-white text-[13px] sm:text-[14px]
              bg-[#FF4199] hover:bg-[#FF097B]
              transition-colors duration-200
              disabled:opacity-50 disabled:cursor-not-allowed
              shrink-0
              ${isShuffling ? 'animate-pulse' : ''}
            `}
            data-testid="button-surprise-me"
          >
            <Shuffle className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${isShuffling ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">{t('surprise_me', 'Surprise Me')}</span>
            <span className="sm:hidden">{t('surprise', 'Surprise')}</span>
          </button>
        </div>
      </section>

      {/* GENRES SLIDER - Gradient boxes like homepage */}
      {genres.length > 0 && (
        <section className="mb-[30px]">
          <div className="flex justify-between items-center pb-4">
            <h3 className="text-[22px] font-bold text-white">{t('homepage_genres', 'Genres')}</h3>
            <div className="hidden md:flex items-center gap-3">
              <Link className="text-[#FF4199] text-sm font-medium hover:underline" href={getLocalizedUrl('/genres')}>
                {t('homepage_see_all', 'See all')}
              </Link>
              <div className="flex items-center gap-2">
                <button 
                  className="discover-genres-prev w-8 h-8 flex items-center justify-center rounded-full bg-[#2A2A2A] hover:bg-[#3A3A3A] transition-colors"
                  aria-label="Previous genres"
                  data-testid="button-discover-genres-prev"
                >
                  <ChevronLeft className="w-5 h-5 text-[#FF4199] stroke-[3]" />
                </button>
                <button 
                  className="discover-genres-next w-8 h-8 flex items-center justify-center rounded-full bg-[#2A2A2A] hover:bg-[#3A3A3A] transition-colors"
                  aria-label="Next genres"
                  data-testid="button-discover-genres-next"
                >
                  <ChevronRight className="w-5 h-5 text-[#FF4199] stroke-[3]" />
                </button>
              </div>
            </div>
          </div>
          
          <div className="min-h-[58px] md:min-h-[87px]">
            <Swiper
              modules={[FreeMode, Navigation]}
              freeMode={true}
              loop={true}
              spaceBetween={10}
              navigation={{
                prevEl: '.discover-genres-prev',
                nextEl: '.discover-genres-next',
              }}
              breakpoints={{
                320: { slidesPerView: 'auto' as any, spaceBetween: 8 },
                480: { slidesPerView: 'auto' as any, spaceBetween: 8 },
                768: { slidesPerView: 'auto' as any, spaceBetween: 20 },
                1200: { slidesPerView: 'auto' as any, spaceBetween: 20 },
              }}
              className="flex gap-2"
            >
              {genres.map((genre: any, index: number) => (
                <SwiperSlide
                  key={`genre-${genre._id}-${index}`}
                  className="genre-slide cursor-pointer select-none genre-bg-full dynamic-bg-image rounded-[5px] md:rounded-[10px] !w-[170px] !h-[58px] md:!w-[280px] md:!h-[87px]"
                  style={{ '--bg-image': getRandomImage(index) } as React.CSSProperties}
                >
                  <Link 
                    href={getLocalizedUrl(`/genres/${genre.slug || genre.name.toLowerCase()}`)} 
                    className="w-full h-full flex items-center justify-center rounded-[5px] md:rounded-[10px]"
                  >
                    <h4 className="px-2 text-sm md:text-xl font-bold capitalize text-center text-white drop-shadow-lg">
                      {genre.name}
                    </h4>
                  </Link>
                </SwiperSlide>
              ))}
            </Swiper>
          </div>
        </section>
      )}

      {/* DISCOVER RANDOM STATIONS - 6 stations: 3 top + 3 bottom */}
      {hybridRandomStations.length > 0 && (
        <section className="mb-[30px]">
          <h3 className="text-[22px] font-bold text-white pb-[24px]">
            {t('discover_random', 'Discover Random Stations')}
          </h3>
          <StationsGrid 
            stations={hybridRandomStations.slice(0, 6)} 
            playlistName="randomStations"
            loading={randomStationsLoading}
            showVotes={true}
          />
        </section>
      )}

      {/* POPULAR STATIONS - from selected country, random 6 from top 30 */}
      <section className="mb-[30px]">
        <h3 className="text-[22px] font-bold text-white pb-[24px]">
          {t('popular_stations', 'Popular Stations')}
        </h3>
        <StationsGrid 
          stations={popularStations} 
          playlistName="popularStations" 
          loading={popularLoading}
          showVotes={true}
        />
      </section>

      {/* RECENTLY PLAYED */}
      {user && lastPlayedStations.length > 0 && (
        <section className="mb-[30px]">
          <h3 className="text-[22px] font-bold text-white pb-[24px]">
            {t('recently_played', 'Recently Played')}
          </h3>
          <StationsGrid 
            stations={lastPlayedStations} 
            playlistName="lastPlayedStations"
            loading={lastPlayedLoading}
          />
        </section>
      )}

      {/* SIMILAR STATIONS YOU LIKE */}
      {similarStations.length > 0 && (
        <section className="mb-[30px]">
          <h3 className="text-[22px] font-bold text-white pb-[24px]">
            {t('similar_stations_you_like', 'Similar Stations You Like')}
          </h3>
          <StationsGrid 
            stations={similarStations} 
            playlistName="similarStations"
            loading={similarLoading}
          />
        </section>
      )}
    </div>
  );
}