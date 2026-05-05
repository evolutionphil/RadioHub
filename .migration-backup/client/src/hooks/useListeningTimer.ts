import { useGlobalPlayer } from './useGlobalPlayer';

interface UseListeningTimerProps {
  isPlaying: boolean;
  stationId?: string;
}

export function useListeningTimer({ isPlaying, stationId }: UseListeningTimerProps) {
  // Use the global listening timer that persists across navigation
  const { globalListeningTime, formattedGlobalListeningTime, currentStation } = useGlobalPlayer();

  // Only show timer if the current global station matches the requested station
  const shouldShowTimer = currentStation && currentStation._id === stationId && isPlaying;
  const displayTime = shouldShowTimer ? globalListeningTime : 0;
  const displayFormattedTime = shouldShowTimer ? formattedGlobalListeningTime : '00:00';

  const resetTimer = () => {
    // No-op since the global timer is managed by the global player
  };

  return {
    listeningTime: displayTime,
    formattedTime: displayFormattedTime,
    resetTimer
  };
}