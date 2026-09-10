import type { StationFilters } from './api';

export type AdminHealthFilter = 'all' | 'working' | 'unavailable' | 'unverified' | 'source-offline';
export const ADMIN_STATION_DEFAULTS: StationFilters = {
  page: 1, limit: 50, search: '', country: '', language: '', genre: '',
  sortBy: 'name', sortOrder: 'asc', hasDescriptions: 'all', tagsStatus: 'all', hasLogo: 'all', healthStatus: 'all',
};

/** Keep the current page in view, including after page five. */
export function adminStationPageWindow(page: number, totalPages: number): number[] {
  const total = Math.max(0, Math.floor(totalPages));
  if (!total) return [];
  const current = Math.max(1, Math.min(total, Math.floor(page)));
  const start = Math.max(1, Math.min(current - 2, total - 4));
  return Array.from({ length: Math.min(5, total) }, (_, index) => start + index);
}

export function adminStationDescriptionCount(descriptions: unknown): number {
  if (!descriptions || typeof descriptions !== 'object' || Array.isArray(descriptions)) return 0;
  const languages = ['en', 'es', 'fr', 'de', 'pt', 'it', 'ru', 'ar', 'zh', 'tr', 'ja', 'ko', 'hi', 'he'];
  return languages.filter(language => {
    const value = (descriptions as Record<string, unknown>)[language];
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      && typeof (value as { full?: unknown }).full === 'string'
      && Boolean((value as { full: string }).full.trim());
  }).length;
}

export function adminStationHealth(station: { availabilityStatus?: string; isListVisible?: boolean; lastCheckOk?: boolean; healthSource?: string }) {
  if (station.availabilityStatus === 'unavailable' && station.isListVisible === false) {
    return { label: 'Confirmed offline', tone: 'offline', detail: 'Hidden from lists after repeated local checks. The station URL is kept.' } as const;
  }
  if (station.availabilityStatus === 'working') {
    return { label: 'Recent positive check', tone: 'working', detail: 'A recent check succeeded; availability can change.' } as const;
  }
  return {
    label: 'Needs verification', tone: 'unverified',
    detail: station.lastCheckOk === false && station.healthSource !== 'manual-unchecked'
      ? 'The source reports offline. This is not a confirmed outage; the station remains eligible for lists.'
      : 'No fresh, conclusive result. The station remains eligible for lists.',
  } as const;
}
