import { useRecentlyPlayed } from '@/hooks/useRecentlyPlayed';
import { useTranslation } from '@/hooks/useTranslation';
import { useSeoRouting } from '@/hooks/useSeoRouting';
import StationCard from '@/components/ui/station-card';
import { Link } from 'wouter';

interface RecentlyPlayedSectionProps {
  onPlay: (station: any) => void;
}

export default function RecentlyPlayedSection({ onPlay }: RecentlyPlayedSectionProps) {
  const { recentlyPlayed, hasRecentlyPlayed, isLoading } = useRecentlyPlayed();
  const { t } = useTranslation();
  const { getLocalizedUrl } = useSeoRouting();

  // Don't show if user hasn't played any stations and not loading
  if (!hasRecentlyPlayed && !isLoading) {
    return null;
  }

  // Show skeleton while loading
  if (isLoading && !hasRecentlyPlayed) {
    return (
      <div className="container">
        <div className="flex justify-between pb-4">
          <h3 className="section-header">
            {t('homepage_recently_played', 'Recently Played')}
          </h3>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-x-[21px] gap-y-[20px]">
          {Array(6).fill(0).map((_, i) => (
            <div key={i} className="animate-pulse h-32 bg-gray-600 rounded-lg"></div>
          ))}
        </div>
      </div>
    );
  }

  // If we have data, show it
  if (hasRecentlyPlayed && recentlyPlayed.length > 0) {
    return (
      <div className="container mt-8">
        <div className="flex justify-between pb-4">
          <h3 className="section-header">
            {t('homepage_recently_played', 'Recently Played')}
          </h3>
        </div>
        
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-x-[21px] gap-y-[20px]">
          {recentlyPlayed.slice(0, 6).map((station: any, i: number) => (
            <StationCard 
              key={`recently-played-${station._id || i}`} 
              station={station} 
              onPlay={onPlay}
              showVotes={false}
            />
          ))}
        </div>
      </div>
    );
  }

  // No data and not loading
  return null;
}
