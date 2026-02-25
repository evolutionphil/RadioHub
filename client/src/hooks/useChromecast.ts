import { useState, useEffect, useCallback, useRef } from 'react';

declare global {
  interface Window {
    __onGCastApiAvailable?: (isAvailable: boolean) => void;
    cast?: any;
    chrome?: any;
  }
}

export interface ChromecastState {
  isAvailable: boolean;
  isConnected: boolean;
  deviceName: string | null;
  isPlaying: boolean;
}

export interface ChromecastControls {
  requestSession: () => Promise<void>;
  stopCasting: () => void;
  loadMedia: (streamUrl: string, metadata: MediaMetadata) => Promise<void>;
  play: () => void;
  pause: () => void;
  updateMetadata: (metadata: MediaMetadata) => void;
}

export interface MediaMetadata {
  title: string;
  artist?: string;
  stationName: string;
  imageUrl?: string;
}

export function useChromecast(): ChromecastState & ChromecastControls {
  const [isAvailable, setIsAvailable] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  
  const playerRef = useRef<any>(null);
  const controllerRef = useRef<any>(null);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    
    const initializeCastApi = () => {
      if (!window.cast?.framework) {
        console.log('🎬 Cast framework not available yet');
        return;
      }

      try {
        console.log('🎬 Initializing Cast SDK...');
        const castContext = window.cast.framework.CastContext.getInstance();
        
        castContext.setOptions({
          receiverApplicationId: window.chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
          autoJoinPolicy: window.chrome.cast.AutoJoinPolicy.TAB_AND_ORIGIN_SCOPED,
        });

        playerRef.current = new window.cast.framework.RemotePlayer();
        controllerRef.current = new window.cast.framework.RemotePlayerController(playerRef.current);

        castContext.addEventListener(
          window.cast.framework.CastContextEventType.CAST_STATE_CHANGED,
          (event: any) => {
            const castState = event.castState;
            console.log('🎬 CAST_STATE_CHANGED:', castState);
            
            // Handle NO_DEVICES_AVAILABLE state explicitly
            if (castState === window.cast.framework.CastState.NO_DEVICES_AVAILABLE) {
              console.log('🎬 ❌ No Cast devices available on network');
              setIsAvailable(false);
              setIsConnected(false);
              setIsPlaying(false);
              return;
            }
            
            const isAvail = castState === window.cast.framework.CastState.NOT_CONNECTED ||
                           castState === window.cast.framework.CastState.CONNECTED ||
                           castState === window.cast.framework.CastState.CONNECTING;
            
            setIsAvailable(isAvail);
            setIsConnected(castState === window.cast.framework.CastState.CONNECTED);
            
            if (isAvail) {
              console.log('🎬 ✅ Cast device available!');
            }
          }
        );

        castContext.addEventListener(
          window.cast.framework.CastContextEventType.SESSION_STATE_CHANGED,
          (event: any) => {
            const sessionState = event.sessionState;
            console.log('🎬 SESSION_STATE_CHANGED:', sessionState);
            
            if (sessionState === window.cast.framework.SessionState.SESSION_STARTED ||
                sessionState === window.cast.framework.SessionState.SESSION_RESUMED) {
              const session = castContext.getCurrentSession();
              if (session) {
                const device = session.getCastDevice();
                console.log('🎬 Connected to device:', device?.friendlyName);
                setDeviceName(device?.friendlyName || null);
                setIsConnected(true);
              }
            } else if (sessionState === window.cast.framework.SessionState.SESSION_ENDED) {
              console.log('🎬 Cast session ended');
              setDeviceName(null);
              setIsConnected(false);
              setIsPlaying(false);
            }
          }
        );

        if (controllerRef.current) {
          controllerRef.current.addEventListener(
            window.cast.framework.RemotePlayerEventType.IS_PLAYING_CHANGED,
            () => {
              setIsPlaying(playerRef.current?.isPlaying ?? false);
            }
          );
        }

        initializedRef.current = true;
        console.log('🎬 ✅ Chromecast SDK initialized successfully');
        
        // Force a state check after initialization
        setTimeout(() => {
          const castState = castContext.getCastState?.();
          console.log('🎬 Current Cast State:', castState);
          if (castState) {
            setIsAvailable(castState !== window.cast.framework.CastState.NO_DEVICES_AVAILABLE);
          }
        }, 500);
      } catch (error) {
        console.error('🎬 ❌ Failed to initialize Chromecast:', error);
      }
    };

    window['__onGCastApiAvailable'] = (isAvailable: boolean) => {
      console.log('🎬 __onGCastApiAvailable called:', isAvailable);
      if (isAvailable) {
        initializeCastApi();
      } else {
        console.log('🎬 Cast API not available on this device');
      }
    };

    // Check if SDK is already loaded
    if (window.cast?.framework) {
      console.log('🎬 Cast framework already loaded, initializing...');
      initializeCastApi();
    } else {
      console.log('🎬 Waiting for Cast SDK to load...');
      // Set a timeout to check again
      const checkTimeout = setTimeout(() => {
        if (window.cast?.framework && !initializedRef.current) {
          console.log('🎬 Cast SDK loaded after delay');
          initializeCastApi();
        }
      }, 2000);
      
      return () => {
        clearTimeout(checkTimeout);
        window['__onGCastApiAvailable'] = undefined;
      };
    }

    return () => {
      window['__onGCastApiAvailable'] = undefined;
    };
  }, []);

  const requestSession = useCallback(async () => {
    if (!window.cast?.framework) {
      console.error('🎬 ❌ Cast framework not available');
      throw new Error('Cast framework not available');
    }

    try {
      console.log('🎬 Requesting Cast session...');
      const castContext = window.cast.framework.CastContext.getInstance();
      console.log('🎬 Cast context state:', castContext.getCastState?.());
      await castContext.requestSession();
      console.log('🎬 ✅ Cast session requested');
    } catch (error: any) {
      if (error.code !== 'cancel' && error?.message?.includes('cancel') === false) {
        console.error('🎬 ❌ Failed to request Cast session:', error);
        throw error;
      } else {
        console.log('🎬 User cancelled Cast device selection');
        throw error;
      }
    }
  }, []);

  const stopCasting = useCallback(() => {
    if (!window.cast?.framework) return;

    try {
      const castContext = window.cast.framework.CastContext.getInstance();
      const session = castContext.getCurrentSession();
      if (session) {
        session.endSession(true);
      }
    } catch (error) {
      console.error('Failed to stop casting:', error);
    }
  }, []);

  const loadMedia = useCallback(async (streamUrl: string, metadata: MediaMetadata) => {
    console.log('🎬 loadMedia called with:', metadata.stationName);
    
    if (!window.cast?.framework || !window.chrome?.cast) {
      console.error('🎬 ❌ Cast framework not available');
      throw new Error('Cast framework not available');
    }

    try {
      console.log('🎬 Getting Cast context...');
      const castContext = window.cast.framework.CastContext.getInstance();
      let session = castContext.getCurrentSession();
      
      if (!session) {
        console.log('🎬 No session, requesting...');
        await requestSession();
        session = castContext.getCurrentSession();
        if (!session) {
          console.error('🎬 ❌ No Cast session available after request');
          throw new Error('No Cast session available');
        }
      }

      console.log('🎬 Session available, loading media...');
      console.log('🎬 Stream URL:', streamUrl);
      console.log('🎬 Metadata:', metadata);

      const contentType = streamUrl.includes('.m3u8') ? 'application/x-mpegURL' : 
                          streamUrl.includes('.aac') ? 'audio/aac' : 
                          streamUrl.includes('.ogg') ? 'audio/ogg' : 'audio/mpeg';

      const mediaInfo = new window.chrome.cast.media.MediaInfo(streamUrl, contentType);
      mediaInfo.streamType = window.chrome.cast.media.StreamType.LIVE;
      
      const musicMetadata = new window.chrome.cast.media.MusicTrackMediaMetadata();
      musicMetadata.title = metadata.title || metadata.stationName;
      musicMetadata.artist = metadata.artist || metadata.stationName;
      musicMetadata.albumName = metadata.stationName;
      
      if (metadata.imageUrl) {
        musicMetadata.images = [
          new window.chrome.cast.Image(metadata.imageUrl)
        ];
      }
      
      mediaInfo.metadata = musicMetadata;

      const request = new window.chrome.cast.media.LoadRequest(mediaInfo);
      request.autoplay = true;

      console.log('🎬 Sending LoadRequest to Cast device...');
      await session.loadMedia(request);
      console.log('🎬 ✅ Media loaded on Chromecast:', metadata.stationName);
    } catch (error) {
      console.error('🎬 ❌ Failed to load media on Chromecast:', error);
      throw error;
    }
  }, [requestSession]);

  const play = useCallback(() => {
    if (controllerRef.current && playerRef.current && !playerRef.current.isPlaying) {
      controllerRef.current.playOrPause();
    }
  }, []);

  const pause = useCallback(() => {
    if (controllerRef.current && playerRef.current && playerRef.current.isPlaying) {
      controllerRef.current.playOrPause();
    }
  }, []);

  const updateMetadata = useCallback((metadata: MediaMetadata) => {
    if (!window.cast?.framework || !window.chrome?.cast) return;

    try {
      const castContext = window.cast.framework.CastContext.getInstance();
      const session = castContext.getCurrentSession();
      if (!session) return;

      const media = session.getMediaSession();
      if (!media) return;

      const musicMetadata = new window.chrome.cast.media.MusicTrackMediaMetadata();
      musicMetadata.title = metadata.title || metadata.stationName;
      musicMetadata.artist = metadata.artist || metadata.stationName;
      musicMetadata.albumName = metadata.stationName;
      
      if (metadata.imageUrl) {
        musicMetadata.images = [
          new window.chrome.cast.Image(metadata.imageUrl)
        ];
      }

      media.media.metadata = musicMetadata;
      
      const request = new window.chrome.cast.media.EditTracksInfoRequest();
      request.activeTrackIds = media.activeTrackIds || [];
      
      media.editTracksInfo(request, 
        () => console.log('Metadata updated on Chromecast:', metadata),
        (error: any) => console.error('Failed to update metadata:', error)
      );
    } catch (error) {
      console.error('Failed to update metadata:', error);
    }
  }, []);

  return {
    isAvailable,
    isConnected,
    deviceName,
    isPlaying,
    requestSession,
    stopCasting,
    loadMedia,
    play,
    pause,
    updateMetadata,
  };
}
