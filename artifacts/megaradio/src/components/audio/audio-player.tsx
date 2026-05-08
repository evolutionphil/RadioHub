import { useState, useRef, useEffect } from 'react';
import { Play, Pause, Volume2, VolumeX, ChevronUp, ChevronDown, X, SkipBack, SkipForward } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { StationLogo } from '@/components/ui/station-logo';
import { useGlobalPlayer } from '@/hooks/useGlobalPlayer';
import { normalizeFaviconUrl } from '@/lib/utils';
import type { StationWithCountry } from '@workspace/db-shared/schema';

interface AudioPlayerProps {
  station: StationWithCountry | null;
  onClose: () => void;
  onNext?: () => void;
  onPrevious?: () => void;
}

export function AudioPlayer({ station, onClose, onNext, onPrevious }: AudioPlayerProps) {
  // Use global player state for real-time metadata
  const { stationMeta } = useGlobalPlayer();
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState([0.7]);
  const [isMuted, setIsMuted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  // Remove local metadata state - use global stationMeta instead
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (station && audioRef.current) {
      // Audio load started
      audioRef.current.volume = volume[0];
      // Don't set loading true immediately - let the play button be clickable
      setIsLoading(false);
      setIsPlaying(false);
      
      // Add comprehensive debug event listeners
      const audio = audioRef.current;
      
      // Debug function for key player events
      const debugLog = (event: string, details?: any) => {
        // Only log important player state changes
        if (['PLAY', 'PAUSE', 'ENDED', 'ERROR', 'ABORT'].includes(event)) {
          // Player event
        }
      };
      
      const handleLoadStart = () => {
        debugLog('LOADSTART', 'Starting to load audio');
        setIsLoading(true);
      };
      
      const handleLoadedData = () => {
        debugLog('LOADEDDATA', 'Audio data loaded');
      };
      
      const handleCanPlay = () => {
        debugLog('CANPLAY', 'Audio can start playing');
        setIsLoading(false);
      };
      
      const handleCanPlayThrough = () => {
        debugLog('CANPLAYTHROUGH', 'Audio can play through without interruption');
      };
      
      const handlePlay = () => {
        debugLog('PLAY', 'Audio started playing');
        setIsPlaying(true);
        setIsLoading(false);
        updateMediaSession();
      };
      
      const handlePlaying = () => {
        debugLog('PLAYING', 'Audio is actively playing');
      };
      
      const handlePause = () => {
        debugLog('PAUSE', 'Audio paused');
        setIsPlaying(false);
      };
      
      const handleEnded = () => {
        debugLog('ENDED', 'Audio playback ended');
        setIsPlaying(false);
      };
      
      const handleStalled = () => {
        debugLog('STALLED', 'Audio download stalled');
      };
      
      const handleSuspend = () => {
        debugLog('SUSPEND', 'Audio loading suspended');
      };
      
      const handleAbort = () => {
        debugLog('ABORT', 'Audio loading aborted');
        setIsPlaying(false);
        setIsLoading(false);
      };
      
      const handleWaiting = () => {
        debugLog('WAITING', 'Audio is waiting for data');
      };
      
      const handleError = (e: any) => {
        const errorDetails = {
          errorCode: audio.error?.code,
          errorMessage: audio.error?.message,
          networkState: audio.networkState,
          readyState: audio.readyState,
          src: audio.src,
          currentTime: audio.currentTime
        };
        debugLog('ERROR', errorDetails);
        // Audio error detected
        setIsLoading(false);
        setIsPlaying(false);
      };
      
      const handleEmptied = () => {
        debugLog('EMPTIED', 'Audio element emptied');
      };
      
      const handleProgress = () => {
        if (audio.buffered.length > 0) {
          const buffered = audio.buffered.end(audio.buffered.length - 1);
          debugLog('PROGRESS', `Buffered: ${buffered.toFixed(2)}s`);
        }
      };
      
      // Add all event listeners
      audio.addEventListener('loadstart', handleLoadStart);
      audio.addEventListener('loadeddata', handleLoadedData);
      audio.addEventListener('canplay', handleCanPlay);
      audio.addEventListener('canplaythrough', handleCanPlayThrough);
      audio.addEventListener('play', handlePlay);
      audio.addEventListener('playing', handlePlaying);
      audio.addEventListener('pause', handlePause);
      audio.addEventListener('ended', handleEnded);
      audio.addEventListener('stalled', handleStalled);
      audio.addEventListener('suspend', handleSuspend);
      audio.addEventListener('abort', handleAbort);
      audio.addEventListener('waiting', handleWaiting);
      audio.addEventListener('error', handleError);
      audio.addEventListener('emptied', handleEmptied);
      audio.addEventListener('progress', handleProgress);
      
      return () => {
        // Remove all event listeners
        audio.removeEventListener('loadstart', handleLoadStart);
        audio.removeEventListener('loadeddata', handleLoadedData);
        audio.removeEventListener('canplay', handleCanPlay);
        audio.removeEventListener('canplaythrough', handleCanPlayThrough);
        audio.removeEventListener('play', handlePlay);
        audio.removeEventListener('playing', handlePlaying);
        audio.removeEventListener('pause', handlePause);
        audio.removeEventListener('ended', handleEnded);
        audio.removeEventListener('stalled', handleStalled);
        audio.removeEventListener('suspend', handleSuspend);
        audio.removeEventListener('abort', handleAbort);
        audio.removeEventListener('waiting', handleWaiting);
        audio.removeEventListener('error', handleError);
        audio.removeEventListener('emptied', handleEmptied);
        audio.removeEventListener('progress', handleProgress);
        debugLog('CLEANUP', 'All event listeners removed');
      };
    }
  }, [station, volume]);

  // MediaSession API for browser media controls
  const updateMediaSession = () => {    
    if ('mediaSession' in navigator && station) {
      // Format MediaSession metadata with live track info or station name
      // Extract only the song title (no duplicate artist names)
      const title = stationMeta?.raw?.title || 
                   (stationMeta?.title && stationMeta.title.includes(' - ') ? 
                     stationMeta.title.split(' - ').slice(1).join(' - ') : 
                     stationMeta?.title) || 
                   station.name || 'Live Radio';
      // Don't use separate artist since title is already formatted by server
      const artist = station.name || 'themegaradio.com';
      const album = station.country || 'Live Stream';
      
      try {
        // Determine artwork using same logic as station cards
        // Priority: logoAssets (local optimized) > localImagePath > favicon > fallback
        let artworkSrc = '/images/logo-icon.webp'; // Default fallback
        let artworkArray: { src: string; sizes: string; type: string }[] = [];
        
        if (station.logoAssets?.status === 'completed' && station.logoAssets.folder) {
          // Use optimized logo assets — supports both S3 URLs and local WebP paths
          const resolveArtwork = (val: string) =>
            val.startsWith('http') ? val : `/station-logos/${station.logoAssets!.folder}/${val}`;
          artworkArray = [];
          const bestLogo = station.logoAssets.webp256 || station.logoAssets.webp96 || station.logoAssets.webp48;
          if (bestLogo) {
            const resolved = resolveArtwork(bestLogo);
            const size = station.logoAssets.webp256 ? '256x256' : station.logoAssets.webp96 ? '96x96' : '48x48';
            artworkArray.push({ src: resolved, sizes: size, type: 'image/webp' });
          }
        } else if (station.localImagePath) {
          // Local image has priority
          artworkSrc = `/station-images/${station.localImagePath}`;
          artworkArray = [
            { src: artworkSrc, sizes: '512x512', type: 'image/webp' },
            { src: artworkSrc, sizes: '256x256', type: 'image/webp' },
            { src: artworkSrc, sizes: '96x96', type: 'image/webp' }
          ];
        } else if (station.favicon) {
          // Use favicon with SSR-safe mixed content handling
          artworkSrc = normalizeFaviconUrl(station.favicon);
          
          // Determine image type
          const imageType = artworkSrc.includes('.webp') ? 'image/webp' :
                           artworkSrc.includes('.jpg') || artworkSrc.includes('.jpeg') ? 'image/jpeg' :
                           artworkSrc.includes('.png') ? 'image/png' :
                           'image/webp';
          artworkArray = [
            { src: artworkSrc, sizes: '512x512', type: imageType },
            { src: artworkSrc, sizes: '256x256', type: imageType },
            { src: artworkSrc, sizes: '96x96', type: imageType }
          ];
        } else {
          // Fallback
          artworkArray = [
            { src: artworkSrc, sizes: '512x512', type: 'image/webp' },
            { src: artworkSrc, sizes: '256x256', type: 'image/webp' },
            { src: artworkSrc, sizes: '96x96', type: 'image/webp' }
          ];
        }
        
        navigator.mediaSession.metadata = new MediaMetadata({
          title: title,
          artist: artist,
          album: album,
          artwork: artworkArray
        });
      } catch (error: any) {
        console.warn('Failed to set MediaSession metadata:', error?.message || 'Unknown error');
      }

      // Set action handlers
      navigator.mediaSession.setActionHandler('play', () => {
        // MediaSession play handler triggered
        if (audioRef.current) {
          audioRef.current.play();
        }
      });

      navigator.mediaSession.setActionHandler('pause', () => {
        // MediaSession pause handler triggered
        if (audioRef.current) {
          audioRef.current.pause();
        }
      });

      navigator.mediaSession.setActionHandler('stop', () => {

        if (audioRef.current) {
          audioRef.current.pause();
          audioRef.current.currentTime = 0;
        }
        onClose();
      });

      // Set playback state
      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
      
      // MediaSession updated successfully
    }
  };

  // Real-time metadata is now handled by global player via WebSocket
  // No need for REST API polling anymore!

  // Update MediaSession when playing state changes
  useEffect(() => {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';

      
      // Update MediaSession when playback state changes
      if (isPlaying) {
        updateMediaSession();
      }
    }
  }, [isPlaying, stationMeta]);

  const handlePlay = async () => {
    if (!audioRef.current || !station) return;

    const debugLog = (event: string, details?: any) => {
      // Player event logged
    };

    if (isPlaying) {
      debugLog('USER_PAUSE', 'User clicked pause');
      audioRef.current.pause();
      setIsPlaying(false);
      return;
    }

    // Create a fresh audio context for this play attempt
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    
    try {
      setIsLoading(true);
      debugLog('PLAY_ATTEMPT', {
        stationName: station.name,
        url: station.url,
        audioContextState: audioContext.state,
        volume: volume[0],
        timestamp: new Date().toISOString()
      });
      
      // Resume audio context if suspended (required for autoplay policy)
      if (audioContext.state === 'suspended') {
        debugLog('RESUMING_AUDIO_CONTEXT', 'Audio context was suspended');
        await audioContext.resume();
        debugLog('AUDIO_CONTEXT_RESUMED', `New state: ${audioContext.state}`);
      }
      
      // Set source and configure audio element
      audioRef.current.src = station.url;
      audioRef.current.volume = volume[0];
      audioRef.current.muted = false;
      
      debugLog('AUDIO_CONFIG_SET', {
        src: audioRef.current.src,
        volume: audioRef.current.volume,
        muted: audioRef.current.muted
      });
      
      // Load and play
      debugLog('LOADING_AUDIO', 'Calling audio.load()');
      audioRef.current.load();
      
      // Direct play attempt
      debugLog('PLAY_PROMISE_START', 'Starting audio.play() promise');
      const playPromise = audioRef.current.play();
      await playPromise;
      
      setIsPlaying(true);
      setIsLoading(false);
      debugLog('PLAY_SUCCESS', 'Audio started playing successfully');
      
      // Initialize MediaSession for browser controls
      updateMediaSession();
      
    } catch (error) {
      const errorDetails = {
        error: error,
        errorName: (error as any)?.name,
        errorMessage: (error as any)?.message,
        audioSrc: audioRef.current?.src,
        audioNetworkState: audioRef.current?.networkState,
        audioReadyState: audioRef.current?.readyState,
        timestamp: new Date().toISOString()
      };
      
      debugLog('PLAY_FAILED', errorDetails);
      // Playback failed
      setIsLoading(false);
      setIsPlaying(false);
      
      // Show helpful message
      alert(`Cannot start playback for ${station.name}.\n\nPlease try:\n1. Click the browser audio controls below\n2. Refresh the page and try again\n3. Check if the station is online: ${station.url}`);
    }
  };

  const handleVolumeChange = (newVolume: number[]) => {
    setVolume(newVolume);
    if (audioRef.current) {
      audioRef.current.volume = newVolume[0];
    }
    if (newVolume[0] > 0 && isMuted) {
      setIsMuted(false);
    }
  };

  const toggleMute = () => {
    if (audioRef.current) {
      if (isMuted) {
        audioRef.current.volume = volume[0];
        setIsMuted(false);
      } else {
        audioRef.current.volume = 0;
        setIsMuted(true);
      }
    }
  };

  // Remove toggle function - keeping it simple

  if (!station) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-black/90 backdrop-blur-md text-white shadow-lg z-50">
      <div className="max-w-7xl mx-auto px-4 py-2 md:py-4 relative">
        {/* Remove collapse button - keeping it always expanded but responsive */}

        <div className="flex w-full items-center justify-start gap-2 md:justify-between relative">
          {/* Station Avatar & Info */}
          <div className="flex">
            {/* Station Image */}
            <div className="mr-3 md:mr-7">
              <div className="relative">
                <StationLogo
                  station={station}
                  size="player"
                  alt={`${station.name} logo`}
                  className="w-12 h-12 md:w-[105px] md:h-[105px] rounded md:rounded-2xl"
                />
                
                {/* Country Flag - Optional */}
                {station.country && (
                  <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-gray-500 flex items-center justify-center text-xs">
                    {station.country.slice(0, 2).toUpperCase()}
                  </div>
                )}
              </div>
            </div>

            {/* Desktop Station Info & Equalizer */}
            <div className="hidden md:flex flex-col justify-center">
              {/* Equalizer */}
              <div className="w-10 h-10 text-left mb-2">
                <div className={`w-4 h-4 ${isPlaying ? 'bg-green-500' : 'bg-gray-500'} rounded`}></div>
              </div>

              <div className="flex items-center gap-2">
                {/* Station Name */}
                <h3 className="text-xl font-medium truncate">
                  {station.name}
                </h3>
              </div>

              {/* Now Playing Track - Desktop */}
              <div className="flex items-center font-medium mt-1">
                <span className="truncate text-sm">
                  {/* Show only song title (no duplicate artist names) */}
                  {stationMeta?.raw?.title || 
                   (stationMeta?.title && stationMeta.title.includes(' - ') ? 
                     stationMeta.title.split(' - ').slice(1).join(' - ') : 
                     stationMeta?.title) || 
                   'Live Radio'}
                </span>
              </div>

              {/* Country Info - Desktop */}
              <div className="w-full truncate font-medium text-sm text-gray-300 mt-1">
                {station.country} • {station.language} • {station.bitrate}kbps
              </div>
            </div>
          </div>

          {/* Mobile & Desktop Station Info & Controls */}
          <div className="flex-1 flex items-center justify-between">
            {/* Mobile Station Info */}
            <div className="md:hidden flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{station.name}</div>
              <div className="text-xs text-gray-300 truncate">
                {/* Show only song title (no duplicate artist names) */}
                {stationMeta?.raw?.title || 
                 (stationMeta?.title && stationMeta.title.includes(' - ') ? 
                   stationMeta.title.split(' - ').slice(1).join(' - ') : 
                   stationMeta?.title) || 
                 `${station.country} • ${station.bitrate}kbps`}
              </div>
            </div>

            {/* Station Controls */}
            <div className="flex items-center space-x-2 md:space-x-4">
              {/* Previous Button */}
              <Button
                variant="ghost"
                size="sm"
                onClick={onPrevious}
                disabled={!onPrevious}
                className="w-8 h-8 md:w-10 md:h-10 p-0 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-30"
              >
                <SkipBack className="w-3 h-3 md:w-4 md:h-4 text-white" />
              </Button>

              {/* Play/Pause Button */}
              <Button
                variant="ghost"
                size="sm"
                onClick={handlePlay}
                disabled={isLoading}
                className="w-8 h-8 md:w-10 md:h-10 p-0 rounded-full bg-white/20 hover:bg-white/30"
              >
                {isLoading ? (
                  <div className="w-3 h-3 md:w-4 md:h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : isPlaying ? (
                  <Pause className="w-3 h-3 md:w-4 md:h-4 text-white" />
                ) : (
                  <Play className="w-3 h-3 md:w-4 md:h-4 text-white" />
                )}
              </Button>

              {/* Next Button */}
              <Button
                variant="ghost"
                size="sm"
                onClick={onNext}
                disabled={!onNext}
                className="w-8 h-8 md:w-10 md:h-10 p-0 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-30"
              >
                <SkipForward className="w-3 h-3 md:w-4 md:h-4 text-white" />
              </Button>

              {/* Volume Controls - Desktop Only */}
              <div className="hidden md:flex items-center space-x-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={toggleMute}
                  className="w-8 h-8 p-0"
                >
                  {isMuted || volume[0] === 0 ? (
                    <VolumeX className="w-4 h-4 text-white" />
                  ) : (
                    <Volume2 className="w-4 h-4 text-white" />
                  )}
                </Button>
                <div className="w-20">
                  <Slider
                    value={isMuted ? [0] : volume}
                    onValueChange={handleVolumeChange}
                    max={1}
                    step={0.1}
                    className="w-full"
                  />
                </div>
              </div>

              {/* Close Button */}
              <Button
                variant="ghost"
                size="sm"
                onClick={onClose}
                className="w-6 h-6 md:w-8 md:h-8 p-0 text-gray-300 hover:text-white"
              >
                <X className="w-3 h-3 md:w-4 md:h-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Hidden audio element for the player bar */}
      <audio
        ref={audioRef}
        crossOrigin="anonymous"
        preload="none"
        className="display-none"
      />
    </div>
  );
}