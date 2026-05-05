import { useState, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import StationCard from "@/components/ui/station-card";
import { useGlobalPlayer } from "@/hooks/useGlobalPlayer";
import { useTranslation } from "@/hooks/useTranslation";
import { useSeoRouting } from "@/hooks/useSeoRouting";
import { useMLRecommendations } from "@/hooks/useMLRecommendations";
import { Swiper, SwiperSlide } from 'swiper/react';
import { FreeMode } from 'swiper/modules';
import 'swiper/css';
import 'swiper/css/free-mode';

interface RecommendedStation {
  _id: string;
  name: string;
  url: string;
  country: string;
  genre: string;
  tags: string[];
  votes: number;
  clickCount: number;
  codec: string;
  bitrate: number;
  favicon?: string;
  homepage?: string;
  language: string;
  slug: string;
  recommendationType?: string;
  confidence?: number;
  reason?: string;
}

export default function RecommendationsPage({ 
  selectedCountry = "all", 
  onCountryChange 
}: { 
  selectedCountry?: string; 
  onCountryChange?: (country: string) => void; 
}) {
  const { t } = useTranslation();
  const { getLocalizedUrl } = useSeoRouting();
  const { playStation, currentStation, isPlaying, stopStation } = useGlobalPlayer();
  const [selectedMood, setSelectedMood] = useState<string>('');
  // ML Recommendations Hook
  const { userProfile, profileLoading } = useMLRecommendations();
  
  // Pre-loaded mood stations cache - FORCE RELOAD with tags parameter
  const [moodStationsCache, setMoodStationsCache] = useState<{ [key: string]: any[] }>({});
  
  // Helper function to get mood-based genres - MUST be defined before useEffect that uses it
  const getMoodGenres = (mood: string): string[] => {
    const moodGenreMap: { [key: string]: string[] } = {
      'energetic': ['rock', 'classic rock', 'hard rock'], // Rock-focused for energetic
      'party': ['dance', 'pop', 'hits', 'disco'], // Party-specific genres
      'relaxed': ['country', 'adult contemporary', 'soft rock'], // Relaxed-specific genres  
      'chill': ['jazz', 'ambient', 'new age', 'world music'], // Chill-specific genres
      'focused': ['classical', 'instrumental', 'meditation'], // Focus-specific genres
      'nostalgic': ['oldies', 'classic hits', '80s', '90s'] // Retro-specific genres
    };
    return moodGenreMap[mood] || [];
  };
  
  // Auto-scroll to top when entering the page
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // Preload all mood-based stations from 7-day precomputed cache (single API call)
  useEffect(() => {
    setMoodStationsCache({});
    const preloadMoodStations = async () => {
      try {
        // Single API call to get all global stations from 7-day cache
        const response = await fetch('/api/stations/precomputed?countryName=global&page=1&limit=500');
        if (!response.ok) throw new Error('Failed to fetch precomputed stations');
        const result = await response.json();
        const allStations = result.data || [];
        
        const moods = ['energetic', 'relaxed', 'focused', 'nostalgic', 'party', 'chill'];
        const cache: { [key: string]: any[] } = {};
        const globalUsedIds = new Set<string>();
        
        for (const mood of moods) {
          const moodGenres = getMoodGenres(mood);
          
          // Filter stations by mood genres (client-side filtering from cached data)
          const moodStations = allStations.filter((station: any) => {
            if (globalUsedIds.has(station._id)) return false;
            const tags = (station.tags || '').toLowerCase();
            return moodGenres.some(genre => tags.includes(genre.toLowerCase()));
          });
          
          // Sort by votes and take top 30
          moodStations.sort((a: any, b: any) => (b.votes || 0) - (a.votes || 0));
          const uniqueStations = moodStations.slice(0, 30);
          
          uniqueStations.forEach((station: any) => globalUsedIds.add(station._id));
          cache[mood] = uniqueStations;
        }
        
        setMoodStationsCache(cache);
      } catch (error) {
        console.warn('Failed to preload mood stations from cache:', error);
      }
    };
    
    preloadMoodStations();
  }, [selectedCountry]);

  // Handler functions for station play/stop
  const handlePlay = async (station: any, playlistName: string) => {
    await playStation(station);
  };

  const handleStop = () => {
    stopStation();
  };

  // Fetch ML-powered personalized recommendations (PRIORITY 1 - Most specific)
  const { data: personalizedStations = [] } = useQuery({
    queryKey: ['/api/ml/recommendations', userProfile?.totalStationsListened, selectedCountry, selectedMood],
    queryFn: async () => {
      if (userProfile?.totalStationsListened) {
        // Get ML recommendations if available - use totalStationsListened as session identifier
        const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const response = await fetch(`/api/ml/recommendations/${sessionId}?limit=12`);
        if (response.ok) {
          const data = await response.json();
          if (data && data.length > 0) {
            return data;
          }
        }
      }
      
      // Enhanced fallback using diverse recommendations endpoint
      const userGenres = userProfile?.preferredGenres?.map((g: any) => g.genre).join(',') || 'pop,rock,electronic';
      const params = new URLSearchParams({
        country: selectedCountry,
        userGenres,
        limit: '12'
      });
      
      const fallbackResponse = await fetch(`/api/recommendations/diverse?${params}`);
      if (fallbackResponse.ok) {
        const fallbackData = await fallbackResponse.json();
        return fallbackData.stations || [];
      }
      
      // Final fallback to precomputed cache (high-quality stations)
      const countryParam = selectedCountry === 'all' ? 'global' : selectedCountry;
      const response = await fetch(`/api/stations/precomputed?countryName=${countryParam}&page=1&limit=12`);
      if (!response.ok) throw new Error(t('error_fetch_personalized_stations', 'Failed to fetch personalized stations'));
      const result = await response.json();
      return result.data || [];
    },
    enabled: true
  });

  // Fetch trending stations from 7-day cache (client-side mood filtering)
  const { data: trendingStations = [] } = useQuery({
    queryKey: ['/api/stations/trending', selectedCountry, selectedMood],
    queryFn: async () => {
      const countryParam = selectedCountry === 'all' ? 'global' : selectedCountry;
      const response = await fetch(`/api/stations/precomputed?countryName=${countryParam}&page=1&limit=50`);
      if (!response.ok) throw new Error('Failed to fetch trending stations');
      const result = await response.json();
      let stations = result.data || [];
      
      // Client-side mood filtering
      if (selectedMood) {
        const moodGenres = getMoodGenres(selectedMood);
        stations = stations.filter((s: any) => {
          const tags = (s.tags || '').toLowerCase();
          return moodGenres.slice(0, 2).some(genre => tags.includes(genre.toLowerCase()));
        });
      }
      
      return stations.slice(0, 12);
    },
    staleTime: 7 * 24 * 60 * 60 * 1000,
  });

  // Fetch discovery stations from 7-day cache (shuffled for variety)
  const { data: discoveryStations = [] } = useQuery({
    queryKey: ['/api/stations/discovery', selectedCountry, selectedMood],
    queryFn: async () => {
      const countryParam = selectedCountry === 'all' ? 'global' : selectedCountry;
      const response = await fetch(`/api/stations/precomputed?countryName=${countryParam}&page=1&limit=100`);
      if (!response.ok) throw new Error('Failed to fetch discovery stations');
      const result = await response.json();
      let stations = result.data || [];
      
      // Client-side mood filtering
      if (selectedMood) {
        const moodGenres = getMoodGenres(selectedMood);
        stations = stations.filter((s: any) => {
          const tags = (s.tags || '').toLowerCase();
          return moodGenres.slice(-2).some(genre => tags.includes(genre.toLowerCase()));
        });
      }
      
      // Shuffle for variety
      const shuffled = [...stations].sort(() => Math.random() - 0.5);
      return shuffled.slice(0, 12);
    },
    staleTime: 7 * 24 * 60 * 60 * 1000,
  });

  // Default stations from 7-day cache (top by votes)
  const { data: defaultStations = [] } = useQuery({
    queryKey: ['/api/stations/default-recommendations', selectedCountry],
    queryFn: async () => {
      const countryParam = selectedCountry === 'all' ? 'global' : selectedCountry;
      const response = await fetch(`/api/stations/precomputed?countryName=${countryParam}&page=1&limit=12`);
      if (!response.ok) throw new Error('Failed to fetch default stations');
      const result = await response.json();
      return result.data || [];
    },
    enabled: !selectedMood,
    staleTime: 7 * 24 * 60 * 60 * 1000,
  });

  // Get stations based on selected mood or default
  const currentMoodStations = selectedMood 
    ? (moodStationsCache[selectedMood] || [])
    : defaultStations;
    
  // Different filtering logic for mood-specific vs all-moods view
  let filteredTrendingStations = trendingStations;
  let filteredDiscoveryStations = discoveryStations;
  let filteredMoodStations = currentMoodStations;
  
  if (selectedMood) {
    // When a specific mood is selected, don't filter mood stations at all (trending/discovery are hidden anyway)
    filteredMoodStations = currentMoodStations;
  } else {
    // When "All Moods" is selected, ensure sections show distinct stations
    const usedStationIds = new Set<string>();
    
    // Add personalized stations to used IDs
    personalizedStations.forEach((station: any) => usedStationIds.add(station._id));
    
    // Filter trending stations to exclude personalized ones
    filteredTrendingStations = trendingStations.filter((station: any) => {
      if (usedStationIds.has(station._id)) return false;
      usedStationIds.add(station._id);
      return true;
    });
    
    // Filter discovery stations to exclude already used ones
    filteredDiscoveryStations = discoveryStations.filter((station: any) => {
      if (usedStationIds.has(station._id)) return false;
      usedStationIds.add(station._id);
      return true;
    });
    
    // Filter mood/default stations to exclude already used ones
    filteredMoodStations = currentMoodStations.filter((station: any) => {
      if (usedStationIds.has(station._id)) return false;
      usedStationIds.add(station._id);
      return true;
    });
  }
  
  // Mood options - EXACT from original design
  const moods = [
    { value: 'energetic', label: t('mood_energetic', 'Energetic'), icon: '⚡' },
    { value: 'relaxed', label: t('mood_relaxed', 'Relaxed'), icon: '😌' },
    { value: 'focused', label: t('mood_focused', 'Focused'), icon: '🎯' },
    { value: 'nostalgic', label: t('mood_nostalgic', 'Nostalgic'), icon: '🕰️' },
    { value: 'party', label: t('mood_party', 'Party'), icon: '🎉' },
    { value: 'chill', label: t('mood_chill', 'Chill'), icon: '🌊' }
  ];

  return (
    <div>
      {/* Header - EXACT from original */}
      <div className="bg-[#151515] py-7">
        <div className="container mx-auto text-white">
          <h1 className="text-3xl font-bold">For You</h1>
          <p className="text-[#838383] text-base mt-2">
            {t('for_you_subtitle', 'Personalized stations based on your taste')}
          </p>
        </div>
      </div>

      <div className="container m-auto pb-10 pt-5 text-white">
        {/* Mood Selector - EXACT original design */}
        <div className="mb-8">
          <div className="mb-4">
            <h2 className="text-xl font-bold mb-2">{t('mood_selector', 'How are you feeling?')}</h2>
            <p className="text-[#838383] text-sm">{t('mood_description', 'Select your mood to get better recommendations')}</p>
          </div>
          
          {/* Horizontal scrolling mood selector */}
          <div className="relative overflow-hidden">
            <Swiper
              modules={[FreeMode]}
              spaceBetween={12}
              slidesPerView="auto"
              freeMode={true}
              grabCursor={true}
              className="mood-slider w-full"
            >
              {/* All moods option */}
              <SwiperSlide className="!w-auto !flex-shrink-0">
                <button
                  onClick={() => setSelectedMood('')}
                  className={`px-4 py-3 rounded-full text-sm font-medium transition-colors whitespace-nowrap flex items-center gap-2 ${
                    selectedMood === ''
                      ? 'bg-[#FF4199] text-white'
                      : 'bg-[#292929] text-white hover:bg-[#3a3a3a]'
                  }`}
                >
                  🎵 {t('mood_all', 'All Moods')}
                </button>
              </SwiperSlide>
              
              {moods.map((mood) => (
                <SwiperSlide key={mood.value} className="!w-auto !flex-shrink-0">
                  <button
                    onClick={() => setSelectedMood(mood.value)}
                    className={`px-4 py-3 rounded-full text-sm font-medium transition-colors whitespace-nowrap flex items-center gap-2 ${
                      selectedMood === mood.value
                        ? 'bg-[#FF4199] text-white'
                        : 'bg-[#292929] text-white hover:bg-[#3a3a3a]'
                    }`}
                  >
                    <span>{mood.icon}</span>
                    {mood.label}
                  </button>
                </SwiperSlide>
              ))}
            </Swiper>
          </div>
        </div>

        {/* Your Music Profile Section - Only show when no mood is selected */}
        {!selectedMood && (userProfile && userProfile.profileStrength > 0) && (
          <div className="mb-10">
            <div className="mb-4">
              <h2 className="text-xl font-bold mb-2">{t('your_music_profile', 'Your Music Profile')}</h2>
              <p className="text-[#838383] text-sm">{t('profile_description', 'Based on your listening history')}</p>
            </div>
            
            {/* Profile Stats Card - White background like original */}
            <div className="bg-white dark:bg-white rounded-lg p-6 shadow-lg">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                {/* Average Listen Time */}
                <div className="flex flex-col">
                  <div className="text-2xl font-bold text-[#FF4199] mb-1">
                    {userProfile.averageListenDuration && userProfile.averageListenDuration > 0 
                      ? `${Math.floor(userProfile.averageListenDuration / 60)}m ${userProfile.averageListenDuration % 60}s`
                      : '0m'
                    }
                  </div>
                  <div className="text-sm text-gray-600 font-medium">
                    {t('avg_listen_time', 'Average Listen Time')}
                  </div>
                </div>
                
                {/* Stations Played */}
                <div className="flex flex-col">
                  <div className="text-2xl font-bold text-[#FF4199] mb-1">
                    {userProfile.uniqueStationsCount || 0}
                  </div>
                  <div className="text-sm text-gray-600 font-medium">
                    {t('stations_played', 'Stations Played')}
                  </div>
                </div>
                
                {/* Profile Strength */}
                <div className="flex flex-col">
                  <div className="text-2xl font-bold text-[#FF4199] mb-1">
                    {Math.round((userProfile.profileStrength || 0) * 100)}%
                  </div>
                  <div className="text-sm text-gray-600 font-medium">
                    {t('profile_strength', 'Profile Strength')}
                  </div>
                </div>
                
                {/* Total Sessions */}
                <div className="flex flex-col">
                  <div className="text-2xl font-bold text-[#FF4199] mb-1">
                    {userProfile.totalStationsListened || 0}
                  </div>
                  <div className="text-sm text-gray-600 font-medium">
                    {t('total_sessions', 'Total Sessions')}
                  </div>
                </div>
              </div>
              
              {/* Preferred Genres */}
              {userProfile.preferredGenres && userProfile.preferredGenres.length > 0 && (
                <div className="mt-6 pt-4 border-t border-gray-200">
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">
                    {t('preferred_genres', 'Your Preferred Genres')}
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {userProfile.preferredGenres.slice(0, 3).map((genreData: any, index: number) => (
                      <span 
                        key={index}
                        className="px-3 py-1 bg-[#FF4199] text-white text-xs rounded-full font-medium"
                      >
                        {genreData.genre} ({Math.round(genreData.weight * 100)}%)
                      </span>
                    ))}
                  </div>
                </div>
              )}
              
              {/* Preferred Countries */}
              {userProfile.preferredCountries && userProfile.preferredCountries.length > 0 && (
                <div className="mt-4">
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">
                    {t('preferred_countries')}
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {userProfile.preferredCountries.slice(0, 2).map((countryData: any, index: number) => (
                      <span 
                        key={index}
                        className="px-3 py-1 bg-gray-100 text-gray-700 text-xs rounded-full font-medium"
                      >
                        {countryData.country} ({Math.round(countryData.weight * 100)}%)
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Personalized Recommendations Section - Only show when no mood is selected */}
        {!selectedMood && personalizedStations.length > 0 && (
          <div className="mb-10">
            <div className="flex justify-between pb-4">
              <h2 className="text-xl font-bold md:text-2xl text-white">
                {t('personalized_for_you')}
              </h2>
              <Link className="font-bold text-[#FF4199] text-xl md:text-2xl" href={getLocalizedUrl('/radios')}>
                {t('homepage_see_all')}
              </Link>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4 md:gap-6">
              {personalizedStations.slice(0, 6).map((station: any) => (
                <StationCard
                  key={station._id}
                  station={station}
                  onPlay={handlePlay}
                  onStop={handleStop}
                  playlistName="personalizedRecommendations"
                />
              ))}
            </div>
          </div>
        )}

        {/* Trending Now Section - Only show when no mood is selected */}
        {!selectedMood && filteredTrendingStations.length > 0 && (
          <div className="mb-10">
            <div className="flex justify-between pb-4">
              <h2 className="text-xl font-bold md:text-2xl">
                {t('trending_now')}
              </h2>
              <Link className="font-bold text-[#FF4199] text-xl md:text-2xl" href="/radios?sort=trending">
                {t('homepage_see_all')}
              </Link>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4 md:gap-6">
              {filteredTrendingStations.slice(0, 6).map((station: any) => (
                <StationCard
                  key={station._id}
                  station={station}
                  onPlay={handlePlay}
                  onStop={handleStop}
                  playlistName="trendingStations"
                />
              ))}
            </div>
          </div>
        )}

        {/* Discovery Section - Only show when no mood is selected */}
        {!selectedMood && filteredDiscoveryStations.length > 0 && (
          <div className="mb-10">
            <div className="flex justify-between pb-4">
              <h2 className="text-xl font-bold md:text-2xl">
                {t('discover_new', 'Discover New Stations')}
              </h2>
              <Link className="font-bold text-[#FF4199] text-xl md:text-2xl" href="/radios?sort=newest">
                {t('homepage_see_all')}
              </Link>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4 md:gap-6">
              {filteredDiscoveryStations.slice(0, 6).map((station: any) => (
                <StationCard
                  key={station._id}
                  station={station}
                  onPlay={handlePlay}
                  onStop={handleStop}
                  playlistName="discoveryStations"
                />
              ))}
            </div>
          </div>
        )}

        {/* Mood-Based or Default Recommendations Section - EXACT original layout */}
        {filteredMoodStations.length > 0 && (
          <div className="mb-10">
            <div className="flex justify-between pb-4">
              <h2 className="text-xl font-bold md:text-2xl">
                {selectedMood 
                  ? `${t(`mood_${selectedMood}`, selectedMood.charAt(0).toUpperCase() + selectedMood.slice(1))} ${t('stations', 'Stations')}`
                  : t('based_on_genres', 'Based on Your Favorite Genres')
                }
              </h2>
              <Link 
                className="font-bold text-[#FF4199] text-xl md:text-2xl" 
                href={selectedMood 
                  ? getLocalizedUrl(`/genres/${getMoodGenres(selectedMood)[0]?.replace(/\s+/g, '-').toLowerCase()}`)
                  : getLocalizedUrl('/genres')
                }
              >
                {t('homepage_see_all')}
              </Link>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4 md:gap-6">
              {filteredMoodStations.slice(0, selectedMood ? 21 : 6).map((station: any) => (
                <StationCard
                  key={station._id}
                  station={station}
                  onPlay={handlePlay}
                  onStop={handleStop}
                  playlistName={selectedMood ? `${selectedMood}MoodStations` : "defaultRecommendations"}
                />
              ))}
            </div>
          </div>
        )}

        {/* Empty State - EXACT original styling */}
        {personalizedStations.length === 0 && (!selectedMood ? (filteredTrendingStations.length === 0 && filteredDiscoveryStations.length === 0) : true) && filteredMoodStations.length === 0 && (
          <div className="text-center py-16">
            <div className="mb-6">
              <div className="w-24 h-24 bg-[#2F2F2F] rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-12 h-12 text-[#FF4199]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19V6l6 6 6-6v13a1 1 0 01-1 1H10a1 1 0 01-1-1z" />
                </svg>
              </div>
              <h3 className="text-xl font-bold mb-2">
                {t('no_recommendations', 'No Recommendations Yet')}
              </h3>
              <p className="text-[#838383] text-base mb-6">
                {t('no_recommendations_desc', 'Start listening to stations to get personalized recommendations')}
              </p>
              <Link 
                href={getLocalizedUrl('/radios')} 
                className="inline-flex items-center px-6 py-3 bg-[#FF4199] text-white font-medium rounded-full hover:bg-[#e63d8a] transition-colors"
              >
                {t('browse_stations', 'Browse All Stations')}
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}