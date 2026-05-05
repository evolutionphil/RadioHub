import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { ChevronDown, Radio, MapPin, Search } from 'lucide-react';
import CityStateSlider from '@/components/CityStateSlider';
import StationCard from '@/components/ui/station-card';

// Austrian cities with alternative names
const AUSTRIAN_CITIES = [
  { name: 'Wien', stationCount: 11 }, // Wien/Vienna
  { name: 'Graz', stationCount: 5 },
  { name: 'Linz', stationCount: 4 },
  { name: 'Salzburg', stationCount: 6 },
  { name: 'Innsbruck', stationCount: 3 },
  { name: 'Klagenfurt', stationCount: 2 },
  { name: 'Villach', stationCount: 1 },
  { name: 'Wels', stationCount: 2 },
  { name: 'Sankt Pölten', stationCount: 1 },
  { name: 'Dornbirn', stationCount: 1 },
];

// Alternative name mapping
const CITY_NAME_MAPPING: { [key: string]: string } = {
  'Wien': 'Vienna',
  'Vienna': 'Wien',
};

interface Station {
  changeuuid: string;
  name: string;
  url: string;
  homepage: string;
  favicon: string;
  tags: string;
  country: string;
  countrycode: string;
  state: string;
  language: string;
  languagecodes: string;
  votes: number;
  lastchangetime: string;
  lastcheckok: number;
  lastchecktime: string;
  clickcount: number;
  clicktrend: number;
  ssl_error: number;
  geo_lat: number;
  geo_long: number;
  has_extended_info: boolean;
  slug: string;
}

export default function AustriaRadiosPage() {
  const [location, setLocation] = useLocation();
  
  // Parse URL parameters
  const urlParams = new URLSearchParams(window.location.search);
  const [selectedCity, setSelectedCity] = useState<string | null>(urlParams.get('state'));
  const [currentPage, setCurrentPage] = useState<number>(parseInt(urlParams.get('page') || '1'));
  const [sortBy, setSortBy] = useState<string>(urlParams.get('sort') || 'votes');
  
  // Update URL when parameters change
  useEffect(() => {
    const params = new URLSearchParams();
    if (selectedCity) params.set('state', selectedCity);
    if (currentPage > 1) params.set('page', currentPage.toString());
    if (sortBy !== 'votes') params.set('sort', sortBy);
    
    const newUrl = `/radios/austria${params.toString() ? '?' + params.toString() : ''}`;
    window.history.replaceState({}, '', newUrl);
  }, [selectedCity, currentPage, sortBy]);
  
  // Reset page when city changes (like GitHub example)
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedCity]);
  
  // Fetch stations data - use precomputed cache ONLY for votes sort without city filter
  const usePrecomputed = !selectedCity && sortBy === 'votes';
  
  const { data: stationsData, isLoading, error } = useQuery({
    queryKey: ['/api/stations', 'Austria', selectedCity, currentPage, sortBy],
    queryFn: async () => {
      // Use precomputed cache ONLY for default votes sort without city filter
      if (usePrecomputed) {
        const params = new URLSearchParams();
        params.append('countryName', 'Austria');
        params.append('page', currentPage.toString());
        params.append('limit', '24');
        const response = await fetch(`/api/stations/precomputed?${params}`);
        if (response.ok) {
          const result = await response.json();
          if (result.success && result.data.length > 0) {
            return {
              stations: result.data,
              total: result.pagination.total,
              pagination: result.pagination
            };
          }
        }
      }
      
      // Live query for city filters or non-votes sorts (clickcount, name, lastchangetime)
      const params = new URLSearchParams();
      params.append('country', 'Austria');
      if (selectedCity) {
        const mappedName = CITY_NAME_MAPPING[selectedCity] || selectedCity;
        params.append('state', selectedCity);
        if (mappedName !== selectedCity) {
          params.append('stateAlt', mappedName);
        }
      }
      params.append('page', currentPage.toString());
      params.append('limit', '24');
      params.append('sort', sortBy);
      
      const response = await fetch(`/api/stations?${params}`);
      if (!response.ok) throw new Error('Failed to fetch stations');
      return response.json();
    },
    // 7 days for precomputed, 5 minutes for live queries
    staleTime: usePrecomputed ? 7 * 24 * 60 * 60 * 1000 : 5 * 60 * 1000,
  });
  
  const stations = stationsData?.stations || [];
  const totalStations = stationsData?.total || 0;
  const totalPages = Math.ceil(totalStations / 24);
  
  const handleCitySelect = (city: string | null) => {
    setSelectedCity(city);
  };
  
  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#101010] text-white">
        <div className="bg-[#101010] md:bg-[#151515] py-2 md:py-7">
          <div className="container mx-auto flex items-center justify-between text-white">
            <div>
              <h1 className="text-lg md:text-3xl md:pb-3 font-bold">Austria Radio Stations</h1>
              <p className="text-[#838383]">Loading...</p>
            </div>
          </div>
        </div>
        
        <div className="container mx-auto py-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4 md:gap-6">
            {Array(12).fill(0).map((_, i) => (
              <div key={i} className="bg-[#1a1a1a] rounded-lg p-4 animate-pulse">
                <div className="h-4 bg-gray-600 rounded mb-2"></div>
                <div className="h-3 bg-gray-700 rounded mb-2"></div>
                <div className="h-3 bg-gray-700 rounded w-1/2"></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }
  
  return (
    <div className="min-h-screen bg-[#101010] text-white">
      {/* Header Section */}
      <div className="bg-[#101010] md:bg-[#151515] py-2 md:py-7">
        <div className="container mx-auto flex items-center justify-between text-white">
          <div>
            <h1 className="text-lg md:text-3xl md:pb-3 font-bold">Austria Radio Stations</h1>
            <p className="text-[#838383]">
              Austria{selectedCity && <span>, {selectedCity}</span>} 
              <span className="text-white ml-2">{totalStations}</span> stations
            </p>
          </div>
          
          {/* Sort Dropdown - Figma: 138x150, radius 8px, padding 18px, gap 16px, #000000 */}
          <div className="relative group">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="appearance-none bg-transparent border border-[#2F2F2F] rounded-lg px-4 py-2 pr-8 text-white text-sm focus:outline-none focus:border-pink-500 cursor-pointer"
              data-testid="sort-dropdown"
              style={{ minWidth: '138px' }}
            >
              <option value="votes">Trending</option>
              <option value="newest">Newest first</option>
              <option value="az">A-Z</option>
              <option value="za">Z-A</option>
            </select>
            {/* Dropdown arrow */}
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
            {/* Custom dropdown styling for options */}
            <style>{`
              select option {
                background-color: #000000;
                color: white;
                padding: 18px;
              }
            `}</style>
          </div>
        </div>
      </div>
      
      {/* City Slider Section */}
      {AUSTRIAN_CITIES.length > 0 && (
        <div className="bg-[#1a1a1a] py-4">
          <div className="container mx-auto">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 md:gap-6 p-2.5 md:p-0 rounded-[10px] bg-[#1C1C1C]">
              <CityStateSlider 
                cities={AUSTRIAN_CITIES}
                selectedCity={selectedCity}
                onCitySelect={handleCitySelect}
              />
            </div>
          </div>
        </div>
      )}
      
      {/* Stations Grid */}
      <div className="container mx-auto pb-10 pt-5 text-white">
        {error ? (
          <div className="text-center py-8">
            <Radio className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <h3 className="text-xl font-bold mb-2">Error Loading Stations</h3>
            <p className="text-gray-400">Please try again later</p>
          </div>
        ) : stations.length === 0 ? (
          <div className="text-center py-8">
            <Search className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <h3 className="text-xl font-bold mb-2">No Stations Found</h3>
            <p className="text-gray-400">
              {selectedCity 
                ? `No stations found in ${selectedCity}. Try selecting "All" to see all Austrian stations.`
                : 'No Austrian stations available at the moment.'
              }
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4 md:gap-6">
              {stations.map((station: Station) => (
                <StationCard 
                  key={station.changeuuid}
                  station={station}
                  playlistName="austriaStations"
                />
              ))}
            </div>
            
            {/* Pagination */}
            {totalPages > 1 && (
              <div className="py-8 flex justify-center">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                    disabled={currentPage === 1}
                    className={`px-4 py-2 rounded-lg ${
                      currentPage === 1 
                        ? 'bg-gray-600 text-gray-400 cursor-not-allowed' 
                        : 'bg-[#1a1a1a] text-white hover:bg-[#2a2a2a]'
                    }`}
                    data-testid="pagination-prev"
                  >
                    Previous
                  </button>
                  
                  <span className="px-4 py-2 text-gray-400">
                    Page {currentPage} of {totalPages}
                  </span>
                  
                  <button
                    onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                    disabled={currentPage === totalPages}
                    className={`px-4 py-2 rounded-lg ${
                      currentPage === totalPages 
                        ? 'bg-gray-600 text-gray-400 cursor-not-allowed' 
                        : 'bg-[#1a1a1a] text-white hover:bg-[#2a2a2a]'
                    }`}
                    data-testid="pagination-next"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}