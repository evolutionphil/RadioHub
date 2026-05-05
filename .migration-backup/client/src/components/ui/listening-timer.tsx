import React from 'react';
import { Clock } from 'lucide-react';
import { useListeningTimer } from '@/hooks/useListeningTimer';

interface ListeningTimerProps {
  isPlaying: boolean;
  stationId?: string;
  className?: string;
}

export function ListeningTimer({ isPlaying, stationId, className = '' }: ListeningTimerProps) {
  const { formattedTime } = useListeningTimer({ isPlaying, stationId });

  if (!stationId) {
    return null;
  }

  return (
    <div className={`flex items-center gap-1 text-sm ${className}`}>
      <Clock className="w-4 h-4 text-blue-400" />
      <span className="font-mono text-blue-400 bg-blue-400/10 px-2 py-1 rounded text-xs">
        {formattedTime}
      </span>
    </div>
  );
}