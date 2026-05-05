import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import StationCard from '@/components/ui/station-card';
import { TrendingUp, Heart, Star, Users, Globe, Clock, Flame, Award } from 'lucide-react';
import { motion } from 'framer-motion';
import { useState } from 'react';
import { useGlobalPlayer } from '@/hooks/useGlobalPlayer';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';

interface TrendingStation {
  stationId: string;
  totalFavorites: number;
  averageRating: number;
  trendingScore: number;
  weeklyFavorites: number;
  station: {
    name: string;
    country: string;
    genre: string;
    favicon: string;
    slug: string;
    votes: number;
    url?: string;
    urlResolved?: string;
  };
}

interface CommunityFavorite {
  stationId: string;
  totalFavorites: number;
  averageRating: number;
  totalRatings: number;
  trendingScore: number;
  station: {
    name: string;
    country: string;
    tags: string;
    favicon: string;
    slug: string;
    votes: number;
    url?: string;
    urlResolved?: string;
  };
}

export default function TrendingStations() {
  const [, setLocation] = useLocation();
  const [selectedCountry, setSelectedCountry] = useState<string>('global');
  const [selectedGenre, setSelectedGenre] = useState<string>('all');
  const { playStation } = useGlobalPlayer();
  const { isAuthenticated } = useAuth();
  const { t } = useTranslation();

  // Get trending stations
  const { data: trendingData, isLoading: trendingLoading } = useQuery<{
    trending: TrendingStation[];
    meta: { count: number; country: string; generatedAt: string };
  }>({
    queryKey: [`/api/user-engagement/trending`, { country: selectedCountry !== 'global' ? selectedCountry : undefined }],
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Get community favorites
  const { data: communityData, isLoading: communityLoading } = useQuery<{
    favorites: CommunityFavorite[];
    meta: { count: number; filters: any; generatedAt: string };
  }>({
    queryKey: [`/api/user-engagement/community/favorites`, { 
      country: selectedCountry !== 'global' ? selectedCountry : undefined,
      genre: selectedGenre !== 'all' ? selectedGenre : undefined 
    }],
    staleTime: 10 * 60 * 1000, // 10 minutes
  });

  // Get all countries from API
  const { data: allCountries } = useQuery<string[]>({
    queryKey: ['/api/filters/countries'],
    staleTime: 30 * 60 * 1000, // 30 minutes
  });

  // Create countries dropdown data with global option first
  const countries = [
    { value: 'global', label: `🌍 Global`, flag: '🌍' },
    ...(allCountries || []).map(country => ({
      value: country,
      label: `🌐 ${country}`,
      flag: '🌐'
    }))
  ];

  // Get all genres from API  
  const { data: allGenres } = useQuery<any[]>({
    queryKey: ['/api/genres/discoverable'],
    staleTime: 30 * 60 * 1000, // 30 minutes
  });

  // Create genres dropdown data with all option first
  const genres = [
    { value: 'all', label: `🎵 ${t('trending_all_genres', 'All Genres')}`, icon: '🎵' },
    ...(allGenres || []).map(genre => ({
      value: genre.slug || genre.name.toLowerCase(),
      label: `🎶 ${genre.name}`,
      icon: '🎶'
    }))
  ];

  const isLoading = trendingLoading || communityLoading;

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="mb-8"
        >
          <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-6">
            <div>
              <h1 className="text-3xl font-bold mb-2 flex items-center">
                <TrendingUp className="w-8 h-8 mr-3 text-orange-500" />
                {t('general_trending_stations', 'Trending Stations')}
              </h1>
              <p className="text-gray-400">
                {t('trending_discover_popular_description', 'Discover the most popular radio stations worldwide')}
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-4 mt-4 md:mt-0">
              <Select value={selectedCountry} onValueChange={setSelectedCountry}>
                <SelectTrigger className="w-48 bg-gray-900 border-gray-700">
                  <SelectValue placeholder={t('trending_select_country', 'Select Country')} />
                </SelectTrigger>
                <SelectContent className="bg-gray-900 border-gray-700 text-white">
                  {countries.map((country) => (
                    <SelectItem key={country.value} value={country.value} className="text-white hover:bg-gray-800 focus:bg-gray-800">
                      {country.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={selectedGenre} onValueChange={setSelectedGenre}>
                <SelectTrigger className="w-48 bg-gray-900 border-gray-700">
                  <SelectValue placeholder={t('trending_select_genre', 'Select Genre')} />
                </SelectTrigger>
                <SelectContent className="bg-gray-900 border-gray-700 text-white">
                  {genres.map((genre) => (
                    <SelectItem key={genre.value} value={genre.value} className="text-white hover:bg-gray-800 focus:bg-gray-800">
                      {genre.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
            <Card className="bg-gradient-to-r from-orange-900 to-orange-700 border-orange-600">
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-orange-200">{t('trending_now', 'Trending Now')}</p>
                    <p className="text-2xl font-bold text-white">
                      {trendingData?.trending.length || 0}
                    </p>
                  </div>
                  <Flame className="w-8 h-8 text-orange-300" />
                </div>
              </CardContent>
            </Card>

            <Card className="bg-gradient-to-r from-pink-900 to-pink-700 border-pink-600">
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-pink-200">{t('trending_community_favorites', 'Community Favorites')}</p>
                    <p className="text-2xl font-bold text-white">
                      {communityData?.favorites.length || 0}
                    </p>
                  </div>
                  <Heart className="w-8 h-8 text-pink-300" />
                </div>
              </CardContent>
            </Card>

            <Card className="bg-gradient-to-r from-blue-900 to-blue-700 border-blue-600">
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-blue-200">{t('trending_countries', 'Countries')}</p>
                    <p className="text-2xl font-bold text-white">
                      {selectedCountry === 'global' ? '100+' : '1'}
                    </p>
                  </div>
                  <Globe className="w-8 h-8 text-blue-300" />
                </div>
              </CardContent>
            </Card>

            <Card className="bg-gradient-to-r from-green-900 to-green-700 border-green-600">
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-green-200">{t('trending_genres', 'Genres')}</p>
                    <p className="text-2xl font-bold text-white">
                      {selectedGenre === 'all' ? '25+' : '1'}
                    </p>
                  </div>
                  <Award className="w-8 h-8 text-green-300" />
                </div>
              </CardContent>
            </Card>
          </div>
        </motion.div>

        {/* Loading State */}
        {isLoading && (
          <div className="space-y-8">
            <div className="animate-pulse space-y-4">
              <div className="h-8 bg-gray-800 rounded w-64"></div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="h-48 bg-gray-800 rounded-lg"></div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Trending Stations Section */}
        {!isLoading && trendingData && (
          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="mb-12"
          >
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center space-x-3">
                <Flame className="w-6 h-6 text-orange-500" />
                <h2 className="text-2xl font-bold">{t('trending_hot_right_now')}</h2>
                <Badge variant="secondary" className="bg-orange-900 text-orange-200">
                  {trendingData.meta.count} {t('trending_stations_count')}
                </Badge>
              </div>
              <p className="text-sm text-gray-400">
                {t('trending_updated')} {new Date(trendingData.meta.generatedAt).toLocaleTimeString()}
              </p>
            </div>

            {trendingData.trending.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {trendingData.trending.map((station, index) => (
                  <motion.div
                    key={station.stationId}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.4, delay: index * 0.1 }}
                    className="relative"
                  >
                    {index < 3 && (
                      <Badge
                        className={`absolute -top-2 -right-2 z-10 ${
                          index === 0 ? 'bg-yellow-600' : index === 1 ? 'bg-gray-500' : 'bg-orange-600'
                        }`}
                      >
                        #{index + 1}
                      </Badge>
                    )}
                    <StationCard
                      key={station.stationId}
                      station={{
                        _id: station.stationId,
                        name: station.station.name,
                        country: station.station.country,
                        tags: station.station.genre,
                        favicon: station.station.favicon,
                        votes: station.station.votes,
                        slug: station.station.slug,
                        url: `/station/${station.stationId}` // Add URL for playback
                      }}
                      showEngagement={true}
                      engagement={{
                        totalFavorites: station.totalFavorites,
                        averageRating: station.averageRating,
                        trendingScore: station.trendingScore,
                        weeklyFavorites: station.weeklyFavorites
                      }}
                      onPlay={(stationId) => {
                        const stationToPlay = {
                          _id: station.stationId,
                          name: station.station.name,
                          country: station.station.country,
                          tags: station.station.genre,
                          favicon: station.station.favicon,
                          votes: station.station.votes,
                          slug: station.station.slug,
                          url: station.station.url || station.station.urlResolved || '' // Use the actual stream URL
                        };
                        playStation(stationToPlay);
                      }}
                      onFavorite={(stationId, isFavorite) => {
                        if (!isAuthenticated) {
                          // Redirect to login page
                          setLocation('/auth/login');
                          return;
                        }
                        // Handle favorite action for authenticated users
                        // This will be handled by the global player's toggleFavorite
                      }}
                    />
                  </motion.div>
                ))}
              </div>
            ) : (
              <Card className="bg-gray-900 border-gray-700">
                <CardContent className="pt-8 pb-8 text-center">
                  <Flame className="w-12 h-12 text-gray-600 mx-auto mb-4" />
                  <h3 className="text-lg font-semibold mb-2">{t('trending_no_trending_stations')}</h3>
                  <p className="text-gray-400">
                    {t('trending_no_stations_message')}
                  </p>
                </CardContent>
              </Card>
            )}
          </motion.section>
        )}

        {/* Community Favorites Section */}
        {!isLoading && communityData && (
          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
          >
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center space-x-3">
                <Heart className="w-6 h-6 text-pink-500" />
                <h2 className="text-2xl font-bold">{t('trending_community_favorites_title')}</h2>
                <Badge variant="secondary" className="bg-pink-900 text-pink-200">
                  {communityData.meta.count} {t('trending_stations_count')}
                </Badge>
              </div>
              <p className="text-sm text-gray-400">
                {t('trending_most_loved_by_users')}
              </p>
            </div>

            {communityData.favorites.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {communityData.favorites.map((station, index) => (
                  <motion.div
                    key={station.stationId}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.4, delay: index * 0.1 }}
                  >
                    <StationCard
                      key={station.stationId}
                      station={{
                        _id: station.stationId,
                        name: station.station.name,
                        country: station.station.country,
                        tags: station.station.tags,
                        favicon: station.station.favicon,
                        votes: station.station.votes,
                        slug: station.station.slug,
                        url: `/station/${station.stationId}`
                      }}
                      showEngagement={true}
                      engagement={{
                        totalFavorites: station.totalFavorites,
                        averageRating: station.averageRating,
                        totalRatings: station.totalRatings,
                        trendingScore: station.trendingScore
                      }}
                      onPlay={(stationId) => {
                        const stationToPlay = {
                          _id: station.stationId,
                          name: station.station.name,
                          country: station.station.country,
                          tags: station.station.tags,
                          favicon: station.station.favicon,
                          votes: station.station.votes,
                          slug: station.station.slug,
                          url: station.station.url || station.station.urlResolved || '' // Use the actual stream URL
                        };
                        playStation(stationToPlay);
                      }}
                      onFavorite={(stationId, isFavorite) => {
                        if (!isAuthenticated) {
                          // Redirect to login page
                          setLocation('/auth/login');
                          return;
                        }
                        // Handle favorite action for authenticated users
                        // This will be handled by the global player's toggleFavorite
                      }}
                    />
                  </motion.div>
                ))}
              </div>
            ) : (
              <Card className="bg-gray-900 border-gray-700">
                <CardContent className="pt-8 pb-8 text-center">
                  <Heart className="w-12 h-12 text-gray-600 mx-auto mb-4" />
                  <h3 className="text-lg font-semibold mb-2">No Community Favorites</h3>
                  <p className="text-gray-400">
                    No stations match the selected filters in community favorites.
                  </p>
                </CardContent>
              </Card>
            )}
          </motion.section>
        )}

        {/* Call to Action */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="mt-12"
        >
          <Card className="bg-gradient-to-r from-purple-900 to-blue-900 border-purple-600">
            <CardContent className="pt-8 pb-8 text-center">
              <Users className="w-12 h-12 text-purple-300 mx-auto mb-4" />
              <h3 className="text-xl font-bold mb-2">Join the Community</h3>
              <p className="text-gray-300 mb-6">
                Help shape these lists by adding your favorite stations and rating the ones you love!
              </p>
              <Button
                onClick={() => setLocation('/discover')}
                className="bg-purple-600 hover:bg-purple-700 px-6 py-2"
              >
                Discover More Stations
              </Button>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}