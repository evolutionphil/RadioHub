import { Fragment, type Key, type ReactNode } from 'react';
import { useLocation, useSearch } from 'wouter';
import AdSenseUnit from './AdSenseUnit';
import { AD_SLOTS, CATALOG_AD_AFTER, CATALOG_AD_MIN_STATIONS, usesInlineMobileCatalogAd } from '@/lib/advertising-placements';
import { availableStations } from '@/utils/station-availability';

/** One full-row banner, separated from play/favorite controls; no ad refresh timer. */
export default function CatalogStationItems<T>({ stations, getKey, children }: {
  stations: T[];
  getKey: (station: T, index: number) => Key;
  children: (station: T, index: number) => ReactNode;
}) {
  const [location] = useLocation();
  const search = useSearch();
  // Card components also hide confirmed unavailable stations. Count the same
  // visible content here so cached hidden rows cannot move an ad to the top.
  const visibleStations = availableStations(stations);
  const showInline = visibleStations.length >= CATALOG_AD_MIN_STATIONS && usesInlineMobileCatalogAd(`${location}?${search}`);
  return <>{visibleStations.flatMap((station, index) => {
    const items: ReactNode[] = [<Fragment key={`station-${getKey(station, index)}`}>{children(station, index)}</Fragment>];
    if (showInline && index === CATALOG_AD_AFTER - 1) items.push(
      // The unit's identity must not depend on its adjacent station: reordering
      // cards must not manufacture another Google ad impression.
      <AdSenseUnit key="mobile-catalog-ad" adSlot={AD_SLOTS.catalogFooter} adFormat="horizontal" fullWidthResponsive={false}
        className="col-span-full my-3 w-full min-w-0 border-y border-white/10 py-6 md:hidden" />
    );
    return items;
  })}</>;
}
