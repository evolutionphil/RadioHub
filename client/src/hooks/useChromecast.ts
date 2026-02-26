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
      if (!window.cast?.framework) return;

      try {
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
            
            if (castState === window.cast.framework.CastState.NO_DEVICES_AVAILABLE) {
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
          }
        );

        castContext.addEventListener(
          window.cast.framework.CastContextEventType.SESSION_STATE_CHANGED,
          (event: any) => {
            const sessionState = event.sessionState;
            
            if (sessionState === window.cast.framework.SessionState.SESSION_STARTED ||
                sessionState === window.cast.framework.SessionState.SESSION_RESUMED) {
              const session = castContext.getCurrentSession();
              if (session) {
                const device = session.getCastDevice();
                setDeviceName(device?.friendlyName || null);
                setIsConnected(true);
              }
            } else if (sessionState === window.cast.framework.SessionState.SESSION_ENDED) {
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
        
        setTimeout(() => {
          const castState = castContext.getCastState?.();
          if (castState) {
            setIsAvailable(castState !== window.cast.framework.CastState.NO_DEVICES_AVAILABLE);
          }
        }, 500);
      } catch (error) {
        console.error('🎬 Failed to initialize Chromecast:', error);
      }
    };

    window['__onGCastApiAvailable'] = (isAvailable: boolean) => {
      if (isAvailable) {
        initializeCastApi();
      }
    };

    if (window.cast?.framework) {
      initializeCastApi();
    } else {
      const checkTimeout = setTimeout(() => {
        if (window.cast?.framework && !initializedRef.current) {
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
      throw new Error('Cast framework not available');
    }

    try {
      const castContext = window.cast.framework.CastContext.getInstance();
      await castContext.requestSession();
    } catch (error: any) {
      if (error.code !== 'cancel' && error?.message?.includes('cancel') === false) {
        throw error;
      } else {
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
    if (!window.cast?.framework || !window.chrome?.cast) {
      throw new Error('Cast framework not available');
    }

    try {
      const castContext = window.cast.framework.CastContext.getInstance();
      let session = castContext.getCurrentSession();
      
      if (!session) {
        await requestSession();
        session = castContext.getCurrentSession();
        if (!session) {
          throw new Error('No Cast session available');
        }
      }

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

      await session.loadMedia(request);
    } catch (error) {
      console.error('🎬 Failed to load media on Chromecast:', error);
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
        () => {},
        (error: any) => console.error('Failed to update Chromecast metadata:', error)
      );
    } catch (error) {
      console.error('Failed to update Chromecast metadata:', error);
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
