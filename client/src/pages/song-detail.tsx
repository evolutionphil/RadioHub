import React, { useState, useRef } from 'react';
import { useParams, Link } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Play, Pause, ExternalLink, Clock, Calendar, Globe, Music, Heart } from 'lucide-react';
import { api } from '@/lib/api';
import { useTranslation } from '@/hooks/useTranslation';
import { useSeoRouting } from '@/hooks/useSeoRouting';

export default function SongDetail() {
  const { t } = useTranslation();
  const { getLocalizedUrl } = useSeoRouting();
  const { id } = useParams<{ id: string }>();
  const [playingPreview, setPlayingPreview] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const { data: trackData, isLoading, error } = useQuery({
    queryKey: ['/api/discover/track', id],
    queryFn: () => api.getTrackDetails(id!),
    enabled: !!id,
    staleTime: 10 * 60 * 1000, // 10 minutes
  });

  const handlePlayPreview = () => {
    if (!trackData?.track?.previewUrl) return;
    
    if (playingPreview) {
      // Stop current track
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
      setPlayingPreview(false);
    } else {
      // Stop any current audio
      if (audioRef.current) {
        audioRef.current.pause();
      }
      
      // Create new audio element
      const audio = new Audio(trackData.track.previewUrl);
      audioRef.current = audio;
      
      audio.play().then(() => {
        setPlayingPreview(true);
        
        // Auto-stop when ended
        audio.addEventListener('ended', () => {
          setPlayingPreview(false);
        });
        
        // Auto-stop after 30 seconds (preview limit)
        setTimeout(() => {
          if (playingPreview) {
            audio.pause();
            setPlayingPreview(false);
          }
        }, 30000);
      }).catch((error) => {
        console.error('Error playing preview:', error);
        setPlayingPreview(false);
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
                <div className="h-6 w-2/3 rounded bg-[#2F2F2F]"></div>
                <div className="h-4 w-1/3 rounded bg-[#2F2F2F]"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !trackData?.track) {
    return (
      <div className="min-h-screen bg-[#0E0E0E] text-white">
        <div className="container mx-auto px-4 py-8">
          <Link to={getLocalizedUrl('/discover-music')} className="mb-8 flex items-center gap-2 text-[#FF4199] hover:text-white">
            <ArrowLeft className="h-4 w-4" />
            Back to Discover Music
          </Link>
          <div className="rounded-lg border border-red-800 bg-red-900/20 p-8 text-center">
            <Music className="mx-auto mb-4 h-12 w-12 text-red-400" />
            <h1 className="mb-2 text-2xl font-bold text-red-400">Song Not Found</h1>
            <p className="text-red-300">Sorry, we couldn't find the song you're looking for.</p>
          </div>
        </div>
      </div>
    );
  }

  const track = trackData.track;

  return (
    <div className="min-h-screen bg-[#0E0E0E] text-white">
      <div className="container mx-auto px-4 py-8">
        {/* Back Navigation */}
        <Link to={getLocalizedUrl('/discover-music')} className="mb-8 flex items-center gap-2 text-[#FF4199] hover:text-white transition-colors">
          <ArrowLeft className="h-4 w-4" />
          Back to Discover Music
        </Link>

        {/* Track Details */}
        <div className="grid gap-8 lg:grid-cols-2">
          {/* Artwork */}
          <div className="flex justify-center">
            <img
              src={getHighQualityArtwork(track.artworkUrl100)}
              alt={`${track.collectionName} artwork`}
              className="h-96 w-96 rounded-lg object-cover shadow-lg"
              onError={(e) => {
                const img = e.target as HTMLImageElement;
                img.src = track.artworkUrl100 || '/placeholder-album.png';
              }}
            />
          </div>

          {/* Track Info */}
          <div className="space-y-6">
            <div>
              <h1 className="mb-2 text-4xl font-bold text-white">{track.trackName}</h1>
              <Link 
                to={getLocalizedUrl(`/discover-music/artist/${track.artistId}`)}
                className="text-xl text-[#FF4199] hover:text-white transition-colors"
              >
                {track.artistName}
              </Link>
              <div className="mt-2">
                <Link 
                  to={getLocalizedUrl(`/discover-music/album/${track.collectionId}`)}
                  className="text-lg text-gray-300 hover:text-[#FF4199] transition-colors"
                >
                  {track.collectionName}
                </Link>
              </div>
            </div>

            {/* Track Details */}
            <div className="grid gap-4 sm:grid-cols-2">
              {track.trackTimeMillis && (
                <div className="flex items-center gap-2 text-gray-300">
                  <Clock className="h-4 w-4 text-[#FF4199]" />
                  <span>Duration: {formatDuration(track.trackTimeMillis)}</span>
                </div>
              )}
              
              {track.releaseDate && (
                <div className="flex items-center gap-2 text-gray-300">
                  <Calendar className="h-4 w-4 text-[#FF4199]" />
                  <span>Released: {new Date(track.releaseDate).getFullYear()}</span>
                </div>
              )}
              
              {track.country && (
                <div className="flex items-center gap-2 text-gray-300">
                  <Globe className="h-4 w-4 text-[#FF4199]" />
                  <span>Country: {track.country}</span>
                </div>
              )}
              
              {track.primaryGenreName && (
                <div className="flex items-center gap-2 text-gray-300">
                  <Music className="h-4 w-4 text-[#FF4199]" />
                  <span>Genre: {track.primaryGenreName}</span>
                </div>
              )}
            </div>

            {/* Price */}
            {track.trackPrice !== undefined && (
              <div className="rounded-lg border border-gray-800 bg-[#1F1F1F] p-4">
                <h3 className="mb-2 text-lg font-semibold text-white">Price</h3>
                <p className="text-2xl font-bold text-[#FF4199]">
                  {formatPrice(track.trackPrice, track.currency)}
                </p>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-4">
              {track.previewUrl && (
                <button
                  onClick={handlePlayPreview}
                  className={`flex items-center gap-2 rounded-lg px-6 py-3 font-medium transition-all duration-200 ${
                    playingPreview
                      ? 'bg-[#FF4199] text-white hover:bg-[#E63689]'
                      : 'bg-[#2F2F2F] text-gray-300 hover:bg-[#404040] hover:text-white'
                  }`}
                  data-testid="button-preview"
                >
                  {playingPreview ? (
                    <>
                      <Pause className="h-4 w-4" />
                      Stop Preview
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4" />
                      Play 30s Preview
                    </>
                  )}
                </button>
              )}
              
              {track.trackViewUrl && (
                <a
                  href={track.trackViewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 rounded-lg bg-[#2F2F2F] px-6 py-3 font-medium text-gray-300 transition-all duration-200 hover:bg-[#404040] hover:text-white"
                  data-testid="button-itunes"
                >
                  <ExternalLink className="h-4 w-4" />
                  View on iTunes
                </a>
              )}
            </div>

            {/* Additional Info */}
            {(track.discNumber || track.trackNumber) && (
              <div className="rounded-lg border border-gray-800 bg-[#1F1F1F] p-4">
                <h3 className="mb-2 text-lg font-semibold text-white">Track Information</h3>
                <div className="grid gap-2 sm:grid-cols-2">
                  {track.discNumber && (
                    <p className="text-gray-300">Disc: {track.discNumber}</p>
                  )}
                  {track.trackNumber && (
                    <p className="text-gray-300">Track: {track.trackNumber}</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Apple Attribution */}
        <div className="mt-8 border-t border-gray-800 pt-4 text-center text-sm text-gray-400">
          <p>Music data and preview provided by Apple's iTunes Search API.</p>
        </div>
      </div>
    </div>
  );
}