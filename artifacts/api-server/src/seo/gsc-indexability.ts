import { isJunkStation, isNumericOnlySlug, getIndexableLanguagesForStation } from './junk-station-rules';
import { getCanonicalGenreSlug, MIN_STATIONS_FOR_GENRE_INDEX } from './genre-whitelist';

export type ServerNoindexReason = 'stationNoIndex' | 'numericSlug' | 'junk' | 'genreNotWhitelisted' | 'genreThin' | null;
export interface GscServerIndexability {
  noindex: boolean;
  reason: ServerNoindexReason;
  redirected: boolean;
  unknown: boolean;
}
export interface GscCachedUrl { url: string; language: string; group: string }

export function getGscStationIndexableLanguages(station: any, qualifiedLanguages: readonly string[]): string[] {
  const native = getIndexableLanguagesForStation(station, qualifiedLanguages);
  if (station.noIndex === true || isJunkStation(station) || isNumericOnlySlug(station.slug)) return [];
  const translated = (station.descriptionLanguages ?? []).filter((lang: string) => qualifiedLanguages.includes(lang));
  return [...new Set<string>([...native, ...translated])];
}

export function extractGscSlug(url: string): string | null {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    return decodeURIComponent(parts[parts.length - 1] || '') || null;
  } catch { return null; }
}

/** Current catalog decisions, shared by URL rows and aggregate counts.
 * Missing catalog evidence is unknown, never proof that a URL is indexable. */
export function computeGscServerIndexability(
  row: GscCachedUrl,
  qualifiedLanguages: readonly string[],
  stations: ReadonlyMap<string, any>,
  genres: ReadonlyMap<string, { stationCount?: number }>,
): GscServerIndexability {
  const allowed = { noindex: false, reason: null, redirected: false, unknown: false };
  if (!qualifiedLanguages.includes(row.language)) return { ...allowed, redirected: true };
  const slug = extractGscSlug(row.url);
  if (row.group === 'station') {
    if (slug && isNumericOnlySlug(slug)) return { ...allowed, noindex: true, reason: 'numericSlug' };
    const station = slug ? stations.get(slug) : undefined;
    if (!station) return { ...allowed, unknown: true };
    if (station.noIndex === true) return { ...allowed, noindex: true, reason: 'stationNoIndex' };
    if (isJunkStation(station)) return { ...allowed, noindex: true, reason: 'junk' };
    if (!getGscStationIndexableLanguages(station, qualifiedLanguages).includes(row.language)) return { ...allowed, redirected: true };
  } else if (row.group === 'genre') {
    const canonical = getCanonicalGenreSlug(slug);
    if (!canonical) return { ...allowed, noindex: true, reason: 'genreNotWhitelisted' };
    if (canonical !== slug) return { ...allowed, redirected: true };
    const count = genres.get(canonical)?.stationCount;
    if (typeof count !== 'number') return { ...allowed, unknown: true };
    if (count < MIN_STATIONS_FOR_GENRE_INDEX) return { ...allowed, noindex: true, reason: 'genreThin' };
  }
  return allowed;
}
