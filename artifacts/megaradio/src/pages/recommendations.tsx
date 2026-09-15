import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { stationQueryFreshness } from '@/lib/station-query-policy';
import { Link } from "wouter";
import StationCard from "@/components/ui/station-card";
import { useGlobalPlayer } from "@/hooks/useGlobalPlayer";
import { useTranslation } from "@/hooks/useTranslation";
import { useSeoRouting } from "@/hooks/useSeoRouting";
import { useMLRecommendations } from "@/hooks/useMLRecommendations";
import { fetchRecommendationPool, MOOD_GENRES, recommendationCountry, recommendationGenres, recommendationPoolKey, recommendationSections, rotateRecommendations } from '@/lib/recommendation-pool';

export default function RecommendationsPage({
  selectedCountry = "all",
}: {
  selectedCountry?: string;
  onCountryChange?: (country: string) => void;
}) {
  const { t } = useTranslation();
  const { getLocalizedUrl } = useSeoRouting();
  const { playStation, stopStation } = useGlobalPlayer();
  const [selectedMood, setSelectedMood] = useState('');
  const [visitSeed] = useState(() => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`);
  const { userProfile } = useMLRecommendations({ recommendations: false });
  const country = recommendationCountry(selectedCountry);
  const preferredGenres = recommendationGenres(userProfile?.preferredGenres?.slice(0, 3).map(item => item.genre) || []);
  const moodGenres = MOOD_GENRES[selectedMood] || [];
  const getMoodGenres = (mood: string) => MOOD_GENRES[mood] || [];

  useEffect(() => { window.scrollTo({ top: 0, behavior: 'smooth' }); }, []);

  // Seeds never reach the origin/cache key. One bounded country pool serves
  // both trending and discovery; only a chosen mood/known taste adds a pool.
  const baseQuery = useQuery<any[]>({
    queryKey: recommendationPoolKey(country),
    queryFn: ({ signal }) => fetchRecommendationPool(country, [], signal),
    ...stationQueryFreshness,
    enabled: !selectedMood,
    placeholderData: undefined,
  });
  const preferenceQuery = useQuery<any[]>({
    queryKey: recommendationPoolKey(country, preferredGenres),
    queryFn: ({ signal }) => fetchRecommendationPool(country, preferredGenres, signal),
    ...stationQueryFreshness,
    enabled: !selectedMood && preferredGenres.length > 0,
    placeholderData: undefined,
  });
  const moodQuery = useQuery<any[]>({
    queryKey: recommendationPoolKey(country, moodGenres),
    queryFn: ({ signal }) => fetchRecommendationPool(country, moodGenres, signal),
    ...stationQueryFreshness,
    enabled: !!selectedMood,
    placeholderData: undefined,
  });
  const sections = useMemo(() => recommendationSections(
    baseQuery.data || [], preferenceQuery.data || [], `${visitSeed}:${country}`, preferredGenres.length > 0,
  ), [baseQuery.data, preferenceQuery.data, visitSeed, country, preferredGenres.length]);
  const personalizedStations = sections.personalized;
  const filteredTrendingStations = sections.trending;
  const filteredDiscoveryStations = sections.discovery;
  const filteredMoodStations = useMemo(() => selectedMood
    ? rotateRecommendations(moodQuery.data || [], `${visitSeed}:${country}:${selectedMood}`).slice(0, 21)
    : sections.genres,
  [selectedMood, moodQuery.data, visitSeed, country, sections.genres]);
  const loading = selectedMood ? moodQuery.isLoading : baseQuery.isLoading;
  const failed = selectedMood ? moodQuery.isError : baseQuery.isError;
  const handlePlay = async (station: any) => { await playStation(station); };
  const handleStop = () => { stopStation(); };
  
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
          <h1 className="text-3xl font-bold">{t('nav_for_you', 'For You')}</h1>
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
          
          <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1 overscroll-x-contain" role="group" aria-label={t('mood_selector', 'How are you feeling?')}>
            {[{ value: '', label: t('mood_all', 'All Moods'), icon: '🎵' }, ...moods].map(mood => (
              <button
                key={mood.value}
                type="button"
                onClick={() => setSelectedMood(mood.value)}
                aria-pressed={selectedMood === mood.value}
                className={`shrink-0 min-h-11 px-4 py-3 rounded-full text-sm font-medium transition-colors whitespace-nowrap flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF4199] focus-visible:ring-offset-2 focus-visible:ring-offset-[#111] ${selectedMood === mood.value ? 'bg-[#FF4199] text-white' : 'bg-[#292929] text-white hover:bg-[#3a3a3a]'}`}
              >
                <span aria-hidden="true">{mood.icon}</span>{mood.label}
              </button>
            ))}
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
            <div className="flex items-start justify-between gap-3 pb-4">
              <h2 className="text-xl font-bold md:text-2xl text-white">
                {t('personalized_for_you')}
              </h2>
              <Link className="shrink-0 pt-1 font-semibold text-[#FF4199] text-sm md:text-base" href={getLocalizedUrl('/radios')}>
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
            <div className="flex items-start justify-between gap-3 pb-4">
              <h2 className="text-xl font-bold md:text-2xl">
                {t('trending_now')}
              </h2>
              <Link className="shrink-0 pt-1 font-semibold text-[#FF4199] text-sm md:text-base" href={getLocalizedUrl('/radios?sort=trending')}>
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
            <div className="flex items-start justify-between gap-3 pb-4">
              <h2 className="text-xl font-bold md:text-2xl">
                {t('discover_new', 'Discover New Stations')}
              </h2>
              <Link className="shrink-0 pt-1 font-semibold text-[#FF4199] text-sm md:text-base" href={getLocalizedUrl('/radios?sort=newest')}>
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
            <div className="flex items-start justify-between gap-3 pb-4">
              <h2 className="text-xl font-bold md:text-2xl">
                {selectedMood 
                  ? `${t(`mood_${selectedMood}`, selectedMood.charAt(0).toUpperCase() + selectedMood.slice(1))} ${t('stations', 'Stations')}`
                  : t('based_on_genres', 'Based on Your Favorite Genres')
                }
              </h2>
              <Link 
                className="shrink-0 pt-1 font-semibold text-[#FF4199] text-sm md:text-base"
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

        {loading && <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4" role="status" aria-label={t('loading', 'Loading')}>
          {Array.from({ length: 6 }, (_, index) => <div key={index} className="h-28 rounded-2xl bg-[#292929] motion-safe:animate-pulse" />)}
        </div>}
        {failed && <div className="text-center py-8" role="alert">
          <p className="text-white/70 mb-4">{t('error_loading_stations', 'Unable to load stations. Please try again.')}</p>
          <button type="button" className="rounded-full bg-[#FF4199] px-5 py-3 font-medium" onClick={() => selectedMood ? moodQuery.refetch() : baseQuery.refetch()}>{t('retry', 'Try again')}</button>
        </div>}
        {/* A genuine empty country/mood never falls back to unrelated stations. */}
        {!loading && !failed && (!selectedMood ? (personalizedStations.length === 0 && filteredTrendingStations.length === 0 && filteredDiscoveryStations.length === 0) : true) && filteredMoodStations.length === 0 && (
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
