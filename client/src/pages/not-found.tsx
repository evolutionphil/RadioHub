import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Search, Home, Music, Radio, Heart, ArrowRight, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTranslation } from "@/hooks/useTranslation";
import { useSeoRouting } from "@/hooks/useSeoRouting";

export default function NotFound() {
  const [searchQuery, setSearchQuery] = useState("");
  const [currentUrl, setCurrentUrl] = useState("");
  const [location, navigate] = useLocation();
  const { t } = useTranslation();
  const { getLocalizedUrl } = useSeoRouting();

  // Get current URL for reporting
  useEffect(() => {
    setCurrentUrl(window.location.href);
  }, []);

  // Fetch popular stations for suggestions
  const { data: popularStations } = useQuery({
    queryKey: ['/api/stations/popular'],
    retry: false,
  });

  // Fetch discoverable genres
  const { data: genres } = useQuery({
    queryKey: ['/api/genres/discoverable'],
    retry: false,
  });

  // Type-safe data access
  const stationsArray = Array.isArray(popularStations) ? popularStations : [];
  const genresArray = Array.isArray(genres) ? genres : [];

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(getLocalizedUrl(`/?search=${encodeURIComponent(searchQuery.trim())}`));
    }
  };

  const handleReportBrokenLink = () => {
    const subject = encodeURIComponent("Broken Link Report - 404 Error");
    const body = encodeURIComponent(`I found a broken link on your website:\n\nURL: ${currentUrl}\n\nAdditional details: `);
    window.open(`mailto:support@themegaradio.com?subject=${subject}&body=${body}`, '_blank');
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#0A0A0A] to-[#1A1A1A] text-white">
      {/* Header section */}
      <div className="container mx-auto px-4 pt-20 pb-12">
        <div className="text-center mb-12">
          <div className="flex justify-center mb-6">
            <div className="w-24 h-24 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
              <Radio className="w-12 h-12 text-white" />
            </div>
          </div>
          
          <h1 className="text-4xl md:text-5xl font-bold mb-4 bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
            {t('404_page_not_found')}
          </h1>
          
          <p className="text-xl text-gray-300 mb-2">
            {t('404_description')}
          </p>
          
          <p className="text-gray-400">
            {t('404_help_text')}
          </p>
        </div>

        {/* Search Section */}
        <div className="max-w-2xl mx-auto mb-16">
          <Card className="bg-[#1E1E1E] border-gray-700">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Search className="w-5 h-5" />
                {t('search_stations')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSearch} className="flex gap-2">
                <Input
                  type="search"
                  placeholder={t('search_placeholder')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="flex-1 bg-[#2A2A2A] border-gray-600 text-white placeholder-gray-400"
                />
                <Button type="submit" className="bg-blue-600 hover:bg-blue-700">
                  <Search className="w-4 h-4" />
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>

        {/* Quick Navigation */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 mb-16">
          {/* Homepage */}
          <Card className="bg-[#1E1E1E] border-gray-700 hover:bg-[#252525] transition-colors">
            <CardContent className="p-6">
              <div className="flex items-center gap-3 mb-3">
                <Home className="w-6 h-6 text-blue-400" />
                <h3 className="text-lg font-semibold text-white">
                  {t('homepage')}
                </h3>
              </div>
              <p className="text-gray-400 mb-4">
                {t('homepage_description')}
              </p>
              <Link href={getLocalizedUrl('/')}>
                <Button variant="outline" className="w-full border-gray-600 text-white hover:bg-gray-700">
                  {t('go_home')}
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </Link>
            </CardContent>
          </Card>

          {/* Popular Stations */}
          <Card className="bg-[#1E1E1E] border-gray-700 hover:bg-[#252525] transition-colors">
            <CardContent className="p-6">
              <div className="flex items-center gap-3 mb-3">
                <Radio className="w-6 h-6 text-green-400" />
                <h3 className="text-lg font-semibold text-white">
                  {t('popular_stations')}
                </h3>
              </div>
              <p className="text-gray-400 mb-4">
                {t('popular_stations_description')}
              </p>
              <Link href={getLocalizedUrl('/?tab=popular')}>
                <Button variant="outline" className="w-full border-gray-600 text-white hover:bg-gray-700">
                  {t('browse_popular')}
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </Link>
            </CardContent>
          </Card>

          {/* Genres */}
          <Card className="bg-[#1E1E1E] border-gray-700 hover:bg-[#252525] transition-colors">
            <CardContent className="p-6">
              <div className="flex items-center gap-3 mb-3">
                <Music className="w-6 h-6 text-purple-400" />
                <h3 className="text-lg font-semibold text-white">
                  {t('music_genres')}
                </h3>
              </div>
              <p className="text-gray-400 mb-4">
                {t('genres_description')}
              </p>
              <Link href={getLocalizedUrl('/genres')}>
                <Button variant="outline" className="w-full border-gray-600 text-white hover:bg-gray-700">
                  {t('explore_genres')}
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>

        {/* Suggested Content */}
        <div className="grid md:grid-cols-2 gap-8 mb-16">
          {/* Popular Stations */}
          {stationsArray.length > 0 && (
            <Card className="bg-[#1E1E1E] border-gray-700">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <Heart className="w-5 h-5 text-red-400" />
                  {t('try_these_popular_stations')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {stationsArray.slice(0, 5).map((station: any) => (
                    <Link
                      key={station._id}
                      href={getLocalizedUrl(`/station/${station.slug || station._id}`)}
                      className="flex items-center gap-3 p-2 rounded-lg hover:bg-[#2A2A2A] transition-colors"
                    >
                      <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center flex-shrink-0">
                        <Radio className="w-4 h-4 text-white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-white font-medium truncate">{station.name}</p>
                        <p className="text-gray-400 text-sm truncate">{station.country}</p>
                      </div>
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Popular Genres */}
          {genresArray.length > 0 && (
            <Card className="bg-[#1E1E1E] border-gray-700">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <Music className="w-5 h-5 text-purple-400" />
                  {t('popular_genres')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-2">
                  {genresArray.slice(0, 8).map((genre: any) => (
                    <Link
                      key={genre._id}
                      href={getLocalizedUrl(`/genre/${genre.slug}`)}
                      className="p-3 bg-[#2A2A2A] rounded-lg text-center hover:bg-[#353535] transition-colors"
                    >
                      <p className="text-white font-medium text-sm">{genre.name}</p>
                      <p className="text-gray-400 text-xs">
                        {genre.stationCount || 0} {t('stations')}
                      </p>
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Help Section */}
        <div className="max-w-2xl mx-auto text-center">
          <Card className="bg-[#1E1E1E] border-gray-700">
            <CardContent className="p-8">
              <Mail className="w-12 h-12 text-blue-400 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-white mb-2">
                {t('still_need_help')}
              </h3>
              <p className="text-gray-400 mb-6">
                {t('report_broken_link_description')}
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <Button
                  onClick={handleReportBrokenLink}
                  variant="outline"
                  className="border-gray-600 text-white hover:bg-gray-700"
                >
                  {t('report_broken_link')}
                </Button>
                <Link href={getLocalizedUrl('/contact')}>
                  <Button className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700">
                    {t('contact_us')}
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}