import { getStationStreamUnavailableNotice } from '@workspace/seo-shared/station-page-copy';
import { isExplicitlyFailedStation } from '@/utils/station-availability';

export function StationStreamAvailability({ station, language }: { station: unknown; language: string }) {
  if (!isExplicitlyFailedStation(station)) return null;
  return <p id="station-stream-unavailable" role="status" className="mt-3 text-sm text-white/70">
    {getStationStreamUnavailableNotice(language)}
  </p>;
}
