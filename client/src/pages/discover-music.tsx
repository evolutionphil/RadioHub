import React, { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Search, Play, Pause, ExternalLink, Music, Disc, User, Clock } from 'lucide-react';
import { api } from '@/lib/api';
import { useDebounce } from '@/hooks/use-debounce';
import { useTranslation } from '@/hooks/useTranslation';
import { useSeoRouting } from '@/hooks/useSeoRouting';
import { Link } from 'wouter';

interface iTunesTrack {
  trackId: number;
  artistId: number;
  collectionId: number;
  trackName: string;
  artistName: string;
  collectionName: string;
  trackViewUrl: string;
  previewUrl: string;
  artworkUrl30: string;
  artworkUrl60: string;
  artworkUrl100: string;
  collectionPrice: number;
  trackPrice: number;
  releaseDate: string;
  collectionExplicitness: string;
  trackExplicitness: string;
  discCount: number;
  discNumber: number;
  trackCount: number;
  trackNumber: number;
  trackTimeMillis: number;
  country: string;
  currency: string;
  primaryGenreName: string;
  wrapperType: string;
  kind: string;
}

// Search history management
const SEARCH_HISTORY_KEY = 'discover_music_search_history';
const MAX_SEARCH_HISTORY = 10;

const getSearchHistory = (): string[] => {
  try {
    const history = localStorage.getItem(SEARCH_HISTORY_KEY);
    return history ? JSON.parse(history) : [];
  } catch {
    return [];
  }
};

const addToSearchHistory = (query: string) => {
  if (!query.trim()) return;
  
  const history = getSearchHistory();
  const filteredHistory = history.filter(item => item.toLowerCase() !== query.toLowerCase());
  const newHistory = [query, ...filteredHistory].slice(0, MAX_SEARCH_HISTORY);
  
  localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(newHistory));
};

export default function DiscoverMusic() {
  const { t } = useTranslation();
  const { getLocalizedUrl } = useSeoRouting();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchType, setSearchType] = useState<'song' | 'album' | 'artist'>('song');
  const [playingTrack, setPlayingTrack] = useState<string | null>(null);
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  
  // RESTORED: NO localStorage country detection that overwrites URLs
  // Country codes are only derived from URL - never from geo-detection storage
  
  // Load search history on component mount
  React.useEffect(() => {
    setSearchHistory(getSearchHistory());
  }, []);
  
  // Debounce search to avoid too many API calls
  const debouncedSearch = useDebounce(searchQuery, 300);
  
  const { data: searchResults, isLoading, error } = useQuery({
    queryKey: ['/api/discover/search', debouncedSearch, searchType],
    queryFn: () => {
      if (debouncedSearch.trim()) {
        addToSearchHistory(debouncedSearch.trim());
        setSearchHistory(getSearchHistory());
        setHasSearched(true);
      }
      return api.searchMusic(debouncedSearch, searchType, 50, 'US');
    },
    enabled: debouncedSearch.length >= 2,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Get iTunes Top 100 as default content
  const { data: top100Data, isLoading: top100Loading } = useQuery({
    queryKey: ['/api/discover/top100'],
    queryFn: () => api.getTop100Songs('US', 50),
    enabled: !hasSearched && searchQuery.length < 2,
    staleTime: 60 * 60 * 1000, // 1 hour
  });

  const handlePlayPreview = (previewUrl: string, trackId: string) => {
    if (!previewUrl) return;
    
    if (playingTrack === trackId) {
      // Stop current track
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
      setPlayingTrack(null);
    } else {
      // Stop any current audio
      if (audioRef.current) {
        audioRef.current.pause();
      }
      
      // Create new audio element
      const audio = new Audio(previewUrl);
      audioRef.current = audio;
      
      audio.play().then(() => {
        setPlayingTrack(trackId);
        
        // Auto-stop after 30 seconds or when ended
        audio.addEventListener('ended', () => {
          setPlayingTrack(null);
        });
        
        // Auto-stop after 30 seconds (preview limit)
        setTimeout(() => {
          if (playingTrack === trackId) {
            audio.pause();
            setPlayingTrack(null);
          }
        }, 30000);
      }).catch((error) => {
        console.error('Error playing preview:', error);
        setPlayingTrack(null);
      });
    }
  };

  const formatDuration = (milliseconds: number): string => {
    if (!milliseconds) return '';
    const minutes = Math.floor(milliseconds / 60000);
    const seconds = Math.floor((milliseconds % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const formatPrice = (price: number, currency: string = 'USD'): string => {
    if (!price) return 'Free';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency,
    }).format(price);
  };

  // Create SEO-friendly URL slugs
  const createSlug = (text: string): string => {
    return text
      .toLowerCase()
      .replace(/[^\w\s-]/g, '') // Remove special characters
      .replace(/\s+/g, '-') // Replace spaces with hyphens
      .replace(/-+/g, '-') // Replace multiple hyphens with single
      .trim()
      .substring(0, 50); // Limit length
  };

  const createTrackUrl = (track: iTunesTrack): string => {
    const songSlug = createSlug(track.trackName);
    const artistSlug = createSlug(track.artistName);
    const albumSlug = createSlug(track.collectionName);
    return `/discover-music/song/${track.trackId}/${songSlug}-${artistSlug}-${albumSlug}`;
  };

  const createAlbumUrl = (track: iTunesTrack): string => {
    const albumSlug = createSlug(track.collectionName);
    const artistSlug = createSlug(track.artistName);
    return `/discover-music/album/${track.collectionId}/${albumSlug}-${artistSlug}`;
  };

  const createArtistUrl = (track: iTunesTrack): string => {
    const artistSlug = createSlug(track.artistName);
    return `/discover-music/artist/${track.artistId}/${artistSlug}`;
  };

  const getHighQualityArtwork = (artworkUrl100: string): string => {
    if (!artworkUrl100) return '';
    return artworkUrl100.replace('100x100bb', '300x300bb');
  };

  const handleSearchHistoryClick = (query: string) => {
    setSearchQuery(query);
    setHasSearched(true);
  };

  const clearSearchHistory = () => {
    localStorage.removeItem(SEARCH_HISTORY_KEY);
    setSearchHistory([]);
  };

  // Determine what content to show
  const showDefaultContent = !hasSearched && searchQuery.length < 2;
  const showSearchResults = hasSearched && searchQuery.length >= 2;
  const displayResults = showSearchResults ? searchResults?.results : top100Data?.results;
  const displayLoading = showSearchResults ? isLoading : top100Loading;

  const renderTrackCard = (track: iTunesTrack) => (
    <div 
      key={`${track.trackId}-${track.collectionId}`} 
      className="group relative cursor-pointer overflow-hidden rounded-lg border border-gray-800 bg-[#1F1F1F] transition-all duration-300 hover:border-[#FF4199] hover:shadow-lg hover:shadow-[#FF4199]/20"
    >
      <div className="p-4">
        <div className="flex gap-4">
          {/* Chart Position (for Top 100) */}
          {(track as any).chartPosition && (
            <div className="flex-shrink-0 flex items-center justify-center">
              <div className="bg-[#FF4199] text-white rounded-full w-8 h-8 flex items-center justify-center text-sm font-bold">
                {(track as any).chartPosition}
              </div>
            </div>
          )}

          {/* Album Artwork */}
          <div className="flex-shrink-0">
            <img
              src={getHighQualityArtwork(track.artworkUrl100)}
              alt={`${track.collectionName} artwork`}
              className="h-20 w-20 rounded-lg object-cover shadow-md transition-transform duration-300 group-hover:scale-105"
              loading="lazy"
              onError={(e) => {
                const img = e.target as HTMLImageElement;
                img.src = track.artworkUrl100 || '/placeholder-album.png';
              }}
            />
          </div>
          
          {/* Track Info */}
          <div className="flex-grow min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-grow">
                <Link 
                  to={getLocalizedUrl(createTrackUrl(track))}
                  className="block truncate text-lg font-semibold text-white group-hover:text-[#FF4199] transition-colors hover:text-[#FF4199]" 
                  title={track.trackName}
                >
                  {track.trackName}
                </Link>
                <Link 
                  to={getLocalizedUrl(createArtistUrl(track))}
                  className="block truncate text-gray-300 hover:text-[#FF4199] transition-colors" 
                  title={track.artistName}
                >
                  {track.artistName}
                </Link>
                <Link 
                  to={getLocalizedUrl(createAlbumUrl(track))}
                  className="block truncate text-sm text-gray-400 hover:text-[#FF4199] transition-colors" 
                  title={track.collectionName}
                >
                  {track.collectionName}
                </Link>
                
                <div className="mt-2 flex items-center gap-4 text-sm text-gray-400">
                  {track.trackTimeMillis && (
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatDuration(track.trackTimeMillis)}
                    </span>
                  )}
                  {track.primaryGenreName && (
                    <span className="rounded-full bg-[#2F2F2F] px-2 py-1 text-xs text-gray-300">
                      {track.primaryGenreName}
                    </span>
                  )}
                  {track.releaseDate && (
                    <span>{new Date(track.releaseDate).getFullYear()}</span>
                  )}
                </div>
              </div>
              
              {/* Price */}
              {track.trackPrice !== undefined && (
                <div className="text-right">
                  <p className="text-sm font-medium text-white">
                    {formatPrice(track.trackPrice, track.currency)}
                  </p>
                </div>
              )}
            </div>
            
            {/* Action Buttons */}
            <div className="mt-3 flex items-center gap-2">
              {track.previewUrl && (
                <button
                  onClick={() => handlePlayPreview(track.previewUrl, track.trackId.toString())}
                  className={`flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-medium transition-all duration-200 ${
                    playingTrack === track.trackId.toString()
                      ? 'bg-[#FF4199] text-white hover:bg-[#E63689]'
                      : 'bg-[#2F2F2F] text-gray-300 hover:bg-[#404040] hover:text-white'
                  }`}
                  data-testid={`button-preview-${track.trackId}`}
                >
                  {playingTrack === track.trackId.toString() ? (
                    <>
                      <Pause className="h-3 w-3" />
                      Stop Preview
                    </>
                  ) : (
                    <>
                      <Play className="h-3 w-3" />
                      30s Preview
                    </>
                  )}
                </button>
              )}
              
              {track.trackViewUrl && (
                <a
                  href={track.trackViewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 rounded-lg bg-[#2F2F2F] px-3 py-1.5 text-sm font-medium text-gray-300 transition-all duration-200 hover:bg-[#404040] hover:text-white"
                  data-testid={`button-itunes-${track.trackId}`}
                >
                  <ExternalLink className="h-3 w-3" />
                  View on iTunes
                </a>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#0E0E0E] text-white">
      {/* Hero Section */}
      <div className="relative bg-gradient-to-r from-[#FF4199] via-[#E63689] to-[#C42D72] py-16">
        <div className="container mx-auto px-4 text-center">
          <h1 className="mb-4 text-4xl font-bold text-white sm:text-5xl">
            Discover Music
          </h1>
          <p className="mx-auto max-w-2xl text-lg text-white/90">
            Search for songs, albums, and artists from the iTunes catalog. Listen to 30-second previews and find your next favorite track.
          </p>
          <p className="mt-2 text-sm text-white/70">
            Powered by Apple's iTunes Search API
          </p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8">
        {/* Search Interface */}
        <div className="mb-8 rounded-lg border border-gray-800 bg-[#1F1F1F] p-6">
          <div className="mb-4 flex items-center gap-2">
            <Search className="h-5 w-5 text-[#FF4199]" />
            <h2 className="text-xl font-semibold text-white">Music Search</h2>
          </div>
          
          <div className="flex flex-col gap-4 sm:flex-row">
            <div className="flex-grow">
              <input
                type="text"
                placeholder="Search for songs, albums, or artists..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-lg border border-gray-700 bg-[#2F2F2F] px-4 py-3 text-white placeholder-gray-400 focus:border-[#FF4199] focus:outline-none focus:ring-1 focus:ring-[#FF4199]"
                data-testid="input-search-music"
              />
            </div>
            
            <div className="flex rounded-lg border border-gray-700 bg-[#2F2F2F]">
              {(['song', 'album', 'artist'] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => setSearchType(type)}
                  className={`flex items-center gap-1 px-4 py-3 text-sm font-medium transition-all duration-200 first:rounded-l-lg last:rounded-r-lg ${
                    searchType === type
                      ? 'bg-[#FF4199] text-white'
                      : 'text-gray-300 hover:bg-[#404040] hover:text-white'
                  }`}
                >
                  {type === 'song' && <Music className="h-3 w-3" />}
                  {type === 'album' && <Disc className="h-3 w-3" />}
                  {type === 'artist' && <User className="h-3 w-3" />}
                  {type.charAt(0).toUpperCase() + type.slice(1)}s
                </button>
              ))}
            </div>
          </div>
          
          {debouncedSearch.length > 0 && debouncedSearch.length < 2 && (
            <p className="mt-2 text-sm text-gray-400">
              Enter at least 2 characters to search...
            </p>
          )}
        </div>

        {/* Search History */}
        {showDefaultContent && searchHistory.length > 0 && (
          <div className="mb-8 rounded-lg border border-gray-800 bg-[#1F1F1F] p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">Recent Searches</h3>
              <button
                onClick={clearSearchHistory}
                className="text-sm text-gray-400 hover:text-[#FF4199] transition-colors"
                data-testid="button-clear-history"
              >
                Clear History
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {searchHistory.map((query, index) => (
                <button
                  key={index}
                  onClick={() => handleSearchHistoryClick(query)}
                  className="rounded-full bg-[#2F2F2F] px-3 py-1 text-sm text-gray-300 hover:bg-[#FF4199] hover:text-white transition-all duration-200"
                  data-testid={`button-history-${index}`}
                >
                  {query}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Loading States */}
        {displayLoading && (
          <div className="py-8 text-center">
            <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-b-2 border-[#FF4199]"></div>
            <p className="text-gray-300">
              {showSearchResults ? 'Searching iTunes catalog...' : 'Loading top songs...'}
            </p>
          </div>
        )}

        {/* Error States */}
        {(error || (top100Data?.error)) && (
          <div className="rounded-lg border border-red-800 bg-red-900/20 p-4">
            <p className="text-red-400">
              {showSearchResults 
                ? `Error searching music: ${(error as any)?.message || 'Unknown error'}`
                : `Error loading top songs: ${top100Data?.message || 'Unknown error'}`
              }
            </p>
          </div>
        )}

        {/* Content Display */}
        {displayResults && displayResults.length > 0 && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-semibold text-white">
                {showSearchResults ? 'Search Results' : 'iTunes Top Songs'}
                {top100Data?.chartPosition && ` (Chart Position: #${top100Data.chartPosition})`}
              </h2>
              <div className="text-sm text-gray-400">
                {showSearchResults ? (
                  <>
                    {searchResults?.total || displayResults.length} results found
                    {searchResults?.cached && <span className="ml-2 text-[#FF4199]">(cached)</span>}
                  </>
                ) : (
                  <>
                    Top {displayResults.length} songs
                    {top100Data?.cached && <span className="ml-2 text-[#FF4199]">(cached)</span>}
                  </>
                )}
              </div>
            </div>
            
            <div className="grid gap-4" data-testid={showSearchResults ? "search-results" : "top100-results"}>
              {displayResults.map((track: iTunesTrack) => renderTrackCard(track))}
            </div>
          </div>
        )}

        {/* No Results */}
        {showSearchResults && searchResults && (!displayResults || displayResults.length === 0) && !isLoading && (
          <div className="rounded-lg border border-gray-800 bg-[#1F1F1F] p-8 text-center">
            <Music className="mx-auto mb-4 h-12 w-12 text-gray-500" />
            <p className="text-gray-300">
              No results found for "{debouncedSearch}". Try different search terms.
            </p>
          </div>
        )}

        {/* Default Empty State */}
        {showDefaultContent && !top100Loading && (!top100Data?.results || top100Data.results.length === 0) && (
          <div className="rounded-lg border border-gray-800 bg-[#1F1F1F] p-8 text-center">
            <Music className="mx-auto mb-4 h-12 w-12 text-gray-500" />
            <p className="text-gray-300">
              Welcome to music discovery! Use the search above to find your favorite songs, albums, or artists.
            </p>
          </div>
        )}

        {/* Apple Attribution */}
        <div className="mt-12 border-t border-gray-800 pt-6 text-center text-sm text-gray-400">
          <p>
            Music data and previews provided by Apple's iTunes Search API. 
            Album artwork and preview clips are property of their respective copyright holders.
          </p>
          <p className="mt-1">
            This service is not affiliated with Apple Inc.
          </p>
        </div>
      </div>
    </div>
  );
}