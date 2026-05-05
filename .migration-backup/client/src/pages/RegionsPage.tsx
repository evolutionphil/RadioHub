import React, { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import { Globe, MapPin, Users } from 'lucide-react';
import { useTranslation } from '../hooks/useTranslation';
import { getLocalizedPath } from '@/utils/slugs';

interface Region {
  slug: string;
  name: string;
  countryCount: number;
}

const regionIcons: { [key: string]: React.ReactNode } = {
  'africa': <span className="text-2xl">🌍</span>,
  'asia': <span className="text-2xl">🌏</span>,
  'europe': <span className="text-2xl">🌍</span>,
  'north-america': <span className="text-2xl">🌎</span>,
  'south-america': <span className="text-2xl">🌎</span>,
  'oceania': <span className="text-2xl">🌏</span>
};

export default function RegionsPage() {
  const { t } = useTranslation();
  
  // RESTORED: NO localStorage country detection that overwrites URLs
  // Country codes are only derived from URL - never from geo-detection storage
  
  const { data: regionsResponse, isLoading, error } = useQuery({
    queryKey: ['/api/regions'],
    select: (data: { success: boolean; data: Region[] }) => data.data
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800 text-white">
        <div className="container mx-auto px-4 py-8">
          {/* Header skeleton */}
          <div className="text-center mb-12">
            <div className="w-96 h-12 bg-slate-700 rounded-lg mx-auto mb-4 animate-pulse"></div>
            <div className="w-[500px] h-6 bg-slate-700 rounded-lg mx-auto animate-pulse"></div>
          </div>
          
          {/* Grid skeleton */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto">
            {[1, 2, 3, 4, 5, 6].map(i => (
              <div key={i} className="bg-slate-800 rounded-2xl p-8 animate-pulse">
                <div className="w-12 h-12 bg-slate-700 rounded-full mb-4"></div>
                <div className="w-32 h-8 bg-slate-700 rounded-lg mb-3"></div>
                <div className="w-24 h-6 bg-slate-700 rounded-lg"></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800 text-white flex items-center justify-center">
        <div className="text-center">
          <Globe className="w-16 h-16 text-slate-400 mx-auto mb-4" />
          <h2 className="text-2xl font-bold mb-2">{t('regions.error.title')}</h2>
          <p className="text-slate-400">{t('regions.error.description')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800 text-white">
      <div className="container mx-auto px-4 py-8">
        {/* Hero Section */}
        <div className="text-center mb-12">
          <div className="flex justify-center items-center gap-3 mb-6">
            <Globe className="w-12 h-12 text-pink-400" />
            <h1 className="text-4xl md:text-5xl font-bold bg-gradient-to-r from-pink-400 to-purple-400 bg-clip-text text-transparent">
              {t('regions.page.title', 'Explore World Regions')}
            </h1>
          </div>
          <p className="text-xl text-slate-300 max-w-2xl mx-auto leading-relaxed">
            {t('regions.page.subtitle', 'Discover radio stations from different regions around the world')}
          </p>
        </div>

        {/* Regions Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto">
          {regionsResponse?.map((region) => (
            <Link 
              key={region.slug} 
              href={getLocalizedPath(`/regions/${region.slug}`)}
              className="group"
            >
              <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700/50 rounded-2xl p-8 hover:bg-slate-700/50 hover:border-slate-600/50 transition-all duration-300 hover:scale-105 hover:shadow-2xl hover:shadow-pink-500/10 cursor-pointer">
                
                {/* Region Icon */}
                <div className="flex justify-center mb-6">
                  <div className="w-20 h-20 bg-gradient-to-br from-pink-500/20 to-purple-600/20 border border-pink-500/30 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                    {regionIcons[region.slug] || <MapPin className="w-8 h-8 text-pink-400" />}
                  </div>
                </div>

                {/* Region Name */}
                <h3 className="text-2xl font-bold text-center mb-4 group-hover:text-pink-400 transition-colors duration-300">
                  {region.name}
                </h3>

                {/* Country Count */}
                <div className="flex items-center justify-center gap-2 text-slate-400 group-hover:text-slate-300 transition-colors duration-300">
                  <Users className="w-4 h-4" />
                  <span className="text-sm font-medium">
                    {t('regions.countries.count', `${region.countryCount} countries`, { count: region.countryCount.toString() })}
                  </span>
                </div>

                {/* Hover Arrow */}
                <div className="flex justify-center mt-6 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                  <div className="flex items-center gap-2 text-pink-400 text-sm font-medium">
                    {t('regions.explore')}
                    <svg className="w-4 h-4 transform group-hover:translate-x-1 transition-transform duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>

        {/* Stats Section */}
        {regionsResponse && (
          <div className="mt-16 text-center">
            <div className="bg-slate-800/30 backdrop-blur-sm border border-slate-700/50 rounded-2xl p-8 max-w-2xl mx-auto">
              <h3 className="text-2xl font-bold mb-4 text-pink-400">
                {t('regions.stats.title')}
              </h3>
              <div className="grid grid-cols-2 gap-8">
                <div>
                  <div className="text-3xl font-bold text-white mb-1">
                    {regionsResponse.length}
                  </div>
                  <div className="text-slate-400 text-sm">
                    {t('regions.stats.total_regions')}
                  </div>
                </div>
                <div>
                  <div className="text-3xl font-bold text-white mb-1">
                    {regionsResponse.reduce((sum, region) => sum + region.countryCount, 0)}
                  </div>
                  <div className="text-slate-400 text-sm">
                    {t('regions.stats.total_countries')}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}