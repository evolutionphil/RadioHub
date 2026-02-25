import React, { useState, useRef } from 'react';
import { useParams, Link } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Play, Pause, ExternalLink, Clock, Music, Disc, User, Eye, Users, Heart } from 'lucide-react';
import { api } from '@/lib/api';
import { useTranslation } from '@/hooks/useTranslation';
import { useSeoRouting } from '@/hooks/useSeoRouting';

export default function ArtistDetail() {
  const { t } = useTranslation();
  const { getLocalizedUrl } = useSeoRouting();
  const { id } = useParams<{ id: string }>();
  const [playingTrack, setPlayingTrack] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const { data: artistData, isLoading, error } = useQuery({
    queryKey: ['/api/discover/artist', id],
    queryFn: () => api.getArtistDetails(id!),
    enabled: !!id,
    staleTime: 10 * 60 * 1000, // 10 minutes
  });

  const formatNumber = (num: string | number): string => {
    if (!num) return '';
    const number = typeof num === 'string' ? parseInt(num) : num;
    if (number >= 1000000) {
      return (number / 1000000).toFixed(1) + 'M';
    }
    if (number >= 1000) {
      return (number / 1000).toFixed(1) + 'K';
    }
    return number.toString();
  };

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
        
        // Auto-stop when ended
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

  const getHighQualityArtwork = (artworkUrl100: string): string => {
    if (!artworkUrl100) return '';
    return artworkUrl100.replace('100x100bb', '600x600bb');
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#0E0E0E] text-white">
        <div className="container mx-auto px-4 py-8">
          <div className="animate-pulse">
            <div className="mb-8 h-8 w-64 rounded bg-[#2F2F2F]"></div>
            <div className="grid gap-8 lg:grid-cols-2">
              <div className="h-96 w-full rounded-lg bg-[#2F2F2F]"></div>
              <div className="space-y-4">
                <div className="h-8 w-3/4 rounded bg-[#2F2F2F]"></div>
                <div className="h-6 w-1/2 rounded bg-[#2F2F2F]"></div>
                <div className="h-4 w-1/3 rounded bg-[#2F2F2F]"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !artistData?.artist) {
    return (
      <div className="min-h-screen bg-[#0E0E0E] text-white">
        <div className="container mx-auto px-4 py-8">
          <Link to={getLocalizedUrl('/discover-music')} className="mb-8 flex items-center gap-2 text-[#FF4199] hover:text-white">
            <ArrowLeft className="h-4 w-4" />
            Back to Discover Music
          </Link>
          <div className="rounded-lg border border-red-800 bg-red-900/20 p-8 text-center">
            <User className="mx-auto mb-4 h-12 w-12 text-red-400" />
            <h1 className="mb-2 text-2xl font-bold text-red-400">Artist Not Found</h1>
            <p className="text-red-300">Sorry, we couldn't find the artist you're looking for.</p>
          </div>
        </div>
      </div>
    );
  }

  const artist = artistData.artist;
  const albums = artistData.albums || [];
  const tracks = artistData.tracks || [];
  const biography = artistData.biography;
  const similarArtists = artistData.similarArtists || [];

  return (
    <div className="min-h-screen bg-[#0E0E0E] text-white">
      <div className="container mx-auto px-4 py-8">
        {/* Back Navigation */}
        <Link to={getLocalizedUrl('/discover-music')} className="mb-8 flex items-center gap-2 text-[#FF4199] hover:text-white transition-colors">
          <ArrowLeft className="h-4 w-4" />
          Back to Discover Music
        </Link>

        {/* Artist Details */}
        <div className="mb-12 text-center">
          <h1 className="mb-4 text-5xl font-bold text-white">{artist.artistName}</h1>
          
          {/* Artist Stats */}
          <div className="flex justify-center gap-8 text-gray-300 mb-6">
            <div className="flex items-center gap-2">
              <Music className="h-4 w-4 text-[#FF4199]" />
              <span>{artist.primaryGenreName || 'Music'}</span>
            </div>
            {albums.length > 0 && (
              <div className="flex items-center gap-2">
                <Disc className="h-4 w-4 text-[#FF4199]" />
                <span>{albums.length} Albums</span>
              </div>
            )}
            {tracks.length > 0 && (
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-[#FF4199]" />
                <span>{tracks.length} Tracks</span>
              </div>
            )}
          </div>

          {/* Last.fm Stats */}
          {biography && (biography.listeners || biography.playcount) && (
            <div className="flex justify-center gap-8 text-sm text-gray-400 mb-6">
              {biography.listeners && (
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-[#FF4199]" />
                  <span>{formatNumber(biography.listeners)} listeners</span>
                </div>
              )}
              {biography.playcount && (
                <div className="flex items-center gap-2">
                  <Eye className="h-4 w-4 text-[#FF4199]" />
                  <span>{formatNumber(biography.playcount)} plays</span>
                </div>
              )}
            </div>
          )}
          
          {artist.artistViewUrl && (
            <div className="mt-6">
              <a
                href={artist.artistViewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg bg-[#FF4199] px-6 py-3 font-medium text-white transition-all duration-200 hover:bg-[#E63689]"
                data-testid="button-itunes"
              >
                <ExternalLink className="h-4 w-4" />
                View on iTunes
              </a>
            </div>
          )}
        </div>

        {/* Artist Biography */}
        {biography && (biography.summary || biography.content) && (
          <div className="mb-12">
            <h2 className="mb-6 text-2xl font-bold text-white">About {artist.artistName}</h2>
            <div className="rounded-lg border border-gray-800 bg-[#1F1F1F] p-6">
              {biography.content && (
                <div className="prose prose-invert max-w-none">
                  <p className="text-gray-300 leading-relaxed whitespace-pre-line">
                    {biography.content}
                  </p>
                </div>
              )}
              
              {/* Tags */}
              {biography.tags && biography.tags.length > 0 && (
                <div className="mt-6 pt-4 border-t border-gray-800">
                  <h3 className="mb-3 text-sm font-medium text-gray-400">GENRES & TAGS</h3>
                  <div className="flex flex-wrap gap-2">
                    {biography.tags.slice(0, 8).map((tag: any, index: number) => (
                      <span
                        key={index}
                        className="rounded-full bg-[#2F2F2F] px-3 py-1 text-xs text-gray-300 hover:bg-[#FF4199] hover:text-white transition-colors"
                      >
                        {tag.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Similar Artists */}
        {similarArtists && similarArtists.length > 0 && (
          <div className="mb-12">
            <h2 className="mb-6 text-2xl font-bold text-white">Similar Artists</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              {similarArtists.slice(0, 10).map((similarArtist: any, index: number) => (
                <div
                  key={index}
                  className="group cursor-pointer rounded-lg border border-gray-800 bg-[#1F1F1F] p-4 transition-all duration-300 hover:border-[#FF4199] hover:shadow-lg hover:shadow-[#FF4199]/20"
                >
                  {similarArtist.image && similarArtist.image[0] && (
                    <div className="mb-3 aspect-square overflow-hidden rounded-lg">
                      <img
                        src={similarArtist.image.find((img: any) => img.size === 'large')?.['#text'] || similarArtist.image[0]['#text']}
                        alt={`${similarArtist.name} photo`}
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                        onError={(e) => {
                          const img = e.target as HTMLImageElement;
                          img.style.display = 'none';
                        }}
                      />
                    </div>
                  )}
                  <h3 className="truncate text-center font-medium text-white group-hover:text-[#FF4199] transition-colors">
                    {similarArtist.name}
                  </h3>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Albums Section */}
        {albums.length > 0 && (
          <div className="mb-12">
            <h2 className="mb-6 text-2xl font-bold text-white">Albums</h2>
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {albums.map((album: any) => (
                <Link
                  key={album.collectionId}
                  to={getLocalizedUrl(`/discover-music/album/${album.collectionId}`)}
                  className="group cursor-pointer"
                >
                  <div className="overflow-hidden rounded-lg border border-gray-800 bg-[#1F1F1F] transition-all duration-300 hover:border-[#FF4199] hover:shadow-lg hover:shadow-[#FF4199]/20">
                    <div className="aspect-square overflow-hidden">
                      <img
                        src={getHighQualityArtwork(album.artworkUrl100)}
                        alt={`${album.collectionName} artwork`}
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                        onError={(e) => {
                          const img = e.target as HTMLImageElement;
                          img.src = album.artworkUrl100 || '/placeholder-album.png';
                        }}
                      />
                    </div>
                    <div className="p-4">
                      <h3 className="truncate font-semibold text-white group-hover:text-[#FF4199] transition-colors">
                        {album.collectionName}
                      </h3>
                      {album.releaseDate && (
                        <p className="text-sm text-gray-400">
                          {new Date(album.releaseDate).getFullYear()}
                        </p>
                      )}
                      {album.collectionPrice !== undefined && (
                        <p className="text-sm font-medium text-[#FF4199]">
                          {formatPrice(album.collectionPrice, album.currency)}
                        </p>
                      )}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Popular Tracks Section */}
        {tracks.length > 0 && (
          <div className="mb-12">
            <h2 className="mb-6 text-2xl font-bold text-white">Popular Tracks</h2>
            <div className="space-y-2">
              {tracks.slice(0, 10).map((track: any, index: number) => (
                <div
                  key={track.trackId}
                  className="group flex items-center gap-4 rounded-lg border border-gray-800 bg-[#1F1F1F] p-4 transition-all duration-200 hover:border-[#FF4199] hover:bg-[#2F2F2F]"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#2F2F2F] text-sm font-medium text-gray-300">
                    {index + 1}
                  </div>
                  
                  <div className="h-12 w-12 flex-shrink-0 overflow-hidden rounded">
                    <img
                      src={track.artworkUrl60 || track.artworkUrl100}
                      alt={`${track.trackName} artwork`}
                      className="h-full w-full object-cover"
                      onError={(e) => {
                        const img = e.target as HTMLImageElement;
                        img.src = '/placeholder-album.png';
                      }}
                    />
                  </div>
                  
                  <div className="min-w-0 flex-grow">
                    <Link 
                      to={getLocalizedUrl(`/discover-music/song/${track.trackId}`)}
                      className="font-medium text-white hover:text-[#FF4199] transition-colors"
                    >
                      {track.trackName}
                    </Link>
                    <div className="flex items-center gap-4 text-sm text-gray-400">
                      {track.collectionName && (
                        <Link 
                          to={getLocalizedUrl(`/discover-music/album/${track.collectionId}`)}
                          className="hover:text-[#FF4199] transition-colors"
                        >
                          {track.collectionName}
                        </Link>
                      )}
                      {track.trackTimeMillis && (
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatDuration(track.trackTimeMillis)}
                        </span>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    {track.trackPrice !== undefined && (
                      <span className="text-sm text-gray-300">
                        {formatPrice(track.trackPrice, track.currency)}
                      </span>
                    )}
                    
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
                          <Pause className="h-3 w-3" />
                        ) : (
                          <Play className="h-3 w-3" />
                        )}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Apple Attribution */}
        <div className="mt-8 border-t border-gray-800 pt-4 text-center text-sm text-gray-400">
          <p>Music data and previews provided by Apple's iTunes Search API.</p>
        </div>
      </div>
    </div>
  );
}