import { createContext, useContext, ReactNode } from 'react';
import type { StationWithCountry as Station } from '@workspace/db-shared/schema';

export interface GlobalPlayerState {
  currentStation: Station | null;
  isPlaying: boolean;
  isLoading: boolean;
  audioElement: HTMLAudioElement | null;
  volume: number;
  isMuted: boolean;
  currentTime: number;
  duration: number;
  favorites: string[];
  playStation: (station: Station, pageStations?: Station[]) => Promise<void>;
  setPageStationQueue: (stations: Station[], currentStation: Station) => void;
  pause: () => void;
  resume: () => void;
  pauseStation: () => void;
  resumeStation: () => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  stop: () => void;
  stopStation: () => void;
  nextStation: () => void;
  previousStation: () => void;
  toggleFavorite: (stationId: string) => void;
  refreshStream: () => Promise<void>;
  hasError: boolean;
  stationMeta?: any;
  playAtLogin: (user: any) => Promise<void>;
  globalListeningTime: number;
  formattedGlobalListeningTime: string;
  isHydrated: boolean;
}

const asyncNoop = async () => {};
const noop = () => {};

export const shellDefaults: GlobalPlayerState = {
  currentStation: null,
  isPlaying: false,
  isLoading: false,
  audioElement: null,
  volume: 0.7,
  isMuted: false,
  currentTime: 0,
  duration: 0,
  favorites: [],
  playStation: asyncNoop,
  setPageStationQueue: noop,
  pause: noop,
  resume: noop,
  pauseStation: noop,
  resumeStation: noop,
  setVolume: noop,
  toggleMute: noop,
  stop: noop,
  stopStation: noop,
  nextStation: noop,
  previousStation: noop,
  toggleFavorite: noop,
  refreshStream: asyncNoop,
  hasError: false,
  stationMeta: null,
  playAtLogin: asyncNoop,
  globalListeningTime: 0,
  formattedGlobalListeningTime: '00:00',
  isHydrated: false,
};

export const GlobalPlayerContext = createContext<GlobalPlayerState>(shellDefaults);

export function useGlobalPlayer(): GlobalPlayerState {
  const context = useContext(GlobalPlayerContext);
  return context;
}
