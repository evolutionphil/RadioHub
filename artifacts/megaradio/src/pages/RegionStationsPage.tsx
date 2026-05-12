import React, { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'wouter';
import { ArrowLeft, Radio, Search, Filter, Globe, Users, MapPin, Building2 } from 'lucide-react';
import { useTranslation } from '../hooks/useTranslation';
import { useGlobalPlayer } from '../hooks/useGlobalPlayer';
import StationCard from '@/components/ui/station-card';
import { getLocalizedPath } from '@/utils/slugs';

interface Station {
  _id: string;
  name: string;
  url: string;
  country: string;
  language?: string;
  genre?: string;
  favicon?: string;
  votes: number;
  tags?: string;
}

interface StationsData {
  region: {
    name: string;
    slug: string;
  };
  country: {
    name: string;
    slug: string;
  };
  city?: {
    name: string;
    slug: string;
  };
  stations: Station[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

const regionIcons: { [key: string]: React.ReactNode } = {
  'africa': <span className="text-lg">🌍</span>,
  'asia': <span className="text-lg">🌏</span>,
  'europe': <span className="text-lg">🌍</span>,
  'north-america': <span className="text-lg">🌎</span>,
  'south-america': <span className="text-lg">🌎</span>,
  'oceania': <span className="text-lg">🌏</span>
};

export default function RegionStationsPage() {
  const { regionSlug, countrySlug, citySlug } = useParams() as { 
    regionSlug: string; 
    countrySlug: string; 
    citySlug?: string; 
  };
  const { t } = useTranslation();
  const { currentStation, playStation } = useGlobalPlayer();
  
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<'votes' | 'name'>('votes');
  const [limit] = useState(50); // 50 stations per load
  const [offset, setOffset] = useState(0);
  const [allStations, setAllStations] = useState<Station[]>([]); // Accumulate all loaded stations
  const [isLoadingMore, setIsLoadingMore] = useState(false); // Track load more state
  const [hasMore, setHasMore] = useState(true); // Track if more data available
  const [scrollPosition, setScrollPosition] = useState(0); // Track scroll position for Load More

  // Build API URL based on whether we have a city
  const apiUrl = citySlug 
    ? `/api/regions/${regionSlug}/${countrySlug}/${citySlug}/stations`
    : `/api/regions/${regionSlug}/${countrySlug}/stations`;

  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: [apiUrl, { limit, offset, sortBy, search: searchTerm }],
    queryFn: async () => {
      const params = new URLSearchParams({
        limit: limit.toString(),
        offset: offset.toString(),
        sortBy,
        order: sortBy === 'votes' ? 'desc' : 'asc',
        ...(searchTerm && { search: searchTerm })
      });
      
      const response = await fetch(`${apiUrl}?${params}`);
      if (!response.ok) throw new Error('Failed to fetch stations');
      return response.json();
    },
    select: (response: { success: boolean; data: StationsData }) => response.data,
    enabled: true,
    refetchOnWindowFocus: false,
    staleTime: Infinity, // Don't refetch automatically
    gcTime: 10 * 60 * 1000, // Keep in cache for 10 minutes
  });

  // Effect to accumulate stations when new data arrives
  useEffect(() => {
    if (data?.stations) {
      if (offset === 0) {
        // First load or reset - replace all stations
        setAllStations(data.stations);
      } else {
        // Load more - append new stations without duplicates
        setAllStations(prev => {
          const existingIds = new Set(prev.map(s => s._id));
          const newStations = data.stations.filter(s => !existingIds.has(s._id));
          return [...prev, ...newStations];
        });
      }
      
      // Update hasMore state based on actual pagination data
      const actualHasMore = data.pagination && (offset + data.stations.length < data.pagination.total);
      setHasMore(actualHasMore);
      
      // Stop loading more state and restore scroll position
      if (offset > 0) {
        setIsLoadingMore(false);
        // Restore scroll position after DOM update
        if (scrollPosition > 0) {
          setTimeout(() => {
            window.scrollTo(0, scrollPosition);
            setScrollPosition(0); // Reset scroll position
          }, 50);
        }
      }
    }
  }, [data, offset, scrollPosition]);

  // Filter stations by search term (client-side for better UX)
  const filteredStations = useMemo(() => {
    if (!allStations.length) return [];
    
    if (!searchTerm) return allStations;
    
    return allStations.filter(station =>
      station.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      station.genre?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      station.tags?.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [allStations, searchTerm]);

  // Reset pagination when search term or sort changes
  useEffect(() => {
    setOffset(0);
    setAllStations([]);
    setHasMore(true);
    setIsLoadingMore(false);
  }, [searchTerm, sortBy]);

  // Generate structured data for region/country/city pages (moved here to fix hooks order)
  const structuredData = useMemo(() => {
    if (!data || !data.country || !data.region || !data.pagination || typeof window === 'undefined' || !filteredStations) return null;

    const baseUrl = window.location.origin;
    const currentUrl = window.location.href;
    
    return {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      "name": data.country.name + (data.city ? ` - ${data.city.name}` : '') + " Radio Stations",
      "description": `Listen to radio stations from ${data.country.name}${data.city ? ` - ${data.city.name}` : ''}`,
      "url": currentUrl,
      "mainEntity": {
        "@type": "ItemList",
        "name": `Radio Stations in ${data.country.name}${data.city ? ` - ${data.city.name}` : ''}`,
        "numberOfItems": data.pagination.total,
        "itemListElement": filteredStations.slice(0, 10).map((station, index) => ({
          // 2026-05-12 SEO audit: switched RadioStation → RadioBroadcastService
          // (LocalBusiness subtype was rejecting broadcast*/inLanguage props).
          // Tags now ship as `keywords` with default ["Music"] — never empty.
          "@type": "RadioBroadcastService",
          "position": index + 1,
          "name": station.name,
          "description": `Listen to ${station.name} live from ${station.country}`,
          "url": `${baseUrl}/stations/${station._id}`,
          "broadcaster": {
            "@type": "Organization",
            "name": station.name,
            ...(station.country && {
              "address": { "@type": "PostalAddress", "addressCountry": station.country }
            })
          },
          "broadcastAffiliateOf": {
            "@type": "Organization",
            "name": "MegaRadio"
          },
          "isAccessibleForFree": true,
          "keywords": (() => {
            const t = station.tags ? station.tags.split(',').map(s => s.trim()).filter(Boolean) : [];
            return t.length > 0 ? t : ["Music"];
          })(),
          "inLanguage": station.language || "en"
        }))
      }
    };
  }, [data, filteredStations]);

  const handleStationPlay = async (station: Station) => {
    try {
      // Pass the filtered stations as the queue for next/previous functionality
      await playStation(station, filteredStations);
    } catch (error) {
      console.error('Failed to play station:', error);
    }
  };

  // Generate SEO meta tags
  const generateSeoTags = () => {
    if (!data) return { title: 'Radio Stations', description: '' };

    const region = data.region?.name ?? '';
    const country = data.country?.name ?? region;
    const city = data.city?.name;
    const stationCount = data.pagination?.total ?? 0;

    let title, description, keywords;

    if (city && city !== 'ALL') {
      // City-specific page
      title = t('regions.seo.city_title', `${city} Radio Stations - ${stationCount} Live Stations from ${city}, ${country}`).replace('{CITY}', city).replace('{COUNTRY}', country).replace('{COUNT}', stationCount.toString());
      description = t('regions.seo.city_description', `Listen to ${stationCount} live radio stations from ${city}, ${country}. Stream local FM/AM radio, music, news and talk shows online for free.`).replace('{CITY}', city).replace('{COUNTRY}', country).replace('{COUNT}', stationCount.toString());
      keywords = `${city} radio, ${country} radio, ${city} FM, ${city} AM, ${city} music, live radio ${city}`;
    } else if (city === 'ALL') {
      // All stations without specific city
      title = t('regions.seo.all_title', `${country} Radio Stations - ${stationCount} National & Regional Stations`).replace('{COUNTRY}', country).replace('{COUNT}', stationCount.toString());
      description = t('regions.seo.all_description', `Listen to ${stationCount} radio stations from ${country}. Stream national and regional FM/AM radio, music, news and talk shows online for free.`).replace('{COUNTRY}', country).replace('{COUNT}', stationCount.toString());
      keywords = `${country} radio, ${country} national radio, ${country} stations, live radio ${country}`;
    } else {
      // Country page
      title = t('regions.seo.country_title', `${country} Radio Stations - ${stationCount} Live Stations | MegaRadio`).replace('{COUNTRY}', country).replace('{COUNT}', stationCount.toString());
      description = t('regions.seo.country_description', `Discover ${stationCount} live radio stations from ${country} in ${region}. Listen to local FM/AM radio, music, news and sports online for free.`).replace('{COUNTRY}', country).replace('{REGION}', region).replace('{COUNT}', stationCount.toString());
      keywords = `${country} radio, ${region} radio, ${country} FM, ${country} AM, live radio ${country}`;
    }

    return { title, description, keywords };
  };

  const seoTags = generateSeoTags();

  // Inject SEO meta tags into document head when data is available
  useEffect(() => {
    if (!data) return;
    const tags = generateSeoTags();
    if (tags.title) document.title = tags.title;
    const descMeta = document.querySelector('meta[name="description"]') as HTMLMetaElement | null;
    if (descMeta && tags.description) descMeta.setAttribute('content', tags.description);
    const ogTitleMeta = document.querySelector('meta[property="og:title"]') as HTMLMetaElement | null;
    if (ogTitleMeta && tags.title) ogTitleMeta.setAttribute('content', tags.title);
    const ogDescMeta = document.querySelector('meta[property="og:description"]') as HTMLMetaElement | null;
    if (ogDescMeta && tags.description) ogDescMeta.setAttribute('content', tags.description);
    const canonicalLink = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
    if (canonicalLink) canonicalLink.setAttribute('href', window.location.href.split('?')[0]);
  }, [data]);

  // Generate structured data for region/country/city pages  
  const generateStructuredData = () => {
    if (!data || !data.country || !data.region || !data.pagination || typeof window === 'undefined' || !filteredStations) return null;

    const baseUrl = window.location.origin;
    const currentUrl = window.location.href;
    
    return {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      "name": seoTags.title,
      "description": seoTags.description,
      "url": currentUrl,
      "mainEntity": {
        "@type": "ItemList",
        "name": `Radio Stations in ${data.country.name}${data.city ? ` - ${data.city.name}` : ''}`,
        "numberOfItems": data.pagination.total,
        "itemListElement": filteredStations.slice(0, 10).map((station, index) => ({
          // 2026-05-12 SEO audit: switched RadioStation → RadioBroadcastService
          // (LocalBusiness subtype was rejecting broadcast*/inLanguage props).
          // Tags now ship as `keywords` with default ["Music"] — never empty.
          "@type": "RadioBroadcastService",
          "position": index + 1,
          "name": station.name,
          "description": `Listen to ${station.name} live from ${station.country}`,
          "url": `${baseUrl}/stations/${station._id}`,
          "broadcaster": {
            "@type": "Organization",
            "name": station.name,
            ...(station.country && {
              "address": { "@type": "PostalAddress", "addressCountry": station.country }
            })
          },
          "broadcastAffiliateOf": {
            "@type": "Organization",
            "name": "MegaRadio"
          },
          "isAccessibleForFree": true,
          "keywords": (() => {
            const t = station.tags ? station.tags.split(',').map(s => s.trim()).filter(Boolean) : [];
            return t.length > 0 ? t : ["Music"];
          })(),
          "inLanguage": station.language || "en"
        }))
      },
      "breadcrumb": {
        "@type": "BreadcrumbList",
        "itemListElement": [
          {
            "@type": "ListItem",
            "position": 1,
            "name": "Home",
            "item": baseUrl
          },
          {
            "@type": "ListItem", 
            "position": 2,
            "name": "Regions",
            "item": `${baseUrl}/regions`
          },
          {
            "@type": "ListItem",
            "position": 3,
            "name": data.region.name,
            "item": `${baseUrl}/regions/${data.region.slug}`
          },
          {
            "@type": "ListItem",
            "position": 4,
            "name": data.country.name,
            "item": `${baseUrl}/regions/${data.region.slug}/${data.country.slug}`
          },
          ...(data.city ? [{
            "@type": "ListItem",
            "position": 5,
            "name": data.city.name,
            "item": currentUrl
          }] : [])
        ]
      }
    };
  };

  if (isLoading && allStations.length === 0) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800 text-white">
        <div className="container mx-auto px-4 py-8">
          {/* Header skeleton */}
          <div className="flex items-center gap-4 mb-8">
            <div className="w-10 h-10 bg-slate-700 rounded-lg animate-pulse"></div>
            <div className="w-64 h-8 bg-slate-700 rounded-lg animate-pulse"></div>
          </div>
          
          {/* Filters skeleton */}
          <div className="flex gap-4 mb-8">
            <div className="w-80 h-12 bg-slate-700 rounded-lg animate-pulse"></div>
            <div className="w-40 h-12 bg-slate-700 rounded-lg animate-pulse"></div>
          </div>
          
          {/* Grid skeleton */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {[1, 2, 3, 4, 5, 6, 7, 8].map(i => (
              <div key={i} className="bg-slate-800 rounded-xl p-6 animate-pulse">
                <div className="w-16 h-16 bg-slate-700 rounded-lg mb-4"></div>
                <div className="w-full h-6 bg-slate-700 rounded mb-2"></div>
                <div className="w-20 h-4 bg-slate-700 rounded"></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800 text-white flex items-center justify-center">
        <div className="text-center">
          <Radio className="w-16 h-16 text-slate-400 mx-auto mb-4" />
          <h2 className="text-2xl font-bold mb-2">{t('regions.error.title', 'Station Not Found')}</h2>
          <p className="text-slate-400">{t('regions.error.description', 'Sorry, we could not find any radio stations for this location. Please try another region or country.')}</p>
          <Link 
            href={citySlug ? getLocalizedPath(`/regions/${regionSlug}/${countrySlug}`) : getLocalizedPath(`/regions/${regionSlug}`)}
            className="inline-block mt-4 px-6 py-2 bg-pink-600 hover:bg-pink-700 text-white rounded-lg transition-colors"
          >
            {t('regions.go_back', 'Go Back')}
          </Link>
        </div>
      </div>
    );
  }

  const backUrl = citySlug 
    ? `/regions/${regionSlug}/${countrySlug}`
    : `/regions/${regionSlug}`;


  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800 text-white">
      <div className="container mx-auto px-4 py-8">
        
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-slate-400 mb-6">
          <Link href={getLocalizedPath("/regions")} className="hover:text-pink-400 transition-colors">
            {t('regions.breadcrumb.regions')}
          </Link>
          <span>/</span>
          <Link href={getLocalizedPath(`/regions/${regionSlug}`)} className="hover:text-pink-400 transition-colors">
            {data.region?.name ?? regionSlug}
          </Link>
          {data.country && (
            <>
              <span>/</span>
              <Link href={getLocalizedPath(`/regions/${regionSlug}/${countrySlug}`)} className="hover:text-pink-400 transition-colors">
                {data.country.name}
              </Link>
            </>
          )}
          {data.city && (
            <>
              <span>/</span>
              <span className="text-white">{data.city.name}</span>
            </>
          )}
        </div>

        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Link 
            href={backUrl}
            className="p-2 bg-slate-800/50 hover:bg-slate-700/50 border border-slate-700/50 hover:border-slate-600/50 rounded-lg transition-all duration-200 hover:scale-105"
          >
            <ArrowLeft className="w-6 h-6" />
          </Link>
          
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-pink-500/20 to-purple-600/20 border border-pink-500/30 rounded-lg">
              {data.city ? (
                <Building2 className="w-6 h-6 text-pink-400" />
              ) : regionIcons[regionSlug] || <Globe className="w-6 h-6 text-pink-400" />}
            </div>
            <div>
              <h1 className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-pink-400 to-purple-400 bg-clip-text text-transparent">
                {data.city ? data.city.name : (data.country?.name ?? data.region?.name ?? '')}
              </h1>
              <p className="text-slate-400 mt-1 flex items-center gap-2">
                <Radio className="w-4 h-4" />
                {t('regions.stations.found', `${data.pagination?.total ?? 0} stations found`, { count: (data.pagination?.total ?? 0).toString() })}
              </p>
            </div>
          </div>
        </div>

        {/* Search and Filters */}
        <div className="flex flex-col sm:flex-row gap-4 mb-8">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-5 h-5" />
            <input
              type="text"
              placeholder={t('regions.search.stations_placeholder')}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-3 bg-slate-800/50 border border-slate-700/50 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-pink-500/50 focus:border-pink-500/50 transition-all duration-200"
              data-testid="search-stations"
            />
          </div>
          
          <div className="flex items-center gap-2">
            <Filter className="w-5 h-5 text-slate-400" />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'votes' | 'name')}
              className="px-4 py-3 bg-slate-800/50 border border-slate-700/50 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-pink-500/50 focus:border-pink-500/50 transition-all duration-200"
              data-testid="sort-stations"
            >
              <option value="votes">{t('regions.sort.by_popularity')}</option>
              <option value="name">{t('regions.sort.by_name')}</option>
            </select>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <div className="bg-slate-800/30 backdrop-blur-sm border border-slate-700/50 rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-pink-400">
              {filteredStations.length}
            </div>
            <div className="text-slate-400 text-sm">
              {t('regions.stats.stations')}
            </div>
          </div>
          <div className="bg-slate-800/30 backdrop-blur-sm border border-slate-700/50 rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-green-400">
              {data.country?.name ?? '—'}
            </div>
            <div className="text-slate-400 text-sm">
              {t('regions.stats.country')}
            </div>
          </div>
          <div className="bg-slate-800/30 backdrop-blur-sm border border-slate-700/50 rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-blue-400">
              {data.region?.name ?? '—'}
            </div>
            <div className="text-slate-400 text-sm">
              {t('regions.stats.region')}
            </div>
          </div>
          {data.city && (
            <div className="bg-slate-800/30 backdrop-blur-sm border border-slate-700/50 rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-purple-400">
                {data.city.name}
              </div>
              <div className="text-slate-400 text-sm">
                {t('regions.stats.city')}
              </div>
            </div>
          )}
        </div>

        {/* Stations Grid */}
        {filteredStations.length === 0 ? (
          <div className="text-center py-12">
            <Radio className="w-16 h-16 text-slate-400 mx-auto mb-4" />
            <h3 className="text-xl font-bold mb-2">{t('regions.stations.no_results')}</h3>
            <p className="text-slate-400">
              {searchTerm ? t('regions.search.try_different') : t('regions.stations.no_stations_available')}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {filteredStations.map((station) => (
              <StationCard
                key={station._id}
                station={{
                  _id: station._id,
                  name: station.name,
                  url: station.url,
                  country: station.country,
                  language: station.language,
                  genre: station.genre,
                  favicon: station.favicon,
                  votes: station.votes,
                  tags: station.tags
                }}
                playlistName="regions"
                onPlay={() => handleStationPlay(station)}
                showVotes={true}
              />
            ))}
          </div>
        )}

        {/* Load More Button */}
        {hasMore && allStations.length > 0 && (
          <div className="text-center mt-12">
            <button
              onClick={() => {
                // Save current scroll position before loading more
                setScrollPosition(window.scrollY);
                setIsLoadingMore(true);
                setOffset(prev => prev + limit);
              }}
              disabled={isLoadingMore || isFetching}
              className="px-6 py-3 bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-700 hover:to-purple-700 text-white rounded-lg font-medium transition-all duration-200 hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed"
              data-testid="load-more-stations"
            >
              {(isLoadingMore || isFetching) && offset > 0 ? (
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  {t('regions.load_more.loading', 'Loading more...')}
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span>{t('regions.load_more.see_more', 'Load More Stations')}</span>
                  <span className="text-sm opacity-80">({allStations.length}/{data?.pagination?.total || 0})</span>
                </div>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}