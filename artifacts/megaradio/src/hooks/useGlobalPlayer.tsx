import { createContext, useContext, useState, useRef, useEffect, ReactNode } from 'react';
import type { StationWithCountry as Station } from '@workspace/db-shared/schema';
import { toast } from '@/hooks/use-toast';
import { createMetadataClient } from '@/services/metadata-client';
import { trackStationPlay, trackListeningTime, trackStationFavorite } from '../lib/analytics';
import { logger } from '@/lib/logger';
import { getStreamProxyUrl } from '@/lib/utils';

import type { GlobalPlayerState } from './useGlobalPlayer.shell';
import { GlobalPlayerContext } from './useGlobalPlayer.shell';

export { GlobalPlayerContext };

// RADIOLISE-STYLE Provider: Simple and reliable
export function GlobalPlayerProvider({ children }: { children: ReactNode }) {
  const [currentStation, setCurrentStation] = useState<Station | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);
  const [volume, setVolumeState] = useState(0.7);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [favorites] = useState<string[]>([]);
  const [hasError, setHasError] = useState(false);
  const [stationMeta, setStationMeta] = useState<any>(null);
  const [stationQueue, setStationQueue] = useState<Station[]>([]);
  const [currentStationIndex, setCurrentStationIndex] = useState(-1);
  
  // Simplified state management - minimal refs
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const hlsRef = useRef<any>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const maxReconnectAttempts = 10; // Radio streams need more attempts due to instability
  
  // CHROME FIX: Track pending play promises to prevent interruptions
  const playPromiseRef = useRef<Promise<void> | null>(null);
  const isPlayPendingRef = useRef(false);
  
  // RECONNECTION DEBOUNCING: Prevent multiple concurrent reconnection attempts
  const reconnectionInProgressRef = useRef(false);
  const lastReconnectTimeRef = useRef(0);
  
  // MANUAL PAUSE TRACKING: Prevent auto-restart when user manually pauses
  const isManuallyPausedRef = useRef(false);
  
  // Simple listening timer
  const [globalListeningTime, setGlobalListeningTime] = useState(0);
  const globalTimerRef = useRef<NodeJS.Timeout | null>(null);
  
  // METADATA CLIENT: Real-time track information
  const metadataClientRef = useRef<any>(null);
  
  // WAKE LOCK API: Prevent device sleep during playback
  const wakeLockRef = useRef<any>(null);
  
  // AUDIO SESSION API: iOS Safari background audio support
  const audioSessionInitialized = useRef(false);
  
  // SERVICE WORKER: Keep-alive for background playback
  const serviceWorkerKeepAliveInterval = useRef<NodeJS.Timeout | null>(null);
  
  // WATCHDOG TIMER: Detect stalled streams (no timeupdate for 15s)
  const lastTimeUpdateRef = useRef<number>(Date.now());
  const watchdogTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isPlayingRef = useRef(false); // Track playing state for watchdog closure
  
  // PROFESSIONAL RADIO APPROACH: Web Audio API for background resistance  
  const getPlayerElement = (): HTMLAudioElement => {
    const existingPlayer = document.getElementById('global-radio-player') as HTMLAudioElement;
    
    if (existingPlayer) {
      return existingPlayer;
    }
    
    // PROFESSIONAL APPROACH: Create audio element with Web Audio API context
    const player = document.createElement('audio');
    player.setAttribute('id', 'global-radio-player');
    player.setAttribute('preload', 'auto');
    player.setAttribute('playsinline', 'true');
    player.setAttribute('webkit-playsinline', 'true');
    // AirPlay support for Safari/Apple devices
    player.setAttribute('x-webkit-airplay', 'allow');
    player.setAttribute('airplay', 'allow');
    player.style.display = 'none';
    player.volume = 0.7;
    
    logger.log('🎵 SAFARI iOS APPROACH: Simple Audio() element created with AirPlay support');
    
    // NO WEB AUDIO API - Keep it simple like working radio.at approach
    // Safari iOS handles background audio naturally with basic HTML5 Audio
    
    document.body.appendChild(player);
    
    return player;
  };

  // WAKE LOCK API: Request wake lock to prevent device sleep (ONLY when page is visible)
  const requestWakeLock = async () => {
    if (!('wakeLock' in navigator)) {
      logger.log('⚠️ Wake Lock API not supported');
      return;
    }

    // CRITICAL FIX: Wake Lock can ONLY be acquired when page is visible
    if (document.hidden) {
      logger.log('⚠️ Wake Lock skipped - page is hidden (background playback uses Media Session API instead)');
      return;
    }

    try {
      // Release existing wake lock if any
      if (wakeLockRef.current) {
        await wakeLockRef.current.release();
        wakeLockRef.current = null;
      }

      // Request new wake lock
      wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
      logger.log('🔒 Wake Lock acquired - device will stay awake');

      // Re-acquire wake lock when visibility changes (device wakes up)
      wakeLockRef.current.addEventListener('release', () => {
        logger.log('🔓 Wake Lock released');
      });
    } catch (error) {
      logger.warn('❌ Wake Lock request failed:', error);
    }
  };

  // WAKE LOCK API: Release wake lock to save battery
  const releaseWakeLock = async () => {
    if (wakeLockRef.current) {
      try {
        await wakeLockRef.current.release();
        wakeLockRef.current = null;
        logger.log('🔓 Wake Lock released - device can sleep');
      } catch (error) {
        logger.warn('❌ Wake Lock release failed:', error);
      }
    }
  };

  // AUDIO SESSION API: Initialize iOS Safari audio session
  const initializeAudioSession = () => {
    if (audioSessionInitialized.current) return;
    
    try {
      // Check if Audio Session API is available (experimental iOS Safari feature)
      if ('audioSession' in navigator) {
        (navigator as any).audioSession.type = 'playback';
        audioSessionInitialized.current = true;
        logger.log('🎵 iOS Audio Session initialized for background playback');
      }
    } catch (error) {
      logger.warn('⚠️ Audio Session API not available:', error);
    }
  };

  // SERVICE WORKER: Send keep-alive messages for persistent background audio
  const startServiceWorkerKeepAlive = () => {
    if (!navigator.serviceWorker?.controller) {
      logger.log('⚠️ No active service worker for keep-alive');
      return;
    }

    // Clear existing interval
    if (serviceWorkerKeepAliveInterval.current) {
      clearInterval(serviceWorkerKeepAliveInterval.current);
    }

    // Send keep-alive message every 25 seconds to prevent service worker termination
    serviceWorkerKeepAliveInterval.current = setInterval(() => {
      try {
        navigator.serviceWorker.controller?.postMessage({
          type: 'KEEP_ALIVE',
          timestamp: Date.now()
        });
        logger.log('💓 Service Worker keep-alive sent');
      } catch (error) {
        logger.warn('❌ Keep-alive message failed:', error);
      }
    }, 25000);

    logger.log('🔄 Service Worker keep-alive started');
  };

  // SERVICE WORKER: Stop keep-alive messages
  const stopServiceWorkerKeepAlive = () => {
    if (serviceWorkerKeepAliveInterval.current) {
      clearInterval(serviceWorkerKeepAliveInterval.current);
      serviceWorkerKeepAliveInterval.current = null;
      logger.log('🛑 Service Worker keep-alive stopped');
    }
  };

  // ENHANCED MEDIA SESSION API: With position state for live streams
  const updateMediaSession = (station: Station, playbackState: 'playing' | 'paused' = 'paused') => {
    if (!('mediaSession' in navigator)) return;

    try {
      // Simple artwork handling
      const getArtworkSrc = () => {
        if (station.favicon && station.favicon !== 'null' && station.favicon !== 'undefined') {
          if (station.favicon.startsWith('http:') && window.location.protocol === 'https:') {
            const encodedUrl = btoa(station.favicon).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
            return getStreamProxyUrl(`/api/image/${encodedUrl}`);
          }
          return station.favicon;
        }
        return '/images/logo-icon.webp';
      };

      const artworkSrc = getArtworkSrc();
      
      // Simple metadata handling
      const displayTitle = stationMeta?.title || station.name;
      const displayArtist = stationMeta?.artist || 'themegaradio.com'; 
      const displayAlbum = station.genre || 'Live Radio';

      navigator.mediaSession.metadata = new MediaMetadata({
        title: displayTitle,
        artist: displayArtist,
        album: displayAlbum,
        artwork: [
          { src: artworkSrc, sizes: '512x512', type: 'image/png' },
          { src: artworkSrc, sizes: '256x256', type: 'image/png' },
          { src: artworkSrc, sizes: '96x96', type: 'image/png' }
        ]
      });

      navigator.mediaSession.playbackState = playbackState;

      // POSITION STATE: Set to Infinity for live radio streams
      // This keeps browsers informed that this is continuous live content
      try {
        if ('setPositionState' in navigator.mediaSession) {
          navigator.mediaSession.setPositionState({
            duration: Infinity,
            playbackRate: 1.0,
            position: 0
          });
          logger.log('📍 Media Session position state set (live stream: Infinity)');
        }
      } catch (error) {
        logger.warn('⚠️ Position state not supported:', error);
      }

      // Simple media controls - no complex overrides
      navigator.mediaSession.setActionHandler('play', () => {
        logger.log('📱 Media Session: Play requested (user-initiated from media controls)');
        isManuallyPausedRef.current = false;
        if (audioRef.current && !isPlayPendingRef.current) {
          safePlay('media-session').catch(console.error);
        }
      });

      navigator.mediaSession.setActionHandler('pause', () => {
        logger.log('📱 Media Session: Pause requested (user-initiated from media controls)');
        isManuallyPausedRef.current = true;
        if (audioRef.current) {
          audioRef.current.pause();
        }
      });

      navigator.mediaSession.setActionHandler('stop', () => {
        logger.log('📱 Media Session: Stop requested');
        stop();
      });

    } catch (error) {
      logger.warn('Media Session API error:', error);
    }
  };

  // RADIOLISE APPROACH: Simple audio element initialization
  useEffect(() => {
    logger.log('🎯 RADIOLISE APPROACH: Simple audio element setup (no background monitoring)');
    const audio = getPlayerElement();
    
    audioRef.current = audio;
    setAudioElement(audio);

    // RADIOLISE STYLE: Simple event handlers without aggressive monitoring
    const handleLoadStart = () => {
      logger.log('🔄 Audio: Loading started');
      setIsLoading(true);
      setHasError(false);
    };
    
    const handleCanPlay = () => {
      logger.log('✅ Audio: Can play');
      setIsLoading(false);
      setHasError(false);
    };
    
    const handlePlay = () => {
      logger.log('▶️ SIMPLE AUDIO: Playing');
      setIsPlaying(true);
      isPlayingRef.current = true; // Update ref for watchdog closure
      setHasError(false);
      setReconnectAttempts(0);
      
      // BACKGROUND AUDIO PREVENTION: Activate all APIs on play
      requestWakeLock();
      initializeAudioSession();
      startServiceWorkerKeepAlive();
      
      // WATCHDOG: Start monitoring for stalled streams
      lastTimeUpdateRef.current = Date.now();
      startWatchdog();
      
      // Simple listening timer - Defer to requestIdleCallback to avoid TBT
      if (globalTimerRef.current) {
        clearInterval(globalTimerRef.current);
      }
      // Non-blocking timer initialization
      if ('requestIdleCallback' in window) {
        requestIdleCallback(() => {
          globalTimerRef.current = setInterval(() => {
            setGlobalListeningTime(prev => prev + 1);
          }, 1000);
        }, { timeout: 2000 });
      } else {
        globalTimerRef.current = setInterval(() => {
          setGlobalListeningTime(prev => prev + 1);
        }, 1000);
      }
      
      if (currentStation) {
        updateMediaSession(currentStation, 'playing');
      }
    };
    
    const handlePause = (event?: any) => {
      const isStreamEnded = audioRef.current?.ended;
      const isPageHidden = document.hidden;
      
      logger.log('⏸️ Audio: Paused - checking if browser background pause');
      logger.log('🔍 Page hidden?', isPageHidden, 'Stream ended?', isStreamEnded);
      
      // If stream ended naturally, handle as ended event
      if (isStreamEnded) {
        logger.log('⏹️ Stream ended naturally - triggering reconnect');
        setIsPlaying(false);
        isPlayingRef.current = false;
        stopWatchdog();
        handleEnded();
        return;
      }
      
      // 🎯 KEY FIX: If page is hidden AND NOT manually paused, this is likely browser background pause - auto-reconnect with debouncing
      if (isPageHidden && currentStation && !isStreamEnded && !isManuallyPausedRef.current) {
        logger.log('🔄 BACKGROUND PAUSE DETECTED - Attempting smart reconnect (keeping isPlaying=true for UI)');
        
        // Debounce reconnection attempts
        const now = Date.now();
        if (reconnectionInProgressRef.current || (now - lastReconnectTimeRef.current) < 2000) {
          logger.log('🚫 Reconnection blocked: Too recent or already in progress');
          return;
        }
        
        reconnectionInProgressRef.current = true;
        lastReconnectTimeRef.current = now;
        
        // Delayed reconnect to allow current operations to complete
        setTimeout(() => {
          if (currentStation && audioRef.current && document.hidden && !isPlayPendingRef.current) {
            logger.log('🔄 Background reconnect: Starting fresh stream');
            
            // Fresh stream URL with cache busting
            const baseUrl = currentStation.url || currentStation.urlResolved || '';
            if (!baseUrl) return;
            const cacheBuster = Date.now();
            const separator = baseUrl.includes('?') ? '&' : '?';
            const streamUrl = `${baseUrl}${separator}_t=${cacheBuster}`;
            
            let finalUrl = streamUrl;
            if (streamUrl.startsWith('http://') && window.location.protocol === 'https:') {
              const encodedUrl = btoa(streamUrl).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
              finalUrl = getStreamProxyUrl(`/api/stream/${encodedUrl}`);
            }
            
            audioRef.current.src = finalUrl;
            audioRef.current.load();
            
            safePlay('background-reconnect').catch(e => {
              logger.log('❌ Background reconnect failed:', e);
              // Exponential backoff for retries
              const retryDelay = Math.min(5000, 1000 * Math.pow(2, reconnectAttempts));
              setTimeout(() => {
                if (currentStation && audioRef.current && document.hidden && !isPlayPendingRef.current) {
                  safePlay('background-retry').catch(console.error);
                }
              }, retryDelay);
            }).finally(() => {
              reconnectionInProgressRef.current = false;
            });
          } else {
            reconnectionInProgressRef.current = false;
          }
        }, 500); // Give current operations time to complete
        return;
      }
      
      // For user-initiated pauses when page is visible, pause normally and release resources
      logger.log('⏸️ User-initiated pause detected (page is visible)');
      setIsPlaying(false);
      isPlayingRef.current = false; // Update ref for watchdog closure
      
      if (globalTimerRef.current) {
        clearInterval(globalTimerRef.current);
        globalTimerRef.current = null;
      }
      
      // Stop watchdog when paused
      stopWatchdog();
      
      // BACKGROUND AUDIO PREVENTION: Release resources on manual pause to save battery
      // Don't release on background pause - we want to maintain playback
      if (!isPageHidden) {
        releaseWakeLock();
        stopServiceWorkerKeepAlive();
      }
      
      if (currentStation) {
        updateMediaSession(currentStation, 'paused');
      }
    };
    
    const handleEnded = () => {
      logger.log('⏹️ Stream ended - smart reconnect with debouncing');
      setIsPlaying(false);
      isPlayingRef.current = false;
      stopWatchdog();
      
      // Prevent concurrent reconnection attempts
      const now = Date.now();
      if (reconnectionInProgressRef.current || (now - lastReconnectTimeRef.current) < 1000) {
        logger.log('🚫 Stream ended reconnection blocked: Too recent or already in progress');
        return;
      }
      
      // Only reconnect if we haven't exceeded attempts and station is still active
      if (currentStation && audioRef.current && reconnectAttempts < maxReconnectAttempts) {
        logger.log('🔄 Stream ended, reconnecting with backoff...');
        
        reconnectionInProgressRef.current = true;
        lastReconnectTimeRef.current = now;
        setReconnectAttempts(prev => prev + 1);
        
        // Exponential backoff: 1s, 2s, 4s, 8s, max 10s
        const backoffDelay = Math.min(10000, 1000 * Math.pow(2, reconnectAttempts));
        
        setTimeout(() => {
          if (currentStation && audioRef.current && !isPlayPendingRef.current) {
            // Fresh stream URL with cache busting
            const baseUrl = currentStation.url || currentStation.urlResolved || '';
            if (!baseUrl) return;
            const cacheBuster = Date.now();
            const separator = baseUrl.includes('?') ? '&' : '?';
            const streamUrl = `${baseUrl}${separator}_t=${cacheBuster}`;
            
            let finalUrl = streamUrl;
            if (streamUrl.startsWith('http://') && window.location.protocol === 'https:') {
              const encodedUrl = btoa(streamUrl).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
              finalUrl = getStreamProxyUrl(`/api/stream/${encodedUrl}`);
            }
            
            audioRef.current.src = finalUrl;
            audioRef.current.load();
            
            safePlay('stream-ended-reconnect').catch(e => {
              console.error('❌ Stream ended reconnect failed:', e);
              // Don't retry here - let the next ended event handle it with backoff
            }).finally(() => {
              reconnectionInProgressRef.current = false;
            });
          } else {
            reconnectionInProgressRef.current = false;
          }
        }, backoffDelay);
      } else {
        logger.log('❌ Stream ended: Max reconnect attempts reached or no station');
        setHasError(true);
        reconnectionInProgressRef.current = false;
      }
    };

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
      setDuration(audio.duration || 0);
      // Update watchdog timestamp - stream is alive
      lastTimeUpdateRef.current = Date.now();
    };
    
    // WATCHDOG: Start monitoring for stalled streams
    const startWatchdog = () => {
      if (watchdogTimerRef.current) {
        clearInterval(watchdogTimerRef.current);
      }
      watchdogTimerRef.current = setInterval(() => {
        if (!isPlayingRef.current || isManuallyPausedRef.current) return;
        
        const timeSinceLastUpdate = Date.now() - lastTimeUpdateRef.current;
        // If no timeupdate for 15 seconds while playing, stream is stalled
        if (timeSinceLastUpdate > 15000 && currentStation && !reconnectionInProgressRef.current) {
          logger.log('⚠️ WATCHDOG: Stream stalled for 15s, attempting reconnect');
          
          // Try to reconnect with fresh URL
          if (audioRef.current) {
            const baseUrl = currentStation.url || currentStation.urlResolved || '';
            if (!baseUrl) return;
            const cacheBuster = Date.now();
            const separator = baseUrl.includes('?') ? '&' : '?';
            let finalUrl = `${baseUrl}${separator}_t=${cacheBuster}`;
            
            if (baseUrl.startsWith('http://') && window.location.protocol === 'https:') {
              const encodedUrl = btoa(finalUrl).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
              finalUrl = getStreamProxyUrl(`/api/stream/${encodedUrl}`);
            }
            
            audioRef.current.src = finalUrl;
            audioRef.current.load();
            lastTimeUpdateRef.current = Date.now();
            safePlay('watchdog-reconnect').catch(console.error);
          }
        }
      }, 5000); // Check every 5 seconds
    };
    
    const stopWatchdog = () => {
      if (watchdogTimerRef.current) {
        clearInterval(watchdogTimerRef.current);
        watchdogTimerRef.current = null;
      }
    };

    const handleVolumeChange = () => {
      setVolumeState(audio.volume);
      setIsMuted(audio.muted);
    };

    // COMPREHENSIVE ERROR DETECTION AND LOGGING
    const handleError = (event: any) => {
      const error = event.target?.error;
      
      // Log error details for developers
      logger.log('❌ AUDIO ERROR DETECTED');
      logger.log('🔍 ERROR: Code:', error?.code, 'Message:', error?.message);
      logger.log('🔍 ERROR: Network state:', audioRef.current?.networkState);
      logger.log('🔍 ERROR: Ready state:', audioRef.current?.readyState);
      logger.log('🔍 ERROR: Audio source:', audioRef.current?.src);
      logger.log('🔍 ERROR: Current position:', audioRef.current?.currentTime);
      
      setIsLoading(false);
      setIsPlaying(false);
      isPlayingRef.current = false;
      stopWatchdog();
      
      // Only set error state if it's NOT a manual pause
      if (!isManuallyPausedRef.current) {
        setHasError(true);
      } else {
        logger.log('🔇 Manual pause detected - skipping error state');
      }
      
      // Clear any existing timeouts to prevent conflicts
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      
      // VLC-LIKE CANDIDATE FALLBACK: Try next candidate in the list
      if (currentStation && !isManuallyPausedRef.current) {
        const candidates = streamCandidatesRef.current;
        const currentIdx = currentCandidateIndexRef.current;
        
        // Try next candidate if available
        if (currentIdx + 1 < candidates.length) {
          currentCandidateIndexRef.current = currentIdx + 1;
          const nextCandidate = candidates[currentIdx + 1];
          
          logger.log(`🔄 Trying next candidate ${currentIdx + 2}/${candidates.length}:`, nextCandidate);
          
          // Debounce candidate switching
          const now = Date.now();
          if (!reconnectionInProgressRef.current && (now - lastReconnectTimeRef.current) >= 1000) {
            reconnectionInProgressRef.current = true;
            lastReconnectTimeRef.current = now;
            setHasError(false);
            setIsLoading(true);
            
            reconnectTimeoutRef.current = setTimeout(() => {
              if (audioRef.current && currentStation && !isPlayPendingRef.current) {
                let finalUrl = nextCandidate;
                if (nextCandidate.startsWith('http://') && window.location.protocol === 'https:') {
                  const encodedUrl = btoa(nextCandidate).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
                  finalUrl = getStreamProxyUrl(`/api/stream/${encodedUrl}`);
                }
                
                audioRef.current.src = finalUrl;
                audioRef.current.load();
                safePlay('candidate-fallback').catch(console.error).finally(() => {
                  reconnectionInProgressRef.current = false;
                });
              } else {
                reconnectionInProgressRef.current = false;
              }
            }, 500);
          }
        } else if (reconnectAttempts < maxReconnectAttempts) {
          // All candidates exhausted - try proxy fallback with original URL
          logger.log('🔄 All candidates exhausted, trying proxy fallback');
          setReconnectAttempts(prev => prev + 1);
          
          const originalUrl = currentStation.url || currentStation.urlResolved || '';
          if (!originalUrl) return;
          const encodedUrl = btoa(originalUrl).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
          const proxyUrl = getStreamProxyUrl(`/api/stream/${encodedUrl}`);
          
          const now = Date.now();
          if (!reconnectionInProgressRef.current && (now - lastReconnectTimeRef.current) >= 2000) {
            reconnectionInProgressRef.current = true;
            lastReconnectTimeRef.current = now;
            
            reconnectTimeoutRef.current = setTimeout(() => {
              if (audioRef.current && currentStation && !isPlayPendingRef.current) {
                audioRef.current.src = proxyUrl;
                audioRef.current.load();
                safePlay('error-fallback').catch(console.error).finally(() => {
                  reconnectionInProgressRef.current = false;
                });
              } else {
                reconnectionInProgressRef.current = false;
              }
            }, 2000);
          }
        } else {
          logger.log('❌ Max reconnect attempts reached');
          toast({
            title: 'Connection Failed',
            description: 'Unable to connect to this radio station. Please try again or choose another station.',
            variant: 'destructive'
          });
        }
      } else if (!isManuallyPausedRef.current) {
        logger.log('❌ No station or max attempts reached');
        toast({
          title: 'Connection Failed',
          description: 'Unable to connect to this radio station. Please try again or choose another station.',
          variant: 'destructive'
        });
      }
    };

    // Simple event listeners
    // Use passive listeners for non-blocking event handling
    audio.addEventListener('loadstart', handleLoadStart, { passive: true });
    audio.addEventListener('canplay', handleCanPlay, { passive: true });
    audio.addEventListener('play', handlePlay, { passive: true });
    audio.addEventListener('pause', handlePause, { passive: true });
    audio.addEventListener('ended', handleEnded, { passive: true });
    audio.addEventListener('timeupdate', handleTimeUpdate, { passive: true });
    audio.addEventListener('volumechange', handleVolumeChange, { passive: true });
    audio.addEventListener('error', handleError, { passive: true });

    // ENHANCED PAGE VISIBILITY: Maintain playback and re-acquire wake lock
    const handleVisibilityChange = async () => {
      if (document.hidden) {
        logger.log('📱 Page hidden - maintaining background playback');
        // Keep wake lock and service worker active for background playback
        // Media Session API will handle lock screen controls
      } else {
        logger.log('📱 Page visible - re-acquiring wake lock if playing');
        // Re-acquire wake lock when page becomes visible
        if (isPlaying && currentStation) {
          await requestWakeLock();
          // Ensure Media Session is still active
          updateMediaSession(currentStation, 'playing');
        }
      }
    };

    // Passive listener for visibility changes (no preventDefault needed)
    document.addEventListener('visibilitychange', handleVisibilityChange, { passive: true });

    return () => {
      // Clean up event listeners
      audio.removeEventListener('loadstart', handleLoadStart);
      audio.removeEventListener('canplay', handleCanPlay);
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('volumechange', handleVolumeChange);
      audio.removeEventListener('error', handleError);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      
      // Clean up background audio prevention resources
      releaseWakeLock();
      stopServiceWorkerKeepAlive();
      stopWatchdog();
      
      // Clean up timers and reset state
      if (globalTimerRef.current) {
        clearInterval(globalTimerRef.current);
        globalTimerRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      
      // Reset play promise tracking
      isPlayPendingRef.current = false;
      playPromiseRef.current = null;
      reconnectionInProgressRef.current = false;
      
      // NOTE: Do NOT disconnect metadata client here - it should persist across station changes
      // Metadata client cleanup happens in a separate effect on actual component unmount
    };
  }, [currentStation, isPlaying]);
  
  // SEPARATE EFFECT: Cleanup metadata client ONLY on actual component unmount
  // This ensures WebSocket stays connected during navigation and station changes
  useEffect(() => {
    return () => {
      logger.log('🧹 Component unmounting - cleaning up metadata client');
      if (metadataClientRef.current) {
        metadataClientRef.current.disconnect();
        metadataClientRef.current = null;
      }
    };
  }, []); // Empty deps = only runs on unmount

  // Stream candidates ref for fallback iteration
  const streamCandidatesRef = useRef<string[]>([]);
  const currentCandidateIndexRef = useRef(0);

  // VLC-LIKE APPROACH: Resolve playlists and try candidates until one works
  const playStation = async (station: Station, pageStations?: Station[]) => {
    try {
      logger.log('🎯 VLC-LIKE APPROACH: Resolving stream for', station.name);
      
      // CHROME FIX: Cancel any pending play operations before starting new ones
      if (isPlayPendingRef.current && playPromiseRef.current) {
        logger.log('🚫 Cancelling previous play request before new station');
        isPlayPendingRef.current = false;
        playPromiseRef.current = null;
      }
      
      // Reset reconnection state for new station
      reconnectionInProgressRef.current = false;
      lastReconnectTimeRef.current = 0;
      
      // MARK PLAY TIME FOR DEBUGGING
      (window as any).lastPlayTime = Date.now();
      
      if (!audioRef.current) {
        console.error('❌ No audio element available');
        return;
      }

      const audio = audioRef.current;
      
      // Clean up any existing HLS
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      
      setCurrentStation(station);
      setStationMeta(null); // Clear previous station's metadata immediately
      setHasError(false);
      setIsLoading(true);
      setReconnectAttempts(0);
      
      // Clear manual pause flag since user is starting new playback
      isManuallyPausedRef.current = false;
      
      // Track recently played - localStorage for all users + API for authenticated
      try {
        const stored = localStorage.getItem('recentlyPlayed') || '[]';
        const recentlyPlayed = JSON.parse(stored) as any[];
        const filtered = recentlyPlayed.filter(s => s._id !== station._id);
        const updated = [station, ...filtered].slice(0, 12);
        localStorage.setItem('recentlyPlayed', JSON.stringify(updated));
        window.dispatchEvent(new CustomEvent('recentlyPlayedUpdated'));
        
        fetch('/api/recently-played', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ stationId: station._id })
        }).catch(() => {});
      } catch (e) {}
      
      // Set up station queue for next/prev
      if (pageStations) {
        setStationQueue(pageStations);
        const currentIndex = pageStations.findIndex(s => s._id === station._id);
        setCurrentStationIndex(currentIndex);
      }

      // VLC-LIKE: Resolve stream URL (parse PLS/M3U playlists)
      // Priority: urlResolved (pre-resolved by radio-browser) > url (original)
      const baseStreamUrl = station.urlResolved || station.url || '';
      if (!baseStreamUrl) {
        logger.log('❌ No stream URL available for station');
        setHasError(true);
        setIsLoading(false);
        return;
      }
      let candidates: string[] = [baseStreamUrl];
      
      // Try to resolve playlist if it looks like PLS/M3U
      const urlLower = baseStreamUrl.toLowerCase();
      if (urlLower.includes('.pls') || urlLower.includes('.m3u') || urlLower.includes('listen.pls')) {
        try {
          logger.log('🎵 Resolving playlist:', baseStreamUrl);
          const resolveResponse = await fetch(getStreamProxyUrl(`/api/stream/resolve?url=${encodeURIComponent(baseStreamUrl)}`));
          if (resolveResponse.ok) {
            const resolved = await resolveResponse.json();
            if (resolved.candidates && resolved.candidates.length > 0) {
              candidates = resolved.candidates;
              logger.log(`🎵 Playlist resolved: ${resolved.playlistType} with ${candidates.length} candidates`);
            }
          }
        } catch (e) {
          logger.log('⚠️ Playlist resolution failed, using original URL');
        }
      }
      
      // Store candidates for fallback iteration
      streamCandidatesRef.current = candidates;
      currentCandidateIndexRef.current = 0;
      
      // Add cache-busting timestamp to first candidate
      const cacheBuster = Date.now();
      const firstCandidate = candidates[0];
      const separator = firstCandidate.includes('?') ? '&' : '?';
      const streamUrl = `${firstCandidate}${separator}_t=${cacheBuster}`;
      
      logger.log('🎵 Playing candidate 1/' + candidates.length + ':', streamUrl);
      
      // Check if it's an HLS stream
      const isHLSStream = streamUrl.includes('.m3u8');
      
      // Track final URL for metadata service
      let finalStreamUrl = streamUrl;
      
      if (isHLSStream) {
        logger.log('🎬 HLS Stream: Using dynamic HLS.js for optimization');
        
        // 🚀 LAZY LOAD HLS.JS: Only import when actually streaming HLS (reduces payload by 226.7 KiB)
        import('hls.js').then(({ default: Hls }) => {
          if (Hls.isSupported()) {
            // Simple HLS configuration
            const hls = new Hls({
              enableWorker: false,
              lowLatencyMode: true,
              backBufferLength: 30
            });
            
            hls.loadSource(streamUrl);
            hls.attachMedia(audio);
            
            hls.on(Hls.Events.MANIFEST_PARSED, () => {
              logger.log('✅ HLS manifest loaded - Safari iOS simple play');
              safePlay('hls-manifest-ready').catch(console.error);
            });
            
            hls.on(Hls.Events.ERROR, (event, data) => {
              if (data.fatal) {
                console.error('❌ Fatal HLS error:', data);
                
                // Try fallback: convert HLS URL to direct stream through proxy
                if (currentStation && reconnectAttempts < maxReconnectAttempts) {
                  logger.log('🔄 HLS failed, trying proxy fallback...');
                  setReconnectAttempts(prev => prev + 1);
                  
                  // Clean up failed HLS instance
                  if (hlsRef.current) {
                    hlsRef.current.destroy();
                    hlsRef.current = null;
                  }
                  
                  // Try proxy fallback after delay
                  setTimeout(() => {
                    if (audioRef.current && currentStation && !isPlayPendingRef.current) {
                      const originalUrl = currentStation.url || currentStation.urlResolved || '';
                      if (!originalUrl) return;
                      const encodedUrl = btoa(originalUrl).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
                      const proxyUrl = getStreamProxyUrl(`/api/stream/${encodedUrl}`);
                      
                      logger.log('🎯 HLS fallback: Using proxy stream');
                      audioRef.current.src = proxyUrl;
                      audioRef.current.load();
                      safePlay('hls-proxy-fallback').catch(console.error);
                    }
                  }, 1000);
                } else {
                  setHasError(true);
                  setIsLoading(false);
                }
              } else {
                logger.warn('⚠️ Non-fatal HLS error:', data);
              }
            });
            
            hlsRef.current = hls;
          } else if (audio.canPlayType('application/vnd.apple.mpegurl')) {
            logger.log('🍎 Safari iOS HLS: Simple setAttribute approach');
            audio.setAttribute('src', streamUrl);
            safePlay('safari-hls').catch(console.error);
          } else {
            console.error('❌ HLS not supported');
            setHasError(true);
            setIsLoading(false);
            return;
          }
        }).catch(error => {
          logger.error('❌ Failed to load HLS.js:', error);
          setHasError(true);
          setIsLoading(false);
        });
        
      } else {
        logger.log('🎵 Direct Stream: Smart proxy routing');
        
        if (streamUrl.startsWith('http://') && window.location.protocol === 'https:') {
          const encodedUrl = btoa(streamUrl).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
          finalStreamUrl = getStreamProxyUrl(`/api/stream/${encodedUrl}`);
          logger.log('🔒 HTTP stream → proxy for mixed content fix');
        } else {
          finalStreamUrl = streamUrl;
          logger.log('✅ HTTPS stream → direct connection (no proxy needed)');
        }
        
        // SAFARI iOS: Simple setAttribute like working radio players
        audio.setAttribute('src', finalStreamUrl);
        
        // Wait a moment for the src to be set before playing
        setTimeout(() => {
          safePlay('direct-stream').catch(console.error);
        }, 100);
        
        logger.log('✅ Safari iOS simple play approach started');
      }

      // CONNECT TO METADATA SERVICE: Disconnect old client and create new one for each station
      // This prevents stale metadata from previous station appearing on new station
      if (metadataClientRef.current) {
        logger.log('🧹 METADATA: Disconnecting previous metadata client');
        metadataClientRef.current.disconnect();
        metadataClientRef.current = null;
      }
      
      logger.log('🎵 METADATA: Initializing metadata client for', station.name);
      metadataClientRef.current = createMetadataClient({
        reconnect: true,
        reconnectDelay: 3000,
        onSocketError: (code) => {
          logger.log('🔌 METADATA: WebSocket error code:', code);
        }
      });
      
      // Store station reference for closure
      const currentStationRef = station;
      
      // Subscribe to metadata updates
      metadataClientRef.current.subscribe((metadata: any) => {
        if (metadata.title || metadata.artist) {
          logger.log('🎵 METADATA: Received update:', metadata);
          setStationMeta({
            title: metadata.title || 'Live Stream',
            artist: metadata.artist || currentStationRef.name,
            station: metadata.station || currentStationRef.name,
            genre: metadata.genre || currentStationRef.genre || 'Live Radio'
          });
          
          // Update media session with new metadata
          if (currentStation) {
            updateMediaSession(currentStation, isPlaying ? 'playing' : 'paused');
          }
        } else if (metadata.error) {
          logger.log('❌ METADATA: Error received:', metadata.error);
          // Fallback to station info on error
          setStationMeta({
            title: currentStationRef.name,
            artist: currentStationRef.name,
            album: currentStationRef.genre || 'Live Radio'
          });
        }
      });
      
      // Start tracking this stream - use ORIGINAL stream URL for metadata (not proxy URL)
      // Metadata service needs the real stream URL to fetch ICY metadata
      const metadataStreamUrl = station.urlResolved || station.url;
      metadataClientRef.current.trackStream(metadataStreamUrl);
      
      // Simple metadata setup (fallback while waiting for real metadata)
      setStationMeta({
        title: station.name,
        artist: station.name,
        album: station.genre || 'Live Radio'
      });
      
    } catch (error) {
      console.error('❌ Station play error:', error);
      setHasError(true);
      setIsLoading(false);
      
      toast({
        title: 'Playbook Error',
        description: 'Unable to play this radio station. Please try another station.',
        variant: 'destructive'
      });
    }
  };

  // CHROME FIX: Safe play function that prevents interrupted requests
  const safePlay = async (context: string = 'unknown'): Promise<void> => {
    if (!audioRef.current) {
      throw new Error('No audio element available');
    }
    
    // Don't start new play if one is already pending
    if (isPlayPendingRef.current) {
      logger.log(`🚫 Play blocked (${context}): Previous play still pending`);
      return;
    }
    
    logger.log(`🎵 Safe play starting (${context})`);
    isPlayPendingRef.current = true;
    
    try {
      // Store the promise to track it
      playPromiseRef.current = audioRef.current.play();
      await playPromiseRef.current;
      logger.log(`✅ Play succeeded (${context})`);
    } catch (error) {
      logger.log(`❌ Play failed (${context}):`, error);
      throw error;
    } finally {
      // Always clear pending status
      isPlayPendingRef.current = false;
      playPromiseRef.current = null;
    }
  };

  // Simple timer functions
  const formatGlobalListeningTime = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    } else {
      return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
  };

  // Station queue management
  const setPageStationQueue = (stations: Station[], currentStation: Station) => {
    setStationQueue(stations);
    const currentIndex = stations.findIndex(s => s._id === currentStation._id);
    setCurrentStationIndex(currentIndex);
  };

  // RADIOLISE STYLE: Radio pause = kill station completely  
  const pause = () => {
    logger.log('⏸️ Radio pause - KILLING STATION (live radio doesn\'t pause)');
    logger.log('🔍 Manual pause called from:', new Error().stack?.split('\n')[2]);
    
    // Mark as manually paused to prevent auto-restart
    isManuallyPausedRef.current = true;
    
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = ''; // Clear source to kill stream
      audioRef.current.load();
    }
    // Keep station info but mark as not playing so resume can restart it fresh
    setIsPlaying(false);
    isPlayingRef.current = false;
    // Stop watchdog timer directly using ref
    if (watchdogTimerRef.current) {
      clearInterval(watchdogTimerRef.current);
      watchdogTimerRef.current = null;
    }
    setHasError(false);
    setReconnectAttempts(0); // Reset reconnection attempts
  };

  const resume = () => {
    logger.log('▶️ Radio resume - STARTING FRESH STREAM (no resume for live radio)');
    
    // Clear manual pause flag since user is resuming
    isManuallyPausedRef.current = false;
    
    // For radio, resume means restart the current station with fresh stream
    if (currentStation) {
      playStation(currentStation);
    } else {
      logger.log('❌ No station to resume');
    }
  };

  const pauseStation = () => pause();
  const resumeStation = () => resume();
  
  // Record listening time before stopping
  const recordListeningTime = async () => {
    if (!currentStation || globalListeningTime < 5) return; // Only record if listened >5 seconds
    
    try {
      await fetch('/api/listening/record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          stationId: currentStation._id,
          stationName: currentStation.name,
          listenDuration: globalListeningTime,
          country: currentStation.country,
          genre: currentStation.genre
        })
      });
      logger.log('📊 Listening time recorded:', globalListeningTime, 'seconds');
    } catch (error) {
      logger.log('⚠️ Failed to record listening time:', error);
    }
  };

  const stop = () => {
    logger.log('⏹️ Manual stop (simple) - USER INITIATED');
    logger.log('🔍 Manual stop called from:', new Error().stack?.split('\n')[2]);
    
    // Record listening time before stopping
    recordListeningTime();
    
    // BACKGROUND AUDIO PREVENTION: Release all resources on stop
    releaseWakeLock();
    stopServiceWorkerKeepAlive();
    
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setCurrentStation(null);
    setGlobalListeningTime(0); // Reset listening timer
  };
  const stopStation = () => stop();

  // Simple volume controls (no UI - for future use)
  const setVolume = (volume: number) => {
    if (audioRef.current) {
      if (volume === 0) {
        audioRef.current.muted = true;
        setIsMuted(true);
      } else {
        audioRef.current.muted = false;
        setIsMuted(false);
        audioRef.current.volume = volume;
      }
      setVolumeState(volume);
    }
  };

  const toggleMute = () => {
    if (audioRef.current) {
      const newMutedState = !audioRef.current.muted;
      audioRef.current.muted = newMutedState;
      setIsMuted(newMutedState);
    }
  };

  // Simple station navigation
  const nextStation = () => {
    if (stationQueue.length > 1) {
      const nextIndex = currentStationIndex < stationQueue.length - 1 ? currentStationIndex + 1 : 0;
      const next = stationQueue[nextIndex];
      logger.log('⏭️ Next station:', next.name);
      playStation(next, stationQueue);
    } else if (currentStation) {
      logger.log('🔄 Only one station, refreshing current');
      refreshStream();
    }
  };

  const previousStation = () => {
    if (stationQueue.length > 1) {
      const prevIndex = currentStationIndex > 0 ? currentStationIndex - 1 : stationQueue.length - 1;
      const prev = stationQueue[prevIndex];
      logger.log('⏮️ Previous station:', prev.name);
      playStation(prev, stationQueue);
    } else if (currentStation) {
      logger.log('🔄 Only one station, refreshing current');
      refreshStream();
    }
  };

  // Simple favorites (placeholder)
  const toggleFavorite = (stationId: string) => {
    logger.log('❤️ Toggle favorite for station:', stationId);
  };

  // Simple stream refresh
  const refreshStream = async () => {
    if (currentStation) {
      logger.log('🔄 Refreshing current stream (simple)');
      await playStation(currentStation, stationQueue);
    }
  };

  // Simple login handling
  const playAtLogin = async (user: any) => {
    logger.log('🔑 Play at login for user:', user);
  };

  // Set up simple media session handlers
  useEffect(() => {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.setActionHandler('nexttrack', () => {
        logger.log('📱 Media Session: Next track');
        nextStation();
      });
      
      navigator.mediaSession.setActionHandler('previoustrack', () => {
        logger.log('📱 Media Session: Previous track');
        previousStation();
      });
      
      logger.log('📱 Media Session: Simple handlers registered');
    }
  }, [stationQueue.length, currentStationIndex]);

  const value: GlobalPlayerState = {
    currentStation,
    isPlaying,
    isLoading,
    audioElement,
    volume,
    isMuted,
    currentTime,
    duration,
    favorites,
    playStation,
    setPageStationQueue,
    pause,
    resume,
    pauseStation,
    resumeStation,
    setVolume,
    toggleMute,
    stop,
    stopStation,
    nextStation,
    previousStation,
    toggleFavorite,
    refreshStream,
    hasError,
    stationMeta,
    playAtLogin,
    globalListeningTime,
    formattedGlobalListeningTime: formatGlobalListeningTime(globalListeningTime),
    isHydrated: true
  };

  return (
    <GlobalPlayerContext.Provider value={value}>
      {children}
    </GlobalPlayerContext.Provider>
  );
}

// Hook to use the global player - re-export from shell for consistency
export { useGlobalPlayer } from './useGlobalPlayer.shell';