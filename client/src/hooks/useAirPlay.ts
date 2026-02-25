import { useState, useEffect, useCallback, useRef } from 'react';

export interface AirPlayState {
  isAvailable: boolean;
  isPlaying: boolean;
}

export interface AirPlayControls {
  showPicker: () => void;
}

export function useAirPlay(): AirPlayState & AirPlayControls {
  const [isAvailable, setIsAvailable] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    // Check if AirPlay API is supported (Safari only)
    if (!window.WebKitPlaybackTargetAvailabilityEvent) {
      console.log('📺 AirPlay: Not supported in this browser (Safari only)');
      return;
    }

    console.log('📺 AirPlay: API supported, setting up listeners...');

    const setupAirPlayListeners = () => {
      const audio = document.getElementById('global-radio-player') as HTMLAudioElement;
      if (!audio) {
        // Try again later if audio element not ready
        setTimeout(setupAirPlayListeners, 1000);
        return;
      }

      audioElementRef.current = audio;

      // Listen for AirPlay device availability
      const handleAvailabilityChange = (event: any) => {
        const available = event.availability === 'available';
        console.log('📺 AirPlay availability changed:', available);
        setIsAvailable(available);
      };

      // Listen for when playback target changes (user selects AirPlay device)
      const handleCurrentTargetChange = () => {
        console.log('📺 AirPlay: Playback target changed');
        // Check if playing on remote device
        const isRemote = (audio as any).webkitCurrentPlaybackTargetIsWireless;
        setIsPlaying(isRemote);
      };

      audio.addEventListener('webkitplaybacktargetavailabilitychanged', handleAvailabilityChange);
      audio.addEventListener('webkitcurrentplaybacktargetiswirelesschanged', handleCurrentTargetChange);

      return () => {
        audio.removeEventListener('webkitplaybacktargetavailabilitychanged', handleAvailabilityChange);
        audio.removeEventListener('webkitcurrentplaybacktargetiswirelesschanged', handleCurrentTargetChange);
      };
    };

    const cleanup = setupAirPlayListeners();
    return cleanup;
  }, []);

  const showPicker = useCallback(() => {
    const audio = audioElementRef.current || document.getElementById('global-radio-player') as HTMLAudioElement;
    
    if (!audio) {
      console.error('📺 AirPlay: No audio element found');
      return;
    }

    if (!(audio as any).webkitShowPlaybackTargetPicker) {
      console.error('📺 AirPlay: webkitShowPlaybackTargetPicker not available');
      return;
    }

    try {
      console.log('📺 AirPlay: Showing picker...');
      (audio as any).webkitShowPlaybackTargetPicker();
    } catch (error) {
      console.error('📺 AirPlay: Failed to show picker:', error);
    }
  }, []);

  return {
    isAvailable,
    isPlaying,
    showPicker,
  };
}

// Type declaration for Safari's AirPlay API
declare global {
  interface Window {
    WebKitPlaybackTargetAvailabilityEvent?: any;
  }
}
