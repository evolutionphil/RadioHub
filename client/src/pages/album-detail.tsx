import React, { useState, useRef } from 'react';
import { useParams, Link } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Play, Pause, ExternalLink, Clock, Calendar, Globe, Music, Disc } from 'lucide-react';
import { api } from '@/lib/api';
import { useTranslation } from '@/hooks/useTranslation';
import { useSeoRouting } from '@/hooks/useSeoRouting';

export default function AlbumDetail() {
  const { t } = useTranslation();
  const { getLocalizedUrl } = useSeoRouting();
  const { id } = useParams<{ id: string }>();
  const [playingTrack, setPlayingTrack] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const { data: albumData, isLoading, error } = useQuery({
    queryKey: ['/api/discover/album', id],
    queryFn: () => api.getAlbumDetails(id!),
    enabled: !!id,
    staleTime: 10 * 60 * 1000, // 10 minutes
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

  const createTrackUrl = (track: any): string => {
    const songSlug = createSlug(track.trackName);
    const artistSlug = createSlug(track.artistName);
    const albumSlug = createSlug(track.collectionName);
    return `/discover-music/song/${track.trackId}/${songSlug}-${artistSlug}-${albumSlug}`;
  };

  const createArtistUrl = (track: any): string => {
    const artistSlug = createSlug(track.artistName);
    return `/discover-music/artist/${track.artistId}/${artistSlug}`;
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

  if (error || !albumData?.album) {
    return (
      <div className="min-h-screen bg-[#0E0E0E] text-white">
        <div className="container mx-auto px-4 py-8">
          <Link to={getLocalizedUrl('/discover-music')} className="mb-8 flex items-center gap-2 text-[#FF4199] hover:text-white">
            <ArrowLeft className="h-4 w-4" />
            Back to Discover Music
          </Link>
          <div className="rounded-lg border border-red-800 bg-red-900/20 p-8 text-center">
            <Disc className="mx-auto mb-4 h-12 w-12 text-red-400" />
            <h1 className="mb-2 text-2xl font-bold text-red-400">Album Not Found</h1>
            <p className="text-red-300">Sorry, we couldn't find the album you're looking for.</p>
          </div>
        </div>
      </div>
    );
  }

  const album = albumData.album;
  const tracks = albumData.tracks || [];

  return (
    <div className="min-h-screen bg-[#0E0E0E] text-white">
      <div className="container mx-auto px-4 py-8">
        {/* Back Navigation */}
        <Link to={getLocalizedUrl('/discover-music')} className="mb-8 flex items-center gap-2 text-[#FF4199] hover:text-white transition-colors">
          <ArrowLeft className="h-4 w-4" />
          Back to Discover Music
        </Link>

        {/* Album Details */}
        <div className="grid gap-8 lg:grid-cols-2">
          {/* Artwork */}
          <div className="flex justify-center">
            <img
              src={getHighQualityArtwork(album.artworkUrl100)}
              alt={`${album.collectionName} artwork`}
              className="h-96 w-96 rounded-lg object-cover shadow-lg"
              onError={(e) => {
                const img = e.target as HTMLImageElement;
                img.src = album.artworkUrl100 || '/placeholder-album.png';
              }}
            />
          </div>

          {/* Album Info */}
          <div className="space-y-6">
            <div>
              <h1 className="mb-2 text-4xl font-bold text-white">{album.collectionName}</h1>
              <Link 
                to={getLocalizedUrl(createArtistUrl(album))}
                className="text-xl text-[#FF4199] hover:text-white transition-colors"
              >
                {album.artistName}
              </Link>
            </div>

            {/* Album Details */}
            <div className="grid gap-4 sm:grid-cols-2">
              {album.releaseDate && (
                <div className="flex items-center gap-2 text-gray-300">
                  <Calendar className="h-4 w-4 text-[#FF4199]" />
                  <span>Released: {new Date(album.releaseDate).getFullYear()}</span>
                </div>
              )}
              
              {album.country && (
                <div className="flex items-center gap-2 text-gray-300">
                  <Globe className="h-4 w-4 text-[#FF4199]" />
                  <span>Country: {album.country}</span>
                </div>
              )}
              
              {album.primaryGenreName && (
                <div className="flex items-center gap-2 text-gray-300">
                  <Music className="h-4 w-4 text-[#FF4199]" />
                  <span>Genre: {album.primaryGenreName}</span>
                </div>
              )}

              {tracks.length > 0 && (
                <div className="flex items-center gap-2 text-gray-300">
                  <Disc className="h-4 w-4 text-[#FF4199]" />
                  <span>Tracks: {tracks.length}</span>
                </div>
              )}
            </div>

            {/* Price */}
            {album.collectionPrice !== undefined && (
              <div className="rounded-lg border border-gray-800 bg-[#1F1F1F] p-4">
                <h3 className="mb-2 text-lg font-semibold text-white">Price</h3>
                <p className="text-2xl font-bold text-[#FF4199]">
                  {formatPrice(album.collectionPrice, album.currency)}
                </p>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-4">
              {album.collectionViewUrl && (
                <a
                  href={album.collectionViewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 rounded-lg bg-[#FF4199] px-6 py-3 font-medium text-white transition-all duration-200 hover:bg-[#E63689]"
                  data-testid="button-itunes"
                >
                  <ExternalLink className="h-4 w-4" />
                  View on iTunes
                </a>
              )}
            </div>
          </div>
        </div>

        {/* Track List */}
        {tracks.length > 0 && (
          <div className="mt-12">
            <h2 className="mb-6 text-2xl font-bold text-white">Tracks</h2>
            <div className="space-y-2">
              {tracks.map((track: any, index: number) => (
                <div
                  key={track.trackId}
                  className="group flex items-center gap-4 rounded-lg border border-gray-800 bg-[#1F1F1F] p-4 transition-all duration-200 hover:border-[#FF4199] hover:bg-[#2F2F2F]"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#2F2F2F] text-sm font-medium text-gray-300">
                    {track.trackNumber || index + 1}
                  </div>
                  
                  <div className="min-w-0 flex-grow">
                    <Link 
                      to={getLocalizedUrl(createTrackUrl(track))}
                      className="font-medium text-white hover:text-[#FF4199] transition-colors"
                    >
                      {track.trackName}
                    </Link>
                    {track.trackTimeMillis && (
                      <p className="text-sm text-gray-400">
                        {formatDuration(track.trackTimeMillis)}
                      </p>
                    )}
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