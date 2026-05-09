import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'wouter';
import { ArrowLeft, MapPin, Search, Globe, Radio, Filter } from 'lucide-react';
import { useTranslation } from '../hooks/useTranslation';
import { getLocalizedPath } from '@/utils/slugs';

interface Country {
  name: string;
  slug: string;
  stationCount: number;
}

interface RegionData {
  region: {
    name: string;
    slug: string;
  };
  countries: Country[];
}

const regionIcons: { [key: string]: React.ReactNode } = {
  'africa': <span className="text-2xl">🌍</span>,
  'asia': <span className="text-2xl">🌏</span>,
  'europe': <span className="text-2xl">🌍</span>,
  'north-america': <span className="text-2xl">🌎</span>,
  'south-america': <span className="text-2xl">🌎</span>,
  'oceania': <span className="text-2xl">🌏</span>
};

export default function RegionCountriesPage() {
  const { regionSlug } = useParams() as { regionSlug: string };
  const { t } = useTranslation();
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'stations'>('stations');
  
  const { data, isLoading, error } = useQuery({
    queryKey: [`/api/regions/${regionSlug}`],
    select: (response: { success: boolean; data: RegionData }) => response.data
  });

  // Filter and sort countries
  const filteredAndSortedCountries = useMemo(() => {
    if (!data?.countries) return [];
    
    let countries = data.countries.filter(country =>
      country.name.toLowerCase().includes(searchTerm.toLowerCase())
    );
    
    countries.sort((a, b) => {
      if (sortBy === 'name') {
        return a.name.localeCompare(b.name);
      }
      return b.stationCount - a.stationCount;
    });
    
    return countries;
  }, [data?.countries, searchTerm, sortBy]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800 text-white">
        <div className="container mx-auto px-4 py-8">
          {/* Header skeleton */}
          <div className="flex items-center gap-4 mb-8">
            <div className="w-10 h-10 bg-slate-700 rounded-lg animate-pulse"></div>
            <div className="w-64 h-8 bg-slate-700 rounded-lg animate-pulse"></div>
          </div>
          
          {/* Search skeleton */}
          <div className="w-full max-w-96 h-12 bg-slate-700 rounded-lg mb-8 animate-pulse"></div>
          
          {/* Grid skeleton */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {[1, 2, 3, 4, 5, 6, 7, 8].map(i => (
              <div key={i} className="bg-slate-800 rounded-xl p-6 animate-pulse">
                <div className="w-full h-6 bg-slate-700 rounded mb-3"></div>
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
          <Globe className="w-16 h-16 text-slate-400 mx-auto mb-4" />
          <h2 className="text-2xl font-bold mb-2">{t('regions.error.title', 'Region Not Found')}</h2>
          <p className="text-slate-400">{t('regions.error.description', 'Sorry, we could not find any countries or stations for this region. Please try another region.')}</p>
          <Link href={getLocalizedPath("/regions")} className="inline-block mt-4 px-6 py-2 bg-pink-600 hover:bg-pink-700 text-white rounded-lg transition-colors">
            {t('regions.back_to_regions', 'Back to Regions')}
          </Link>
        </div>
      </div>
    );
  }

  const totalStations = filteredAndSortedCountries.reduce((sum, country) => sum + country.stationCount, 0);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800 text-white">
      <div className="container mx-auto px-4 py-8">
        
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Link 
            href={getLocalizedPath("/regions")} 
            className="p-2 bg-slate-800/50 hover:bg-slate-700/50 border border-slate-700/50 hover:border-slate-600/50 rounded-lg transition-all duration-200 hover:scale-105"
          >
            <ArrowLeft className="w-6 h-6" />
          </Link>
          
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-pink-500/20 to-purple-600/20 border border-pink-500/30 rounded-lg">
              {regionIcons[regionSlug] || <Globe className="w-6 h-6 text-pink-400" />}
            </div>
            <div>
              <h1 className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-pink-400 to-purple-400 bg-clip-text text-transparent">
                {data.region.name}
              </h1>
              <p className="text-slate-400 mt-1">
                {t('regions.countries.subtitle', `${filteredAndSortedCountries.length} countries`, { count: filteredAndSortedCountries.length.toString() })}
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
              placeholder={t('regions.search.placeholder')}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-3 bg-slate-800/50 border border-slate-700/50 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-pink-500/50 focus:border-pink-500/50 transition-all duration-200"
              data-testid="search-countries"
            />
          </div>
          
          <div className="flex items-center gap-2">
            <Filter className="w-5 h-5 text-slate-400" />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'name' | 'stations')}
              className="px-4 py-3 bg-slate-800/50 border border-slate-700/50 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-pink-500/50 focus:border-pink-500/50 transition-all duration-200"
              data-testid="sort-countries"
            >
              <option value="stations">{t('regions.sort.by_stations')}</option>
              <option value="name">{t('regions.sort.by_name')}</option>
            </select>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <div className="bg-slate-800/30 backdrop-blur-sm border border-slate-700/50 rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-pink-400">
              {filteredAndSortedCountries.length}
            </div>
            <div className="text-slate-400 text-sm">
              {t('regions.stats.countries')}
            </div>
          </div>
          <div className="bg-slate-800/30 backdrop-blur-sm border border-slate-700/50 rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-green-400">
              {totalStations.toLocaleString()}
            </div>
            <div className="text-slate-400 text-sm">
              {t('regions.stats.stations')}
            </div>
          </div>
          <div className="bg-slate-800/30 backdrop-blur-sm border border-slate-700/50 rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-blue-400">
              {Math.round(totalStations / filteredAndSortedCountries.length) || 0}
            </div>
            <div className="text-slate-400 text-sm">
              {t('regions.stats.avg_per_country')}
            </div>
          </div>
        </div>

        {/* Countries Grid */}
        {filteredAndSortedCountries.length === 0 ? (
          <div className="text-center py-12">
            <Search className="w-16 h-16 text-slate-400 mx-auto mb-4" />
            <h3 className="text-xl font-bold mb-2">{t('regions.search.no_results')}</h3>
            <p className="text-slate-400">{t('regions.search.try_different')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredAndSortedCountries.map((country) => (
              <Link 
                key={country.slug}
                href={getLocalizedPath(`/regions/${regionSlug}/${country.slug}`)}
                className="group"
              >
                <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700/50 hover:border-slate-600/50 rounded-xl p-6 hover:bg-slate-700/50 transition-all duration-200 hover:scale-105 cursor-pointer">
                  
                  {/* Country Name */}
                  <div className="flex items-start justify-between mb-3">
                    <h3 className="text-lg font-semibold text-white group-hover:text-pink-400 transition-colors duration-200 leading-tight">
                      {country.name}
                    </h3>
                    <MapPin className="w-4 h-4 text-slate-400 group-hover:text-pink-400 transition-colors duration-200 flex-shrink-0 mt-1" />
                  </div>
                  
                  {/* Station Count */}
                  <div className="flex items-center gap-2 text-slate-400 group-hover:text-slate-300 transition-colors duration-200">
                    <Radio className="w-4 h-4" />
                    <span className="text-sm font-medium">
                      {country.stationCount === 0 
                        ? t('regions.stations.none', 'No stations')
                        : `${country.stationCount} ${country.stationCount === 1 ? 'station' : 'stations'}`
                      }
                    </span>
                  </div>
                  
                  {country.stationCount > 0 && (
                    <div className="mt-4 flex justify-end opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                      <div className="text-pink-400 text-sm font-medium flex items-center gap-1">
                        {t('regions.explore', 'Explore')}
                        <svg className="w-3 h-3 transform group-hover:translate-x-1 transition-transform duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </div>
                    </div>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}