import StationCard from '@/components/ui/station-card';
import { InView } from '@/components/ui/in-view';
import { useTranslation } from '@/hooks/useTranslation';
import { getLocalizedCountryDisplayName } from '@/utils/localized-country';

interface PopularStationsSectionProps {
  stations: any[];
  isPending: boolean;
  activeCountry: string;
  onPlay: (station: any, playlistName?: string) => void | Promise<void>;
}

export default function PopularStationsSection({ stations, isPending, activeCountry, onPlay }: PopularStationsSectionProps) {
  const { t, language } = useTranslation();
  // A failed/empty request must not leave a permanent 1,400px mobile gap
  // below Recently Played. Preserve the reservation only while data is pending.
  if (!isPending && stations.length === 0) return null;
  const visibleStations = stations.slice(0, 12);
  return (
    <InView rootMargin="150px" className={isPending ? 'min-h-[1400px] lg:min-h-[750px] xl:min-h-[530px]' : undefined}>
      {(inView) => (
        <div className="container">
          <div className="my-8">
            <h3 className="section-header pb-4">
              {t('homepage_popular_stations', 'Popular Stations')}
              {!isPending && activeCountry !== 'all' && (
                <span className="text-sm font-normal text-gray-400 ml-2">{t('from', 'from')} {getLocalizedCountryDisplayName(activeCountry, language)}</span>
              )}
            </h3>
            <div className="relative">
              <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-x-[21px] gap-y-[20px]">
                {!isPending && inView ? visibleStations.map((station, i) => (
                  <StationCard key={`popular-${station._id || i}`} station={station} onPlay={onPlay} showVotes={true} />
                )) : Array.from({ length: isPending ? 12 : visibleStations.length }, (_, index) => (
                  <div key={index} className="animate-pulse h-32 bg-gray-600 rounded-lg" />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </InView>
  );
}
