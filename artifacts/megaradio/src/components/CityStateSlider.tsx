import React, { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface City {
  name: string;
  stationCount?: number;
}

interface CityStateSliderProps {
  cities: City[];
  selectedCity: string | null;
  onCitySelect: (city: string | null) => void;
}

export default function CityStateSlider({ cities, selectedCity, onCitySelect }: CityStateSliderProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const itemsPerView = 6; // Show 6 cities at a time
  
  const canScrollLeft = currentIndex > 0;
  const canScrollRight = currentIndex < cities.length - itemsPerView;
  
  const scrollLeft = () => {
    if (canScrollLeft) {
      setCurrentIndex(currentIndex - 1);
    }
  };
  
  const scrollRight = () => {
    if (canScrollRight) {
      setCurrentIndex(currentIndex + 1);
    }
  };
  
  const visibleCities = cities.slice(currentIndex, currentIndex + itemsPerView);
  
  return (
    <div className="flex items-center gap-4">
      <p className="text-[#777777] whitespace-nowrap text-nowrap hidden md:block">
        Broadcast Cities
      </p>
      
      <div className="flex-1 overflow-hidden">
        <div className="flex items-center gap-2">
          {/* All Cities Option */}
          <button
            onClick={() => onCitySelect(null)}
            className={`px-4 py-2 text-white cursor-pointer select-none border border-[#2F2F2F] rounded-lg transition-colors ${
              !selectedCity ? 'bg-pink-500' : 'bg-[#1a1a1a] hover:bg-[#2a2a2a]'
            }`}
            data-testid="city-all"
          >
            All
          </button>
          
          {/* City Options */}
          {visibleCities.map((city) => (
            <button
              key={city.name}
              onClick={() => onCitySelect(city.name)}
              className={`px-4 py-2 text-white cursor-pointer select-none border border-[#2F2F2F] rounded-lg whitespace-nowrap transition-colors ${
                selectedCity === city.name ? 'bg-pink-500' : 'bg-[#1a1a1a] hover:bg-[#2a2a2a]'
              }`}
              data-testid={`city-${city.name.toLowerCase().replace(/\s+/g, '-')}`}
            >
              {city.name}
              {city.stationCount && (
                <span className="ml-2 text-xs text-gray-400">({city.stationCount})</span>
              )}
            </button>
          ))}
        </div>
      </div>
      
      {/* Navigation Arrows */}
      <div className="flex gap-2 hidden md:flex">
        <button
          onClick={scrollLeft}
          disabled={!canScrollLeft}
          className={`p-2 ${canScrollLeft ? 'text-white hover:text-pink-400' : 'text-gray-600 cursor-not-allowed'} transition-colors`}
          data-testid="slider-prev"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <button
          onClick={scrollRight}
          disabled={!canScrollRight}
          className={`p-2 ${canScrollRight ? 'text-white hover:text-pink-400' : 'text-gray-600 cursor-not-allowed'} transition-colors`}
          data-testid="slider-next"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}