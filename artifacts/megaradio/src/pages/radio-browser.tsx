import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { PlayCircle, Vote, TrendingUp, Clock, Zap, Globe, Radio, Search, Heart } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface RadioBrowserStation {
  stationuuid: string;
  name: string;
  url: string;
  homepage?: string;
  favicon?: string;
  tags?: string;
  country?: string;
  countrycode?: string;
  state?: string;
  language?: string;
  codec?: string;
  bitrate?: number;
  votes: number;
  clickcount: number;
  clicktrend: number;
  lastcheckok: number;
  lastchecktime?: string;
}

export default function RadioBrowser() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState('trending');
  const [searchParams, setSearchParams] = useState({
    name: '',
    country: '',
    language: '',
    tag: '',
    codec: '',
    bitrate: '',
    hidebroken: true,
    is_https: false,
    limit: '50'
  });

  // Queries for different station types
  const { data: trendingStations, isLoading: loadingTrending } = useQuery<{stations: any[]}>({
    queryKey: ['/api/stations/trending', { limit: 50 }],
    enabled: activeTab === 'trending'
  });

  const { data: recentStations, isLoading: loadingRecent } = useQuery<{stations: any[]}>({
    queryKey: ['/api/stations/recent', { limit: 50 }],
    enabled: activeTab === 'recent'
  });

  const { data: qualityStations, isLoading: loadingQuality } = useQuery<{stations: any[]}>({
    queryKey: ['/api/stations/quality', { limit: 50 }],
    enabled: activeTab === 'quality'
  });

  const { data: topClickedApi, isLoading: loadingTopClicked } = useQuery<{stations: RadioBrowserStation[]}>({
    queryKey: ['/api/radio-browser/top-clicked', { limit: 100 }],
    enabled: activeTab === 'api-top-clicked'
  });

  const { data: topVotedApi, isLoading: loadingTopVoted } = useQuery<{stations: RadioBrowserStation[]}>({
    queryKey: ['/api/radio-browser/top-voted', { limit: 100 }],
    enabled: activeTab === 'api-top-voted'
  });

  const { data: recentApi, isLoading: loadingRecentApi } = useQuery<{stations: RadioBrowserStation[]}>({
    queryKey: ['/api/radio-browser/recent', { limit: 100 }],
    enabled: activeTab === 'api-recent'
  });

  const { data: brokenApi, isLoading: loadingBroken } = useQuery<{stations: RadioBrowserStation[]}>({
    queryKey: ['/api/radio-browser/broken', { limit: 50 }],
    enabled: activeTab === 'api-broken'
  });

  const { data: apiStats } = useQuery<{stations: number, countries: number, languages: number, tags: number}>({
    queryKey: ['/api/radio-browser/stats']
  });

  const { data: searchResults, refetch: searchStations, isLoading: loadingSearch } = useQuery<{stations: RadioBrowserStation[], total: number}>({
    queryKey: ['/api/stations/search/advanced', searchParams],
    enabled: false
  });

  const handleSearch = async () => {
    const cleanParams = Object.fromEntries(
      Object.entries(searchParams).filter(([_, value]) => value !== '' && value !== false)
    );
    await searchStations();
    // Toast will be handled by the search completion
  };

  const handleStationClick = async (stationId: string, stationName: string) => {
    try {
      const response = await fetch(`/api/stations/${stationId}/click`, { method: 'POST' });
      const result = await response.json();
      
      if (result.success) {
        toast({
          title: "Station clicked",
          description: `Playing ${stationName} - ${result.clickCount} total clicks`
        });
      }
    } catch (error) {
      // Click tracking failed
    }
  };

  const handleStationVote = async (stationId: string, stationName: string) => {
    try {
      const response = await fetch(`/api/stations/${stationId}/vote`, { method: 'POST' });
      const result = await response.json();
      
      if (result.success) {
        toast({
          title: "Vote submitted",
          description: `Voted for ${stationName} - ${result.votes} total votes`
        });
      } else {
        toast({
          title: "Vote failed",
          description: result.message || "You may have already voted recently",
          variant: "destructive"
        });
      }
    } catch (error) {
      toast({
        title: "Vote failed",
        description: "Unable to submit vote",
        variant: "destructive"
      });
    }
  };

  const StationCard = ({ station, isApiStation = false }: { station: any, isApiStation?: boolean }) => (
    <Card className="hover:shadow-md transition-shadow">
      <CardHeader className="pb-2 sm:pb-3">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <CardTitle className="text-base sm:text-lg line-clamp-1">{station.name}</CardTitle>
            <CardDescription className="flex items-center gap-1 sm:gap-2 mt-1 text-xs sm:text-sm">
              <Globe className="h-3 w-3 sm:h-4 sm:w-4 flex-shrink-0" />
              <span className="truncate">{station.country || station.countrycode || 'Unknown'}</span>
              {station.language && (
                <>
                  <span className="hidden sm:inline">•</span>
                  <span className="truncate hidden sm:inline">{station.language}</span>
                </>
              )}
            </CardDescription>
          </div>
          {station.favicon && (
            <img 
              src={station.favicon} 
              alt="Station favicon" 
              className="h-6 w-6 sm:h-8 sm:w-8 rounded flex-shrink-0"
              onError={(e) => e.currentTarget.style.display = 'none'}
            />
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="flex flex-wrap gap-1 sm:gap-2 mb-2 sm:mb-3">
          {station.codec && <Badge variant="secondary" className="text-xs">{station.codec}</Badge>}
          {station.bitrate && <Badge variant="outline" className="text-xs">{station.bitrate} kbps</Badge>}
          {(station.lastcheckok === 1 || station.lastCheckOk) && (
            <Badge variant="default" className="bg-green-500 text-xs">Online</Badge>
          )}
          {station.tags && (
            <Badge variant="outline" className="text-xs">
              {station.tags.split(',')[0]}
            </Badge>
          )}
        </div>
        
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-4 text-xs sm:text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <TrendingUp className="h-3 w-3 sm:h-4 sm:w-4" />
              <span className="hidden sm:inline">{isApiStation ? station.clickcount || 0 : station.clickCount || 0} clicks</span>
              <span className="sm:hidden">{isApiStation ? station.clickcount || 0 : station.clickCount || 0}</span>
            </span>
            <span className="flex items-center gap-1">
              <Heart className="h-3 w-3 sm:h-4 sm:w-4 text-[#FF4199]" />
              <span className="hidden sm:inline text-[#FF4199]">{station.votes || 0} votes</span>
              <span className="sm:hidden text-[#FF4199]">{station.votes || 0}</span>
            </span>
          </div>
          
          <div className="flex gap-1 sm:gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleStationClick(station._id || station.stationuuid, station.name)}
              className="flex-1 sm:flex-none"
            >
              <PlayCircle className="h-3 w-3 sm:h-4 sm:w-4 mr-1" />
              <span className="hidden sm:inline">Play</span>
              <span className="sm:hidden">▶</span>
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleStationVote(station._id || station.stationuuid, station.name)}
              className="flex-1 sm:flex-none"
            >
              <Vote className="h-3 w-3 sm:h-4 sm:w-4 mr-1" />
              <span className="hidden sm:inline">Vote</span>
              <span className="sm:hidden">♥</span>
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );

  const renderStationGrid = (stations: any, loading: boolean, isApiStation = false) => {
    if (loading) {
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader>
                <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                <div className="h-3 bg-gray-200 rounded w-1/2"></div>
              </CardHeader>
              <CardContent>
                <div className="h-16 bg-gray-200 rounded"></div>
              </CardContent>
            </Card>
          ))}
        </div>
      );
    }

    const stationList = stations?.stations || stations || [];
    
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        {stationList.map((station: any, index: number) => (
          <StationCard 
            key={station._id || station.stationuuid || index} 
            station={station} 
            isApiStation={isApiStation}
          />
        ))}
      </div>
    );
  };

  return (
    <div className="container mx-auto p-3 sm:p-6">
      <div className="mb-6 sm:mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold mb-2 text-gray-900 dark:text-gray-100">Radio-Browser API Integration</h1>
        <p className="text-sm sm:text-base text-muted-foreground">
          Comprehensive access to the Radio-Browser database with advanced search, trending stations, and real-time statistics.
        </p>
      </div>

      {/* API Statistics Card */}
      {apiStats && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Radio className="h-5 w-5" />
              Radio-Browser API Statistics
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              <div className="text-center">
                <div className="text-lg sm:text-2xl font-bold">{apiStats.stations?.toLocaleString()}</div>
                <div className="text-xs sm:text-sm text-muted-foreground">Total Stations</div>
              </div>
              <div className="text-center">
                <div className="text-lg sm:text-2xl font-bold">{apiStats.countries?.toLocaleString()}</div>
                <div className="text-xs sm:text-sm text-muted-foreground">Countries</div>
              </div>
              <div className="text-center">
                <div className="text-lg sm:text-2xl font-bold">{apiStats.languages?.toLocaleString()}</div>
                <div className="text-xs sm:text-sm text-muted-foreground">Languages</div>
              </div>
              <div className="text-center">
                <div className="text-lg sm:text-2xl font-bold">{apiStats.tags?.toLocaleString()}</div>
                <div className="text-xs sm:text-sm text-muted-foreground">Tags</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-3 sm:grid-cols-4 lg:grid-cols-7 gap-1">
          <TabsTrigger value="trending" className="text-xs sm:text-sm">Trending</TabsTrigger>
          <TabsTrigger value="recent" className="text-xs sm:text-sm">Recent</TabsTrigger>
          <TabsTrigger value="quality" className="text-xs sm:text-sm hidden sm:block">Quality</TabsTrigger>
          <TabsTrigger value="api-top-clicked" className="text-xs sm:text-sm hidden lg:block">Top Clicked</TabsTrigger>
          <TabsTrigger value="api-top-voted" className="text-xs sm:text-sm hidden lg:block">Top Voted</TabsTrigger>
          <TabsTrigger value="api-recent" className="text-xs sm:text-sm hidden lg:block">Live Recent</TabsTrigger>
          <TabsTrigger value="search" className="text-xs sm:text-sm">Search</TabsTrigger>
        </TabsList>

        <TabsContent value="trending" className="mt-4 sm:mt-6">
          <div className="mb-4">
            <h2 className="text-lg sm:text-xl font-semibold mb-2">Trending Stations</h2>
            <p className="text-sm sm:text-base text-muted-foreground">Stations with highest click trends from our database</p>
          </div>
          {renderStationGrid(trendingStations, loadingTrending)}
        </TabsContent>

        <TabsContent value="recent" className="mt-6">
          <div className="mb-4">
            <h2 className="text-xl font-semibold mb-2">Recently Updated</h2>
            <p className="text-muted-foreground">Latest station updates from our database</p>
          </div>
          {renderStationGrid(recentStations, loadingRecent)}
        </TabsContent>

        <TabsContent value="quality" className="mt-6">
          <div className="mb-4">
            <h2 className="text-xl font-semibold mb-2">High Quality Stations</h2>
            <p className="text-muted-foreground">Active stations with bitrate ≥ 128 kbps</p>
          </div>
          {renderStationGrid(qualityStations, loadingQuality)}
        </TabsContent>

        <TabsContent value="api-top-clicked" className="mt-6">
          <div className="mb-4">
            <h2 className="text-xl font-semibold mb-2">Top Clicked (Live API)</h2>
            <p className="text-muted-foreground">Most clicked stations directly from Radio-Browser API</p>
          </div>
          {renderStationGrid(topClickedApi, loadingTopClicked, true)}
        </TabsContent>

        <TabsContent value="api-top-voted" className="mt-6">
          <div className="mb-4">
            <h2 className="text-xl font-semibold mb-2">Top Voted (Live API)</h2>
            <p className="text-muted-foreground">Highest voted stations directly from Radio-Browser API</p>
          </div>
          {renderStationGrid(topVotedApi, loadingTopVoted, true)}
        </TabsContent>

        <TabsContent value="api-recent" className="mt-6">
          <div className="mb-4">
            <h2 className="text-xl font-semibold mb-2">Recently Changed (Live API)</h2>
            <p className="text-muted-foreground">Latest station changes directly from Radio-Browser API</p>
          </div>
          {renderStationGrid(recentApi, loadingRecentApi, true)}
        </TabsContent>

        <TabsContent value="search" className="mt-6">
          <div className="mb-6">
            <h2 className="text-xl font-semibold mb-2">Advanced Station Search</h2>
            <p className="text-muted-foreground">Search the Radio-Browser database with comprehensive filters</p>
          </div>
          
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Search Parameters</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div>
                  <Label htmlFor="name">Station Name</Label>
                  <Input
                    id="name"
                    value={searchParams.name}
                    onChange={(e) => setSearchParams({...searchParams, name: e.target.value})}
                    placeholder="Search by name..."
                  />
                </div>
                <div>
                  <Label htmlFor="country">Country</Label>
                  <Input
                    id="country"
                    value={searchParams.country}
                    onChange={(e) => setSearchParams({...searchParams, country: e.target.value})}
                    placeholder="e.g., Germany"
                  />
                </div>
                <div>
                  <Label htmlFor="language">Language</Label>
                  <Input
                    id="language"
                    value={searchParams.language}
                    onChange={(e) => setSearchParams({...searchParams, language: e.target.value})}
                    placeholder="e.g., english"
                  />
                </div>
                <div>
                  <Label htmlFor="tag">Tags</Label>
                  <Input
                    id="tag"
                    value={searchParams.tag}
                    onChange={(e) => setSearchParams({...searchParams, tag: e.target.value})}
                    placeholder="e.g., rock, news"
                  />
                </div>
                <div>
                  <Label htmlFor="codec">Codec</Label>
                  <Select 
                    value={searchParams.codec} 
                    onValueChange={(value) => setSearchParams({...searchParams, codec: value})}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select codec" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">Any</SelectItem>
                      <SelectItem value="MP3">MP3</SelectItem>
                      <SelectItem value="AAC">AAC</SelectItem>
                      <SelectItem value="OGG">OGG</SelectItem>
                      <SelectItem value="FLAC">FLAC</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="bitrate">Min Bitrate (kbps)</Label>
                  <Input
                    id="bitrate"
                    type="number"
                    value={searchParams.bitrate}
                    onChange={(e) => setSearchParams({...searchParams, bitrate: e.target.value})}
                    placeholder="128"
                  />
                </div>
              </div>
              
              <div className="flex flex-wrap gap-4">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="hidebroken"
                    checked={searchParams.hidebroken}
                    onCheckedChange={(checked) => setSearchParams({...searchParams, hidebroken: !!checked})}
                  />
                  <Label htmlFor="hidebroken">Hide broken stations</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="is_https"
                    checked={searchParams.is_https}
                    onCheckedChange={(checked) => setSearchParams({...searchParams, is_https: !!checked})}
                  />
                  <Label htmlFor="is_https">HTTPS only</Label>
                </div>
              </div>
              
              <div className="flex gap-2">
                <Button onClick={handleSearch} disabled={loadingSearch}>
                  <Search className="h-4 w-4 mr-2" />
                  {loadingSearch ? 'Searching...' : 'Search Stations'}
                </Button>
                <Button 
                  variant="outline" 
                  onClick={() => setSearchParams({
                    name: '', country: '', language: '', tag: '', codec: '', 
                    bitrate: '', hidebroken: true, is_https: false, limit: '50'
                  })}
                >
                  Clear Filters
                </Button>
              </div>
            </CardContent>
          </Card>

          {searchResults && (
            <div className="mb-4">
              <h3 className="text-lg font-semibold">
                Search Results ({(searchResults as any)?.total || 0} stations found)
              </h3>
            </div>
          )}
          {renderStationGrid(searchResults, loadingSearch, true)}
        </TabsContent>
      </Tabs>
    </div>
  );
}